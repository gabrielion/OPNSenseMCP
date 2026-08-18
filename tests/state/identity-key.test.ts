// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureIdentityKey, identityKeyRetryDelayMs } from '../../src/state/identity-key.js';
import { openStateRoot } from '../../src/state/state-root.js';

function scratchRoot(): { base: string; rootPath: string } {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'opnsense-identity-test-'));
  return { base, rootPath: join(base, 'state') };
}

describe('ensureIdentityKey', () => {
  it('publishes a 32-byte 0600 single-link key and leaves no candidate residue', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const key = ensureIdentityKey(root);
      expect(key).toHaveLength(32);
      const stats = lstatSync(join(rootPath, 'identity.key'));
      expect(stats.isFile()).toBe(true);
      expect(stats.nlink).toBe(1);
      expect(stats.mode & 0o777).toBe(0o600);
      expect(readdirSync(rootPath).filter((name) => name.startsWith('identity.key.'))).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns the same bytes on every later call — an existing key is never overwritten', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const first = Buffer.from(ensureIdentityKey(root));
      const second = Buffer.from(ensureIdentityKey(root));
      expect(second.equals(first)).toBe(true);
      expect(readFileSync(join(rootPath, 'identity.key')).equals(first)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'wrong size',
      (path: string) => {
        writeFileSync(path, Buffer.alloc(31), { mode: 0o600 });
      }
    ],
    [
      'loose mode',
      (path: string) => {
        writeFileSync(path, Buffer.alloc(32), { mode: 0o600 });
        chmodSync(path, 0o644);
      }
    ]
  ])('refuses a published key with %s instead of replacing it', (_label, corrupt) => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      corrupt(join(rootPath, 'identity.key'));
      expect(() => ensureIdentityKey(root)).toThrow('Identity key failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('ensureIdentityKey recovery', () => {
  it('recovers a crash between link and cleanup: candidate shares the key inode', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const key = Buffer.from(ensureIdentityKey(root));
      // Simulate the crash: re-create a candidate hard link to the published key (nlink becomes 2).
      const candidate = join(rootPath, `identity.key.candidate-${'a'.repeat(16)}`);
      linkSync(join(rootPath, 'identity.key'), candidate);
      expect(lstatSync(join(rootPath, 'identity.key')).nlink).toBe(2);

      const reread = Buffer.from(ensureIdentityKey(root));
      expect(reread.equals(key)).toBe(true);
      expect(lstatSync(join(rootPath, 'identity.key')).nlink).toBe(1);
      expect(readdirSync(rootPath).filter((name) => name.includes('candidate'))).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('removes an unpublished candidate left by a dead process', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const orphan = join(rootPath, `identity.key.candidate-${'b'.repeat(16)}`);
      writeFileSync(orphan, Buffer.alloc(32), { mode: 0o600 });

      const key = ensureIdentityKey(root);
      expect(key).toHaveLength(32);
      expect(readdirSync(rootPath).filter((name) => name.includes('candidate'))).toEqual([]);
      // The orphan's bytes were all zero; the published key must not be that orphan.
      expect(Buffer.from(key).equals(Buffer.alloc(32))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('a loser rereads the winner: with a published key, a fresh call changes nothing', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const winner = Buffer.from(ensureIdentityKey(root));
      const statsBefore = lstatSync(join(rootPath, 'identity.key'));
      const loser = Buffer.from(ensureIdentityKey(root));
      const statsAfter = lstatSync(join(rootPath, 'identity.key'));
      expect(loser.equals(winner)).toBe(true);
      expect(statsAfter.ino).toBe(statsBefore.ino);
      expect(statsAfter.mtimeMs).toBe(statsBefore.mtimeMs);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// The retry budget is what a starter has left when its peers keep sweeping the candidate it is
// about to publish. On a few-core runner with a journalling filesystem the whole budget used to be
// spent inside one scheduling quantum, so the numbers below are load-bearing, not decoration.
describe('ensureIdentityKey retry schedule', () => {
  // Attempt n is the pause AFTER the n-th failed attempt, so index 0 is the first retry.
  const BASE_SCHEDULE = [0, 5, 10, 20, 40, 50, 50, 50, 50];
  const PIDS = [1, 2, 3, 7, 999, 4242, 32_768, 4_194_304];

  it('does not pause before the first retry, so the usual one-retry case stays immediate', () => {
    for (const pid of PIDS) expect(identityKeyRetryDelayMs(1, pid)).toBe(0);
  });

  it.each(BASE_SCHEDULE.map((base, index) => [index + 1, base] as const))(
    'retry %i pauses within half and one and a half of its %ims base',
    (attempt, base) => {
      for (const pid of PIDS) {
        const delay = identityKeyRetryDelayMs(attempt, pid);
        expect(delay).toBeGreaterThanOrEqual(Math.floor(base * 0.5));
        expect(delay).toBeLessThanOrEqual(Math.ceil(base * 1.5));
      }
    }
  );

  it('holds the cap for every attempt past the schedule instead of growing without bound', () => {
    for (const pid of PIDS) {
      for (const attempt of [10, 11, 50, 1000]) {
        expect(identityKeyRetryDelayMs(attempt, pid)).toBeLessThanOrEqual(75);
      }
    }
  });

  it('gives one process the same schedule every time: the jitter is derived, never random', () => {
    const schedule = (): readonly number[] =>
      BASE_SCHEDULE.map((_base, index) => identityKeyRetryDelayMs(index + 1, 4242));
    expect(schedule()).toEqual(schedule());
  });

  it('spreads neighbouring pids across the window so peers leave lockstep', () => {
    const delays = new Set(
      Array.from({ length: 500 }, (_value, index) => identityKeyRetryDelayMs(5, index + 1))
    );
    // Attempt 5 has a 40ms base, so jitter may land on any of 41 values from 20 to 60. A hash that
    // merely reshuffled a handful of buckets would leave concurrent starters colliding.
    expect(delays.size).toBeGreaterThanOrEqual(25);
  });

  it('bounds the whole budget: real margin, but never a visible startup stall', () => {
    for (const pid of PIDS) {
      const total = BASE_SCHEDULE.reduce(
        (sum, _base, index) => sum + identityKeyRetryDelayMs(index + 1, pid),
        0
      );
      // The ceiling is the schedule's own worst case — 412ms, every rung at the top of its jitter —
      // so a widened rung or a lifted cap trips this rather than sliding under a round number.
      expect(total).toBeGreaterThan(100);
      expect(total).toBeLessThan(425);
    }
  });
});

describe('ensureIdentityKey retry loop', () => {
  function recordWaits(): { readonly waits: number[]; readonly wait: (ms: number) => void } {
    const waits: number[] = [];
    return {
      waits,
      wait: (ms: number) => {
        waits.push(ms);
      }
    };
  }

  it('spends ten attempts, pausing on the schedule, before it gives up on a stuck key', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      ensureIdentityKey(root);
      // A hard link outside the candidate pattern keeps every attempt transient forever: the sweep
      // may not remove it, so nlink stays 2 and the loop runs its full budget.
      linkSync(join(rootPath, 'identity.key'), join(rootPath, 'stray-link'));
      const recorder = recordWaits();
      expect(() => ensureIdentityKey(root, { wait: recorder.wait })).toThrow(
        'Identity key failed its integrity checks'
      );
      expect(recorder.waits).toEqual(
        Array.from({ length: 9 }, (_value, index) =>
          identityKeyRetryDelayMs(index + 1, process.pid)
        )
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('never pauses when publication succeeds outright', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const recorder = recordWaits();
      const key = ensureIdentityKey(openStateRoot(rootPath), { wait: recorder.wait });
      expect(key).toHaveLength(32);
      expect(recorder.waits).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('keeps the static message even when the injected wait throws its own error', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      ensureIdentityKey(root);
      linkSync(join(rootPath, 'identity.key'), join(rootPath, 'stray-link'));
      let message = '';
      try {
        ensureIdentityKey(root, {
          wait: () => {
            throw new Error(`clock unavailable at ${rootPath}`);
          }
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // The wait is the one step a caller supplies, so it is the one step that could smuggle a path
      // out of this module. It must not.
      expect(message).toBe('Identity key failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('never pauses on a persistent fault: a corrupt key fails on the first attempt', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      writeFileSync(join(rootPath, 'identity.key'), Buffer.alloc(31), { mode: 0o600 });
      const recorder = recordWaits();
      expect(() => ensureIdentityKey(root, { wait: recorder.wait })).toThrow(
        'Identity key failed its integrity checks'
      );
      expect(recorder.waits).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

// The sweep is a startup step, not a retry step. Nothing about one attempt makes that visible, so
// the pin is behavioural: a candidate that appears while the call is already retrying belongs to a
// live peer and must still be there when the call returns, while residue that was there before the
// call must be gone. The injected wait supplies the script the retry pauses run inside.
describe('ensureIdentityKey sweep scope', () => {
  it('sweeps once per call: mid-retry candidates survive, pre-call residue does not', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const published = Buffer.from(ensureIdentityKey(root));
      const residue = join(rootPath, `identity.key.candidate-${'d'.repeat(16)}`);
      writeFileSync(residue, Buffer.alloc(32), { mode: 0o600 });
      // A hard link outside the candidate pattern holds nlink at 2, so every attempt stays
      // transient until the injected wait removes it. That is what buys the call its retries.
      const strayLink = join(rootPath, 'stray-link');
      linkSync(join(rootPath, 'identity.key'), strayLink);
      // A live peer's in-flight candidate, written after this call has already swept.
      const peerCandidate = join(rootPath, 'identity.key.candidate-0123456789abcdef');

      let pauses = 0;
      const key = Buffer.from(
        ensureIdentityKey(root, {
          wait: () => {
            pauses += 1;
            if (pauses === 1) writeFileSync(peerCandidate, Buffer.alloc(32), { mode: 0o600 });
            if (pauses === 2) unlinkSync(strayLink);
          }
        })
      );

      expect(key.equals(published)).toBe(true);
      expect(pauses).toBe(2);
      expect(existsSync(residue)).toBe(false);
      // Attempts 2 and 3 both ran after the peer's candidate appeared. A sweep inside the attempt
      // would have deleted it; the sweep belongs to the start of the call, so it is still here.
      expect(existsSync(peerCandidate)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('ensureIdentityKey error hygiene', () => {
  it('reports a static message when the published key is a symlink', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      const target = join(base, 'outside');
      writeFileSync(target, Buffer.alloc(32), { mode: 0o600 });
      symlinkSync(target, join(rootPath, 'identity.key'));
      expect(() => ensureIdentityKey(root)).toThrow('Identity key failed its integrity checks');
      try {
        ensureIdentityKey(root);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toMatch(/\//u);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a directory where the key should be, with the same static message', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      mkdirSync(join(rootPath, 'identity.key'), { mode: 0o700 });
      expect(() => ensureIdentityKey(root)).toThrow('Identity key failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('persistently rejects a key with a foreign extra hard link and no candidate', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      ensureIdentityKey(root);
      // A hard link OUTSIDE the candidate pattern is not crash residue the sweep may remove:
      // nlink stays 2 on every retry, so this must throw, not loop forever.
      linkSync(join(rootPath, 'identity.key'), join(rootPath, 'stray-link'));
      expect(() => ensureIdentityKey(root)).toThrow('Identity key failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports a static message when a candidate cannot be swept', () => {
    const { base, rootPath } = scratchRoot();
    try {
      const root = openStateRoot(rootPath);
      writeFileSync(join(rootPath, `identity.key.candidate-${'e'.repeat(16)}`), Buffer.alloc(32), {
        mode: 0o600
      });
      // A read-only state root fails the sweep's unlink with EACCES rather than ENOENT: that is a
      // real failure, and it must surface without the errno text or the private state-root path.
      chmodSync(rootPath, 0o500);
      expect(() => ensureIdentityKey(root)).toThrow('Identity key failed its integrity checks');
      let message = '';
      try {
        ensureIdentityKey(root);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe('Identity key failed its integrity checks');
    } finally {
      chmodSync(rootPath, 0o700);
      rmSync(base, { recursive: true, force: true });
    }
  });
});
