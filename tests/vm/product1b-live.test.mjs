// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { installCurrentPackage, runProduct1bLive } from '../../scripts/vm/product1b-live.mjs';

function captureStream() {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  return { stream, output: () => output };
}

function successfulProtocolResult() {
  const responses = [
    { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } },
    {
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: ['server_status', 'opn_describe', 'opn_get', 'opn_list'].map((name) => ({
          name,
          annotations: { readOnlyHint: true }
        }))
      }
    },
    {
      jsonrpc: '2.0',
      id: 3,
      result: { structuredContent: { item: { status: 'ok' } } }
    },
    {
      jsonrpc: '2.0',
      id: 4,
      result: {
        structuredContent: {
          page: 1,
          pageSize: 10,
          total: 1,
          items: [
            {
              id: 'SENTINEL_SERVICE_ID',
              name: 'SENTINEL_SERVICE_NAME',
              description: 'SENTINEL_SERVICE_DESCRIPTION',
              status: 'running'
            }
          ]
        }
      }
    }
  ];
  return {
    code: 0,
    signal: null,
    stderr: '',
    stdout: `${responses.map((response) => JSON.stringify(response)).join('\n')}\n`
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
      return { state: 'running', api: { host: '127.0.0.1', port: 18443 } };
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
    runInstalled: vi.fn(async () => successfulProtocolResult()),
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

describe('Product 1B one-command live runner', () => {
  it('runs the installed read-only product against one fresh VM and emits one sanitized summary', async () => {
    const stdout = captureStream();
    const deps = dependencies();

    await expect(runProduct1bLive({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    expect(deps.statusVm).toHaveBeenCalledWith({ instanceRoot: deps.instanceRoot });
    expect(deps.startVm).toHaveBeenCalledWith({
      instanceRoot: deps.instanceRoot,
      rawPath: `${deps.cacheRoot}/OPNsense-26.1.6-nano-amd64.img`,
      accelerator: 'tcg',
      prepareBase: deps.prepareBase
    });
    expect(deps.bootstrap).toHaveBeenCalledWith({
      consolePath: `${deps.instanceRoot}/console.sock`,
      factoryPassword: 'SENTINEL_FACTORY_PASSWORD'
    });
    expect(deps.createArtifacts).toHaveBeenCalledWith({
      instanceRoot: deps.instanceRoot,
      credentials: {
        key: 'SENTINEL_API_KEY',
        secret: 'SENTINEL_API_SECRET',
        serverName: 'OPNsense.internal'
      }
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
        readOnlySurface: true,
        systemStatus: true,
        servicesPage: true,
        vmStopped: true,
        residueFree: true
      }
    });
    expect(output).not.toMatch(/SENTINEL|\/private|opnsense\.internal/iu);
  });

  it('still stops the VM and removes package files when a live read fails', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      runInstalled: vi.fn(async () => ({
        ...successfulProtocolResult(),
        stdout: `${JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          result: { isError: true, structuredContent: { code: 'SENTINEL_FAILURE' } }
        })}\n`
      }))
    });

    await expect(runProduct1bLive({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.stopVm).toHaveBeenCalledOnce();
    expect(deps.removeTemporaryRoot).toHaveBeenCalledOnce();
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    const summary = JSON.parse(stdout.output());
    expect(summary.status).toBe('failed');
    expect(summary.failureStage).toBe('reads');
    expect(summary.checks.vmStopped).toBe(true);
    expect(summary.checks.residueFree).toBe(true);
    expect(stdout.output()).not.toMatch(/SENTINEL|\/private/iu);
  });

  it('waits for cleanup and removes signal handlers after an interrupted live run', async () => {
    const stdout = captureStream();
    const signalSource = new EventEmitter();
    let releaseRead;
    let markReadStarted;
    const readStarted = new Promise((resolve) => {
      markReadStarted = resolve;
    });
    const heldRead = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const deps = dependencies({
      signalSource,
      runInstalled: vi.fn(async () => {
        markReadStarted();
        return heldRead;
      })
    });

    const run = runProduct1bLive({ ...deps, stdout: stdout.stream });
    await readStarted;
    expect(signalSource.listenerCount('SIGINT')).toBe(1);
    expect(signalSource.listenerCount('SIGTERM')).toBe(1);

    signalSource.emit('SIGTERM');
    await Promise.resolve();

    expect(deps.stopVm).not.toHaveBeenCalled();
    releaseRead(successfulProtocolResult());
    await expect(run).resolves.toBe(3);

    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    expect(deps.verifyResidue).toHaveBeenCalledOnce();
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    expect(JSON.parse(stdout.output())).toEqual({
      schemaVersion: 1,
      status: 'failed',
      failureStage: 'interrupted',
      checks: {
        doctor: true,
        vmStarted: true,
        bootstrap: true,
        packageInstalled: true,
        readOnlySurface: true,
        systemStatus: true,
        servicesPage: true,
        vmStopped: true,
        residueFree: true
      }
    });
    expect(stdout.output()).not.toMatch(/SIGTERM|SENTINEL|\/private/iu);
  });

  it('cancels the default password prompt before cleaning an interrupted VM', async () => {
    const input = new PassThrough();
    const stdout = captureStream();
    const stderr = captureStream();
    const signalSource = new EventEmitter();
    const deps = dependencies({ readPassword: undefined, signalSource });
    const run = runProduct1bLive({
      ...deps,
      input,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    await vi.waitFor(() => expect(stderr.output()).toBe('OPNsense factory password: '));
    expect(input.listenerCount('data')).toBe(1);
    signalSource.emit('SIGTERM');
    const listenersAfterSignal = {
      data: input.listenerCount('data'),
      end: input.listenerCount('end'),
      error: input.listenerCount('error')
    };
    input.end('SENTINEL_FACTORY_PASSWORD\n');

    await expect(run).resolves.toBe(3);
    expect(listenersAfterSignal).toEqual({ data: 0, end: 0, error: 0 });
    expect(deps.bootstrap).not.toHaveBeenCalled();
    expect(deps.calls).toEqual(['start', 'stop']);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'interrupted',
      checks: { vmStarted: true, bootstrap: false, vmStopped: true, residueFree: true }
    });
    expect(`${stdout.output()}${stderr.output()}`).not.toMatch(/SENTINEL|\/private/iu);
  });

  it('does not start another live stage after the interrupted stage settles', async () => {
    const stdout = captureStream();
    const signalSource = new EventEmitter();
    let releaseStart;
    let markStartCalled;
    const startCalled = new Promise((resolve) => {
      markStartCalled = resolve;
    });
    const heldStart = new Promise((resolve) => {
      releaseStart = resolve;
    });
    const deps = dependencies({
      signalSource,
      startVm: vi.fn(async () => {
        deps.calls.push('start');
        markStartCalled();
        return heldStart;
      })
    });

    const run = runProduct1bLive({ ...deps, stdout: stdout.stream });
    await startCalled;
    signalSource.emit('SIGINT');
    releaseStart({ state: 'running' });

    await expect(run).resolves.toBe(3);
    expect(deps.readPassword).not.toHaveBeenCalled();
    expect(deps.bootstrap).not.toHaveBeenCalled();
    expect(deps.calls).toEqual(['start', 'stop']);
    expect(deps.verifyResidue).toHaveBeenCalledOnce();
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    expect(JSON.parse(stdout.output()).status).toBe('failed');
    expect(stdout.output()).not.toMatch(/SIGINT|SENTINEL|\/private/iu);
  });

  it('prompts on stderr while reading the factory password without reflecting it', async () => {
    const input = new PassThrough();
    const stdout = captureStream();
    const stderr = captureStream();
    const deps = dependencies({ readPassword: undefined });
    input.end('SENTINEL_FACTORY_PASSWORD\n');

    await expect(
      runProduct1bLive({ ...deps, input, stdout: stdout.stream, stderr: stderr.stream })
    ).resolves.toBe(0);

    expect(stderr.output()).toBe('OPNsense factory password: ');
    expect(stderr.output()).not.toContain('SENTINEL');
    expect(stdout.output().split('\n').filter(Boolean)).toHaveLength(1);
    expect(deps.bootstrap).toHaveBeenCalledWith({
      consolePath: `${deps.instanceRoot}/console.sock`,
      factoryPassword: 'SENTINEL_FACTORY_PASSWORD'
    });
  });

  it('wires the package command directly to the live runner', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    expect(manifest.scripts['test:product1b']).toBe('node scripts/vm/product1b-live.mjs');
  });

  it('packs the current project and installs its tarball offline without lifecycle scripts', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'product1b-package-wiring-'));
    await chmod(temporaryRoot, 0o700);
    const calls = [];
    const runCommand = vi.fn(async (invocation, options) => {
      calls.push({ invocation, options });
      if (calls.length === 1) {
        await writeFile(join(temporaryRoot, 'gabrielion-opnsense-mcp-0.1.0.tgz'), 'fixture');
      }
      return { code: 0, signal: null, stdout: '', stderr: 'npm notice: synthetic output\n' };
    });

    try {
      await expect(
        installCurrentPackage({
          repositoryRoot: '/private/fixture-repository',
          temporaryRoot,
          nodeExecutable: '/private/node-22',
          npmCli: '/private/npm-cli.js',
          runCommand
        })
      ).resolves.toEqual({
        command: join(temporaryRoot, 'consumer', 'node_modules', '.bin', 'opnsense-mcp'),
        arguments: []
      });

      expect(calls[0]).toMatchObject({
        invocation: {
          command: '/private/node-22',
          arguments: ['/private/npm-cli.js', 'pack', '--json', '--pack-destination', temporaryRoot]
        },
        options: { cwd: '/private/fixture-repository', input: '' }
      });
      expect(calls[1]).toMatchObject({
        invocation: {
          command: '/private/node-22',
          arguments: [
            '/private/npm-cli.js',
            'install',
            '--ignore-scripts',
            '--offline',
            '--no-audit',
            '--no-fund',
            '--no-package-lock',
            '--no-save',
            join(temporaryRoot, 'gabrielion-opnsense-mcp-0.1.0.tgz')
          ]
        },
        options: { cwd: join(temporaryRoot, 'consumer'), input: '' }
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
