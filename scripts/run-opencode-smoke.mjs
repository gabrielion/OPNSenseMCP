#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'selfsigned';

const MODEL = 'opencode/north-mini-code-free';
const EVIDENCE_PATH = 'tests/fixtures/opencode.product1a.json';
export const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const GROUP_EXIT_DEADLINE_MS = 5_000;
const CHILD_CLOSE_DEADLINE_MS = 5_000;
const PROCESS_LIST_OUTPUT_LIMIT = 4 * 1024 * 1024;
const EXPECTED_TOOLS = ['opn_describe', 'opn_get', 'opn_list'];
const OPENCODE_TOOL_NAMES = new Map(EXPECTED_TOOLS.map((name) => [`opnsense_${name}`, name]));
const API_KEY = 'product1a-opencode-key';
const API_SECRET = 'PRODUCT_1A_OPENCODE_SECRET_SENTINEL';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableBytes(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function closedToolName(value) {
  if (typeof value !== 'string') return undefined;
  return OPENCODE_TOOL_NAMES.get(value);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorBearingResult(value) {
  if (typeof value === 'string') {
    try {
      return isErrorBearingResult(JSON.parse(value));
    } catch {
      return false;
    }
  }
  return isRecord(value) && (value.isError === true || Object.hasOwn(value, 'error'));
}

export function collectToolEvidence(events) {
  const selected = new Map();
  for (const event of events) {
    if (!isRecord(event) || event.type !== 'tool_use' || !isRecord(event.part)) continue;
    const tool = closedToolName(event.part.tool);
    const state = event.part.state;
    if (tool === undefined || !isRecord(state) || state.status !== 'completed') continue;
    if (Object.hasOwn(state, 'error') || Object.hasOwn(event.part, 'error')) continue;
    const input = state.input;
    const result = state.output;
    if (input === undefined || result === undefined || isErrorBearingResult(result)) continue;
    selected.set(tool, {
      name: tool,
      inputSha256: sha256(stableBytes(input)),
      resultSha256: sha256(stableBytes(result))
    });
  }
  return EXPECTED_TOOLS.flatMap((name) => {
    const evidence = selected.get(name);
    return evidence === undefined ? [] : [evidence];
  });
}

export function buildOpenCodeEvidence(input) {
  const passed = input.status === 'passed';
  return {
    schemaVersion: 1,
    status: input.status,
    claim: passed
      ? `This evidence covers only OpenCode ${input.clientVersion} with ${input.model} selecting the three Product 1A reads from the installed package against a synthetic HTTPS OPNsense target.`
      : 'No OpenCode routing claim is made by this blocked smoke.',
    client: { name: 'OpenCode', version: input.clientVersion },
    model: input.model,
    package: {
      name: input.packageName,
      version: input.packageVersion,
      sha256: input.packageSha256
    },
    tools: input.tools,
    checks: {
      mcpConnected: input.mcpConnected,
      expectedReadsObserved: input.expectedReadsObserved,
      secretAbsent: input.secretAbsent,
      cleanupConfirmed: input.cleanupConfirmed
    },
    blockedReason: passed ? null : input.blockedReason,
    limitations: [
      'Synthetic HTTPS target only; no real OPNsense VM was used.',
      'This is not evidence for public DNS, ACME, HAProxy, mutations, backups, Windows, or the agentic benchmark.'
    ]
  };
}

function minimalEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
    ...extra
  };
}

function terminateGroup(pid) {
  if (process.platform === 'win32' || pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (typeof error !== 'object' || error === null || error.code !== 'ESRCH') throw error;
  }
}

const BOUNDED_COMMAND_FAILURES = new Set(['spawn', 'timeout', 'output-limit']);

export class BoundedCommandFailure extends Error {
  constructor(kind, groupCleanupConfirmed = false) {
    if (!BOUNDED_COMMAND_FAILURES.has(kind)) throw new Error('Invalid bounded command failure');
    super('Bounded command failed');
    this.name = 'BoundedCommandFailure';
    this.kind = kind;
    this.groupCleanupConfirmed = groupCleanupConfirmed === true;
  }
}

