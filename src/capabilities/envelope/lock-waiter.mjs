// SPDX-License-Identifier: AGPL-3.0-or-later
// The body of the kernel mutation lock. The OS helper (`lockf`/`flock`) takes the lock and then
// runs this process, so this process's lifetime IS the hold: while it lives the helper lives, and
// when it exits the helper exits and the kernel drops the lock.
//
// It is deliberately argv-free and env-free. Everything it needs arrives as an inherited
// descriptor, so no lock path, target name or credential is ever visible in `ps` output or in the
// child's environment. Descriptor 4 is one end of a socketpair created by the parent's spawn; the
// parent holds the other end. The protocol is two bytes long:
//
//   1. write one readiness byte — the helper only reaches this process after the kernel lock is
//      held, so the byte is the parent's proof of acquisition and not merely of a spawn;
//   2. block reading until EOF — which arrives when the parent closes its end on release, and just
//      as surely when the parent DIES. That second case is the whole point: a crashed server
//      strands nothing, because the kernel closes its descriptors for it.
import { readSync, writeSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const PIPE_FD = 4;
// Retryable read faults must not be mistaken for EOF: EOF releases the lock, so guessing here would
// drop a live envelope's lock. Anything genuinely terminal ends the hold instead of spinning.
const RETRYABLE = new Set(['EAGAIN', 'EWOULDBLOCK', 'EINTR']);
const IDLE_MS = 25;

function codeOf(error) {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

try {
  writeSync(PIPE_FD, Buffer.of(1));
} catch {
  // Unreachable in a correctly spawned waiter. Exiting non-zero without a readiness byte is what
  // makes the parent fail closed rather than believe in a lock it does not hold.
  process.exit(1);
}

const scratch = Buffer.alloc(1);
const idle = new Int32Array(new SharedArrayBuffer(4));

for (;;) {
  let read;
  try {
    read = readSync(PIPE_FD, scratch, 0, 1, null);
  } catch (error) {
    if (!RETRYABLE.has(codeOf(error))) break;
    // A blocking sleep, not a spin: this process must cost nothing while an envelope runs.
    Atomics.wait(idle, 0, 0, IDLE_MS);
    continue;
  }
  if (read === 0) break;
  // The parent never speaks on this socket, so any byte is noise. Keep holding.
}

process.exit(0);
