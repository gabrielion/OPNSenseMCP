// SPDX-License-Identifier: AGPL-3.0-or-later
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { readSecretLine, runVmBootstrapCli } from '../../scripts/vm/product1b.mjs';

function captureStream() {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  return { stream, output: () => output };
}

describe('Product 1B bootstrap CLI', () => {
  it('reads one bounded password from non-interactive stdin without reflecting it', async () => {
    const input = new PassThrough();
    const output = captureStream();
    input.end('SENTINEL_FACTORY_PASSWORD\n');

    await expect(readSecretLine({ input, output: output.stream })).resolves.toBe(
      'SENTINEL_FACTORY_PASSWORD'
    );
    expect(output.output()).toBe('OPNsense factory password: ');
    expect(output.output()).not.toContain('SENTINEL');
  });

  it('cancels a pending password read and removes every input listener', async () => {
    const input = new PassThrough();
    const output = captureStream();
    const controller = new AbortController();
    const password = readSecretLine({ input, output: output.stream, signal: controller.signal });

    expect(input.listenerCount('data')).toBe(1);
    controller.abort();
    const listenersAfterAbort = {
      data: input.listenerCount('data'),
      end: input.listenerCount('end'),
      error: input.listenerCount('error')
    };
    input.end('SENTINEL_FACTORY_PASSWORD\n');

    await expect(password).rejects.toThrow('Invalid secret input');
    expect(listenersAfterAbort).toEqual({ data: 0, end: 0, error: 0 });
    expect(output.output()).not.toContain('SENTINEL');
  });

  it('bootstraps the running disposable VM and exposes no credential or private path', async () => {
    const instanceRoot = '/private/product1b-fixture';
    const password = 'SENTINEL_FACTORY_PASSWORD';
    const credentials = {
      key: 'K'.repeat(80),
      secret: 'S'.repeat(80),
      serverName: 'OPNsense.internal'
    };
    const stdout = captureStream();
    const stderr = captureStream();
    const statusVm = vi.fn(async () => ({
      state: 'running',
      api: { host: '127.0.0.1', port: 18443 }
    }));
    const readPassword = vi.fn(async () => password);
    const bootstrap = vi.fn(async () => credentials);
    const createArtifacts = vi.fn(async () => ({
      configPath: `${instanceRoot}/connection.json`,
      caPath: `${instanceRoot}/ca.pem`
    }));

    await expect(
      runVmBootstrapCli({
        instanceRoot,
        stdout: stdout.stream,
        stderr: stderr.stream,
        statusVm,
        readPassword,
        bootstrap,
        createArtifacts
      })
    ).resolves.toBe(0);

    expect(statusVm).toHaveBeenCalledWith({ instanceRoot });
    expect(bootstrap).toHaveBeenCalledWith({
      consolePath: `${instanceRoot}/console.sock`,
      factoryPassword: password
    });
    expect(createArtifacts).toHaveBeenCalledWith({ instanceRoot, credentials });
    expect(stdout.output()).toBe('Product 1B bootstrap: READY; private connection created\n');
    expect(stderr.output()).toBe('');
    expect(`${stdout.output()}${stderr.output()}`).not.toContain('SENTINEL');
    expect(`${stdout.output()}${stderr.output()}`).not.toContain(instanceRoot);
    expect(`${stdout.output()}${stderr.output()}`).not.toContain(credentials.key);
    expect(`${stdout.output()}${stderr.output()}`).not.toContain(credentials.secret);
  });

  it('fails safely before serial access when the disposable VM is not running', async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const readPassword = vi.fn();
    const bootstrap = vi.fn();

    await expect(
      runVmBootstrapCli({
        instanceRoot: '/private/SENTINEL-path',
        stdout: stdout.stream,
        stderr: stderr.stream,
        statusVm: async () => ({ state: 'stopped', cleaned: false }),
        readPassword,
        bootstrap,
        createArtifacts: vi.fn()
      })
    ).resolves.toBe(2);

    expect(readPassword).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(stdout.output()).toBe('');
    expect(stderr.output()).toBe(
      'Product 1B bootstrap: FAILED; start a fresh disposable VM and retry\n'
    );
    expect(stderr.output()).not.toContain('SENTINEL');
  });

  it('reports only the safe failed stage and discards a partially bootstrapped VM', async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const stopVm = vi.fn(async () => ({ state: 'stopped', cleaned: true }));
    const failure = new Error('SENTINEL_TRANSCRIPT');
    failure.stage = 'heredoc-lines';

    await expect(
      runVmBootstrapCli({
        instanceRoot: '/private/SENTINEL-path',
        stdout: stdout.stream,
        stderr: stderr.stream,
        statusVm: async () => ({
          state: 'running',
          api: { host: '127.0.0.1', port: 18443 }
        }),
        stopVm,
        readPassword: async () => 'SENTINEL_PASSWORD',
        bootstrap: async () => {
          throw failure;
        },
        createArtifacts: vi.fn()
      })
    ).resolves.toBe(2);

    expect(stopVm).toHaveBeenCalledWith({ instanceRoot: '/private/SENTINEL-path' });
    expect(stdout.output()).toBe('');
    expect(stderr.output()).toBe(
      'Product 1B bootstrap: FAILED during heredoc-lines; fresh VM discarded\n'
    );
    expect(stderr.output()).not.toContain('SENTINEL');
  });

  it.each([
    ['stop rejects', async () => Promise.reject(new Error('SENTINEL_STOP_FAILURE'))],
    ['stop is indeterminate', async () => ({ state: 'running', cleaned: false })]
  ])('never claims cleanup when %s', async (_case, stopVm) => {
    const stdout = captureStream();
    const stderr = captureStream();

    await expect(
      runVmBootstrapCli({
        instanceRoot: '/private/SENTINEL-path',
        stdout: stdout.stream,
        stderr: stderr.stream,
        statusVm: async () => ({
          state: 'running',
          api: { host: '127.0.0.1', port: 18443 }
        }),
        stopVm,
        readPassword: async () => 'SENTINEL_PASSWORD',
        bootstrap: async () => {
          throw new Error('SENTINEL_BOOTSTRAP_FAILURE');
        },
        createArtifacts: vi.fn()
      })
    ).resolves.toBe(2);

    expect(stdout.output()).toBe('');
    expect(stderr.output()).toBe(
      'Product 1B bootstrap: FAILED during bootstrap; cleanup unconfirmed; run npm run vm:stop\n'
    );
    expect(stderr.output()).not.toContain('SENTINEL');
  });
});