export async function runModelCommand(execute) {
  try {
    const result = await execute();
    return result.code === 0 && result.signal === null
      ? { status: 'completed', result }
      : { status: 'blocked' };
  } catch (error) {
    if (error instanceof BoundedCommandFailure) {
      return {
        status: 'blocked',
        failure: error.kind,
        groupCleanupConfirmed: error.groupCleanupConfirmed === true
      };
    }
    throw error;
  }
}

function processGroupHasMembers(group) {
  return new Promise((resolveInspection, rejectInspection) => {
    const inspector = spawn('/bin/ps', ['-axo', 'pgid='], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '';
    let exceeded = false;
    inspector.stdout.on('data', (chunk) => {
      if (output.length + chunk.length > PROCESS_LIST_OUTPUT_LIMIT) {
        exceeded = true;
        inspector.kill('SIGKILL');
        return;
      }
      output = `${output}${chunk.toString('utf8')}`;
    });
    inspector.once('error', () => rejectInspection(new Error('Process group status failed')));
    inspector.once('close', (code, signal) => {
      if (exceeded || code !== 0 || signal !== null) {
        rejectInspection(new Error('Process group status failed'));
        return;
      }
      resolveInspection(
        output.split(/\r?\n/u).some((line) => line.trim() === String(Math.abs(group)))
      );
    });
  });
}

/**
 * A bounded failure may only be reported after the owned process group is proven empty. A child
 * that was never spawned owns no group, so its cleanup is vacuously confirmed.
 */
async function confirmGroupExit(pid, deadlineMs = GROUP_EXIT_DEADLINE_MS) {
  if (process.platform === 'win32') return false;
  if (pid === undefined) return true;
  const started = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - started) / 1e6 < deadlineMs) {
    try {
      if (!(await processGroupHasMembers(-pid))) return true;
    } catch {
      return false;
    }
    await new Promise((wait) => {
      const timer = setTimeout(wait, 25);
      timer.unref();
    });
  }
  return false;
}

function awaitChildClose(child) {
  return Promise.race([
    once(child, 'close').then(() => true),
    new Promise((resolveClose) => {
      const timer = setTimeout(() => resolveClose(false), CHILD_CLOSE_DEADLINE_MS);
      timer.unref();
    })
  ]);
}

function runBounded(command, arguments_, options) {
  return new Promise((resolveCommand, rejectCommand) => {
    const outputLimitBytes = options.outputLimitBytes ?? OUTPUT_LIMIT_BYTES;
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.environment,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      terminateGroup(child.pid);
      callback();
    };
    // A bounded failure is only reported after the child closed and its process group is proven
    // empty, so terminated evidence can never be finalized over a surviving descendant.
    const failBounded = (kind) => {
      finish(() => {
        const owned = child.pid;
        void awaitChildClose(child)
          .then((closed) => (closed ? confirmGroupExit(owned) : false))
          .then(
            (confirmed) => rejectCommand(new BoundedCommandFailure(kind, confirmed)),
            () => rejectCommand(new BoundedCommandFailure(kind, false))
          );
      });
    };
    const capture = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > outputLimitBytes) {
        failBounded('output-limit');
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk) => capture(stdout, chunk));
    child.stderr.on('data', (chunk) => capture(stderr, chunk));
    child.once('error', () => failBounded('spawn'));
    child.once('close', (code, signal) =>
      finish(() =>
        resolveCommand({
          code,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8')
        })
      )
    );
    const deadline = setTimeout(() => {
      failBounded('timeout');
    }, options.timeoutMs);
    deadline.unref();
    child.stdin.end(options.input ?? '');
  });
}

async function startMock() {
  const certificate = await generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    keyType: 'ec',
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyCertSign: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  });
  const requests = [];
  const server = createServer({ key: certificate.private, cert: certificate.cert });
  server.on('request', (request, response) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        body: Buffer.concat(chunks).toString('utf8')
      });
      const body =
        request.url === '/api/core/system/status'
          ? { metadata: { system: { status: 'ok' } }, subsystems: {} }
          : {
              total: 1,
              rowCount: 10,
              current: 1,
              rows: [
                {
                  id: 'svc-1',
                  name: 'dnsmasq',
                  description: 'DNS forwarder',
                  running: 1,
                  locked: 0
                }
              ]
            };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    })().catch(() => response.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Mock startup failed');
  return {
    url: `https://127.0.0.1:${String(address.port)}`,
    ca: certificate.cert,
    requests,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
        server.closeAllConnections();
      })
  };
}

