// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PRODUCT1B_BOOTSTRAP_FRAME_BEGIN,
  PRODUCT1B_BOOTSTRAP_FRAME_END,
  PRODUCT1B_BOOTSTRAP_HELPER,
  bootstrapProduct1b
} from '../../scripts/vm/product1b-bootstrap.mjs';

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

async function receiveUploadedHelper(socket) {
  const encodedLines = Buffer.from(PRODUCT1B_BOOTSTRAP_HELPER, 'utf8')
    .toString('base64')
    .match(/.{1,76}/gu);
  if (encodedLines === null) throw new Error('fixture helper encoding failed');
  const transcript = [];
  transcript.push(await readUntil(socket, (input) => input.endsWith('\n'), 128));
  socket.write('root@OPNsense:~ # ');
  transcript.push(await readUntil(socket, (input) => input.endsWith('\n'), 128));
  socket.write('? ');
  for (const line of encodedLines) {
    const uploadedLine = await readUntil(socket, (input) => input.endsWith('\n'), 128);
    if (uploadedLine !== `${line}\n`) throw new Error('fixture helper upload mismatch');
    transcript.push(uploadedLine);
    socket.write('? ');
  }
  transcript.push(await readUntil(socket, (input) => input.endsWith('\n'), 128));
  socket.write('root@OPNsense:~ # ');
  transcript.push(await readUntil(socket, (input) => input.endsWith('\n'), 256));
  socket.write('root@OPNsense:~ # ');
  transcript.push(await readUntil(socket, (input) => input.endsWith('\n'), 128));
  return transcript.join('');
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

  it('logs in through the serial console, uploads the fixed helper, and returns only validated credentials', async () => {
    const socketPath = await temporarySocketPath();
    const factoryPassword = 'SENTINEL_FACTORY_PASSWORD';
    const result = {
      key: 'K'.repeat(80),
      secret: 'S'.repeat(80),
      serverName: 'OPNsense.internal'
    };
    const observed = {};
    const server = createServer(async (socket) => {
      try {
        observed.wake = await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('\r\nOPNsense.localdomain login:');
        observed.user = await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('Password:');
        observed.password = await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('\r\n*** OPNsense.localdomain: OPNsense 26.1.6 ***\r\nEnter an option:');
        observed.menu = await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('\r\nroot@OPNsense:~ # ');
        observed.upload = await receiveUploadedHelper(socket);
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
      bootstrapProduct1b({ consolePath: socketPath, factoryPassword, timeoutMs: 2_000 })
    ).resolves.toEqual(result);

    expect(observed.wake).toBe('\n');
    expect(observed.user).toBe('root\n');
    expect(observed.password).toBe(`${factoryPassword}\n`);
    expect(observed.menu).toBe('8\n');
    expect(observed.upload).not.toContain(factoryPassword);
    expect(observed.upload).not.toContain(result.key);
    expect(observed.upload).not.toContain(result.secret);
    const encodedHelper = observed.upload.match(
      /__OPNSENSE_MCP_HELPER_EOF__\n([A-Za-z0-9+/=\n]+)\n__OPNSENSE_MCP_HELPER_EOF__/u
    )?.[1];
    expect(observed.upload).not.toContain("<<'__OPNSENSE_MCP_HELPER_EOF__'");
    expect(encodedHelper).toBeDefined();
    expect(Buffer.from(encodedHelper.replaceAll('\n', ''), 'base64').toString('utf8')).toBe(
      PRODUCT1B_BOOTSTRAP_HELPER
    );

    await new Promise((resolve) => server.close(resolve));
  });

  it('returns one fixed safe failure without exposing the password, result, or serial transcript', async () => {
    const socketPath = await temporarySocketPath();
    const factoryPassword = 'SENTINEL_PASSWORD_MUST_NOT_LEAK';
    const leakedResult = 'SENTINEL_RESULT_MUST_NOT_LEAK';
    const leakedTranscript = 'SENTINEL_TRANSCRIPT_MUST_NOT_LEAK';
    const server = createServer(async (socket) => {
      try {
        await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('OPNsense login:');
        await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('Password:');
        await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('Enter an option:');
        await readUntil(socket, (input) => input.endsWith('\n'));
        socket.write('root@OPNsense:~ # ');
        await receiveUploadedHelper(socket);
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
      await bootstrapProduct1b({ consolePath: socketPath, factoryPassword, timeoutMs: 2_000 });
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
    expect(visibleFailure).not.toContain(factoryPassword);
    expect(visibleFailure).not.toContain(leakedResult);
    expect(visibleFailure).not.toContain(leakedTranscript);

    await new Promise((resolve) => server.close(resolve));
  });
});
