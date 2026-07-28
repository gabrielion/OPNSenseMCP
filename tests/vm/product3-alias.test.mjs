// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SDK_STATE = vi.hoisted(() => ({ transportOptions: [] }));

vi.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: function StdioClientTransport(options) {
    SDK_STATE.transportOptions.push(options);
  }
}));

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    listCount = 0;

    setRequestHandler() {
      return undefined;
    }

    connect() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }

    async listTools() {
      return {
        tools: [
          'server_status',
          'opn_describe',
          'opn_get',
          'opn_list',
          'opn_create',
          'opn_delete'
        ].map((name) => ({ name, annotations: { readOnlyHint: false } }))
      };
    }

    async callTool({ name }) {
      if (name === 'opn_list') {
        this.listCount += 1;
        if (this.listCount === 2) {
          return {
            structuredContent: {
              page: 1,
              pageSize: 10,
              total: 1,
              items: [
                {
                  uuid: '00000000-0000-0000-0000-000000000001',
                  name: 'product3_vm_alias',
                  type: 'host',
                  description: 'Disposable Product 3 verification alias'
                }
              ]
            }
          };
        }
        return {
          structuredContent: { page: 1, pageSize: 10, total: 0, items: [] }
        };
      }
      if (name === 'opn_create') {
        return {
          structuredContent: {
            item: {
              uuid: '00000000-0000-0000-0000-000000000001',
              name: 'product3_vm_alias',
              type: 'host',
              content: ['192.0.2.10'],
              description: 'Disposable Product 3 verification alias'
            }
          }
        };
      }
      return {
        structuredContent: { item: { id: '00000000-0000-0000-0000-000000000001' } }
      };
    }
  }
}));

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
    startVm: vi.fn(async () => {
      calls.push('start');
      return { state: 'running' };
    }),
    readPassword: vi.fn(async () => 'SENTINEL_FACTORY_PASSWORD'),
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
      command: `${temporaryRoot}/consumer/node_modules/.bin/opnsense-mcp`,
      arguments: [],
      cwd: `${temporaryRoot}/consumer`
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

describe('Product 3 disposable-VM alias runner', () => {
  it('passes the installed consumer cwd to the stdio transport', async () => {
    SDK_STATE.transportOptions.length = 0;

    await expect(
      runInstalledAliasLifecycle({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_MCP',
          arguments: [],
          cwd: '/private/SENTINEL_CONSUMER'
        },
        configPath: '/private/SENTINEL_CONNECTION.json'
      })
    ).resolves.toEqual(lifecycleChecks());

    expect(SDK_STATE.transportOptions).toEqual([
      expect.objectContaining({ cwd: '/private/SENTINEL_CONSUMER' })
    ]);
  });

  it('fails closed before transport creation when the invocation cwd is absent', async () => {
    SDK_STATE.transportOptions.length = 0;

    await expect(
      runInstalledAliasLifecycle({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_MCP',
          arguments: []
        },
        configPath: '/private/SENTINEL_CONNECTION.json'
      })
    ).rejects.toThrow();
    expect(SDK_STATE.transportOptions).toEqual([]);
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
      prepareBase: deps.prepareBase
    });
    expect(deps.bootstrap).toHaveBeenCalledWith({
      consolePath: `${deps.instanceRoot}/console.sock`,
      factoryPassword: 'SENTINEL_FACTORY_PASSWORD',
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
    const calls = [];
    const close = vi.fn(async () => undefined);
    const client = {
      listTools: vi.fn(async () => ({
        tools: [
          'server_status',
          'opn_describe',
          'opn_get',
          'opn_list',
          'opn_create',
          'opn_delete'
        ].map((name) => ({ name, annotations: { readOnlyHint: false } }))
      })),
      callTool: vi.fn(async ({ name, arguments: args }) => {
        calls.push({ name, arguments: args });
        if (name === 'opn_list' && calls.length === 1) {
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
        if (name === 'opn_list' && calls.length === 3) {
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
        if (name === 'opn_delete') return toolResult({ item: { id: UUID } });
        return toolResult({ page: 1, pageSize: 10, total: 0, items: [] });
      }),
      close
    };
    const openClient = vi.fn(async ({ environment }) => {
      expect(environment.READ_ONLY).toBe('false');
      expect(environment.ENABLED_FEATURE_FLAGS).toBe('experimental-alias-write');
      expect(environment.ALLOWED_RESOURCES).toBe(
        'server.status,system.status,core.services,firewall.alias'
      );
      expect(environment.OPNSENSE_CONFIG_FILE).toBe('/private/SENTINEL_CONNECTION.json');
      expect(environment.MCP_REQUEST_STATE_SECRET).toMatch(/^[A-Za-z0-9_-]+$/u);
      return client;
    });

    await expect(
      runInstalledAliasLifecycle({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_MCP',
          arguments: [],
          cwd: '/private/SENTINEL_CONSUMER'
        },
        configPath: '/private/SENTINEL_CONNECTION.json',
        openClient
      })
    ).resolves.toEqual(lifecycleChecks());

    expect(calls).toEqual([
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
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['invalid writable surface', 'alias already present'])(
    'refuses before creation when the %s',
    async (condition) => {
      const callTool = vi.fn(async ({ name }) => {
        if (name === 'opn_list') {
          return toolResult({
            page: 1,
            pageSize: 10,
            total: condition === 'alias already present' ? 1 : 0,
            items:
              condition === 'alias already present'
                ? [{ uuid: UUID, name: 'existing', type: 'host', description: 'existing' }]
                : []
          });
        }
        throw new Error('opn_create must not be called');
      });
      const openClient = vi.fn(async () => ({
        listTools: vi.fn(async () => ({
          tools:
            condition === 'invalid writable surface'
              ? []
              : [
                  'server_status',
                  'opn_describe',
                  'opn_get',
                  'opn_list',
                  'opn_create',
                  'opn_delete'
                ].map((name) => ({ name, annotations: { readOnlyHint: false } }))
        })),
        callTool,
        close: vi.fn(async () => undefined)
      }));

      const result = await runInstalledAliasLifecycle({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_MCP',
          arguments: [],
          cwd: '/private/SENTINEL_CONSUMER'
        },
        configPath: '/private/SENTINEL_CONNECTION.json',
        openClient
      });

      expect(result.aliasCreated).toBe(false);
      expect(callTool).toHaveBeenCalledTimes(1);
      expect(callTool).toHaveBeenCalledWith(
        {
          name: 'opn_list',
          arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
        },
        expect.any(AbortSignal)
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
      'password',
      { readPassword: vi.fn(async () => Promise.reject(new Error('secret'))) },
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
