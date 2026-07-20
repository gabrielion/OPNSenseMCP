// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOPNsenseConfigBackupService } from '../../../src/capabilities/envelope/config-backup.js';

const signal = new AbortController().signal;
const CONFIG_XML =
  '<?xml version="1.0"?><opnsense><system><hostname>lab</hostname></system></opnsense>';

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
    const created = await service.create('opnsense-config', signal);

    expect(created.backupId).toMatch(/^[0-9a-f]{32}$/u);
    expect(Object.keys(created)).toEqual(['backupId']);
    expect(await service.exists(created.backupId)).toBe(true);
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
    await service.create('opnsense-config', signal);
    expect(await service.exists('0'.repeat(32))).toBe(false);
    expect(await service.exists('not-a-valid-id')).toBe(false);
  });

  it('rejects when the source download fails', async () => {
    const failing = { downloadConfigBackup: vi.fn().mockRejectedValue(new Error('upstream')) };
    const service = createOPNsenseConfigBackupService(failing, join(root, 'store'));
    await expect(service.create('opnsense-config', signal)).rejects.toThrow();
  });

  it('rejects an empty configuration payload', async () => {
    const empty = { downloadConfigBackup: vi.fn().mockResolvedValue(new Uint8Array()) };
    const service = createOPNsenseConfigBackupService(empty, join(root, 'store'));
    await expect(service.create('opnsense-config', signal)).rejects.toThrow();
  });

  it('refuses to read a symlinked backup path as valid', async () => {
    const store = join(root, 'store');
    const service = createOPNsenseConfigBackupService(source(), store);
    const created = await service.create('opnsense-config', signal);
    const realFile = join(store, `${created.backupId}.xml`);
    const linkId = 'f'.repeat(32);
    symlinkSync(realFile, join(store, `${linkId}.xml`));
    expect(await service.exists(linkId)).toBe(false);
  });
});
