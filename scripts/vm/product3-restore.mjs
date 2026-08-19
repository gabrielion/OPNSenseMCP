#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createConnection } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHardenedStdioLifecycle } from '../testing/hardened-stdio-lifecycle.mjs';
import { serializeVmRestoreAttestation } from './attestation.mjs';
import {
  FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES,
  Product1bBootstrapError,
  bootstrapProduct1b,
  isSafeProduct1bBootstrapStage
} from './product1b-bootstrap.mjs';
import { createConnectionArtifacts } from './product1b-connection.mjs';
import {
  VM_PORTS,
  probeLoopbackPort,
  spawnQemu,
  startDisposableVm,
  statusDisposableVm,
  stopDisposableVm
} from './product1b-lifecycle.mjs';
import {
  createPrivateTemporaryRoot,
  installCurrentPackage,
  removePrivateTemporaryRoot,
  verifyProduct1bResidue
} from './product1b-live.mjs';
import { IMAGE_SPEC, doctorHost, prepareImage } from './product1b.mjs';
import { inspectGitWorktree } from './product3-alias.mjs';

// This scenario reuses the alias-write ACL surface: the round trip's mutation is an alias create,
// so it needs exactly the scopes and the feature flag product3-alias.mjs already needed.
const EXPECTED_TOOLS = Object.freeze([
  'server_status',
  'opn_describe',
  'opn_get',
  'opn_list',
  'opn_create',
  'opn_delete'
]);
const ALIAS_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// A distinct name/content from product3-alias.mjs's own fixture: the two scenarios never run
// against the same firewall at once, but giving the restore round trip its own identity keeps a
// console transcript or a firewall audit log unambiguous about which scenario produced it.
const ALIAS_ATTRIBUTES = Object.freeze({
  name: 'product3_vm_restore_alias',
  type: 'host',
  content: Object.freeze(['192.0.2.20']),
  description: 'Disposable Product 3 restore-round-trip alias'
});
const LIST_ARGUMENTS = Object.freeze({
  resource: 'firewall.alias',
  page: 1,
  pageSize: 10,
  query: ''
});
const MCP_PROTOCOL_VERSION = '2026-07-28';
const MCP_CLIENT_VERSION = '0.1.0';
const MCP_OPERATION_TIMEOUT_MS = 30_000;
const MCP_CLOSE_TIMEOUT_MS = 10_000;
const MCP_STDERR_LIMIT_BYTES = 1024 * 1024;
const ATTESTATION_USAGE = 'Usage: product3-restore.mjs --attestation-out <absolute-path>';
const SCENARIO_FLAGS = Object.freeze(['experimental-alias-write']);
const SCENARIO_SCOPES = Object.freeze([
  'server.status',
  'system.status',
  'core.services',
  'firewall.alias'
]);
const MAX_BACKUP_XML_BYTES = 2 * 1024 * 1024;

export class Product3RestoreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'Product3RestoreError';
    this.code = code;
  }
}

export function parseProduct3RestoreArguments(arguments_) {
  if (
    !Array.isArray(arguments_) ||
    arguments_.length !== 2 ||
    arguments_[0] !== '--attestation-out' ||
    typeof arguments_[1] !== 'string' ||
    !isAbsolute(arguments_[1])
  ) {
    throw new Product3RestoreError('USAGE', ATTESTATION_USAGE);
  }
  return Object.freeze({ attestationPath: arguments_[1] });
}

// ---------------------------------------------------------------------------------------------
// Atomic attestation writer, restore-shaped. product3-alias.mjs's own `writeVmAttestationAtomic`
// hard-codes the alias serializer (`serializeVmAttestation`) with no injection point, so it would
// reject this scenario's 14-check restore attestation outright. Rather than editing that file
// (out of scope here, and it is relied on unmodified by product3-alias.mjs's own sealed tests),
// this duplicates its small atomic-write mechanics — same temp-file-then-rename discipline, same
// directory fsync discipline — swapping in `serializeVmRestoreAttestation`.
// ---------------------------------------------------------------------------------------------
function compatibleDirectorySyncError(error) {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(String(error.code))
  );
}

