// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildVmAttestation, serializeVmAttestation } from '../../scripts/vm/attestation.mjs';
import {
  parseProduct3Arguments,
  runInstalledAliasLifecycle,
  runProduct3Alias,
  writeVmAttestationAtomic
} from '../../scripts/vm/product3-alias.mjs';
import {
  FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES,
  Product1bBootstrapError
} from '../../scripts/vm/product1b-bootstrap.mjs';

const UUID = '00000000-0000-0000-0000-000000000001';
const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);
const FIXTURE_ROOTS = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    FIXTURE_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function captureStream() {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  return { stream, output: () => output };
}

function lifecycleChecks() {
  return {
    writableSurface: true,
    aliasAbsentBefore: true,
    aliasCreated: true,
    aliasPresent: true,
    aliasDeleted: true,
    aliasAbsentAfter: true
  };
}

function completeChecks() {
  return {
    doctor: true,
    vmStarted: true,
    bootstrap: true,
    packageInstalled: true,
    writableSurface: true,
    aliasAbsentBefore: true,
    aliasCreated: true,
    aliasPresent: true,
    aliasDeleted: true,
    aliasAbsentAfter: true,
    vmStopped: true,
    residueFree: true
  };
}

function attestationInput(overrides = {}) {
  return {
    schemaVersion: 2,
    commit: COMMIT,
    tree: TREE,
    node: '22.19.0',
    host: 'macos',
    protocolVersion: '2026-07-28',
    clientVersion: '0.1.0',
    image: {
      release: '26.1.6',
      sha256: '3c16267c791abfc3e41d5249fcb0c245c03cb91e2f1aa4d53017f0f3454d03a1'
    },
    scenario: {
      readOnly: false,
      flags: ['experimental-alias-write'],
      scopes: ['server.status', 'system.status', 'core.services', 'firewall.alias']
    },
    checks: completeChecks(),
    ...overrides
  };
}

function dependencies(overrides = {}) {
  const instanceRoot = '/private/SENTINEL_INSTANCE';
  const temporaryRoot = '/private/SENTINEL_TEMPORARY';
  const calls = [];
  return {
    instanceRoot,
    cacheRoot: '/private/SENTINEL_CACHE',
    repositoryRoot: '/private/SENTINEL_REPOSITORY',
    attestationPath: '/private/SENTINEL_ATTESTATION.json',
    nodeVersion: '22.19.0',
    inspectGit: vi.fn(async () => ({ clean: true, commit: COMMIT, tree: TREE })),
    writeAttestation: vi.fn(async () => undefined),
    doctor: vi.fn(() => ({ ready: true, host: 'macos', accelerator: 'tcg' })),
    statusVm: vi.fn(async () => ({ state: 'stopped', cleaned: false })),
    prepareBase: vi.fn(async () => undefined),
    // Mirrors the owned start: the console consumer runs between launch and readiness.
    startVm: vi.fn(async ({ bootstrapConsole }) => {
      calls.push('start');
      await bootstrapConsole?.({ consolePath: `${instanceRoot}/console.sock` });
      return { state: 'running' };
    }),
    bootstrap: vi.fn(async () => ({
      key: 'SENTINEL_API_KEY',
      secret: 'SENTINEL_API_SECRET',
      serverName: 'OPNsense.internal'
    })),
    createArtifacts: vi.fn(async () => ({
      configPath: `${instanceRoot}/SENTINEL_CONNECTION.json`,
      caPath: `${instanceRoot}/SENTINEL_CA.pem`
    })),
    createTemporaryRoot: vi.fn(async () => temporaryRoot),
    installPackage: vi.fn(async () => ({
      invocation: {
        command: `${temporaryRoot}/consumer/node_modules/.bin/opnsense-mcp`,
        arguments: [],
        cwd: `${temporaryRoot}/consumer`
      },
      cleanup: async () => undefined
    })),
    runInstalled: vi.fn(async () => lifecycleChecks()),
    stopVm: vi.fn(async () => {
      calls.push('stop');
      return { state: 'stopped', cleaned: true };
    }),
    removeTemporaryRoot: vi.fn(async () => {
      calls.push('remove');
    }),
    verifyResidue: vi.fn(async () => true),
    calls,
    ...overrides
  };
}

