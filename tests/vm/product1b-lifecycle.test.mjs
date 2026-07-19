// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  chmod,
  mkdir,
  lstat,
  unlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { generate } from 'selfsigned';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Product1bVmError,
  VM_PORTS,
  buildQemuArguments,
  formatVmFailure,
  formatVmState,
  probeLoopbackPort,
  startDisposableVm,
  statusDisposableVm,
  stopDisposableVm
} from '../../scripts/vm/product1b-lifecycle.mjs';

const roots = [];
const NONCE = '0123456789abcdef';

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'opnsense-product1b-vm-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function expectVmError(promise, code) {
  try {
    await promise;
    throw new Error('expected VM operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(Product1bVmError);
    expect(error.code).toBe(code);
    return error;
  }
}

async function fixturePaths() {
  const root = await temporaryRoot();
  const instanceRoot = join(root, 'instance');
  const rawPath = join(root, 'verified-base.img');
  await writeFile(rawPath, 'immutable raw');
  await chmod(rawPath, 0o444);
  return { root, instanceRoot, rawPath };
}

function happyDependencies({ alive = true, childPid = 4242 } = {}) {
  const calls = { image: [], vm: [], probes: [], kills: [] };
  const child = { pid: childPid, unref: vi.fn() };
  return {
    calls,
    child,
    prepareBase: vi.fn(),
    runImageCommand: vi.fn(async (command, arguments_) => {
      calls.image.push([command, arguments_]);
      await writeFile(arguments_.at(-1), 'qcow2 overlay');
      return { ok: true };
    }),
    spawnVm: vi.fn((command, arguments_) => {
      calls.vm.push([command, arguments_]);
      return child;
    }),
    inspectProcess: vi.fn(async (pid, nonce) => alive && pid === childPid && nonce === NONCE),
    processAlive: vi.fn((pid) => pid === 111),
    probePort: vi.fn(async (host, port) => {
      calls.probes.push([host, port]);
      return true;
    }),
    killProcess: vi.fn((pid, signal) => calls.kills.push([pid, signal])),
    delay: vi.fn(async () => undefined),
    createNonce: () => NONCE,
    processId: 111
  };
}

async function writeRunningInstance(instanceRoot, { pid = 4242, nonce = NONCE } = {}) {
  await mkdir(instanceRoot, { recursive: true, mode: 0o700 });
  await writeFile(
    join(instanceRoot, 'owner.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      state: 'running',
      pid,
      nonce,
      apiPort: VM_PORTS.api
    })}\n`,
    { mode: 0o600 }
  );
  await writeFile(join(instanceRoot, 'overlay.qcow2'), 'overlay', { mode: 0o600 });
  await writeFile(join(instanceRoot, 'console.sock'), 'socket', { mode: 0o600 });
  await writeFile(join(instanceRoot, 'qemu.pid'), `${pid}\n`, { mode: 0o600 });
}

async function writeLaunchingInstance(
  instanceRoot,
  { launcherPid = 31337, qemuPid = 4242, nonce = 'fedcba9876543210' } = {}
) {
  await mkdir(instanceRoot, { recursive: true, mode: 0o700 });
  await writeFile(
    join(instanceRoot, 'owner.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      state: 'starting',
      phase: 'launching',
      pid: launcherPid,
      nonce
    })}\n`,
    { mode: 0o600 }
  );
  await writeFile(join(instanceRoot, 'overlay.qcow2'), 'orphan overlay', { mode: 0o600 });
  await writeFile(join(instanceRoot, 'console.sock'), 'orphan socket', { mode: 0o600 });
  await writeFile(join(instanceRoot, 'qemu.pid'), `${qemuPid}\n`, { mode: 0o600 });
}

