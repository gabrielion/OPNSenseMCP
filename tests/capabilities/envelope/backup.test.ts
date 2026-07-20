// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstatSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalBackupService } from '../../../src/capabilities/envelope/backup.js';

const signal = new AbortController().signal;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opnsense-backup-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('local backup service', () => {
  it('creates a private, verifiable backup and reports it exists', async () => {
    const service = createLocalBackupService(join(root, 'store'));
    const created = await service.create('opnsense-config', signal);
    expect(created.backupId).toMatch(/^[0-9a-f]{32}$/u);
    expect(Object.keys(created)).toEqual(['backupId']);
    expect(await service.exists(created.backupId)).toBe(true);

    const storeDir = join(root, 'store');
    expect(lstatSync(storeDir).mode & 0o777).toBe(0o700);
    const files = readdirSync(storeDir);
    expect(files).toHaveLength(1);
    const [fileName = ''] = files;
    const file = lstatSync(join(storeDir, fileName));
    expect(file.isFile()).toBe(true);
    expect(file.isSymbolicLink()).toBe(false);
    expect(file.mode & 0o777).toBe(0o600);
  });

  it('reports a missing or malformed backup id as absent', async () => {
    const service = createLocalBackupService(join(root, 'store'));
    await service.create('opnsense-config', signal);
    expect(await service.exists('0'.repeat(32))).toBe(false);
    expect(await service.exists('not-a-valid-id')).toBe(false);
  });

  it('refuses to read a symlinked backup path as valid', async () => {
    const store = join(root, 'store');
    const service = createLocalBackupService(store);
    const created = await service.create('opnsense-config', signal);
    const realFile = join(store, `${created.backupId}.bak`);
    const linkId = 'f'.repeat(32);
    symlinkSync(realFile, join(store, `${linkId}.bak`));
    expect(await service.exists(linkId)).toBe(false);
  });
});
