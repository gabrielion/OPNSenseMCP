// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
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