function toolResult(structuredContent) {
  return { isError: false, structuredContent };
}

function sdkAliasHarness({
  exitCode = 0,
  signalCode = null,
  holdConnect = false,
  holdRequest = false,
  holdClose = false,
  stderrChunks = [],
  toolNames = ['server_status', 'opn_describe', 'opn_get', 'opn_list', 'opn_create', 'opn_delete'],
  initialAliasItems = []
} = {}) {
  const child = new EventEmitter();
  child.pid = 42_424;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal) => {
    child.signalCode = signal;
    child.emit('close', null, signal);
    return true;
  });
  const stderr = new PassThrough();
  const transport = {
    _process: undefined,
    stderr,
    start: vi.fn(async () => {
      transport._process = child;
      for (const chunk of stderrChunks) stderr.write(chunk);
    })
  };
  const closeTransport = vi.fn(async () => {
    if (holdClose) return new Promise(() => undefined);
    transport._process = undefined;
    child.exitCode = exitCode;
    child.signalCode = signalCode;
    child.emit('close', exitCode, signalCode);
  });
  transport.close = closeTransport;

  let connectedTransport;
  let listCount = 0;
  const client = {
    setRequestHandler: vi.fn(),
    connect: vi.fn(async (candidate) => {
      connectedTransport = candidate;
      await candidate.start();
      if (holdConnect) return new Promise(() => undefined);
    }),
    listTools: vi.fn(async () => {
      if (holdRequest) return new Promise(() => undefined);
      return {
        tools: toolNames.map((name) => ({ name, annotations: { readOnlyHint: false } }))
      };
    }),
    callTool: vi.fn(async ({ name }) => {
      if (holdRequest) return new Promise(() => undefined);
      if (name === 'opn_list') {
        listCount += 1;
        if (listCount === 1 && initialAliasItems.length > 0) {
          return toolResult({
            page: 1,
            pageSize: 10,
            total: initialAliasItems.length,
            items: initialAliasItems
          });
        }
        if (listCount === 2) {
          return toolResult({
            page: 1,
            pageSize: 10,
            total: 1,
            items: [
              {
                uuid: UUID,
                name: 'product3_vm_alias',
                type: 'host',
                description: 'Disposable Product 3 verification alias'
              }
            ]
          });
        }
        return toolResult({ page: 1, pageSize: 10, total: 0, items: [] });
      }
      if (name === 'opn_create') {
        return toolResult({
          item: {
            uuid: UUID,
            name: 'product3_vm_alias',
            type: 'host',
            content: ['192.0.2.10'],
            description: 'Disposable Product 3 verification alias'
          }
        });
      }
      return toolResult({ item: { id: UUID } });
    }),
    close: vi.fn(async () => connectedTransport?.close())
  };
  const closeClient = client.close;
  const createTransport = vi.fn(() => transport);
  const createClient = vi.fn(() => client);
  return {
    sdkFactories: { createTransport, createClient },
    createTransport,
    createClient,
    client,
    closeClient,
    transport,
    child,
    stderr,
    closeTransport
  };
}

function installedAliasOptions(harness, overrides = {}) {
  return {
    invocation: {
      command: '/private/SENTINEL_INSTALLED_MCP',
      arguments: [],
      cwd: '/private/SENTINEL_CONSUMER'
    },
    configPath: '/private/SENTINEL_CONNECTION.json',
    sdkFactories: harness.sdkFactories,
    operationTimeoutMs: 30_000,
    closeTimeoutMs: 10_000,
    ...overrides
  };
}

