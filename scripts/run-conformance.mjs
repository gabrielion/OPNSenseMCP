// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdtemp, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dispatchApplicationCapability,
  listApplicationCapabilities
} from '../dist/app/application-context.js';
import { createDefaultApplicationRuntime } from '../dist/app/default-application.js';
import { serverStatusCapability } from '../dist/capabilities/foundation/server-status.js';
import { startHttp } from '../dist/http/runtime.js';

const LOOPBACK = '127.0.0.1';
const CHILD_TIMEOUT_MS = 60_000;
const CHILD_KILL_GRACE_MS = 2_000;
const CHILD_KILL_CONFIRM_MS = 2_000;
const REPORT_VALIDATION_TIMEOUT_MS = 1_000;
export const STARTUP_PHASE_TIMEOUT_MS = 1_000;
const LATE_STARTUP_ARRIVAL_GRACE_MS = 1_000;
const LATE_STARTUP_CLEANUP_TIMEOUT_MS = 1_000;
const OWNER_CLEANUP_TIMEOUT_MS = 1_000;
const STATE_CLEANUP_TIMEOUT_MS = 1_000;
const ENVIRONMENT_RESTORE_TIMEOUT_MS = 1_000;
const DIRECT_EXIT_GRACE_MS = 1_000;
const MAX_PROXY_CONNECTIONS = 16;
export const MAX_PROXY_REQUESTS_PER_SOCKET = 16;
const CONFORMANCE_VERSION = '0.2.0-alpha.9';

export const MAX_CONFORMANCE_REPORT_BYTES = 1_048_576;

export const SCENARIOS_BY_VERSION = Object.freeze({
  '2025-11-25': Object.freeze(['server-initialize', 'ping', 'tools-list']),
  '2026-07-28': Object.freeze([
    'tools-list',
    'input-required-result-unsupported-methods',
    'http-header-validation'
  ])
});

export const CONFORMANCE_SENTINELS = Object.freeze({
  token: 'CONFORMANCE_HTTP_SENTINEL_TOKEN_0123456789',
  requestState: 'CONFORMANCE_REQUEST_STATE_0123456789',
  apiKey: 'conformance-sentinel-key',
  apiSecret: 'conformance-sentinel-secret'
});

const OWNED_ENVIRONMENT_PREFIXES = Object.freeze(['OPNSENSE_', 'MCP_', 'ENABLE_', 'IAC_']);
const OWNED_ENVIRONMENT_EXACT = Object.freeze([
  'READ_ONLY',
  'ALLOWED_RESOURCES',
  'ENABLED_FEATURE_FLAGS',
  'AUTO_BACKUP',
  'AUTO_BACKUP_STRICT',
  'AUDIT_LOG',
  'AUDIT_LOG_STRICT',
  'BACKUP_PATH'
]);

const SYSTEM_TIMER = Object.freeze({
  set: setTimeout,
  clear: clearTimeout
});

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const NO_FAILURE = Symbol('no-failure');

function scheduleReferencedTimer(clock, callback, milliseconds) {
  return clock.set(callback, milliseconds);
}

function isOwnedEnvironmentName(name) {
  return (
    OWNED_ENVIRONMENT_EXACT.includes(name) ||
    OWNED_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

export function installConformanceEnvironment(stateDirectory, environment = process.env) {
  const replacements = Object.freeze({
    READ_ONLY: 'true',
    ALLOWED_RESOURCES: '',
    ENABLED_FEATURE_FLAGS: '',
    AUTO_BACKUP: 'false',
    AUTO_BACKUP_STRICT: 'true',
    AUDIT_LOG_STRICT: 'true',
    MCP_HTTP_ENABLED: 'true',
    MCP_HTTP_HOST: LOOPBACK,
    MCP_HTTP_PORT: '3000',
    MCP_HTTP_TOKEN: CONFORMANCE_SENTINELS.token,
    MCP_LEGACY_SSE_ENABLED: 'false',
    MCP_ALLOWED_HOSTS: LOOPBACK,
    MCP_ALLOWED_ORIGINS: '',
    MCP_REQUEST_STATE_SECRET: CONFORMANCE_SENTINELS.requestState,
    OPNSENSE_URL: 'https://127.0.0.1:9/api',
    OPNSENSE_API_KEY: CONFORMANCE_SENTINELS.apiKey,
    OPNSENSE_API_SECRET: CONFORMANCE_SENTINELS.apiSecret,
    OPNSENSE_VERIFY_TLS: 'true',
    ENABLE_SSH_FEATURES: 'false',
    ENABLE_SHELL_TOOLS: 'false',
    ENABLE_RESTORE_TOOLS: 'false',
    IAC_ENABLED: 'false',
    BACKUP_PATH: join(stateDirectory, 'backups'),
    AUDIT_LOG: join(stateDirectory, 'audit.jsonl'),
    OPNSENSE_BACKUP_PATH: join(stateDirectory, 'backups'),
    OPNSENSE_AUDIT_LOG: join(stateDirectory, 'audit.jsonl')
  });
  const snapshotNames = new Set([
    ...Object.keys(replacements),
    ...Object.keys(environment).filter(isOwnedEnvironmentName)
  ]);
  const snapshot = new Map(
    [...snapshotNames].map((name) => [
      name,
      { present: Object.hasOwn(environment, name), value: environment[name] }
    ])
  );

  function restore() {
    for (const name of Object.keys(environment)) {
      if (isOwnedEnvironmentName(name) || Object.hasOwn(replacements, name)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- The owned namespace is computed.
        delete environment[name];
      }
    }
    for (const [name, entry] of snapshot) {
      if (entry.present) environment[name] = entry.value;
    }
  }

  try {
    for (const name of Object.keys(environment)) {
      if (isOwnedEnvironmentName(name) || Object.hasOwn(replacements, name)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- The owned namespace is computed.
        delete environment[name];
      }
    }
    Object.assign(environment, replacements);
  } catch (error) {
    try {
      restore();
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError]);
    }
    throw error;
  }
  return Object.freeze({ restore });
}

