#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { buildVmAttestation, serializeVmAttestation } from './attestation.mjs';
import {
  FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES,
  Product1bBootstrapError,
  bootstrapProduct1b,
  isSafeProduct1bBootstrapStage
} from './product1b-bootstrap.mjs';
import { createConnectionArtifacts } from './product1b-connection.mjs';
import { startDisposableVm, statusDisposableVm, stopDisposableVm } from './product1b-lifecycle.mjs';
import {
  createPrivateTemporaryRoot,
  installCurrentPackage,
  removePrivateTemporaryRoot,
  verifyProduct1bResidue
} from './product1b-live.mjs';
import { IMAGE_SPEC, doctorHost, prepareImage, readSecretLine } from './product1b.mjs';

const EXPECTED_TOOLS = Object.freeze([
  'server_status',
  'opn_describe',
  'opn_get',
  'opn_list',
  'opn_create',
  'opn_delete'
]);
const ALIAS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ALIAS_ATTRIBUTES = Object.freeze({
  name: 'product3_vm_alias',
  type: 'host',
  content: Object.freeze(['192.0.2.10']),
  description: 'Disposable Product 3 verification alias'
});
const MCP_PROTOCOL_VERSION = '2026-07-28';
const MCP_CLIENT_VERSION = '0.1.0';
const ATTESTATION_USAGE = 'Usage: product3-alias.mjs --attestation-out <absolute-path>';
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const SCENARIO_FLAGS = Object.freeze(['experimental-alias-write']);
const SCENARIO_SCOPES = Object.freeze([
  'server.status',
  'system.status',
  'core.services',
  'firewall.alias'
]);

export class Product3AliasError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'Product3AliasError';
    this.code = code;
  }
}

export function parseProduct3Arguments(arguments_) {
  if (
    !Array.isArray(arguments_) ||
    arguments_.length !== 2 ||
    arguments_[0] !== '--attestation-out' ||
    typeof arguments_[1] !== 'string' ||
    !isAbsolute(arguments_[1])
  ) {
    throw new Product3AliasError('USAGE', ATTESTATION_USAGE);
  }
  return Object.freeze({ attestationPath: arguments_[1] });
}

function runGit(arguments_, repositoryRoot) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      arguments_,
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        windowsHide: true
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

export async function inspectGitWorktree(repositoryRoot) {
  try {
    const status = await runGit(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      repositoryRoot
    );
    if (status !== '') return Object.freeze({ clean: false });
    const [commitOutput, treeOutput] = await Promise.all([
      runGit(['rev-parse', '--verify', 'HEAD^{commit}'], repositoryRoot),
      runGit(['rev-parse', '--verify', 'HEAD^{tree}'], repositoryRoot)
    ]);
    const commit = commitOutput.trim();
    const tree = treeOutput.trim();
    if (!GIT_OBJECT_PATTERN.test(commit) || !GIT_OBJECT_PATTERN.test(tree)) {
      throw new Product3AliasError('GIT_PREFLIGHT_FAILED');
    }
    return Object.freeze({ clean: true, commit, tree });
  } catch {
    throw new Product3AliasError('GIT_PREFLIGHT_FAILED');
  }
}

function compatibleDirectorySyncError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(String(error.code))
  );
}

