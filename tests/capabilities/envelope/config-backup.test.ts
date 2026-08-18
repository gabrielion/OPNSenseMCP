// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOPNsenseConfigBackupService } from '../../../src/capabilities/envelope/config-backup.js';
import type { BackupRequest } from '../../../src/capabilities/types.js';

const signal = new AbortController().signal;
const CONFIG_XML =
  '<?xml version="1.0"?><opnsense><system><hostname>lab</hostname></system></opnsense>';
// The envelope's request as the kernel builds it. Every field of it is persisted beside the
// configuration bytes, so a later reader can say which transaction the snapshot belongs to without
// re-reading — or ever holding — the configuration itself.
const REQUEST: BackupRequest = Object.freeze({
  targetKey: 'opnsense-config',
  capabilityId: 'opnsense.create',
  mcpName: 'opn_create',
  argumentsSha256: 'a'.repeat(64),
  effectiveResourceScopes: Object.freeze(['firewall.alias']),
  observedStateDigest: 'b'.repeat(64),
  effectPlanDigest: 'c'.repeat(64),
  transactionId: 'd'.repeat(32)
});
// The whole of the stored metadata: safe ids, digests and lengths. The exact-key assertion below is
// what keeps configuration bytes, credentials and raw arguments out of the file for good.
const METADATA_KEYS = [
  'schemaVersion',
  'transactionId',
  'backupId',
  'targetKey',
  'capabilityId',
  'mcpName',
  'argumentsSha256',
  'effectiveResourceScopes',
  'observedStateDigest',
  'effectPlanDigest',
  'byteLength',
  'xmlSha256',
  'createdAt'
];

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