async function syncParentDirectory(parentPath, openFile) {
  let handle;
  try {
    handle = await openFile(parentPath, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    if (!compatibleDirectorySyncError(error)) throw error;
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

function directorySyncPaths(parentPath, firstCreatedPath) {
  if (firstCreatedPath === undefined) return [parentPath];
  if (typeof firstCreatedPath !== 'string' || !isAbsolute(firstCreatedPath)) {
    throw new Product3RestoreError('VM_ATTESTATION_WRITE_FAILED');
  }
  const createdRelative = relative(firstCreatedPath, parentPath);
  if (
    createdRelative === '..' ||
    createdRelative.startsWith(`..${sep}`) ||
    isAbsolute(createdRelative)
  ) {
    throw new Product3RestoreError('VM_ATTESTATION_WRITE_FAILED');
  }
  const boundary = dirname(firstCreatedPath);
  const paths = [];
  let current = parentPath;
  for (;;) {
    paths.push(current);
    if (current === boundary) return paths;
    const next = dirname(current);
    if (next === current) throw new Product3RestoreError('VM_ATTESTATION_WRITE_FAILED');
    current = next;
  }
}

export async function writeVmRestoreAttestationAtomic(outputPath, attestation, options = {}) {
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath)) {
    throw new Product3RestoreError('VM_ATTESTATION_WRITE_FAILED');
  }
  const serialized = serializeVmRestoreAttestation(attestation);
  const openFile = options.openFile ?? open;
  const makeDirectory = options.makeDirectory ?? mkdir;
  const renameFile = options.renameFile ?? rename;
  const syncDirectory = options.syncDirectory ?? ((path) => syncParentDirectory(path, openFile));
  const unlinkFile = options.unlinkFile ?? unlink;
  const nonce = (options.randomBytes ?? randomBytes)(16).toString('hex');
  const parentPath = dirname(outputPath);
  const temporaryPath = join(parentPath, `.${basename(outputPath)}.pending-${nonce}`);
  let handle;
  let temporaryExists = false;
  try {
    const firstCreatedPath = await makeDirectory(parentPath, { recursive: true });
    const syncPaths = directorySyncPaths(parentPath, firstCreatedPath);
    handle = await openFile(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    temporaryExists = true;
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temporaryPath, outputPath);
    temporaryExists = false;
    for (const syncPath of syncPaths) await syncDirectory(syncPath);
  } catch {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    if (temporaryExists) await unlinkFile(temporaryPath).catch(() => undefined);
    throw new Product3RestoreError('VM_ATTESTATION_WRITE_FAILED');
  }
}

// Single source of truth for where this scenario's QMP monitor socket lives: a sibling of the
// serial console socket product1b-lifecycle.mjs already places at `<instanceRoot>/console.sock`.
// Both the launch-time QMP wiring (`spawnQemuWithQmp`, below) and the live console driver
// (`restoreOverConsole`'s default) call this, so the path is derived in exactly one place rather
// than independently recomputed at each call site.
function deriveQmpSocketPath(consolePath) {
  return join(dirname(consolePath), 'qmp.sock');
}

// ---------------------------------------------------------------------------------------------
// Scenario-scoped QEMU argument variant.
//
// `buildQemuArguments` (product1b-lifecycle.mjs) is pinned for product1b/product3-alias: no
// monitor, `-no-reboot`. This scenario needs a way back into the loader after the guest has
// already booted multi-user, and the only credential-free privileged entry on the pinned image is
// that loader's single-user shell. The recommended, adjudicated mechanism is a QMP monitor socket
// so the runner can issue `system_reset` itself. Rather than editing the shared builder, this
// transforms ITS RETURNED argument list: a QMP unix-socket monitor is added BESIDE the pinned
// `-monitor none`, and the trailing `-no-reboot` is dropped (a monitor-issued reset should not be
// mistaken for the crash-reboot loop that flag exists to break). `-monitor none` itself is left
// untouched — it suppresses the default, unauthenticated HMP monitor, a suppression the pinned
// launch contract chose deliberately, and `-qmp` is an independent monitor channel that does not
// turn that default monitor back on. `startDisposableVm`'s own `spawnVm` seam is where this gets
// applied (see `spawnQemuWithQmp` below) — `buildQemuArguments` itself is never called
// differently, only its output is post-processed.
// ---------------------------------------------------------------------------------------------
export function deriveQmpQemuArguments(baseArguments, qmpPath) {
  if (!Array.isArray(baseArguments) || typeof qmpPath !== 'string' || !isAbsolute(qmpPath)) {
    throw new Product3RestoreError('QEMU_ARGUMENTS_INVALID');
  }
  const monitorIndex = baseArguments.indexOf('-monitor');
  if (monitorIndex === -1 || baseArguments[monitorIndex + 1] !== 'none') {
    throw new Product3RestoreError('QEMU_ARGUMENTS_UNEXPECTED');
  }
  const rebootIndex = baseArguments.indexOf('-no-reboot');
  const withoutReboot =
    rebootIndex === -1
      ? [...baseArguments]
      : [...baseArguments.slice(0, rebootIndex), ...baseArguments.slice(rebootIndex + 1)];
  return Object.freeze([...withoutReboot, '-qmp', `unix:${qmpPath},server=on,wait=off`]);
}

// `spawn` is injectable (defaulting to the real, exported `spawnQemu`) purely for testability: it
// lets a test capture the exact closure `startVm` receives as `spawnVm` and invoke it without
// risking a real `child_process.spawn` of a QEMU binary.
function spawnQemuWithQmp(qmpPath, spawn = spawnQemu) {
  return (command, arguments_) => spawn(command, deriveQmpQemuArguments(arguments_, qmpPath));
}

async function removeQmpSocketIfPresent(qmpPath) {
  try {
    await unlink(qmpPath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Minimal QMP client: just enough of the protocol to authenticate the monitor session and issue
// one `system_reset`. Nothing here is a general-purpose QMP library — it is scoped exactly to the
// one command this scenario needs.
// ---------------------------------------------------------------------------------------------
const QMP_COMMAND_TIMEOUT_MS = 10_000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function resetGuestOverQmp(qmpPath, { timeoutMs = QMP_COMMAND_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    let stage = 'qmp-connect';
    let settled = false;
    let buffered = '';
    const socket = createConnection({ path: qmpPath });
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (outcome === 'ok') resolvePromise();
      else reject(new Product3RestoreConsoleError(stage));
    };
    const timer = setTimeout(() => finish('fail'), timeoutMs);
    timer.unref?.();
    socket.once('connect', () => {
      stage = 'qmp-greeting';
    });
    socket.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish('fail');
          return;
        }
        if (!isRecord(message)) {
          finish('fail');
          return;
        }
        if (stage === 'qmp-greeting' && 'QMP' in message) {
          stage = 'qmp-capabilities';
          socket.write(`${JSON.stringify({ execute: 'qmp_capabilities' })}\n`);
          continue;
        }
        if (stage === 'qmp-capabilities' && 'return' in message) {
          stage = 'qmp-reset';
          socket.write(`${JSON.stringify({ execute: 'system_reset' })}\n`);
          continue;
        }
        if (stage === 'qmp-reset' && 'return' in message) {
          finish('ok');
          return;
        }
      }
    });
    socket.once('error', () => finish('fail'));
    socket.once('close', () => finish('fail'));
  });
}

