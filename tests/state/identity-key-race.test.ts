// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const CHILD = fileURLToPath(new URL('./helpers/identity-key-race-child.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STARTERS = 12;
const ROUNDS = 4;

// Always rebuild so the children exercise the CURRENT sources, never a stale dist.
beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: REPO_ROOT, timeout: 240_000 });
}, 250_000);

async function raceOnce(rootPath: string): Promise<readonly string[]> {
  const barrier = String(Date.now() + 300);
  const children = Array.from({ length: STARTERS }, () =>
    execFileAsync(process.execPath, [CHILD, rootPath, barrier], { timeout: 30_000 }).then(
      ({ stdout }) => stdout.trim(),
      (error: unknown) => {
        const stdout = (error as { stdout?: string }).stdout ?? '';
        return stdout.trim() === '' ? 'fail spawn' : stdout.trim();
      }
    )
  );
  return Promise.all(children);
}

describe('ensureIdentityKey under real multi-process concurrency', () => {
  // un-skipped by the Task 2 fix
  it.skip(
    'every concurrent starter succeeds and they all agree on one key',
    { timeout: 240_000 },
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        const base = mkdtempSync(join(realpathSync(tmpdir()), 'opnsense-identity-race-'));
        try {
          const rootPath = join(base, 'state');
          const lines = await raceOnce(rootPath);
          const failures = lines.filter((line) => !line.startsWith('ok '));
          expect(failures).toEqual([]);
          const keys = new Set(lines.map((line) => line.slice(3)));
          expect(keys.size).toBe(1);
          const stats = lstatSync(join(rootPath, 'identity.key'));
          expect(stats.nlink).toBe(1);
          expect(stats.mode & 0o777).toBe(0o600);
          expect(readdirSync(rootPath).filter((name) => name.includes('candidate'))).toEqual([]);
        } finally {
          rmSync(base, { recursive: true, force: true });
        }
      }
    }
  );

  // un-skipped by the Task 2 fix
  it.skip(
    'concurrent starters on an already-published root with crash residue all succeed',
    { timeout: 120_000 },
    async () => {
      const base = mkdtempSync(join(realpathSync(tmpdir()), 'opnsense-identity-race-'));
      try {
        const rootPath = join(base, 'state');
        // Publish first, then plant residue candidates that every starter will try to sweep.
        const first = await raceOnce(rootPath);
        expect(first.every((line) => line.startsWith('ok '))).toBe(true);
        for (const suffix of ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(16)]) {
          writeFileSync(join(rootPath, `identity.key.candidate-${suffix}`), Buffer.alloc(32), {
            mode: 0o600
          });
        }
        const lines = await raceOnce(rootPath);
        expect(lines.filter((line) => !line.startsWith('ok '))).toEqual([]);
        expect(new Set(lines.map((line) => line.slice(3))).size).toBe(1);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  );
});
