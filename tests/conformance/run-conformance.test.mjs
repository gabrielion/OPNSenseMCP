// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let runner;
beforeAll(async () => {
  runner = await import('../../scripts/run-conformance.mjs');
});

const temporaryPaths = new Set();
const ownedResources = new Set();
const ownedPids = new Set();

const HTTP_LIMITS = Object.freeze({
  bodyBytes: 1024,
  bodyReceiptTimeoutMs: 2_000,
  headersTimeoutMs: 2_000,
  keepAliveTimeoutMs: 2_000,
  maxRequestsPerSocket: 100
});

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveDeferred, rejectDeferred) => {
    resolvePromise = resolveDeferred;
    rejectPromise = rejectDeferred;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function temporaryDirectory(prefix = 'opnsense-mcp-conformance-test-') {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.add(path);
  return path;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  ownedResources.add({
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections?.();
        server.close(() => resolveClose());
      })
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
  return address;
}

function rawRequest(port, chunks, { waitForEnd = true } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = connect(port, '127.0.0.1');
    const received = [];
    ownedResources.add({ close: () => Promise.resolve(socket.destroy()) });
    socket.on('data', (chunk) => received.push(chunk));
    socket.once('error', rejectRequest);
    socket.once('connect', () => {
      for (const chunk of chunks) socket.write(chunk);
      if (!waitForEnd) resolveRequest({ socket, received });
    });
    socket.once('end', () => resolveRequest(Buffer.concat(received).toString('latin1')));
    socket.once('close', () => {
      if (waitForEnd) resolveRequest(Buffer.concat(received).toString('latin1'));
    });
  });
}

async function pollProcessGone(pid, milliseconds = 3_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 20));
  }
  throw new Error('Child process remained alive');
}

function closeChild(pid) {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const pid of ownedPids) closeChild(pid);
  ownedPids.clear();
  await Promise.allSettled([...ownedResources].map((resource) => resource.close()));
  ownedResources.clear();
  await Promise.allSettled(
    [...temporaryPaths].map((path) => rm(path, { recursive: true, force: true }))
  );
  temporaryPaths.clear();
});

async function createAcceptedReport(stateDirectory, version, scenario, checks = undefined) {
  const runDirectory = join(
    stateDirectory,
    'results',
    version,
    scenario,
    `server-${scenario}-20260718T000000`
  );
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    join(runDirectory, 'checks.json'),
    JSON.stringify(checks ?? [{ status: 'SUCCESS' }, { status: 'INFO' }])
  );
  return runDirectory;
}

describe('exact conformance command contract', () => {
  it('publishes the exact versions, scenarios, sentinels, and report bound', () => {
    expect(runner.SCENARIOS_BY_VERSION).toEqual({
      '2025-11-25': ['server-initialize', 'ping', 'tools-list'],
      '2026-07-28': [
        'tools-list',
        'input-required-result-unsupported-methods',
        'http-header-validation'
      ]
    });
    expect(Object.isFrozen(runner.SCENARIOS_BY_VERSION)).toBe(true);
    expect(Object.values(runner.SCENARIOS_BY_VERSION).every(Object.isFrozen)).toBe(true);
    expect(runner.MAX_CONFORMANCE_REPORT_BYTES).toBe(1_048_576);
    expect(runner.MAX_PROXY_REQUESTS_PER_SOCKET).toBe(16);
    expect(Object.isFrozen(runner.CONFORMANCE_SENTINELS)).toBe(true);
  });

  it('builds all six complete official argv arrays without forbidden switches or secrets', () => {
    const executable = '/private/conformance/dist/index.js';
    const proxyUrl = 'http://127.0.0.1:45678/mcp';
    const stateDirectory = '/private/state';
    const invocations = Object.entries(runner.SCENARIOS_BY_VERSION).flatMap(
      ([version, scenarios]) =>
        scenarios.map((scenario) =>
          runner.buildScenarioArgv(executable, proxyUrl, version, scenario, stateDirectory)
        )
    );
    expect(invocations).toHaveLength(6);
    for (const invocation of invocations) {
      const version = invocation[7];
      const scenario = invocation[5];
      expect(invocation).toEqual([
        executable,
        'server',
        '--url',
        proxyUrl,
        '--scenario',
        scenario,
        '--spec-version',
        version,
        '--verbose',
        '--output-dir',
        join(stateDirectory, 'results', version, scenario)
      ]);
    }
    const flattened = invocations.flat().join('\n');
    for (const forbidden of [
      '--suite',
      '--force',
      '--expected-failures',
      'Authorization',
      ...Object.values(runner.CONFORMANCE_SENTINELS)
    ]) {
      expect(flattened).not.toContain(forbidden);
    }
  });

  it('spawns process.execPath once with the shared argv builder and exact options', async () => {
    const child = new EventEmitter();
    child.kill = vi.fn();
    child.unref = vi.fn();
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    });
    const input = {
      executable: '/official/index.js',
      proxyUrl: 'http://127.0.0.1:45678/mcp',
      version: '2025-11-25',
      scenario: 'ping',
      stateDirectory: '/private/state'
    };
    await runner.runConformanceChild(input, { spawnProcess });
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(spawnProcess).toHaveBeenCalledWith(
      process.execPath,
      runner.buildScenarioArgv(
        input.executable,
        input.proxyUrl,
        input.version,
        input.scenario,
        input.stateDirectory
      ),
      { stdio: 'inherit', env: process.env }
    );
  });
});