// ---------------------------------------------------------------------------------------------
// Console-driven config.xml overwrite. Live only: after `resetGuestOverQmp` re-enters the loader,
// this drives the same proven loader -> single-user -> shell -> heredoc-upload shape
// product1b-bootstrap.mjs uses, but targets `/conf/config.xml` directly with the staged backup
// XML instead of the read-only-account helper. It is deliberately NOT built by editing or
// importing bootstrap.mjs's private state machine (scenario-scoped, per the brief): the prompts
// below are redefined locally because the guest's login/shell text is a property of the pinned
// image, not of that module.
// ---------------------------------------------------------------------------------------------
const RESTORE_TIMEOUT_MS = 30_000;
const RESTORE_OVERALL_TIMEOUT_MS = 600_000;
const RESTORE_MAX_TRANSCRIPT_BYTES = 512 * 1024;
const RESTORE_PROBE_ATTEMPTS = 180;
const RESTORE_PROBE_DELAY_MS = 1000;
const SHELL_PROMPT = /root@[^\r\n]*#[ ]?/u;
const SHELL_CONTINUATION_PROMPT = /^> /mu;
const LOADER_MENU = /Autoboot in|Welcome to|Boot[^\r\n]{0,16}ingle\s+user/iu;
const SINGLE_USER_SHELL_PROMPT = /Enter full pathname of shell[^\r\n]*:[ ]?/u;
const HEREDOC_EOF = '__OPNSENSE_MCP_RESTORE_EOF__';
const STAGED_ENCODED = '/usr/local/etc/mcpr.b64';
const CONFIG_PATH = '/conf/config.xml';
export const FRAME_BEGIN = '__OPNSENSE_MCP_RESTORE_V1_D24B9F17_BEGIN__';
export const FRAME_END = '__OPNSENSE_MCP_RESTORE_V1_D24B9F17_END__';
const REMOUNT_COMMAND = '/sbin/mount -u -o rw /\n';
const UMASK_COMMAND = 'umask 077\n';
const HEREDOC_OPEN_COMMAND = `/bin/cat > ${STAGED_ENCODED} <<${HEREDOC_EOF}\n`;
// A real serial tty echoes a typed line back before the guest ever executes it (proven and
// exercised in tests/vm/product1b-bootstrap.test.mjs's own fixture guest), so a frame marker
// typed in cleartext would satisfy this driver's own search on the ECHO, before the command's
// real output ever arrives — product1b-bootstrap.mjs never puts its own frame markers on the wire
// except base64-encoded, which is exactly the invariant a literal marker here would have broken.
// Splitting each marker across two adjacent double-quoted shell words defeats that: the shell
// concatenates adjacent quoted words into one argument when the command actually RUNS, but the
// bytes as TYPED (and therefore echoed) never spell the contiguous marker.
function shellSplitLiteral(marker) {
  const midpoint = Math.ceil(marker.length / 2);
  return `"${marker.slice(0, midpoint)}""${marker.slice(midpoint)}"`;
}
const FRAME_BEGIN_LITERAL = shellSplitLiteral(FRAME_BEGIN);
const FRAME_END_LITERAL = shellSplitLiteral(FRAME_END);
// One command applies the staged upload, verifies it landed (a framed sha256 of the file this
// scenario just wrote, computed with the same guest tool — /usr/bin/openssl — the proven
// bootstrap dialogue already uses live, rather than an unproven /sbin/sha256, so a truncated or
// corrupted transfer fails closed before boot continues), and removes the staging file. `${d#*= }`
// is POSIX parameter expansion (no external `cut`/`awk`, neither proven present in this shell):
// `openssl dgst -sha256 <path>` prints `SHA256(<path>)= <hex>`, and `#*= ` strips the shortest
// leading match up to and including that literal `= `, leaving just the hex digest in `$d`.
const APPLY_COMMAND =
  `/usr/bin/openssl base64 -d -in ${STAGED_ENCODED} -out ${CONFIG_PATH} ` +
  `&& d=$(/usr/bin/openssl dgst -sha256 ${CONFIG_PATH}) ` +
  '&& d=${d#*= } ' +
  `&& /bin/echo ${FRAME_BEGIN_LITERAL}"$d"${FRAME_END_LITERAL} ` +
  `&& /bin/rm -f ${STAGED_ENCODED}\n`;
const RESUME_COMMAND = 'exit\n';

export const RESTORE_CONSOLE_SAFE_STAGES = Object.freeze([
  'validation',
  'qmp-connect',
  'qmp-greeting',
  'qmp-capabilities',
  'qmp-reset',
  'connecting',
  'loader',
  'single-user',
  'shell',
  'remount',
  'umask',
  'heredoc-open',
  'heredoc-lines',
  'heredoc-close',
  'decode',
  'resume',
  'probe'
]);

export function isSafeProduct3RestoreConsoleStage(stage) {
  return typeof stage === 'string' && RESTORE_CONSOLE_SAFE_STAGES.includes(stage);
}

