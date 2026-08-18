# P0-C Slice 1.1 — Identity-Key Hardening, CI Evidence Gate and 0.1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the concurrency and error-hygiene findings of the 2026-08-17 post-merge review of
Slice 1 (N1/N2/N4/N5, plus the untested-claims gap N3), delete the dead duplicate backup module,
make CI run the sealed-OpenCode gate, and prepare the 0.1.1 release candidate.

**Architecture:** All changes are local to `src/state/`, one dead file removal in
`src/capabilities/envelope/`, one CI step, and a version bump. The identity-key work is proven by a
real multi-process race test (spawned Node children with `--experimental-strip-types`), written
FIRST so the current defects are observed failing before the fix. No server wiring changes.

**Tech Stack:** Node 22 built-ins, TypeScript strict, Vitest. No new dependency.

**Review basis:** the findings labelled N1–N5 and the race statistics (600 concurrent starters:
27 linkSync/unlinkSync ENOENT at the publication step, 8 sweep ENOENT, 0 key divergence) come from
the 2026-08-17 Opus review; they are restated in full where each task needs them.

**Model policy (user mandate):** every implementer and task-reviewer subagent runs on Opus 5 with
maximum effort.

## Global Constraints

- Node 22 only: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`; install with `npm ci --ignore-scripts`.
- Work on the feature branch created in Task 0. **Never push non-evidence commits to `main`**; the
  landing sequence (merge → real `smoke:opencode` → fixture commit → real `vm:product3` →
  attestation commit → `evidence:verify` 0 → push) happens once, after the final review.
- Every new file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- No new runtime dependency. Local ESM imports use the `.js` extension.
- **Static error messages only** in `src/state/`: no filesystem path, origin, or errno text may
  appear in any thrown message. This is the norm N2 enforces.
- Lint traps already learned: `noUncheckedIndexedAccess` forbids bracket-indexing a string into
  `+=` (use `.charAt`); void-returning concise arrows inside `expect(() => ...)` need braces.
- Strict TDD; the race test of Task 1 is the RED for Task 2.
- Commit messages: repo style (`fix:`, `test:`, `feat:`, `docs:`, `ci:` prefixes, lower-case
  subject), each with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Before the final commit of the slice: `npm run license:check && npm run verify &&
  npm run test:conformance && git diff --check` all exit 0.
- The repo ledger `.superpowers/sdd/progress.md` (repo root, gitignored dir — `git add -f`) gets
  the slice entry in Task 9.

## File Structure

- Create: `tests/state/identity-key-race.test.ts` — multi-process race test.
- Create: `tests/state/helpers/identity-key-race-child.mjs` — plain-JS child entry importing the
  COMPILED module from `dist/state/index.js` (verified: `--experimental-strip-types` cannot
  resolve the source tree's internal `.js` specifiers to `.ts` files, so children must run the
  build output; the race test rebuilds `dist` in `beforeAll` so it always exercises the current
  sources).
- Modify: `src/state/identity-key.ts` — ENOENT-tolerant sweep, static error wrapping, bounded
  whole-publication retry.
- Modify: `src/state/state-root.ts` + `src/state/index.ts` — canonicalizing entry point.
- Modify: `src/state/target-identity.ts` — stricter origin admission.
- Modify: `tests/state/{identity-key,state-root,target-identity}.test.ts` — new cases.
- Delete: `src/capabilities/envelope/backup.ts`, `tests/capabilities/envelope/backup.test.ts`.
- Modify: `.github/workflows/ci.yml` — `evidence:check` step.
- Modify (bump): `package.json`, `src/main.ts`, `src/capabilities/foundation/server-status.ts`,
  `src/server/build-server.ts`, `src/http/legacy-sse.ts`, and the two tests that assert the
  version (`tests/config/main-command.test.ts`, `tests/integration/opnsense-read-product.test.ts`).
- Modify: `docs/project-status.md`, `.superpowers/sdd/progress.md`.

---

### Task 0: Branch setup

- [ ] **Step 1:**

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
git switch main && git pull --ff-only
git switch -c p0c/slice1.1-hardening
npm ci --ignore-scripts
npm run verify   # must exit 0 before Task 1
```

