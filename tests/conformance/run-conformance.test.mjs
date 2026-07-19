// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { constants as fsConstants } from 'node:fs';
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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

function trackRawSocket(socket) {
  let firstReset;
  let firstOtherFailure;
  let resolveClosed;
  const closed = socket.closed
    ? Promise.resolve()
    : new Promise((resolveClose) => {
        resolveClosed = resolveClose;
      });
  const onError = (error) => {
    if (error?.code === 'ECONNRESET') firstReset ??= error;
    else firstOtherFailure ??= error;
  };
  const onClose = () => {
    socket.off('error', onError);
    resolveClosed?.();
  };
  if (!socket.closed) {
    socket.on('error', onError);
    socket.once('close', onClose);
  }
  return Object.freeze({
    async waitForClose({ allowReset = false } = {}) {
      await closed;
      if (firstOtherFailure !== undefined) throw firstOtherFailure;
      if (!allowReset && firstReset !== undefined) throw firstReset;
    }
  });
}

function rawRequest(port, chunks, { waitForEnd = true } = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = connect(port, '127.0.0.1');
    const tracker = trackRawSocket(socket);
    const received = [];
    ownedResources.add({ close: () => Promise.resolve(socket.destroy()) });
    socket.on('data', (chunk) => received.push(chunk));
    const onConnectionError = (error) => rejectRequest(error);
    socket.once('error', onConnectionError);
    socket.once('connect', () => {
      if (!waitForEnd) socket.off('error', onConnectionError);
      for (const chunk of chunks) socket.write(chunk);
      if (!waitForEnd) resolveRequest({ socket, received, waitForClose: tracker.waitForClose });
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

async function closeChildAndConfirm(pid) {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    throw error;
  }
  await pollProcessGone(pid);
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const pid of [...ownedPids]) {
    await closeChildAndConfirm(pid);
    ownedPids.delete(pid);
  }
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

function assertOfficialStdoutContract(stdout, version, dedicatedTmp, poison) {
  for (const forbidden of [
    resolve('.'),
    process.execPath,
    'scripts/run-conformance.mjs',
    'node_modules/@modelcontextprotocol/conformance',
    '--url',
    '--scenario',
    '--output-dir',
    'Authorization',
    'Bearer ',
    poison,
    ...Object.values(runner.CONFORMANCE_SENTINELS)
  ]) {
    expect(stdout).not.toContain(forbidden);
  }

  const lines = stdout.split('\n');
  let index = 0;
  let expectedProxyUrl;
  for (const scenario of runner.SCENARIOS_BY_VERSION[version]) {
    const running = lines[index++];
    const runningMatch = /^Running client scenario '([^']+)' against server: (\S+)$/u.exec(running);
    expect(runningMatch?.[1]).toBe(scenario);
    const proxyProjection = runner.parseExactLoopbackMcpUrl(runningMatch?.[2]);
    expectedProxyUrl ??= proxyProjection.href;
    expect(proxyProjection.href).toBe(expectedProxyUrl);

    const resultLine = lines[index++];
    const resultMatch = /^Results saved to (.+)$/u.exec(resultLine);
    expect(resultMatch).not.toBeNull();
    const resultPath = resultMatch?.[1];
    expect(isAbsolute(resultPath)).toBe(true);
    const ownedResultPath = relative(resolve(dedicatedTmp), resolve(resultPath));
    expect(ownedResultPath).not.toBe('');
    expect(ownedResultPath).not.toBe('..');
    expect(ownedResultPath.startsWith(`..${sep}`)).toBe(false);
    expect(isAbsolute(ownedResultPath)).toBe(false);
    const segments = ownedResultPath.split(sep);
    expect(segments).toHaveLength(5);
    expect(segments[0]).toMatch(/^opnsense-mcp-conformance-[A-Za-z0-9]+$/u);
    expect(segments.slice(1, 4)).toEqual(['results', version, scenario]);
    expect(segments[4]).toMatch(new RegExp(`^server-${scenario}-[A-Za-z0-9-]+$`, 'u'));

    const summaryIndex = lines.indexOf('Test Results:', index);
    expect(summaryIndex).toBeGreaterThan(index);
    const checks = JSON.parse(lines.slice(index, summaryIndex).join('\n').trim());
    expect(checks).toBeInstanceOf(Array);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.some((check) => check?.status === 'SUCCESS')).toBe(true);
    expect(
      checks.every(
        (check) =>
          check !== null &&
          typeof check === 'object' &&
          !Array.isArray(check) &&
          new Set(['SUCCESS', 'INFO']).has(check.status)
      )
    ).toBe(true);
    const structuredChecks = JSON.stringify(checks);
    expect(structuredChecks).not.toMatch(
      /(?:^|["\s])\/(?:Users|home|opt|private|tmp|var)(?:\/|["\s])/u
    );
    expect(structuredChecks).not.toMatch(/authorization|bearer|token/iu);
    index = summaryIndex + 1;
    expect(lines[index++]).toMatch(/^Passed: [1-9][0-9]*\/[1-9][0-9]*, 0 failed, 0 warnings$/u);
  }
  expect(lines.slice(index).every((line) => line === '')).toBe(true);
}

