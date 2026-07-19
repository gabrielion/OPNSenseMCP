// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, link, lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { connect as connectTls } from 'node:tls';

export const VM_PORTS = Object.freeze({ api: 18443 });

const OWNER_NAME = 'owner.json';
const OVERLAY_NAME = 'overlay.qcow2';
const OPERATION_LOCK_NAME = '.operation.lock';
const DEFAULT_READINESS_ATTEMPTS = 180;
const DEFAULT_READINESS_DELAY_MS = 1000;
const DEFAULT_STOP_ATTEMPTS = 20;
const DEFAULT_STOP_DELAY_MS = 250;

const VM_FAILURES = Object.freeze({
  VM_ALREADY_RUNNING: 'the disposable VM is already running',
  VM_BUSY: 'another lifecycle operation owns the disposable VM',
  VM_HOST_UNAVAILABLE: 'host prerequisites are not ready; run npm run vm:doctor',
  VM_BASE_UNAVAILABLE: 'the verified immutable base image is unavailable',
  VM_OVERLAY_FAILED: 'the disposable overlay could not be created',
  VM_START_FAILED: 'QEMU did not start as the owned disposable VM',
  VM_START_TIMEOUT: 'the disposable VM did not open its local ports before timeout',
  VM_STOP_FAILED: 'the owned disposable VM could not be stopped',
  VM_UNSAFE_STATE: 'disposable VM state is unsafe; remove it manually',
  VM_STATE_UNAVAILABLE: 'disposable VM state is unavailable'
});

export class Product1bVmError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = 'Product1bVmError';
    this.code = code;
  }
}

function vmError(code, cause) {
  return new Product1bVmError(code, cause === undefined ? undefined : { cause });
}

function isMissing(error) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyPresent(error) {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isUnsafeOpen(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ELOOP' || error.code === 'EISDIR' || error.code === 'ENXIO')
  );
}

function instancePaths(instanceRoot) {
  return {
    owner: join(instanceRoot, OWNER_NAME),
    overlay: join(instanceRoot, OVERLAY_NAME),
    console: join(instanceRoot, 'console.sock'),
    pid: join(instanceRoot, 'qemu.pid'),
    operation: join(instanceRoot, OPERATION_LOCK_NAME)
  };
}

async function inspectInstanceRoot(instanceRoot, { create = false } = {}) {
  try {
    const stat = await lstat(instanceRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw vmError('VM_UNSAFE_STATE');
    }
    return true;
  } catch (error) {
    if (!isMissing(error)) {
      if (error instanceof Product1bVmError) throw error;
      throw vmError('VM_STATE_UNAVAILABLE', error);
    }
    if (!create) return false;
    try {
      await mkdir(instanceRoot, { recursive: true, mode: 0o700 });
      const stat = await lstat(instanceRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
        throw vmError('VM_UNSAFE_STATE');
      }
      return true;
    } catch (mkdirError) {
      if (mkdirError instanceof Product1bVmError) throw mkdirError;
      throw vmError('VM_STATE_UNAVAILABLE', mkdirError);
    }
  }
}

function validNonce(nonce) {
  return typeof nonce === 'string' && /^[a-f\d]{16}$/u.test(nonce);
}

function validateRecord(record) {
  if (
    typeof record !== 'object' ||
    record === null ||
    Array.isArray(record) ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    !validNonce(record.nonce)
  ) {
    throw vmError('VM_UNSAFE_STATE');
  }
  const keys = Object.keys(record).sort().join(',');
  if (
    record.state === 'starting' &&
    keys === 'nonce,phase,pid,schemaVersion,state' &&
    (record.phase === 'preparing' || record.phase === 'launching')
  ) {
    return record;
  }
  if (
    record.state === 'running' &&
    keys === 'apiPort,nonce,pid,schemaVersion,state' &&
    record.apiPort === VM_PORTS.api
  ) {
    return record;
  }
  throw vmError('VM_UNSAFE_STATE');
}