function conformanceProductContractError() {
  const error = new Error('Conformance product contract is unavailable');
  error.name = 'ConformanceProductContractError';
  return error;
}

export async function assertConformanceProductContract(application, overrides = {}) {
  const dependencies = {
    list: listApplicationCapabilities,
    dispatch: dispatchApplicationCapability,
    expected: serverStatusCapability,
    ...overrides
  };
  try {
    const exposed = dependencies.list(application, 'http');
    const first = exposed[0];
    if (
      first !== dependencies.expected ||
      first.id !== 'server.status' ||
      first.mcpName !== 'server_status' ||
      first.title !== 'Server status' ||
      first.description !==
        'Report whether the MCP server is healthy and operating in read-only mode.' ||
      first.annotations.readOnlyHint !== true ||
      first.annotations.destructiveHint !== false ||
      first.annotations.idempotentHint !== true ||
      first.annotations.openWorldHint !== false ||
      first.transports.length !== 2 ||
      first.transports[0] !== 'stdio' ||
      first.transports[1] !== 'http' ||
      first.policy.effect !== 'read' ||
      first.policy.backup !== 'none' ||
      first.policy.audit !== 'none' ||
      first.policy.confirmation !== 'none' ||
      first.policy.timeoutMs !== 1_000 ||
      first.policy.resourceScopes.length !== 1 ||
      first.policy.resourceScopes[0] !== 'server.status' ||
      first.policy.requiredFeatureFlags.length !== 0 ||
      first.policy.redactFields.length !== 0
    ) {
      throw conformanceProductContractError();
    }
    const parsed = first.parseInput({});
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 0
    ) {
      throw conformanceProductContractError();
    }
    let rejectsExtra = false;
    try {
      first.parseInput({ unexpected: true });
    } catch {
      rejectsExtra = true;
    }
    if (!rejectsExtra) throw conformanceProductContractError();
    for (const invalidInput of [null, [], '', 0, false, undefined]) {
      let rejectsInvalidInput = false;
      try {
        first.parseInput(invalidInput);
      } catch {
        rejectsInvalidInput = true;
      }
      if (!rejectsInvalidInput) throw conformanceProductContractError();
    }

    const result = await dependencies.dispatch(
      application,
      { name: 'server_status', arguments: {} },
      { transport: 'http', principalId: 'conformance:preflight' }
    );
    if (
      result.kind !== 'success' ||
      result.output.status !== 'ok' ||
      result.output.readOnly !== true ||
      result.output.version !== '0.1.0' ||
      Object.keys(result.output).sort().join(',') !== 'readOnly,status,version'
    ) {
      throw conformanceProductContractError();
    }
  } catch {
    throw conformanceProductContractError();
  }
}

export function buildScenarioArgv(executable, proxyUrl, version, scenario, stateDirectory) {
  return [
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
  ];
}

export async function resolveConformanceExecutable() {
  const packagePath = fileURLToPath(
    new URL('../node_modules/@modelcontextprotocol/conformance/package.json', import.meta.url)
  );
  const document = JSON.parse(await readFile(packagePath, 'utf8'));
  if (document.version !== CONFORMANCE_VERSION) {
    throw new Error('Conformance package version mismatch');
  }
  return join(dirname(packagePath), 'dist', 'index.js');
}