describe('Product 3 disposable-VM alias runner', () => {
  it('configures strict capabilities, protocol pinning, and confirmation elicitation', async () => {
    const harness = sdkAliasHarness();

    await expect(runInstalledAliasLifecycle(installedAliasOptions(harness))).resolves.toEqual(
      lifecycleChecks()
    );

    expect(harness.createClient).toHaveBeenCalledWith(
      { name: 'product3-alias', version: '0.1.0' },
      {
        capabilities: { elicitation: { form: {} } },
        enforceStrictCapabilities: true,
        versionNegotiation: { mode: { pin: '2026-07-28' } }
      }
    );
    expect(harness.client.setRequestHandler).toHaveBeenCalledOnce();
    expect(harness.client.setRequestHandler.mock.calls[0]?.[0]).toBe('elicitation/create');
    await expect(harness.client.setRequestHandler.mock.calls[0]?.[1]()).resolves.toEqual({
      action: 'accept',
      content: { confirm: true }
    });
    expect(harness.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/private/SENTINEL_CONSUMER',
        stderr: 'pipe',
        maxBufferSize: 1024 * 1024
      })
    );
    expect(harness.client.connect).toHaveBeenCalledWith(
      harness.transport,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 30_000,
        maxTotalTimeout: 30_000
      })
    );
    expect(harness.client.listTools).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 30_000,
        maxTotalTimeout: 30_000
      })
    );
    expect(harness.client.callTool).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 30_000,
        maxTotalTimeout: 30_000
      })
    );
  });

  it.each([
    ['one stderr byte', [Buffer.from('x')]],
    ['aggregate stderr overflow', [Buffer.alloc(768 * 1024), Buffer.alloc(256 * 1024 + 1)]]
  ])('fails the installed lifecycle after %s', async (_condition, stderrChunks) => {
    const harness = sdkAliasHarness({ stderrChunks });

    await expect(runInstalledAliasLifecycle(installedAliasOptions(harness))).rejects.toThrow(
      /^Installed alias lifecycle failed$/
    );

    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
    expect(harness.child.listenerCount('close')).toBe(0);
    expect(harness.stderr.listenerCount('data')).toBe(0);
    expect(harness.stderr.listenerCount('error')).toBe(0);
  });

  it.each([
    ['exit code 1', { exitCode: 1, signalCode: null }],
    ['termination signal', { exitCode: null, signalCode: 'SIGTERM' }]
  ])('fails the installed lifecycle after child %s', async (_condition, processOutcome) => {
    const harness = sdkAliasHarness(processOutcome);

    await expect(runInstalledAliasLifecycle(installedAliasOptions(harness))).rejects.toThrow(
      /^Installed alias lifecycle failed$/
    );

    expect(harness.closeTransport).toHaveBeenCalledOnce();
    expect(harness.child.listenerCount('close')).toBe(0);
    expect(harness.stderr.listenerCount('data')).toBe(0);
    expect(harness.stderr.listenerCount('error')).toBe(0);
  });

  it.each(['connect', 'request'])('bounds a held MCP %s', async (heldStage) => {
    vi.useFakeTimers();
    const harness = sdkAliasHarness({
      holdConnect: heldStage === 'connect',
      holdRequest: heldStage === 'request'
    });
    const run = runInstalledAliasLifecycle(
      installedAliasOptions(harness, { operationTimeoutMs: 1_000 })
    );
    const rejection = expect(run).rejects.toThrow(/^Installed alias lifecycle failed$/);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
    expect(harness.child.listenerCount('close')).toBe(0);
    expect(harness.stderr.listenerCount('data')).toBe(0);
    expect(harness.stderr.listenerCount('error')).toBe(0);
  });

  it('bounds a held installed process close and fails', async () => {
    vi.useFakeTimers();
    const harness = sdkAliasHarness({ holdClose: true });
    const run = runInstalledAliasLifecycle(
      installedAliasOptions(harness, { operationTimeoutMs: 30_000, closeTimeoutMs: 1_000 })
    );
    const rejection = expect(run).rejects.toThrow(/^Installed alias lifecycle failed$/);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
    expect(harness.child.kill).toHaveBeenCalledOnce();
    expect(harness.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(harness.child.signalCode).toBe('SIGKILL');
    expect(harness.child.listenerCount('close')).toBe(0);
    expect(harness.stderr.listenerCount('data')).toBe(0);
    expect(harness.stderr.listenerCount('error')).toBe(0);
  });

  it('closes once and accepts only child exit zero without a signal', async () => {
    const harness = sdkAliasHarness();

    await expect(runInstalledAliasLifecycle(installedAliasOptions(harness))).resolves.toEqual(
      lifecycleChecks()
    );

    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
    expect(harness.child.exitCode).toBe(0);
    expect(harness.child.signalCode).toBeNull();
    expect(harness.child.listenerCount('close')).toBe(0);
    expect(harness.stderr.listenerCount('data')).toBe(0);
    expect(harness.stderr.listenerCount('error')).toBe(0);
  });

  it('passes the installed consumer cwd to the stdio transport', async () => {
    const harness = sdkAliasHarness();

    await expect(runInstalledAliasLifecycle(installedAliasOptions(harness))).resolves.toEqual(
      lifecycleChecks()
    );

    expect(harness.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/private/SENTINEL_CONSUMER' })
    );
  });

  it('fails closed before transport creation when the invocation cwd is absent', async () => {
    const harness = sdkAliasHarness();

    await expect(
      runInstalledAliasLifecycle({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_MCP',
          arguments: []
        },
        configPath: '/private/SENTINEL_CONNECTION.json',
        sdkFactories: harness.sdkFactories
      })
    ).rejects.toThrow();
    expect(harness.createTransport).not.toHaveBeenCalled();
  });

  it('requires a stopped VM, boots with the alias ACL, and emits one sanitized boolean-only summary', async () => {
    const stdout = captureStream();
    const deps = dependencies();

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    expect(deps.statusVm).toHaveBeenCalledWith({ instanceRoot: deps.instanceRoot });
    expect(deps.startVm).toHaveBeenCalledWith({
      instanceRoot: deps.instanceRoot,
      rawPath: `${deps.cacheRoot}/OPNsense-26.1.6-nano-amd64.img`,
      accelerator: 'tcg',
      prepareBase: deps.prepareBase,
      bootstrapConsole: expect.any(Function)
    });
    expect(deps.bootstrap).toHaveBeenCalledWith({
      consolePath: `${deps.instanceRoot}/console.sock`,
      privileges: FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES
    });
    expect(deps.runInstalled).toHaveBeenCalledWith(
      expect.objectContaining({
        invocation: {
          command: '/private/SENTINEL_TEMPORARY/consumer/node_modules/.bin/opnsense-mcp',
          arguments: [],
          cwd: '/private/SENTINEL_TEMPORARY/consumer'
        },
        configPath: `${deps.instanceRoot}/SENTINEL_CONNECTION.json`,
        signal: expect.any(AbortSignal)
      })
    );
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    expect(deps.writeAttestation).toHaveBeenCalledOnce();

    const output = stdout.output();
    expect(output.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      status: 'passed',
      failureStage: null,
      checks: {
        doctor: true,
        vmStarted: true,
        bootstrap: true,
        packageInstalled: true,
        writableSurface: true,
        aliasAbsentBefore: true,
        aliasCreated: true,
        aliasPresent: true,
        aliasDeleted: true,
        aliasAbsentAfter: true,
        vmStopped: true,
        residueFree: true
      }
    });
    expect(output).not.toMatch(/SENTINEL|\/private|opnsense\.internal|lab_hosts|192\.0\.2\.10/iu);
  });

  it('records the exact MCP list-create-list-delete-list lifecycle with READ_ONLY=false', async () => {
    const harness = sdkAliasHarness();

    await expect(runInstalledAliasLifecycle(installedAliasOptions(harness))).resolves.toEqual(
      lifecycleChecks()
    );

    expect(harness.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          READ_ONLY: 'false',
          ENABLED_FEATURE_FLAGS: 'experimental-alias-write',
          ALLOWED_RESOURCES: 'server.status,system.status,core.services,firewall.alias',
          OPNSENSE_CONFIG_FILE: '/private/SENTINEL_CONNECTION.json',
          MCP_REQUEST_STATE_SECRET: expect.stringMatching(/^[A-Za-z0-9_-]+$/u)
        })
      })
    );
    expect(harness.client.callTool.mock.calls.map(([request]) => request)).toEqual([
      {
        name: 'opn_list',
        arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
      },
      {
        name: 'opn_create',
        arguments: {
          resource: 'firewall.alias',
          attributes: {
            name: 'product3_vm_alias',
            type: 'host',
            content: ['192.0.2.10'],
            description: 'Disposable Product 3 verification alias'
          }
        }
      },
      {
        name: 'opn_list',
        arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
      },
      { name: 'opn_delete', arguments: { resource: 'firewall.alias', id: UUID } },
      {
        name: 'opn_list',
        arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
      }
    ]);
    expect(harness.closeClient).toHaveBeenCalledOnce();
  });

  it.each(['invalid writable surface', 'alias already present'])(
    'refuses before creation when the %s',
    async (condition) => {
      const harness = sdkAliasHarness({
        toolNames:
          condition === 'invalid writable surface'
            ? []
            : ['server_status', 'opn_describe', 'opn_get', 'opn_list', 'opn_create', 'opn_delete'],
        initialAliasItems:
          condition === 'alias already present'
            ? [{ uuid: UUID, name: 'existing', type: 'host', description: 'existing' }]
            : []
      });

      const result = await runInstalledAliasLifecycle(installedAliasOptions(harness));

      expect(result.aliasCreated).toBe(false);
      expect(harness.client.callTool).toHaveBeenCalledTimes(1);
      expect(harness.client.callTool).toHaveBeenCalledWith(
        {
          name: 'opn_list',
          arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    }
  );

  it('cancels an in-flight MCP operation without waiting for the held operation to settle', async () => {
    const stdout = captureStream();
    const signalSource = new EventEmitter();
    let started;
    const lifecycleStarted = new Promise((resolve) => {
      started = resolve;
    });
    const deps = dependencies({
      signalSource,
      runInstalled: vi.fn(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            started();
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          })
      )
    });

    const run = runProduct3Alias({ ...deps, stdout: stdout.stream });
    await lifecycleStarted;
    signalSource.emit('SIGTERM');

    await expect(run).resolves.toBe(3);
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    expect(deps.runInstalled).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('fails closed before startup when the VM is not freshly stopped', async () => {
    const stdout = captureStream();
    const deps = dependencies({ statusVm: vi.fn(async () => ({ state: 'running' })) });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.startVm).not.toHaveBeenCalled();
    expect(deps.stopVm).not.toHaveBeenCalled();
    expect(deps.removeTemporaryRoot).not.toHaveBeenCalled();
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'preflight',
      checks: { vmStarted: false, residueFree: true }
    });
  });

  it('stops the VM and removes private package artifacts after every live lifecycle failure', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      runInstalled: vi.fn(async () => ({ ...lifecycleChecks(), aliasPresent: false }))
    });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    expect(deps.verifyResidue).toHaveBeenCalledWith({
      instanceRoot: deps.instanceRoot,
      temporaryRoot: '/private/SENTINEL_TEMPORARY'
    });
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'lifecycle',
      checks: { vmStopped: true, residueFree: true, aliasPresent: false }
    });
    expect(stdout.output()).not.toMatch(/SENTINEL|\/private/iu);
    expect(deps.writeAttestation).not.toHaveBeenCalled();
  });

  it('reports a safe Product 1B bootstrap stage after stopping the owned VM', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      bootstrap: vi.fn(async () => Promise.reject(new Product1bBootstrapError('heredoc-lines')))
    });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.calls).toEqual(['start', 'stop']);
    expect(deps.createArtifacts).not.toHaveBeenCalled();
    expect(deps.createTemporaryRoot).not.toHaveBeenCalled();
    expect(deps.verifyResidue).toHaveBeenCalledWith({
      instanceRoot: deps.instanceRoot,
      temporaryRoot: undefined
    });
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'heredoc-lines',
      checks: { vmStopped: true, residueFree: true }
    });
    expect(stdout.output()).not.toMatch(/SENTINEL|\/private/iu);
  });

  it('rejects an untrusted bootstrap stage after stopping the owned VM', async () => {
    const stdout = captureStream();
    const failure = new Product1bBootstrapError('SENTINEL_UNTRUSTED_STAGE');
    failure.cause = new Error('SENTINEL_FAILURE');
    failure.privatePath = '/private/SENTINEL_FAILURE';
    const deps = dependencies({
      bootstrap: vi.fn(async () => Promise.reject(failure))
    });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.calls).toEqual(['start', 'stop']);
    expect(deps.createArtifacts).not.toHaveBeenCalled();
    expect(deps.createTemporaryRoot).not.toHaveBeenCalled();
    expect(deps.verifyResidue).toHaveBeenCalledWith({
      instanceRoot: deps.instanceRoot,
      temporaryRoot: undefined
    });
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'bootstrap',
      checks: { vmStopped: true, residueFree: true }
    });
    expect(stdout.output()).not.toMatch(/SENTINEL|\/private/iu);
  });

  it('finishes cleanup after a signal and removes its signal handlers', async () => {
    const stdout = captureStream();
    const signalSource = new EventEmitter();
    let release;
    let started;
    const lifecycleStarted = new Promise((resolve) => {
      started = resolve;
    });
    const heldLifecycle = new Promise((resolve) => {
      release = resolve;
    });
    const deps = dependencies({
      signalSource,
      runInstalled: vi.fn(async () => {
        started();
        return heldLifecycle;
      })
    });

    const run = runProduct3Alias({ ...deps, stdout: stdout.stream });
    await lifecycleStarted;
    signalSource.emit('SIGTERM');
    release(lifecycleChecks());

    await expect(run).resolves.toBe(3);
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'interrupted',
      checks: { vmStopped: true, residueFree: true }
    });
    expect(stdout.output()).not.toMatch(/SIGTERM|SENTINEL|\/private/iu);
  });

  it.each([
    ['start', { startVm: vi.fn(async () => ({ state: 'failed' })) }, [], undefined],
    [
      'bootstrap',
      { bootstrap: vi.fn(async () => Promise.reject(new Error('bootstrap'))) },
      ['start', 'stop'],
      undefined
    ],
    [
      'connection',
      { createArtifacts: vi.fn(async () => Promise.reject(new Error('connection'))) },
      ['start', 'stop'],
      undefined
    ],
    [
      'private root',
      { createTemporaryRoot: vi.fn(async () => Promise.reject(new Error('root'))) },
      ['start', 'stop'],
      undefined
    ],
    [
      'package',
      { installPackage: vi.fn(async () => Promise.reject(new Error('package'))) },
      ['start', 'stop', 'remove'],
      '/private/SENTINEL_TEMPORARY'
    ],
    [
      'client open',
      { runInstalled: vi.fn(async () => Promise.reject(new Error('client'))) },
      ['start', 'stop', 'remove'],
      '/private/SENTINEL_TEMPORARY'
    ]
  ])(
    'cleans up the owned resources when %s fails',
    async (_stage, overrides, expectedCalls, temporaryRoot) => {
      const stdout = captureStream();
      const deps = dependencies(overrides);

      await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

      expect(deps.calls).toEqual(expectedCalls);
      expect(deps.verifyResidue).toHaveBeenCalledWith({
        instanceRoot: deps.instanceRoot,
        temporaryRoot
      });
    }
  );

  it('reports cleanup failure and refuses to claim residue-free state', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      removeTemporaryRoot: vi.fn(async () => Promise.reject(new Error('cleanup'))),
      verifyResidue: vi.fn(async () => false)
    });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'cleanup',
      checks: { vmStopped: true, residueFree: false }
    });
    expect(deps.writeAttestation).not.toHaveBeenCalled();
  });

  it('wires vm:product3 to the disposable alias runner', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    expect(manifest.scripts['vm:product3']).toBe('node scripts/vm/product3-alias.mjs');
  });
});