async function readOwnerRecord(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size <= 0 ||
      stat.size > 512 ||
      (stat.mode & 0o077) !== 0
    ) {
      throw vmError('VM_UNSAFE_STATE');
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    if (bytesRead !== bytes.byteLength) throw vmError('VM_BUSY');
    let record;
    try {
      record = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw vmError('VM_BUSY');
    }
    return validateRecord(record);
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof Product1bVmError) throw error;
    if (isUnsafeOpen(error)) throw vmError('VM_UNSAFE_STATE');
    throw vmError('VM_STATE_UNAVAILABLE', error);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

async function writeExclusiveRecord(path, record) {
  let handle;
  let created = false;
  let complete = false;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    created = true;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw vmError('VM_UNSAFE_STATE');
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
    complete = true;
  } catch (error) {
    if (error instanceof Product1bVmError || isAlreadyPresent(error)) throw error;
    throw vmError('VM_STATE_UNAVAILABLE', error);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (created && !complete) await unlink(path).catch(() => undefined);
  }
}

function validateOperationRecord(record) {
  if (
    typeof record !== 'object' ||
    record === null ||
    Array.isArray(record) ||
    Object.keys(record).sort().join(',') !== 'nonce,pid,schemaVersion' ||
    record.schemaVersion !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    !validNonce(record.nonce)
  ) {
    throw vmError('VM_UNSAFE_STATE');
  }
  return record;
}

async function readOperationRecord(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink < 1 ||
      stat.nlink > 2 ||
      stat.size <= 0 ||
      stat.size > 256 ||
      (stat.mode & 0o077) !== 0
    ) {
      throw vmError('VM_BUSY');
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    if (bytesRead !== bytes.byteLength) throw vmError('VM_BUSY');
    let record;
    try {
      record = validateOperationRecord(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if (error instanceof Product1bVmError && error.code === 'VM_UNSAFE_STATE') {
        throw vmError('VM_BUSY');
      }
      throw error;
    }
    return { record, stat };
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof Product1bVmError) throw error;
    if (isUnsafeOpen(error)) throw vmError('VM_UNSAFE_STATE');
    throw vmError('VM_STATE_UNAVAILABLE', error);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

function sameOperation(left, right) {
  return left.pid === right.pid && left.nonce === right.nonce;
}

async function recoverStaleOperation(instanceRoot, observed, recoveryNonce) {
  const { operation } = instancePaths(instanceRoot);
  const recovery = join(instanceRoot, `.operation.recovery-${recoveryNonce}`);
  try {
    await link(operation, recovery);
  } catch (error) {
    if (isAlreadyPresent(error) || isMissing(error)) throw vmError('VM_BUSY');
    throw vmError('VM_STATE_UNAVAILABLE', error);
  }
  try {
    const current = await readOperationRecord(operation);
    const claimed = await readOperationRecord(recovery);
    if (
      current === undefined ||
      claimed === undefined ||
      current.stat.dev !== observed.stat.dev ||
      current.stat.ino !== observed.stat.ino ||
      claimed.stat.dev !== observed.stat.dev ||
      claimed.stat.ino !== observed.stat.ino ||
      !sameOperation(current.record, observed.record) ||
      !sameOperation(claimed.record, observed.record)
    ) {
      throw vmError('VM_BUSY');
    }
    try {
      await unlink(operation);
    } catch (error) {
      if (isMissing(error)) throw vmError('VM_BUSY');
      throw error;
    }
  } finally {
    await unlink(recovery).catch(() => undefined);
  }
}

async function acquireOperation({
  instanceRoot,
  createRoot,
  processAlive,
  processId,
  createNonce
}) {
  const exists = await inspectInstanceRoot(instanceRoot, { create: createRoot });
  if (!exists) return undefined;
  const { operation } = instancePaths(instanceRoot);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = { schemaVersion: 1, pid: processId, nonce: createNonce() };
    try {
      await writeExclusiveRecord(operation, record);
      return { path: operation, record };
    } catch (error) {
      if (!isAlreadyPresent(error)) throw error;
      const observed = await readOperationRecord(operation);
      if (observed === undefined) continue;
      if (processAlive(observed.record.pid)) throw vmError('VM_BUSY');
      await recoverStaleOperation(instanceRoot, observed, record.nonce);
    }
  }
  throw vmError('VM_BUSY');
}

