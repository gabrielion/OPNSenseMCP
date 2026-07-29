#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runHardenedStdioLifecycle } from '../testing/hardened-stdio-lifecycle.mjs';
import { prepareInstalledPackage } from '../testing/prepare-installed-package.mjs';
import { bootstrapProduct1b } from './product1b-bootstrap.mjs';
import { createConnectionArtifacts } from './product1b-connection.mjs';
import { startDisposableVm, statusDisposableVm, stopDisposableVm } from './product1b-lifecycle.mjs';
import { IMAGE_SPEC, doctorHost, prepareImage } from './product1b.mjs';

const EXPECTED_TOOLS = Object.freeze(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
const COMMAND_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const COMMAND_CLEANUP_TIMEOUT_MS = 2000;
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
    contractDigest: '76a260de18a5f3c5104fa59e4c9d83b2bbfbc8e3880d47cf2c687092b145a922'
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

/**
 * Prepares the installed package for a live proof.
 *
 * The consumer install is served exclusively by the loopback fixture registry built from the
 * committed lock. A plain `npm install --offline` cannot be used here: the consumer resolves the
 * archive's ranges afresh, so any newly published transitive version is selected and then fails
 * `ENOTCACHED` against the developer cache, which made this proof depend on upstream release
 * timing rather than on the repository.
 *
 * The caller owns the returned `cleanup`: it closes the fixture registry, which would otherwise
 * keep a listening socket and the event loop alive after the proof has finished.
 */
export async function installCurrentPackage({
  repositoryRoot,
  temporaryRoot,
  runCommand = runBoundedSubprocess,
  prepare = prepareInstalledPackage
}) {
  await assertPrivateDirectory(temporaryRoot);
  const prepared = await prepare({
    repositoryRoot,
    workRoot: temporaryRoot,
    run: (command, argumentsList, options) =>
      runCommand(
        { command, arguments: [...argumentsList] },
        {
          cwd: options.cwd,
          environment: options.environment,
          input: '',
          timeoutMs: options.timeoutMs
        }
      )
  });
  return Object.freeze({ invocation: prepared.installedCommand, cleanup: prepared.cleanup });
}

function installedReadEnvironment(configPath) {
  return Object.freeze({
    PATH: process.env.PATH ?? '',
    READ_ONLY: 'true',
    OPNSENSE_CONFIG_FILE: configPath,
    MCP_REQUEST_STATE_SECRET: randomBytes(32).toString('base64url')
  });
}

export async function runInstalledReads({
  invocation,
  configPath,
  signal = new AbortController().signal,
  sdkFactories,
  operationTimeoutMs = READ_TIMEOUT_MS,
  closeTimeoutMs = PROCESS_CLOSE_TIMEOUT_MS
}) {
  return runHardenedStdioLifecycle(
    {
      invocation,
      environment: installedReadEnvironment(configPath),
      signal,
      clientInfo: { name: 'product1b-live', version: MCP_CLIENT_VERSION },
      clientOptions: {
        capabilities: {},
        enforceStrictCapabilities: true,
        versionNegotiation: { mode: 'legacy' }
      },
      ...(sdkFactories === undefined ? {} : { sdkFactories }),
      operationTimeoutMs,
      closeTimeoutMs,
      stderrLimitBytes: COMMAND_OUTPUT_LIMIT_BYTES,
      failureMessage: 'Installed read failed'
    },
    async (client) =>
      Object.freeze({
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
      })
  );
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
  const signalSource = options.signalSource ?? process;
  const interruption = new AbortController();
  const doctor = options.doctor ?? doctorHost;
  const statusVm = options.statusVm ?? statusDisposableVm;
  const prepareBase = options.prepareBase ?? (() => prepareImage({ cacheRoot }));
  const startVm = options.startVm ?? startDisposableVm;
  const stopVm = options.stopVm ?? stopDisposableVm;
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
  let releasePackage;
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
      let credentials;
      const started = await startVm({
        instanceRoot,
        rawPath: join(cacheRoot, IMAGE_SPEC.rawName),
        accelerator: report.accelerator,
        prepareBase,
        // QEMU discards console output while no client is attached and the image only offers
        // its unauthenticated shell inside the loader window, so the bootstrap has to run
        // between launch and readiness. A failure there is cleaned up by the owned start.
        bootstrapConsole: async ({ consolePath }) => {
          // QEMU is launched: from here the runner owns it and must prove it was stopped.
          ownedVm = true;
          failureStage = 'bootstrap';
          credentials = await bootstrap({ consolePath });
          failureStage = 'vm-start';
        }
      });
      checks.vmStarted = started?.state === 'running';
      if (!checks.vmStarted) throw new Error('VM start failed');
      ownedVm = true;
      throwIfInterrupted();
      failureStage = 'connection';
      const artifacts = await createArtifacts({ instanceRoot, credentials });
      checks.bootstrap = true;
      throwIfInterrupted();

      failureStage = 'package';
      temporaryRoot = await createTemporaryRoot();
      throwIfInterrupted();
      const prepared = await installPackage({ repositoryRoot, temporaryRoot });
      releasePackage = prepared.cleanup;
      const invocation = prepared.invocation;
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
      // Closes the fixture registry socket first: an open listener would keep the event loop
      // alive past the summary and leave the proof hanging instead of exiting.
      try {
        if (releasePackage !== undefined) await releasePackage();
      } catch {
        cleanupFailed = true;
        failureStage = 'cleanup';
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