export function parseExactLoopbackMcpUrl(value) {
  if (typeof value !== 'string') throw new Error('Invalid loopback MCP URL');
  const match = /^http:\/\/127\.0\.0\.1:(?<port>0|[1-9][0-9]{0,4})\/mcp(?![\s\S])/u.exec(value);
  if (match?.[0] !== value) throw new Error('Invalid loopback MCP URL');
  const portText = match?.groups?.port;
  const port = portText === undefined ? Number.NaN : Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid loopback MCP URL');
  }
  const parsed = new URL(value);
  return Object.freeze({
    href: value,
    url: parsed,
    hostname: LOOPBACK,
    port,
    host: `${LOOPBACK}:${portText}`,
    pathname: '/mcp'
  });
}

function conformanceReportError() {
  const error = new Error('Conformance scenario report is invalid');
  error.name = 'ConformanceReportError';
  return error;
}

function isStrictDescendant(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function matchesMetadata(expected, actual, kind) {
  return (
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.size === actual.size &&
    expected.ctimeNs === actual.ctimeNs &&
    expected.mtimeNs === actual.mtimeNs &&
    (kind === 'directory' ? actual.isDirectory() : actual.isFile()) &&
    !actual.isSymbolicLink()
  );
}

async function revalidateReportPath(path, root, expected, kind) {
  const actual = await lstat(path, { bigint: true });
  if (!matchesMetadata(expected, actual, kind)) throw conformanceReportError();
  if ((await realpath(path)) !== root) throw conformanceReportError();
}

async function readBoundedReport(handle) {
  const bytes = Buffer.allocUnsafe(MAX_CONFORMANCE_REPORT_BYTES + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset < 1 || offset > MAX_CONFORMANCE_REPORT_BYTES) throw conformanceReportError();
  return { content: bytes.subarray(0, offset).toString('utf8'), size: offset };
}

export async function validateScenarioReport(stateDirectory, version, scenario, overrides = {}) {
  const dependencies = {
    openReport: open,
    clock: SYSTEM_TIMER,
    ...overrides
  };
  let reportHandle;
  let accepted = false;
  try {
    const stateMetadata = await lstat(stateDirectory, { bigint: true });
    if (stateMetadata.isSymbolicLink() || !stateMetadata.isDirectory())
      throw conformanceReportError();
    const stateRoot = await realpath(stateDirectory);

    const resultsPath = join(stateRoot, 'results');
    const resultsMetadata = await lstat(resultsPath, { bigint: true });
    if (resultsMetadata.isSymbolicLink() || !resultsMetadata.isDirectory()) {
      throw conformanceReportError();
    }
    const resultsRoot = await realpath(resultsPath);
    if (!isStrictDescendant(stateRoot, resultsRoot)) throw conformanceReportError();

    const versionPath = join(resultsRoot, version);
    const versionMetadata = await lstat(versionPath, { bigint: true });
    if (versionMetadata.isSymbolicLink() || !versionMetadata.isDirectory()) {
      throw conformanceReportError();
    }
    const versionRoot = await realpath(versionPath);
    if (!isStrictDescendant(resultsRoot, versionRoot)) throw conformanceReportError();

    const scenarioPath = join(versionRoot, scenario);
    const scenarioMetadata = await lstat(scenarioPath, { bigint: true });
    if (scenarioMetadata.isSymbolicLink() || !scenarioMetadata.isDirectory()) {
      throw conformanceReportError();
    }
    const scenarioRoot = await realpath(scenarioPath);
    if (!isStrictDescendant(versionRoot, scenarioRoot)) throw conformanceReportError();

    const runEntries = await readdir(scenarioRoot, { withFileTypes: true });
    if (
      runEntries.length !== 1 ||
      !runEntries[0].isDirectory() ||
      runEntries[0].isSymbolicLink() ||
      !runEntries[0].name.startsWith(`server-${scenario}-`)
    ) {
      throw conformanceReportError();
    }
    const runPath = join(scenarioRoot, runEntries[0].name);
    const runMetadata = await lstat(runPath, { bigint: true });
    if (runMetadata.isSymbolicLink() || !runMetadata.isDirectory()) throw conformanceReportError();
    const runRoot = await realpath(runPath);
    if (!isStrictDescendant(scenarioRoot, runRoot)) throw conformanceReportError();

    const reportEntries = await readdir(runRoot, { withFileTypes: true });
    if (
      reportEntries.length !== 1 ||
      reportEntries[0].name !== 'checks.json' ||
      reportEntries[0].isSymbolicLink() ||
      !reportEntries[0].isFile()
    ) {
      throw conformanceReportError();
    }
    const reportPath = join(runRoot, 'checks.json');
    const reportMetadata = await lstat(reportPath, { bigint: true });
    if (
      reportMetadata.isSymbolicLink() ||
      !reportMetadata.isFile() ||
      reportMetadata.size < 1n ||
      reportMetadata.size > BigInt(MAX_CONFORMANCE_REPORT_BYTES)
    ) {
      throw conformanceReportError();
    }
    const reportRoot = await realpath(reportPath);
    if (!isStrictDescendant(runRoot, reportRoot) || reportRoot !== reportPath) {
      throw conformanceReportError();
    }

    reportHandle = await dependencies.openReport(
      reportRoot,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    const openedMetadata = await reportHandle.stat({ bigint: true });
    if (!matchesMetadata(reportMetadata, openedMetadata, 'file')) {
      throw conformanceReportError();
    }
    const report = await readBoundedReport(reportHandle);
    const postReadMetadata = await reportHandle.stat({ bigint: true });
    if (
      !matchesMetadata(reportMetadata, postReadMetadata, 'file') ||
      postReadMetadata.size !== BigInt(report.size)
    ) {
      throw conformanceReportError();
    }

    await revalidateReportPath(stateDirectory, stateRoot, stateMetadata, 'directory');
    await revalidateReportPath(resultsPath, resultsRoot, resultsMetadata, 'directory');
    await revalidateReportPath(versionPath, versionRoot, versionMetadata, 'directory');
    await revalidateReportPath(scenarioPath, scenarioRoot, scenarioMetadata, 'directory');
    await revalidateReportPath(runPath, runRoot, runMetadata, 'directory');
    await revalidateReportPath(reportPath, reportRoot, reportMetadata, 'file');

    const checks = JSON.parse(report.content);
    if (!Array.isArray(checks) || checks.length === 0) throw conformanceReportError();
    const statuses = checks.map((check) => {
      if (check === null || typeof check !== 'object' || Array.isArray(check)) {
        throw conformanceReportError();
      }
      return check.status;
    });
    if (
      !statuses.includes('SUCCESS') ||
      statuses.some((status) => status !== 'SUCCESS' && status !== 'INFO')
    ) {
      throw conformanceReportError();
    }
    accepted = true;
  } catch {
    accepted = false;
  }
  if (reportHandle !== undefined) {
    try {
      await settleWithin(
        'scenario-report-handle',
        () => reportHandle.close(),
        REPORT_VALIDATION_TIMEOUT_MS,
        dependencies.clock,
        () => conformanceReportError()
      );
    } catch {
      accepted = false;
    }
  }
  if (!accepted) throw conformanceReportError();
}

function filterRawHeaders(rawHeaders, additionalNames = []) {
  const dropped = new Set([...HOP_BY_HOP, ...additionalNames.map((name) => name.toLowerCase())]);
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() !== 'connection') continue;
    for (const value of rawHeaders[index + 1].split(',')) {
      const name = value.trim().toLowerCase();
      if (name !== '') dropped.add(name);
    }
  }
  const result = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (!dropped.has(rawHeaders[index].toLowerCase())) {
      result.push(rawHeaders[index], rawHeaders[index + 1]);
    }
  }
  return result;
}