async function syncParentDirectory(parentPath, openFile) {
  let handle;
  try {
    handle = await openFile(parentPath, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!compatibleDirectorySyncError(error)) throw error;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

function directorySyncPaths(parentPath, firstCreatedPath) {
  if (firstCreatedPath === undefined) return [parentPath];
  if (typeof firstCreatedPath !== 'string' || !isAbsolute(firstCreatedPath)) {
    throw new Product3AliasError('VM_ATTESTATION_WRITE_FAILED');
  }
  const createdRelative = relative(firstCreatedPath, parentPath);
  if (
    createdRelative === '..' ||
    createdRelative.startsWith(`..${sep}`) ||
    isAbsolute(createdRelative)
  ) {
    throw new Product3AliasError('VM_ATTESTATION_WRITE_FAILED');
  }
  const boundary = dirname(firstCreatedPath);
  const paths = [];
  let current = parentPath;
  for (;;) {
    paths.push(current);
    if (current === boundary) return paths;
    const next = dirname(current);
    if (next === current) throw new Product3AliasError('VM_ATTESTATION_WRITE_FAILED');
    current = next;
  }
}

export async function writeVmAttestationAtomic(outputPath, attestation, options = {}) {
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath)) {
    throw new Product3AliasError('VM_ATTESTATION_WRITE_FAILED');
  }
  const serialized = serializeVmAttestation(attestation);
  const openFile = options.openFile ?? open;
  const makeDirectory = options.makeDirectory ?? mkdir;
  const renameFile = options.renameFile ?? rename;
  const syncDirectory = options.syncDirectory ?? ((path) => syncParentDirectory(path, openFile));
  const unlinkFile = options.unlinkFile ?? unlink;
  const nonce = (options.randomBytes ?? randomBytes)(16).toString('hex');
  const parentPath = dirname(outputPath);
  const temporaryPath = join(parentPath, `.${basename(outputPath)}.pending-${nonce}`);
  let handle;
  let temporaryExists = false;
  try {
    const firstCreatedPath = await makeDirectory(parentPath, { recursive: true });
    const syncPaths = directorySyncPaths(parentPath, firstCreatedPath);
    handle = await openFile(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    temporaryExists = true;
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temporaryPath, outputPath);
    temporaryExists = false;
    for (const syncPath of syncPaths) await syncDirectory(syncPath);
  } catch {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (temporaryExists) await unlinkFile(temporaryPath).catch(() => undefined);
    throw new Product3AliasError('VM_ATTESTATION_WRITE_FAILED');
  }
}

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
    writableSurface: false,
    aliasAbsentBefore: false,
    aliasCreated: false,
    aliasPresent: false,
    aliasDeleted: false,
    aliasAbsentAfter: false,
    vmStopped: false,
    residueFree: false
  };
}

function summary(checks, interrupted = false, failureStage = null) {
  const passed = !interrupted && failureStage === null && Object.values(checks).every(Boolean);
  return Object.freeze({
    schemaVersion: 1,
    status: passed ? 'passed' : 'failed',
    failureStage: passed ? null : interrupted ? 'interrupted' : failureStage,
    checks
  });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function successfulToolResult(value) {
  return isRecord(value) && value.isError !== true && isRecord(value.structuredContent);
}

function isAliasPage(value, expectedTotal, expectedUuid) {
  if (!successfulToolResult(value)) return false;
  const page = value.structuredContent;
  if (
    page.page !== 1 ||
    page.pageSize !== 10 ||
    page.total !== expectedTotal ||
    !Array.isArray(page.items)
  ) {
    return false;
  }
  if (expectedUuid === undefined) return page.items.length === 0;
  return (
    page.items.length === 1 &&
    isRecord(page.items[0]) &&
    page.items[0].uuid === expectedUuid &&
    page.items[0].name === ALIAS_ATTRIBUTES.name &&
    page.items[0].type === ALIAS_ATTRIBUTES.type &&
    page.items[0].description === ALIAS_ATTRIBUTES.description
  );
}

function writableToolSurface(value) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tools) ||
    value.tools.length !== EXPECTED_TOOLS.length
  ) {
    return false;
  }
  const tools = value.tools;
  const names = tools.map((tool) => (isRecord(tool) ? tool.name : undefined)).sort();
  if (JSON.stringify(names) !== JSON.stringify([...EXPECTED_TOOLS].sort())) return false;
  return ['opn_create', 'opn_delete'].every((name) => {
    const tool = tools.find((candidate) => isRecord(candidate) && candidate.name === name);
    return isRecord(tool) && isRecord(tool.annotations) && tool.annotations.readOnlyHint === false;
  });
}

/**
 * Alias writes are experimental: they require READ_ONLY=false, the exact feature flag, and an
 * allow-list that explicitly names firewall.alias. The allow-list filters reads as well, so every
 * scope this lifecycle still needs is named — including `server.status`, without which
 * `server_status` would disappear and the six-tool surface assertion would fail.
 */
