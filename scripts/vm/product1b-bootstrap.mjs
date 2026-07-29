// SPDX-License-Identifier: AGPL-3.0-or-later
import { createConnection } from 'node:net';

export const PRODUCT1B_BOOTSTRAP_FRAME_BEGIN = '__OPNSENSE_MCP_BOOTSTRAP_V1_7E3F1A09_BEGIN__';
export const PRODUCT1B_BOOTSTRAP_FRAME_END = '__OPNSENSE_MCP_BOOTSTRAP_V1_7E3F1A09_END__';

// Product 1B provisions a strictly read-only automation account.
export const READONLY_BOOTSTRAP_PRIVILEGES = Object.freeze([
  'page-system-status',
  'page-status-services',
  'user-config-readonly'
]);

// The disposable Product 3 account deliberately does not inherit user-config-readonly: that flag makes
// ApiMutableModelControllerBase reject alias mutations. Grant only the stock configuration-history ACL
// needed for the strict backup and the stock alias-edit ACL needed for addItem/delItem/reconfigure.
export const FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES = Object.freeze([
  'page-system-status',
  'page-status-services',
  'page-diagnostics-configurationhistory',
  'page-firewall-alias-edit'
]);

function buildBootstrapPrivilegeLiteral(privileges) {
  if (!Array.isArray(privileges) || privileges.length === 0) {
    throw new TypeError('bootstrap privileges must be a non-empty array');
  }
  const tokens = privileges.map((privilege) => {
    if (typeof privilege !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(privilege)) {
      throw new TypeError('bootstrap privilege is not a stock ACL token');
    }
    return `'${privilege}'`;
  });
  return `[${tokens.join(', ')}]`;
}

// Fixed guest-side program derived from OPNsense's 26.1.6 add_user.php model flow:
// https://github.com/opnsense/core/blob/26.1.6/src/opnsense/scripts/auth/add_user.php
// Only the privilege list varies between profiles; every other instruction is byte-identical.
export function buildProduct1bBootstrapHelper(privileges) {
  const privilegeLiteral = buildBootstrapPrivilegeLiteral(privileges);
  return String.raw`<?php
require_once('legacy_bindings.inc');

use OPNsense\Core\Config;
use OPNsense\Auth\User;

ini_set('display_errors', '0');
error_reporting(0);

const RESULT_BEGIN = '__OPNSENSE_MCP_BOOTSTRAP_V1_7E3F1A09_BEGIN__';
const RESULT_END = '__OPNSENSE_MCP_BOOTSTRAP_V1_7E3F1A09_END__';

function finish_bootstrap(array $result, int $status): void
{
    $json = json_encode($result, JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) {
        $json = '{"error":"GUEST_FAILED"}';
        $status = 1;
    }
    echo RESULT_BEGIN . base64_encode($json) . RESULT_END;
    @unlink(__FILE__);
    exit($status);
}

$username = 'opnsense-mcp-lab';
$config = Config::getInstance();
$locked = false;

try {
    $config->lock();
    $locked = true;
    $usermdl = new User();

    if ($usermdl->getUserByName($username) !== null) {
        $config->unlock();
        $locked = false;
        finish_bootstrap(['error' => 'USER_EXISTS'], 1);
    }

    $user = $usermdl->user->Add();
    $user->name = $username;
    $user->scope = 'automation';
    $user->shell = '';
    $user->priv = implode(',', ${privilegeLiteral});

    // The account must not have a usable interactive password. The model still
    // requires a valid password hash, so mirror the stock add_user.php behavior.
    $password = random_bytes(50);
    while (($position = strpos($password, "\0")) !== false) {
        $password[$position] = random_bytes(1);
    }
    $hash = $usermdl->generatePasswordHash($password);
    if (!is_string($hash) || strpos($hash, '$') !== 0) {
        throw new RuntimeException('password hash failed');
    }
    $user->password = $hash;
    unset($password, $hash);

    $apiKey = $user->apikeys->add();
    if (!is_array($apiKey) || !isset($apiKey['key'], $apiKey['secret'])) {
        throw new RuntimeException('API key creation failed');
    }

    $validationErrors = [];
    $validationMessages = $usermdl->performValidation();
    foreach ($validationMessages as $message) {
        if (strpos($message->getField(), $user->__reference) !== false) {
            $validationErrors[] = $message->getMessage();
        }
    }
    if ($validationErrors !== []) {
        throw new RuntimeException('user validation failed');
    }

    if (!$usermdl->serializeToConfig(false, true)) {
        throw new RuntimeException('user serialization failed');
    }
    Config::getInstance()->save();
    $locked = false;
    configdp_run('auth sync user', [$username]);

    $system = Config::getInstance()->object()->system;
    $hostname = trim((string)$system->hostname);
    $domain = trim((string)$system->domain);
    $serverName = $domain === '' ? $hostname : $hostname . '.' . $domain;
    finish_bootstrap([
        'key' => (string)$apiKey['key'],
        'secret' => (string)$apiKey['secret'],
        'serverName' => $serverName,
    ], 0);
} catch (Throwable $error) {
    if ($locked) {
        $config->unlock();
    }
    finish_bootstrap(['error' => 'GUEST_FAILED'], 1);
} finally {
    @unlink(__FILE__);
}
?>`;
}