function fixedResponse(response, status, body) {
  if (response.headersSent || response.destroyed || response.writableEnded) return;
  const payload = Buffer.from(body);
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(payload.length),
    Connection: 'close'
  });
  response.end(payload);
}

function listenNodeServer(server) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, LOOPBACK);
  });
}

function flattenUnknownFailures(value) {
  if (value instanceof AggregateError) return value.errors.flatMap(flattenUnknownFailures);
  return [value instanceof Error ? value : new Error('Conformance proxy cleanup failed')];
}

export async function startLoopbackProxy(upstreamUrl, token, limits, overrides = {}) {
  const upstream = parseExactLoopbackMcpUrl(upstreamUrl);
  const dependencies = {
    createProxyServer: (options, listener) => createServer(options, listener),
    listenProxy: listenNodeServer,
    requestUpstream: httpRequest,
    ...overrides
  };
  const sockets = new Set();
  let closePromise;
  let server;

  const close = () => {
    closePromise ??= (async () => {
      const operations = [];
      operations.push(
        new Promise((resolveClose, rejectClose) => {
          try {
            server.close((error) => {
              if (error === undefined || error?.code === 'ERR_SERVER_NOT_RUNNING') resolveClose();
              else rejectClose(error);
            });
          } catch (error) {
            if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolveClose();
            else rejectClose(error);
          }
        })
      );
      operations.push(
        Promise.resolve().then(() => {
          server.closeAllConnections();
        })
      );
      operations.push(
        Promise.resolve().then(() => {
          for (const socket of sockets) socket.destroy();
        })
      );
      const results = await Promise.allSettled(operations);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? flattenUnknownFailures(result.reason) : []
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'Conformance proxy cleanup failed');
    })();
    return closePromise;
  };

  const listener = (request, response) => {
    if (request.url !== upstream.pathname) {
      fixedResponse(response, 404, 'Not Found\n');
      response.once('finish', () => request.destroy());
      return;
    }
    const declaredLength = request.headers['content-length'];
    if (
      typeof declaredLength === 'string' &&
      /^\d+$/u.test(declaredLength) &&
      Number(declaredLength) > limits.bodyBytes
    ) {
      fixedResponse(response, 413, 'Payload Too Large\n');
      response.once('finish', () => request.destroy());
      return;
    }

    const forwardedHeaders = filterRawHeaders(request.rawHeaders, ['host', 'authorization']);
    forwardedHeaders.push('Host', upstream.host);
    forwardedHeaders.push('Authorization', `Bearer ${token}`);
    let upstreamRequest;
    let activeUpstreamResponse;
    let requestEnded = false;
    let upstreamResponsePublished = false;
    let upstreamFailureStarted = false;
    let responseFinished = false;
    let tooLarge = false;
    let bodyBytes = 0;

    const destroyInbound = () => {
      if (!request.destroyed) request.destroy();
    };
    const destroyDownstream = () => {
      if (!response.destroyed && !response.writableEnded) response.destroy();
    };
    const destroyUpstream = () => {
      activeUpstreamResponse?.destroy();
      upstreamRequest?.destroy();
    };
    const finishLocalFailure = (status, body) => {
      if (response.headersSent || response.destroyed || response.writableEnded) {
        destroyInbound();
        destroyDownstream();
        return;
      }
      response.once('finish', destroyInbound);
      fixedResponse(response, status, body);
    };
    const failUpstream = (source) => {
      if (upstreamFailureStarted) return;
      upstreamFailureStarted = true;
      if (source !== 'request') upstreamRequest?.destroy();
      if (source !== 'response') activeUpstreamResponse?.destroy();
      if (tooLarge || responseFinished) return;
      if (response.headersSent) {
        destroyInbound();
        destroyDownstream();
      } else {
        finishLocalFailure(502, 'Bad Gateway\n');
      }
    };
    const failInbound = () => {
      destroyUpstream();
      destroyDownstream();
    };
    const failDownstream = () => {
      if (responseFinished) return;
      destroyInbound();
      destroyUpstream();
    };
    const publishUpstreamResponse = () => {
      if (
        !requestEnded ||
        upstreamResponsePublished ||
        activeUpstreamResponse === undefined ||
        tooLarge ||
        response.destroyed ||
        response.writableEnded
      ) {
        return;
      }
      upstreamResponsePublished = true;
      const upstreamResponse = activeUpstreamResponse;
      const responseHeaders = filterRawHeaders(upstreamResponse.rawHeaders);
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        responseHeaders
      );
      upstreamResponse.on('data', (chunk) => {
        if (!response.write(chunk)) {
          upstreamResponse.pause();
          response.once('drain', () => upstreamResponse.resume());
        }
      });
      upstreamResponse.once('end', () => {
        responseFinished = true;
        response.end();
      });
      upstreamResponse.resume();
    };
    const onRequestData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bodyBytes += buffer.length;
      if (bodyBytes > limits.bodyBytes) {
        tooLarge = true;
        request.pause();
        request.off('data', onRequestData);
        destroyUpstream();
        fixedResponse(response, 413, 'Payload Too Large\n');
        response.once('finish', () => request.destroy());
        return;
      }
      if (!upstreamRequest.write(buffer)) {
        request.pause();
        upstreamRequest.once('drain', () => request.resume());
      }
    };

    try {
      upstreamRequest = dependencies.requestUpstream(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: upstream.pathname,
          method: request.method,
          headers: forwardedHeaders,
          agent: false
        },
        (upstreamResponse) => {
          activeUpstreamResponse = upstreamResponse;
          upstreamResponse.pause();
          if (tooLarge || upstreamFailureStarted || response.destroyed || response.writableEnded) {
            upstreamResponse.destroy();
            return;
          }
          upstreamResponse.once('aborted', () => failUpstream('response'));
          upstreamResponse.once('error', () => failUpstream('response'));
          publishUpstreamResponse();
        }
      );
    } catch {
      finishLocalFailure(502, 'Bad Gateway\n');
      return;
    }
    upstreamRequest.once('error', () => failUpstream('request'));
    request.on('data', onRequestData);
    request.once('end', () => {
      requestEnded = true;
      if (!tooLarge) {
        upstreamRequest.end();
        publishUpstreamResponse();
      }
    });
    request.once('aborted', failInbound);
    request.once('error', failInbound);
    response.once('close', failDownstream);
    response.once('error', failDownstream);
  };

  server = dependencies.createProxyServer(
    {
      headersTimeout: limits.headersTimeoutMs,
      requestTimeout: limits.bodyReceiptTimeoutMs,
      keepAliveTimeout: limits.keepAliveTimeoutMs,
      connectionsCheckingInterval: Math.min(
        1_000,
        limits.headersTimeoutMs,
        limits.bodyReceiptTimeoutMs
      )
    },
    listener
  );
  server.maxRequestsPerSocket = MAX_PROXY_REQUESTS_PER_SOCKET;
  server.maxConnections = MAX_PROXY_CONNECTIONS;
  server.on('connection', (socket) => {
    if (sockets.size >= MAX_PROXY_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  try {
    const address = await dependencies.listenProxy(server);
    if (address === null || typeof address === 'string' || address.family !== 'IPv4') {
      throw new Error('Conformance proxy did not expose a TCP address');
    }
    const url = `http://${LOOPBACK}:${String(address.port)}/mcp`;
    parseExactLoopbackMcpUrl(url);
    return Object.freeze({ url, close });
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Conformance proxy startup failed');
    }
    throw error;
  }
}

function conformanceChildError(category, version, scenario, code, signal) {
  const error = new Error(
    `Conformance child failed: ${category}; version=${version}; scenario=${scenario}; code=${String(code)}; signal=${String(signal)}`
  );
  error.name = category === 'timeout' ? 'ConformanceChildTimeoutError' : 'ConformanceChildError';
  return error;
}

export function runConformanceChild(input, overrides = {}) {
  const dependencies = {
    spawnProcess: spawn,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    ...overrides
  };
  let child;
  try {
    child = dependencies.spawnProcess(
      process.execPath,
      buildScenarioArgv(
        input.executable,
        input.proxyUrl,
        input.version,
        input.scenario,
        input.stateDirectory
      ),
      { stdio: 'inherit', env: process.env }
    );
  } catch {
    return Promise.reject(
      conformanceChildError('spawn', input.version, input.scenario, null, null)
    );
  }

  return new Promise((resolveChild, rejectChild) => {
    let settled = false;
    let timedOut = false;
    const handles = new Set();
    const clock = { set: dependencies.setTimer, clear: dependencies.clearTimer };
    const clearHandles = () => {
      for (const handle of handles) clock.clear(handle);
      handles.clear();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearHandles();
      child.off('close', onClose);
      child.off('error', onError);
      callback(value);
    };
    const schedule = (callback, milliseconds) => {
      const handle = scheduleReferencedTimer(clock, callback, milliseconds);
      handles.add(handle);
      return handle;
    };
    const timeoutError = () =>
      conformanceChildError('timeout', input.version, input.scenario, null, 'SIGKILL');
    const onClose = (code, signal) => {
      if (timedOut) {
        finish(rejectChild, timeoutError());
      } else if (code === 0 && signal === null) {
        finish(resolveChild);
      } else {
        finish(
          rejectChild,
          conformanceChildError('exit', input.version, input.scenario, code, signal)
        );
      }
    };
    const onError = () => {
      finish(
        rejectChild,
        conformanceChildError('spawn', input.version, input.scenario, null, null)
      );
    };
    child.once('close', onClose);
    child.once('error', onError);
    schedule(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // Continue to the independently owned SIGKILL deadline.
      }
      if (settled) return;
      schedule(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The close event remains the process ownership signal.
        }
        if (settled) return;
        schedule(() => {
          child.unref();
          finish(rejectChild, timeoutError());
        }, CHILD_KILL_CONFIRM_MS);
      }, CHILD_KILL_GRACE_MS);
    }, CHILD_TIMEOUT_MS);
  });
}

