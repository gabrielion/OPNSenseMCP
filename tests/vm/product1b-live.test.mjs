// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATED_OPERATION_DESCRIPTORS } from '../../src/operations/generated/descriptors.ts';

import {
  inspectReadResult,
  installCurrentPackage,
  runInstalledReads,
  runProduct1bLive
} from '../../scripts/vm/product1b-live.mjs';

afterEach(() => {
  vi.useRealTimers();
});

function captureStream() {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  return { stream, output: () => output };
}

const systemStatusDescriptor = GENERATED_OPERATION_DESCRIPTORS.find(
  ({ key }) => key === 'system.status'
);
if (systemStatusDescriptor === undefined) throw new Error('Missing system.status descriptor');

function systemStatusDescription() {
  const {
    key,
    label,
    category,
    description,
    requiredPlugin,
    requiredFeatures,
    operations,
    contractDigest
  } = systemStatusDescriptor;
  return {
    mode: 'resource',
    resource: {
      key,
      label,
      category,
      description,
      requiredPlugin,
      requiredFeatures,
      operations,
      contractDigest
    }
  };
}

function listToolsResult() {
  return {
    tools: ['server_status', 'opn_describe', 'opn_get', 'opn_list'].map((name) => ({
      name,
      description: `${name} fixture`,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }))
  };
}

function toolResult(structuredContent) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function refusalToolResult(code) {
  return {
    isError: true,
    content: [{ type: 'text', text: 'Capability refused.' }],
    structuredContent: { code }
  };
}

function successfulReadResult() {
  return {
    tools: listToolsResult(),
    serverStatus: toolResult({ status: 'ok', readOnly: true, version: '0.1.0' }),
    resourceDescription: toolResult(systemStatusDescription()),
    systemStatus: toolResult({ item: { status: 'ok' } }),
    servicesPage: toolResult({
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
    })
  };
}

const successfulChecks = Object.freeze({
  readOnlySurface: true,
  serverStatus: true,
  resourceDescription: true,
  systemStatus: true,
  servicesPage: true
});

function mutateToolResult(resultKey, mutate) {
  const result = structuredClone(successfulReadResult());
  mutate(result[resultKey].structuredContent);
  result[resultKey].content = [
    { type: 'text', text: JSON.stringify(result[resultKey].structuredContent) }
  ];
  return result;
}

function expectOnlyFailed(result, check) {
  expect(inspectReadResult(result)).toEqual({ ...successfulChecks, [check]: false });
}

