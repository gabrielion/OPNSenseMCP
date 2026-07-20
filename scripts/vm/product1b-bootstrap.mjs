// SPDX-License-Identifier: AGPL-3.0-or-later
import { createConnection } from 'node:net';

export const PRODUCT1B_BOOTSTRAP_FRAME_BEGIN = '__OPNSENSE_MCP_BOOTSTRAP_V1_7E3F1A09_BEGIN__';
export const PRODUCT1B_BOOTSTRAP_FRAME_END = '__OPNSENSE_MCP_BOOTSTRAP_V1_7E3F1A09_END__';

// Fixed guest-side program derived from OPNsense's 26.1.6 add_user.php model flow:
// https://github.com/opnsense/core/blob/26.1.6/src/opnsense/scripts/auth/add_user.php
export const PRODUCT1B_BOOTSTRAP_HELPER = String.raw`<?php
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
    $user->priv = implode(',', ['page-system-status', 'page-status-services', 'user-config-readonly']);

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

const FAILURE_CODE = 'PRODUCT1B_BOOTSTRAP_FAILED';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TRANSCRIPT_BYTES = 64 * 1024;
const SHELL_PROMPT = /root@OPNsense:[^\r\n]*#\s*/u;
const SHELL_CONTINUATION_PROMPT = /\?\s*/u;
const HELPER_EOF = '__OPNSENSE_MCP_HELPER_EOF__';

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

function validateOptions({ consolePath, factoryPassword, timeoutMs, maxTranscriptBytes }) {
  if (
    typeof consolePath !== 'string' ||
    consolePath.length === 0 ||
    consolePath.length > 1024 ||
    consolePath.includes('\0') ||
    typeof factoryPassword !== 'string' ||
    !/^[\x20-\x7e]{1,256}$/u.test(factoryPassword) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    !Number.isSafeInteger(maxTranscriptBytes) ||
    maxTranscriptBytes < 1024 ||
    maxTranscriptBytes > 1024 * 1024
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

function helperLines() {
  const encoded = Buffer.from(PRODUCT1B_BOOTSTRAP_HELPER, 'utf8').toString('base64');
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
  factoryPassword,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxTranscriptBytes = DEFAULT_MAX_TRANSCRIPT_BYTES
}) {
  validateOptions({ consolePath, factoryPassword, timeoutMs, maxTranscriptBytes });

  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: consolePath });
    let transcript = '';
    let transcriptBytes = 0;
    let offset = 0;
    let state = 'connecting';
    let settled = false;
    const uploadLines = helperLines();
    let uploadLine = 0;

    const cleanup = () => {
      clearTimeout(timer);
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
        if (state === 'login' && (next = matchAfter(transcript, offset, /login:\s*/iu))) {
          offset = next;
          state = 'password';
          send('root\n');
        }
        if (state === 'password' && (next = matchAfter(transcript, offset, /Password:\s*/u))) {
          offset = next;
          state = 'menu';
          send(`${factoryPassword}\n`);
        }
        if (state === 'menu' && (next = matchAfter(transcript, offset, /Enter an option:\s*/iu))) {
          offset = next;
          state = 'shell';
          send('8\n');
        }
        if (state === 'shell' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'umask';
          send('umask 077\n');
        }
        if (state === 'umask' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'heredoc-open';
          send(`/bin/cat > /tmp/opnsense-mcp-bootstrap.b64 <<${HELPER_EOF}\n`);
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
          send(
            '/usr/bin/base64 -d /tmp/opnsense-mcp-bootstrap.b64 > /tmp/opnsense-mcp-bootstrap.php && /bin/rm -f /tmp/opnsense-mcp-bootstrap.b64\n'
          );
        }
        if (state === 'decode' && (next = matchAfter(transcript, offset, SHELL_PROMPT))) {
          offset = next;
          state = 'result';
          send('/usr/local/bin/php /tmp/opnsense-mcp-bootstrap.php\n');
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
    const timer = setTimeout(rejectSafely, timeoutMs);
    timer.unref?.();
    socket.once('connect', () => {
      state = 'login';
      send('\n');
    });
    socket.on('data', (chunk) => {
      transcriptBytes += chunk.byteLength;
      if (transcriptBytes > maxTranscriptBytes) {
        rejectSafely();
        return;
      }
      transcript += chunk.toString('latin1');
      drive();
    });
    socket.once('error', rejectSafely);
    socket.once('close', rejectSafely);
  });
}