function operationTimeout(label) {
  const error = new Error(`Conformance cleanup timed out: ${label}`);
  error.name = 'ConformanceCleanupTimeoutError';
  return error;
}

function settleWithin(label, operation, milliseconds, clock, timeoutError = operationTimeout) {
  return new Promise((resolveOperation, rejectOperation) => {
    let settled = false;
    let handle;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (handle !== undefined) clock.clear(handle);
      callback(value);
    };
    handle = scheduleReferencedTimer(
      clock,
      () => finish(rejectOperation, timeoutError(label)),
      milliseconds
    );
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(resolveOperation, value),
        (error) => finish(rejectOperation, error)
      );
  });
}

function startupTimeout() {
  const error = new Error('Conformance startup phase timed out');
  error.name = 'ConformanceStartupTimeoutError';
  return error;
}

function waitReferenced(clock, milliseconds) {
  return new Promise((resolveWait) => {
    scheduleReferencedTimer(clock, resolveWait, milliseconds);
  });
}

function fulfilled() {
  return { status: 'fulfilled', value: undefined };
}

function createLateStartupTracker(clock) {
  const slots = [];
  return Object.freeze({
    reserve(label) {
      const slot = { label, state: 'pending', cleanupResult: undefined };
      slots.push(slot);
      return slot;
    },
    rejected(slot) {
      slot.state = 'rejected';
    },
    fulfilled(slot, value, cleanupLate) {
      slot.state = 'fulfilled';
      slot.cleanupResult =
        cleanupLate === undefined
          ? Promise.resolve(fulfilled())
          : settleWithin(
              'late-startup',
              () => cleanupLate(value),
              LATE_STARTUP_CLEANUP_TIMEOUT_MS,
              clock
            ).then(
              () => fulfilled(),
              (reason) => ({ status: 'rejected', reason })
            );
    },
    async drain() {
      if (slots.length === 0) return fulfilled();
      await waitReferenced(clock, LATE_STARTUP_ARRIVAL_GRACE_MS);
      const results = await Promise.all(
        slots.map((slot) => {
          if (slot.state === 'pending') {
            return { status: 'rejected', reason: operationTimeout('late-startup') };
          }
          if (slot.state === 'rejected') return fulfilled();
          return slot.cleanupResult;
        })
      );
      const reasons = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      return reasons.length === 0
        ? fulfilled()
        : { status: 'rejected', reason: new AggregateError(reasons) };
    }
  });
}

