#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapProduct1b } from './product1b-bootstrap.mjs';
import { createConnectionArtifacts } from './product1b-connection.mjs';
import { startDisposableVm, statusDisposableVm, stopDisposableVm } from './product1b-lifecycle.mjs';
import { IMAGE_SPEC, doctorHost, prepareImage, readSecretLine } from './product1b.mjs';

const EXPECTED_TOOLS = Object.freeze(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
const COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const COMMAND_CLEANUP_TIMEOUT_MS = 2000;
const PACK_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 30_000;
const TEMPORARY_PREFIX = 'opnsense-mcp-product1b-';

function userCacheRoot() {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Caches', 'opnsense-mcp', 'product1b')
    : join(homedir(), '.cache', 'opnsense-mcp', 'product1b');
}

function emptyChecks() {
  return {
    doctor: false,
    vmStarted: false,
    bootstrap: false,
    packageInstalled: false,
    readOnlySurface: false,
    systemStatus: false,
    servicesPage: false,
    vmStopped: false,
    residueFree: false
  };
}

function summary(checks, interrupted = false, failureStage = null) {
  const passed = !interrupted && Object.values(checks).every(Boolean);
  return Object.freeze({
    schemaVersion: 1,
    status: passed ? 'passed' : 'failed',
    failureStage: passed ? null : interrupted ? 'interrupted' : failureStage,
    checks
  });
}

function killOwnedGroup(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 1) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

export function runBoundedSubprocess(
  invocation,
  { cwd, environment, input, timeoutMs, outputLimitBytes = COMMAND_OUTPUT_LIMIT_BYTES }
) {
  return new Promise((resolveCommand) => {
    let child;
    try {
      child = spawn(invocation.command, invocation.arguments, {
        cwd,
        env: environment,
        detached: process.platform !== 'win32',
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch {
      resolveCommand({ code: null, signal: null, stdout: '', stderr: '', boundedFailure: true });
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let boundedFailure = false;
    let settled = false;
    let cleanupDeadline;

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (cleanupDeadline !== undefined) clearTimeout(cleanupDeadline);
      resolveCommand({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        boundedFailure
      });
    };
    const terminate = () => {
      boundedFailure = true;
      try {
        killOwnedGroup(child);
      } catch {
        // The bounded failure remains authoritative and no child output is exposed.
      }
      cleanupDeadline ??= setTimeout(() => finish(null, 'SIGKILL'), COMMAND_CLEANUP_TIMEOUT_MS);
      cleanupDeadline.unref?.();
    };
    const capture = (target, chunk) => {
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.byteLength;
      if (outputBytes > outputLimitBytes) {
        terminate();
        return;
      }
      target.push(bytes);
    };

    child.stdout.on('data', (chunk) => capture(stdout, chunk));
    child.stderr.on('data', (chunk) => capture(stderr, chunk));
    child.once('error', terminate);
    child.once('close', (code, signal) => finish(code, signal));
    const deadline = setTimeout(terminate, timeoutMs);
    deadline.unref?.();
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

function processSucceeded(result) {
  return result.code === 0 && result.signal === null && result.boundedFailure !== true;
}

async function assertPrivateDirectory(path) {
  if (!isAbsolute(path)) throw new Error('Invalid private directory');
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Invalid private directory');
  }
}

export async function createPrivateTemporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX));
  await chmod(root, 0o700);
  await assertPrivateDirectory(root);
  return root;
}

export async function installCurrentPackage({
  repositoryRoot,
  temporaryRoot,
  nodeExecutable = process.execPath,
  npmCli = process.env.npm_execpath,
  runCommand = runBoundedSubprocess
}) {
  if (typeof npmCli !== 'string' || npmCli.length === 0) throw new Error('npm unavailable');
  await assertPrivateDirectory(temporaryRoot);
  const consumer = join(temporaryRoot, 'consumer');
  await mkdir(consumer, { mode: 0o700 });
  const environment = process.env;
  const packed = await runCommand(
    {
      command: nodeExecutable,
      arguments: [npmCli, 'pack', '--json', '--pack-destination', temporaryRoot]
    },
    {
      cwd: repositoryRoot,
      environment,
      input: '',
      timeoutMs: PACK_TIMEOUT_MS
    }
  );
  if (!processSucceeded(packed)) throw new Error('Package failed');

  const archives = (await readdir(temporaryRoot, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.tgz')
  );
  if (archives.length !== 1 || basename(archives[0].name) !== archives[0].name) {
    throw new Error('Package failed');
  }
  const archive = join(temporaryRoot, archives[0].name);
  await writeFile(join(consumer, 'package.json'), '{"private":true}\n', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600
  });
  const installed = await runCommand(
    {
      command: nodeExecutable,
      arguments: [
        npmCli,
        'install',
        '--ignore-scripts',
        '--offline',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--no-save',
        archive
      ]
    },
    {
      cwd: consumer,
      environment,
      input: '',
      timeoutMs: INSTALL_TIMEOUT_MS
    }
  );
  if (!processSucceeded(installed)) throw new Error('Install failed');
  return Object.freeze({
    command: join(consumer, 'node_modules', '.bin', 'opnsense-mcp'),
    arguments: Object.freeze([])
  });
}

function readRequests() {
  return [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'product1b-live', version: '0.1.0' }
      }
    },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'opn_get', arguments: { resource: 'system.status' } }
    },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'opn_list',
        arguments: { resource: 'core.services', page: 1, pageSize: 10, query: '' }
      }
    }
  ];
}