export const PRODUCT1B_BOOTSTRAP_HELPER = buildProduct1bBootstrapHelper(
  READONLY_BOOTSTRAP_PRIVILEGES
);

const FAILURE_CODE = 'PRODUCT1B_BOOTSTRAP_FAILED';
// `timeoutMs` bounds absence of console progress, not the length of a healthy boot: the VM
// answers on its API port well before the console finishes booting, so a deadline measured
// from connection expires mid-boot even though the guest is still writing. `overallTimeoutMs`
// keeps a console that chatters forever from hanging the runner.
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 600_000;
const MAXIMUM_OVERALL_TIMEOUT_MS = 1_800_000;
// The console has to be attached before the guest reaches its loader, so the bootstrap is
// started while QEMU is still initialising and the chardev socket may not exist yet. The
// retry is bounded by attempts as well as by both deadlines, and still fails closed.
const DEFAULT_CONNECT_ATTEMPTS = 100;
const MAXIMUM_CONNECT_ATTEMPTS = 1000;
const DEFAULT_CONNECT_RETRY_DELAY_MS = 100;
const MAXIMUM_CONNECT_RETRY_DELAY_MS = 5_000;
// The transcript now spans the single-user boot, the staged upload and the whole multi-user
// boot that runs the helper, so the bound is sized for two boots and still fails closed.
const DEFAULT_MAX_TRANSCRIPT_BYTES = 512 * 1024;
// Single user leaves the prompt without a hostname (`root@:/ # `), and the default `/bin/sh`
// continues an unterminated here-document with `> ` at the start of a line. The echo of our
// own redirections also contains `> `, so the continuation prompt must stay line-anchored.
const SHELL_PROMPT = /root@[^\r\n]*#[ ]?/u;
const SHELL_CONTINUATION_PROMPT = /^> /mu;
// The lua loader highlights the mnemonic letter of each menu entry, so the single-user entry
// reaches the console either as `Boot Single user` or as `Boot <esc>[1mS<esc>[0mingle user`.
// Any one of the loader's three invariants means the menu is up and accepting a keystroke.
const LOADER_MENU = /Autoboot in|Welcome to|Boot[^\r\n]{0,16}ingle\s+user/iu;
const SINGLE_USER_SHELL_PROMPT = /Enter full pathname of shell[^\r\n]*:[ ]?/u;
const HELPER_EOF = '__OPNSENSE_MCP_HELPER_EOF__';

// The nano image mounts memory filesystems over /tmp and /var at multi-user boot, so the
// staged helper has to live on the root filesystem beside the boot hook that executes it.
const STAGED_HELPER_ENCODED = '/usr/local/etc/mcpb.b64';
const STAGED_HELPER = '/usr/local/etc/mcpb.php';
const BOOT_HOOK_DIRECTORY = '/usr/local/etc/rc.syshook.d/start';
const BOOT_HOOK = `${BOOT_HOOK_DIRECTORY}/mcpb.sh`;

// One fixed, credential-free guest program. Nothing in it varies with operator input.
const REMOUNT_COMMAND = '/sbin/mount -u -o rw /\n';
const UMASK_COMMAND = 'umask 077\n';
const HEREDOC_OPEN_COMMAND = `/bin/cat > ${STAGED_HELPER_ENCODED} <<${HELPER_EOF}\n`;
// The guest decoder is line oriented: a single long base64 line decodes to an empty file,
// so the upload keeps standard 76-character lines and `openssl` reads them from disk.
const DECODE_COMMAND = `/usr/bin/openssl base64 -d -in ${STAGED_HELPER_ENCODED} -out ${STAGED_HELPER} && /bin/rm -f ${STAGED_HELPER_ENCODED}\n`;
// The helper needs configd, which only exists in multi-user, so OPNsense's stock start hook
// runs it at the next boot, writes the framed result to the console and removes both files.
const BOOT_HOOK_BODY = `#!/bin/sh\\n/usr/local/bin/php ${STAGED_HELPER} > /dev/console 2>/dev/null\\n/bin/rm -f ${STAGED_HELPER} ${BOOT_HOOK}\\n`;
const REGISTER_HOOK_COMMAND = `/bin/mkdir -p ${BOOT_HOOK_DIRECTORY} && /usr/bin/printf '${BOOT_HOOK_BODY}' > ${BOOT_HOOK} && /bin/chmod 0700 ${BOOT_HOOK}\n`;
const RESUME_COMMAND = 'exit\n';