function lifecycleEnvironment(configPath) {
  return Object.freeze({
    PATH: process.env.PATH ?? '',
    READ_ONLY: 'false',
    ENABLED_FEATURE_FLAGS: SCENARIO_FLAGS.join(','),
    ALLOWED_RESOURCES: SCENARIO_SCOPES.join(','),
    OPNSENSE_CONFIG_FILE: configPath,
    MCP_REQUEST_STATE_SECRET: randomBytes(32).toString('base64url')
  });
}

async function openSdkClient({ invocation, environment, signal }) {
  const transport = new StdioClientTransport({
    command: invocation.command,
    args: [...invocation.arguments],
    env: environment,
    stderr: 'pipe'
  });
  const client = new Client(
    { name: 'product3-alias', version: MCP_CLIENT_VERSION },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } }
    }
  );
  client.setRequestHandler('elicitation/create', () =>
    Promise.resolve({ action: 'accept', content: { confirm: true } })
  );
  const abort = () => {
    void client.close();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    await client.connect(transport);
    if (signal.aborted) throw new Error('Interrupted');
  } catch (error) {
    signal.removeEventListener('abort', abort);
    await client.close().catch(() => undefined);
    throw error;
  }
  return Object.freeze({
    listTools: () => client.listTools(undefined, { signal }),
    callTool: (request) => client.callTool(request, { signal }),
    close: async () => {
      signal.removeEventListener('abort', abort);
      await client.close();
    }
  });
}