function acquireStartupPhase(label, operation, cleanupLate, lateTracker, clock) {
  return new Promise((resolvePhase, rejectPhase) => {
    let settled = false;
    let timedOut = false;
    let lateSlot;
    let handle;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (handle !== undefined) clock.clear(handle);
      callback(value);
    };
    handle = scheduleReferencedTimer(
      clock,
      () => {
        timedOut = true;
        lateSlot = lateTracker.reserve(label);
        finish(rejectPhase, startupTimeout());
      },
      STARTUP_PHASE_TIMEOUT_MS
    );
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (timedOut) lateTracker.fulfilled(lateSlot, value, cleanupLate);
          else finish(resolvePhase, value);
        },
        (error) => {
          if (timedOut) lateTracker.rejected(lateSlot);
          else finish(rejectPhase, error);
        }
      );
  });
}

function failuresForSlot(slot, value) {
  if (value instanceof AggregateError) {
    return value.errors.flatMap((entry) => failuresForSlot(slot, entry));
  }
  const timedOut = value instanceof Error && value.name === 'ConformanceCleanupTimeoutError';
  const startupTimedOut =
    slot === 'primary' && value instanceof Error && value.name === 'ConformanceStartupTimeoutError';
  const productDrift =
    slot === 'primary' &&
    value instanceof Error &&
    value.name === 'ConformanceProductContractError';
  const error = new Error(
    startupTimedOut
      ? 'Conformance startup phase timed out'
      : productDrift
        ? 'Conformance product contract is unavailable'
        : timedOut
          ? `Conformance cleanup timed out: ${slot}`
          : `Conformance operation failed: ${slot}`
  );
  error.name = startupTimedOut
    ? 'ConformanceStartupTimeoutError'
    : productDrift
      ? 'ConformanceProductContractError'
      : timedOut
        ? 'ConformanceCleanupTimeoutError'
        : slot === 'primary'
          ? 'ConformanceRunError'
          : 'ConformanceCleanupError';
  return [error];
}

