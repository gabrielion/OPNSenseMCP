// SPDX-License-Identifier: AGPL-3.0-or-later
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import * as product1b from '../../scripts/vm/product1b.mjs';

const { runVmBootstrapCli } = product1b;

function captureStream() {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  return { stream, output: () => output };
}

describe('Product 1B bootstrap CLI', () => {
  it('offers no operator secret prompt at all', () => {
    expect(product1b).not.toHaveProperty('readSecretLine');
  });

  // Mirrors the owned start: the console consumer runs between launch and readiness.
  function fakeStartVm(order = []) {
    return vi.fn(async ({ instanceRoot, bootstrapConsole }) => {
      order.push('start');
      await bootstrapConsole?.({ consolePath: `${instanceRoot}/console.sock` });
      return { state: 'running', api: { host: '127.0.0.1', port: 18443 } };
    });
  }

  it('starts its own VM, attaches the console during the start, and exposes nothing private', async () => {
    const instanceRoot = '/private/product1b-fixture';
    const credentials = {
      key: 'K'.repeat(80),
      secret: 'S'.repeat(80),
      serverName: 'OPNsense.internal'
    };
    const stdout = captureStream();
    const stderr = captureStream();
    const order = [];
    const statusVm = vi.fn(async () => ({ state: 'stopped', cleaned: false }));
    const startVm = fakeStartVm(order);
    const bootstrap = vi.fn(async () => {
      order.push('bootstrap');
      return credentials;
    });
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
        startVm,
        bootstrap,
        createArtifacts
      })
    ).resolves.toBe(0);

    expect(statusVm).toHaveBeenCalledWith({ instanceRoot });
    expect(startVm).toHaveBeenCalledWith({
      instanceRoot,
      bootstrapConsole: expect.any(Function)
    });
    expect(order).toEqual(['start', 'bootstrap']);
    expect(bootstrap).toHaveBeenCalledWith({
      consolePath: `${instanceRoot}/console.sock`
    });
    expect(createArtifacts).toHaveBeenCalledWith({ instanceRoot, credentials });
    expect(stdout.output()).toBe('Product 1B bootstrap: READY; private connection created\n');
    expect(stderr.output()).toBe('');
    expect(`${stdout.output()}${stderr.output()}`).not.toContain('SENTINEL');
    expect(`${stdout.output()}${stderr.output()}`).not.toContain(instanceRoot);
    expect(`${stdout.output()}${stderr.output()}`).not.toContain(credentials.key);
    expect(`${stdout.output()}${stderr.output()}`).not.toContain(credentials.secret);
  });

  it('refuses to touch a managed VM that is already running', async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const startVm = vi.fn();
    const bootstrap = vi.fn();

    await expect(
      runVmBootstrapCli({
        instanceRoot: '/private/SENTINEL-path',
        stdout: stdout.stream,
        stderr: stderr.stream,
        statusVm: async () => ({ state: 'running', api: { host: '127.0.0.1', port: 18443 } }),
        startVm,
        bootstrap,
        createArtifacts: vi.fn()
      })
    ).resolves.toBe(2);

    expect(startVm).not.toHaveBeenCalled();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(stdout.output()).toBe('');
    expect(stderr.output()).toBe(
      'Product 1B bootstrap: FAILED; stop the managed disposable VM and retry\n'
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
        statusVm: async () => ({ state: 'stopped', cleaned: false }),
        startVm: fakeStartVm(),
        stopVm,
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
        statusVm: async () => ({ state: 'stopped', cleaned: false }),
        startVm: fakeStartVm(),
        stopVm,
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
