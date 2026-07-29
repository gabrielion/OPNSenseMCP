// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

import {
  FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES,
  PRODUCT1B_BOOTSTRAP_FRAME_BEGIN,
  PRODUCT1B_BOOTSTRAP_FRAME_END,
  PRODUCT1B_BOOTSTRAP_HELPER,
  PRODUCT1B_BOOTSTRAP_SAFE_STAGES,
  READONLY_BOOTSTRAP_PRIVILEGES,
  bootstrapProduct1b,
  buildProduct1bBootstrapHelper
} from '../../scripts/vm/product1b-bootstrap.mjs';

const BOOTSTRAP_SOURCE = new URL('../../scripts/vm/product1b-bootstrap.mjs', import.meta.url);

// Single user leaves the prompt without a hostname, and /bin/sh continues quoted input with `> `.
const SHELL_PROMPT = 'root@:/ # ';
const CONTINUATION_PROMPT = '> ';

// The exact fixed guest program. Nothing here may vary with operator input.
const EXPECTED_REMOUNT = '/sbin/mount -u -o rw /\n';
const EXPECTED_UMASK = 'umask 077\n';
const EXPECTED_HEREDOC_OPEN = '/bin/cat > /usr/local/etc/mcpb.b64 <<__OPNSENSE_MCP_HELPER_EOF__\n';
const EXPECTED_HEREDOC_CLOSE = '__OPNSENSE_MCP_HELPER_EOF__\n';
const EXPECTED_DECODE =
  '/usr/bin/openssl base64 -d -in /usr/local/etc/mcpb.b64 -out /usr/local/etc/mcpb.php && /bin/rm -f /usr/local/etc/mcpb.b64\n';
const EXPECTED_HOOK =
  "/bin/mkdir -p /usr/local/etc/rc.syshook.d/start && /usr/bin/printf '#!/bin/sh\\n/usr/local/bin/php /usr/local/etc/mcpb.php > /dev/console 2>/dev/null\\n/bin/rm -f /usr/local/etc/mcpb.php /usr/local/etc/rc.syshook.d/start/mcpb.sh\\n' > /usr/local/etc/rc.syshook.d/start/mcpb.sh && /bin/chmod 0700 /usr/local/etc/rc.syshook.d/start/mcpb.sh\n";
const EXPECTED_RESUME = 'exit\n';

const roots = [];

