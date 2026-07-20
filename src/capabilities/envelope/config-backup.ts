// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  writeSync
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import type { BackupService } from '../types.js';

const BACKUP_ID_BYTES = 16;
const BACKUP_ID_PATTERN = /^[0-9a-f]{32}$/u;
const MAX_CONFIG_BACKUP_BYTES = 2 * 1024 * 1024;
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;

// The envelope's strict backup snapshots the running OPNsense configuration before the first write. It is
// fetched over the closed HTTPS client and stored with the same private-file discipline as the synthetic
// Product 2 backup (directory 0700, file 0600, no symlink, single hard link, checksum verified on write and
// re-read). The stored bytes and the backupId never cross the MCP boundary.
export interface ConfigBackupSource {
  downloadConfigBackup(signal: AbortSignal): Promise<Uint8Array>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function backupPath(rootDir: string, backupId: string): string {
  return join(rootDir, `${backupId}.xml`);
}

function readRegularPrivateFile(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600) {
      throw new Error('Backup file failed its integrity checks');
    }
    if (stats.size > MAX_CONFIG_BACKUP_BYTES) throw new Error('Backup file is too large');
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    if (offset !== buffer.length) throw new Error('Backup file was truncated');
    return buffer;
  } finally {
    closeSync(fd);
  }
}

export function createOPNsenseConfigBackupService(
  source: ConfigBackupSource,
  rootDir: string
): BackupService {
  return Object.freeze({
    async create(_scope: string, signal: AbortSignal): Promise<{ readonly backupId: string }> {
      const downloaded = await source.downloadConfigBackup(signal);
      if (downloaded.byteLength === 0 || downloaded.byteLength > MAX_CONFIG_BACKUP_BYTES) {
        throw new Error('Invalid OPNsense configuration backup');
      }
      const content = Buffer.from(downloaded);
      mkdirSync(rootDir, { recursive: true, mode: 0o700 });
      const backupId = randomBytes(BACKUP_ID_BYTES).toString('hex');
      const path = backupPath(rootDir, backupId);
      const fd = openSync(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600
      );
      try {
        let offset = 0;
        while (offset < content.length) {
          offset += writeSync(fd, content, offset, content.length - offset, offset);
        }
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (sha256(readRegularPrivateFile(path)) !== sha256(content)) {
        throw new Error('Backup verification failed');
      }
      return { backupId };
    },
    exists(backupId: string): Promise<boolean> {
      if (!BACKUP_ID_PATTERN.test(backupId)) return Promise.resolve(false);
      try {
        const fd = openSync(backupPath(rootDir, backupId), constants.O_RDONLY | NOFOLLOW);
        try {
          const stats = fstatSync(fd);
          return Promise.resolve(stats.isFile() && stats.nlink === 1);
        } finally {
          closeSync(fd);
        }
      } catch {
        return Promise.resolve(false);
      }
    }
  });
}