export async function runInstalledReads({
  invocation,
  configPath,
  runCommand = runBoundedSubprocess
}) {
  const input = `${readRequests()
    .map((request) => JSON.stringify(request))
    .join('\n')}\n`;
  return runCommand(invocation, {
    cwd: resolve('.'),
    environment: {
      PATH: process.env.PATH ?? '',
      READ_ONLY: 'true',
      OPNSENSE_CONFIG_FILE: configPath,
      MCP_REQUEST_STATE_SECRET: randomBytes(32).toString('base64url')
    },
    input,
    timeoutMs: READ_TIMEOUT_MS
  });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function successfulToolResult(response) {
  return (
    isRecord(response) &&
    !Object.hasOwn(response, 'error') &&
    isRecord(response.result) &&
    response.result.isError !== true &&
    isRecord(response.result.structuredContent)
  );
}

export function inspectReadResult(result) {
  const checks = { readOnlySurface: false, systemStatus: false, servicesPage: false };
  if (!processSucceeded(result) || result.stderr !== '') return checks;
  let responses;
  try {
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    responses = lines.map((line) => JSON.parse(line));
  } catch {
    return checks;
  }
  if (
    responses.length !== 4 ||
    responses.some((response) => !isRecord(response) || response.jsonrpc !== '2.0')
  ) {
    return checks;
  }
  const byId = new Map(responses.map((response) => [response.id, response]));
  if (byId.size !== 4 || !isRecord(byId.get(1)?.result)) return checks;

  const listed = byId.get(2)?.result?.tools;
  if (Array.isArray(listed) && listed.length === EXPECTED_TOOLS.length) {
    const names = listed.map((tool) => (isRecord(tool) ? tool.name : undefined)).sort();
    checks.readOnlySurface =
      JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()) &&
      listed.every(
        (tool) =>
          isRecord(tool) && isRecord(tool.annotations) && tool.annotations.readOnlyHint === true
      );
  }

  const statusResponse = byId.get(3);
  if (successfulToolResult(statusResponse)) {
    const status = statusResponse.result.structuredContent.item?.status;
    checks.systemStatus = typeof status === 'string' && status.trim().length > 0;
  }

  const servicesResponse = byId.get(4);
  if (successfulToolResult(servicesResponse)) {
    const page = servicesResponse.result.structuredContent;
    checks.servicesPage =
      page.page === 1 &&
      page.pageSize === 10 &&
      Number.isSafeInteger(page.total) &&
      page.total >= 0 &&
      Array.isArray(page.items) &&
      page.items.length <= page.pageSize &&
      page.items.every(
        (item) =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.name === 'string' &&
          item.name.length > 0 &&
          typeof item.description === 'string' &&
          typeof item.status === 'string' &&
          item.status.length > 0
      );
  }
  return checks;
}

export async function removePrivateTemporaryRoot(path) {
  if (
    !isAbsolute(path) ||
    join(tmpdir(), basename(path)) !== path ||
    !basename(path).startsWith(TEMPORARY_PREFIX)
  ) {
    throw new Error('Invalid temporary directory');
  }
  await rm(path, { recursive: true, force: true });
}

async function isAbsent(path) {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
  }
}

export async function verifyProduct1bResidue({ instanceRoot, temporaryRoot }) {
  if (!(await isAbsent(instanceRoot))) return false;
  return temporaryRoot === undefined || (await isAbsent(temporaryRoot));
}

