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
import type { BackupService } from '../types.js';

const BACKUP_ID_BYTES = 16;
const BACKUP_ID_PATTERN = /^[0-9a-f]{32}$/u;
const MAX_BACKUP_BYTES = 64 * 1024;
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function backupPath(rootDir: string, backupId: string): string {
  return join(rootDir, `${backupId}.bak`);
}

function readRegularPrivateFile(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600) {
      throw new Error('Backup file failed its integrity checks');
    }
    if (stats.size > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
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

// Synthetic, filesystem-backed backup store. It proves the private-file discipline required of a real backup
// (directory 0700, file 0600, no symlink, single hard link, checksum verified on write and re-read) without
// any network I/O. It writes only a small ownership marker; no OPNsense configuration crosses this boundary.
export function createLocalBackupService(rootDir: string): BackupService {
  return Object.freeze({
    create(scope: string): Promise<{ readonly backupId: string }> {
      try {
        mkdirSync(rootDir, { recursive: true, mode: 0o700 });
        const backupId = randomBytes(BACKUP_ID_BYTES).toString('hex');
        const path = backupPath(rootDir, backupId);
        const content = Buffer.from(JSON.stringify({ scope, createdAtMs: Date.now() }), 'utf8');
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
        const readBack = readRegularPrivateFile(path);
        if (sha256(readBack) !== sha256(content)) {
          throw new Error('Backup verification failed');
        }
        return Promise.resolve({ backupId });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error('Backup creation failed'));
      }
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