export class Product3RestoreConsoleError extends Error {
  constructor(stage = 'validation') {
    super('PRODUCT3_RESTORE_CONSOLE_FAILED');
    this.name = 'Product3RestoreConsoleError';
    this.code = 'PRODUCT3_RESTORE_CONSOLE_FAILED';
    this.stage = stage;
  }
}

function matchAfter(transcript, offset, expression) {
  const match = expression.exec(transcript.slice(offset));
  if (match === null || match.index === undefined) return undefined;
  return offset + match.index + match[0].length;
}

function heredocLines(xml) {
  const encoded = Buffer.from(xml, 'utf8').toString('base64');
  const lines = encoded.match(/.{1,76}/gu);
  if (lines === null) throw new Product3RestoreConsoleError('heredoc-open');
  return lines;
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function driveConfigOverwrite({
  consolePath,
  uploadLines,
  expectedDigest,
  timeoutMs,
  overallTimeoutMs,
  maxTranscriptBytes,
  resetGuest,
  qmpPath
}) {
  return new Promise((resolvePromise, reject) => {
    let stage = 'connecting';
    let settled = false;
    let transcript = '';
    let transcriptBytes = 0;
    let offset = 0;
    let uploadLine = 0;
    let resetIssued = false;

    const socket = createConnection({ path: consolePath });
    const cleanup = () => {
      clearTimeout(overallTimer);
      clearTimeout(progressTimer);
      socket.removeAllListeners();
      socket.destroy();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Product3RestoreConsoleError(stage));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise();
    };
    const send = (value) => {
      try {
        socket.write(value);
      } catch {
        fail();
      }
    };
    const drive = () => {
      try {
        let next;
        if (
          stage === 'loader' &&
          (next = matchAfter(transcript, offset, LOADER_MENU)) !== undefined
        ) {
          offset = next;
          stage = 'single-user';
          send('2');
        }
        if (
          stage === 'single-user' &&
          (next = matchAfter(transcript, offset, SINGLE_USER_SHELL_PROMPT)) !== undefined
        ) {
          offset = next;
          stage = 'shell';
          send('\n');
        }
        if (
          stage === 'shell' &&
          (next = matchAfter(transcript, offset, SHELL_PROMPT)) !== undefined
        ) {
          offset = next;
          stage = 'remount';
          send(REMOUNT_COMMAND);
        }
        if (
          stage === 'remount' &&
          (next = matchAfter(transcript, offset, SHELL_PROMPT)) !== undefined
        ) {
          offset = next;
          stage = 'umask';
          send(UMASK_COMMAND);
        }
        if (
          stage === 'umask' &&
          (next = matchAfter(transcript, offset, SHELL_PROMPT)) !== undefined
        ) {
          offset = next;
          stage = 'heredoc-open';
          send(HEREDOC_OPEN_COMMAND);
        }
        if (
          stage === 'heredoc-open' &&
          (next = matchAfter(transcript, offset, SHELL_CONTINUATION_PROMPT)) !== undefined
        ) {
          offset = next;
          stage = 'heredoc-lines';
          send(`${uploadLines[uploadLine]}\n`);
          uploadLine += 1;
        }
        if (
          stage === 'heredoc-lines' &&
          (next = matchAfter(transcript, offset, SHELL_CONTINUATION_PROMPT)) !== undefined
        ) {
          offset = next;
          if (uploadLine < uploadLines.length) {
            send(`${uploadLines[uploadLine]}\n`);
            uploadLine += 1;
          } else {
            stage = 'heredoc-close';
            send(`${HEREDOC_EOF}\n`);
          }
        }
        if (
          stage === 'heredoc-close' &&
          (next = matchAfter(transcript, offset, SHELL_PROMPT)) !== undefined
        ) {
          offset = next;
          stage = 'decode';
          send(APPLY_COMMAND);
        }
        if (stage === 'decode') {
          const begin = transcript.indexOf(FRAME_BEGIN, offset);
          if (begin !== -1) {
            const payloadStart = begin + FRAME_BEGIN.length;
            const end = transcript.indexOf(FRAME_END, payloadStart);
            if (end !== -1) {
              if (transcript.indexOf(FRAME_BEGIN, payloadStart) !== -1) {
                fail();
                return;
              }
              const digest = transcript.slice(payloadStart, end).trim();
              if (digest !== expectedDigest) {
                fail();
                return;
              }
              offset = end + FRAME_END.length;
              stage = 'resume';
              send(RESUME_COMMAND);
            }
          }
        }
        if (stage === 'resume') {
          stage = 'probe';
          succeed();
        }
      } catch {
        fail();
      }
    };

    const overallTimer = setTimeout(fail, overallTimeoutMs);
    overallTimer.unref?.();
    let progressTimer;
    const awaitProgress = () => {
      clearTimeout(progressTimer);
      progressTimer = setTimeout(fail, timeoutMs);
      progressTimer.unref?.();
    };
    awaitProgress();

    // The console must be connected and listening BEFORE the reset is issued: QEMU discards
    // console output while no client is attached, and the loader's autoboot countdown would
    // otherwise be free to select multi-user again before this driver ever sees the menu.
    socket.once('connect', () => {
      stage = 'qmp-reset';
      resetGuest(qmpPath)
        .then(() => {
          if (settled) return;
          resetIssued = true;
          stage = 'loader';
        })
        .catch(fail);
    });
    socket.on('data', (chunk) => {
      if (!resetIssued) return;
      awaitProgress();
      transcriptBytes += chunk.byteLength;
      if (transcriptBytes > maxTranscriptBytes) {
        fail();
        return;
      }
      transcript += chunk.toString('latin1');
      drive();
    });
    socket.once('error', fail);
    socket.once('close', () => {
      if (!settled) fail();
    });
  });
}

