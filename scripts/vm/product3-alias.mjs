#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES, bootstrapProduct1b } from './product1b-bootstrap.mjs';
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
  const passed = !interrupted && Object.values(checks).every(Boolean);
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

function lifecycleEnvironment(configPath) {
  return Object.freeze({
    PATH: process.env.PATH ?? '',
    READ_ONLY: 'false',
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
    { name: 'product3-alias', version: '0.1.0' },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: '2026-07-28' } }
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
    } catch {
      // The final summary contains only fixed booleans; VM, credentials and firewall data stay private.
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
  void runProduct3Alias().then((code) => {
    process.exitCode = code;
  });
}
