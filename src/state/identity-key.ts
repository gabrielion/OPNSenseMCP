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
// Concurrent starters settle within a handful of filesystem operations, but only once one of them
// gets through the window between writing its candidate and linking it: every peer's sweep removes
// any candidate it sees, so a starter descheduled inside that window loses the whole attempt. The
// window is as wide as an fsync — hundreds of microseconds on a journalling filesystem — and on a
// two-core runner with a dozen starters the owner is regularly descheduled across it. Retries with
// no pause between them all land inside the same contended window, which is how a whole budget
// used to be spent inside one scheduling quantum. The margin is therefore both more attempts and,
// below, a jittered pause between them. The bound is still what stops a permanently faulty key —
// an extra hard link that no sweep may remove, say — from spinning forever.
const MAX_ATTEMPTS = 10;
// Pause before retry n, in milliseconds, by 1-based attempt; every retry past the ramp holds the
// cap. The first retry stays immediate because the commonest transient — a peer caught between its
// link and its unlink — closes in microseconds, and the cap keeps the whole budget inside a few
// hundred milliseconds of a startup path that a human is waiting on.
const RETRY_DELAYS_MS: readonly number[] = [0, 5, 10, 20, 40];
const RETRY_CAP_MS = 50;
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

// A fraction in [0, 1) that varies with the process and with the attempt. Derived rather than
// random: a pause is no reason for a library to consume entropy, and a derived value keeps the
// schedule reproducible under test. Starters cross the same barrier and fail their first attempts
// together, so the point of the mixing is that neighbouring pids land far apart and leave lockstep
// instead of colliding on every retry.
function retryJitterFraction(attempt: number, pid: number): number {
  let mixed = (Math.imul(pid, 0x9e37_79b1) + Math.imul(attempt, 0x85eb_ca6b)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0_aaad) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a_2d97) >>> 0;
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  return mixed / 0x1_0000_0000;
}

// Exported for the test that pins the schedule; the retry loop below is the only other caller.
// `attempt` is 1-based and names the pause that follows that attempt's failure.
export function identityKeyRetryDelayMs(attempt: number, pid: number): number {
  const base = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_CAP_MS;
  return Math.round(base * (0.5 + retryJitterFraction(attempt, pid)));
}

export interface IdentityKeyRetryDependencies {
  /** Blocks the calling thread for the given number of milliseconds. */
  wait(milliseconds: number): void;
}

// Startup is synchronous, so the pause has to block this thread. Atomics.wait parks it; a spin loop
// would instead burn the core that the peer we are waiting for needs in order to finish publishing,
// which is the very starvation that makes the retries necessary.
const RETRY_PARK = new Int32Array(new SharedArrayBuffer(4));

const DEFAULT_RETRY_DEPENDENCIES: IdentityKeyRetryDependencies = Object.freeze({
  wait: (milliseconds: number): void => {
    if (milliseconds <= 0) return;
    Atomics.wait(RETRY_PARK, 0, 0, milliseconds);
  }
});

export function ensureIdentityKey(
  root: StateRoot,
  dependencies: IdentityKeyRetryDependencies = DEFAULT_RETRY_DEPENDENCIES
): Uint8Array {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return attemptEnsureIdentityKey(root);
    } catch (error) {
      if (!(error instanceof TransientIdentityKeyError)) throw error;
      if (attempt >= MAX_ATTEMPTS) throw integrityError();
      dependencies.wait(identityKeyRetryDelayMs(attempt, process.pid));
    }
  }
}