export async function restoreOverConsole({
  consolePath,
  backupXml,
  timeoutMs = RESTORE_TIMEOUT_MS,
  overallTimeoutMs = RESTORE_OVERALL_TIMEOUT_MS,
  maxTranscriptBytes = RESTORE_MAX_TRANSCRIPT_BYTES,
  probeAttempts = RESTORE_PROBE_ATTEMPTS,
  probeDelayMs = RESTORE_PROBE_DELAY_MS,
  probePort = probeLoopbackPort,
  delay = wait,
  resetGuest = resetGuestOverQmp
}) {
  if (
    typeof consolePath !== 'string' ||
    consolePath.length === 0 ||
    typeof backupXml !== 'string' ||
    backupXml.length === 0 ||
    backupXml.length > MAX_BACKUP_XML_BYTES
  ) {
    throw new Product3RestoreConsoleError('validation');
  }
  const qmpPath = deriveQmpSocketPath(consolePath);
  const uploadLines = heredocLines(backupXml);
  const expectedDigest = createHash('sha256').update(backupXml, 'utf8').digest('hex');

  await driveConfigOverwrite({
    consolePath,
    uploadLines,
    expectedDigest,
    timeoutMs,
    overallTimeoutMs,
    maxTranscriptBytes,
    resetGuest,
    qmpPath
  });

  // The live probe: config.xml landing on disk is not the same as OPNsense coming back up on it.
  // Waiting for the API port to reopen after the reset is the cheapest functional confirmation
  // that the guest re-imported the restored configuration and reached multi-user again; the
  // stronger, application-level confirmation (the alias itself reverted) is the caller's REST
  // reobserve step that follows this call.
  for (let attempt = 0; attempt < probeAttempts; attempt += 1) {
    if (await probePort('127.0.0.1', VM_PORTS.api)) return;
    if (attempt + 1 < probeAttempts) await delay(probeDelayMs);
  }
  throw new Product3RestoreConsoleError('probe');
}

// ---------------------------------------------------------------------------------------------
// REST session driving the round trip's mutation. Deliberately NOT product3-alias.mjs's
// `runInstalledAliasLifecycle`: that function's session always ends by deleting the alias over
// REST, which would leave nothing for the console restore to meaningfully revert, and its
// environment is fixed inside product3-alias.mjs with no way to add
// `OPNSENSE_MCP_STATE_DIR` — which this scenario needs so the backup it reads back is confined to
// a directory this runner owns and cleans up, never the operator's real state root. So this
// session drives its own sequence: list -> create -> list -> delete -> list (byte-for-byte the
// same shape as product3-alias's own scenario, and it reads the envelope's pre-write snapshot of
// the resulting backup) -> a second create -> list, which is the "existing alias create ->
// present" mutation the round trip's spec calls for and the one the console restore reverts.
// ---------------------------------------------------------------------------------------------
function successfulToolResult(value) {
  return isRecord(value) && value.isError !== true && isRecord(value.structuredContent);
}