---

### Task 1: The multi-process race test (RED for Task 2)

**Files:**
- Create: `tests/state/helpers/identity-key-race-child.mjs`
- Create: `tests/state/identity-key-race.test.ts`

**Interfaces:**
- Consumes: `openStateRoot`, `ensureIdentityKey` from the COMPILED `dist/state/index.js`.
- Produces: a reusable child harness later slices can extend.

The child process (plain JS, no vitest, imports the build output):

- [ ] **Step 1: Write the child entry**

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs one ensureIdentityKey attempt against the state root given in argv[2], after waiting for
// the wall-clock barrier in argv[3] so all children start together. Prints exactly one line:
// "ok <hex-key>" or "fail <static-message-only>". Imports dist/ because Node type-stripping
// cannot resolve the source tree's internal .js specifiers; the race test rebuilds dist first.
import { ensureIdentityKey, openStateRoot } from '../../../dist/state/index.js';

const rootPath = process.argv[2];
const barrierMs = Number(process.argv[3]);
if (rootPath === undefined || !Number.isFinite(barrierMs)) {
  process.stdout.write('fail bad-arguments\n');
  process.exit(1);
}
while (Date.now() < barrierMs) {
  // busy-wait a few ms so all children cross the barrier as close together as possible
}
try {
  const key = ensureIdentityKey(openStateRoot(rootPath));
  process.stdout.write(`ok ${Buffer.from(key).toString('hex')}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown';
  process.stdout.write(`fail ${message}\n`);
  process.exit(1);
}
```

- [ ] **Step 2: Write the race test**

```ts
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
  it('every concurrent starter succeeds and they all agree on one key', { timeout: 240_000 }, async () => {
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
  });

  it('concurrent starters on an already-published root with crash residue all succeed', { timeout: 120_000 }, async () => {
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
  });
});
```

- [ ] **Step 3: Run and observe RED**

Run: `npx vitest run tests/state/identity-key-race.test.ts`
Expected: FAIL — with 12 starters × several rounds, the current implementation loses starters to
raw `ENOENT` (publication-step and sweep races, measured at ~4.5% + ~1.3% per starter). If a run
happens to pass fully, re-run once; record the observed failure lines in the report. The failure
messages will contain absolute paths — that observation is finding N2 and must be quoted in the
report as RED evidence.

- [ ] **Step 4: Commit the failing test, skipped**

Mark both tests `it.skip(...)` with the comment `// un-skipped by the Task 2 fix` so the branch
stays green mid-slice, then:

```bash
git add tests/state/identity-key-race.test.ts tests/state/helpers/identity-key-race-child.ts
git commit -m "test: reproduce the identity-key publication races with real processes"
```

---

### Task 2: Fix the races and the error hygiene (N1 + N2 + bounded retry)

**Files:**
- Modify: `src/state/identity-key.ts`
- Modify: `tests/state/identity-key.test.ts` (new deterministic cases)
- Modify: `tests/state/identity-key-race.test.ts` (un-skip)

**Interfaces:** `ensureIdentityKey(root: StateRoot): Uint8Array` — signature unchanged.

Requirements, restated precisely:

1. **Sweep tolerance (N1):** a candidate that disappears between `readdirSync` and `unlinkSync`
   is success, not failure — the sweep is idempotent. Tolerate `ENOENT` on each unlink; every
   other unlink error becomes the static `KEY_INTEGRITY` message.
2. **Static errors everywhere (N2):** no raw fs error may escape `ensureIdentityKey`. Every fs
   call — `readdirSync`, both `openSync` sites, `writeSync`/`fsyncSync`, `linkSync`,
   `unlinkSync`, `fsyncDirectory` — maps failures to `Error(KEY_INTEGRITY)`. Internal code may
   carry structured cause information, but only through a module-private error type whose
   `message` is still `KEY_INTEGRITY`.
3. **Bounded whole-publication retry:** classify failures as *transient* (candidate or link/unlink
   `ENOENT` — a peer swept our candidate; validation failure where `nlink !== 1` — the winner's
   link→unlink window) or *persistent* (everything else). On a transient failure, retry the whole
   attempt (sweep → exists → publish → validated read) up to **5 attempts total**, then throw the
   static error. Persistent failures throw immediately. Suggested shape:

```ts
class TransientIdentityKeyError extends Error {
  constructor() {
    super(KEY_INTEGRITY);
  }
}

export function ensureIdentityKey(root: StateRoot): Uint8Array {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return attemptEnsureIdentityKey(root);
    } catch (error) {
      if (attempt < 5 && error instanceof TransientIdentityKeyError) continue;
      if (error instanceof TransientIdentityKeyError) throw new Error(KEY_INTEGRITY);
      throw error;
    }
  }
}
```

   with `attemptEnsureIdentityKey` being today's body, its fs calls wrapped so that: sweep unlink
   ENOENT → skip entry; publication-path ENOENT (candidate open ENOENT is impossible with
   `O_CREAT|O_EXCL`, but `linkSync` ENOENT and the post-publication `unlinkSync` ENOENT are the
   swept-candidate race) → `TransientIdentityKeyError`; `readValidatedKey` failure where the only
   failed predicate is `nlink !== 1` → `TransientIdentityKeyError`; all other failures →
   `Error(KEY_INTEGRITY)` (or `Error(DIRECTORY-INTEGRITY-equivalent static)` — one static string,
   keep `KEY_INTEGRITY`).
4. `readValidatedKey` distinguishes the nlink-only failure internally (compute the five predicate
   booleans separately) but still never puts detail in any message.
5. **Race-test isolation (defect found by Task 1's implementer):** the committed race test's
   `beforeAll` runs `npm run build`, whose `rm -rf dist` races the five sibling tests in the
   `parallel` Vitest project that read or execute `dist/` — harmless while skipped, flaky once
   un-skipped. As part of un-skipping, restructure: `beforeAll` compiles into a private scratch
   directory instead (`npx tsc -p tsconfig.json --outDir <mkdtemp scratch>` — plus copying
   nothing else; the state module has no non-TS assets), the child receives the module path as
   `process.argv[4]` and dynamic-imports it (`await import(pathToFileURL(modulePath).href)`),
   and the scratch directory is removed in `afterAll`. `dist/` is never touched by this test.
   Measured RED rates for calibration: 19–28% of starters fail at 12-way concurrency on a fresh
   root; the planted-residue scenario reproduces at ~11/12 reliably — after the fix both must be
   stably green across two consecutive full runs.
6. **Race-test strengthening (from the Task 1 review), applied while un-skipping:** (a) test 2
   also asserts the planted residue was actually swept — append after its key-agreement check:
   `expect(readdirSync(rootPath).filter((name) => name.includes('candidate'))).toEqual([]);`
   (b) widen the barrier from `Date.now() + 300` to `Date.now() + 1000` so slow child boots stay
   synchronized; (c) replace test 2's setup assertion with the diagnostic-preserving form
   `expect(first.filter((line) => !line.startsWith('ok '))).toEqual([]);` (d) in the child, use
   `process.exitCode = 1` instead of `process.exit(1)` (async-stdout truncation on darwin) and
   correct its header comment — it prints the RAW message until this task makes messages static.

- [ ] **Step 1: Deterministic unit tests first (append to `tests/state/identity-key.test.ts`)**

```ts
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
});
```

(`mkdirSync` and `symlinkSync` may need adding to the test file's `node:fs` import.)

- [ ] **Step 2: Run — RED** (`npx vitest run tests/state/identity-key.test.ts`): the symlink case
currently throws a raw `ELOOP` whose message contains the path; the stray-link case currently
throws after ONE validation with the static message — it may already pass; if so note that it
pins the non-looping bound once retry lands.

- [ ] **Step 3: Implement** per the requirements above.

- [ ] **Step 4: Un-skip the race tests. Run everything:**

```bash
npx vitest run tests/state/
npx eslint src/state/identity-key.ts tests/state/ --max-warnings 0
npx tsc -p tsconfig.json --noEmit
npx prettier --check src/state/identity-key.ts tests/state/
```

Expected: all green, including both race tests, repeatedly (run the race file twice).

- [ ] **Step 5: Commit**

```bash
git add src/state/identity-key.ts tests/state/
git commit -m "fix: survive concurrent identity-key starts and keep errors static"
```

---

### Task 3: Canonical state-root entry (N4)

**Files:**
- Modify: `src/state/state-root.ts`, `src/state/index.ts`
- Modify: `tests/state/state-root.test.ts`

**Interfaces:**
- Produces: `openResolvedStateRoot(override: string | undefined, environment: StateRootEnvironment): StateRoot`
  — resolves the path (`resolveStateRootPath`), creates it (`mkdirSync recursive 0700` semantics
  via the existing helpers), **canonicalizes it with `realpathSync` after creation**, then runs
  the existing strict validation on the canonical path and returns the `StateRoot` whose `.path`
  IS the canonical path. This is the entry point integration must use; `openStateRoot(path)`
  keeps its strict already-canonical contract for internal reuse.
- `resolveStateRootPath` additionally rejects a non-normalized override (trailing slash, `..`,
  doubled separators): `normalize(override) !== override` → the existing absolute-path error is
  wrong for this case, so throw a second static message
  `Error('OPNSENSE_MCP_STATE_DIR must be a normalized absolute path')` (also used for the
  non-absolute case — replace the old message everywhere, tests updated accordingly).

- [ ] **Step 1: Tests first (append; adjust the existing relative-override test's expected
message to the new string)**

```ts
describe('openResolvedStateRoot', () => {
  it('accepts an override whose realpath differs (macOS /var vs /private/var) and returns the canonical root', () => {
    // tmpdir() without realpathSync IS the non-canonical spelling on macOS; on Linux the two are
    // equal and the test still passes.
    const base = mkdtempSync(join(tmpdir(), 'opnsense-state-canon-'));
    try {
      const override = join(base, 'state');
      const root = openResolvedStateRoot(override, {
        platform: process.platform,
        env: {},
        homeDir: '/home/unused'
      });
      expect(root.path).toBe(realpathSync(override));
      expect(lstatSync(root.path).mode & 0o777).toBe(0o700);
      expect(openStateRoot(root.path).path).toBe(root.path);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it.each([['/tmp/state/'], ['/tmp//state'], ['/tmp/a/../state'], ['relative/state']])(
    'rejects the non-normalized or relative override %s',
    (override) => {
      expect(() =>
        openResolvedStateRoot(override, { platform: 'linux', env: {}, homeDir: '/home/x' })
      ).toThrow('OPNSENSE_MCP_STATE_DIR must be a normalized absolute path');
    }
  );
});
```

(`lstatSync` may need importing; `process.platform` is fine here because the suite only runs on
darwin/linux.)

- [ ] **Step 2: RED**, **Step 3: implement**, **Step 4: green + lint/typecheck/prettier on the
touched files**, **Step 5:**

```bash
git add src/state/state-root.ts src/state/index.ts tests/state/state-root.test.ts
git commit -m "feat: canonicalize the state root before validating it"
```

---

### Task 4: Strict origin admission (N5)

**Files:**
- Modify: `src/state/target-identity.ts`
- Modify: `tests/state/target-identity.test.ts`

`canonicalizeOrigin` additionally rejects (same static `Invalid OPNsense origin`):
a DNS hostname with a trailing dot, an empty label (`a..example`), an underscore anywhere in a
DNS label, and port `0`. IPv4 and bracketed IPv6 literals are exempt from the label rules (an
IPv6 hostname contains `:` inside brackets; detect literals as: hostname starts with `[` → IPv6;
hostname matching `/^\d{1,3}(\.\d{1,3}){3}$/u` → IPv4).

- [ ] **Step 1: Tests first**

```ts
it.each([
  ['https://fw.example.', 'trailing dot'],
  ['https://a..example', 'empty label'],
  ['https://a_b.example', 'underscore in label'],
  ['https://a.example:0', 'port zero']
])('rejects %s (%s)', (input) => {
  expect(() => canonicalizeOrigin(input)).toThrow('Invalid OPNsense origin');
});

it('still accepts IP literals that the label rules do not apply to', () => {
  expect(canonicalizeOrigin('https://192.0.2.1:8443')).toBe('https://192.0.2.1:8443');
  expect(canonicalizeOrigin('https://[2001:DB8::1]')).toBe('https://[2001:db8::1]:443');
});
```

- [ ] **Step 2: RED**, **Step 3: implement** (after the existing printable-ASCII/lower-case check;
port check: `parsed.port === '0'` is rejected before the default substitution), **Step 4: green +
lint/typecheck/prettier**, **Step 5:**

```bash
git add src/state/target-identity.ts tests/state/target-identity.test.ts
git commit -m "fix: refuse origin spellings that would split one firewall's state"
```

---

### Task 5: Delete the dead backup module

**Files:**
- Delete: `src/capabilities/envelope/backup.ts`
- Delete: `tests/capabilities/envelope/backup.test.ts`

`createLocalBackupService` is imported nowhere in production (verify with
`grep -rn 'createLocalBackupService\|envelope/backup' src/ scripts/`); production wires
`createOPNsenseConfigBackupService` (`src/app/default-application.ts`). Before deleting the test
file, diff its cases against `tests/capabilities/envelope/config-backup.test.ts` (or equivalent —
locate with `ls tests/capabilities/envelope/`): any behavior asserted ONLY for the dead module
that also applies to the live one (private-file discipline, checksum re-read) must be ported to
the live module's test file in this same task. Then:

- [ ] **Step 1:** port any uncovered case (with RED/GREEN if a ported test finds a live-module gap)
- [ ] **Step 2:** `git rm src/capabilities/envelope/backup.ts tests/capabilities/envelope/backup.test.ts`
- [ ] **Step 3:** `npx vitest run tests/capabilities/ && npx tsc -p tsconfig.json --noEmit` — green,
plus `grep -rn 'createLocalBackupService' . --exclude-dir=node_modules --exclude-dir=.git` finds
nothing.
- [ ] **Step 4:**

```bash
git add -A
git commit -m "refactor: drop the dead local backup service and keep one security discipline"
```

---

### Task 6: CI runs the sealed-OpenCode gate

**Files:**
- Modify: `.github/workflows/ci.yml`

In the job that already runs `npm run verify` and `npm run evidence:verify`, add immediately
after the `evidence:verify` step:

```yaml
      - run: npm run evidence:check
```

`evidence:check` is deterministic and network-free (the hermetic loopback-registry preparation),
but it needs `dist/` — which the preceding `npm run verify` already built in the same job. No
other change; do not touch the other jobs.

- [ ] **Step 1:** apply; **Step 2:** `npx prettier --check .github/workflows/ci.yml` (repo
prettier covers YAML? if `npm run verify`'s format step covers it, rely on that instead — check
with `git diff --check` and the verify run in Task 9);
- [ ] **Step 3:** run `npm run evidence:check` locally — it must exit 0 on this branch (nothing in
Tasks 1–5 touches README/LICENSE/dist-shipped sources? **it does** — `src/state/**` ships in
`dist`; so expect exit **1** here and note it: the gate goes green again at the landing sequence
when the real smoke reseals the fixture. Record the observed exit code in the report; do NOT
reseal by hand.)
- [ ] **Step 4:**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: enforce the sealed OpenCode evidence gate"
```

---

### Task 7: Version bump to 0.1.1

**Files (each pin verified by grep, not memory):**
- `package.json` `"version": "0.1.0"` → `"0.1.1"`
- `src/main.ts` `const CLI_VERSION = '0.1.0'` → `'0.1.1'`
- `src/capabilities/foundation/server-status.ts` `z.literal('0.1.0')` and `'0.1.0' as const` → `0.1.1`
- `src/server/build-server.ts` `version: '0.1.0'` → `'0.1.1'`
- `src/http/legacy-sse.ts` `version: '0.1.0'` → `'0.1.1'`
- `tests/config/main-command.test.ts` `toHaveBeenCalledWith('0.1.0\n')` → `'0.1.1\n'`
- `tests/integration/opnsense-read-product.test.ts` `version: '0.1.0'` → `'0.1.1'`
- `package-lock.json`: run `npm install --package-lock-only --ignore-scripts` to sync the two
  self-referential version fields; verify the diff touches ONLY those.

Do NOT touch: sealed fixtures (`tests/fixtures/*.json` record what actually ran), client-info
strings in `tests/mcp/stdio.test.ts` / `tests/integration/installed-package.test.ts` /
`tests/integration/opencode-smoke-runner.test.mjs` / `tests/foundation/documentation.test.ts`
(arbitrary test data, not the product version).

- [ ] **Step 1:** apply the eight edits; **Step 2:**
`grep -rn "0\.1\.0" package.json src/ | grep -v package-lock` returns nothing;
- [ ] **Step 3:** `npx vitest run tests/config/main-command.test.ts tests/integration/opnsense-read-product.test.ts tests/capabilities/ tests/mcp/` green; `npm run build` then `node dist/main.js --version` prints `0.1.1`;
- [ ] **Step 4:**

```bash
git add package.json package-lock.json src/main.ts src/capabilities/foundation/server-status.ts src/server/build-server.ts src/http/legacy-sse.ts tests/config/main-command.test.ts tests/integration/opnsense-read-product.test.ts
git commit -m "feat: version 0.1.1"
```

---

### Task 8: Docs and ledger

**Files:**
- Modify: `docs/project-status.md`
- Modify: `.superpowers/sdd/progress.md` (repo root; `git add -f`)
- Modify (truth fixes required by the Task 6 review — the CI gate falsifies five in-repo
  statements, and none of these are packed into the tarball so they cannot redden the digest):
  - `vitest.config.ts:48-50` — comment says the digest equality "must not block an ordinary
    commit"; rewrite to say CI enforces it as its own independent job, resealed by the landing
    sequence.
  - `tests/integration/installed-package.test.ts:228-230` — comment calls digest equality "a
    RELEASE question, not a per-commit one"; same correction.
  - `CONTRIBUTING.md:111` — says the two evidence checks "belong to a release rather than to a
    commit"; correct to: CI runs `evidence:check` in a dedicated job; contributor PRs touching
    `src/**`, `README.md`, `LICENSE`, `package.json` or the tsconfigs will show that job red
    until a maintainer reseals with the real `smoke:opencode`; `npm run verify` remains the
    per-commit developer gate.
  - `docs/project-status.md:433-435` (inside "Task 2 — evidence renewal sequence") and `:479`
    (inside the copy/paste prompt) — both claim CI does not run `evidence:check`; correct both.
- Use the ACCURATE digest blast radius everywhere (from the Task 6 review): the tarball digest
  changes on `src/**` (via `dist/`), `README.md`, `LICENSE`, `package.json`, and the two
  tsconfigs; it does NOT change on `scripts/**`, `docs/**`, `tests/**`, `.github/**`, `evals/**`;
  a lockfile bump matters only if it changes the toolchain that produces `dist/`.
- Landing note to record: the first green `main` run must be checked to have actually EXECUTED
  the evidence-freshness job (not skipped past a failed earlier step).

`docs/project-status.md`, keeping its established structure:
- header block: snapshot date 2026-08-17; note Slice 1 merged (`fc3b100`) and Slice 1.1 hardening
  + 0.1.1 candidate on this branch; evidence bullets stay accurate (they describe the by-design
  staleness mechanics);
- "Immediate next-session objective": Task 1 becomes "dispatch the Release workflow for 0.1.1
  after this branch lands with the evidence sequence (operator approves the npm-publish
  environment)"; Task 3 choice: Slice 2 plan is next, and its REQUIRED carry-overs are now:
  unsafe-ancestor validation decision, plus the R1–R9 kernel/types refactors from the 2026-08-17
  review (list them one line each: lock release out of `finally` + LOCK_RELEASE_FAILED;
  LockHandle.release reporting; terminal-audit result enforcement via one helper;
  BackupService.create(BackupRequest); bounded acquire/exists/release with signals; durable
  backup root replacing the tmpdir store; lazy mutation-service construction so win32 stays
  read-only; an origin seam from the composed app; audit ALLOWED_KEYS extension). State that the
  two concurrent-first-start races are CLOSED by this slice (bounded retry + real race test).
- Known traps: add the "race-test children import dist/, the test rebuilds in beforeAll — a
  hand-run against a stale dist tests old code" note and the "race test uses 12 starters ×
  rounds; if it flakes, the retry bound is the suspect, not the test" note.

`.superpowers/sdd/progress.md`: dated 2026-08-17 entry in the file's style: what the slice fixed
(N1/N2/N4/N5 with one-line mechanisms), the race-test evidence (starters × rounds, all green),
the retry design (5 attempts, transient classification), the dead-module removal, the CI gate
addition, the 0.1.1 bump, and the UPDATED Slice 2 carry-over list (unsafe-ancestors + R1–R9;
races no longer carried).

- [ ] **Step 1:** edit both; **Step 2:** gates, with ONE known exception:

```bash
npm run license:check && npm run test:conformance && git diff --check   # all must exit 0
npm run verify   # expected RED on EXACTLY ONE assertion — see below
```

After the 0.1.1 bump, `npm run verify` fails exactly one test:
`tests/integration/installed-package.test.ts` — the sealed OpenCode fixture's `package.version`
(`0.1.0`, what the smoke really exercised) no longer equals `package.json` (`0.1.1`). Hand-editing
the sealed fixture would fabricate evidence and is forbidden; the landing sequence's real
`smoke:opencode` reseal regenerates version and digests atomically, after which `npm run verify`
must be fully green BEFORE `vm:product3` runs. Task 8's report records the single failure by name
and confirms all other tests pass. (`evidence:check`/`evidence:verify` are likewise expected stale
on the branch and restored by the landing sequence.)

- [ ] **Step 3:**

```bash
git add docs/project-status.md
git add -f .superpowers/sdd/progress.md
git commit -m "docs: record the hardening slice and the 0.1.1 candidate"
```

---

## Landing (controller, after final review — not an implementer task)

finishing-a-development-branch: full suite → merge into `main` (ff) → real `npm run smoke:opencode`
→ commit fixture → `npm run vm:product3` → commit attestation → `evidence:verify` 0 AND
`evidence:check` 0 → push → `gh workflow run Release` → the operator approves the `npm-publish`
environment → verify `npm view @gabrielion/opnsense-mcp version` returns `0.1.1`.

## Self-review notes

- N3 (untested claims) is closed structurally: the race test executes the EEXIST/loser and sweep
  paths in real processes (Task 1), and the fsync claims are no longer asserted anywhere as
  "pinned" (Task 8 rewrites the records; the original slice-1 plan text stays as history — its
  claims are corrected by the ledger, which is the durable record).
- The retry bound (5) trades a bounded number of extra validated reads on persistent nlink
  corruption for liveness under the measured race rates; the stray-link test pins that it still
  terminates with the static error.
- Task 6 knowingly commits a CI step that would fail on this branch's own tarball until the
  landing reseal — the branch is never pushed, so CI never sees it stale; the gate protects
  `main` pushes, which always end with the evidence sequence.