export const PRODUCT1B_BOOTSTRAP_SAFE_STAGES = Object.freeze([
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
  'hook',
  'result',
  'frame'
]);

export function isSafeProduct1bBootstrapStage(stage) {
  return typeof stage === 'string' && PRODUCT1B_BOOTSTRAP_SAFE_STAGES.includes(stage);
}

export class Product1bBootstrapError extends Error {
  constructor(stage = 'validation') {
    super(FAILURE_CODE);
    this.name = 'Product1bBootstrapError';
    this.code = FAILURE_CODE;
    this.stage = stage;
  }
}

function fail() {
  throw new Product1bBootstrapError();
}

function validateOptions({
  consolePath,
  timeoutMs,
  overallTimeoutMs,
  maxTranscriptBytes,
  connectAttempts,
  connectRetryDelayMs
}) {
  if (
    typeof consolePath !== 'string' ||
    consolePath.length === 0 ||
    consolePath.length > 1024 ||
    consolePath.includes('\0') ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    !Number.isSafeInteger(overallTimeoutMs) ||
    overallTimeoutMs < 1 ||
    overallTimeoutMs > MAXIMUM_OVERALL_TIMEOUT_MS ||
    !Number.isSafeInteger(maxTranscriptBytes) ||
    maxTranscriptBytes < 1024 ||
    maxTranscriptBytes > 1024 * 1024 ||
    !Number.isSafeInteger(connectAttempts) ||
    connectAttempts < 1 ||
    connectAttempts > MAXIMUM_CONNECT_ATTEMPTS ||
    !Number.isSafeInteger(connectRetryDelayMs) ||
    connectRetryDelayMs < 1 ||
    connectRetryDelayMs > MAXIMUM_CONNECT_RETRY_DELAY_MS
  ) {
    fail();
  }
}

function validCredential(value) {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= 256 &&
    /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  );
}

function validServerName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253) return false;
  const labels = value.split('.');
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  );
}

function parseResult(payload) {
  if (
    payload.length === 0 ||
    payload.length > 2048 ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload)
  ) {
    fail();
  }
  let decoded;
  try {
    decoded = Buffer.from(payload, 'base64');
    if (decoded.toString('base64') !== payload || decoded.byteLength > 1024) fail();
  } catch {
    fail();
  }
  let result;
  try {
    result = JSON.parse(decoded.toString('utf8'));
  } catch {
    fail();
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(',') !== 'key,secret,serverName' ||
    !validCredential(result.key) ||
    !validCredential(result.secret) ||
    !validServerName(result.serverName)
  ) {
    fail();
  }
  return Object.freeze({ key: result.key, secret: result.secret, serverName: result.serverName });
}

function helperLines(helper) {
  const encoded = Buffer.from(helper, 'utf8').toString('base64');
  const lines = encoded.match(/.{1,76}/gu);
  if (lines === null) fail();
  return lines;
}

function matchAfter(transcript, offset, expression) {
  const match = expression.exec(transcript.slice(offset));
  if (match === null || match.index === undefined) return undefined;
  return offset + match.index + match[0].length;
}