describe('exact conformance command contract', () => {
  const childEnvironmentNames = Object.freeze([
    'PATH',
    'LANG',
    'LANGUAGE',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'TMP',
    'TEMP',
    'SystemRoot',
    'ComSpec',
    'PATHEXT',
    'USERPROFILE'
  ]);

  function expectedChildEnvironment() {
    return Object.fromEntries(
      childEnvironmentNames.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
      })
    );
  }

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
      queueMicrotask(() => {
        child.emit('spawn');
        child.emit('close', 0, null);
      });
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
      { stdio: 'inherit', env: expectedChildEnvironment() }
    );
  });

  it('projects only an immutable runtime environment without parent secrets', async () => {
    const sentinels = {
      OPNSENSE_API_SECRET: 'SENTINEL_OPNSENSE_SECRET',
      MCP_HTTP_TOKEN: 'SENTINEL_MCP_TOKEN',
      GITHUB_TOKEN: 'SENTINEL_GITHUB_TOKEN',
      NODE_OPTIONS: '--require=SENTINEL_NODE_OPTIONS',
      UNRELATED_DEVELOPER_SECRET: 'SENTINEL_UNRELATED_SECRET'
    };
    const originals = new Map(
      Object.keys(sentinels).map((name) => [
        name,
        { present: Object.hasOwn(process.env, name), value: process.env[name] }
      ])
    );
    let childEnvironment;
    try {
      Object.assign(process.env, sentinels);
      const child = new EventEmitter();
      child.kill = vi.fn();
      child.unref = vi.fn();
      await runner.runConformanceChild(
        {
          executable: '/official/index.js',
          proxyUrl: 'http://127.0.0.1:45678/mcp',
          version: '2025-11-25',
          scenario: 'ping',
          stateDirectory: '/private/state'
        },
        {
          spawnProcess: (_program, _argv, options) => {
            childEnvironment = options.env;
            queueMicrotask(() => {
              child.emit('spawn');
              child.emit('close', 0, null);
            });
            return child;
          }
        }
      );

      expect(childEnvironment).toEqual(expectedChildEnvironment());
      expect(Object.isFrozen(childEnvironment)).toBe(true);
      for (const [name, value] of Object.entries(sentinels)) {
        expect(childEnvironment).not.toHaveProperty(name);
        expect(JSON.stringify(childEnvironment)).not.toContain(value);
      }
    } finally {
      for (const [name, original] of originals) {
        if (original.present) process.env[name] = original.value;
        else Reflect.deleteProperty(process.env, name);
      }
    }
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
        if (
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).length !== 0
        ) {
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

  function acceptInvalidSchemaInput(predicate) {
    return (capability) => {
      capability.parseInput = (value) => {
        const isEmptyRecord =
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0;
        if (isEmptyRecord || predicate(value)) return {};
        throw new Error('strict');
      };
    };
  }

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
    ['identity', () => [exactCapability()]]
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
    ['id', (capability) => (capability.id = 'changed')],
    ['name', (capability) => (capability.mcpName = 'changed')],
    ['title', (capability) => (capability.title = 'Changed')],
    ['description', (capability) => (capability.description = 'Changed')],
    ['annotation readOnlyHint', (capability) => (capability.annotations.readOnlyHint = false)],
    ['annotation destructiveHint', (capability) => (capability.annotations.destructiveHint = true)],
    ['annotation idempotentHint', (capability) => (capability.annotations.idempotentHint = false)],
    ['annotation openWorldHint', (capability) => (capability.annotations.openWorldHint = true)],
    ['transport length', (capability) => (capability.transports = ['http'])],
    ['transport order', (capability) => (capability.transports = ['http', 'stdio'])],
    ['policy effect', (capability) => (capability.policy.effect = 'write')],
    ['policy backup', (capability) => (capability.policy.backup = 'required')],
    ['policy audit', (capability) => (capability.policy.audit = 'required')],
    ['policy confirmation', (capability) => (capability.policy.confirmation = 'required')],
    ['policy timeout', (capability) => (capability.policy.timeoutMs = 2_000)],
    ['policy resource count', (capability) => (capability.policy.resourceScopes = [])],
    ['policy resource identity', (capability) => (capability.policy.resourceScopes = ['changed'])],
    [
      'policy feature flags',
      (capability) => (capability.policy.requiredFeatureFlags = ['changed'])
    ],
    ['policy redact fields', (capability) => (capability.policy.redactFields = ['changed'])],
    [
      'schema empty projection',
      (capability) => (capability.parseInput = () => ({ unexpected: true }))
    ],
    [
      'schema array projection',
      (capability) => {
        capability.parseInput = (value) => {
          if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0
          ) {
            return [];
          }
          throw new Error('strict');
        };
      }
    ],
    ['schema extra acceptance', (capability) => (capability.parseInput = () => ({}))],
    ['schema null acceptance', acceptInvalidSchemaInput((value) => value === null)],
    ['schema array acceptance', acceptInvalidSchemaInput(Array.isArray)],
    ['schema string acceptance', acceptInvalidSchemaInput((value) => typeof value === 'string')],
    ['schema number acceptance', acceptInvalidSchemaInput((value) => typeof value === 'number')],
    ['schema boolean acceptance', acceptInvalidSchemaInput((value) => typeof value === 'boolean')],
    ['schema undefined acceptance', acceptInvalidSchemaInput((value) => value === undefined)]
  ])('fails closed when only %s drifts', async (_label, mutate) => {
    const expected = exactCapability();
    mutate(expected);
    const error = await runner
      .assertConformanceProductContract(
        {},
        {
          expected,
          list: () => [expected],
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
    ['refusal', () => ({ kind: 'refusal', error: { code: 'READ_ONLY' } })],
    ['confirmation', () => ({ kind: 'confirmation', confirmation: {} })],
    [
      'wrong status',
      () => ({ kind: 'success', output: { status: 'changed', readOnly: true, version: '0.1.0' } })
    ],
    [
      'wrong readOnly',
      () => ({ kind: 'success', output: { status: 'ok', readOnly: false, version: '0.1.0' } })
    ],
    [
      'wrong version',
      () => ({ kind: 'success', output: { status: 'ok', readOnly: true, version: 'changed' } })
    ],
    [
      'extra output field',
      () => ({
        kind: 'success',
        output: { status: 'ok', readOnly: true, version: '0.1.0', poison: true }
      })
    ],
    [
      'synchronous throw',
      () => {
        throw new Error('POISON_DISPATCH_THROW');
      }
    ],
    ['rejected promise', () => Promise.reject(new Error('POISON_DISPATCH_REJECTION'))]
  ])('fails closed on dispatch mode %s', async (_label, dispatch) => {
    const expected = exactCapability();
    const error = await runner
      .assertConformanceProductContract({}, { expected, list: () => [expected], dispatch })
      .catch((reason) => reason);
    expect({ name: error.name, message: error.message }).toEqual({
      name: 'ConformanceProductContractError',
      message: 'Conformance product contract is unavailable'
    });
    expect(JSON.stringify(error)).not.toContain('POISON');
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

  it.each(['results', 'version', 'scenario', 'run', 'report'])(
    'rejects a symlink at the %s report boundary with one redacted error',
    async (boundary) => {
      const version = '2025-11-25';
      const scenario = 'ping';
      const stateDirectory = await temporaryDirectory();
      const outside = await temporaryDirectory();
      const runDirectory = await createAcceptedReport(stateDirectory, version, scenario);
      const outsideRun = await createAcceptedReport(outside, version, scenario);
      const paths = {
        results: [join(stateDirectory, 'results'), join(outside, 'results')],
        version: [join(stateDirectory, 'results', version), join(outside, 'results', version)],
        scenario: [
          join(stateDirectory, 'results', version, scenario),
          join(outside, 'results', version, scenario)
        ],
        run: [runDirectory, outsideRun],
        report: [join(runDirectory, 'checks.json'), join(outsideRun, 'checks.json')]
      };
      const [insidePath, outsidePath] = paths[boundary];
      await rm(insidePath, { recursive: true, force: true });
      await symlink(outsidePath, insidePath);

      const error = await runner
        .validateScenarioReport(stateDirectory, version, scenario)
        .catch((reason) => reason);
      expect({ name: error.name, message: error.message }).toEqual({
        name: 'ConformanceReportError',
        message: 'Conformance scenario report is invalid'
      });
      expect(JSON.stringify(error)).not.toContain(stateDirectory);
      expect(JSON.stringify(error)).not.toContain(outside);
    }
  );

  it.each(['symlink', 'regular-file'])(
    'rejects an atomic %s swap before report open',
    async (mode) => {
      const version = '2025-11-25';
      const scenario = 'ping';
      const stateDirectory = await temporaryDirectory();
      const runDirectory = await createAcceptedReport(stateDirectory, version, scenario);
      const displacedPath = join(runDirectory, 'checks.original.json');
      const outside = await temporaryDirectory();
      const outsideReport = join(outside, 'outside.json');
      await writeFile(outsideReport, '[{"status":"SUCCESS"}]');
      let observedFlags;
      let openCalls = 0;
      let closeCalls = 0;

      const error = await runner
        .validateScenarioReport(stateDirectory, version, scenario, {
          openReport: async (path, flags) => {
            openCalls += 1;
            observedFlags = flags;
            await rename(path, displacedPath);
            if (mode === 'symlink') await symlink(outsideReport, path);
            else await writeFile(path, '[{"status":"SUCCESS"}]');
            const handle = await openFile(path, flags);
            return {
              stat: (...arguments_) => handle.stat(...arguments_),
              read: (...arguments_) => handle.read(...arguments_),
              close: async () => {
                closeCalls += 1;
                await handle.close();
              }
            };
          }
        })
        .catch((reason) => reason);

      expect({ name: error.name, message: error.message }).toEqual({
        name: 'ConformanceReportError',
        message: 'Conformance scenario report is invalid'
      });
      expect(openCalls).toBe(1);
      expect(observedFlags & fsConstants.O_NOFOLLOW).toBe(fsConstants.O_NOFOLLOW);
      expect(closeCalls).toBe(mode === 'symlink' ? 0 : 1);
    }
  );

  it('bounds a report that grows after fstat to an N+1 read and always closes its handle', async () => {
    const version = '2025-11-25';
    const scenario = 'ping';
    const stateDirectory = await temporaryDirectory();
    const runDirectory = await createAcceptedReport(stateDirectory, version, scenario);
    const reportPath = join(runDirectory, 'checks.json');
    let openCalls = 0;
    let closeCalls = 0;
    let grew = false;

    const error = await runner
      .validateScenarioReport(stateDirectory, version, scenario, {
        openReport: async (path, flags) => {
          openCalls += 1;
          const handle = await openFile(path, flags);
          return {
            stat: (...arguments_) => handle.stat(...arguments_),
            read: async (...arguments_) => {
              if (!grew) {
                grew = true;
                await appendFile(reportPath, Buffer.alloc(runner.MAX_CONFORMANCE_REPORT_BYTES));
              }
              return handle.read(...arguments_);
            },
            close: async () => {
              closeCalls += 1;
              await handle.close();
            }
          };
        }
      })
      .catch((reason) => reason);

    expect(error).toMatchObject({ name: 'ConformanceReportError' });
    expect(openCalls).toBe(1);
    expect(grew).toBe(true);
    expect(closeCalls).toBe(1);
  });

  it('rejects a same-inode rewrite restored before the final report stat', async () => {
    const version = '2025-11-25';
    const scenario = 'ping';
    const stateDirectory = await temporaryDirectory();
    const runDirectory = await createAcceptedReport(stateDirectory, version, scenario, [
      { status: 'WARNING' }
    ]);
    const reportPath = join(runDirectory, 'checks.json');
    const warning = '[{"status":"WARNING"}]';
    const success = '[{"status":"SUCCESS"}]';
    expect(Buffer.byteLength(warning)).toBe(Buffer.byteLength(success));
    const fixedTime = new Date('2026-07-18T00:00:00.000Z');
    await utimes(reportPath, fixedTime, fixedTime);
    const before = await lstat(reportPath, { bigint: true });
    let closeCalls = 0;
    let raced = false;

    const error = await runner
      .validateScenarioReport(stateDirectory, version, scenario, {
        openReport: async (path, flags) => {
          const handle = await openFile(path, flags);
          return {
            stat: (...arguments_) => handle.stat(...arguments_),
            read: async (...arguments_) => {
              if (raced) return handle.read(...arguments_);
              raced = true;
              await writeFile(reportPath, success);
              const result = await handle.read(...arguments_);
              await writeFile(reportPath, warning);
              await utimes(reportPath, fixedTime, fixedTime);
              return result;
            },
            close: async () => {
              closeCalls += 1;
              await handle.close();
            }
          };
        }
      })
      .catch((reason) => reason);

    const after = await lstat(reportPath, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);
    expect(error).toMatchObject({
      name: 'ConformanceReportError',
      message: 'Conformance scenario report is invalid'
    });
    expect(raced).toBe(true);
    expect(closeCalls).toBe(1);
  });

  it.each(['report', 'scenario-chain'])(
    'revalidates the %s identity after the bound report read',
    async (swap) => {
      const version = '2025-11-25';
      const scenario = 'ping';
      const stateDirectory = await temporaryDirectory();
      const runDirectory = await createAcceptedReport(stateDirectory, version, scenario);
      const reportPath = join(runDirectory, 'checks.json');
      const scenarioPath = join(stateDirectory, 'results', version, scenario);
      let swapped = false;
      let closeCalls = 0;

      const error = await runner
        .validateScenarioReport(stateDirectory, version, scenario, {
          openReport: async (path, flags) => {
            const handle = await openFile(path, flags);
            return {
              stat: (...arguments_) => handle.stat(...arguments_),
              read: async (...arguments_) => {
                const result = await handle.read(...arguments_);
                if (!swapped) {
                  swapped = true;
                  if (swap === 'report') {
                    await rename(reportPath, `${reportPath}.original`);
                    await writeFile(reportPath, '[{"status":"SUCCESS"}]');
                  } else {
                    await rename(scenarioPath, `${scenarioPath}.original`);
                    await mkdir(scenarioPath);
                  }
                }
                return result;
              },
              close: async () => {
                closeCalls += 1;
                await handle.close();
              }
            };
          }
        })
        .catch((reason) => reason);

      expect(error).toMatchObject({ name: 'ConformanceReportError' });
      expect(swapped).toBe(true);
      expect(closeCalls).toBe(1);
    }
  );
});

describe('raw streaming authentication proxy', () => {
  it('waits for close and tolerates only explicitly allowed connection resets', async () => {
    const reset = Object.assign(new Error('expected reset'), { code: 'ECONNRESET' });
    const allowedSocket = Object.assign(new EventEmitter(), { closed: false });
    const allowedTracker = trackRawSocket(allowedSocket);
    let allowedSettled = false;
    const allowedClose = allowedTracker.waitForClose({ allowReset: true }).then(() => {
      allowedSettled = true;
    });
    allowedSocket.emit('error', reset);
    await Promise.resolve();
    expect(allowedSettled).toBe(false);
    allowedSocket.emit('close');
    await allowedClose;
    expect(allowedSettled).toBe(true);

    const resetRefusedSocket = Object.assign(new EventEmitter(), { closed: false });
    const resetRefusedTracker = trackRawSocket(resetRefusedSocket);
    const resetRefused = expect(resetRefusedTracker.waitForClose()).rejects.toBe(reset);
    resetRefusedSocket.emit('error', reset);
    resetRefusedSocket.emit('close');
    await resetRefused;

    const refusedSocket = Object.assign(new EventEmitter(), { closed: false });
    const refusedTracker = trackRawSocket(refusedSocket);
    const unexpected = Object.assign(new Error('unexpected socket failure'), { code: 'EPIPE' });
    refusedSocket.emit('error', unexpected);
    refusedSocket.emit('close');
    await expect(refusedTracker.waitForClose()).rejects.toBe(unexpected);
  });

  it('rejects a tracked raw request when the connection is refused before connect', async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error === undefined) resolveClose();
        else rejectClose(error);
      });
    });

    const refusal = rawRequest(address.port, ['GET / HTTP/1.1\r\n\r\n'], {
      waitForEnd: false
    }).catch((error) => error);
    const bound = new Promise((resolveBound) => {
      const deadline = setTimeout(() => resolveBound(new Error('refusal bound expired')), 1_000);
      deadline.unref();
    });
    const result = await Promise.race([refusal, bound]);
    expect(result).toMatchObject({ code: 'ECONNREFUSED' });
  });

  class ControlledUpstreamRequest extends EventEmitter {
    destroyed = false;
    ended = false;
    writes = [];

    write(chunk) {
      this.writes.push(Buffer.from(chunk));
      return true;
    }

    end() {
      this.ended = true;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  class ControlledUpstreamResponse extends EventEmitter {
    destroyed = false;
    paused = false;
    rawHeaders = ['Content-Type', 'text/plain'];
    statusCode = 200;
    statusMessage = 'OK';

    pause() {
      this.paused = true;
    }

    resume() {
      this.paused = false;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  async function controlledProxy() {
    const upstreamRequest = new ControlledUpstreamRequest();
    let deliverResponse;
    const responseReady = deferred();
    const proxy = await runner.startLoopbackProxy(
      'http://127.0.0.1:1/mcp',
      runner.CONFORMANCE_SENTINELS.token,
      HTTP_LIMITS,
      {
        requestUpstream: (_options, callback) => {
          deliverResponse = callback;
          responseReady.resolve();
          return upstreamRequest;
        }
      }
    );
    ownedResources.add(proxy);
    return {
      proxy,
      upstreamRequest,
      async deliver(upstreamResponse) {
        await responseReady.promise;
        deliverResponse(upstreamResponse);
      }
    };
  }

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
          'two',
          'Date',
          'Thu, 01 Jan 1970 00:00:00 GMT'
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
    const { received, waitForClose } = await rawRequest(
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
    await waitForClose();
    const rawResponse = Buffer.concat(received).toString('latin1');
    expect(rawResponse).toContain('HTTP/1.1 207 Custom');
    expect(rawResponse.indexOf('data: one')).toBeLessThan(rawResponse.indexOf('data: two'));
    const responseHeaderLines = rawResponse.split('\r\n\r\n', 1)[0].split('\r\n').slice(1);
    const responsePairs = responseHeaderLines.map((line) => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator), line.slice(separator + 1).trimStart()];
    });
    const responseConnections = responsePairs.filter(
      ([name]) => name.toLowerCase() === 'connection'
    );
    expect(responseConnections.length).toBeLessThanOrEqual(1);
    expect(responseConnections.every(([, value]) => value.toLowerCase() === 'close')).toBe(true);
    expect(responsePairs.filter(([name]) => name.toLowerCase() !== 'connection')).toEqual([
      ['Content-Type', 'text/event-stream'],
      ['Mcp-Session-Id', 'one'],
      ['Mcp-Session-Id', 'two'],
      ['Date', 'Thu, 01 Jan 1970 00:00:00 GMT'],
      ['Transfer-Encoding', 'chunked']
    ]);

    expect(observed.method).toBe('POST');
    expect(observed.url).toBe('/mcp');
    expect(Buffer.concat(observed.body).toString()).toBe('PING');
    const pairs = [];
    for (let index = 0; index < observed.rawHeaders.length; index += 2) {
      pairs.push([observed.rawHeaders[index], observed.rawHeaders[index + 1]]);
    }
    const requestConnections = pairs.filter(([name]) => name.toLowerCase() === 'connection');
    expect(requestConnections.length).toBeLessThanOrEqual(1);
    expect(requestConnections.every(([, value]) => value.toLowerCase() === 'close')).toBe(true);
    expect(pairs.filter(([name]) => name.toLowerCase() !== 'connection')).toEqual([
      ['Accept', 'application/json, text/event-stream'],
      ['MCP-Protocol-Version', '2025-11-25'],
      ['Mcp-Method', 'tools/list'],
      ['Mcp-Name', 'server_status'],
      ['Mcp-Param-Region', 'one'],
      ['Mcp-Param-Region', 'two'],
      ['Content-Length', '4'],
      ['Host', `127.0.0.1:${upstreamAddress.port}`],
      ['Authorization', `Bearer ${runner.CONFORMANCE_SENTINELS.token}`]
    ]);
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

    const declaredExchange = await rawRequest(
      port,
      ['POST /mcp HTTP/1.1\r\nHost: local\r\nContent-Length: 5\r\nConnection: close\r\n\r\n'],
      { waitForEnd: false }
    );
    await declaredExchange.waitForClose({ allowReset: true });
    const declared = Buffer.concat(declaredExchange.received).toString('latin1');
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
    const streamedClosed = streamedExchange.waitForClose({ allowReset: true });
    streamedExchange.socket.write('3\r\ncde\r\n0\r\n\r\n');
    await streamedClosed;
    const streamed = Buffer.concat(streamedExchange.received).toString('latin1');
    expect(streamed).toContain('413 Payload Too Large');
    await vi.waitFor(() => expect(upstreamAborts).toBe(1));

    const exact = await rawRequest(port, [
      'POST /mcp HTTP/1.1\r\nHost: local\r\nContent-Length: 4\r\nConnection: close\r\n\r\nPING'
    ]);
    expect(exact).toContain('HTTP/1.1 200 OK');
    expect(upstreamRequests).toBe(2);
  });

  it('withholds an early upstream response until a chunked body is fully validated', async () => {
    const upstreamResponded = deferred();
    const upstreamRequestAborted = deferred();
    const upstreamResponseClosed = deferred();
    const upstream = createServer((request, response) => {
      request.once('data', () => {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.write('EARLY_UPSTREAM_SUCCESS');
        upstreamResponded.resolve();
      });
      request.once('aborted', () => upstreamRequestAborted.resolve());
      response.once('close', () => upstreamResponseClosed.resolve());
    });
    const upstreamAddress = await listen(upstream);
    const proxy = await runner.startLoopbackProxy(
      `http://127.0.0.1:${upstreamAddress.port}/mcp`,
      runner.CONFORMANCE_SENTINELS.token,
      { ...HTTP_LIMITS, bodyBytes: 4 }
    );
    ownedResources.add(proxy);

    const exchange = await rawRequest(
      runner.parseExactLoopbackMcpUrl(proxy.url).port,
      [
        'POST /mcp HTTP/1.1\r\nHost: local\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
        '2\r\nab\r\n'
      ],
      { waitForEnd: false }
    );
    await upstreamResponded.promise;
    const exchangeClosed = exchange.waitForClose({ allowReset: true });
    exchange.socket.write('3\r\ncde\r\n0\r\n\r\n');
    await exchangeClosed;

    const rawResponse = Buffer.concat(exchange.received).toString('latin1');
    expect(rawResponse).toContain('HTTP/1.1 413 Payload Too Large');
    expect(rawResponse).not.toContain('HTTP/1.1 200 OK');
    expect(rawResponse).not.toContain('EARLY_UPSTREAM_SUCCESS');
    expect(rawResponse).not.toContain(runner.CONFORMANCE_SENTINELS.token);
    await Promise.all([upstreamRequestAborted.promise, upstreamResponseClosed.promise]);
  });

  it('destroys both upstream peers when the inbound request aborts', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const exchange = await controlledProxy();
      const upstreamResponse = new ControlledUpstreamResponse();
      const inbound = await rawRequest(
        runner.parseExactLoopbackMcpUrl(exchange.proxy.url).port,
        ['POST /mcp HTTP/1.1\r\nHost: local\r\nTransfer-Encoding: chunked\r\n\r\n', '2\r\nab\r\n'],
        { waitForEnd: false }
      );
      await vi.waitFor(() => expect(exchange.upstreamRequest.writes).toHaveLength(1));
      await exchange.deliver(upstreamResponse);

      const inboundClosed = inbound.waitForClose();
      inbound.socket.destroy();
      await inboundClosed;
      await vi.waitFor(() => {
        expect(exchange.upstreamRequest.destroyed).toBe(true);
        expect(upstreamResponse.destroyed).toBe(true);
      });
      expect(Buffer.concat(inbound.received).toString()).not.toContain(
        runner.CONFORMANCE_SENTINELS.token
      );
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('destroys the held upstream response when the upstream ClientRequest errors', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const exchange = await controlledProxy();
      const upstreamResponse = new ControlledUpstreamResponse();
      const inbound = await rawRequest(
        runner.parseExactLoopbackMcpUrl(exchange.proxy.url).port,
        [
          'POST /mcp HTTP/1.1\r\nHost: local\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
          '2\r\nab\r\n'
        ],
        { waitForEnd: false }
      );
      await exchange.deliver(upstreamResponse);

      const inboundClosed = inbound.waitForClose();
      exchange.upstreamRequest.emit('error', new Error('POISON_UPSTREAM_REQUEST'));
      expect(upstreamResponse.destroyed).toBe(true);
      await inboundClosed;
      const body = Buffer.concat(inbound.received).toString('latin1');
      expect(body).toContain('HTTP/1.1 502 Bad Gateway');
      expect(body).not.toContain(runner.CONFORMANCE_SENTINELS.token);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('destroys the inbound request after a synchronous upstream construction failure', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let destroyInbound;
      const createProxyServer = (options, listener) =>
        createServer(options, (request, response) => {
          const originalDestroy = request.destroy.bind(request);
          destroyInbound = vi.fn((...arguments_) => originalDestroy(...arguments_));
          request.destroy = destroyInbound;
          listener(request, response);
        });
      const proxy = await runner.startLoopbackProxy(
        'http://127.0.0.1:1/mcp',
        runner.CONFORMANCE_SENTINELS.token,
        HTTP_LIMITS,
        {
          createProxyServer,
          requestUpstream: () => {
            throw new Error('POISON_SYNCHRONOUS_UPSTREAM');
          }
        }
      );
      ownedResources.add(proxy);
      const inbound = await rawRequest(
        runner.parseExactLoopbackMcpUrl(proxy.url).port,
        [
          'POST /mcp HTTP/1.1\r\nHost: local\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
          '2\r\nab\r\n'
        ],
        { waitForEnd: false }
      );
      await inbound.waitForClose();

      const body = Buffer.concat(inbound.received).toString('latin1');
      expect(body).toContain('HTTP/1.1 502 Bad Gateway');
      expect(body).not.toContain(runner.CONFORMANCE_SENTINELS.token);
      expect(destroyInbound).toHaveBeenCalledOnce();
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('destroys the upstream ClientRequest when the upstream IncomingMessage errors', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const exchange = await controlledProxy();
      const upstreamResponse = new ControlledUpstreamResponse();
      const inbound = await rawRequest(
        runner.parseExactLoopbackMcpUrl(exchange.proxy.url).port,
        ['POST /mcp HTTP/1.1\r\nHost: local\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'],
        { waitForEnd: false }
      );
      await exchange.deliver(upstreamResponse);
      await vi.waitFor(() => expect(exchange.upstreamRequest.ended).toBe(true));

      const inboundClosed = inbound.waitForClose({ allowReset: true });
      upstreamResponse.emit('error', new Error('POISON_UPSTREAM_RESPONSE'));
      expect(exchange.upstreamRequest.destroyed).toBe(true);
      await inboundClosed;
      expect(Buffer.concat(inbound.received).toString()).not.toContain(
        runner.CONFORMANCE_SENTINELS.token
      );
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('destroys both upstream peers when the downstream response aborts', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const exchange = await controlledProxy();
      const upstreamResponse = new ControlledUpstreamResponse();
      const inbound = await rawRequest(
        runner.parseExactLoopbackMcpUrl(exchange.proxy.url).port,
        ['POST /mcp HTTP/1.1\r\nHost: local\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'],
        { waitForEnd: false }
      );
      await exchange.deliver(upstreamResponse);
      await vi.waitFor(() => expect(upstreamResponse.paused).toBe(false));
      upstreamResponse.emit('data', Buffer.from('SAFE_STREAM_CHUNK'));
      await vi.waitFor(() =>
        expect(Buffer.concat(inbound.received).toString()).toContain('SAFE_STREAM_CHUNK')
      );

      const inboundClosed = inbound.waitForClose();
      inbound.socket.destroy();
      await inboundClosed;
      await vi.waitFor(() => {
        expect(exchange.upstreamRequest.destroyed).toBe(true);
        expect(upstreamResponse.destroyed).toBe(true);
      });
      expect(Buffer.concat(inbound.received).toString()).not.toContain(
        runner.CONFORMANCE_SENTINELS.token
      );
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it.each(['inbound', 'upstream-request', 'upstream-response', 'downstream'])(
    'couples real Node HTTP peers when the %s leg aborts',
    async (leg) => {
      const uncaught = [];
      const unhandled = [];
      const onUncaught = (error) => uncaught.push(error);
      const onUnhandled = (error) => unhandled.push(error);
      process.on('uncaughtExceptionMonitor', onUncaught);
      process.on('unhandledRejection', onUnhandled);
      try {
        let serverRequest;
        let serverResponse;
        let serverSocket;
        const upstreamResponded = deferred();
        const upstream = createServer((request, response) => {
          serverRequest = request;
          serverResponse = response;
          serverSocket = request.socket;
          request.on('error', () => undefined);
          response.on('error', () => undefined);
          request.once('data', () => {
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.write('REAL_UPSTREAM_CHUNK');
            upstreamResponded.resolve();
          });
        });
        const upstreamAddress = await listen(upstream);
        let upstreamRequest;
        let upstreamResponse;
        let destroyUpstreamRequest;
        let destroyUpstreamResponse;
        const upstreamResponseReady = deferred();
        const proxy = await runner.startLoopbackProxy(
          `http://127.0.0.1:${upstreamAddress.port}/mcp`,
          runner.CONFORMANCE_SENTINELS.token,
          HTTP_LIMITS,
          {
            requestUpstream: (options, callback) => {
              upstreamRequest = httpRequest(options, (response) => {
                upstreamResponse = response;
                const originalDestroyResponse = response.destroy.bind(response);
                destroyUpstreamResponse = vi.fn((...arguments_) =>
                  originalDestroyResponse(...arguments_)
                );
                response.destroy = destroyUpstreamResponse;
                callback(response);
                upstreamResponseReady.resolve();
              });
              const originalDestroyRequest = upstreamRequest.destroy.bind(upstreamRequest);
              destroyUpstreamRequest = vi.fn((...arguments_) =>
                originalDestroyRequest(...arguments_)
              );
              upstreamRequest.destroy = destroyUpstreamRequest;
              return upstreamRequest;
            }
          }
        );
        ownedResources.add(proxy);
        const inbound = await rawRequest(
          runner.parseExactLoopbackMcpUrl(proxy.url).port,
          [
            'POST /mcp HTTP/1.1\r\nHost: local\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n',
            '2\r\nab\r\n'
          ],
          { waitForEnd: false }
        );
        await Promise.all([upstreamResponded.promise, upstreamResponseReady.promise]);
        const inboundClosed = inbound.waitForClose({
          allowReset: leg === 'upstream-request' || leg === 'upstream-response'
        });

        if (leg === 'inbound') {
          inbound.socket.destroy();
        } else if (leg === 'upstream-request') {
          upstreamRequest.destroy(new Error('REAL_UPSTREAM_REQUEST_ABORT'));
        } else if (leg === 'upstream-response') {
          upstreamResponse.destroy(new Error('REAL_UPSTREAM_RESPONSE_ABORT'));
        } else {
          inbound.socket.write('0\r\n\r\n');
          await vi.waitFor(() =>
            expect(Buffer.concat(inbound.received).toString()).toContain('REAL_UPSTREAM_CHUNK')
          );
          inbound.socket.destroy();
        }

        await inboundClosed;

        await vi.waitFor(() => {
          expect(inbound.socket.destroyed).toBe(true);
          expect(upstreamRequest.destroyed).toBe(true);
          expect(upstreamResponse.destroyed).toBe(true);
          expect(serverRequest.destroyed).toBe(true);
          expect(serverResponse.destroyed).toBe(true);
          expect(serverSocket.destroyed).toBe(true);
        });
        expect(destroyUpstreamRequest).toHaveBeenCalled();
        expect(destroyUpstreamResponse).toHaveBeenCalled();
        expect(Buffer.concat(inbound.received).toString()).not.toContain(
          runner.CONFORMANCE_SENTINELS.token
        );
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
        expect(uncaught).toEqual([]);
        expect(unhandled).toEqual([]);
      } finally {
        process.off('uncaughtExceptionMonitor', onUncaught);
        process.off('unhandledRejection', onUnhandled);
      }
    }
  );

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
    const held = Array.from({ length: 16 }, () =>
      connect(runner.parseExactLoopbackMcpUrl(proxy.url).port, '127.0.0.1')
    );
    for (const socket of held)
      ownedResources.add({ close: () => Promise.resolve(socket.destroy()) });
    await Promise.all(
      held.map((socket) => (socket.readyState === 'open' ? undefined : once(socket, 'connect')))
    );
    const seventeenth = connect(runner.parseExactLoopbackMcpUrl(proxy.url).port, '127.0.0.1');
    ownedResources.add({ close: () => Promise.resolve(seventeenth.destroy()) });
    await vi.waitFor(() => expect(seventeenth.destroyed).toBe(true));
    expect(constructed.listening).toBe(true);
    expect(held.every((socket) => !socket.destroyed)).toBe(true);
    const first = proxy.close();
    const second = proxy.close();
    expect(second).toBe(first);
    await first;
    await vi.waitFor(() =>
      expect([...held, seventeenth].every((socket) => socket.destroyed)).toBe(true)
    );
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

  it('force-closes real occupied-port and non-TCP startup failures', async () => {
    const occupied = createServer();
    const occupiedAddress = await listen(occupied);
    let occupiedProxy;
    const listenOccupied = (server) =>
      new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.once('listening', () => resolveListen(server.address()));
        server.listen(occupiedAddress.port, '127.0.0.1');
      });
    await expect(
      runner.startLoopbackProxy(
        'http://127.0.0.1:1/mcp',
        runner.CONFORMANCE_SENTINELS.token,
        HTTP_LIMITS,
        {
          createProxyServer: (options, listener) => {
            occupiedProxy = createServer(options, listener);
            return occupiedProxy;
          },
          listenProxy: listenOccupied
        }
      )
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(occupiedProxy.listening).toBe(false);

    const pipeDirectory = await temporaryDirectory();
    const pipePath = join(pipeDirectory, 'proxy.sock');
    let pipeProxy;
    let pipeClient;
    const listenPipe = async (server) => {
      server.listen(pipePath);
      await once(server, 'listening');
      pipeClient = connect(pipePath);
      ownedResources.add({ close: () => Promise.resolve(pipeClient.destroy()) });
      await once(pipeClient, 'connect');
      return server.address();
    };
    await expect(
      runner.startLoopbackProxy(
        'http://127.0.0.1:1/mcp',
        runner.CONFORMANCE_SENTINELS.token,
        HTTP_LIMITS,
        {
          createProxyServer: (options, listener) => {
            pipeProxy = createServer(options, listener);
            return pipeProxy;
          },
          listenProxy: listenPipe
        }
      )
    ).rejects.toBeDefined();
    expect(pipeProxy.listening).toBe(false);
    await vi.waitFor(() => expect(pipeClient.destroyed).toBe(true));
    expect(await readdir(pipeDirectory)).toEqual([]);
  });
});

describe('child deadline and process ownership', () => {
  function fakeChild({ emitSpawn = true } = {}) {
    const child = new EventEmitter();
    child.kill = vi.fn(() => true);
    child.unref = vi.fn();
    if (emitSpawn) queueMicrotask(() => child.emit('spawn'));
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

  it('retains escalation ownership when the child emits error during SIGTERM grace', async () => {
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
    const outcome = promise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    child.emit('error', new Error('POISON_TERMINATION_ERROR'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    child.emit('close', null, 'SIGKILL');

    await expect(outcome).resolves.toMatchObject({ name: 'ConformanceChildTimeoutError' });
  });

  it('retains final bounded detach ownership when the child emits error after SIGKILL', async () => {
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
    const outcome = promise.catch((error) => error);

    await vi.advanceTimersByTimeAsync(62_000);
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    child.emit('error', new Error('POISON_KILL_ERROR'));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(child.unref).toHaveBeenCalledOnce();
    await expect(outcome).resolves.toMatchObject({ name: 'ConformanceChildTimeoutError' });
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

  it('rejects a true pre-spawn error without retaining its message', async () => {
    const child = fakeChild({ emitSpawn: false });
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
      if (pid !== undefined && ownedPids.has(pid)) {
        await closeChildAndConfirm(pid);
        ownedPids.delete(pid);
      }
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

  const lateStartupPhases = [
    'makeStateDirectory',
    'installEnvironment',
    'createApplicationRuntime',
    'assertProductContract',
    'startProductHttp',
    'startProxy',
    'resolveExecutable'
  ];

  function lateStartupValue(phase, stateDirectory, cleanup) {
    if (phase === 'makeStateDirectory') return stateDirectory;
    if (phase === 'installEnvironment') return { restore: cleanup };
    if (phase === 'createApplicationRuntime') return { application: {}, close: cleanup };
    if (phase === 'startProductHttp') {
      return {
        url: 'http://127.0.0.1:1234/mcp',
        limits: HTTP_LIMITS,
        close: cleanup
      };
    }
    if (phase === 'startProxy') {
      return { url: 'http://127.0.0.1:5678/mcp', close: cleanup };
    }
    if (phase === 'resolveExecutable') return '/late/official/index.js';
    return undefined;
  }

  async function pendingStartup(phase) {
    vi.useFakeTimers();
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const acquisition = deferred();
    const started = deferred();
    const lateCleanup = vi.fn(async () => events.push(`late-cleanup:${phase}`));
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.removeStateDirectory = async (path) => {
      if (phase === 'makeStateDirectory' && path === stateDirectory) await lateCleanup();
      events.push('remove');
    };
    overrides[phase] = () => {
      started.resolve();
      return acquisition.promise;
    };
    const activeTimers = new Set();
    const referenced = [];
    overrides.clock = {
      set(callback, milliseconds) {
        let handle;
        handle = setTimeout(() => {
          activeTimers.delete(handle);
          callback();
        }, milliseconds);
        activeTimers.add(handle);
        referenced.push(handle.hasRef());
        return handle;
      },
      clear(handle) {
        activeTimers.delete(handle);
        clearTimeout(handle);
      }
    };
    const outcome = runner.runConformance('2025-11-25', overrides).catch((error) => error);
    await started.promise;
    await vi.advanceTimersByTimeAsync(runner.STARTUP_PHASE_TIMEOUT_MS);
    return {
      acquisition,
      activeTimers,
      error: outcome,
      events,
      lateCleanup,
      referenced,
      value: lateStartupValue(phase, stateDirectory, lateCleanup)
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

  it('drains proxy, then HTTP, then application while retaining every stable failure slot', async () => {
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const releases = new Map();
    const overrides = successfulOverrides(events, stateDirectory);
    const heldOwner = (label) => ({
      application: label === 'application' ? {} : undefined,
      url: label === 'http' ? 'http://127.0.0.1:1234/mcp' : undefined,
      limits: label === 'http' ? HTTP_LIMITS : undefined,
      close: () =>
        new Promise((resolveClose, rejectClose) => {
          events.push(`close-start:${label}`);
          releases.set(label, () =>
            rejectClose(new AggregateError([new Error(`POISON_${label}`)]))
          );
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
    await vi.waitFor(() => expect(releases.has('proxy')).toBe(true));
    expect(events.filter((entry) => entry.startsWith('close-start:'))).toEqual([
      'close-start:proxy'
    ]);
    releases.get('proxy')();
    await vi.waitFor(() => expect(releases.has('http')).toBe(true));
    expect(events.filter((entry) => entry.startsWith('close-start:'))).toEqual([
      'close-start:proxy',
      'close-start:http'
    ]);
    releases.get('http')();
    await vi.waitFor(() => expect(releases.has('application')).toBe(true));
    expect(events.filter((entry) => entry.startsWith('close-start:'))).toEqual([
      'close-start:proxy',
      'close-start:http',
      'close-start:application'
    ]);
    releases.get('application')();
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

  it.each(lateStartupPhases)(
    'cleans or discards a late %s fulfillment during the arrival grace',
    async (phase) => {
      const pending = await pendingStartup(phase);
      pending.acquisition.resolve(pending.value);
      await vi.advanceTimersByTimeAsync(0);
      const ownsLateCleanup = new Set([
        'makeStateDirectory',
        'installEnvironment',
        'createApplicationRuntime',
        'startProductHttp',
        'startProxy'
      ]).has(phase);
      expect(pending.lateCleanup).toHaveBeenCalledTimes(ownsLateCleanup ? 1 : 0);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await pending.error;
      expect(error.errors.map((entry) => [entry.name, entry.message])).toEqual([
        ['ConformanceStartupTimeoutError', 'Conformance startup phase timed out']
      ]);
      expect(pending.referenced.every(Boolean)).toBe(true);
      expect(pending.activeTimers.size).toBe(0);
      expect(JSON.stringify(error)).not.toContain('/late/official');
    }
  );

  it.each(lateStartupPhases)(
    'observes a late %s rejection during the arrival grace without cleanup or leakage',
    async (phase) => {
      const pending = await pendingStartup(phase);
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        pending.acquisition.reject(new Error(`POISON_LATE_REJECTION_${phase}`));
        await vi.advanceTimersByTimeAsync(1_000);
        const error = await pending.error;
        expect(error.errors.map((entry) => [entry.name, entry.message])).toEqual([
          ['ConformanceStartupTimeoutError', 'Conformance startup phase timed out']
        ]);
        expect(pending.lateCleanup).not.toHaveBeenCalled();
        expect(pending.referenced.every(Boolean)).toBe(true);
        expect(pending.activeTimers.size).toBe(0);
        expect(JSON.stringify(error)).not.toContain('POISON');
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    }
  );

  it.each(lateStartupPhases)(
    'reports %s arriving after grace as unconfirmed, then cleans or discards it exactly once',
    async (phase) => {
      const pending = await pendingStartup(phase);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await pending.error;
      expect(error.errors.map((entry) => [entry.name, entry.message])).toEqual([
        ['ConformanceStartupTimeoutError', 'Conformance startup phase timed out'],
        ['ConformanceCleanupTimeoutError', 'Conformance cleanup timed out: late-startup']
      ]);
      expect(pending.lateCleanup).not.toHaveBeenCalled();

      pending.acquisition.resolve(pending.value);
      await vi.advanceTimersByTimeAsync(0);
      const ownsLateCleanup = new Set([
        'makeStateDirectory',
        'installEnvironment',
        'createApplicationRuntime',
        'startProductHttp',
        'startProxy'
      ]).has(phase);
      expect(pending.lateCleanup).toHaveBeenCalledTimes(ownsLateCleanup ? 1 : 0);
      expect(pending.referenced.every(Boolean)).toBe(true);
      expect(pending.activeTimers.size).toBe(0);
    }
  );

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

  it.each(
    ['proxy', 'http', 'application', 'temp-state', 'environment'].flatMap((slot) =>
      ['throw', 'reject'].map((mode) => [slot, mode])
    )
  )('redacts and orders a %s cleanup %s with referenced timers', async (slot, mode) => {
    vi.useFakeTimers();
    const events = [];
    const stateDirectory = await temporaryDirectory();
    const overrides = successfulOverrides(events, stateDirectory);
    overrides.runChild = async () => undefined;
    overrides.validateReport = async () => undefined;
    const fail = () => {
      events.push(`cleanup-failure:${slot}`);
      const error = new Error(`POISON_CLEANUP_${slot}_${mode}`);
      if (mode === 'throw') throw error;
      return Promise.reject(error);
    };
    if (slot === 'application') {
      overrides.createApplicationRuntime = async () => ({ application: {}, close: fail });
    } else if (slot === 'http') {
      overrides.startProductHttp = async () => ({
        url: 'http://127.0.0.1:1234/mcp',
        limits: HTTP_LIMITS,
        close: fail
      });
    } else if (slot === 'proxy') {
      overrides.startProxy = async () => ({
        url: 'http://127.0.0.1:5678/mcp',
        close: fail
      });
    } else if (slot === 'temp-state') {
      overrides.removeStateDirectory = fail;
    } else {
      overrides.installEnvironment = async () => ({ restore: fail });
    }
    const activeTimers = new Set();
    const referenced = [];
    overrides.clock = {
      set(callback, milliseconds) {
        let handle;
        handle = setTimeout(() => {
          activeTimers.delete(handle);
          callback();
        }, milliseconds);
        activeTimers.add(handle);
        referenced.push(handle.hasRef());
        return handle;
      },
      clear(handle) {
        activeTimers.delete(handle);
        clearTimeout(handle);
      }
    };

    const error = await runner.runConformance('2025-11-25', overrides).catch((reason) => reason);
    expect(error.errors.map((entry) => [entry.name, entry.message])).toEqual([
      ['ConformanceCleanupError', `Conformance operation failed: ${slot}`]
    ]);
    expect(JSON.stringify(error)).not.toContain('POISON');
    expect(referenced.length).toBeGreaterThan(7);
    expect(referenced.every(Boolean)).toBe(true);
    expect(activeTimers.size).toBe(0);

    const failureIndex = events.indexOf(`cleanup-failure:${slot}`);
    const removeIndex = events.indexOf('remove');
    const restoreIndex = events.indexOf('restore');
    if (new Set(['proxy', 'http', 'application']).has(slot)) {
      expect(failureIndex).toBeLessThan(removeIndex);
      expect(removeIndex).toBeLessThan(restoreIndex);
    } else if (slot === 'temp-state') {
      expect(events.indexOf('close:proxy')).toBeLessThan(failureIndex);
      expect(events.indexOf('close:http')).toBeLessThan(failureIndex);
      expect(events.indexOf('close:application')).toBeLessThan(failureIndex);
      expect(failureIndex).toBeLessThan(restoreIndex);
    } else {
      expect(removeIndex).toBeLessThan(failureIndex);
      expect(failureIndex).toBe(events.length - 1);
    }
  });
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
      if (child.pid !== undefined) {
        await pollProcessGone(child.pid);
        ownedPids.delete(child.pid);
      }
    } finally {
      clearTimeout(outer);
      if (child.pid !== undefined && ownedPids.has(child.pid)) {
        await closeChildAndConfirm(child.pid);
        ownedPids.delete(child.pid);
      }
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
        const stdoutText = Buffer.concat(stdout).toString();
        const stderrText = Buffer.concat(stderr).toString();
        expect(stderrText).toBe('');
        assertOfficialStdoutContract(stdoutText, version, dedicatedTmp, poison);
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
        if (child.pid !== undefined && ownedPids.has(child.pid)) {
          await closeChildAndConfirm(child.pid);
          ownedPids.delete(child.pid);
        }
      }
    },
    210_000
  );
});