describe('Product 1B disposable VM lifecycle', () => {
  it('requires a TLS-ready guest instead of accepting QEMU host forwarding alone', async () => {
    const forwardedSockets = new Set();
    const forwarded = createTcpServer((socket) => {
      forwardedSockets.add(socket);
      socket.once('close', () => forwardedSockets.delete(socket));
    });
    forwarded.listen(0, '127.0.0.1');
    await once(forwarded, 'listening');
    const forwardedAddress = forwarded.address();
    if (forwardedAddress === null || typeof forwardedAddress === 'string') {
      throw new Error('TCP fixture did not bind');
    }
    await expect(probeLoopbackPort('127.0.0.1', forwardedAddress.port)).resolves.toBe(false);
    for (const socket of forwardedSockets) socket.destroy();
    await new Promise((resolve) => forwarded.close(resolve));

    const certificate = await generate([{ name: 'commonName', value: 'localhost' }], {
      algorithm: 'sha256',
      keyType: 'ec'
    });
    const webGui = createTlsServer({ key: certificate.private, cert: certificate.cert });
    const webGuiSockets = new Set();
    webGui.on('connection', (socket) => {
      webGuiSockets.add(socket);
      socket.once('close', () => webGuiSockets.delete(socket));
    });
    webGui.listen(0, '127.0.0.1');
    await once(webGui, 'listening');
    const webGuiAddress = webGui.address();
    if (webGuiAddress === null || typeof webGuiAddress === 'string') {
      throw new Error('TLS fixture did not bind');
    }
    await expect(probeLoopbackPort('127.0.0.1', webGuiAddress.port)).resolves.toBe(true);
    for (const socket of webGuiSockets) socket.destroy();
    await new Promise((resolve) => webGui.close(resolve));
  });

  it('wires explicit start, status, and stop package commands', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    );

    expect(packageJson.scripts['vm:start']).toBe('node scripts/vm/product1b.mjs start');
    expect(packageJson.scripts['vm:status']).toBe('node scripts/vm/product1b.mjs status');
    expect(packageJson.scripts['vm:stop']).toBe('node scripts/vm/product1b.mjs stop');
  });

  it('builds one qcow2 overlay and starts QEMU with loopback-only deterministic forwards', async () => {
    const { instanceRoot, rawPath } = await fixturePaths();
    const dependencies = happyDependencies();

    const result = await startDisposableVm({
      instanceRoot,
      rawPath,
      accelerator: 'tcg',
      ...dependencies,
      readinessAttempts: 1,
      readinessDelayMs: 0
    });

    expect(result).toEqual({
      state: 'running',
      api: { host: '127.0.0.1', port: 18443 }
    });
    expect(dependencies.prepareBase).toHaveBeenCalledOnce();
    expect(dependencies.calls.image).toEqual([
      [
        'qemu-img',
        ['create', '-f', 'qcow2', '-F', 'raw', '-b', rawPath, join(instanceRoot, 'overlay.qcow2')]
      ]
    ]);
    expect(dependencies.calls.vm).toEqual([
      [
        'qemu-system-x86_64',
        buildQemuArguments({
          overlayPath: join(instanceRoot, 'overlay.qcow2'),
          consolePath: join(instanceRoot, 'console.sock'),
          pidPath: join(instanceRoot, 'qemu.pid'),
          accelerator: 'tcg',
          nonce: NONCE
        })
      ]
    ]);
    const qemuArguments = dependencies.calls.vm[0][1];
    expect(qemuArguments).toContain('tcg,thread=multi');
    expect(qemuArguments).toContain('4096');
    expect(qemuArguments).toContain(
      'socket,id=serial0,path=' + join(instanceRoot, 'console.sock') + ',server=on,wait=off'
    );
    expect(qemuArguments).toContain('chardev:serial0');
    expect(qemuArguments).toContain(join(instanceRoot, 'qemu.pid'));
    expect(qemuArguments.join(' ')).not.toContain('logfile=');
    expect(qemuArguments.join(' ')).not.toContain('-serial file:');
    expect(qemuArguments).toContain(
      'user,id=lan,restrict=on,net=192.168.1.0/24,host=192.168.1.254,dhcpstart=192.168.1.100,hostfwd=tcp:127.0.0.1:18443-192.168.1.1:443'
    );
    expect(qemuArguments).toContain('user,id=wan,restrict=on');
    expect(qemuArguments).toContain('virtio-net-pci,netdev=lan,mac=52:54:00:12:34:01');
    expect(qemuArguments).toContain('virtio-net-pci,netdev=wan,mac=52:54:00:12:34:02');
    expect(qemuArguments.join(' ')).not.toContain('0.0.0.0');
    expect(dependencies.calls.probes).toEqual([['127.0.0.1', 18443]]);
    expect(dependencies.child.unref).toHaveBeenCalledOnce();
    const owner = JSON.parse(await readFile(join(instanceRoot, 'owner.json'), 'utf8'));
    expect(owner).toEqual({
      schemaVersion: 1,
      state: 'running',
      pid: 4242,
      nonce: NONCE,
      apiPort: 18443
    });
    expect((await lstat(join(instanceRoot, 'owner.json'))).mode & 0o077).toBe(0);
    expect(formatVmState(result)).toBe('Product 1B VM: RUNNING; API https://127.0.0.1:18443\n');
  });

  it('refuses a concurrent start while the first owner is still preparing the base', async () => {
    const { instanceRoot, rawPath } = await fixturePaths();
    let releasePreparation;
    let announcePreparation;
    const preparationStarted = new Promise((resolve) => {
      announcePreparation = resolve;
    });
    const firstDependencies = happyDependencies();
    firstDependencies.prepareBase = async () => {
      announcePreparation();
      await new Promise((resolve) => {
        releasePreparation = resolve;
      });
    };
    const first = startDisposableVm({
      instanceRoot,
      rawPath,
      accelerator: 'tcg',
      ...firstDependencies,
      readinessAttempts: 1,
      readinessDelayMs: 0
    });
    await preparationStarted;

    const competing = await expectVmError(
      startDisposableVm({
        instanceRoot,
        rawPath,
        accelerator: 'tcg',
        ...happyDependencies(),
        readinessAttempts: 1,
        readinessDelayMs: 0
      }),
      'VM_BUSY'
    );
    expect(formatVmFailure(competing)).toBe(
      'Product 1B VM: FAILED; another lifecycle operation owns the disposable VM\n'
    );

    releasePreparation();
    await expect(first).resolves.toMatchObject({ state: 'running' });
  });

  it('bounds readiness, terminates only the owned QEMU process, and removes failed-start residue', async () => {
    const { instanceRoot, rawPath } = await fixturePaths();
    let alive = true;
    const dependencies = happyDependencies();
    dependencies.probePort = vi.fn(async () => false);
    dependencies.inspectProcess = vi.fn(
      async (pid, nonce) => alive && pid === 4242 && nonce === NONCE
    );
    dependencies.killProcess = vi.fn((pid, signal) => {
      dependencies.calls.kills.push([pid, signal]);
      alive = false;
    });

    await expectVmError(
      startDisposableVm({
        instanceRoot,
        rawPath,
        accelerator: 'tcg',
        ...dependencies,
        readinessAttempts: 2,
        readinessDelayMs: 0,
        stopAttempts: 1,
        stopDelayMs: 0
      }),
      'VM_START_TIMEOUT'
    );

    expect(dependencies.calls.kills).toEqual([[4242, 'SIGTERM']]);
    await expect(readdir(instanceRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes two starts recovering one dead owner without deleting the new instance', async () => {
    const { instanceRoot, rawPath } = await fixturePaths();
    await writeRunningInstance(instanceRoot, { pid: 31337, nonce: 'fedcba9876543210' });
    await writeFile(join(instanceRoot, 'keep.me'), 'unrelated sentinel');
    let releasePreparation;
    let announcePreparation;
    const preparationStarted = new Promise((resolve) => {
      announcePreparation = resolve;
    });
    const firstDependencies = happyDependencies();
    firstDependencies.prepareBase = async () => {
      announcePreparation();
      await new Promise((resolve) => {
        releasePreparation = resolve;
      });
    };
    firstDependencies.inspectProcess = vi.fn(async (pid, nonce) => pid === 4242 && nonce === NONCE);

    const first = startDisposableVm({
      instanceRoot,
      rawPath,
      accelerator: 'tcg',
      ...firstDependencies,
      readinessAttempts: 1,
      readinessDelayMs: 0
    });
    await preparationStarted;
    await expect(lstat(join(instanceRoot, '.operation.lock'))).resolves.toMatchObject({
      mode: expect.any(Number)
    });

    const second = await expectVmError(
      startDisposableVm({
        instanceRoot,
        rawPath,
        accelerator: 'tcg',
        ...happyDependencies({ childPid: 5000 }),
        readinessAttempts: 1,
        readinessDelayMs: 0
      }),
      'VM_BUSY'
    );
    expect(formatVmFailure(second)).toContain('another lifecycle operation');

    releasePreparation();
    await expect(first).resolves.toMatchObject({ state: 'running' });

    expect(await readFile(join(instanceRoot, 'keep.me'), 'utf8')).toBe('unrelated sentinel');
    expect(await readFile(join(instanceRoot, 'overlay.qcow2'), 'utf8')).toBe('qcow2 overlay');
    await expect(lstat(join(instanceRoot, 'owner.json'))).resolves.toMatchObject({
      mode: expect.any(Number)
    });
    await expect(lstat(join(instanceRoot, '.operation.lock'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
    expect(firstDependencies.killProcess).not.toHaveBeenCalled();
  });

  it('stops a pidfile-identified orphan left between spawn and owner promotion before restarting', async () => {
    const { instanceRoot, rawPath } = await fixturePaths();
    const orphanNonce = 'fedcba9876543210';
    await writeLaunchingInstance(instanceRoot, { qemuPid: 4242, nonce: orphanNonce });
    const dependencies = happyDependencies({ childPid: 5000 });
    const live = new Map([
      [4242, orphanNonce],
      [5000, NONCE]
    ]);
    dependencies.inspectProcess = vi.fn(async (pid, nonce) => live.get(pid) === nonce);
    dependencies.killProcess = vi.fn((pid, signal) => {
      dependencies.calls.kills.push([pid, signal]);
      live.delete(pid);
    });

    await expect(
      startDisposableVm({
        instanceRoot,
        rawPath,
        accelerator: 'tcg',
        ...dependencies,
        readinessAttempts: 1,
        readinessDelayMs: 0,
        stopAttempts: 1,
        stopDelayMs: 0
      })
    ).resolves.toMatchObject({ state: 'running' });

    expect(dependencies.calls.kills).toContainEqual([4242, 'SIGTERM']);
    const owner = JSON.parse(await readFile(join(instanceRoot, 'owner.json'), 'utf8'));
    expect(owner).toMatchObject({ state: 'running', pid: 5000, nonce: NONCE });
    expect(await readFile(join(instanceRoot, 'overlay.qcow2'), 'utf8')).toBe('qcow2 overlay');
  });

  it('keeps an ambiguous launching instance when QEMU has not published its pidfile yet', async () => {
    const { instanceRoot, rawPath } = await fixturePaths();
    await writeLaunchingInstance(instanceRoot);
    await unlink(join(instanceRoot, 'qemu.pid'));
    const dependencies = happyDependencies({ childPid: 5000 });

    await expectVmError(
      startDisposableVm({
        instanceRoot,
        rawPath,
        accelerator: 'tcg',
        ...dependencies,
        readinessAttempts: 1,
        readinessDelayMs: 0
      }),
      'VM_BUSY'
    );

    expect(dependencies.spawnVm).not.toHaveBeenCalled();
    expect(dependencies.killProcess).not.toHaveBeenCalled();
    expect(await readFile(join(instanceRoot, 'overlay.qcow2'), 'utf8')).toBe('orphan overlay');
    await expect(lstat(join(instanceRoot, 'owner.json'))).resolves.toMatchObject({
      mode: expect.any(Number)
    });
  });

  it('never signals a reused or forged PID whose QEMU identity marker does not match', async () => {
    const { instanceRoot } = await fixturePaths();
    await writeRunningInstance(instanceRoot, { pid: 9999, nonce: 'fedcba9876543210' });
    await writeFile(join(instanceRoot, 'keep.me'), 'unrelated sentinel');
    const killProcess = vi.fn();

    const result = await stopDisposableVm({
      instanceRoot,
      inspectProcess: vi.fn(async () => false),
      killProcess,
      delay: vi.fn(async () => undefined),
      stopAttempts: 1,
      stopDelayMs: 0
    });

    expect(result).toEqual({ state: 'stopped', cleaned: true });
    expect(killProcess).not.toHaveBeenCalled();
    expect(await readdir(instanceRoot)).toEqual(['keep.me']);
  });

  it('reports status and stops a matching process before cleaning its disposable files', async () => {
    const { instanceRoot } = await fixturePaths();
    await writeRunningInstance(instanceRoot);
    let alive = true;
    const inspectProcess = vi.fn(async (pid, nonce) => alive && pid === 4242 && nonce === NONCE);
    const killProcess = vi.fn((_pid, signal) => {
      expect(signal).toBe('SIGTERM');
      alive = false;
    });

    await expect(statusDisposableVm({ instanceRoot, inspectProcess })).resolves.toEqual({
      state: 'running',
      api: { host: '127.0.0.1', port: 18443 }
    });
    await expect(
      stopDisposableVm({
        instanceRoot,
        inspectProcess,
        killProcess,
        delay: vi.fn(async () => undefined),
        stopAttempts: 1,
        stopDelayMs: 0
      })
    ).resolves.toEqual({ state: 'stopped', cleaned: true });
    expect(killProcess).toHaveBeenCalledWith(4242, 'SIGTERM');
    await expect(readdir(instanceRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses unsafe instance paths and keeps CLI failures free of paths and secrets', async () => {
    const root = await temporaryRoot();
    const outside = join(root, 'outside');
    const instanceRoot = join(root, 'instance');
    await mkdir(outside);
    await writeFile(join(outside, 'sentinel'), 'PRODUCT1B_SECRET_SENTINEL');
    await symlink(outside, instanceRoot);

    const error = await expectVmError(
      statusDisposableVm({ instanceRoot, inspectProcess: vi.fn() }),
      'VM_UNSAFE_STATE'
    );
    const output = formatVmFailure(error);
    expect(output).toBe(
      'Product 1B VM: FAILED; disposable VM state is unsafe; remove it manually\n'
    );
    expect(output).not.toContain(root);
    expect(output).not.toContain('SECRET');
    expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('PRODUCT1B_SECRET_SENTINEL');
  });
});