async function temporarySocketPath() {
  const root = await mkdtemp(join(tmpdir(), 'p1b-bootstrap-'));
  roots.push(root);
  return join(root, 'console.sock');
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function readUntil(socket, predicate, maximumChunkBytes = Number.POSITIVE_INFINITY) {
  return new Promise((resolve, reject) => {
    let received = '';
    const onData = (chunk) => {
      received += chunk.subarray(0, maximumChunkBytes).toString('utf8');
      if (predicate(received)) {
        cleanup();
        resolve(received);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('fixture socket closed early'));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function framedResult(result) {
  const payload = Buffer.from(JSON.stringify(result), 'utf8').toString('base64');
  return `${PRODUCT1B_BOOTSTRAP_FRAME_BEGIN}${payload}${PRODUCT1B_BOOTSTRAP_FRAME_END}`;
}

function helperLines(helper) {
  const lines = Buffer.from(helper, 'utf8')
    .toString('base64')
    .match(/.{1,76}/gu);
  if (lines === null) throw new Error('fixture helper encoding failed');
  return lines;
}

// The lua loader highlights the mnemonic letter of every menu entry, so the single-user entry
// reaches the serial console with ANSI codes inside the word.
const HIGHLIGHTED_LOADER_MENU =
  '\r\nFreeBSD/amd64 EFI loader, Revision 1.1\r\n\r\n' +
  '1. Boot \u001b[1mM\u001b[0multi user [Enter]\r\n' +
  '2. Boot \u001b[1mS\u001b[0mingle user\r\n' +
  '3. [Esc]ape to loader prompt\r\n';

// The three invariants the loader match is allowed to key on, each on its own.
const PLAIN_LOADER_MENU = '\r\n1. Boot Multi user [Enter]\r\n2. Boot Single User\r\n';
const COUNTDOWN_LOADER_MENU = '\r\nAutoboot in 3 seconds. [Space] to pause\r\n';
const BANNER_LOADER_MENU = '\r\nWelcome to OPNsense 26.7\r\n';

// Drives the fixed single-user dialogue and returns every byte the bootstrap wrote.
async function runSingleUserGuest(
  socket,
  { helper = PRODUCT1B_BOOTSTRAP_HELPER, menu = HIGHLIGHTED_LOADER_MENU } = {}
) {
  const sent = [];
  const step = async (prompt, limit = 512) => {
    const command = await readUntil(socket, (input) => input.endsWith('\n'), limit);
    sent.push(command);
    // A real serial tty echoes the typed line before printing the next prompt.
    socket.write(command.replace(/\n$/u, '\r\n'));
    if (prompt !== '') socket.write(prompt);
    return command;
  };

  socket.write(menu);
  sent.push(await readUntil(socket, (input) => input.length >= 1, 8));
  socket.write('2\r\nBooting [single user]...\r\n');
  socket.write('Enter full pathname of shell or RETURN for /bin/sh: ');
  sent.push(await readUntil(socket, (input) => input.endsWith('\n'), 8));
  socket.write(`\r\n${SHELL_PROMPT}`);

  await step(SHELL_PROMPT);
  await step(SHELL_PROMPT);
  await step(CONTINUATION_PROMPT);
  for (const line of helperLines(helper)) {
    const uploaded = await step(CONTINUATION_PROMPT, 128);
    if (uploaded !== `${line}\n`) throw new Error('fixture helper upload mismatch');
  }
  await step(SHELL_PROMPT, 128);
  await step(SHELL_PROMPT);
  await step(SHELL_PROMPT);
  await step('', 16);
  socket.write(">>> Invoking start script 'mcpb.sh'\r\n");
  return sent.join('');
}

describe('Product 1B serial bootstrap', () => {
  it('uses one fixed fail-closed helper with the least stock privileges and one config save', () => {
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain("require_once('legacy_bindings.inc');");
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain("$username = 'opnsense-mcp-lab';");
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain("$user->scope = 'automation';");
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain("$user->shell = '';");
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain('random_bytes(50)');
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain('$user->apikeys->add()');
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain(
      "['page-system-status', 'page-status-services', 'user-config-readonly']"
    );
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain('$usermdl->performValidation()');
    expect(PRODUCT1B_BOOTSTRAP_HELPER.match(/serializeToConfig\(false, true\)/gu)).toHaveLength(1);
    expect(PRODUCT1B_BOOTSTRAP_HELPER.match(/Config::getInstance\(\)->save\(\)/gu)).toHaveLength(1);
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain("configdp_run('auth sync user', [$username])");
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain('@unlink(__FILE__)');

    const existenceCheck = PRODUCT1B_BOOTSTRAP_HELPER.indexOf('getUserByName($username)');
    const mutation = PRODUCT1B_BOOTSTRAP_HELPER.indexOf('$usermdl->user->Add()');
    expect(existenceCheck).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(existenceCheck);
  });

  it('exposes one fixed stage vocabulary with no credential stage', () => {
    expect(PRODUCT1B_BOOTSTRAP_SAFE_STAGES).toEqual([
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
    expect(Object.isFrozen(PRODUCT1B_BOOTSTRAP_SAFE_STAGES)).toBe(true);
  });

  it('never asks for or accepts an operator credential', async () => {
    const source = await readFile(BOOTSTRAP_SOURCE, 'utf8');
    expect(source).not.toContain('factoryPassword');
    expect(source).not.toContain('Password:');
    expect(source).not.toContain('Enter an option');
  });

  it('boots single user, stages the helper for the boot hook, and returns only validated credentials', async () => {
    const socketPath = await temporarySocketPath();
    const ignoredPassword = 'SENTINEL_PASSWORD_MUST_NEVER_BE_SENT';
    const result = {
      key: 'K'.repeat(80),
      secret: 'S'.repeat(80),
      serverName: 'OPNsense.internal'
    };
    const observed = {};
    const server = createServer(async (socket) => {
      try {
        observed.sent = await runSingleUserGuest(socket);
        const framed = framedResult(result);
        socket.write(`bootstrap output\r\n${framed.slice(0, 37)}`);
        socket.end(framed.slice(37));
      } catch {
        socket.destroy();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    await expect(
      bootstrapProduct1b({
        consolePath: socketPath,
        timeoutMs: 2_000,
        // A stray credential option must be inert: nothing may reach the console.
        factoryPassword: ignoredPassword
      })
    ).resolves.toEqual(result);

    const uploaded = helperLines(PRODUCT1B_BOOTSTRAP_HELPER)
      .map((line) => `${line}\n`)
      .join('');
    expect(observed.sent).toBe(
      [
        '2',
        '\n',
        EXPECTED_REMOUNT,
        EXPECTED_UMASK,
        EXPECTED_HEREDOC_OPEN,
        uploaded,
        EXPECTED_HEREDOC_CLOSE,
        EXPECTED_DECODE,
        EXPECTED_HOOK,
        EXPECTED_RESUME
      ].join('')
    );
    expect(observed.sent).not.toContain('SENTINEL');
    expect(observed.sent).not.toContain(ignoredPassword);
    expect(observed.sent).not.toContain(result.key);
    expect(observed.sent).not.toContain(result.secret);
    expect(Buffer.from(uploaded.replaceAll('\n', ''), 'base64').toString('utf8')).toBe(
      PRODUCT1B_BOOTSTRAP_HELPER
    );

    await new Promise((resolve) => server.close(resolve));
  });

  it.each([
    ['ANSI-highlighted', HIGHLIGHTED_LOADER_MENU],
    ['plain', PLAIN_LOADER_MENU],
    ['countdown-only', COUNTDOWN_LOADER_MENU],
    ['banner-only', BANNER_LOADER_MENU]
  ])('selects single user exactly once from the %s loader rendering', async (_name, menu) => {
    const socketPath = await temporarySocketPath();
    const sockets = new Set();
    let written = '';
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('data', (chunk) => {
        written += chunk.toString('utf8');
      });
      socket.write(menu);
      // Redrawing the menu must not produce a second keystroke.
      setTimeout(() => {
        if (!socket.destroyed) socket.write(menu);
      }, 40).unref();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    await expect(
      bootstrapProduct1b({ consolePath: socketPath, timeoutMs: 300, overallTimeoutMs: 5_000 })
    ).rejects.toMatchObject({ code: 'PRODUCT1B_BOOTSTRAP_FAILED', stage: 'single-user' });
    expect(written).toBe('2');

    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it('waits for QEMU to create the console socket before giving up', async () => {
    const socketPath = await temporarySocketPath();
    const result = {
      key: 'K'.repeat(80),
      secret: 'S'.repeat(80),
      serverName: 'OPNsense.internal'
    };
    const server = createServer(async (socket) => {
      try {
        await runSingleUserGuest(socket);
        socket.end(framedResult(result));
      } catch {
        socket.destroy();
      }
    });

    // The bootstrap starts before the socket exists, exactly as it will against a launching VM.
    const bootstrapped = bootstrapProduct1b({
      consolePath: socketPath,
      timeoutMs: 2_000,
      connectRetryDelayMs: 20
    });
    void bootstrapped.catch(() => undefined);
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    await expect(bootstrapped).resolves.toEqual(result);

    await new Promise((resolve) => server.close(resolve));
  });

  it('fails closed at connecting when the console socket never appears', async () => {
    const socketPath = await temporarySocketPath();

    await expect(
      bootstrapProduct1b({
        consolePath: socketPath,
        timeoutMs: 5_000,
        overallTimeoutMs: 10_000,
        connectAttempts: 3,
        connectRetryDelayMs: 10
      })
    ).rejects.toMatchObject({ code: 'PRODUCT1B_BOOTSTRAP_FAILED', stage: 'connecting' });
  });

  it('returns one fixed safe failure without exposing the result or serial transcript', async () => {
    const socketPath = await temporarySocketPath();
    const leakedResult = 'SENTINEL_RESULT_MUST_NOT_LEAK';
    const leakedTranscript = 'SENTINEL_TRANSCRIPT_MUST_NOT_LEAK';
    const server = createServer(async (socket) => {
      try {
        await runSingleUserGuest(socket);
        socket.end(
          `${leakedTranscript}${framedResult({
            key: 'K'.repeat(80),
            secret: leakedResult,
            serverName: 'OPNsense.internal'
          })}`
        );
      } catch {
        socket.destroy();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    let failure;
    try {
      await bootstrapProduct1b({ consolePath: socketPath, timeoutMs: 2_000 });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: 'Product1bBootstrapError',
      code: 'PRODUCT1B_BOOTSTRAP_FAILED',
      message: 'PRODUCT1B_BOOTSTRAP_FAILED',
      stage: 'frame'
    });
    expect(failure).not.toHaveProperty('cause');
    const visibleFailure = `${failure?.name}\n${failure?.message}\n${failure?.stack}`;
    expect(visibleFailure).not.toContain(leakedResult);
    expect(visibleFailure).not.toContain(leakedTranscript);

    await new Promise((resolve) => server.close(resolve));
  });
});

describe('Product 1B serial bootstrap deadlines', () => {
  // The disposable VM opens its HTTPS port well before the console finishes booting: on the
  // reference workstation the API answered 69s after launch and the console only reached
  // `login:` at 112s. A single deadline measured from connection therefore expires mid-boot
  // and the runner only succeeded when an operator happened to type late enough. The deadline
  // must bound absence of progress, not the length of a healthy boot.
  function bootPhase(socket, { chunks, intervalMs }) {
    return new Promise((resolve) => {
      let remaining = chunks;
      const chatter = setInterval(() => {
        socket.write('Booting from Hard Disk...\r\n');
        remaining -= 1;
        if (remaining > 0) return;
        clearInterval(chatter);
        resolve();
      }, intervalMs);
      socket.once('close', () => clearInterval(chatter));
      socket.once('error', () => clearInterval(chatter));
    });
  }

  // A fixture that never closes its accepted socket would keep server.close() pending, so
  // every connection is tracked and destroyed before the server is shut down.
  function trackConnections(server) {
    const sockets = new Set();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    return async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    };
  }

  async function listen(server, socketPath) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
  }

  it('keeps waiting for the loader menu while a slow boot is still writing to the console', async () => {
    const socketPath = await temporarySocketPath();
    const result = {
      key: 'K'.repeat(80),
      secret: 'S'.repeat(80),
      serverName: 'OPNsense.internal'
    };
    const server = createServer(async (socket) => {
      try {
        // Firmware chatter for far longer than the no-progress deadline, then the menu.
        await bootPhase(socket, { chunks: 14, intervalMs: 50 });
        await runSingleUserGuest(socket);
        socket.end(framedResult(result));
      } catch {
        socket.destroy();
      }
    });
    const shutdown = trackConnections(server);
    await listen(server, socketPath);

    await expect(
      bootstrapProduct1b({
        consolePath: socketPath,
        timeoutMs: 300,
        overallTimeoutMs: 10_000
      })
    ).resolves.toEqual(result);

    await shutdown();
  });

  it('fails closed when the console keeps writing but never presents the loader menu', async () => {
    const socketPath = await temporarySocketPath();
    const server = createServer(async (socket) => {
      try {
        await bootPhase(socket, { chunks: 1_000, intervalMs: 20 });
      } catch {
        socket.destroy();
      }
    });
    const shutdown = trackConnections(server);
    await listen(server, socketPath);

    const started = Date.now();
    let failure;
    try {
      await bootstrapProduct1b({
        consolePath: socketPath,
        timeoutMs: 5_000,
        overallTimeoutMs: 400
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 'PRODUCT1B_BOOTSTRAP_FAILED',
      stage: 'loader'
    });
    expect(Date.now() - started).toBeLessThan(2_500);

    await shutdown();
  });

  it('fails closed when the console never writes anything', async () => {
    const socketPath = await temporarySocketPath();
    const server = createServer();
    const shutdown = trackConnections(server);
    await listen(server, socketPath);

    const started = Date.now();
    let failure;
    try {
      await bootstrapProduct1b({
        consolePath: socketPath,
        timeoutMs: 300,
        overallTimeoutMs: 10_000
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 'PRODUCT1B_BOOTSTRAP_FAILED',
      stage: 'loader'
    });
    expect(Date.now() - started).toBeLessThan(2_500);

    await shutdown();
  });

  it('rejects an unusable overall deadline', async () => {
    const socketPath = await temporarySocketPath();
    await expect(
      bootstrapProduct1b({
        consolePath: socketPath,
        overallTimeoutMs: 0
      })
    ).rejects.toMatchObject({ code: 'PRODUCT1B_BOOTSTRAP_FAILED', stage: 'validation' });
  });
});

describe('bootstrap privilege scoping', () => {
  it('keeps the read-only privilege set as the default helper', () => {
    expect(READONLY_BOOTSTRAP_PRIVILEGES).toEqual([
      'page-system-status',
      'page-status-services',
      'user-config-readonly'
    ]);
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toBe(
      buildProduct1bBootstrapHelper(READONLY_BOOTSTRAP_PRIVILEGES)
    );
    expect(PRODUCT1B_BOOTSTRAP_HELPER).toContain(
      "implode(',', ['page-system-status', 'page-status-services', 'user-config-readonly'])"
    );
  });

  it('uses only the granular backup and alias-edit privileges for Product 3', () => {
    expect(FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES).toEqual([
      'page-system-status',
      'page-status-services',
      'page-diagnostics-configurationhistory',
      'page-firewall-alias-edit'
    ]);
    const helper = buildProduct1bBootstrapHelper(FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES);
    expect(helper).toContain(
      "implode(',', ['page-system-status', 'page-status-services', 'page-diagnostics-configurationhistory', 'page-firewall-alias-edit'])"
    );
    expect(helper).not.toContain('user-config-readonly');
  });

  it('rejects privilege identifiers that are not stock ACL tokens', () => {
    expect(() => buildProduct1bBootstrapHelper(['page-system-status', "x'] )); evil"])).toThrow();
    expect(() => buildProduct1bBootstrapHelper([])).toThrow();
    expect(() => buildProduct1bBootstrapHelper('page-system-status')).toThrow();
  });
});

describe('bootstrap event-loop liveness', () => {
  // Run in a BARE child process: vitest keeps its own event loop alive, which masks a premature
  // exit. When the console socket is not yet present the bootstrap retries, and during the gap
  // between destroying the failed socket and the retry firing there must remain a referenced
  // handle keeping the loop alive. If every timer is unref'd the process exits before the promise
  // settles, abandoning the caller mid-await and orphaning a running VM.
  it('keeps the event loop alive through the connect-retry gap until the promise settles', async () => {
    const script = `
import { bootstrapProduct1b } from ${JSON.stringify(BOOTSTRAP_SOURCE.href)};
let settled = false;
let outcome = 'none';
process.on('exit', () => {
  process.stdout.write('RESULT:' + JSON.stringify({ settled, outcome }));
});
bootstrapProduct1b({
  consolePath: '/nonexistent/opnsense-mcp-loop-liveness/console.sock',
  connectAttempts: 3,
  connectRetryDelayMs: 50,
  timeoutMs: 20000,
  overallTimeoutMs: 20000
}).then(
  () => { settled = true; outcome = 'resolved'; },
  (error) => { settled = true; outcome = 'rejected:' + (error && error.stage); }
);
`;
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        timeout: 30_000
      }
    );
    const marker = stdout.indexOf('RESULT:');
    expect(marker).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(stdout.slice(marker + 'RESULT:'.length));
    expect(parsed.settled).toBe(true);
    expect(parsed.outcome).toBe('rejected:connecting');
  });
});
