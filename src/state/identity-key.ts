// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readSync,
  readdirSync,
  unlinkSync,
  writeSync
} from 'node:fs';
import { join } from 'node:path';
import type { StateRoot } from './state-root.js';

const KEY_BYTES = 32;
const KEY_NAME = 'identity.key';
const CANDIDATE_PATTERN = /^identity\.key\.candidate-[0-9a-f]{16}$/u;
const KEY_INTEGRITY = 'Identity key failed its integrity checks';
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;

function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readValidatedKey(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isFile() ||
      stats.uid !== process.getuid?.() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size !== KEY_BYTES
    ) {
      throw new Error(KEY_INTEGRITY);
    }
    const buffer = Buffer.alloc(KEY_BYTES);
    let offset = 0;
    while (offset < KEY_BYTES) {
      const read = readSync(fd, buffer, offset, KEY_BYTES - offset, offset);
      if (read === 0) throw new Error(KEY_INTEGRITY);
      offset += read;
    }
    return buffer;
  } finally {
    closeSync(fd);
  }
}

// Startup recovery: any fixed-pattern candidate is either the residue of a crash between link and
// cleanup (it shares the published key's inode) or an unpublished private candidate of a dead
// process. Both are safe to unlink; the published name itself is never touched.
function cleanupCandidates(rootPath: string): void {
  const candidates = readdirSync(rootPath).filter((name) => CANDIDATE_PATTERN.test(name));
  for (const name of candidates) unlinkSync(join(rootPath, name));
  if (candidates.length > 0) fsyncDirectory(rootPath);
}

function keyExists(rootPath: string): boolean {
  try {
    const fd = openSync(join(rootPath, KEY_NAME), constants.O_RDONLY | NOFOLLOW);
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error(KEY_INTEGRITY);
  }
}

export function ensureIdentityKey(root: StateRoot): Uint8Array {
  cleanupCandidates(root.path);
  if (keyExists(root.path)) return readValidatedKey(join(root.path, KEY_NAME));

  const candidatePath = join(root.path, `${KEY_NAME}.candidate-${randomBytes(8).toString('hex')}`);
  const fd = openSync(
    candidatePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW,
    0o600
  );
  try {
    const bytes = randomBytes(KEY_BYTES);
    let offset = 0;
    while (offset < KEY_BYTES) {
      offset += writeSync(fd, bytes, offset, KEY_BYTES - offset, offset);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    // Publication without replacement: exactly one concurrent starter wins this hard link.
    linkSync(candidatePath, join(root.path, KEY_NAME));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      unlinkSync(candidatePath);
      throw error;
    }
    // A concurrent process won; fall through and reread the winner.
  }
  unlinkSync(candidatePath);
  fsyncDirectory(root.path);
  return readValidatedKey(join(root.path, KEY_NAME));
}
