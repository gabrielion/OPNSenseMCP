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
// Concurrent starters settle within a handful of filesystem operations: as soon as one of them
// publishes, every later attempt short-circuits on the existing key. Five whole attempts is far
// past that point, and the bound is what stops a permanently faulty key — an extra hard link that
// no sweep may remove, say — from spinning forever.
const MAX_ATTEMPTS = 5;
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;

// The retry decision travels as an error type, never as an error message: a startup failure must
// not disclose the private state layout, so this carries the same static sentence as every other
// failure and an unclassified rethrow stays clean by construction.
class TransientIdentityKeyError extends Error {
  constructor() {
    super(KEY_INTEGRITY);
  }
}

function integrityError(): Error {
  return new Error(KEY_INTEGRITY);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // A failed close invalidates nothing that already succeeded, and it must not become the
    // reported outcome of an otherwise good attempt.
  }
}

function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeQuietly(fd);
  }
}

function readValidatedKey(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    // The predicates stay apart so exactly one of them can be classified: a key whose *only* fault
    // is an extra link is a peer mid-publication — it links its candidate, then unlinks it — and
    // that resolves on its own. Every other fault is corruption and must never be retried.
    const isRegularFile = stats.isFile();
    const isOwnedByThisUser = stats.uid === process.getuid?.();
    const isPrivate = (stats.mode & 0o777) === 0o600;
    const hasKeyLength = stats.size === KEY_BYTES;
    const hasExactlyOneLink = stats.nlink === 1;
    if (!isRegularFile || !isOwnedByThisUser || !isPrivate || !hasKeyLength) {
      throw integrityError();
    }
    if (!hasExactlyOneLink) throw new TransientIdentityKeyError();
    const buffer = Buffer.alloc(KEY_BYTES);
    let offset = 0;
    while (offset < KEY_BYTES) {
      const read = readSync(fd, buffer, offset, KEY_BYTES - offset, offset);
      if (read === 0) throw integrityError();
      offset += read;
    }
    return buffer;
  } finally {
    closeQuietly(fd);
  }
}

// Startup recovery: any fixed-pattern candidate is either the residue of a crash between link and
// cleanup (it shares the published key's inode) or an unpublished private candidate of a dead
// process. Both are safe to unlink; the published name itself is never touched. Concurrent
// starters run this sweep at the same time, so it is idempotent: an entry that has already
// disappeared is exactly the outcome we wanted, not a failure.
function cleanupCandidates(rootPath: string): void {
  const candidates = readdirSync(rootPath).filter((name) => CANDIDATE_PATTERN.test(name));
  let removed = 0;
  for (const name of candidates) {
    try {
      unlinkSync(join(rootPath, name));
      removed += 1;
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw integrityError();
    }
  }
  if (removed > 0) fsyncDirectory(rootPath);
}

function keyExists(rootPath: string): boolean {
  try {
    const fd = openSync(join(rootPath, KEY_NAME), constants.O_RDONLY | NOFOLLOW);
    closeQuietly(fd);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw integrityError();
  }
}

function writeCandidate(candidatePath: string): void {
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
    closeQuietly(fd);
  }
}

function discardCandidateQuietly(candidatePath: string): void {
  try {
    unlinkSync(candidatePath);
  } catch {
    // Best effort only: this runs while another failure is already being reported, and the next
    // starter's sweep removes whatever is left behind.
  }
}

function publishCandidate(candidatePath: string, keyPath: string): void {
  try {
    // Publication without replacement: exactly one concurrent starter wins this hard link.
    linkSync(candidatePath, keyPath);
  } catch (error) {
    // A peer's sweep removed our candidate before we could publish it. Nothing is wrong with the
    // root, so the whole attempt is worth repeating.
    if (hasCode(error, 'ENOENT')) throw new TransientIdentityKeyError();
    if (!hasCode(error, 'EEXIST')) {
      discardCandidateQuietly(candidatePath);
      throw integrityError();
    }
    // A concurrent process won; fall through and reread the winner.
  }
}

// Removing our own candidate is the last step of publication. A peer's sweep may already have done
// it for us: the same race as above, and equally worth repeating, since the repeat now finds a
// published key and short-circuits.
function discardPublishedCandidate(candidatePath: string): void {
  try {
    unlinkSync(candidatePath);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) throw new TransientIdentityKeyError();
    throw integrityError();
  }
}

function publishOrReadIdentityKey(root: StateRoot): Uint8Array {
  const keyPath = join(root.path, KEY_NAME);
  cleanupCandidates(root.path);
  if (keyExists(root.path)) return readValidatedKey(keyPath);

  const candidatePath = join(root.path, `${KEY_NAME}.candidate-${randomBytes(8).toString('hex')}`);
  writeCandidate(candidatePath);
  publishCandidate(candidatePath, keyPath);
  discardPublishedCandidate(candidatePath);
  fsyncDirectory(root.path);
  return readValidatedKey(keyPath);
}

// The one place that enforces the module's error contract: whatever an attempt throws — an fs
// errno with a path in it, anything else — leaves as the static sentence. Only the transient
// classification survives, and only as a type.
function attemptEnsureIdentityKey(root: StateRoot): Uint8Array {
  try {
    return publishOrReadIdentityKey(root);
  } catch (error) {
    if (error instanceof TransientIdentityKeyError) throw error;
    throw integrityError();
  }
}

export function ensureIdentityKey(root: StateRoot): Uint8Array {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return attemptEnsureIdentityKey(root);
    } catch (error) {
      if (!(error instanceof TransientIdentityKeyError)) throw error;
      if (attempt >= MAX_ATTEMPTS) throw integrityError();
    }
  }
}