export async function bootstrapProduct1b({
  consolePath,
  privileges = READONLY_BOOTSTRAP_PRIVILEGES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  overallTimeoutMs = DEFAULT_OVERALL_TIMEOUT_MS,
  maxTranscriptBytes = DEFAULT_MAX_TRANSCRIPT_BYTES,
  connectAttempts = DEFAULT_CONNECT_ATTEMPTS,
  connectRetryDelayMs = DEFAULT_CONNECT_RETRY_DELAY_MS
}) {
  validateOptions({
    consolePath,
    timeoutMs,
    overallTimeoutMs,
    maxTranscriptBytes,
    connectAttempts,
    connectRetryDelayMs
  });
  const helper =
    privileges === READONLY_BOOTSTRAP_PRIVILEGES
      ? PRODUCT1B_BOOTSTRAP_HELPER
      : buildProduct1bBootstrapHelper(privileges);

  return new Promise((resolve, reject) => {
    let socket;
    let connectAttempt = 0;
    let retryTimer;
    let transcript = '';
    let transcriptBytes = 0;
    let offset = 0;
    let state = 'connecting';
    let settled = false;
    const uploadLines = helperLines(helper);
    let uploadLine = 0;

    const cleanup = () => {
      clearTimeout(overallTimer);
      clearTimeout(progressTimer);
      clearTimeout(retryTimer);
      if (socket === undefined) return;
      socket.removeAllListeners();
      socket.destroy();
    };
    const rejectSafely = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Product1bBootstrapError(state));
    };
    const resolveSafely = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const send = (value) => {
      try {
        socket.write(value);
      } catch {
        rejectSafely();
      }
    };
    const drive = () => {
      try {
        let next;
        if (state === 'loader' && (next = matchAfter(transcript, offset, LOADER_MENU))) {
          offset = next;
          state = 'single-user';
          // The loader menu takes a single unterminated keystroke.
          send('2');
        }
        if (
          state === 'single-user' &&
          (next = matchAfter(transcript, offset, SINGLE_USER_SHELL_PROMPT))
        ) {
          offset = next;
          state = 'shell';
          // RETURN accepts the default /bin/sh; single user needs no authentication.
          send('\n');
        }
        if (state === 'shell' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'remount';
          send(REMOUNT_COMMAND);
        }
        if (state === 'remount' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'umask';
          send(UMASK_COMMAND);
        }
        if (state === 'umask' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'heredoc-open';
          send(HEREDOC_OPEN_COMMAND);
        }
        if (
          state === 'heredoc-open' &&
          (next = matchAfter(transcript, offset, SHELL_CONTINUATION_PROMPT))
        ) {
          offset = next;
          state = 'heredoc-lines';
          send(`${uploadLines[uploadLine]}\n`);
          uploadLine += 1;
        }
        if (
          state === 'heredoc-lines' &&
          (next = matchAfter(transcript, offset, SHELL_CONTINUATION_PROMPT))
        ) {
          offset = next;
          if (uploadLine < uploadLines.length) {
            send(`${uploadLines[uploadLine]}\n`);
            uploadLine += 1;
          } else {
            state = 'heredoc-close';
            send(`${HELPER_EOF}\n`);
          }
        }
        if (state === 'heredoc-close' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'decode';
          send(DECODE_COMMAND);
        }
        if (state === 'decode' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'hook';
          send(REGISTER_HOOK_COMMAND);
        }
        if (state === 'hook' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'result';
          // Leaving the single-user shell continues the boot into multi user, where the
          // registered hook runs the helper and frames its result on the console.
          send(RESUME_COMMAND);
        }
        if (state === 'result') {
          const begin = transcript.indexOf(PRODUCT1B_BOOTSTRAP_FRAME_BEGIN, offset);
          if (begin === -1) return;
          const payloadStart = begin + PRODUCT1B_BOOTSTRAP_FRAME_BEGIN.length;
          const end = transcript.indexOf(PRODUCT1B_BOOTSTRAP_FRAME_END, payloadStart);
          if (end === -1) return;
          if (transcript.indexOf(PRODUCT1B_BOOTSTRAP_FRAME_BEGIN, payloadStart) !== -1) fail();
          state = 'frame';
          resolveSafely(parseResult(transcript.slice(payloadStart, end)));
        }
      } catch {
        rejectSafely();
      }
    };
    const overallTimer = setTimeout(rejectSafely, overallTimeoutMs);
    overallTimer.unref?.();
    let progressTimer;
    const awaitProgress = () => {
      clearTimeout(progressTimer);
      progressTimer = setTimeout(rejectSafely, timeoutMs);
      progressTimer.unref?.();
    };
    awaitProgress();

    const onConsoleLost = () => {
      if (settled) return;
      // Only an attempt that never reached the console may be retried: once the guest has
      // spoken, a closed or failing socket is a real failure and must fail closed.
      if (state !== 'connecting' || connectAttempt >= connectAttempts) {
        rejectSafely();
        return;
      }
      socket.removeAllListeners();
      socket.destroy();
      socket = undefined;
      // The retry timer is the only pending work during the gap between destroying the failed
      // socket and reconnecting: unlike the two deadline timers, which are safety bounds covered
      // by the live socket during normal streaming, it must keep the event loop alive. Left
      // unref'd, the loop empties in this window and the process exits mid-await, abandoning the
      // caller and orphaning a running VM.
      retryTimer = setTimeout(openConsole, connectRetryDelayMs);
    };
    function openConsole() {
      if (settled) return;
      connectAttempt += 1;
      socket = createConnection({ path: consolePath });
      socket.once('connect', () => {
        // Nothing is written before the loader menu: a stray newline would select the
        // default multi-user entry and lose the only unauthenticated shell on this image.
        state = 'loader';
      });
      socket.on('data', (chunk) => {
        awaitProgress();
        transcriptBytes += chunk.byteLength;
        if (transcriptBytes > maxTranscriptBytes) {
          rejectSafely();
          return;
        }
        transcript += chunk.toString('latin1');
        drive();
      });
      socket.once('error', onConsoleLost);
      socket.once('close', onConsoleLost);
    }
    openConsole();
  });
}
