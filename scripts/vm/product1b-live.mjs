#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
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
const PROCESS_CLOSE_TIMEOUT_MS = 10_000;
const TEMPORARY_PREFIX = 'opnsense-mcp-product1b-';
const MCP_CLIENT_VERSION = '0.1.0';
const EXPECTED_SYSTEM_STATUS_DESCRIPTION = {
  mode: 'resource',
  resource: {
    key: 'system.status',
    label: 'System status',
    category: 'System',
    description: 'Read the bounded health status reported by the OPNsense system API.',
    requiredPlugin: null,
    requiredFeatures: [],
    operations: [
      {
        name: 'get',
        effect: 'read',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: [],
          properties: {}
        },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['item'],
          properties: {
            item: {
              type: 'object',
              additionalProperties: false,
              required: ['status'],
              properties: {
                status: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 64
                }
              }
            }
          }
        },
        inputSchemaDigest: 'd746974fa9afd5e951f76f9af38954b0ad7f436f2120dc974da65e5ee39f856f',
        outputSchemaDigest: '11e1bc49417ca3079e04578cc82bb0a52b44dda433c678e444817591b8e7651f'
      }
    ],
    contractDigest: '23946c5283a23e8952ee39049285b255d0ab5ad06d1c7cd41f28baccb32e85da'
  }
};

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
    serverStatus: false,
    resourceDescription: false,
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

function installedReadEnvironment(configPath) {
  return Object.freeze({
    PATH: process.env.PATH ?? '',
    READ_ONLY: 'true',
    OPNSENSE_CONFIG_FILE: configPath,
    MCP_REQUEST_STATE_SECRET: randomBytes(32).toString('base64url')
  });
}

const DEFAULT_SDK_FACTORIES = Object.freeze({
  createTransport: (options) => new StdioClientTransport(options),
  createClient: (clientInfo, options) => new Client(clientInfo, options)
});

/*
 * Pinned SDK boundary: StdioClientTransport exposes only `pid` publicly, while this runner must
 * retain the exact ChildProcess to verify its exit code and signal. Keep the private access here,
 * validate the runtime shape fail-closed, and revisit it whenever the pinned SDK is upgraded.
 */
function pinnedStdioChildProcess(transport) {
  const child = isRecord(transport) ? transport._process : undefined;
  if (
    !isRecord(child) ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 0 ||
    typeof child.once !== 'function' ||
    typeof child.off !== 'function' ||
    !(child.exitCode === null || Number.isSafeInteger(child.exitCode)) ||
    !(child.signalCode === null || typeof child.signalCode === 'string')
  ) {
    throw new Error('Installed read failed');
  }
  return child;
}

function observeProcessClose(child) {
  return new Promise((resolveClose) => {
    child.once('close', (code, signal) => {
      resolveClose(Object.freeze({ code, signal }));
    });
  });
}