function parseJsonLines(output) {
  return output
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function isConnected(output) {
  return /opnsense[\s\S]*(?:connected|online)|(?:connected|online)[\s\S]*opnsense/iu.test(output);
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) return resolve(EVIDENCE_PATH);
  if (arguments_.length === 2 && arguments_[0] === '--evidence-out') {
    return resolve(arguments_[1]);
  }
  throw new Error('Usage: run-opencode-smoke.mjs [--evidence-out <path>]');
}

async function pathIsAbsent(path) {
  try {
    await access(path);
    return false;
  } catch (error) {
    return typeof error === 'object' && error !== null && error.code === 'ENOENT';
  }
}

async function run() {
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Node.js 22 is required');
  const evidencePath = parseArguments(process.argv.slice(2));
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'opnsense-opencode-smoke-'));
  const packageRoot = join(temporaryRoot, 'package');
  const projectRoot = join(temporaryRoot, 'project');
  const xdgConfig = join(temporaryRoot, 'xdg-config');
  const xdgData = join(temporaryRoot, 'xdg-data');
  const xdgCache = join(temporaryRoot, 'xdg-cache');
  const mock = await startMock();
  let packageMetadata;
  let packageDigest;
  let clientVersion = 'unavailable';
  let tools = [];
  let mcpConnected = false;
  let expectedReadsObserved = false;
  let secretAbsent = true;
  let blockedReason = 'client-unavailable';
  let localFailure;
  try {
    await Promise.all(
      [packageRoot, projectRoot, xdgConfig, xdgData, xdgCache].map((path) =>
        mkdir(path, { recursive: true })
      )
    );
    packageMetadata = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'));
    const packed = await runBounded('npm', ['pack', '--json', '--pack-destination', packageRoot], {
      cwd: repository,
      environment: minimalEnvironment(),
      timeoutMs: 60_000
    });
    if (packed.code !== 0 || packed.signal !== null) throw new Error('npm pack failed');
    const archives = (await readdir(packageRoot)).filter((entry) => entry.endsWith('.tgz'));
    if (archives.length !== 1) throw new Error('npm pack output was not unique');
    const archive = join(packageRoot, archives[0]);
    packageDigest = sha256(await readFile(archive));
    await writeFile(join(projectRoot, 'package.json'), '{"private":true}\n', { mode: 0o600 });
    const installed = await runBounded(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--offline',
        '--no-audit',
        '--no-fund',
        '--no-package-lock',
        '--no-save',
        archive
      ],
      {
        cwd: projectRoot,
        environment: minimalEnvironment(),
        timeoutMs: 60_000
      }
    );
    if (installed.code !== 0 || installed.signal !== null) throw new Error('npm install failed');
    const caFile = join(temporaryRoot, 'ca.pem');
    const connectionFile = join(temporaryRoot, 'opnsense.json');
    await writeFile(caFile, mock.ca, { mode: 0o600 });
    await writeFile(
      connectionFile,
      `${JSON.stringify({ url: mock.url, apiKey: API_KEY, apiSecret: API_SECRET, caFile })}\n`,
      { mode: 0o600 }
    );
    const installedCommand = join(projectRoot, 'node_modules', '.bin', 'opnsense-mcp');
    await writeFile(
      join(projectRoot, 'opencode.json'),
      `${JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            opnsense: {
              type: 'local',
              command: [installedCommand],
              environment: { READ_ONLY: 'true', OPNSENSE_CONFIG_FILE: connectionFile }
            }
          }
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
    const openCode = process.env.OPENCODE_BIN ?? join(homedir(), '.opencode', 'bin', 'opencode');
    if (!isAbsolute(openCode)) throw new Error('OPENCODE_BIN must be absolute');
    const openCodeEnvironment = minimalEnvironment({
      XDG_CONFIG_HOME: xdgConfig,
      XDG_DATA_HOME: xdgData,
      XDG_CACHE_HOME: xdgCache,
      NO_COLOR: '1'
    });
    let version;
    try {
      version = await runBounded(openCode, ['--version'], {
        cwd: projectRoot,
        environment: openCodeEnvironment,
        timeoutMs: 10_000
      });
    } catch {
      version = undefined;
    }
    if (version !== undefined && version.code === 0 && version.signal === null) {
      clientVersion = version.stdout.trim().split(/\s+/u)[0] ?? 'unavailable';
      const listed = await runBounded(openCode, ['mcp', 'list', '--pure'], {
        cwd: projectRoot,
        environment: openCodeEnvironment,
        timeoutMs: 30_000
      });
      const listedOutput = `${listed.stdout}\n${listed.stderr}`;
      secretAbsent =
        !listedOutput.includes(API_KEY) && !listedOutput.includes(API_SECRET) && secretAbsent;
      mcpConnected = listed.code === 0 && listed.signal === null && isConnected(listedOutput);
      if (!mcpConnected) {
        blockedReason = 'mcp-connection-unavailable';
      } else {
        const prompt =
          'Use only the opnsense MCP server. Call opn_describe for system.status, then opn_get for system.status, then opn_list for core.services with page 1, pageSize 10, and an empty query. Do not use shell, files, or web tools. Return one short read-only summary after all three calls succeed.';
        const routedOutcome = await runModelCommand(() =>
          runBounded(
            openCode,
            ['run', '--pure', '--auto', '--model', MODEL, '--format', 'json', prompt],
            {
              cwd: projectRoot,
              environment: openCodeEnvironment,
              timeoutMs: 180_000
            }
          )
        );
        if (routedOutcome.status === 'blocked') {
          blockedReason = 'model-service-unavailable';
        } else {
          const routed = routedOutcome.result;
          const routedOutput = `${routed.stdout}\n${routed.stderr}`;
          secretAbsent =
            !routedOutput.includes(API_KEY) && !routedOutput.includes(API_SECRET) && secretAbsent;
          tools = collectToolEvidence(parseJsonLines(routed.stdout));
          const observed = mock.requests.map(({ method, path }) => `${method} ${path}`);
          expectedReadsObserved =
            tools.length === EXPECTED_TOOLS.length &&
            observed.includes('GET /api/core/system/status') &&
            observed.includes('POST /api/core/service/search');
          blockedReason = expectedReadsObserved
            ? 'none'
            : tools.length === EXPECTED_TOOLS.length
              ? 'mock-reads-unverified'
              : 'tool-routing-unverified';
        }
      }
    }
    if (!secretAbsent) blockedReason = 'secret-redaction-failed';
  } catch (error) {
    localFailure = error;
  } finally {
    await Promise.allSettled([mock.close()]);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  const cleanupConfirmed = await pathIsAbsent(temporaryRoot);
  if (localFailure !== undefined) throw localFailure;
  if (packageMetadata === undefined || packageDigest === undefined) {
    throw new Error('Package evidence unavailable');
  }
  if (!cleanupConfirmed) blockedReason = 'cleanup-unconfirmed';
  const status =
    blockedReason === 'none' && secretAbsent && cleanupConfirmed && expectedReadsObserved
      ? 'passed'
      : 'blocked';
  const evidence = buildOpenCodeEvidence({
    status,
    ...(status === 'blocked' ? { blockedReason } : {}),
    clientVersion,
    model: MODEL,
    packageName: packageMetadata.name,
    packageVersion: packageMetadata.version,
    packageSha256: packageDigest,
    tools,
    mcpConnected,
    expectedReadsObserved,
    secretAbsent,
    cleanupConfirmed
  });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    serialized.includes(API_KEY) ||
    serialized.includes(API_SECRET) ||
    serialized.includes(temporaryRoot)
  ) {
    throw new Error('Evidence redaction failed');
  }
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, serialized, { mode: 0o600 });
  process.stdout.write(`OpenCode Product 1A smoke: ${status}\n`);
  if (status === 'blocked') process.exitCode = 3;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void run().catch(() => {
    process.stderr.write('OpenCode Product 1A smoke failed locally.\n');
    process.exitCode = 1;
  });
}