function failuresFromResult(slot, result) {
  if (result === undefined || result === NO_FAILURE || result.status === 'fulfilled') return [];
  return failuresForSlot(slot, result.status === 'rejected' ? result.reason : result);
}

function collectFailuresInOrder(primary, ownedResults, lateResult, stateResult, environmentResult) {
  const failures = [];
  if (primary !== NO_FAILURE) failures.push(...failuresForSlot('primary', primary));
  for (const [index, slot] of ['proxy', 'http', 'application'].entries()) {
    failures.push(...failuresFromResult(slot, ownedResults[index]));
  }
  failures.push(...failuresFromResult('late-startup', lateResult));
  failures.push(...failuresFromResult('temp-state', stateResult));
  failures.push(...failuresFromResult('environment', environmentResult));
  return failures;
}

export async function runConformance(version, overrides = {}) {
  if (!Object.hasOwn(SCENARIOS_BY_VERSION, version)) {
    throw new Error('Usage: node scripts/run-conformance.mjs 2025-11-25|2026-07-28');
  }
  const dependencies = {
    makeStateDirectory: () => mkdtemp(join(tmpdir(), 'opnsense-mcp-conformance-')),
    removeStateDirectory: (path) => rm(path, { recursive: true, force: true }),
    installEnvironment: installConformanceEnvironment,
    createApplicationRuntime: () => createDefaultApplicationRuntime(),
    assertProductContract: assertConformanceProductContract,
    startProductHttp: startHttp,
    startProxy: startLoopbackProxy,
    resolveExecutable: resolveConformanceExecutable,
    runChild: runConformanceChild,
    validateReport: validateScenarioReport,
    clock: SYSTEM_TIMER,
    ...overrides
  };
  let stateDirectory;
  let environmentOwner;
  let applicationRuntime;
  let httpRuntime;
  let proxyRuntime;
  const lateTracker = createLateStartupTracker(dependencies.clock);
  let primaryFailure = NO_FAILURE;
  try {
    stateDirectory = await acquireStartupPhase(
      'makeStateDirectory',
      dependencies.makeStateDirectory,
      (latePath) => dependencies.removeStateDirectory(latePath),
      lateTracker,
      dependencies.clock
    );
    environmentOwner = await acquireStartupPhase(
      'installEnvironment',
      () => dependencies.installEnvironment(stateDirectory),
      (lateOwner) => lateOwner.restore(),
      lateTracker,
      dependencies.clock
    );
    applicationRuntime = await acquireStartupPhase(
      'createApplicationRuntime',
      dependencies.createApplicationRuntime,
      (lateOwner) => lateOwner.close(),
      lateTracker,
      dependencies.clock
    );
    await acquireStartupPhase(
      'productPreflight',
      () => dependencies.assertProductContract(applicationRuntime.application),
      undefined,
      lateTracker,
      dependencies.clock
    );
    httpRuntime = await acquireStartupPhase(
      'startProductHttp',
      () => dependencies.startProductHttp(applicationRuntime.application, { port: 0 }),
      (lateOwner) => lateOwner.close(),
      lateTracker,
      dependencies.clock
    );
    proxyRuntime = await acquireStartupPhase(
      'startProxy',
      () =>
        dependencies.startProxy(httpRuntime.url, CONFORMANCE_SENTINELS.token, httpRuntime.limits),
      (lateOwner) => lateOwner.close(),
      lateTracker,
      dependencies.clock
    );
    const executable = await acquireStartupPhase(
      'resolveExecutable',
      dependencies.resolveExecutable,
      undefined,
      lateTracker,
      dependencies.clock
    );
    for (const scenario of SCENARIOS_BY_VERSION[version]) {
      await dependencies.runChild({
        executable,
        proxyUrl: proxyRuntime.url,
        version,
        scenario,
        stateDirectory
      });
      await settleWithin(
        'scenario-report',
        () => dependencies.validateReport(stateDirectory, version, scenario),
        REPORT_VALIDATION_TIMEOUT_MS,
        dependencies.clock,
        () => conformanceReportError()
      );
    }
  } catch (error) {
    primaryFailure = error;
  }

  let ownedResults = [fulfilled(), fulfilled(), fulfilled()];
  let lateResult = fulfilled();
  let stateResult = fulfilled();
  let environmentResult = fulfilled();
  try {
    ownedResults = await Promise.allSettled([
      settleWithin(
        'proxy',
        () => proxyRuntime?.close(),
        OWNER_CLEANUP_TIMEOUT_MS,
        dependencies.clock
      ),
      settleWithin(
        'http',
        () => httpRuntime?.close(),
        OWNER_CLEANUP_TIMEOUT_MS,
        dependencies.clock
      ),
      settleWithin(
        'application',
        () => applicationRuntime?.close(),
        OWNER_CLEANUP_TIMEOUT_MS,
        dependencies.clock
      )
    ]);
    const [lateDrainResult] = await Promise.allSettled([lateTracker.drain()]);
    lateResult = lateDrainResult.status === 'fulfilled' ? lateDrainResult.value : lateDrainResult;
    if (stateDirectory !== undefined) {
      [stateResult] = await Promise.allSettled([
        settleWithin(
          'temp-state',
          () => dependencies.removeStateDirectory(stateDirectory),
          STATE_CLEANUP_TIMEOUT_MS,
          dependencies.clock
        )
      ]);
    }
  } finally {
    if (environmentOwner !== undefined) {
      [environmentResult] = await Promise.allSettled([
        settleWithin(
          'environment',
          () => environmentOwner.restore(),
          ENVIRONMENT_RESTORE_TIMEOUT_MS,
          dependencies.clock
        )
      ]);
    }
  }

  const failures = collectFailuresInOrder(
    primaryFailure,
    ownedResults,
    lateResult,
    stateResult,
    environmentResult
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Conformance host or cleanup failed');
  }
}

export async function runConformanceCli(version, overrides = {}) {
  const dependencies = {
    run: runConformance,
    writeDiagnostic: (value) => process.stderr.write(value),
    markFailed: () => {
      process.exitCode = 1;
    },
    setTimer: setTimeout,
    exit: (code) => process.exit(code),
    ...overrides
  };
  try {
    await dependencies.run(version);
  } catch {
    try {
      dependencies.writeDiagnostic('Conformance run failed\n');
    } catch {
      // Exit behavior must not depend on a writable diagnostic stream.
    }
    dependencies.markFailed();
    const handle = dependencies.setTimer(() => dependencies.exit(1), DIRECT_EXIT_GRACE_MS);
    handle.unref();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  void runConformanceCli(process.argv[2]);
}