function isAliasListPage(value, expectedTotal, expectedUuid) {
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

function validCreatedUuid(response) {
  if (!successfulToolResult(response)) return undefined;
  const item = response.structuredContent.item;
  const valid =
    isRecord(item) &&
    typeof item.uuid === 'string' &&
    ALIAS_UUID_PATTERN.test(item.uuid) &&
    item.name === ALIAS_ATTRIBUTES.name &&
    item.type === ALIAS_ATTRIBUTES.type &&
    Array.isArray(item.content) &&
    JSON.stringify(item.content) === JSON.stringify(ALIAS_ATTRIBUTES.content) &&
    item.description === ALIAS_ATTRIBUTES.description;
  return valid ? item.uuid : undefined;
}

// Called exactly once per mutate session, immediately after the session's first (and, at this
// point, only) `opn_create` — so the backup store this runner owns holds exactly one target and
// exactly one backup. Anything else means the durable state under `stateDir` is not the fresh,
// private sandbox this scenario expects, and reading a backup out of it would not be reading
// "state A" — so it fails closed rather than guessing which entry is newest.
async function readSoleConfigBackup(
  stateDir,
  { readDirectory = readdir, readFileContent = readFile } = {}
) {
  const targetsDir = join(stateDir, 'targets');
  const targets = await readDirectory(targetsDir);
  if (!Array.isArray(targets) || targets.length !== 1) {
    throw new Product3RestoreError('BACKUP_STORE_UNEXPECTED');
  }
  const backupsDir = join(targetsDir, targets[0], 'backups');
  const backups = await readDirectory(backupsDir);
  if (!Array.isArray(backups) || backups.length !== 1) {
    throw new Product3RestoreError('BACKUP_STORE_UNEXPECTED');
  }
  return readFileContent(join(backupsDir, backups[0], 'config.xml'), 'utf8');
}

function emptyMutationChecks() {
  return {
    writableSurface: false,
    aliasAbsentBefore: false,
    aliasCreated: false,
    aliasPresent: false,
    aliasDeleted: false,
    aliasAbsentAfter: false
  };
}

async function runMutationSession(client, stateDir) {
  const checks = emptyMutationChecks();
  checks.writableSurface = writableToolSurface(await client.listTools());
  checks.aliasAbsentBefore = isAliasListPage(
    await client.callTool({ name: 'opn_list', arguments: LIST_ARGUMENTS }),
    0
  );
  if (!checks.writableSurface || !checks.aliasAbsentBefore) {
    return { checks, backupXml: undefined };
  }

  const firstCreated = await client.callTool({
    name: 'opn_create',
    arguments: { resource: 'firewall.alias', attributes: ALIAS_ATTRIBUTES }
  });
  const firstUuid = validCreatedUuid(firstCreated);
  checks.aliasCreated = firstUuid !== undefined;
  if (!checks.aliasCreated) return { checks, backupXml: undefined };

  // The envelope's strict pre-write snapshot for THIS create is the only backup in the store at
  // this instant: read it now, before the delete-and-recreate below adds a second one, so it
  // definitely names the pre-mutation state ("state A") the round trip's spec calls for.
  let backupXml;
  try {
    backupXml = await readSoleConfigBackup(stateDir);
  } catch {
    return { checks, backupXml: undefined };
  }

  checks.aliasPresent = isAliasListPage(
    await client.callTool({ name: 'opn_list', arguments: LIST_ARGUMENTS }),
    1,
    firstUuid
  );
  if (!checks.aliasPresent) return { checks, backupXml: undefined };

  const deleted = await client.callTool({
    name: 'opn_delete',
    arguments: { resource: 'firewall.alias', id: firstUuid }
  });
  checks.aliasDeleted =
    successfulToolResult(deleted) &&
    isRecord(deleted.structuredContent.item) &&
    deleted.structuredContent.item.id === firstUuid;
  if (!checks.aliasDeleted) return { checks, backupXml: undefined };

  checks.aliasAbsentAfter = isAliasListPage(
    await client.callTool({ name: 'opn_list', arguments: LIST_ARGUMENTS }),
    0
  );
  if (!checks.aliasAbsentAfter) return { checks, backupXml: undefined };

  // The mutation the round trip actually restores: a fresh create that this session does NOT
  // delete. Its own success is not exposed as a separate named check (the brief's checks list is
  // the alias set plus exactly `backupRestored`/`stateReverted`) — instead it gates by leaving
  // `backupXml` undefined, which the orchestrator treats as a failed mutation phase.
  const secondCreated = await client.callTool({
    name: 'opn_create',
    arguments: { resource: 'firewall.alias', attributes: ALIAS_ATTRIBUTES }
  });
  const secondUuid = validCreatedUuid(secondCreated);
  const applied =
    secondUuid !== undefined &&
    isAliasListPage(
      await client.callTool({ name: 'opn_list', arguments: LIST_ARGUMENTS }),
      1,
      secondUuid
    );
  return { checks, backupXml: applied ? backupXml : undefined };
}

async function runReobserveSession(client) {
  const stateReverted = isAliasListPage(
    await client.callTool({ name: 'opn_list', arguments: LIST_ARGUMENTS }),
    0
  );
  return { checks: { stateReverted } };
}

/**
 * Alias writes are experimental: they require READ_ONLY=false, the exact feature flag, and an
 * allow-list that explicitly names firewall.alias (mirrors product3-alias.mjs's own
 * `lifecycleEnvironment`, redefined locally because that function is private). Also sets
 * `OPNSENSE_MCP_STATE_DIR` to a directory this runner owns: the envelope's backup store must live
 * somewhere this scenario can read back and clean up, never the operator's real state root.
 */
function restoreLifecycleEnvironment(configPath, stateDir) {
  return Object.freeze({
    PATH: process.env.PATH ?? '',
    READ_ONLY: 'false',
    ENABLED_FEATURE_FLAGS: SCENARIO_FLAGS.join(','),
    ALLOWED_RESOURCES: SCENARIO_SCOPES.join(','),
    OPNSENSE_CONFIG_FILE: configPath,
    OPNSENSE_MCP_STATE_DIR: stateDir,
    MCP_REQUEST_STATE_SECRET: randomBytes(32).toString('base64url')
  });
}

export async function runInstalledRestoreLifecycle({
  invocation,
  configPath,
  stateDir,
  phase,
  signal = new AbortController().signal,
  sdkFactories,
  operationTimeoutMs = MCP_OPERATION_TIMEOUT_MS,
  closeTimeoutMs = MCP_CLOSE_TIMEOUT_MS
}) {
  if (phase !== 'mutate' && phase !== 'reobserve') {
    throw new Product3RestoreError('INVALID_PHASE');
  }
  return runHardenedStdioLifecycle(
    {
      invocation,
      environment: restoreLifecycleEnvironment(configPath, stateDir),
      signal,
      clientInfo: { name: 'product3-restore', version: MCP_CLIENT_VERSION },
      clientOptions: {
        capabilities: { elicitation: { form: {} } },
        enforceStrictCapabilities: true,
        versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } }
      },
      configureClient: (client) => {
        client.setRequestHandler('elicitation/create', () =>
          Promise.resolve({ action: 'accept', content: { confirm: true } })
        );
      },
      ...(sdkFactories === undefined ? {} : { sdkFactories }),
      operationTimeoutMs,
      closeTimeoutMs,
      stderrLimitBytes: MCP_STDERR_LIMIT_BYTES,
      failureMessage: 'Installed restore lifecycle failed'
    },
    (client) =>
      phase === 'mutate' ? runMutationSession(client, stateDir) : runReobserveSession(client)
  );
}

