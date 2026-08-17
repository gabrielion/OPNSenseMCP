// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureIdentityKey } from '../../src/state/identity-key.js';
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