function readMetadata(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
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
    // Nothing but the published backup: the staging directory the write went through is renamed
    // into place, never left behind.
    expect(readdirSync(store)).toEqual([created.backupId]);
    const backupDir = join(store, created.backupId);
    const directory = lstatSync(backupDir);
    expect(directory.isDirectory()).toBe(true);
    expect(directory.mode & 0o777).toBe(0o700);
    expect(readdirSync(backupDir).sort()).toEqual(['config.xml', 'metadata.json']);
    for (const name of ['config.xml', 'metadata.json']) {
      const entry = lstatSync(join(backupDir, name));
      expect(entry.isFile()).toBe(true);
      expect(entry.isSymbolicLink()).toBe(false);
      expect(entry.mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(join(backupDir, 'config.xml'), 'utf8')).toBe(CONFIG_XML);

    const metadata = readMetadata(join(backupDir, 'metadata.json'));
    expect(Object.keys(metadata).sort()).toEqual([...METADATA_KEYS].sort());
    expect(metadata.schemaVersion).toBe(1);
    expect(metadata.backupId).toBe(created.backupId);
    expect(metadata.transactionId).toBe(REQUEST.transactionId);
    expect(metadata.byteLength).toBe(CONFIG_XML.length);
    expect(metadata.xmlSha256).toBe(createHash('sha256').update(CONFIG_XML).digest('hex'));
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

  // The one failure that lands AFTER the rename, reached without a seam: every step up to and
  // including the rename needs only write and execute on the store, and the closing fsync needs
  // read, so a write-only store fails exactly once the snapshot is already published. A `create`
  // that reports failure must not leave that snapshot behind — the kernel refuses the write on
  // BACKUP_FAILED, and nothing would ever claim the orphan. The message is checked too: an fs
  // errno would carry the private store path, and this module's contract is that it never does.
  it('leaves no published backup behind when the store cannot be made durable', async () => {
    const store = join(root, 'store');
    mkdirSync(store, { recursive: true, mode: 0o700 });
    const service = createOPNsenseConfigBackupService(source(), store);
    let message = '';
    try {
      chmodSync(store, 0o300);
      await service.create(REQUEST, signal);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    } finally {
      chmodSync(store, 0o700);
    }

    expect(message).toBe('Backup publication failed');
    expect(message).not.toMatch(/\//u);
    expect(readdirSync(store)).toEqual([]);
  });

  // Retention maintenance is part of this step, and it is the first thing in it: the store lives at
  // `<targetDir>/backups`, so a target whose durable state cannot be bounded refuses the mutation
  // before the configuration is even fetched — which is what makes it a refusal before the first
  // firewall write. The planted metadata is unreadable, so the refusal can only come from there,
  // and the message is checked because a leaked fs errno would carry the private store path.
  it('refuses before the download when retention cannot be maintained', async () => {
    const store = join(root, 'backups');
    const planted = join(store, 'a'.repeat(32));
    mkdirSync(planted, { recursive: true, mode: 0o700 });
    writeFileSync(join(planted, 'metadata.json'), 'not json at all', { mode: 0o600 });
    const downloads = source();
    const service = createOPNsenseConfigBackupService(downloads, store);

    let message = '';
    try {
      await service.create(REQUEST, signal);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Durable state failed its retention checks');
    expect(message).not.toMatch(/\//u);
    expect(downloads.downloadConfigBackup).not.toHaveBeenCalled();
    expect(readdirSync(store)).toEqual(['a'.repeat(32)]);
  });

  // The planted backup is complete and self-consistent — its metadata names the planted id and
  // describes the very bytes the link points at — so the symlink is the only fault left, and a
  // service that followed it would answer `true`.
  it('refuses to read a symlinked backup path as valid', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const linkId = 'f'.repeat(32);
    const planted = join(store, linkId);
    mkdirSync(planted, { mode: 0o700 });
    const metadata = readMetadata(join(store, created.backupId, 'metadata.json'));
    writeFileSync(
      join(planted, 'metadata.json'),
      JSON.stringify({ ...metadata, backupId: linkId }),
      {
        mode: 0o600
      }
    );
    symlinkSync(join(store, created.backupId, 'config.xml'), join(planted, 'config.xml'));

    expect(await service.exists(linkId, signal)).toBe(false);
  });

  // A second hard link is how a same-uid attacker keeps a handle on the snapshot after the
  // envelope believes it owns the only one, so the link count is part of the discipline and not
  // an implementation detail. The link is planted outside the store so nothing but `nlink` moves.
  it('refuses a stored backup that was given a second hard link', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    linkSync(join(store, created.backupId, 'config.xml'), join(root, 'second-link.xml'));
    expect(await service.exists(created.backupId, signal)).toBe(false);
  });

  // The three legs the write-path verification alone could never carry: `create` re-reads exactly
  // what it just wrote, so every edit made after that moment used to be invisible. They are checks
  // of `exists`, and they hold only because the length, the digest and the mode are persisted
  // beside the bytes and revalidated on every call.
  it('rejects a stored backup truncated after the write verification', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const path = join(store, created.backupId, 'config.xml');
    truncateSync(path, statSync(path).size - 1);

    expect(readFileSync(path, 'utf8')).not.toBe(CONFIG_XML);
    expect(await service.exists(created.backupId, signal)).toBe(false);
  });

  it('rejects a byte flipped in a stored backup after the write verification', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const path = join(store, created.backupId, 'config.xml');
    const bytes = readFileSync(path);
    bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
    writeFileSync(path, bytes);

    expect(readFileSync(path).byteLength).toBe(CONFIG_XML.length);
    expect(readFileSync(path, 'utf8')).not.toBe(CONFIG_XML);
    expect(await service.exists(created.backupId, signal)).toBe(false);
  });

  it('rejects a stored backup whose mode was widened after the write', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    chmodSync(join(store, created.backupId, 'config.xml'), 0o644);

    expect(await service.exists(created.backupId, signal)).toBe(false);
  });

  // The directory answers for itself: its mode is what governs who may replace an entry inside it,
  // so a widened backup directory is the same class of fault as a widened file and not a detail of
  // how the files happen to be reached.
  it('rejects a stored backup whose directory mode was widened after the write', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    chmodSync(join(store, created.backupId), 0o755);

    expect(await service.exists(created.backupId, signal)).toBe(false);
  });

  // A copy is intact in every respect a stat or a checksum can see — same bytes, same digest, same
  // modes, one link each — so the only thing that separates it from the original is the id its
  // metadata names. Without that binding a snapshot could be presented as the snapshot of another
  // transaction, which is precisely the confusion an audit trail exists to prevent.
  it('refuses a published backup copied under a different id', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const copyId = 'e'.repeat(32);
    const copy = join(store, copyId);
    mkdirSync(copy, { mode: 0o700 });
    for (const name of ['config.xml', 'metadata.json']) {
      writeFileSync(join(copy, name), readFileSync(join(store, created.backupId, name)), {
        mode: 0o600
      });
    }

    expect(await service.exists(created.backupId, signal)).toBe(true);
    expect(await service.exists(copyId, signal)).toBe(false);
  });

  // The read side rejects an unexpected field for the same reason the audit ring does: a file that
  // is allowed to carry one more key than its shape names is a file that can be made to carry
  // configuration bytes. The mode is asserted unchanged so the refusal can only be the shape.
  it('rejects stored metadata that carries a field outside the fixed shape', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create(REQUEST, signal);
    const path = join(store, created.backupId, 'metadata.json');
    writeFileSync(path, JSON.stringify({ ...readMetadata(path), note: 'smuggled' }));

    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(await service.exists(created.backupId, signal)).toBe(false);
  });
});
