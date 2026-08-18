// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LockHandle, MutationLockManager } from '../types.js';

// Synthetic, process-local exclusive lock keyed by target. It is non-blocking: acquiring a held target
// fails closed with null rather than queueing. Product 2 uses it to prove the envelope's lock/release
// ordering deterministically; a real distributed target lock is a later increment.
export function createInProcessMutationLockManager(): MutationLockManager {
  const held = new Set<string>();
  return Object.freeze({
    acquire(targetKey: string): Promise<LockHandle | null> {
      if (held.has(targetKey)) return Promise.resolve(null);
      held.add(targetKey);
      let released = false;
      const handle: LockHandle = Object.freeze({
        release(signal: AbortSignal): Promise<'released' | 'unconfirmed'> {
          if (!released) {
            released = true;
            held.delete(targetKey);
          }
          // Dropping a process-local token cannot fail, and a repeated release is still a release,
          // so this handle never has anything to report but success. There is likewise nothing for
          // the bound to cut short: the whole release is the `delete` above, already done by the
          // time the signal could fire. Accepted to honour the contract, and discarded here.
          void signal;
          return Promise.resolve('released');
        }
      });
      return Promise.resolve(handle);
    }
  });
}