describe('raw loopback MCP URL parser', () => {
  it.each([1, 80, 65_535])(
    'accepts canonical explicit port %i without URL normalization',
    (port) => {
      const href = `http://127.0.0.1:${port}/mcp`;
      expect(runner.parseExactLoopbackMcpUrl(href)).toMatchObject({
        href,
        hostname: '127.0.0.1',
        port,
        host: `127.0.0.1:${port}`,
        pathname: '/mcp'
      });
      expect(Object.isFrozen(runner.parseExactLoopbackMcpUrl(href))).toBe(true);
    }
  );

  it('rejects every normalized, ambiguous, escaped, or non-canonical spelling', () => {
    const invalid = [
      'http://127.0.0.1/mcp',
      'http://127.0.0.1:0/mcp',
      'http://127.0.0.1:01/mcp',
      'http://127.0.0.1:080/mcp',
      'http://127.0.0.1:00080/mcp',
      'http://127.0.0.1:65536/mcp',
      'HTTP://127.0.0.1:80/mcp',
      'http://LOCALHOST:80/mcp',
      'http://localhost:80/mcp',
      'http://[::1]:80/mcp',
      'http://user@127.0.0.1:80/mcp',
      'http://127.0.0.1%3a80/mcp',
      'http://127.0.0.1:80/',
      'http://127.0.0.1:80/other',
      'http://127.0.0.1:80/mcp/',
      'http://127.0.0.1:80/mcp?',
      'http://127.0.0.1:80/mcp?x=1',
      'http://127.0.0.1:80/mcp#',
      'http://127.0.0.1:80/mcp#x',
      undefined,
      null
    ];
    for (const value of invalid) {
      expect(() => runner.parseExactLoopbackMcpUrl(value)).toThrow('Invalid loopback MCP URL');
    }
  });

  it('rejects raw boundary bytes before calling the URL constructor', () => {
    const canonical = 'http://127.0.0.1:80/mcp';
    const urlConstructor = vi.fn();
    vi.stubGlobal('URL', urlConstructor);
    try {
      for (const boundary of ['\n', '\r\n', '\t', ' ', '\0']) {
        expect(() => runner.parseExactLoopbackMcpUrl(`${boundary}${canonical}`)).toThrow(
          'Invalid loopback MCP URL'
        );
        expect(() => runner.parseExactLoopbackMcpUrl(`${canonical}${boundary}`)).toThrow(
          'Invalid loopback MCP URL'
        );
      }
      expect(urlConstructor).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('owned conformance environment', () => {
  it('replaces all owned names, restores exact presence, and leaves unrelated mutations alone', async () => {
    const stateDirectory = await temporaryDirectory();
    const environment = {
      OPNSENSE_URL: 'POISON_OPNSENSE',
      MCP_HTTP_TOKEN: 'POISON_TOKEN',
      ENABLE_SSH_FEATURES: 'POISON_ENABLE',
      IAC_ENABLED: 'POISON_IAC',
      READ_ONLY: 'POISON_READ_ONLY',
      ALLOWED_RESOURCES: 'POISON_RESOURCES',
      UNRELATED: 'before'
    };
    const owner = runner.installConformanceEnvironment(stateDirectory, environment);
    expect(environment).toMatchObject({
      READ_ONLY: 'true',
      ALLOWED_RESOURCES: '',
      ENABLED_FEATURE_FLAGS: '',
      AUTO_BACKUP: 'false',
      AUTO_BACKUP_STRICT: 'true',
      AUDIT_LOG_STRICT: 'true',
      MCP_HTTP_ENABLED: 'true',
      MCP_HTTP_HOST: '127.0.0.1',
      MCP_HTTP_PORT: '3000',
      MCP_LEGACY_SSE_ENABLED: 'false',
      MCP_ALLOWED_HOSTS: '127.0.0.1',
      MCP_ALLOWED_ORIGINS: '',
      OPNSENSE_URL: 'https://127.0.0.1:9/api',
      OPNSENSE_VERIFY_TLS: 'true',
      ENABLE_SSH_FEATURES: 'false',
      ENABLE_SHELL_TOOLS: 'false',
      ENABLE_RESTORE_TOOLS: 'false',
      IAC_ENABLED: 'false',
      BACKUP_PATH: join(stateDirectory, 'backups'),
      AUDIT_LOG: join(stateDirectory, 'audit.jsonl')
    });
    expect(JSON.stringify(environment)).not.toContain('POISON');
    environment.UNRELATED = 'after';
    environment.OPNSENSE_ADDED_DURING_RUN = 'owned';
    owner.restore();
    owner.restore();
    expect(environment).toEqual({
      OPNSENSE_URL: 'POISON_OPNSENSE',
      MCP_HTTP_TOKEN: 'POISON_TOKEN',
      ENABLE_SSH_FEATURES: 'POISON_ENABLE',
      IAC_ENABLED: 'POISON_IAC',
      READ_ONLY: 'POISON_READ_ONLY',
      ALLOWED_RESOURCES: 'POISON_RESOURCES',
      UNRELATED: 'after'
    });
  });

  it('rolls back a partial assignment failure transactionally', async () => {
    const stateDirectory = await temporaryDirectory();
    const target = { OPNSENSE_URL: 'before', UNRELATED: 'kept' };
    let throwsRemaining = 1;
    const environment = new Proxy(target, {
      set(object, property, value) {
        if (property === 'MCP_HTTP_ENABLED' && throwsRemaining-- > 0) {
          throw new Error('POISON_ASSIGNMENT');
        }
        return Reflect.set(object, property, value);
      }
    });
    expect(() => runner.installConformanceEnvironment(stateDirectory, environment)).toThrow();
    expect(target).toEqual({ OPNSENSE_URL: 'before', UNRELATED: 'kept' });
  });
});

describe('real foundation product preflight', () => {
  function exactCapability() {
    return {
      id: 'server.status',
      mcpName: 'server_status',
      title: 'Server status',
      description: 'Report whether the MCP server is healthy and operating in read-only mode.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      transports: ['stdio', 'http'],
      policy: {
        effect: 'read',
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 1_000,
        resourceScopes: ['server.status'],
        requiredFeatureFlags: [],
        redactFields: []
      },
      parseInput(value) {
        if (value === null || typeof value !== 'object' || Object.keys(value).length !== 0) {
          throw new Error('strict');
        }
        return {};
      }
    };
  }

  const success = Object.freeze({
    kind: 'success',
    output: { status: 'ok', readOnly: true, version: '0.1.0' }
  });

  it('accepts exact first-object identity, strict input, policy metadata, and dispatched output', async () => {
    const expected = exactCapability();
    const list = vi.fn(() => [expected]);
    const dispatch = vi.fn(async () => success);
    await runner.assertConformanceProductContract({}, { expected, list, dispatch });
    expect(list).toHaveBeenCalledWith({}, 'http');
    expect(dispatch).toHaveBeenCalledWith(
      {},
      { name: 'server_status', arguments: {} },
      { transport: 'http', principalId: 'conformance:preflight' }
    );
  });

  it.each([
    ['ordering', (capability) => [exactCapability(), capability]],
    ['identity', () => [exactCapability()]],
    ['name', (capability) => ((capability.mcpName = 'changed'), [capability])],
    ['policy', (capability) => ((capability.policy.effect = 'write'), [capability])],
    ['annotation', (capability) => ((capability.annotations.openWorldHint = true), [capability])],
    ['transport', (capability) => ((capability.transports = ['http']), [capability])],
    [
      'schema',
      (capability) => ((capability.parseInput = () => ({ unexpected: true })), [capability])
    ]
  ])('fails closed with one stable error for %s drift', async (_label, expose) => {
    const expected = exactCapability();
    const error = await runner
      .assertConformanceProductContract(
        {},
        {
          expected,
          list: () => expose(expected),
          dispatch: async () => success
        }
      )
      .catch((reason) => reason);
    expect({ name: error.name, message: error.message }).toEqual({
      name: 'ConformanceProductContractError',
      message: 'Conformance product contract is unavailable'
    });
  });

  it.each([
    { kind: 'refusal', error: { code: 'READ_ONLY' } },
    { kind: 'confirmation', confirmation: {} },
    { kind: 'success', output: { status: 'ok', readOnly: false, version: '0.1.0' } },
    { kind: 'success', output: { status: 'ok', readOnly: true, version: 'changed' } }
  ])('fails closed on malformed dispatch result %#', async (result) => {
    const expected = exactCapability();
    await expect(
      runner.assertConformanceProductContract(
        {},
        {
          expected,
          list: () => [expected],
          dispatch: async () => result
        }
      )
    ).rejects.toMatchObject({ name: 'ConformanceProductContractError' });
  });

  it('passes once against the real default application and dispatch path', async () => {
    const stateDirectory = await temporaryDirectory();
    const owner = runner.installConformanceEnvironment(stateDirectory);
    try {
      const { createDefaultApplicationRuntime } = await import(
        '../../dist/app/default-application.js'
      );
      const applicationRuntime = createDefaultApplicationRuntime();
      ownedResources.add(applicationRuntime);
      await runner.assertConformanceProductContract(applicationRuntime.application);
    } finally {
      owner.restore();
    }
  });
});

describe('strict alpha.9 report evidence', () => {
  it('accepts exactly one real run report containing SUCCESS and INFO', async () => {
    const stateDirectory = await temporaryDirectory();
    await createAcceptedReport(stateDirectory, '2025-11-25', 'ping');
    await expect(
      runner.validateScenarioReport(stateDirectory, '2025-11-25', 'ping')
    ).resolves.toBeUndefined();
  });

  it.each([
    ['empty', []],
    ['record', {}],
    ['non-record', [null]],
    ['missing status', [{}]],
    ['no success', [{ status: 'INFO' }]],
    ['warning', [{ status: 'SUCCESS' }, { status: 'WARNING', message: 'POISON' }]],
    ['failure', [{ status: 'SUCCESS' }, { status: 'FAILURE' }]],
    ['skipped', [{ status: 'SUCCESS' }, { status: 'SKIPPED' }]],
    ['unknown', [{ status: 'SUCCESS' }, { status: 'POISON_STATUS' }]]
  ])('rejects %s report status evidence without retaining content', async (_label, checks) => {
    const stateDirectory = await temporaryDirectory();
    await createAcceptedReport(stateDirectory, '2025-11-25', 'ping', checks);
    const error = await runner
      .validateScenarioReport(stateDirectory, '2025-11-25', 'ping')
      .catch((reason) => reason);
    expect({ name: error.name, message: error.message }).toEqual({
      name: 'ConformanceReportError',
      message: 'Conformance scenario report is invalid'
    });
    expect(JSON.stringify(error)).not.toContain('POISON');
  });

  it('rejects missing, duplicate, malformed, empty, oversized, and non-regular reports', async () => {
    const version = '2025-11-25';
    const scenario = 'ping';
    const cases = [];

    cases.push(await temporaryDirectory());

    const duplicate = await temporaryDirectory();
    await createAcceptedReport(duplicate, version, scenario);
    await createAcceptedReport(duplicate, version, `${scenario}-extra`);
    const scenarioPath = join(duplicate, 'results', version, scenario);
    const secondRun = join(scenarioPath, `server-${scenario}-second`);
    await mkdir(secondRun);
    await writeFile(join(secondRun, 'checks.json'), '[{"status":"SUCCESS"}]');
    cases.push(duplicate);

    const malformed = await temporaryDirectory();
    const malformedRun = await createAcceptedReport(malformed, version, scenario);
    await writeFile(join(malformedRun, 'checks.json'), '{POISON');
    cases.push(malformed);

    const empty = await temporaryDirectory();
    const emptyRun = await createAcceptedReport(empty, version, scenario);
    await writeFile(join(emptyRun, 'checks.json'), '');
    cases.push(empty);

    const oversized = await temporaryDirectory();
    const oversizedRun = await createAcceptedReport(oversized, version, scenario);
    await writeFile(
      join(oversizedRun, 'checks.json'),
      Buffer.alloc(runner.MAX_CONFORMANCE_REPORT_BYTES + 1)
    );
    cases.push(oversized);

    const directoryReport = await temporaryDirectory();
    const directoryRun = await createAcceptedReport(directoryReport, version, scenario);
    await rm(join(directoryRun, 'checks.json'));
    await mkdir(join(directoryRun, 'checks.json'));
    cases.push(directoryReport);

    for (const stateDirectory of cases) {
      await expect(
        runner.validateScenarioReport(stateDirectory, version, scenario)
      ).rejects.toMatchObject({ name: 'ConformanceReportError' });
    }
  });

  it('rejects symlinks at every report path boundary', async () => {
    const stateDirectory = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await createAcceptedReport(outside, '2025-11-25', 'ping');
    await symlink(join(outside, 'results'), join(stateDirectory, 'results'));
    await expect(
      runner.validateScenarioReport(stateDirectory, '2025-11-25', 'ping')
    ).rejects.toMatchObject({ name: 'ConformanceReportError' });
  });
});

describe('raw streaming authentication proxy', () => {
  it('filters hop-by-hop headers in both directions and preserves duplicate MCP headers and chunks', async () => {
    let observed;
    let releaseSecond;
    const allowSecond = new Promise((resolveSecond) => {
      releaseSecond = resolveSecond;
    });
    const upstream = createServer((request, response) => {
      const body = [];
      request.on('data', (chunk) => body.push(chunk));
      request.on('end', async () => {
        observed = {
          method: request.method,
          url: request.url,
          rawHeaders: request.rawHeaders,
          body
        };
        response.writeHead(207, 'Custom', [
          'Connection',
          'X-Hop-Out-A',
          'Connection',
          'X-Hop-Out-B',
          'X-Hop-Out-A',
          'drop-a',
          'X-Hop-Out-B',
          'drop-b',
          'Content-Type',
          'text/event-stream',
          'Mcp-Session-Id',
          'one',
          'Mcp-Session-Id',
          'two'
        ]);
        response.write('data: one\n\n');
        await allowSecond;
        response.end('data: two\n\n');
      });
    });
    const upstreamAddress = await listen(upstream);
    const proxy = await runner.startLoopbackProxy(
      `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      runner.CONFORMANCE_SENTINELS.token,
      { ...HTTP_LIMITS, bodyBytes: 4 }
    );
    ownedResources.add(proxy);
    const { socket, received } = await rawRequest(
      runner.parseExactLoopbackMcpUrl(proxy.url).port,
      [
        'POST /mcp HTTP/1.1\r\n',
        'Host: hostile-a\r\nHost: hostile-b\r\n',
        'Authorization: wrong-a\r\nAuthorization: wrong-b\r\n',
        'Connection: X-Hop-In-A\r\nConnection: X-Hop-In-B\r\n',
        'X-Hop-In-A: drop-a\r\nX-Hop-In-B: drop-b\r\n',
        'Accept: application/json, text/event-stream\r\n',
        'MCP-Protocol-Version: 2025-11-25\r\n',
        'Mcp-Method: tools/list\r\nMcp-Name: server_status\r\n',
        'Mcp-Param-Region: one\r\nMcp-Param-Region: two\r\n',
        'Content-Length: 4\r\nConnection: close\r\n\r\nPING'
      ],
      { waitForEnd: false }
    );
    await vi.waitFor(() => {
      expect(Buffer.concat(received).toString('latin1')).toContain('data: one');
    });
    expect(Buffer.concat(received).toString('latin1')).not.toContain('data: two');
    releaseSecond();
    await once(socket, 'close');
    const rawResponse = Buffer.concat(received).toString('latin1');
    expect(rawResponse).toContain('HTTP/1.1 207 Custom');
    expect(rawResponse).toContain('Mcp-Session-Id: one');
    expect(rawResponse).toContain('Mcp-Session-Id: two');
    expect(rawResponse).not.toContain('X-Hop-Out-A');
    expect(rawResponse).not.toContain('X-Hop-Out-B');
    expect(rawResponse.indexOf('data: one')).toBeLessThan(rawResponse.indexOf('data: two'));

    expect(observed.method).toBe('POST');
    expect(observed.url).toBe('/mcp');
    expect(Buffer.concat(observed.body).toString()).toBe('PING');
    const pairs = [];
    for (let index = 0; index < observed.rawHeaders.length; index += 2) {
      pairs.push([observed.rawHeaders[index], observed.rawHeaders[index + 1]]);
    }
    expect(pairs.filter(([name]) => name.toLowerCase() === 'host')).toEqual([
      ['Host', `127.0.0.1:${upstreamAddress.port}`]
    ]);
    expect(pairs.filter(([name]) => name.toLowerCase() === 'authorization')).toEqual([
      ['Authorization', `Bearer ${runner.CONFORMANCE_SENTINELS.token}`]
    ]);
    expect(pairs.filter(([name]) => name === 'Mcp-Param-Region')).toEqual([
      ['Mcp-Param-Region', 'one'],
      ['Mcp-Param-Region', 'two']
    ]);
    expect(pairs.some(([name]) => ['x-hop-in-a', 'x-hop-in-b'].includes(name.toLowerCase()))).toBe(
      false
    );
    expect(
      pairs
        .filter(([name]) => name.toLowerCase() === 'connection')
        .every(([, value]) => !value.toLowerCase().includes('x-hop-in'))
    ).toBe(true);
  });

  it('rejects oversized declared and streamed bodies locally, while accepting the exact bound', async () => {
    let upstreamRequests = 0;
    let upstreamAborts = 0;
    const upstream = createServer((request, response) => {
      upstreamRequests += 1;
      request.once('aborted', () => {
        upstreamAborts += 1;
      });
      request.resume();
      request.on('end', () => response.end('ok'));
    });
    const upstreamAddress = await listen(upstream);
    const proxy = await runner.startLoopbackProxy(
      `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      runner.CONFORMANCE_SENTINELS.token,
      { ...HTTP_LIMITS, bodyBytes: 4 }
    );
    ownedResources.add(proxy);
    const port = runner.parseExactLoopbackMcpUrl(proxy.url).port;

    const declared = await rawRequest(port, [
      'POST /mcp HTTP/1.1\r\nHost: local\r\nContent-Length: 5\r\nConnection: close\r\n\r\n'
    ]);
    expect(declared).toContain('413 Payload Too Large');
    expect(declared).toContain('Connection: close');
    expect(upstreamRequests).toBe(0);

    const streamedExchange = await rawRequest(
      port,
      [
        'POST /mcp HTTP/1.1\r\nHost: local\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
        '2\r\nab\r\n'
      ],
      { waitForEnd: false }
    );
    await vi.waitFor(() => expect(upstreamRequests).toBe(1));
    streamedExchange.socket.write('3\r\ncde\r\n0\r\n\r\n');
    await once(streamedExchange.socket, 'close');
    const streamed = Buffer.concat(streamedExchange.received).toString('latin1');
    expect(streamed).toContain('413 Payload Too Large');
    await vi.waitFor(() => expect(upstreamAborts).toBe(1));

    const exact = await rawRequest(port, [
      'POST /mcp HTTP/1.1\r\nHost: local\r\nContent-Length: 4\r\nConnection: close\r\n\r\nPING'
    ]);
    expect(exact).toContain('HTTP/1.1 200 OK');
    expect(upstreamRequests).toBe(2);
  });

  it.each(['/', '/other', '/mcp/', '/mcp?x=1', 'http://127.0.0.1/mcp'])(
    'rejects non-exact request target %s without upstream access',
    async (target) => {
      let upstreamRequests = 0;
      const upstream = createServer((_request, response) => {
        upstreamRequests += 1;
        response.end('unexpected');
      });
      const upstreamAddress = await listen(upstream);
      const proxy = await runner.startLoopbackProxy(
        `http://127.0.0.1:${upstreamAddress.port}/mcp`,
        runner.CONFORMANCE_SENTINELS.token,
        HTTP_LIMITS
      );
      ownedResources.add(proxy);
      const response = await rawRequest(runner.parseExactLoopbackMcpUrl(proxy.url).port, [
        `GET ${target} HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n`
      ]);
      expect(response).toContain('404 Not Found');
      expect(upstreamRequests).toBe(0);
    }
  );

  it('owns exactly 16 connections and requests per socket and closes idempotently', async () => {
    let constructed;
    const createProxyServer = (options, listener) => {
      constructed = createServer(options, listener);
      return constructed;
    };
    const upstream = createServer((_request, response) => response.end('ok'));
    const upstreamAddress = await listen(upstream);
    const proxy = await runner.startLoopbackProxy(
      `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      runner.CONFORMANCE_SENTINELS.token,
      { ...HTTP_LIMITS, maxRequestsPerSocket: 999 },
      { createProxyServer }
    );
    expect(constructed.maxRequestsPerSocket).toBe(16);
    expect(constructed.maxConnections).toBe(16);
    const status = await new Promise((resolveStatus, rejectStatus) => {
      const request = httpRequest(proxy.url, { headers: { Connection: 'close' } }, (response) => {
        response.resume();
        response.once('end', () => resolveStatus(response.statusCode));
      });
      request.once('error', rejectStatus);
      request.end();
    });
    expect(status).toBe(200);
    const held = Array.from({ length: 17 }, () =>
      connect(runner.parseExactLoopbackMcpUrl(proxy.url).port, '127.0.0.1')
    );
    for (const socket of held)
      ownedResources.add({ close: () => Promise.resolve(socket.destroy()) });
    await new Promise((resolveConnections) => setTimeout(resolveConnections, 30));
    const first = proxy.close();
    const second = proxy.close();
    expect(second).toBe(first);
    await first;
    await vi.waitFor(() => expect(held.every((socket) => socket.destroyed)).toBe(true));
  });

  it('forwards at most the first 16 requests on one real keep-alive socket', async () => {
    let upstreamRequests = 0;
    const upstream = createServer((_request, response) => {
      upstreamRequests += 1;
      response.end('ok');
    });
    const upstreamAddress = await listen(upstream);
    const proxy = await runner.startLoopbackProxy(
      `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      runner.CONFORMANCE_SENTINELS.token,
      HTTP_LIMITS
    );
    ownedResources.add(proxy);
    const requests = Array.from({ length: 17 }, (_unused, index) =>
      [
        'GET /mcp HTTP/1.1',
        'Host: local',
        'Content-Length: 0',
        index === 16 ? 'Connection: close' : 'Connection: keep-alive',
        '',
        ''
      ].join('\r\n')
    ).join('');
    const response = await rawRequest(runner.parseExactLoopbackMcpUrl(proxy.url).port, [requests]);
    expect(upstreamRequests).toBe(16);
    expect(response.match(/HTTP\/1\.1 200 OK/gu)).toHaveLength(16);
    const localOverLimit = response.match(/HTTP\/1\.1 503 Service Unavailable/gu)?.length ?? 0;
    expect(localOverLimit === 0 || localOverLimit === 1).toBe(true);
  });

  it('force-closes a partially created listener after listen failure or non-TCP address', async () => {
    for (const listenProxy of [
      async () => {
        throw new Error('POISON_LISTEN');
      },
      async () => 'pipe-name'
    ]) {
      let server;
      await expect(
        runner.startLoopbackProxy(
          'http://127.0.0.1:1/mcp',
          runner.CONFORMANCE_SENTINELS.token,
          HTTP_LIMITS,
          {
            createProxyServer: (options, listener) => {
              server = createServer(options, listener);
              return server;
            },
            listenProxy
          }
        )
      ).rejects.toBeDefined();
      expect(server.listening).toBe(false);
    }
  });
});

describe('child deadline and process ownership', () => {
  function fakeChild() {
    const child = new EventEmitter();
    child.kill = vi.fn(() => true);
    child.unref = vi.fn();
    return child;
  }

  it('sends SIGTERM, SIGKILL, and rejects only after close while timers stay referenced', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const handles = [];
    const clearTimer = vi.fn((handle) => clearTimeout(handle));
    const promise = runner.runConformanceChild(
      {
        executable: '/official/index.js',
        proxyUrl: 'http://127.0.0.1:1234/mcp',
        version: '2025-11-25',
        scenario: 'ping',
        stateDirectory: '/private/state'
      },
      {
        spawnProcess: () => child,
        setTimer: (callback, milliseconds) => {
          const handle = setTimeout(callback, milliseconds);
          handles.push(handle);
          return handle;
        },
        clearTimer
      }
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(handles.at(-1).hasRef()).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    expect(handles.at(-1).hasRef()).toBe(true);
    child.emit('close', null, 'SIGKILL');
    await expect(promise).rejects.toMatchObject({ name: 'ConformanceChildTimeoutError' });
    expect(clearTimer.mock.calls.map(([handle]) => handle)).toEqual(
      expect.arrayContaining(handles)
    );
  });

  it('unrefs and rejects at the final bound when SIGKILL close is never observed', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const promise = runner.runConformanceChild(
      {
        executable: '/official/index.js',
        proxyUrl: 'http://127.0.0.1:1234/mcp',
        version: '2025-11-25',
        scenario: 'ping',
        stateDirectory: '/private/state'
      },
      { spawnProcess: () => child }
    );
    const rejection = expect(promise).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(64_000);
    await rejection;
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('does not arm a grace timer after SIGTERM synchronously emits close', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const activeHandles = new Set();
    child.kill = vi.fn((signal) => {
      if (signal === 'SIGTERM') child.emit('close', null, 'SIGTERM');
      return true;
    });
    const promise = runner.runConformanceChild(
      {
        executable: '/official/index.js',
        proxyUrl: 'http://127.0.0.1:1234/mcp',
        version: '2025-11-25',
        scenario: 'ping',
        stateDirectory: '/private/state'
      },
      {
        spawnProcess: () => child,
        setTimer: (callback, milliseconds) => {
          const handle = setTimeout(callback, milliseconds);
          activeHandles.add(handle);
          return handle;
        },
        clearTimer: (handle) => {
          activeHandles.delete(handle);
          clearTimeout(handle);
        }
      }
    );
    const outcome = promise.catch((error) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(outcome).resolves.toMatchObject({ name: 'ConformanceChildTimeoutError' });
    expect(activeHandles.size).toBe(0);
  });

  it.each([
    ['non-zero', 7, null],
    ['null', null, null],
    ['signal', null, 'SIGTERM']
  ])('rejects %s close outcome', async (_label, code, signal) => {
    const child = fakeChild();
    const promise = runner.runConformanceChild(
      {
        executable: '/official/index.js',
        proxyUrl: 'http://127.0.0.1:1234/mcp',
        version: '2025-11-25',
        scenario: 'ping',
        stateDirectory: '/private/state'
      },
      {
        spawnProcess: () => {
          queueMicrotask(() => child.emit('close', code, signal));
          return child;
        }
      }
    );
    await expect(promise).rejects.toBeDefined();
  });

  it('rejects spawn errors without retaining their message', async () => {
    const child = fakeChild();
    const promise = runner.runConformanceChild(
      {
        executable: '/official/index.js',
        proxyUrl: 'http://127.0.0.1:1234/mcp',
        version: '2025-11-25',
        scenario: 'ping',
        stateDirectory: '/private/state'
      },
      {
        spawnProcess: () => {
          queueMicrotask(() => child.emit('error', new Error('POISON_SPAWN')));
          return child;
        }
      }
    );
    const error = await promise.catch((reason) => reason);
    expect(String(error)).not.toContain('POISON_SPAWN');
  });

  it('really kills and reaps an ignoring child', async () => {
    let pid;
    const spawnProcess = (_program, _argv, options) => {
      const child = spawn(
        process.execPath,
        ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
        { ...options, stdio: 'ignore' }
      );
      pid = child.pid;
      if (pid !== undefined) ownedPids.add(pid);
      return child;
    };
    const setTimer = (callback, milliseconds) =>
      setTimeout(callback, milliseconds === 60_000 ? 1_000 : 500);
    try {
      await expect(
        runner.runConformanceChild(
          {
            executable: '/official/index.js',
            proxyUrl: 'http://127.0.0.1:1234/mcp',
            version: '2025-11-25',
            scenario: 'ping',
            stateDirectory: '/private/state'
          },
          { spawnProcess, setTimer, clearTimer: clearTimeout }
        )
      ).rejects.toMatchObject({ name: 'ConformanceChildTimeoutError' });
      expect(pid).toBeTypeOf('number');
      await pollProcessGone(pid);
      ownedPids.delete(pid);
    } finally {
      closeChild(pid);
    }
  }, 8_000);
});

describe('orchestration startup, report, and cleanup ordering', () => {
  function owner(label, events, close = undefined) {
    return {
      application: label === 'application' ? {} : undefined,
      url: label === 'http' ? 'http://127.0.0.1:1234/mcp' : undefined,
      limits: label === 'http' ? HTTP_LIMITS : undefined,
      close: close ?? (async () => events.push(`close:${label}`))
    };
  }

  function successfulOverrides(events, stateDirectory) {
    const application = owner('application', events);
    const http = owner('http', events);
    const proxy = { ...owner('proxy', events), url: 'http://127.0.0.1:5678/mcp' };
    return {
      makeStateDirectory: async () => (events.push('state'), stateDirectory),
      installEnvironment: async () => ({ restore: async () => events.push('restore') }),
      createApplicationRuntime: async () => (events.push('application'), application),
      assertProductContract: async () => events.push('product-preflight'),
      startProductHttp: async () => (events.push('startHttp'), http),
      startProxy: async () => (events.push('startProxy'), proxy),
      resolveExecutable: async () => (events.push('executable'), '/official/index.js'),
      runChild: async ({ version, scenario }) => {
        events.push(`child:${scenario}`);
        await createAcceptedReport(stateDirectory, version, scenario);
      },
      validateReport: async (...arguments_) => {
        events.push(`report:${arguments_[2]}`);
        await runner.validateScenarioReport(...arguments_);
      },
      removeStateDirectory: async (path) => {
        events.push('remove');
        await rm(path, { recursive: true, force: true });
      }
    };
  }

  it('runs preflight before listeners, then each child/report pair, and owns cleanup order', async () => {
    const events = [];
    const stateDirectory = await temporaryDirectory();
    await runner.runConformance('2025-11-25', successfulOverrides(events, stateDirectory));
    expect(events.slice(0, 7)).toEqual([
      'state',
      'application',
      'product-preflight',
      'startHttp',
      'startProxy',
      'executable',
      'child:server-initialize'
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        'child:server-initialize',
        'report:server-initialize',
        'child:ping',
        'report:ping',
        'child:tools-list',
        'report:tools-list',
        'close:proxy',
        'close:http',
        'close:application',
        'remove',
        'restore'
      ])
    );
    expect(events.indexOf('remove')).toBeGreaterThan(events.indexOf('close:application'));
    expect(events.at(-1)).toBe('restore');
  });

  it('stops before a second child when the first report fails', async () => {
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.validateReport = async () => {
      throw new Error('POISON_WARNING');
    };
    const error = await runner.runConformance('2025-11-25', overrides).catch((reason) => reason);
    expect(events.filter((entry) => entry.startsWith('child:'))).toEqual([
      'child:server-initialize'
    ]);
    expect(String(error)).not.toContain('POISON_WARNING');
  });

  it.each([
    'makeStateDirectory',
    'installEnvironment',
    'createApplicationRuntime',
    'assertProductContract',
    'startProductHttp',
    'startProxy',
    'resolveExecutable'
  ])('bounds a never-settling %s acquisition with a referenced startup timer', async (phase) => {
    vi.useFakeTimers();
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const overrides = successfulOverrides(events, stateDirectory);
    overrides[phase] = () =>
      new Promise((resolveNever) => {
        void resolveNever;
      });
    const handles = [];
    overrides.clock = {
      set(callback, milliseconds) {
        const handle = setTimeout(callback, milliseconds);
        handles.push(handle);
        return handle;
      },
      clear: clearTimeout
    };
    const promise = runner.runConformance('2025-11-25', overrides);
    const rejection = expect(promise).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(runner.STARTUP_PHASE_TIMEOUT_MS);
    expect(handles.some((handle) => handle.hasRef())).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
  });

  it('starts owner cleanup concurrently, flattens stable slots, removes state, and restores last', async () => {
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const releases = [];
    const overrides = successfulOverrides(events, stateDirectory);
    const heldOwner = (label) => ({
      application: label === 'application' ? {} : undefined,
      url: label === 'http' ? 'http://127.0.0.1:1234/mcp' : undefined,
      limits: label === 'http' ? HTTP_LIMITS : undefined,
      close: () =>
        new Promise((resolveClose, rejectClose) => {
          events.push(`close-start:${label}`);
          releases.push(() => rejectClose(new AggregateError([new Error(`POISON_${label}`)])));
        })
    });
    overrides.createApplicationRuntime = async () => heldOwner('application');
    overrides.startProductHttp = async () => heldOwner('http');
    overrides.startProxy = async () => ({
      ...heldOwner('proxy'),
      url: 'http://127.0.0.1:5678/mcp'
    });
    overrides.validateReport = async () => {
      throw new Error('POISON_PRIMARY');
    };
    const promise = runner.runConformance('2025-11-25', overrides);
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(events.filter((entry) => entry.startsWith('close-start:'))).toHaveLength(3);
    for (const release of releases) release();
    const error = await promise.catch((reason) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((entry) => [entry.name, entry.message])).toEqual([
      ['ConformanceRunError', 'Conformance operation failed: primary'],
      ['ConformanceCleanupError', 'Conformance operation failed: proxy'],
      ['ConformanceCleanupError', 'Conformance operation failed: http'],
      ['ConformanceCleanupError', 'Conformance operation failed: application']
    ]);
    expect(JSON.stringify(error)).not.toContain('POISON');
    expect(events.at(-1)).toBe('restore');
  });

  it.each([
    ['createApplicationRuntime', 'throw'],
    ['createApplicationRuntime', 'reject'],
    ['startProductHttp', 'throw'],
    ['startProductHttp', 'reject'],
    ['startProxy', 'throw'],
    ['startProxy', 'reject']
  ])('cleans only returned owners when %s %s fails', async (phase, mode) => {
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const overrides = successfulOverrides(events, stateDirectory);
    const fail = () => {
      const error = new Error(`POISON_${phase}_${mode}`);
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    };
    overrides[phase] = fail;
    const error = await runner.runConformance('2025-11-25', overrides).catch((reason) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors[0]).toMatchObject({
      name: 'ConformanceRunError',
      message: 'Conformance operation failed: primary'
    });
    expect(events).not.toContain('child:server-initialize');
    expect(events.includes('close:application')).toBe(phase !== 'createApplicationRuntime');
    expect(events.includes('close:http')).toBe(phase === 'startProxy');
    expect(events).not.toContain('close:proxy');
    expect(events.at(-1)).toBe('restore');
    expect(JSON.stringify(error)).not.toContain('POISON');
  });

  it.each(
    Object.values({
      '2025-11-25': ['server-initialize', 'ping', 'tools-list'],
      '2026-07-28': [
        'tools-list',
        'input-required-result-unsupported-methods',
        'http-header-validation'
      ]
    }).flatMap((scenarios, versionIndex) =>
      scenarios.flatMap((scenario) => [
        [versionIndex === 0 ? '2025-11-25' : '2026-07-28', scenario, 'throw'],
        [versionIndex === 0 ? '2025-11-25' : '2026-07-28', scenario, 'reject']
      ])
    )
  )('stops and cleans after %s scenario %s child %s', async (version, failingScenario, mode) => {
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.validateReport = async (_state, _version, scenario) => {
      events.push(`report:${scenario}`);
    };
    overrides.runChild = ({ scenario }) => {
      events.push(`child:${scenario}`);
      if (scenario !== failingScenario) return Promise.resolve();
      const error = new Error(`POISON_CHILD_${failingScenario}`);
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    };
    const error = await runner.runConformance(version, overrides).catch((reason) => reason);
    const selected = runner.SCENARIOS_BY_VERSION[version];
    expect(events.filter((entry) => entry.startsWith('child:'))).toEqual(
      selected
        .slice(0, selected.indexOf(failingScenario) + 1)
        .map((scenario) => `child:${scenario}`)
    );
    expect(events).not.toContain(`report:${failingScenario}`);
    expect(events).toEqual(
      expect.arrayContaining([
        'close:proxy',
        'close:http',
        'close:application',
        'remove',
        'restore'
      ])
    );
    expect(JSON.stringify(error)).not.toContain('POISON');
  });

  it('closes a startup owner that fulfills during the late-arrival grace', async () => {
    vi.useFakeTimers();
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const applicationDeferred = deferred();
    const lateClose = vi.fn(async () => events.push('close:late-application'));
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.createApplicationRuntime = () => {
      events.push('application-pending');
      return applicationDeferred.promise;
    };
    const activeTimers = new Set();
    overrides.clock = {
      set(callback, milliseconds) {
        let handle;
        handle = setTimeout(() => {
          activeTimers.delete(handle);
          callback();
        }, milliseconds);
        activeTimers.add(handle);
        return handle;
      },
      clear(handle) {
        activeTimers.delete(handle);
        clearTimeout(handle);
      }
    };
    const promise = runner.runConformance('2025-11-25', overrides);
    const outcome = promise.catch((error) => error);
    await vi.waitFor(() => expect(events).toContain('application-pending'));
    await vi.advanceTimersByTimeAsync(runner.STARTUP_PHASE_TIMEOUT_MS);
    applicationDeferred.resolve({ application: {}, close: lateClose });
    await vi.advanceTimersByTimeAsync(0);
    expect(lateClose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;
    expect(error.errors.map((entry) => entry.name)).toEqual(['ConformanceStartupTimeoutError']);
    expect(events.at(-1)).toBe('restore');
    expect(activeTimers.size).toBe(0);
  });

  it('reports an owner arriving beyond the grace as not confirmed but still observes late cleanup', async () => {
    vi.useFakeTimers();
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const applicationDeferred = deferred();
    const lateClose = vi.fn(async () => events.push('close:very-late-application'));
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.createApplicationRuntime = () => applicationDeferred.promise;
    const promise = runner.runConformance('2025-11-25', overrides);
    const outcome = promise.catch((error) => error);
    await vi.advanceTimersByTimeAsync(runner.STARTUP_PHASE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;
    expect(error.errors.map((entry) => [entry.name, entry.message])).toEqual([
      ['ConformanceStartupTimeoutError', 'Conformance startup phase timed out'],
      ['ConformanceCleanupTimeoutError', 'Conformance cleanup timed out: late-startup']
    ]);
    applicationDeferred.resolve({ application: {}, close: lateClose });
    await vi.advanceTimersByTimeAsync(0);
    expect(lateClose).toHaveBeenCalledOnce();
  });

  it('times out report validation and keeps a late rejection observed', async () => {
    vi.useFakeTimers();
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const reportDeferred = deferred();
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.runChild = async ({ scenario }) => events.push(`child:${scenario}`);
    overrides.validateReport = () => {
      events.push('report-pending');
      return reportDeferred.promise;
    };
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const promise = runner.runConformance('2025-11-25', overrides);
      const outcome = promise.catch((error) => error);
      await vi.waitFor(() => expect(events).toContain('report-pending'));
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await outcome;
      expect(events.filter((entry) => entry.startsWith('child:'))).toEqual([
        'child:server-initialize'
      ]);
      expect(error.errors[0]).toMatchObject({ name: 'ConformanceRunError' });
      reportDeferred.reject(new Error('POISON_LATE_REPORT'));
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it.each(['proxy', 'http', 'application', 'temp-state', 'environment'])(
    'bounds never-settling %s cleanup with a referenced stable timeout',
    async (slot) => {
      vi.useFakeTimers();
      const events = [];
      const stateDirectory = await temporaryDirectory();
      const cleanupStarted = deferred();
      const never = () => {
        cleanupStarted.resolve();
        return new Promise((resolveNever) => {
          void resolveNever;
        });
      };
      const overrides = successfulOverrides(events, stateDirectory);
      overrides.runChild = async () => undefined;
      overrides.validateReport = async () => undefined;
      if (slot === 'application') {
        overrides.createApplicationRuntime = async () => ({ application: {}, close: never });
      } else if (slot === 'http') {
        overrides.startProductHttp = async () => ({
          url: 'http://127.0.0.1:1234/mcp',
          limits: HTTP_LIMITS,
          close: never
        });
      } else if (slot === 'proxy') {
        overrides.startProxy = async () => ({
          url: 'http://127.0.0.1:5678/mcp',
          close: never
        });
      } else if (slot === 'temp-state') {
        overrides.removeStateDirectory = never;
      } else {
        overrides.installEnvironment = async () => ({ restore: never });
      }
      const activeTimers = new Set();
      overrides.clock = {
        set(callback, milliseconds) {
          let handle;
          handle = setTimeout(() => {
            activeTimers.delete(handle);
            callback();
          }, milliseconds);
          activeTimers.add(handle);
          return handle;
        },
        clear(handle) {
          activeTimers.delete(handle);
          clearTimeout(handle);
        }
      };
      const promise = runner.runConformance('2025-11-25', overrides);
      const outcome = promise.catch((error) => error);
      await cleanupStarted.promise;
      expect([...activeTimers].some((handle) => handle.hasRef())).toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await outcome;
      expect(error.errors).toEqual([
        expect.objectContaining({
          name: 'ConformanceCleanupTimeoutError',
          message: `Conformance cleanup timed out: ${slot}`
        })
      ]);
      expect(activeTimers.size).toBe(0);
    }
  );
});

describe('direct CLI boundary', () => {
  it('writes and schedules nothing on success', async () => {
    const writeDiagnostic = vi.fn();
    const markFailed = vi.fn();
    const setTimer = vi.fn();
    await runner.runConformanceCli('2025-11-25', {
      run: async () => undefined,
      writeDiagnostic,
      markFailed,
      setTimer
    });
    expect(writeDiagnostic).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('emits one fixed diagnostic and owns the only unreferenced watchdog on failure', async () => {
    const writes = [];
    const handle = { unref: vi.fn() };
    const setTimer = vi.fn(() => handle);
    const markFailed = vi.fn();
    const exit = vi.fn();
    const poison = new Error('POISON_MESSAGE');
    poison.name = 'POISON_NAME';
    await runner.runConformanceCli('2025-11-25', {
      run: async () => Promise.reject(poison),
      writeDiagnostic: (value) => writes.push(value),
      markFailed,
      setTimer,
      exit
    });
    expect(writes).toEqual(['Conformance run failed\n']);
    expect(markFailed).toHaveBeenCalledOnce();
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(handle.unref).toHaveBeenCalledOnce();
    setTimer.mock.calls[0][0]();
    expect(exit).toHaveBeenCalledWith(1);
    expect(writes.join('')).not.toContain('POISON');
  });

  it('forces a real referenced poison process to exit with exact redacted output', async () => {
    const runnerUrl = pathToFileURL(resolve('scripts/run-conformance.mjs')).href;
    const fixture = [
      `import { runConformanceCli } from ${JSON.stringify(runnerUrl)};`,
      'setInterval(() => {}, 1000);',
      "const poison = new Error('POISON_MESSAGE');",
      "poison.name = 'POISON_NAME';",
      "await runConformanceCli('2025-11-25', { run: async () => Promise.reject(poison) });"
    ].join('');
    const child = spawn(process.execPath, ['--input-type=module', '-e', fixture], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (child.pid !== undefined) ownedPids.add(child.pid);
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const outer = setTimeout(() => child.kill('SIGKILL'), 3_000);
    try {
      const [code, signal] = await once(child, 'close');
      expect(code).toBe(1);
      expect(signal).toBeNull();
      expect(Buffer.concat(stdout).toString()).toBe('');
      expect(Buffer.concat(stderr).toString()).toBe('Conformance run failed\n');
      expect(Buffer.concat(stderr).toString()).not.toContain('POISON');
      if (child.pid !== undefined) ownedPids.delete(child.pid);
    } finally {
      clearTimeout(outer);
      closeChild(child.pid);
    }
  }, 5_000);
});

describe('real official alpha.9 evidence', () => {
  it.each(['2025-11-25', '2026-07-28'])(
    'runs the three selected %s scenarios through the authenticated product proxy without residue',
    async (version) => {
      const dedicatedParent = await temporaryDirectory('opnsense-mcp-real-conformance-');
      const dedicatedTmp = join(dedicatedParent, 'tmp');
      await mkdir(dedicatedTmp);
      const poison = `POISON_${version}`;
      const environment = {
        ...process.env,
        TMPDIR: dedicatedTmp,
        OPNSENSE_URL: poison,
        OPNSENSE_API_KEY: poison,
        MCP_HTTP_TOKEN: poison,
        ENABLE_SHELL_TOOLS: poison,
        IAC_ENABLED: poison,
        READ_ONLY: poison,
        ALLOWED_RESOURCES: poison,
        AUDIT_LOG: poison,
        BACKUP_PATH: poison
      };
      const child = spawn(process.execPath, ['scripts/run-conformance.mjs', version], {
        cwd: resolve('.'),
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if (child.pid !== undefined) ownedPids.add(child.pid);
      const stdout = [];
      const stderr = [];
      child.stdout.on('data', (chunk) => stdout.push(chunk));
      child.stderr.on('data', (chunk) => stderr.push(chunk));
      let closed = false;
      const terminate = setTimeout(() => {
        if (!closed) child.kill('SIGTERM');
      }, 198_000);
      const kill = setTimeout(() => {
        if (!closed) child.kill('SIGKILL');
      }, 200_000);
      const confirmation = setTimeout(() => {
        if (!closed) child.emit('error', new Error('Conformance child close not confirmed'));
      }, 202_000);
      try {
        const [code, signal] = await once(child, 'close');
        closed = true;
        expect(code).toBe(0);
        expect(signal).toBeNull();
        const output = Buffer.concat([...stdout, ...stderr]).toString();
        expect(output).not.toContain(poison);
        for (const sentinel of Object.values(runner.CONFORMANCE_SENTINELS)) {
          expect(output).not.toContain(sentinel);
        }
        expect(await readdir(dedicatedTmp)).toEqual([]);
        expect(await readdir('.', { withFileTypes: true })).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: 'results' })])
        );
        if (child.pid !== undefined) {
          await pollProcessGone(child.pid);
          ownedPids.delete(child.pid);
        }
      } finally {
        closed = true;
        clearTimeout(terminate);
        clearTimeout(kill);
        clearTimeout(confirmation);
        closeChild(child.pid);
      }
    },
    210_000
  );
});
