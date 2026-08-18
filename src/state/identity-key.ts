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
// Concurrent starters settle within a handful of filesystem operations, but one can still lose an
// attempt to a peer that is only just starting. The sweep runs once per call, at the start, so a
// candidate is exposed from the moment its name appears until we unlink it ourselves after
// publishing — the fsync before the link is the wide part, hundreds of microseconds on a
// journalling filesystem, and a sweep landing after the link costs the attempt just as surely,
// through the unlink below — and only to the startup sweeps of the peers that cross that window
// with it. On a two-core runner with a dozen starters the owner is regularly descheduled across
// it. Two transients therefore survive: that first-sweep collision, and the nlink window, where a
// winner is read between its link and its unlink. The measurements behind the numbers here predate
// sweep-once, when the sweep recurred on every attempt and a candidate was exposed to the whole of
// every peer's run: retries with no pause between them all landed inside the same contended
// window, which is how a whole budget used to be spent inside one scheduling quantum. The margin
// is therefore both more attempts and, below, a jittered pause between them. The bound is still
// what stops a permanently faulty key — an extra hard link that no sweep may remove, say — from
// spinning forever.
const MAX_ATTEMPTS = 10;
// Pause before retry n, in milliseconds, by 1-based attempt; every retry past the ramp holds the
// cap, so nine retries cost at most 412ms even at the top of the jitter — a bound worth keeping on
// a startup path a human is waiting on. The first retry is free because a transient often means the
// race is already decided: a sweep that removed our candidate is some peer's single startup sweep,
// so that peer is about to publish, or has published, or we published first and lost only our own
// leftover candidate — and the retry then finds a key and short-circuits on it. Measured at
// twelve-way concurrency on two vCPUs, 30% of the starters that took the free pause succeeded on
// the very next attempt. That number is history: it predates sweep-once, when the sweep that took
// our candidate could equally belong to a peer deep in its own retries and nowhere near publishing.
// Pausing on the first retry would buy nothing either way. The ramp exists for the starter that
// meets a further peer's first sweep, or the nlink window, on the attempt after that — it
// desynchronises the pair instead of replaying the same collision immediately.
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

// Startup recovery, and only that: a fixed-pattern candidate that is already there when a call
// begins is either the residue of a crash between link and cleanup (it shares the published key's
// inode) or an unpublished private candidate of a dead process. Both are safe to unlink; the
// published name itself is never touched. The caller sweeps once per call and never again from a
// retry, which is what keeps a live peer's in-flight candidate out of reach — and that is a trade,
// not a free win: a peer that dies between its own link and its own unlink WHILE we are retrying
// leaves residue we will not sweep, holding nlink at 2 until our budget runs out, where the old
// per-attempt sweep would have recovered it. We accept it because by name alone that residue is
// indistinguishable from the live candidate we must not touch, because it needs a crash inside a
// microsecond-wide window that happens to fall inside our retry window, and because the next start
// sweeps it. Concurrent starters still cross each other's sweeps, so this stays idempotent: an
// entry that has already disappeared is exactly the outcome we wanted, not a failure.
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
    // A peer's startup sweep removed our candidate before we could publish it — the one window in
    // which a sweep can still take it. Nothing is wrong with the root, so the whole attempt is
    // worth repeating.
    if (hasCode(error, 'ENOENT')) throw new TransientIdentityKeyError();
    if (!hasCode(error, 'EEXIST')) {
      discardCandidateQuietly(candidatePath);
      throw integrityError();
    }
    // A concurrent process won; fall through and reread the winner.
  }
}

// Removing our own candidate is the last step of publication. A peer's startup sweep may already
// have done it for us: the same race as above, and equally worth repeating, since the repeat now
// finds a published key and short-circuits.
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
  if (keyExists(root.path)) return readValidatedKey(keyPath);

  const candidatePath = join(root.path, `${KEY_NAME}.candidate-${randomBytes(8).toString('hex')}`);
  writeCandidate(candidatePath);
  publishCandidate(candidatePath, keyPath);
  discardPublishedCandidate(candidatePath);
  fsyncDirectory(root.path);
  return readValidatedKey(keyPath);
}

// Where an attempt meets the module's error contract: whatever it throws — an fs errno with a path
// in it, anything else — leaves as the static sentence. Only the transient classification survives,
// and only as a type. The sweep, being no longer part of an attempt, answers for itself below.
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
    // Finite and positive or nothing. Atomics.wait converts BOTH NaN and Infinity into an infinite
    // timeout — DoWait sets t to +Infinity for either, which this runtime was probed to confirm —
    // so the finiteness half of this guard is load-bearing twice over: it is what stops an
    // arithmetic slip anywhere in the schedule from parking startup forever, and NaN is the likelier
    // slip of the two. Only a negative or zero pause is safe to fall through as "no pause".
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    Atomics.wait(RETRY_PARK, 0, 0, milliseconds);
  }
});

// The sweep is a step of the call, not of an attempt, so it sits outside the loop: a retry that
// swept again would delete the in-flight candidate of a peer that started after us, which is the
// collision the loop below exists to survive rather than to cause. It keeps the module's error
// contract on its own, since it is now outside the attempt that used to enforce it: whatever it
// throws leaves as the static sentence, and never as a transient — a sweep that failed for a reason
// of its own would fail the same way on every retry.
function sweepCandidatesOnce(root: StateRoot): void {
  try {
    cleanupCandidates(root.path);
  } catch {
    throw integrityError();
  }
}

export function ensureIdentityKey(
  root: StateRoot,
  dependencies: IdentityKeyRetryDependencies = DEFAULT_RETRY_DEPENDENCIES
): Uint8Array {
  sweepCandidatesOnce(root);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return attemptEnsureIdentityKey(root);
    } catch (error) {
      if (!(error instanceof TransientIdentityKeyError)) throw error;
      if (attempt >= MAX_ATTEMPTS) throw integrityError();
      try {
        dependencies.wait(identityKeyRetryDelayMs(attempt, process.pid));
      } catch {
        // The contract is that one static sentence leaves this module, whatever failed. An injected
        // wait is the one step here that a caller supplies, so it is the one step that could throw
        // something else, and it must not become the exception the caller sees.
        throw integrityError();
      }
    }
  }
}
