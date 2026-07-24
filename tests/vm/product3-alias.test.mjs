// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { runInstalledAliasLifecycle, runProduct3Alias } from '../../scripts/vm/product3-alias.mjs';
import { FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES } from '../../scripts/vm/product1b-bootstrap.mjs';

const UUID = '00000000-0000-0000-0000-000000000001';

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

function dependencies(overrides = {}) {
  const instanceRoot = '/private/SENTINEL_INSTANCE';
  const temporaryRoot = '/private/SENTINEL_TEMPORARY';
  const calls = [];
  return {
    instanceRoot,
    cacheRoot: '/private/SENTINEL_CACHE',
    repositoryRoot: '/private/SENTINEL_REPOSITORY',
    doctor: vi.fn(() => ({ ready: true, accelerator: 'tcg' })),
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
      arguments: []
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
    expect(deps.runInstalled).toHaveBeenCalledWith({
      invocation: {
        command: '/private/SENTINEL_TEMPORARY/consumer/node_modules/.bin/opnsense-mcp',
        arguments: []
      },
      configPath: `${deps.instanceRoot}/SENTINEL_CONNECTION.json`
    });
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);

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
      expect(environment.OPNSENSE_CONFIG_FILE).toBe('/private/SENTINEL_CONNECTION.json');
      expect(environment.MCP_REQUEST_STATE_SECRET).toMatch(/^[A-Za-z0-9_-]+$/u);
      return client;
    });

    await expect(
      runInstalledAliasLifecycle({
        invocation: { command: '/private/SENTINEL_INSTALLED_MCP', arguments: [] },
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

  it('fails closed before startup when the VM is not freshly stopped', async () => {
    const stdout = captureStream();
    const deps = dependencies({ statusVm: vi.fn(async () => ({ state: 'running' })) });

    await expect(runProduct3Alias({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.startVm).not.toHaveBeenCalled();
    expect(deps.stopVm).not.toHaveBeenCalled();
    expect(deps.removeTemporaryRoot).not.toHaveBeenCalled();
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
  });

  it('stops the owned VM when bootstrap fails before connection artifacts exist', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      bootstrap: vi.fn(async () => Promise.reject(new Error('SENTINEL_FAILURE')))
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

  it('wires vm:product3 to the disposable alias runner', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    expect(manifest.scripts['vm:product3']).toBe('node scripts/vm/product3-alias.mjs');
  });
});
