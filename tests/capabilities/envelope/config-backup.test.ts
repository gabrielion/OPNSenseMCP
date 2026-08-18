// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOPNsenseConfigBackupService } from '../../../src/capabilities/envelope/config-backup.js';
import type { BackupRequest } from '../../../src/capabilities/types.js';

const signal = new AbortController().signal;
const CONFIG_XML =
  '<?xml version="1.0"?><opnsense><system><hostname>lab</hostname></system></opnsense>';
// The envelope's request as the kernel builds it. This store keeps the configuration bytes and
// nothing else, so every field beyond the target key is deliberately inert here.
const REQUEST: BackupRequest = Object.freeze({
  targetKey: 'opnsense-config',
  capabilityId: 'opnsense.create',
  mcpName: 'opn_create',
  argumentsSha256: 'a'.repeat(64),
  effectiveResourceScopes: Object.freeze(['firewall.alias']),
  observedStateDigest: 'b'.repeat(64),
  effectPlanDigest: 'c'.repeat(64)
});

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opnsense-config-backup-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function source(bytes: string = CONFIG_XML) {
  return { downloadConfigBackup: vi.fn().mockResolvedValue(new TextEncoder().encode(bytes)) };
}

describe('OPNsense configuration backup service', () => {
  it('downloads and stores the configuration privately and verifiably', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);

    expect(created.backupId).toMatch(/^[0-9a-f]{32}$/u);
    expect(Object.keys(created)).toEqual(['backupId']);
    expect(await service.exists(created.backupId, signal)).toBe(true);
    expect(lstatSync(store).mode & 0o777).toBe(0o700);
    const files = readdirSync(store);
    expect(files).toHaveLength(1);
    const [fileName = ''] = files;
    const file = lstatSync(join(store, fileName));
    expect(file.isFile()).toBe(true);
    expect(file.isSymbolicLink()).toBe(false);
    expect(file.mode & 0o777).toBe(0o600);
    expect(readFileSync(join(store, fileName), 'utf8')).toBe(CONFIG_XML);
  });

  it('reports a missing or malformed backup id as absent', async () => {
    const service = createOPNsenseConfigBackupService(source(), join(root, 'store'));
    await service.create(REQUEST, signal);
    expect(await service.exists('0'.repeat(32), signal)).toBe(false);
    expect(await service.exists('not-a-valid-id', signal)).toBe(false);
  });

  it('rejects when the source download fails', async () => {
    const failing = { downloadConfigBackup: vi.fn().mockRejectedValue(new Error('upstream')) };
    const service = createOPNsenseConfigBackupService(failing, join(root, 'store'));
    await expect(service.create(REQUEST, signal)).rejects.toThrow();
  });

  it('rejects an empty configuration payload', async () => {
    const empty = { downloadConfigBackup: vi.fn().mockResolvedValue(new Uint8Array()) };
    const service = createOPNsenseConfigBackupService(empty, join(root, 'store'));
    await expect(service.create(REQUEST, signal)).rejects.toThrow();
  });

  it('refuses to read a symlinked backup path as valid', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const realFile = join(store, `${created.backupId}.xml`);
    const linkId = 'f'.repeat(32);
    symlinkSync(realFile, join(store, `${linkId}.xml`));
    expect(await service.exists(linkId, signal)).toBe(false);
  });

  // A second hard link is how a same-uid attacker keeps a handle on the snapshot after the
  // envelope believes it owns the only one, so the link count is part of the discipline and not
  // an implementation detail. The link is planted outside the store so nothing but `nlink` moves.
  it('refuses a stored backup that was given a second hard link', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    linkSync(join(store, `${created.backupId}.xml`), join(root, 'second-link.xml'));
    expect(await service.exists(created.backupId, signal)).toBe(false);
  });

  // The other two legs of the discipline — truncation and a flipped byte — are checked only on the
  // write path, where `create` re-reads exactly what it just wrote (config-backup.ts:53 and :95).
  // `exists` stats without reading, and `create` persists neither the length nor the digest, so an
  // edit made after that verification is invisible to every later caller. Asserting the discipline
  // the way it deserves needs a stored digest, i.e. a change to the module this slice froze, so it
  // rides with the durable backup root. Until then these two record what the module actually
  // promises — and they go red the first time it promises more, which is the point of writing them.
  it('does not notice a stored backup truncated after the write verification', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const path = join(store, `${created.backupId}.xml`);
    truncateSync(path, statSync(path).size - 1);

    expect(readFileSync(path, 'utf8')).not.toBe(CONFIG_XML);
    expect(await service.exists(created.backupId, signal)).toBe(true);
  });

  it('does not notice a byte flipped in a stored backup after the write verification', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const path = join(store, `${created.backupId}.xml`);
    const bytes = readFileSync(path);
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
    writeFileSync(path, bytes);

    expect(readFileSync(path).byteLength).toBe(CONFIG_XML.length);
    expect(readFileSync(path, 'utf8')).not.toBe(CONFIG_XML);
    expect(await service.exists(created.backupId, signal)).toBe(true);
  });
});