async function waitForProcessClose(closeSettlement) {
  if (closeSettlement === undefined) throw new Error('Installed read failed');
  let timeout;
  try {
    return await Promise.race([
      closeSettlement,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Installed read failed')),
          PROCESS_CLOSE_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function openSdkClient({
  invocation,
  environment,
  signal,
  sdkFactories = DEFAULT_SDK_FACTORIES
}) {
  const transport = sdkFactories.createTransport({
    command: invocation.command,
    args: [...invocation.arguments],
    cwd: resolve('.'),
    env: environment,
    stderr: 'pipe',
    maxBufferSize: COMMAND_OUTPUT_LIMIT_BYTES
  });
  const client = sdkFactories.createClient(
    { name: 'product1b-live', version: MCP_CLIENT_VERSION },
    {
      capabilities: {},
      enforceStrictCapabilities: true,
      versionNegotiation: { mode: 'legacy' }
    }
  );
  let stderrBytes = 0;
  let stderrOverflow = false;
  let stderrFailed = transport.stderr === null;
  let processCloseSettlement;
  const removeStderrListeners = () => {
    transport.stderr?.off('data', observeStderr);
    transport.stderr?.off('error', observeStderrFailure);
  };
  const originalStart = transport.start.bind(transport);
  transport.start = async () => {
    await originalStart();
    const child = pinnedStdioChildProcess(transport);
    processCloseSettlement = observeProcessClose(child);
    void processCloseSettlement.then(removeStderrListeners);
  };
  const originalTransportClose = transport.close.bind(transport);
  let transportCloseSettlement;
  transport.close = () => {
    transportCloseSettlement ??= Promise.resolve().then(originalTransportClose);
    return transportCloseSettlement;
  };
  let closeSettlement;
  const closeClient = () => {
    closeSettlement ??= Promise.resolve().then(() => client.close());
    return closeSettlement;
  };
  const observeStderr = (chunk) => {
    if (stderrOverflow) return;
    try {
      stderrBytes = Math.min(
        COMMAND_OUTPUT_LIMIT_BYTES + 1,
        stderrBytes + Buffer.byteLength(chunk)
      );
    } catch {
      stderrFailed = true;
    }
    if (stderrBytes > COMMAND_OUTPUT_LIMIT_BYTES || stderrFailed) {
      stderrOverflow = true;
      void closeClient().catch(() => undefined);
    }
  };
  const observeStderrFailure = () => {
    stderrFailed = true;
    void closeClient().catch(() => undefined);
  };
  transport.stderr?.on('data', observeStderr);
  transport.stderr?.once('error', observeStderrFailure);
  const abort = () => {
    void closeClient().catch(() => undefined);
  };
  const closeAndInspectProcess = async () => {
    let closeFailed = false;
    try {
      await closeClient();
    } catch {
      closeFailed = true;
    }
    let processOutcome;
    try {
      processOutcome = await waitForProcessClose(processCloseSettlement);
    } catch {
      closeFailed = true;
    }
    return (
      !closeFailed &&
      processOutcome !== undefined &&
      processOutcome.code === 0 &&
      processOutcome.signal === null
    );
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport, {
      signal,
      timeout: READ_TIMEOUT_MS,
      maxTotalTimeout: READ_TIMEOUT_MS
    });
    if (signal.aborted) throw new Error('Installed read failed');
  } catch {
    signal.removeEventListener('abort', abort);
    await closeAndInspectProcess();
    throw new Error('Installed read failed');
  }
  const requestOptions = Object.freeze({
    signal,
    timeout: READ_TIMEOUT_MS,
    maxTotalTimeout: READ_TIMEOUT_MS
  });
  return Object.freeze({
    listTools: () => client.listTools(undefined, requestOptions),
    callTool: (request) => client.callTool(request, requestOptions),
    diagnosticsClean: () => stderrBytes === 0 && !stderrOverflow && !stderrFailed,
    close: async () => {
      signal.removeEventListener('abort', abort);
      if (!(await closeAndInspectProcess())) throw new Error('Installed read failed');
    }
  });
}

export async function runInstalledReads({
  invocation,
  configPath,
  signal = new AbortController().signal,
  openClient = openSdkClient,
  sdkFactories
}) {
  const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]);
  if (operationSignal.aborted) throw new Error('Installed read failed');
  let client;
  try {
    client = await openClient({
      invocation,
      environment: installedReadEnvironment(configPath),
      signal: operationSignal,
      ...(sdkFactories === undefined ? {} : { sdkFactories })
    });
  } catch {
    throw new Error('Installed read failed');
  }

  let result;
  let failed = false;
  try {
    result = {
      tools: await client.listTools(),
      serverStatus: await client.callTool({ name: 'server_status', arguments: {} }),
      resourceDescription: await client.callTool({
        name: 'opn_describe',
        arguments: { resource: 'system.status' }
      }),
      systemStatus: await client.callTool({
        name: 'opn_get',
        arguments: { resource: 'system.status' }
      }),
      servicesPage: await client.callTool({
        name: 'opn_list',
        arguments: { resource: 'core.services', page: 1, pageSize: 10, query: '' }
      })
    };
  } catch {
    failed = true;
  }
  try {
    await client.close();
  } catch {
    failed = true;
  }
  if (operationSignal.aborted) failed = true;
  try {
    if (client.diagnosticsClean() !== true) failed = true;
  } catch {
    failed = true;
  }
  if (failed || result === undefined) throw new Error('Installed read failed');
  return Object.freeze(result);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function successfulToolResult(response) {
  const structuredContent = isRecord(response) ? response.structuredContent : undefined;
  const content = isRecord(response) ? response.content : undefined;
  return (
    isRecord(response) &&
    response.isError !== true &&
    isRecord(structuredContent) &&
    Array.isArray(content) &&
    content.length === 1 &&
    exactKeys(content[0], ['type', 'text']) &&
    content[0].type === 'text' &&
    content[0].text === JSON.stringify(structuredContent)
  );
}

function boundedString(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function exactKeys(record, keys) {
  return (
    isRecord(record) &&
    JSON.stringify(Object.keys(record).sort()) === JSON.stringify([...keys].sort())
  );
}

export function inspectReadResult(result) {
  const checks = {
    readOnlySurface: false,
    serverStatus: false,
    resourceDescription: false,
    systemStatus: false,
    servicesPage: false
  };
  if (!isRecord(result)) return checks;

  const listed = isRecord(result.tools) ? result.tools.tools : undefined;
  if (Array.isArray(listed) && listed.length === EXPECTED_TOOLS.length) {
    const names = listed.map((tool) => (isRecord(tool) ? tool.name : undefined)).sort();
    checks.readOnlySurface =
      JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()) &&
      listed.every(
        (tool) =>
          isRecord(tool) &&
          isRecord(tool.inputSchema) &&
          tool.inputSchema.type === 'object' &&
          isRecord(tool.annotations) &&
          tool.annotations.readOnlyHint === true
      );
  }

  const serverStatusResponse = result.serverStatus;
  if (successfulToolResult(serverStatusResponse)) {
    const status = serverStatusResponse.structuredContent;
    checks.serverStatus =
      exactKeys(status, ['status', 'readOnly', 'version']) &&
      status.status === 'ok' &&
      status.readOnly === true &&
      status.version === '0.1.0';
  }

  const descriptionResponse = result.resourceDescription;
  if (successfulToolResult(descriptionResponse)) {
    checks.resourceDescription = isDeepStrictEqual(
      descriptionResponse.structuredContent,
      EXPECTED_SYSTEM_STATUS_DESCRIPTION
    );
  }

  const statusResponse = result.systemStatus;
  if (
    successfulToolResult(statusResponse) &&
    exactKeys(statusResponse.structuredContent, ['item']) &&
    exactKeys(statusResponse.structuredContent.item, ['status'])
  ) {
    const status = statusResponse.structuredContent.item.status;
    checks.systemStatus = boundedString(status, 1, 64) && status.trim().length > 0;
  }

  const servicesResponse = result.servicesPage;
  if (successfulToolResult(servicesResponse)) {
    const page = servicesResponse.structuredContent;
    checks.servicesPage =
      exactKeys(page, ['page', 'pageSize', 'total', 'items']) &&
      page.page === 1 &&
      page.pageSize === 10 &&
      Number.isSafeInteger(page.total) &&
      page.total >= 0 &&
      page.total <= 1_000_000 &&
      Array.isArray(page.items) &&
      page.items.length <= page.pageSize &&
      page.total >= page.items.length &&
      page.items.every(
        (item) =>
          exactKeys(item, ['id', 'name', 'description', 'status']) &&
          boundedString(item.id, 1, 128) &&
          boundedString(item.name, 1, 128) &&
          boundedString(item.description, 0, 512) &&
          (item.status === 'running' || item.status === 'stopped')
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
        await runInstalled({
          invocation,
          configPath: artifacts.configPath,
          signal: interruption.signal
        })
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