function sdkProcessHarness({
  exitCode = 0,
  signalCode = null,
  failHandshake = false,
  failTool,
  holdConnect = false,
  holdRequest = false,
  holdClose = false,
  closeSettlement,
  closeStarted,
  stderrChunks = [],
  events
} = {}) {
  const responses = successfulReadResult();
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
    closeStarted?.();
    if (closeSettlement !== undefined) await closeSettlement;
    transport._process = undefined;
    child.exitCode = exitCode;
    child.signalCode = signalCode;
    child.emit('close', exitCode, signalCode);
  });
  transport.close = closeTransport;
  let connectedTransport;
  const client = {
    connect: vi.fn(async (candidate) => {
      connectedTransport = candidate;
      await candidate.start();
      if (failHandshake) {
        void client.close();
        throw new Error('SENTINEL_HANDSHAKE_FAILURE');
      }
      if (holdConnect) return new Promise(() => undefined);
    }),
    listTools: vi.fn(async () => {
      if (holdRequest) return new Promise(() => undefined);
      events?.push('listTools');
      return responses.tools;
    }),
    callTool: vi.fn(async (request) => {
      const { name } = request;
      events?.push(request);
      if (name === failTool) throw new Error('SENTINEL_TOOL_FAILURE');
      return responses[
        {
          server_status: 'serverStatus',
          opn_describe: 'resourceDescription',
          opn_get: 'systemStatus',
          opn_list: 'servicesPage'
        }[name]
      ];
    }),
    close: vi.fn(async () => {
      events?.push('close');
      return connectedTransport?.close();
    })
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
    closeTransport
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
      arguments: [],
      cwd: `${temporaryRoot}/consumer`
    })),
    runInstalled: vi.fn(async () => successfulReadResult()),
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
  it('opens one official MCP session, calls the four tools in order, and closes it', async () => {
    const events = [];
    const responses = successfulReadResult();
    const harness = sdkProcessHarness({ events });

    const result = await runInstalledReads({
      invocation: {
        command: '/private/SENTINEL_INSTALLED_COMMAND',
        arguments: [],
        cwd: '/private/SENTINEL_CONSUMER'
      },
      configPath: '/private/SENTINEL_CONNECTION.json',
      sdkFactories: harness.sdkFactories
    });

    expect(result).toEqual(responses);
    expect(Object.isFrozen(result)).toBe(true);

    expect(events).toEqual([
      'listTools',
      { name: 'server_status', arguments: {} },
      { name: 'opn_describe', arguments: { resource: 'system.status' } },
      { name: 'opn_get', arguments: { resource: 'system.status' } },
      {
        name: 'opn_list',
        arguments: { resource: 'core.services', page: 1, pageSize: 10, query: '' }
      },
      'close'
    ]);
    expect(harness.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          READ_ONLY: 'true',
          OPNSENSE_CONFIG_FILE: '/private/SENTINEL_CONNECTION.json',
          MCP_REQUEST_STATE_SECRET: expect.stringMatching(/^[A-Za-z0-9_-]+$/u)
        })
      })
    );
  });

  it('passes the installed consumer cwd to the stdio transport', async () => {
    const harness = sdkProcessHarness();

    await runInstalledReads({
      invocation: {
        command: '/private/SENTINEL_INSTALLED_COMMAND',
        arguments: [],
        cwd: '/private/SENTINEL_CONSUMER'
      },
      configPath: '/private/SENTINEL_CONNECTION.json',
      sdkFactories: harness.sdkFactories
    });

    expect(harness.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/private/SENTINEL_CONSUMER' })
    );
  });

  it('fails closed before transport creation when the invocation cwd is absent or invalid', async () => {
    for (const cwd of [undefined, '', 'relative/consumer']) {
      const harness = sdkProcessHarness();
      await expect(
        runInstalledReads({
          invocation: {
            command: '/private/SENTINEL_INSTALLED_COMMAND',
            arguments: [],
            ...(cwd === undefined ? {} : { cwd })
          },
          configPath: '/private/SENTINEL_CONNECTION.json',
          sdkFactories: harness.sdkFactories
        })
      ).rejects.toThrow(/^Installed read failed$/);
      expect(harness.createTransport).not.toHaveBeenCalled();
    }
  });

  it.each(['tool failure', 'stderr output'])(
    'closes the installed MCP session and fails safely after %s',
    async (condition) => {
      const harness = sdkProcessHarness({
        failTool: condition === 'tool failure' ? 'opn_describe' : undefined,
        stderrChunks: condition === 'stderr output' ? [Buffer.from('x')] : []
      });

      await expect(
        runInstalledReads({
          invocation: {
            command: '/private/SENTINEL_INSTALLED_COMMAND',
            arguments: [],
            cwd: '/private/SENTINEL_CONSUMER'
          },
          configPath: '/private/SENTINEL_CONNECTION.json',
          sdkFactories: harness.sdkFactories
        })
      ).rejects.toThrow(/^Installed read failed$/);

      expect(harness.closeClient).toHaveBeenCalledOnce();
      expect(harness.closeTransport).toHaveBeenCalledOnce();
    }
  );

  it('rejects an installed MCP process that exits with code 1', async () => {
    const harness = sdkProcessHarness({ exitCode: 1 });

    await expect(
      runInstalledReads({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_COMMAND',
          arguments: [],
          cwd: '/private/SENTINEL_CONSUMER'
        },
        configPath: '/private/SENTINEL_CONNECTION.json',
        sdkFactories: harness.sdkFactories
      })
    ).rejects.toThrow(/^Installed read failed$/);

    expect(harness.createTransport).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
  });

  it('rejects an installed MCP process terminated by a signal', async () => {
    const harness = sdkProcessHarness({ exitCode: null, signalCode: 'SIGTERM' });

    await expect(
      runInstalledReads({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_COMMAND',
          arguments: [],
          cwd: '/private/SENTINEL_CONSUMER'
        },
        configPath: '/private/SENTINEL_CONNECTION.json',
        sdkFactories: harness.sdkFactories
      })
    ).rejects.toThrow(/^Installed read failed$/);

    expect(harness.createTransport).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
  });

  it('deduplicates handshake and runner client and transport closes', async () => {
    const harness = sdkProcessHarness({ failHandshake: true });

    await expect(
      runInstalledReads({
        invocation: {
          command: '/private/SENTINEL_INSTALLED_COMMAND',
          arguments: [],
          cwd: '/private/SENTINEL_CONSUMER'
        },
        configPath: '/private/SENTINEL_CONNECTION.json',
        sdkFactories: harness.sdkFactories
      })
    ).rejects.toThrow(/^Installed read failed$/);

    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
  });

  it.each(['connect', 'request'])('bounds a held installed MCP %s', async (heldStage) => {
    vi.useFakeTimers();
    const harness = sdkProcessHarness({
      holdConnect: heldStage === 'connect',
      holdRequest: heldStage === 'request'
    });
    const run = runInstalledReads({
      invocation: {
        command: '/private/SENTINEL_INSTALLED_COMMAND',
        arguments: [],
        cwd: '/private/SENTINEL_CONSUMER'
      },
      configPath: '/private/SENTINEL_CONNECTION.json',
      sdkFactories: harness.sdkFactories,
      operationTimeoutMs: 1_000
    });
    const rejection = expect(run).rejects.toThrow(/^Installed read failed$/);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
  });

  it('bounds a held installed MCP process close', async () => {
    vi.useFakeTimers();
    const harness = sdkProcessHarness({ holdClose: true });
    const run = runInstalledReads({
      invocation: {
        command: '/private/SENTINEL_INSTALLED_COMMAND',
        arguments: [],
        cwd: '/private/SENTINEL_CONSUMER'
      },
      configPath: '/private/SENTINEL_CONNECTION.json',
      sdkFactories: harness.sdkFactories,
      closeTimeoutMs: 1_000
    });
    const rejection = expect(run).rejects.toThrow(/^Installed read failed$/);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
    expect(harness.child.kill).toHaveBeenCalledOnce();
    expect(harness.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(harness.child.signalCode).toBe('SIGKILL');
    expect(harness.child.listenerCount('close')).toBe(0);
  });

  it('fails closed without console noise when the server omits its tools capability', async () => {
    const harness = sdkProcessHarness();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    harness.client.listTools.mockImplementation(async () => {
      const clientOptions = harness.createClient.mock.calls[0]?.[1];
      if (clientOptions?.enforceStrictCapabilities !== true) {
        console.debug('SENTINEL_MISSING_TOOLS_CAPABILITY');
        return successfulReadResult().tools;
      }
      throw new Error('SENTINEL_MISSING_TOOLS_CAPABILITY');
    });

    try {
      await expect(
        runInstalledReads({
          invocation: {
            command: '/private/SENTINEL_INSTALLED_COMMAND',
            arguments: [],
            cwd: '/private/SENTINEL_CONSUMER'
          },
          configPath: '/private/SENTINEL_CONNECTION.json',
          sdkFactories: harness.sdkFactories
        })
      ).rejects.toThrow(/^Installed read failed$/);

      expect(harness.createClient).toHaveBeenCalledWith(
        { name: 'product1b-live', version: '0.1.0' },
        {
          capabilities: {},
          enforceStrictCapabilities: true,
          versionNegotiation: { mode: 'legacy' }
        }
      );
      expect(debug).not.toHaveBeenCalled();
      expect(harness.closeTransport).toHaveBeenCalledOnce();
    } finally {
      debug.mockRestore();
    }
  });

  it('rejects an abort that arrives while the MCP client is closing', async () => {
    const controller = new AbortController();
    let markCloseStarted;
    let releaseClose;
    const closeStarted = new Promise((resolve) => {
      markCloseStarted = resolve;
    });
    const heldClose = new Promise((resolve) => {
      releaseClose = resolve;
    });
    const harness = sdkProcessHarness({
      closeSettlement: heldClose,
      closeStarted: markCloseStarted
    });
    const run = runInstalledReads({
      invocation: {
        command: '/private/SENTINEL_INSTALLED_COMMAND',
        arguments: [],
        cwd: '/private/SENTINEL_CONSUMER'
      },
      configPath: '/private/SENTINEL_CONNECTION.json',
      signal: controller.signal,
      sdkFactories: harness.sdkFactories
    });

    await closeStarted;
    controller.abort();
    releaseClose();

    await expect(run).rejects.toThrow(/^Installed read failed$/);
    expect(harness.closeClient).toHaveBeenCalledOnce();
    expect(harness.closeTransport).toHaveBeenCalledOnce();
  });

  it('accepts the exact generated system.status projection and bounded read results', () => {
    expect(inspectReadResult(successfulReadResult())).toEqual(successfulChecks);
  });

  it.each([
    [
      'the input schema changes',
      (description) => {
        description.resource.operations[0].inputSchema.properties = {
          poison: { type: 'string' }
        };
      }
    ],
    [
      'the output schema changes',
      (description) => {
        description.resource.operations[0].outputSchema.properties.item.properties.status.maxLength = 63;
      }
    ],
    [
      'the input schema digest changes',
      (description) => {
        description.resource.operations[0].inputSchemaDigest = '0'.repeat(64);
      }
    ],
    [
      'the output schema digest changes',
      (description) => {
        description.resource.operations[0].outputSchemaDigest = '0'.repeat(64);
      }
    ],
    [
      'the contract digest changes',
      (description) => {
        description.resource.contractDigest = '0'.repeat(64);
      }
    ]
  ])('rejects only the resource description when %s', (_label, mutate) => {
    expectOnlyFailed(mutateToolResult('resourceDescription', mutate), 'resourceDescription');
  });

  it.each([
    [
      'server status is not read-only',
      'serverStatus',
      (status) => {
        status.readOnly = false;
      }
    ],
    [
      'system status exceeds its bound',
      'systemStatus',
      (status) => {
        status.item.status = 'x'.repeat(65);
      }
    ],
    [
      'page total is lower than the returned item count',
      'servicesPage',
      (page) => {
        page.total = 0;
      }
    ],
    [
      'a service status is outside the closed vocabulary',
      'servicesPage',
      (page) => {
        page.items[0].status = 'maintenance';
      }
    ],
    [
      'a service name exceeds its bound',
      'servicesPage',
      (page) => {
        page.items[0].name = 'x'.repeat(129);
      }
    ]
  ])('keeps the other checks green when %s', (_label, check, mutate) => {
    expectOnlyFailed(mutateToolResult(check, mutate), check);
  });

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
        arguments: [],
        cwd: '/private/SENTINEL_TEMPORARY/consumer'
      },
      configPath: `${deps.instanceRoot}/SENTINEL_CONNECTION.json`,
      signal: expect.any(AbortSignal)
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
        serverStatus: true,
        resourceDescription: true,
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
        ...successfulReadResult(),
        serverStatus: refusalToolResult('SENTINEL_FAILURE')
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
    releaseRead(successfulReadResult());
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
        serverStatus: true,
        resourceDescription: true,
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
        arguments: [],
        cwd: join(temporaryRoot, 'consumer')
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