// ---------------------------------------------------------------------------------------------
// Orchestration: observe -> backup -> mutate -> restore -> reobserve.
// ---------------------------------------------------------------------------------------------
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
    ...emptyMutationChecks(),
    backupRestored: false,
    stateReverted: false,
    vmStopped: false,
    residueFree: false
  };
}

function summary(checks, interrupted = false, failureStage = null) {
  const passed = !interrupted && failureStage === null && Object.values(checks).every(Boolean);
  return Object.freeze({
    schemaVersion: 1,
    status: passed ? 'passed' : 'failed',
    failureStage: passed ? null : interrupted ? 'interrupted' : failureStage,
    checks
  });
}

export async function runProduct3Restore(options = {}) {
  const cacheRoot = options.cacheRoot ?? userCacheRoot();
  const instanceRoot = options.instanceRoot ?? join(cacheRoot, 'instance');
  const repositoryRoot = options.repositoryRoot ?? resolve('.');
  const attestationPath = options.attestationPath;
  const stdout = options.stdout ?? process.stdout;
  const signalSource = options.signalSource ?? process;
  const interruption = new AbortController();
  const doctor = options.doctor ?? doctorHost;
  const statusVm = options.statusVm ?? statusDisposableVm;
  const prepareBase = options.prepareBase ?? (() => prepareImage({ cacheRoot }));
  const startVm = options.startVm ?? startDisposableVm;
  const stopVm = options.stopVm ?? stopDisposableVm;
  const spawnVmProcess = options.spawnQemu ?? spawnQemu;
  const bootstrap = options.bootstrap ?? bootstrapProduct1b;
  const createArtifacts = options.createArtifacts ?? createConnectionArtifacts;
  const createTemporaryRoot = options.createTemporaryRoot ?? createPrivateTemporaryRoot;
  const installPackage = options.installPackage ?? installCurrentPackage;
  const runInstalled = options.runInstalled ?? runInstalledRestoreLifecycle;
  const restoreOverConsoleOperation = options.restoreOverConsole ?? restoreOverConsole;
  const removeTemporaryRoot = options.removeTemporaryRoot ?? removePrivateTemporaryRoot;
  const removeQmpSocket = options.removeQmpSocket ?? removeQmpSocketIfPresent;
  const verifyResidue = options.verifyResidue ?? verifyProduct1bResidue;
  const inspectGit = options.inspectGit ?? inspectGitWorktree;
  const writeAttestation = options.writeAttestation ?? writeVmRestoreAttestationAtomic;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const checks = emptyChecks();
  let gitIdentity;
  let doctorReport;
  let ownedVm = false;
  let temporaryRoot;
  let releasePackage;
  // Declared here (not inside the inner try) so the cleanup `finally` below — a sibling block, not
  // a nested one — can still read it: the same pattern `temporaryRoot`/`releasePackage` already
  // use, and for the same reason (a `const` scoped inside the try would not be visible there).
  let qmpPath;
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
      failureStage = 'preflight';
      if (typeof attestationPath !== 'string' || !isAbsolute(attestationPath)) {
        throw new Product3RestoreError('USAGE', ATTESTATION_USAGE);
      }
      gitIdentity = await inspectGit(repositoryRoot);
      if (gitIdentity?.clean !== true) throw new Product3RestoreError('DIRTY_WORKTREE');
      doctorReport = doctor();
      checks.doctor = doctorReport?.ready === true;
      if (!checks.doctor) throw new Error('Doctor failed');
      throwIfInterrupted();
      failureStage = 'preflight';
      const initialState = await statusVm({ instanceRoot });
      if (initialState?.state !== 'stopped') throw new Error('VM is not fresh');
      throwIfInterrupted();
      failureStage = 'vm-start';
      let credentials;
      // console.sock is product1b-lifecycle.mjs's own private-but-stable convention
      // (`join(instanceRoot, 'console.sock')`) — already relied on by the `bootstrapConsole`
      // callback's own `consolePath` argument below, and now the single place both the QMP socket
      // path and this scenario's later `restoreOverConsole` call derive from.
      const consoleSocketPath = join(instanceRoot, 'console.sock');
      qmpPath = deriveQmpSocketPath(consoleSocketPath);
      const started = await startVm({
        instanceRoot,
        rawPath: join(cacheRoot, IMAGE_SPEC.rawName),
        accelerator: doctorReport.accelerator,
        prepareBase,
        // Scenario-scoped variant of the launch: adds the QMP monitor `restoreOverConsole` needs
        // to re-enter the loader later. See `deriveQmpQemuArguments` — product1b-lifecycle.mjs
        // itself is untouched, only the argument list its own `buildQemuArguments` call returns
        // is transformed before the real spawn runs it.
        spawnVm: spawnQemuWithQmp(qmpPath, spawnVmProcess),
        bootstrapConsole: async ({ consolePath }) => {
          // QEMU is launched: from here the runner owns it and must prove it was stopped.
          ownedVm = true;
          failureStage = 'bootstrap';
          credentials = await bootstrap({
            consolePath,
            privileges: FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES
          });
          checks.bootstrap = true;
          failureStage = 'vm-start';
        }
      });
      checks.vmStarted = started?.state === 'running';
      if (!checks.vmStarted) throw new Error('VM start failed');
      ownedVm = true;
      throwIfInterrupted();
      failureStage = 'connection';
      const artifacts = await createArtifacts({ instanceRoot, credentials });
      throwIfInterrupted();
      failureStage = 'package';
      temporaryRoot = await createTemporaryRoot();
      throwIfInterrupted();
      const prepared = await installPackage({ repositoryRoot, temporaryRoot });
      releasePackage = prepared.cleanup;
      const invocation = prepared.invocation;
      checks.packageInstalled = true;
      throwIfInterrupted();

      // The MCP server's durable state (and, inside it, the envelope's backup store this scenario
      // reads back) is confined under the same private sandbox as the installed package, so its
      // cleanup is the existing `removeTemporaryRoot` — no separate teardown to add or forget.
      const stateDir = join(temporaryRoot, 'mcp-state');

      failureStage = 'mutate';
      const mutation = await runInstalled({
        invocation,
        configPath: artifacts.configPath,
        stateDir,
        signal: interruption.signal,
        phase: 'mutate'
      });
      Object.assign(checks, mutation.checks);
      if (
        !Object.values(mutation.checks).every(Boolean) ||
        typeof mutation.backupXml !== 'string'
      ) {
        throw new Error('Mutation phase failed');
      }

      throwIfInterrupted();
      failureStage = 'restore';
      await restoreOverConsoleOperation({
        consolePath: consoleSocketPath,
        backupXml: mutation.backupXml
      });
      checks.backupRestored = true;

      throwIfInterrupted();
      failureStage = 'reobserve';
      const reobserved = await runInstalled({
        invocation,
        configPath: artifacts.configPath,
        stateDir,
        signal: interruption.signal,
        phase: 'reobserve'
      });
      Object.assign(checks, reobserved.checks);
      if (Object.values(reobserved.checks).every(Boolean)) failureStage = null;
    } catch (error) {
      if (
        failureStage === 'bootstrap' &&
        error instanceof Product1bBootstrapError &&
        isSafeProduct1bBootstrapStage(error.stage)
      ) {
        failureStage = error.stage;
      } else if (
        failureStage === 'restore' &&
        error instanceof Product3RestoreConsoleError &&
        isSafeProduct3RestoreConsoleStage(error.stage)
      ) {
        failureStage = error.stage;
      }
      // The final summary contains only fixed booleans; VM, credentials, the backup XML and the
      // firewall data it carries all stay private.
    } finally {
      if (ownedVm) {
        // qmp.sock is this scenario's own addition to instanceRoot: product1b-lifecycle.mjs's
        // shared `cleanupOwnedState` only unlinks its own fixed, hard-coded file list and then
        // rmdir's instanceRoot, swallowing ENOTEMPTY — so a surviving qmp.sock would silently
        // leave instanceRoot behind, and `residueFree` would go false on an otherwise-perfect run.
        // Removed defensively, before the shared stop runs: this file cannot edit that allow-list,
        // so the only way to keep it from shadowing this cleanup is to run first.
        try {
          if (qmpPath !== undefined) await removeQmpSocket(qmpPath);
        } catch {
          cleanupFailed = true;
          failureStage = 'cleanup';
        }
        try {
          const stopped = await stopVm({ instanceRoot });
          checks.vmStopped = stopped?.state === 'stopped' && stopped.cleaned === true;
          if (!checks.vmStopped) failureStage = 'cleanup';
        } catch {
          checks.vmStopped = false;
          failureStage = 'cleanup';
        }
      }
      // Closes the fixture registry socket first: an open listener would keep the event loop
      // alive past the attestation and leave the producer hanging instead of exiting.
      try {
        if (releasePackage !== undefined) await releasePackage();
      } catch {
        cleanupFailed = true;
        failureStage = 'cleanup';
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
    if (
      !interrupted &&
      Object.values(checks).every(Boolean) &&
      gitIdentity?.clean === true &&
      doctorReport?.ready === true
    ) {
      failureStage = 'attestation';
      try {
        const finalGitIdentity = await inspectGit(repositoryRoot);
        if (
          finalGitIdentity?.clean !== true ||
          finalGitIdentity.commit !== gitIdentity.commit ||
          finalGitIdentity.tree !== gitIdentity.tree
        ) {
          throw new Product3RestoreError('GIT_STATE_CHANGED');
        }
        const attestation = {
          // Pinned to 2, matching alias's own generation: the adjudicated brief shares this schema
          // version unchanged (the restore scenario runs the same product profile) — only the
          // `checks` key set differs, which is why the default `writeAttestation` above is the
          // restore-shaped `writeVmRestoreAttestationAtomic`, not alias's own writer.
          schemaVersion: 2,
          commit: gitIdentity.commit,
          tree: gitIdentity.tree,
          node: nodeVersion,
          host: doctorReport.host,
          protocolVersion: MCP_PROTOCOL_VERSION,
          clientVersion: MCP_CLIENT_VERSION,
          image: {
            release: IMAGE_SPEC.release,
            sha256: IMAGE_SPEC.archiveSha256
          },
          scenario: {
            readOnly: false,
            flags: SCENARIO_FLAGS,
            scopes: SCENARIO_SCOPES
          },
          checks
        };
        await writeAttestation(attestationPath, attestation);
        failureStage = null;
      } catch {
        failureStage = 'attestation';
      }
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

export async function runProduct3RestoreCli(arguments_, options = {}) {
  let parsed;
  try {
    parsed = parseProduct3RestoreArguments(arguments_);
  } catch (error) {
    const stderr = options.stderr ?? process.stderr;
    stderr.write(`${error instanceof Product3RestoreError ? error.message : ATTESTATION_USAGE}\n`);
    return 1;
  }
  return runProduct3Restore({ ...options, ...parsed });
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runProduct3RestoreCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 2;
    });
}