export async function runProduct1bLive(options = {}) {
  const cacheRoot = options.cacheRoot ?? userCacheRoot();
  const instanceRoot = options.instanceRoot ?? join(cacheRoot, 'instance');
  const repositoryRoot = options.repositoryRoot ?? resolve('.');
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const signalSource = options.signalSource ?? process;
  const interruption = new AbortController();
  const doctor = options.doctor ?? doctorHost;
  const statusVm = options.statusVm ?? statusDisposableVm;
  const prepareBase = options.prepareBase ?? (() => prepareImage({ cacheRoot }));
  const startVm = options.startVm ?? startDisposableVm;
  const stopVm = options.stopVm ?? stopDisposableVm;
  const readPassword =
    options.readPassword ??
    (() =>
      readSecretLine({
        input: options.input ?? process.stdin,
        output: stderr,
        signal: interruption.signal
      }));
  const bootstrap = options.bootstrap ?? bootstrapProduct1b;
  const createArtifacts = options.createArtifacts ?? createConnectionArtifacts;
  const createTemporaryRoot = options.createTemporaryRoot ?? createPrivateTemporaryRoot;
  const installPackage = options.installPackage ?? installCurrentPackage;
  const runInstalled = options.runInstalled ?? runInstalledReads;
  const removeTemporaryRoot = options.removeTemporaryRoot ?? removePrivateTemporaryRoot;
  const verifyResidue = options.verifyResidue ?? verifyProduct1bResidue;
  const checks = emptyChecks();
  let ownedVm = false;
  let temporaryRoot;
  let cleanupFailed = false;
  let interrupted = false;
  let failureStage = 'doctor';
  const interrupt = () => {
    interrupted = true;
    interruption.abort();
  };
  const throwIfInterrupted = () => {
    if (interrupted) throw new Error('Interrupted');
  };

  signalSource.on('SIGINT', interrupt);
  signalSource.on('SIGTERM', interrupt);

  try {
    try {
      const report = doctor();
      checks.doctor = report?.ready === true;
      if (!checks.doctor) throw new Error('Doctor failed');
      throwIfInterrupted();
      failureStage = 'preflight';
      const initialState = await statusVm({ instanceRoot });
      if (initialState?.state !== 'stopped') throw new Error('VM is not fresh');
      throwIfInterrupted();
      failureStage = 'vm-start';
      const started = await startVm({
        instanceRoot,
        rawPath: join(cacheRoot, IMAGE_SPEC.rawName),
        accelerator: report.accelerator,
        prepareBase
      });
      checks.vmStarted = started?.state === 'running';
      if (!checks.vmStarted) throw new Error('VM start failed');
      ownedVm = true;
      throwIfInterrupted();

      failureStage = 'password';
      const factoryPassword = await readPassword();
      throwIfInterrupted();
      failureStage = 'bootstrap';
      const credentials = await bootstrap({
        consolePath: join(instanceRoot, 'console.sock'),
        factoryPassword
      });
      throwIfInterrupted();
      failureStage = 'connection';
      const artifacts = await createArtifacts({ instanceRoot, credentials });
      checks.bootstrap = true;
      throwIfInterrupted();

      failureStage = 'package';
      temporaryRoot = await createTemporaryRoot();
      throwIfInterrupted();
      const invocation = await installPackage({ repositoryRoot, temporaryRoot });
      checks.packageInstalled = true;
      throwIfInterrupted();
      failureStage = 'reads';
      const readChecks = inspectReadResult(
        await runInstalled({ invocation, configPath: artifacts.configPath })
      );
      Object.assign(checks, readChecks);
      if (Object.values(readChecks).every(Boolean)) failureStage = null;
    } catch {
      // The final summary contains only fixed booleans; raw process, VM and firewall data stay private.
    } finally {
      if (ownedVm) {
        try {
          const stopped = await stopVm({ instanceRoot });
          checks.vmStopped = stopped?.state === 'stopped';
          if (!checks.vmStopped) failureStage = 'cleanup';
        } catch {
          checks.vmStopped = false;
          failureStage = 'cleanup';
        }
      }
      try {
        if (temporaryRoot !== undefined) await removeTemporaryRoot(temporaryRoot);
      } catch {
        cleanupFailed = true;
        failureStage = 'cleanup';
      }
      try {
        checks.residueFree =
          !cleanupFailed && (await verifyResidue({ instanceRoot, temporaryRoot })) === true;
      } catch {
        checks.residueFree = false;
      }
      if (!checks.residueFree) failureStage = 'cleanup';
    }

    const result = summary(checks, interrupted, failureStage);
    stdout.write(`${JSON.stringify(result)}\n`);
    if (interrupted) return 3;
    return result.status === 'passed' ? 0 : 2;
  } finally {
    signalSource.off('SIGINT', interrupt);
    signalSource.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runProduct1bLive().then((code) => {
    process.exitCode = code;
  });
}
