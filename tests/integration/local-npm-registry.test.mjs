// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../../scripts/testing/private-fixture-root.mjs';
import {
  lockExpectedAbsentNames,
  lockProductionProjection,
  startLocalNpmRegistry
} from '../../scripts/testing/local-npm-registry.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let workRoot;
let registry;

beforeAll(async () => {
  workRoot = await createPrivateFixtureRoot('opnsense-registry-test');
  registry = await startLocalNpmRegistry({ repositoryRoot, workRoot });
}, 180_000);

afterAll(async () => {
  if (registry !== undefined) await registry.close();
  if (workRoot !== undefined) await removePrivateFixtureRoot(workRoot);
});

async function fetchJson(path) {
  const response = await fetch(new URL(path, registry.url));
  return { status: response.status, body: response.ok ? await response.json() : undefined };
}

describe('lock-derived loopback npm registry', () => {
  it('serves exactly the committed production projection', async () => {
    const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url)));
    const projection = [...lockProductionProjection(lock)].sort();

    expect(registry.packages.map(({ name, version }) => `${name}@${version}`).sort()).toEqual(
      projection
    );
    expect(registry.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
  });

  it('publishes a packument whose tarball matches the advertised integrity', async () => {
    const packument = await fetchJson('/zod');
    const locked = registry.packages.find(({ name }) => name === 'zod');
    const distribution = packument.body.versions[locked.version].dist;
    const tarball = Buffer.from(await (await fetch(distribution.tarball)).arrayBuffer());

    expect(packument.status).toBe(200);
    expect(distribution.tarball.startsWith(registry.url)).toBe(true);
    expect(`sha512-${createHash('sha512').update(tarball).digest('base64')}`).toBe(
      distribution.integrity
    );
    expect(distribution.integrity).toBe(locked.integrity);
    expect(tarball.byteLength).toBe(locked.tarballBytes);
  });

  it('encodes scoped names and preserves the locked dependency manifest', async () => {
    const encoded = await fetchJson('/@modelcontextprotocol%2Fsdk');
    const plain = await fetchJson('/@modelcontextprotocol/sdk');
    const locked = registry.packages.find(({ name }) => name === '@modelcontextprotocol/sdk');
    const installed = JSON.parse(
      await readFile(resolve(repositoryRoot, locked.installPath, 'package.json'), 'utf8')
    );

    expect(encoded.status).toBe(200);
    expect(plain.body).toEqual(encoded.body);
    expect(encoded.body.versions[locked.version].dependencies).toEqual(installed.dependencies);
  });

  it('refuses and records any request outside the locked projection', async () => {
    const before = registry.unknownRequests().length;
    const missing = await fetch(new URL('/left-pad', registry.url));

    expect(missing.status).toBe(404);
    expect(registry.unknownRequests().slice(before)).toEqual(['GET /left-pad']);
  });

  it('separates a deliberately absent optional peer from an unknown request', async () => {
    const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url)));
    const expectedAbsent = [...lockExpectedAbsentNames(lock)];
    const unknownBefore = registry.unknownRequests().length;
    const absentBefore = registry.absentRequests().length;

    expect(expectedAbsent).toEqual(['@cfworker/json-schema']);
    expect([...registry.expectedAbsentNames]).toEqual(expectedAbsent);

    const optionalPeer = await fetch(new URL('/@cfworker%2Fjson-schema', registry.url));

    expect(optionalPeer.status).toBe(404);
    expect(registry.absentRequests().slice(absentBefore)).toEqual(['GET /@cfworker/json-schema']);
    expect(registry.unknownRequests().length).toBe(unknownBefore);
  });

  it('fails closed when a required peer dependency is absent from the lock', () => {
    expect(() =>
      lockExpectedAbsentNames({
        packages: {
          '': {},
          'node_modules/example': {
            version: '1.0.0',
            peerDependencies: { 'missing-required': '^1' }
          }
        }
      })
    ).toThrow(/^Required peer dependency missing-required is absent from the lock/u);
  });

  it('removes every tarball and staging path on close', async () => {
    const local = await createPrivateFixtureRoot('opnsense-registry-close');
    const disposable = await startLocalNpmRegistry({ repositoryRoot, workRoot: local });
    await disposable.close();

    await expect(access(`${local}/tarballs`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${local}/stage`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fetch(disposable.url)).rejects.toThrow();
    await removePrivateFixtureRoot(local);
  }, 180_000);
});
