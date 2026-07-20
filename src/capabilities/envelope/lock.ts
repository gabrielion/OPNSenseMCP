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
        release(): Promise<void> {
          if (!released) {
            released = true;
            held.delete(targetKey);
          }
          return Promise.resolve();
        }
      });
      return Promise.resolve(handle);
    }
  });
}