async function releaseOperation(operation) {
  if (operation === undefined) return;
  const current = await readOperationRecord(operation.path);
  if (current === undefined || !sameOperation(current.record, operation.record)) {
    throw vmError('VM_STATE_UNAVAILABLE');
  }
  await unlink(operation.path);
}

async function replaceOwnedRecord(path, expected, replacement) {
  let handle;
  try {
    handle = await open(path, constants.O_RDWR | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
      throw vmError('VM_UNSAFE_STATE');
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    const current = validateRecord(JSON.parse(bytes.subarray(0, bytesRead).toString('utf8')));
    if (current.pid !== expected.pid || current.nonce !== expected.nonce) {
      throw vmError('VM_BUSY');
    }
    await handle.truncate(0);
    await handle.writeFile(`${JSON.stringify(replacement)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    if (error instanceof Product1bVmError) throw error;
    if (isUnsafeOpen(error)) throw vmError('VM_UNSAFE_STATE');
    throw vmError('VM_STATE_UNAVAILABLE', error);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

async function unlinkOwnedFile(path) {
  try {
    const stat = await lstat(path);
    if (stat.isDirectory() && !stat.isSymbolicLink()) throw vmError('VM_UNSAFE_STATE');
    await unlink(path);
  } catch (error) {
    if (isMissing(error)) return;
    if (error instanceof Product1bVmError) throw error;
    throw vmError('VM_STATE_UNAVAILABLE', error);
  }
}

async function cleanupOwnedState(instanceRoot) {
  const paths = instancePaths(instanceRoot);
  await unlinkOwnedFile(paths.console);
  await unlinkOwnedFile(paths.pid);
  await unlinkOwnedFile(paths.overlay);
  await unlinkOwnedFile(paths.owner);
  try {
    await rmdir(instanceRoot);
  } catch (error) {
    if (
      !isMissing(error) &&
      !(error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY')
    ) {
      throw vmError('VM_STATE_UNAVAILABLE', error);
    }
  }
}

async function removeEmptyInstanceRoot(instanceRoot) {
  try {
    await rmdir(instanceRoot);
  } catch (error) {
    if (
      !isMissing(error) &&
      !(error instanceof Error && 'code' in error && error.code === 'ENOTEMPTY')
    ) {
      throw vmError('VM_STATE_UNAVAILABLE', error);
    }
  }
}

async function readQemuPid(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > 32) {
      throw vmError('VM_UNSAFE_STATE');
    }
    const bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    const value = bytes.subarray(0, bytesRead).toString('ascii').trim();
    if (!/^[1-9][0-9]*$/u.test(value)) throw vmError('VM_UNSAFE_STATE');
    const pid = Number(value);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw vmError('VM_UNSAFE_STATE');
    return pid;
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof Product1bVmError) throw error;
    if (isUnsafeOpen(error)) throw vmError('VM_UNSAFE_STATE');
    throw vmError('VM_STATE_UNAVAILABLE', error);
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

export function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

export function inspectQemuProcess(pid, nonce) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !validNonce(nonce)) return false;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    maxBuffer: 64 * 1024,
    shell: false,
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2000,
    windowsHide: true
  });
  return result.status === 0 && result.stdout.includes(`opnsense-product1b-${nonce}`);
}

export function probeLoopbackPort(host, port) {
  return new Promise((resolve) => {
    const socket = connectTls({ host, port, rejectUnauthorized: false });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('secureConnect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function runQemuImg(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    env: { PATH: process.env.PATH ?? '' },
    shell: false,
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 30_000,
    windowsHide: true
  });
  return { ok: result.status === 0 };
}

export function spawnQemu(command, arguments_) {
  const child = spawn(command, arguments_, {
    detached: true,
    env: { PATH: process.env.PATH ?? '' },
    shell: false,
    stdio: 'ignore',
    windowsHide: true
  });
  child.once('error', () => undefined);
  return child;
}

export function buildQemuArguments({ overlayPath, consolePath, pidPath, accelerator, nonce }) {
  if (!['hvf', 'kvm', 'tcg'].includes(accelerator) || !validNonce(nonce)) {
    throw vmError('VM_START_FAILED');
  }
  return [
    '-name',
    `opnsense-product1b-${nonce}`,
    '-machine',
    'q35',
    '-accel',
    accelerator === 'tcg' ? 'tcg,thread=multi' : accelerator,
    '-m',
    '4096',
    '-smp',
    '2',
    '-display',
    'none',
    '-monitor',
    'none',
    '-chardev',
    `socket,id=serial0,path=${consolePath},server=on,wait=off`,
    '-serial',
    'chardev:serial0',
    '-pidfile',
    pidPath,
    '-drive',
    `file=${overlayPath},if=virtio,format=qcow2,cache=none`,
    '-netdev',
    `user,id=lan,restrict=on,net=192.168.1.0/24,host=192.168.1.254,dhcpstart=192.168.1.100,hostfwd=tcp:127.0.0.1:${VM_PORTS.api}-192.168.1.1:443`,
    '-device',
    'virtio-net-pci,netdev=lan,mac=52:54:00:12:34:01',
    '-netdev',
    'user,id=wan,restrict=on',
    '-device',
    'virtio-net-pci,netdev=wan,mac=52:54:00:12:34:02',
    '-no-reboot'
  ];
}

async function assertImmutableRaw(rawPath) {
  try {
    const stat = await lstat(rawPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size <= 0 ||
      (stat.mode & 0o222) !== 0
    ) {
      throw vmError('VM_BASE_UNAVAILABLE');
    }
  } catch (error) {
    if (error instanceof Product1bVmError) throw error;
    throw vmError('VM_BASE_UNAVAILABLE', error);
  }
}

async function assertOverlay(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0) {
      throw vmError('VM_OVERLAY_FAILED');
    }
    await chmod(path, 0o600);
  } catch (error) {
    if (error instanceof Product1bVmError) throw error;
    throw vmError('VM_OVERLAY_FAILED', error);
  }
}

function publicRunningState() {
  return {
    state: 'running',
    api: { host: '127.0.0.1', port: VM_PORTS.api }
  };
}

async function acquireStartOwnership({
  instanceRoot,
  inspectProcess,
  processAlive,
  killProcess,
  delay,
  stopAttempts,
  stopDelayMs,
  createNonce,
  processId
}) {
  const paths = instancePaths(instanceRoot);
  const current = await readOwnerRecord(paths.owner);
  if (current !== undefined) {
    if (current.state === 'running') {
      if (await inspectProcess(current.pid, current.nonce)) {
        throw vmError('VM_ALREADY_RUNNING');
      }
    } else if (processAlive(current.pid)) {
      throw vmError('VM_BUSY');
    } else if (current.phase === 'launching') {
      const qemuPid = await readQemuPid(paths.pid);
      if (qemuPid === undefined) throw vmError('VM_BUSY');
      if (await inspectProcess(qemuPid, current.nonce)) {
        const stopped = await terminateRecord({
          record: { pid: qemuPid, nonce: current.nonce },
          inspectProcess,
          killProcess,
          delay,
          stopAttempts,
          stopDelayMs
        });
        if (!stopped) throw vmError('VM_STOP_FAILED');
      }
    }
    await cleanupOwnedState(instanceRoot);
  }
  const record = {
    schemaVersion: 1,
    state: 'starting',
    phase: 'preparing',
    pid: processId,
    nonce: createNonce()
  };
  await writeExclusiveRecord(paths.owner, record);
  return record;
}

async function terminateRecord({
  record,
  inspectProcess,
  killProcess,
  delay,
  stopAttempts,
  stopDelayMs
}) {
  if (!(await inspectProcess(record.pid, record.nonce))) return true;
  try {
    killProcess(record.pid, 'SIGTERM');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw vmError('VM_STOP_FAILED', error);
    }
  }
  for (let attempt = 0; attempt < stopAttempts; attempt += 1) {
    if (!(await inspectProcess(record.pid, record.nonce))) return true;
    await delay(stopDelayMs);
  }
  try {
    killProcess(record.pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw vmError('VM_STOP_FAILED', error);
    }
  }
  for (let attempt = 0; attempt < stopAttempts; attempt += 1) {
    if (!(await inspectProcess(record.pid, record.nonce))) return true;
    await delay(stopDelayMs);
  }
  return !(await inspectProcess(record.pid, record.nonce));
}

export async function startDisposableVm({
  instanceRoot,
  rawPath,
  accelerator,
  prepareBase,
  runImageCommand = runQemuImg,
  spawnVm = spawnQemu,
  inspectProcess = inspectQemuProcess,
  probePort = probeLoopbackPort,
  killProcess = process.kill.bind(process),
  processAlive = processIsAlive,
  delay = wait,
  createNonce = () => randomBytes(8).toString('hex'),
  processId = process.pid,
  readinessAttempts = DEFAULT_READINESS_ATTEMPTS,
  readinessDelayMs = DEFAULT_READINESS_DELAY_MS,
  stopAttempts = DEFAULT_STOP_ATTEMPTS,
  stopDelayMs = DEFAULT_STOP_DELAY_MS
}) {
  const operation = await acquireOperation({
    instanceRoot,
    createRoot: true,
    processAlive,
    processId,
    createNonce
  });
  try {
    const starting = await acquireStartOwnership({
      instanceRoot,
      inspectProcess,
      processAlive,
      killProcess,
      delay,
      stopAttempts,
      stopDelayMs,
      createNonce,
      processId
    });
    const paths = instancePaths(instanceRoot);
    let launched;
    try {
      await prepareBase();
      await assertImmutableRaw(rawPath);
      const imageResult = await runImageCommand('qemu-img', [
        'create',
        '-f',
        'qcow2',
        '-F',
        'raw',
        '-b',
        rawPath,
        paths.overlay
      ]);
      if (imageResult?.ok !== true) throw vmError('VM_OVERLAY_FAILED');
      await assertOverlay(paths.overlay);
      const launching = { ...starting, phase: 'launching' };
      await replaceOwnedRecord(paths.owner, starting, launching);
      const child = spawnVm(
        'qemu-system-x86_64',
        buildQemuArguments({
          overlayPath: paths.overlay,
          consolePath: paths.console,
          pidPath: paths.pid,
          accelerator,
          nonce: starting.nonce
        })
      );
      if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) throw vmError('VM_START_FAILED');
      child.unref?.();
      launched = { pid: child.pid, nonce: starting.nonce };
      const running = {
        schemaVersion: 1,
        state: 'running',
        ...launched,
        apiPort: VM_PORTS.api
      };
      await replaceOwnedRecord(paths.owner, launching, running);

      for (let attempt = 0; attempt < readinessAttempts; attempt += 1) {
        if (!(await inspectProcess(running.pid, running.nonce))) {
          throw vmError('VM_START_FAILED');
        }
        const apiReady = await probePort('127.0.0.1', VM_PORTS.api);
        if (apiReady) return publicRunningState();
        if (attempt + 1 < readinessAttempts) await delay(readinessDelayMs);
      }
      throw vmError('VM_START_TIMEOUT');
    } catch (error) {
      if (launched !== undefined) {
        const stopped = await terminateRecord({
          record: launched,
          inspectProcess,
          killProcess,
          delay,
          stopAttempts,
          stopDelayMs
        });
        if (!stopped) throw vmError('VM_STOP_FAILED');
      }
      await cleanupOwnedState(instanceRoot);
      if (error instanceof Product1bVmError) throw error;
      throw vmError('VM_START_FAILED', error);
    }
  } finally {
    await releaseOperation(operation);
    await removeEmptyInstanceRoot(instanceRoot);
  }
}

export async function statusDisposableVm({
  instanceRoot,
  inspectProcess = inspectQemuProcess,
  processAlive = processIsAlive,
  processId = process.pid,
  createNonce = () => randomBytes(8).toString('hex')
}) {
  if (!(await inspectInstanceRoot(instanceRoot))) return { state: 'stopped', cleaned: false };
  const operation = await acquireOperation({
    instanceRoot,
    createRoot: false,
    processAlive,
    processId,
    createNonce
  });
  if (operation === undefined) return { state: 'stopped', cleaned: false };
  try {
    const paths = instancePaths(instanceRoot);
    const record = await readOwnerRecord(paths.owner);
    if (record === undefined) return { state: 'stopped', cleaned: false };
    if (record.state === 'starting') {
      if (processAlive(record.pid)) return { state: 'starting' };
      if (record.phase === 'launching') {
        const qemuPid = await readQemuPid(paths.pid);
        if (qemuPid === undefined) return { state: 'starting' };
        if ((await inspectProcess(qemuPid, record.nonce)) || processAlive(qemuPid)) {
          return { state: 'starting' };
        }
      }
      await cleanupOwnedState(instanceRoot);
      return { state: 'stopped', cleaned: true };
    }
    if (await inspectProcess(record.pid, record.nonce)) return publicRunningState();
    await cleanupOwnedState(instanceRoot);
    return { state: 'stopped', cleaned: true };
  } finally {
    await releaseOperation(operation);
    await removeEmptyInstanceRoot(instanceRoot);
  }
}

export async function stopDisposableVm({
  instanceRoot,
  inspectProcess = inspectQemuProcess,
  processAlive = processIsAlive,
  killProcess = process.kill.bind(process),
  delay = wait,
  stopAttempts = DEFAULT_STOP_ATTEMPTS,
  stopDelayMs = DEFAULT_STOP_DELAY_MS,
  processId = process.pid,
  createNonce = () => randomBytes(8).toString('hex')
}) {
  if (!(await inspectInstanceRoot(instanceRoot))) return { state: 'stopped', cleaned: false };
  const operation = await acquireOperation({
    instanceRoot,
    createRoot: false,
    processAlive,
    processId,
    createNonce
  });
  if (operation === undefined) return { state: 'stopped', cleaned: false };
  try {
    const paths = instancePaths(instanceRoot);
    const record = await readOwnerRecord(paths.owner);
    if (record === undefined) return { state: 'stopped', cleaned: false };
    if (record.state === 'starting') {
      if (processAlive(record.pid)) throw vmError('VM_BUSY');
      if (record.phase === 'launching') {
        const qemuPid = await readQemuPid(paths.pid);
        if (qemuPid === undefined) throw vmError('VM_BUSY');
        if (await inspectProcess(qemuPid, record.nonce)) {
          const stopped = await terminateRecord({
            record: { pid: qemuPid, nonce: record.nonce },
            inspectProcess,
            killProcess,
            delay,
            stopAttempts,
            stopDelayMs
          });
          if (!stopped) throw vmError('VM_STOP_FAILED');
        }
      }
    } else {
      const stopped = await terminateRecord({
        record,
        inspectProcess,
        killProcess,
        delay,
        stopAttempts,
        stopDelayMs
      });
      if (!stopped) throw vmError('VM_STOP_FAILED');
    }
    await cleanupOwnedState(instanceRoot);
    return { state: 'stopped', cleaned: true };
  } finally {
    await releaseOperation(operation);
    await removeEmptyInstanceRoot(instanceRoot);
  }
}

export function formatVmState(state) {
  if (state.state === 'running') {
    return 'Product 1B VM: RUNNING; API https://127.0.0.1:18443\n';
  }
  if (state.state === 'starting') return 'Product 1B VM: STARTING\n';
  return 'Product 1B VM: STOPPED\n';
}

export function formatVmFailure(error) {
  const code = error instanceof Product1bVmError ? error.code : 'VM_STATE_UNAVAILABLE';
  return `Product 1B VM: FAILED; ${VM_FAILURES[code] ?? VM_FAILURES.VM_STATE_UNAVAILABLE}\n`;
}
