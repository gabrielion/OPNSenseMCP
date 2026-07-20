// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtemp, lstat, mkdir, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Product1bConnectionError,
  createConnectionArtifacts,
  removeConnectionArtifacts
} from '../../scripts/vm/product1b-connection.mjs';

const roots = [];

async function privateInstanceRoot() {
  const root = await mkdtemp(join(tmpdir(), 'opnsense-product1b-connection-'));
  roots.push(root);
  const instanceRoot = join(root, 'instance');
  await mkdir(instanceRoot, { mode: 0o700 });
  return instanceRoot;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const CREDENTIALS = Object.freeze({
  key: 'LAB-API-KEY',
  secret: 'LAB-API-SECRET',
  serverName: 'OPNsense.internal'
});

describe('Product 1B private connection artifacts', () => {
  it('atomically writes a pinned CA and strict private connection file', async () => {
    const instanceRoot = await privateInstanceRoot();
    const captureCertificate = vi.fn(async () => Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]));

    const result = await createConnectionArtifacts({
      instanceRoot,
      credentials: CREDENTIALS,
      captureCertificate
    });

    expect(captureCertificate).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 18443,
      serverName: 'OPNsense.internal'
    });
    expect(result).toEqual({
      configPath: join(instanceRoot, 'connection.json'),
      caPath: join(instanceRoot, 'ca.pem')
    });
    const config = JSON.parse(await readFile(result.configPath, 'utf8'));
    expect(config).toEqual({
      url: 'https://127.0.0.1:18443',
      apiKey: 'LAB-API-KEY',
      apiSecret: 'LAB-API-SECRET',
      caFile: join(instanceRoot, 'ca.pem'),
      tlsServerName: 'OPNsense.internal',
      timeoutMs: 120_000
    });
    expect(await readFile(result.caPath, 'utf8')).toMatch(
      /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n$/u
    );
    expect((await lstat(result.configPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(result.caPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(instanceRoot)).toEqual(['ca.pem', 'connection.json']);
  });

  it.each([
    { key: '', secret: 'LAB-API-SECRET', serverName: 'OPNsense.internal' },
    { key: 'LAB-API-KEY', secret: '', serverName: 'OPNsense.internal' },
    { key: 'LAB-API-KEY', secret: 'LAB-API-SECRET', serverName: '127.0.0.1' },
    { key: 'LAB-API-KEY', secret: 'LAB-API-SECRET', serverName: 'bad/name' }
  ])('rejects unsafe bootstrap output before certificate capture', async (credentials) => {
    const instanceRoot = await privateInstanceRoot();
    const captureCertificate = vi.fn();

    await expect(
      createConnectionArtifacts({ instanceRoot, credentials, captureCertificate })
    ).rejects.toMatchObject({
      name: 'Product1bConnectionError',
      code: 'CONNECTION_INVALID'
    });
    expect(captureCertificate).not.toHaveBeenCalled();
    expect(await readdir(instanceRoot)).toEqual([]);
  });

  it('rolls back its own partial artifact without replacing an existing entry', async () => {
    const instanceRoot = await privateInstanceRoot();
    await symlink('/private/nonexistent-sentinel', join(instanceRoot, 'connection.json'));

    await expect(
      createConnectionArtifacts({
        instanceRoot,
        credentials: CREDENTIALS,
        captureCertificate: async () => Buffer.from([0x30, 0x00])
      })
    ).rejects.toMatchObject({
      name: 'Product1bConnectionError',
      code: 'CONNECTION_EXISTS'
    });
    expect((await lstat(join(instanceRoot, 'connection.json'))).isSymbolicLink()).toBe(true);
    expect(await readdir(instanceRoot)).toEqual(['connection.json']);
  });

  it('uses fixed errors and removes only its two owned final artifacts', async () => {
    const instanceRoot = await privateInstanceRoot();
    const sentinel = `${CREDENTIALS.key}:${CREDENTIALS.secret}`;
    let caught;
    try {
      await createConnectionArtifacts({
        instanceRoot,
        credentials: CREDENTIALS,
        captureCertificate: async () => {
          throw new Error(sentinel);
        }
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Product1bConnectionError);
    expect(caught.code).toBe('CONNECTION_CERTIFICATE_FAILED');
    expect(String(caught)).not.toContain(sentinel);

    await createConnectionArtifacts({
      instanceRoot,
      credentials: CREDENTIALS,
      captureCertificate: async () => Buffer.from([0x30, 0x00])
    });
    await mkdir(join(instanceRoot, 'unrelated'));
    await removeConnectionArtifacts(instanceRoot);
    expect(await readdir(instanceRoot)).toEqual(['unrelated']);
  });
});