export async function runInstalledAliasLifecycle({
  invocation,
  configPath,
  signal = new AbortController().signal,
  openClient = openSdkClient
}) {
  const client = await openClient({
    invocation,
    environment: lifecycleEnvironment(configPath),
    signal
  });
  try {
    const writableSurface = writableToolSurface(await client.listTools(signal));
    const listArguments = { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' };
    const absentBefore = isAliasPage(
      await client.callTool({ name: 'opn_list', arguments: listArguments }, signal),
      0
    );
    if (!writableSurface || !absentBefore) {
      return Object.freeze({
        writableSurface,
        aliasAbsentBefore: absentBefore,
        aliasCreated: false,
        aliasPresent: false,
        aliasDeleted: false,
        aliasAbsentAfter: false
      });
    }
    const created = await client.callTool(
      {
        name: 'opn_create',
        arguments: { resource: 'firewall.alias', attributes: ALIAS_ATTRIBUTES }
      },
      signal
    );
    const item = successfulToolResult(created) ? created.structuredContent.item : undefined;
    const createdUuid =
      isRecord(item) &&
      typeof item.uuid === 'string' &&
      ALIAS_UUID_PATTERN.test(item.uuid) &&
      item.name === ALIAS_ATTRIBUTES.name &&
      item.type === ALIAS_ATTRIBUTES.type &&
      Array.isArray(item.content) &&
      JSON.stringify(item.content) === JSON.stringify(ALIAS_ATTRIBUTES.content) &&
      item.description === ALIAS_ATTRIBUTES.description
        ? item.uuid
        : undefined;
    const aliasCreated = createdUuid !== undefined;
    const aliasPresent =
      createdUuid !== undefined &&
      isAliasPage(
        await client.callTool({ name: 'opn_list', arguments: listArguments }, signal),
        1,
        createdUuid
      );
    const deleted =
      createdUuid !== undefined
        ? await client.callTool(
            {
              name: 'opn_delete',
              arguments: { resource: 'firewall.alias', id: createdUuid }
            },
            signal
          )
        : undefined;
    const aliasDeleted =
      successfulToolResult(deleted) &&
      isRecord(deleted.structuredContent.item) &&
      deleted.structuredContent.item.id === createdUuid;
    const aliasAbsentAfter =
      aliasDeleted &&
      isAliasPage(await client.callTool({ name: 'opn_list', arguments: listArguments }, signal), 0);
    return Object.freeze({
      writableSurface,
      aliasAbsentBefore: absentBefore,
      aliasCreated,
      aliasPresent,
      aliasDeleted,
      aliasAbsentAfter
    });
  } finally {
    await client.close();
  }
}

export async function runProduct3Alias(options = {}) {
  const cacheRoot = options.cacheRoot ?? userCacheRoot();
  const instanceRoot = options.instanceRoot ?? join(cacheRoot, 'instance');
  const repositoryRoot = options.repositoryRoot ?? resolve('.');
  const attestationPath = options.attestationPath;
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
  const runInstalled = options.runInstalled ?? runInstalledAliasLifecycle;
  const removeTemporaryRoot = options.removeTemporaryRoot ?? removePrivateTemporaryRoot;
  const verifyResidue = options.verifyResidue ?? verifyProduct1bResidue;
  const inspectGit = options.inspectGit ?? inspectGitWorktree;
  const writeAttestation = options.writeAttestation ?? writeVmAttestationAtomic;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const checks = emptyChecks();
  let gitIdentity;
  let doctorReport;
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
      failureStage = 'preflight';
      if (typeof attestationPath !== 'string' || !isAbsolute(attestationPath)) {
        throw new Product3AliasError('USAGE', ATTESTATION_USAGE);
      }
      gitIdentity = await inspectGit(repositoryRoot);
      if (gitIdentity?.clean !== true) throw new Product3AliasError('DIRTY_WORKTREE');
      doctorReport = doctor();
      checks.doctor = doctorReport?.ready === true;
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
        accelerator: doctorReport.accelerator,
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
        factoryPassword,
        privileges: FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES
      });
      checks.bootstrap = true;
      throwIfInterrupted();
      failureStage = 'connection';
      const artifacts = await createArtifacts({ instanceRoot, credentials });
      throwIfInterrupted();
      failureStage = 'package';
      temporaryRoot = await createTemporaryRoot();
      throwIfInterrupted();
      const invocation = await installPackage({ repositoryRoot, temporaryRoot });
      checks.packageInstalled = true;
      throwIfInterrupted();
      failureStage = 'lifecycle';
      const lifecycleChecks = await runInstalled({
        invocation,
        configPath: artifacts.configPath,
        signal: interruption.signal
      });
      Object.assign(checks, lifecycleChecks);
      if (Object.values(lifecycleChecks).every(Boolean)) failureStage = null;
    } catch (error) {
      if (
        failureStage === 'bootstrap' &&
        error instanceof Product1bBootstrapError &&
        isSafeProduct1bBootstrapStage(error.stage)
      ) {
        failureStage = error.stage;
      }
      // The final summary contains only fixed booleans; VM, credentials and firewall data stay private.
    } finally {
      if (ownedVm) {
        try {
          const stopped = await stopVm({ instanceRoot });
          checks.vmStopped = stopped?.state === 'stopped' && stopped.cleaned === true;
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
    if (
      !interrupted &&
      Object.values(checks).every(Boolean) &&
      gitIdentity?.clean === true &&
      doctorReport?.ready === true
    ) {
      failureStage = 'attestation';
      try {
        const finalGitIdentity = await inspectGit(repositoryRoot);
        if (
          finalGitIdentity?.clean !== true ||
          finalGitIdentity.commit !== gitIdentity.commit ||
          finalGitIdentity.tree !== gitIdentity.tree
        ) {
          throw new Product3AliasError('GIT_STATE_CHANGED');
        }
        const attestation = buildVmAttestation({
          schemaVersion: 2,
          commit: gitIdentity.commit,
          tree: gitIdentity.tree,
          node: nodeVersion,
          host: doctorReport.host,
          protocolVersion: MCP_PROTOCOL_VERSION,
          clientVersion: MCP_CLIENT_VERSION,
          image: {
            release: IMAGE_SPEC.release,
            sha256: IMAGE_SPEC.archiveSha256
          },
          scenario: {
            readOnly: false,
            flags: SCENARIO_FLAGS,
            scopes: SCENARIO_SCOPES
          },
          checks
        });
        await writeAttestation(attestationPath, attestation);
        failureStage = null;
      } catch {
        failureStage = 'attestation';
      }
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

export async function runProduct3Cli(arguments_, options = {}) {
  let parsed;
  try {
    parsed = parseProduct3Arguments(arguments_);
  } catch (error) {
    const stderr = options.stderr ?? process.stderr;
    stderr.write(`${error instanceof Product3AliasError ? error.message : ATTESTATION_USAGE}\n`);
    return 1;
  }
  return runProduct3Alias({ ...options, ...parsed });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runProduct3Cli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 2;
    });
}