describe('Product 3 VM attestation', () => {
  it('builds one fixed recursively key-sorted schema with stable canonical bytes', () => {
    const reordered = attestationInput({
      checks: {
        residueFree: true,
        aliasPresent: true,
        vmStopped: true,
        doctor: true,
        writableSurface: true,
        aliasDeleted: true,
        bootstrap: true,
        aliasAbsentAfter: true,
        packageInstalled: true,
        vmStarted: true,
        aliasCreated: true,
        aliasAbsentBefore: true
      }
    });
    const canonical = serializeVmAttestation(reordered);

    expect(canonical).toBe(serializeVmAttestation(attestationInput()));
    expect(canonical).toBe(
      `{"checks":{"aliasAbsentAfter":true,"aliasAbsentBefore":true,"aliasCreated":true,"aliasDeleted":true,"aliasPresent":true,"bootstrap":true,"doctor":true,"packageInstalled":true,"residueFree":true,"vmStarted":true,"vmStopped":true,"writableSurface":true},"clientVersion":"0.1.0","commit":"${COMMIT}","host":"macos","image":{"release":"26.1.6","sha256":"3c16267c791abfc3e41d5249fcb0c245c03cb91e2f1aa4d53017f0f3454d03a1"},"node":"22.19.0","protocolVersion":"2026-07-28","scenario":{"flags":["experimental-alias-write"],"readOnly":false,"scopes":["server.status","system.status","core.services","firewall.alias"]},"schemaVersion":2,"tree":"${TREE}"}\n`
    );
    expect(buildVmAttestation(reordered)).toEqual(JSON.parse(canonical));
  });

  it.each([
    [
      'missing check',
      () => {
        const checks = completeChecks();
        delete checks.residueFree;
        return attestationInput({ checks });
      }
    ],
    [
      'unknown check',
      () => attestationInput({ checks: { ...completeChecks(), credentialFree: true } })
    ],
    [
      'non-true check',
      () => attestationInput({ checks: { ...completeChecks(), aliasPresent: false } })
    ],
    ['unknown top-level field', () => ({ ...attestationInput(), statePath: '/private/SENTINEL' })]
  ])('rejects a fixed-schema attestation with a %s', (_label, input) => {
    expect(() => buildVmAttestation(input())).toThrow('VM_ATTESTATION_INVALID');
  });

  it('accepts exactly one absolute attestation-output CLI flag', () => {
    const outputPath = join(tmpdir(), 'product3-vm.json');

    expect(parseProduct3Arguments(['--attestation-out', outputPath])).toEqual({
      attestationPath: outputPath
    });
    for (const argumentsList of [
      [],
      ['--attestation-out'],
      ['--attestation-out', 'docs/evidence/product3-vm.json'],
      ['--attestation-out', outputPath, 'extra'],
      ['--unknown', outputPath]
    ]) {
      expect(() => parseProduct3Arguments(argumentsList)).toThrow(
        'Usage: product3-alias.mjs --attestation-out <absolute-path>'
      );
    }
  });

  it('rejects a dirty starting tree before doctor or VM startup without exposing Git output', async () => {
    const stdout = captureStream();
    const dirtyOutput = ' M /Users/SENTINEL/private-state.json';
    const deps = dependencies({
      inspectGit: vi.fn(async () => ({ clean: false, privateOutput: dirtyOutput }))
    });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.doctor).not.toHaveBeenCalled();
    expect(deps.statusVm).not.toHaveBeenCalled();
    expect(deps.startVm).not.toHaveBeenCalled();
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    expect(stdout.output().split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'preflight'
    });
    expect(stdout.output()).not.toContain(dirtyOutput);
    expect(stdout.output()).not.toMatch(/SENTINEL|\/Users\//u);
  });

  it('refuses to bind evidence when the commit changes during the live run', async () => {
    const stdout = captureStream();
    const inspectGit = vi
      .fn()
      .mockResolvedValueOnce({ clean: true, commit: COMMIT, tree: TREE })
      .mockResolvedValueOnce({ clean: true, commit: '3'.repeat(40), tree: '4'.repeat(40) });
    const deps = dependencies({ inspectGit });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(inspectGit).toHaveBeenCalledTimes(2);
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'attestation'
    });
  });

  it('writes only after lifecycle, cleanup, and residue pass, with no private data in the document', async () => {
    const order = [];
    let writtenInput;
    const stdout = captureStream();
    const deps = dependencies({
      runInstalled: vi.fn(async () => {
        order.push('lifecycle');
        return lifecycleChecks();
      }),
      stopVm: vi.fn(async () => {
        order.push('stop');
        return { state: 'stopped', cleaned: true };
      }),
      removeTemporaryRoot: vi.fn(async () => {
        order.push('remove');
      }),
      verifyResidue: vi.fn(async () => {
        order.push('residue');
        return true;
      }),
      writeAttestation: vi.fn(async (_path, input) => {
        order.push('write');
        writtenInput = input;
      })
    });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    expect(order).toEqual(['lifecycle', 'stop', 'remove', 'residue', 'write']);
    expect(deps.writeAttestation).toHaveBeenCalledWith(deps.attestationPath, expect.any(Object));
    expect(writtenInput).toEqual(attestationInput());
    expect(serializeVmAttestation(writtenInput)).not.toMatch(
      /\/Users\/|\/home\/|SENTINEL|CONNECTION|private-state|attestationPath/iu
    );
  });

  it.each(['lifecycle', 'vm cleanup', 'residue'])(
    'does not write when %s proof fails',
    async (failure) => {
      const stdout = captureStream();
      const deps = dependencies({
        runInstalled:
          failure === 'lifecycle'
            ? vi.fn(async () => ({ ...lifecycleChecks(), aliasPresent: false }))
            : vi.fn(async () => lifecycleChecks()),
        stopVm:
          failure === 'vm cleanup'
            ? vi.fn(async () => ({ state: 'stopped', cleaned: false }))
            : vi.fn(async () => ({ state: 'stopped', cleaned: true })),
        verifyResidue: vi.fn(async () => failure !== 'residue')
      });

      await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

      expect(deps.writeAttestation).not.toHaveBeenCalled();
    }
  );

  it('writes through a same-directory temporary file and atomically replaces the destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-attestation-'));
    FIXTURE_ROOTS.push(root);
    const outputPath = join(root, 'product3-vm.json');
    await writeFile(outputPath, 'old\n', 'utf8');

    await writeVmAttestationAtomic(outputPath, attestationInput());

    expect(await readFile(outputPath, 'utf8')).toBe(serializeVmAttestation(attestationInput()));
    expect(await readdir(root)).toEqual(['product3-vm.json']);
  });

  it('cleans the same-directory temporary file when the atomic rename fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-attestation-'));
    FIXTURE_ROOTS.push(root);
    const outputPath = join(root, 'product3-vm.json');
    await writeFile(outputPath, 'old\n', 'utf8');

    await expect(
      writeVmAttestationAtomic(outputPath, attestationInput(), {
        renameFile: async () => {
          throw new Error('rename failed');
        }
      })
    ).rejects.toThrow('VM_ATTESTATION_WRITE_FAILED');

    expect(await readFile(outputPath, 'utf8')).toBe('old\n');
    expect(await readdir(root)).toEqual(['product3-vm.json']);
  });

  it('creates a missing output parent and still leaves only the final atomic file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-attestation-'));
    FIXTURE_ROOTS.push(root);
    const missingParent = join(root, 'missing');
    const outputPath = join(missingParent, 'product3-vm.json');

    await writeVmAttestationAtomic(outputPath, attestationInput());

    expect(await readFile(outputPath, 'utf8')).toBe(serializeVmAttestation(attestationInput()));
    expect(await readdir(root)).toEqual(['missing']);
    expect(await readdir(missingParent)).toEqual(['product3-vm.json']);
  });

  it('fsyncs every created output directory and its pre-existing parent', async () => {
    const events = [];
    const outputPath = '/safe/docs/evidence/product3-vm.json';
    const fileHandle = {
      writeFile: vi.fn(async () => {
        events.push('write-file');
      }),
      sync: vi.fn(async () => {
        events.push('sync-file');
      }),
      close: vi.fn(async () => {
        events.push('close-file');
      })
    };

    await writeVmAttestationAtomic(outputPath, attestationInput(), {
      makeDirectory: vi.fn(async (path) => {
        events.push(`mkdir:${path}`);
        return '/safe/docs';
      }),
      openFile: vi.fn(async (path) => {
        events.push(`open:${path}`);
        return fileHandle;
      }),
      randomBytes: () => Buffer.alloc(16),
      renameFile: vi.fn(async (source, destination) => {
        events.push(`rename:${source}->${destination}`);
      }),
      syncDirectory: vi.fn(async (path) => {
        events.push(`sync-directory:${path}`);
      })
    });

    expect(events).toEqual([
      'mkdir:/safe/docs/evidence',
      'open:/safe/docs/evidence/.product3-vm.json.pending-00000000000000000000000000000000',
      'write-file',
      'sync-file',
      'close-file',
      'rename:/safe/docs/evidence/.product3-vm.json.pending-00000000000000000000000000000000->/safe/docs/evidence/product3-vm.json',
      'sync-directory:/safe/docs/evidence',
      'sync-directory:/safe/docs',
      'sync-directory:/safe'
    ]);
  });
});
