# P0-A Public CI Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover every failing group of the public Ubuntu/Node 22 CI run (configure, installed-package, OpenCode output-limit) from causal reproductions, without weakening a single production assertion.

**Architecture:** Three independent fixes. (1) Configure test fixtures move from the sticky global `/tmp` to a canonical private user-owned ancestor, and a new regression proves that a sticky group/other-writable ancestor is still refused by the unchanged production writer. (2) A deterministic, loopback-only npm registry fixture built from the committed lock and the `npm ci` tree replaces the `npm install --offline` dependency on the developer's npm cache; a shared preparation helper packs, installs, and verifies the installed package hermetically. (3) The OpenCode smoke runner gains an injectable package-preparation seam, an injectable output cap, and confirmed process-group cleanup, so the output-limit scenario proves the fake client was reached and the cap was actually exceeded instead of dying during packaging.

**Tech Stack:** Node.js 22 (>=22.19 <23), TypeScript 5.9 (strict, `verbatimModuleSyntax`, `exactOptionalPropertyTypes`), Vitest 4, plain ESM `.mjs` for shared script/test fixtures, `node:http`, `node:crypto`, system `/usr/bin/tar`.

## Global Constraints

Copied verbatim from `AGENTS.md`, `CLAUDE.md`, and `docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md`:

- Use Node.js 22.19.0 or newer within major 22. On the current workstation prepend `/opt/homebrew/opt/node@22/bin` to PATH; never validate with the default Node 26. Every command below assumes `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
- Install with `npm ci --ignore-scripts`.
- Never develop or test against a production firewall. Never log, commit, or pass credentials in process arguments. Preserve unrelated changes and keep commits local and atomic.
- Before a final commit run `npm run license:check`, `npm run verify`, `npm run test:conformance`, and `git diff --check`.
- Every source file carries `// SPDX-License-Identifier: AGPL-3.0-or-later` as required by `scripts/check-license-headers.mjs`.
- "Do not relax the production secure-file, link, ownership, revalidation, fsync, or rollback contract." `src/config/configure.ts` is **not** modified by this plan except for the temporary, reverted mutation used to prove a regression has teeth in Task 1 Step 6.
- "No user cache, public registry, hidden proxy, or developer working-tree module is a fallback."
- "Never weaken an assertion, ignore an exit code, reseal evidence without the real producer, or call a structural check an end-to-end proof."
- "No credential, raw backup XML, private archive path, private source mapping, or private digest enters a public file, log, MCP result, or process argument."
- "Each implementation slice starts with a failing test, ends with focused and full gates, and is recorded in `.superpowers/sdd/progress.md` with its commit and remaining limitations."
- Approved-asset reuse selection for P0-A: **none**. Every file below is a clean implementation with new tests.

## Established evidence (reproduced on 2026-07-25, Node 22.23.1, darwin)

- `TMPDIR=/tmp npx vitest run tests/config/configure.test.ts` → **16 failed | 8 passed (24)**. `/private/tmp` is `drwxrwxrwt` (`01777`), and `requireSafeAncestor` in `src/config/configure.ts:108-117` correctly refuses any ancestor with `(mode & 0o022) !== 0`. This is the exact Linux CI failure; the production policy is right and the fixture is wrong.
- `TMPDIR=/tmp npx vitest run` (whole suite) → **16 failed | 974 passed (990)**, all failures in `tests/config/configure.test.ts`. No other test file is `/tmp`-sensitive; the config *reader* (`src/opnsense/config.ts:82,133`) validates only the file itself, not its ancestors.
- `npm_config_cache=<empty dir> npx vitest run tests/integration/installed-package.test.ts` → **2 failed (2)**, both `Error: npm install failed`. `npm install --offline` (`tests/support/installed-package-harness.ts:231-242`) resolves the local tarball's transitive dependencies from packuments left in the user's npm cache.
- `npm pack --ignore-scripts <96 lock paths>` runs `prepare` lifecycle scripts anyway under npm 10.9.8 and fails with exit 127. The registry fixture therefore builds tarballs with staging + `/usr/bin/tar`, which was verified end to end: a staged `package/` directory tarred with `tar -czf out.tgz -C <stage> package` installs cleanly via `npm install <tgz>` with an empty cache and an unreachable registry.
- The committed lock has **96** non-dev, non-link production entries, with **no** `optional`, `devOptional`, `os`, `cpu`, or `hasInstallScript` entries, so the lock projection is an exact `name@version` set equality.

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/support/private-fixture-root.ts` (create) | Creates and removes fixture roots below a canonical private user-owned ancestor, and fails closed if that ancestor chain is unsafe. Consumed by TypeScript tests. |
| `scripts/testing/private-fixture-root.mjs` (create) | Same contract for `.mjs` consumers (the OpenCode runner and its test). Kept under `scripts/` because `scripts/` is a package input copied into the isolated runner fixture, while `tests/` is not. |
| `tests/config/configure.test.ts` (modify) | Uses the private fixture root; adds the sticky-ancestor regression. |
| `scripts/testing/local-npm-registry.mjs` (create) | Lock-derived, loopback-only npm registry fixture: enumerate, verify identity/containment, pack, serve packuments and tarballs, record unknown requests, clean up and prove absence. |
| `scripts/testing/local-npm-registry.d.mts` (create) | Types so TypeScript tests may import the fixture under `NodeNext` resolution. |
| `scripts/testing/prepare-installed-package.mjs` (create) | Hermetic package preparation: pack the repository package, start the registry, install into an isolated consumer, verify graph/bin/digest/no-unknown-request, expose bounded redacted diagnostics and cleanup. |
| `scripts/testing/prepare-installed-package.d.mts` (create) | Types for the same. |
| `tests/integration/local-npm-registry.test.mjs` (create) | Focused proof of the registry fixture. |
| `tests/support/installed-package-harness.ts` (modify) | `localArchiveInstallArguments` drops `--offline`, `--no-package-lock`, and `--no-save`; adds a bounded redacted command diagnostic. |
| `tests/integration/installed-package-harness.test.ts` (modify) | Updated argument expectation plus a diagnostic-redaction proof. |
| `tests/integration/installed-package.test.ts` (modify) | Consumes the preparation helper instead of its private packing code. |
| `scripts/run-opencode-smoke.mjs` (modify) | Extracts `runSmoke()` with injectable preparation, output cap, and OpenCode binary; confirms process-group cleanup before finalizing blocked evidence. |
| `tests/integration/opencode-smoke-runner.test.mjs` (modify) | Prepares once, injects the prepared invocation, proves the fake client was reached and the configured cap was exceeded, and proves confirmed group cleanup. |
| `.superpowers/sdd/progress.md` (modify) | Ledger entry after every atomic commit. |

---

### Task 1: Configure fixtures below a private ancestor + sticky-ancestor regression

**Files:**
- Create: `tests/support/private-fixture-root.ts`
- Create: `scripts/testing/private-fixture-root.mjs`
- Modify: `tests/config/configure.test.ts:1-38` (imports and hooks), plus a new test after the existing `rejects a group-writable ancestor` test at `tests/config/configure.test.ts:250-261`
- Test: `tests/config/configure.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `tests/support/private-fixture-root.ts`: `createPrivateFixtureRoot(prefix: string): Promise<string>` and `removePrivateFixtureRoot(root: string): Promise<void>`.
  - `scripts/testing/private-fixture-root.mjs`: the same two functions with the same behaviour, plus `PRIVATE_FIXTURE_BASE_NAME` (`'.opnsense-mcp-fixtures'`). Tasks 2-4 consume the `.mjs` form.

- [ ] **Step 1: Reproduce the CI failure**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && TMPDIR=/tmp npx vitest run tests/config/configure.test.ts`

Expected: `Tests  16 failed | 8 passed (24)`, with failures such as `AssertionError: expected [Function] to throw error matching /^Incomplete OPNsense configuration r…/u but got 'Invalid OPNsense configuration.'`. Record this output — it is the red state for this task.

- [ ] **Step 2: Write the shared `.mjs` fixture-root helper**

Create `scripts/testing/private-fixture-root.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstatSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, relative, sep } from 'node:path';

export const PRIVATE_FIXTURE_BASE_NAME = '.opnsense-mcp-fixtures';

function directoryComponents(path) {
  const root = parse(path).root;
  const suffix = relative(root, path);
  if (suffix === '') return [root];
  return [
    root,
    ...suffix.split(sep).map((_part, index, parts) => join(root, ...parts.slice(0, index + 1)))
  ];
}

/**
 * Fails closed when any ancestor is group/other-writable or foreign-owned. Fixtures must never
 * depend on the global sticky temporary directory, which the production secure writer correctly
 * refuses.
 */
export function assertPrivateAncestors(path) {
  if (typeof process.getuid !== 'function') {
    throw new Error('Private fixture roots require a POSIX host');
  }
  const userId = process.getuid();
  for (const component of directoryComponents(path)) {
    const stats = lstatSync(component);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (stats.uid !== 0 && stats.uid !== userId) ||
      (stats.mode & 0o022) !== 0
    ) {
      throw new Error(`Unsafe fixture ancestor: ${component}`);
    }
  }
}

export async function createPrivateFixtureRoot(prefix) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(prefix)) throw new Error('Invalid fixture prefix');
  const base = join(homedir(), PRIVATE_FIXTURE_BASE_NAME);
  await mkdir(base, { mode: 0o700, recursive: true });
  const root = await realpath(await mkdtemp(join(base, `${prefix}-`)));
  assertPrivateAncestors(root);
  return root;
}

export async function removePrivateFixtureRoot(root) {
  const base = join(homedir(), PRIVATE_FIXTURE_BASE_NAME);
  if (!root.startsWith(`${base}${sep}`)) throw new Error('Refusing to remove a foreign path');
  await rm(root, { force: true, recursive: true });
}
```

- [ ] **Step 3: Write the TypeScript fixture-root helper**

Create `tests/support/private-fixture-root.ts` with the same behaviour, typed for the strict TypeScript tests:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { lstatSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, parse, relative, sep } from 'node:path';

export const PRIVATE_FIXTURE_BASE_NAME = '.opnsense-mcp-fixtures';

function directoryComponents(path: string): readonly string[] {
  const root = parse(path).root;
  const suffix = relative(root, path);
  if (suffix === '') return [root];
  return [
    root,
    ...suffix.split(sep).map((_part, index, parts) => join(root, ...parts.slice(0, index + 1)))
  ];
}

export function assertPrivateAncestors(path: string): void {
  if (typeof process.getuid !== 'function') {
    throw new Error('Private fixture roots require a POSIX host');
  }
  const userId = process.getuid();
  for (const component of directoryComponents(path)) {
    const stats = lstatSync(component);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      (stats.uid !== 0 && stats.uid !== userId) ||
      (stats.mode & 0o022) !== 0
    ) {
      throw new Error(`Unsafe fixture ancestor: ${component}`);
    }
  }
}

export async function createPrivateFixtureRoot(prefix: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(prefix)) throw new Error('Invalid fixture prefix');
  const base = join(homedir(), PRIVATE_FIXTURE_BASE_NAME);
  await mkdir(base, { mode: 0o700, recursive: true });
  const root = await realpath(await mkdtemp(join(base, `${prefix}-`)));
  assertPrivateAncestors(root);
  return root;
}

export async function removePrivateFixtureRoot(root: string): Promise<void> {
  const base = join(homedir(), PRIVATE_FIXTURE_BASE_NAME);
  if (!root.startsWith(`${base}${sep}`)) throw new Error('Refusing to remove a foreign path');
  await rm(root, { force: true, recursive: true });
}
```

- [ ] **Step 4: Point the configure fixtures at the private root**

In `tests/config/configure.test.ts`, delete the `tmpdir` import on line 16 and replace the hooks on lines 32-38:

```ts
import {
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../support/private-fixture-root.js';

let directory = '';

beforeEach(async () => {
  directory = await createPrivateFixtureRoot('opnsense-configure-test');
});

afterEach(async () => {
  await removePrivateFixtureRoot(directory);
});
```

Keep every other line of the file unchanged; `realpath` is already applied inside the helper, so remove the now-unused `realpath` import only if TypeScript reports it unused (it is still used elsewhere in the file — verify with `npm run typecheck` in Step 8 rather than guessing).

- [ ] **Step 5: Add the sticky-ancestor regression**

Insert this test immediately after the existing `rejects a group-writable ancestor` test (`tests/config/configure.test.ts:250-261`):

```ts
  it('rejects a sticky world-writable ancestor without creating anything below it', async () => {
    const stickyAncestor = join(directory, 'sticky');
    await mkdir(stickyAncestor, { mode: 0o700 });
    await chmod(stickyAncestor, 0o1777);

    expect(() => {
      writePrivateOPNsenseConfigFile(join(stickyAncestor, 'opnsense-mcp', 'config.json'), document);
    }).toThrow(/^Invalid OPNsense configuration\.$/u);

    await expect(lstat(join(stickyAncestor, 'opnsense-mcp'))).rejects.toMatchObject({
      code: 'ENOENT'
    });
  });
```

`chmod`, `lstat`, `mkdir`, and `join` are already imported by this file.

- [ ] **Step 6: Prove the new regression has teeth, then restore**

Temporarily weaken the production check in `src/config/configure.ts:113` from `(stats.mode & 0o022) !== 0` to `(stats.mode & 0o002) !== 0 && (stats.mode & 0o1000) === 0`.

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/config/configure.test.ts -t 'sticky world-writable'`

Expected: FAIL (the write succeeds and no `Invalid OPNsense configuration.` is thrown).

Then restore `src/config/configure.ts` exactly:

```bash
git checkout -- src/config/configure.ts
git diff --stat src/config/configure.ts
```

Expected: empty diff. `src/config/configure.ts` must be unchanged in the commit.

- [ ] **Step 7: Run the focused green gate**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && TMPDIR=/tmp npx vitest run tests/config/configure.test.ts && npx vitest run tests/config/configure.test.ts`

Expected: both invocations report `Tests  25 passed (25)` (24 existing + 1 new). The `TMPDIR=/tmp` invocation is the Linux-CI-equivalent proof: the fixture no longer depends on the temporary directory at all.

- [ ] **Step 8: Run the focused static gates**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run format:check && npm run lint && npm run typecheck && npm run license:check`

Expected: all four pass. If `format:check` fails, run `npm run format` and re-run.

- [ ] **Step 9: Prove no fixture residue**

Run: `ls -a "$HOME/.opnsense-mcp-fixtures"` and `git status --porcelain=v1 --untracked-files=all`

Expected: the fixtures directory contains only `.` and `..`; git status prints only the intended modified/added files.

- [ ] **Step 10: Commit**

```bash
git add tests/support/private-fixture-root.ts scripts/testing/private-fixture-root.mjs tests/config/configure.test.ts
git commit -m "test: run configure fixtures below a private user-owned ancestor"
```

- [ ] **Step 11: Record the slice in the ledger**

Append to `.superpowers/sdd/progress.md` under a new `P0-A` heading:

```markdown
P0-A step 1 (configure group): complete (commit <sha>).
  - Cause: fixtures were created below the global sticky `/tmp` (`01777`), which the production
    secure writer correctly refuses via the ancestor `(mode & 0o022)` check.
  - Fix is fixture-only: `tests/support/private-fixture-root.ts` and
    `scripts/testing/private-fixture-root.mjs` create roots below `$HOME/.opnsense-mcp-fixtures`
    and fail closed on an unsafe ancestor chain. `src/config/configure.ts` is byte-identical.
  - New regression proves a sticky world-writable ancestor is still refused and nothing is created
    below it; the regression was proven to fail against a deliberately weakened check, which was
    then reverted.
  - Gate: `TMPDIR=/tmp npx vitest run tests/config/configure.test.ts` 25/25, plus format/lint/
    typecheck/license.
```

Then: `git add .superpowers/sdd/progress.md && git commit -m "docs: record P0-A configure recovery"`

---

### Task 2: Deterministic loopback-only npm registry fixture

**Files:**
- Create: `scripts/testing/local-npm-registry.mjs`
- Create: `scripts/testing/local-npm-registry.d.mts`
- Test: `tests/integration/local-npm-registry.test.mjs`

**Interfaces:**
- Consumes: `createPrivateFixtureRoot`, `removePrivateFixtureRoot` from `scripts/testing/private-fixture-root.mjs` (Task 1).
- Produces:

```ts
export interface LocalNpmRegistryPackage {
  readonly name: string;
  readonly version: string;
  readonly installPath: string;
  readonly integrity: string;
  readonly shasum: string;
  readonly tarballBytes: number;
}
export interface LocalNpmRegistry {
  readonly url: string;
  readonly port: number;
  readonly packages: readonly LocalNpmRegistryPackage[];
  requests(): readonly string[];
  unknownRequests(): readonly string[];
  close(): Promise<void>;
}
export function lockProductionProjection(lock: unknown): readonly string[];
export function startLocalNpmRegistry(options: {
  readonly repositoryRoot: string;
  readonly workRoot: string;
}): Promise<LocalNpmRegistry>;
```

Task 3 consumes `startLocalNpmRegistry` and `lockProductionProjection`.

- [ ] **Step 1: Write the failing fixture test**

Create `tests/integration/local-npm-registry.test.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../../scripts/testing/private-fixture-root.mjs';
import {
  lockProductionProjection,
  startLocalNpmRegistry
} from '../../scripts/testing/local-npm-registry.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let workRoot;
let registry;

beforeAll(async () => {
  workRoot = await createPrivateFixtureRoot('opnsense-registry-test');
  registry = await startLocalNpmRegistry({ repositoryRoot, workRoot });
}, 180_000);

afterAll(async () => {
  if (registry !== undefined) await registry.close();
  if (workRoot !== undefined) await removePrivateFixtureRoot(workRoot);
});

async function fetchJson(path) {
  const response = await fetch(new URL(path, registry.url));
  return { status: response.status, body: response.ok ? await response.json() : undefined };
}

describe('lock-derived loopback npm registry', () => {
  it('serves exactly the committed production projection', async () => {
    const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url)));
    const projection = [...lockProductionProjection(lock)].sort();

    expect(registry.packages.map(({ name, version }) => `${name}@${version}`).sort()).toEqual(
      projection
    );
    expect(registry.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/u);
  });

  it('publishes a packument whose tarball matches the advertised integrity', async () => {
    const packument = await fetchJson('/zod');
    const locked = registry.packages.find(({ name }) => name === 'zod');
    const distribution = packument.body.versions[locked.version].dist;
    const tarball = Buffer.from(
      await (await fetch(distribution.tarball)).arrayBuffer()
    );

    expect(packument.status).toBe(200);
    expect(distribution.tarball.startsWith(registry.url)).toBe(true);
    expect(`sha512-${createHash('sha512').update(tarball).digest('base64')}`).toBe(
      distribution.integrity
    );
    expect(distribution.integrity).toBe(locked.integrity);
    expect(tarball.byteLength).toBe(locked.tarballBytes);
  });

  it('encodes scoped names and preserves the locked dependency manifest', async () => {
    const encoded = await fetchJson('/@modelcontextprotocol%2Fsdk');
    const plain = await fetchJson('/@modelcontextprotocol/sdk');
    const locked = registry.packages.find(({ name }) => name === '@modelcontextprotocol/sdk');
    const installed = JSON.parse(
      await readFile(resolve(repositoryRoot, locked.installPath, 'package.json'), 'utf8')
    );

    expect(encoded.status).toBe(200);
    expect(plain.body).toEqual(encoded.body);
    expect(encoded.body.versions[locked.version].dependencies).toEqual(installed.dependencies);
  });

  it('refuses and records any request outside the locked projection', async () => {
    const before = registry.unknownRequests().length;
    const missing = await fetch(new URL('/left-pad', registry.url));

    expect(missing.status).toBe(404);
    expect(registry.unknownRequests().slice(before)).toEqual(['GET /left-pad']);
  });

  it('removes every tarball and staging path on close', async () => {
    const local = await createPrivateFixtureRoot('opnsense-registry-close');
    const disposable = await startLocalNpmRegistry({ repositoryRoot, workRoot: local });
    await disposable.close();

    await expect(access(`${local}/tarballs`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(`${local}/stage`)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fetch(disposable.url)).rejects.toThrow();
    await removePrivateFixtureRoot(local);
  }, 180_000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/integration/local-npm-registry.test.mjs`

Expected: FAIL with `Failed to load .../scripts/testing/local-npm-registry.mjs` (module does not exist).

- [ ] **Step 3: Implement the registry fixture**

Create `scripts/testing/local-npm-registry.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';

const TAR = '/usr/bin/tar';
const MANIFEST_FIELDS = [
  'name',
  'version',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'engines',
  'bin',
  'os',
  'cpu',
  'license'
];

function lockEntries(lock) {
  const packages = lock?.packages;
  if (typeof packages !== 'object' || packages === null) throw new Error('Unreadable lock file');
  return Object.entries(packages)
    .filter(([path, meta]) => path !== '' && meta?.dev !== true && meta?.link !== true)
    .map(([path, meta]) => {
      const marker = 'node_modules/';
      const index = path.lastIndexOf(marker);
      if (!path.startsWith(marker) || index < 0) {
        throw new Error(`Unsupported lock entry: ${path}`);
      }
      const name = path.slice(index + marker.length);
      if (typeof meta.version !== 'string' || meta.version === '') {
        throw new Error(`Lock entry without a version: ${path}`);
      }
      if (meta.name !== undefined && meta.name !== name) {
        throw new Error(`Lock entry name mismatch: ${path}`);
      }
      return { installPath: path, name, version: meta.version };
    });
}

export function lockProductionProjection(lock) {
  return Object.freeze([
    ...new Set(lockEntries(lock).map(({ name, version }) => `${name}@${version}`))
  ]);
}

function uniqueEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const key = `${entry.name}@${entry.version}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

async function verifiedPackage(repositoryRoot, entry) {
  const directory = resolve(repositoryRoot, entry.installPath);
  if (directory !== join(repositoryRoot, ...entry.installPath.split('/'))) {
    throw new Error(`Non-canonical package path: ${entry.installPath}`);
  }
  if (!directory.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`Package path escapes the repository: ${entry.installPath}`);
  }
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== entry.name || manifest.version !== entry.version) {
    throw new Error(`Installed identity mismatch for ${entry.name}@${entry.version}`);
  }
  return { ...entry, directory, manifest };
}

function runTar(argumentsList) {
  return new Promise((resolveTar, rejectTar) => {
    const child = spawn(TAR, argumentsList, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, 512);
    });
    child.once('error', () => rejectTar(new Error('Fixture archiver is unavailable')));
    child.once('close', (code, signal) => {
      if (code === 0 && signal === null) {
        resolveTar();
        return;
      }
      rejectTar(new Error(`Fixture archiver failed (${String(code)}/${String(signal)}): ${stderr}`));
    });
  });
}

async function packPackage(pkg, index, workRoot) {
  const stage = join(workRoot, 'stage', String(index));
  const contents = join(stage, 'package');
  await mkdir(stage, { mode: 0o700, recursive: true });
  await cp(pkg.directory, contents, { recursive: true, dereference: false });
  await rm(join(contents, 'node_modules'), { force: true, recursive: true });
  const file = `${pkg.name.replace('/', '+')}-${pkg.version}.tgz`;
  const archive = join(workRoot, 'tarballs', file);
  await runTar(['-czf', archive, '-C', stage, 'package']);
  const bytes = await readFile(archive);
  await rm(stage, { force: true, recursive: true });
  return {
    file,
    bytes,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex')
  };
}

function versionManifest(pkg, url) {
  const manifest = Object.fromEntries(
    MANIFEST_FIELDS.filter((field) => pkg.manifest[field] !== undefined).map((field) => [
      field,
      pkg.manifest[field]
    ])
  );
  return {
    ...manifest,
    name: pkg.name,
    version: pkg.version,
    dist: {
      tarball: `${url}tarballs/${pkg.file}`,
      integrity: pkg.integrity,
      shasum: pkg.shasum
    }
  };
}

function highestVersion(versions) {
  return [...versions].sort((left, right) =>
    left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
  ).at(-1);
}

export async function startLocalNpmRegistry(options) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const workRoot = resolve(options.workRoot);
  await mkdir(join(workRoot, 'tarballs'), { mode: 0o700, recursive: true });
  const lock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'));
  const entries = uniqueEntries(lockEntries(lock));
  const packages = [];
  for (const [index, entry] of entries.entries()) {
    const verified = await verifiedPackage(repositoryRoot, entry);
    packages.push({ ...verified, ...(await packPackage(verified, index, workRoot)) });
  }

  const requests = [];
  const unknown = [];
  const tarballs = new Map(packages.map((pkg) => [`/tarballs/${pkg.file}`, pkg]));
  const byName = new Map();
  for (const pkg of packages) {
    const existing = byName.get(pkg.name) ?? [];
    byName.set(pkg.name, [...existing, pkg]);
  }

  let url = '';
  const server = createServer((request, response) => {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      path = request.url ?? '/';
    }
    const line = `${request.method ?? ''} ${path}`;
    requests.push(line);
    const tarball = tarballs.get(path);
    if (request.method === 'GET' && tarball !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(tarball.bytes);
      return;
    }
    const versions = byName.get(path.startsWith('/') ? path.slice(1) : path);
    if (request.method === 'GET' && versions !== undefined) {
      const document = {
        name: versions[0].name,
        'dist-tags': { latest: highestVersion(versions.map(({ version }) => version)) },
        versions: Object.fromEntries(
          versions.map((pkg) => [pkg.version, versionManifest(pkg, url)])
        )
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(document));
      return;
    }
    unknown.push(line);
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"Not found in the lock-derived fixture registry"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Registry startup failed');
  url = `http://127.0.0.1:${String(address.port)}/`;

  return {
    url,
    port: address.port,
    packages: Object.freeze(
      packages.map((pkg) =>
        Object.freeze({
          name: pkg.name,
          version: pkg.version,
          installPath: pkg.installPath,
          integrity: pkg.integrity,
          shasum: pkg.shasum,
          tarballBytes: pkg.bytes.byteLength
        })
      )
    ),
    requests: () => Object.freeze([...requests]),
    unknownRequests: () => Object.freeze([...unknown]),
    close: async () => {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
        server.closeAllConnections();
      });
      await rm(join(workRoot, 'tarballs'), { force: true, recursive: true });
      await rm(join(workRoot, 'stage'), { force: true, recursive: true });
    }
  };
}

export const FIXTURE_ARCHIVER = TAR;
export const FIXTURE_TARBALL_NAME = (name, version) =>
  `${basename(name.replace('/', '+'))}-${version}.tgz`;
```

- [ ] **Step 4: Write the TypeScript declarations**

Create `scripts/testing/local-npm-registry.d.mts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export interface LocalNpmRegistryPackage {
  readonly name: string;
  readonly version: string;
  readonly installPath: string;
  readonly integrity: string;
  readonly shasum: string;
  readonly tarballBytes: number;
}

export interface LocalNpmRegistry {
  readonly url: string;
  readonly port: number;
  readonly packages: readonly LocalNpmRegistryPackage[];
  requests(): readonly string[];
  unknownRequests(): readonly string[];
  close(): Promise<void>;
}

export declare function lockProductionProjection(lock: unknown): readonly string[];
export declare function startLocalNpmRegistry(options: {
  readonly repositoryRoot: string;
  readonly workRoot: string;
}): Promise<LocalNpmRegistry>;
export declare const FIXTURE_ARCHIVER: string;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/integration/local-npm-registry.test.mjs`

Expected: `Tests  5 passed (5)`. If the projection assertion fails, print both sides and fix the enumeration — never relax the assertion to a subset.

- [ ] **Step 6: Prove hermeticity by hand**

Run:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node --input-type=module -e '
import { createPrivateFixtureRoot, removePrivateFixtureRoot } from "./scripts/testing/private-fixture-root.mjs";
import { startLocalNpmRegistry } from "./scripts/testing/local-npm-registry.mjs";
const root = await createPrivateFixtureRoot("opnsense-registry-manual");
const registry = await startLocalNpmRegistry({ repositoryRoot: process.cwd(), workRoot: root });
console.log(registry.url, registry.packages.length);
await new Promise((done) => setTimeout(done, 120000));
await registry.close();
await removePrivateFixtureRoot(root);
' &
```

While it runs, in a second shell install `express` into a throwaway consumer with an empty cache and a dead proxy sentinel, pointing at the printed URL:

```bash
D=$(mktemp -d "$HOME/.opnsense-mcp-fixtures/manual-XXXX"); mkdir "$D/consumer" "$D/cache" "$D/home"
echo '{"private":true,"name":"manual","version":"0.0.0"}' > "$D/consumer/package.json"
(cd "$D/consumer" && HOME="$D/home" npm_config_cache="$D/cache" npm_config_registry="<printed url>" \
  npm_config_proxy=http://127.0.0.1:1/ npm_config_https_proxy=http://127.0.0.1:1/ \
  npm_config_noproxy=127.0.0.1,localhost npm install --ignore-scripts --no-audit --no-fund express)
node -e "console.log(require('$D/consumer/node_modules/express/package.json').version)"
rm -rf "$D"
```

Expected: the install succeeds with no network access and prints the locked express version (`5.2.1`). Record this in the commit message body only as a plain statement — no paths.

- [ ] **Step 7: Run the focused static gates**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run format:check && npm run lint && npm run typecheck && npm run license:check`

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/testing/local-npm-registry.mjs scripts/testing/local-npm-registry.d.mts tests/integration/local-npm-registry.test.mjs
git commit -m "test: add a lock-derived loopback-only npm registry fixture"
```

- [ ] **Step 9: Record the slice in the ledger**

Append to `.superpowers/sdd/progress.md`:

```markdown
P0-A step 2 (registry fixture): complete (commit <sha>).
  - `scripts/testing/local-npm-registry.mjs` enumerates the 96 non-dev lock entries, verifies each
    installed identity and path containment, packs each package from the `npm ci` tree through a
    private staging directory and `/usr/bin/tar`, and serves only those canonical packuments and
    tarballs on a random loopback port.
  - Unknown requests are refused with 404 and recorded; `close()` removes and proves absence of the
    tarball and staging directories.
  - Limitation: `npm pack` could not be used for the fixture because npm 10.9.8 runs `prepare`
    lifecycle scripts for directory specs even with `--ignore-scripts`.
```

Then commit the ledger.

---

### Task 3: Hermetic installed-package preparation

**Files:**
- Create: `scripts/testing/prepare-installed-package.mjs`
- Create: `scripts/testing/prepare-installed-package.d.mts`
- Modify: `tests/support/installed-package-harness.ts:231-242`
- Modify: `tests/integration/installed-package-harness.test.ts:100-110`
- Modify: `tests/integration/installed-package.test.ts:27-171`
- Test: `tests/integration/installed-package.test.ts`, `tests/integration/installed-package-harness.test.ts`

**Interfaces:**
- Consumes: `startLocalNpmRegistry`, `lockProductionProjection` (Task 2); `createPrivateFixtureRoot`, `removePrivateFixtureRoot` (Task 1).
- Produces:

```ts
export interface PreparedInstalledPackage {
  readonly archiveSha256: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installedCommand: { readonly command: string; readonly arguments: readonly string[] };
  readonly installedTarget: string;
  readonly consumerRoot: string;
  readonly registryUnknownRequests: readonly string[];
  cleanup(): Promise<void>;
}
export function prepareInstalledPackage(options: {
  readonly repositoryRoot: string;
  readonly workRoot: string;
  readonly run: CommandRunner;
}): Promise<PreparedInstalledPackage>;
export function redactedCommandFailure(label: string, result: {...}, secrets: readonly string[]): Error;
```

Task 4 consumes `prepareInstalledPackage`.

- [ ] **Step 1: Reproduce the packaging failure**

Run:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
D=$(mktemp -d "$HOME/.opnsense-mcp-fixtures/emptycache-XXXX")
npm_config_cache=$D npx vitest run tests/integration/installed-package.test.ts; rm -rf "$D"
```

Expected: `Tests  2 failed (2)` with `Error: npm install failed` — the red state for this task. Note that the message hides npm's real `ENOTCACHED` cause, which Step 4 fixes.

- [ ] **Step 2: Make the archive install argument list hermetic**

Replace `tests/support/installed-package-harness.ts:231-242` with:

```ts
export function localArchiveInstallArguments(archive: string): readonly string[] {
  return Object.freeze(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
}
```

`--offline` is removed because network isolation and the complete local fixture, not npm cache mode,
prove that no Internet dependency exists. `--no-package-lock` and `--no-save` are removed so the
consumer produces a real graph that `npm ls` can verify.

- [ ] **Step 3: Update the harness argument expectation**

Replace the assertion at `tests/integration/installed-package-harness.test.ts:100-110` and rename the test:

```ts
  it('installs the local archive without lifecycle scripts, audit, or funding traffic', () => {
    expect(localArchiveInstallArguments('/tmp/package.tgz')).toEqual([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '/tmp/package.tgz'
    ]);
  });
```

- [ ] **Step 4: Implement the preparation helper**

Create `scripts/testing/prepare-installed-package.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { lockProductionProjection, startLocalNpmRegistry } from './local-npm-registry.mjs';

export const PACKAGE_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'src',
  'scripts',
  'tsconfig.json',
  'tsconfig.build.json'
]);

const DIAGNOSTIC_LIMIT = 512;

export function redactedCommandFailure(label, result, secrets) {
  const tail = `${result.stderr ?? ''}`.slice(-DIAGNOSTIC_LIMIT);
  const redacted = secrets
    .filter((secret) => typeof secret === 'string' && secret !== '')
    .reduce((text, secret) => text.split(secret).join('<redacted>'), tail)
    .replace(/[^\t\n\x20-\x7e]/gu, '?');
  return new Error(
    `${label} failed (exit ${String(result.code)}, signal ${String(result.signal)}): ${redacted}`
  );
}

function isolatedNpmEnvironment(paths, registryUrl, extra = {}) {
  return {
    PATH: process.env.PATH ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
    HOME: paths.home,
    npm_config_cache: paths.cache,
    npm_config_userconfig: paths.userconfig,
    npm_config_globalconfig: paths.globalconfig,
    npm_config_registry: registryUrl,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_fetch_retries: '0',
    npm_config_loglevel: 'error',
    npm_config_proxy: 'http://127.0.0.1:1/',
    npm_config_https_proxy: 'http://127.0.0.1:1/',
    npm_config_noproxy: '127.0.0.1,localhost',
    ...extra
  };
}

function installedGraph(node, collected = new Set()) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (typeof entry?.version === 'string') collected.add(`${name}@${entry.version}`);
    installedGraph(entry ?? {}, collected);
  }
  return collected;
}

export async function prepareInstalledPackage(options) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const workRoot = resolve(options.workRoot);
  const run = options.run;
  const packageCopy = join(workRoot, 'package');
  const consumer = join(workRoot, 'consumer');
  const paths = {
    home: join(workRoot, 'home'),
    cache: join(workRoot, 'cache'),
    userconfig: join(workRoot, 'home', '.npmrc'),
    globalconfig: join(workRoot, 'home', 'globalrc')
  };
  await Promise.all(
    [packageCopy, consumer, paths.home, paths.cache].map((path) =>
      mkdir(path, { mode: 0o700, recursive: true })
    )
  );
  await Promise.all(
    [paths.userconfig, paths.globalconfig].map((path) => writeFile(path, '', { mode: 0o600 }))
  );
  await Promise.all(
    PACKAGE_INPUTS.map((input) =>
      cp(join(repositoryRoot, input), join(packageCopy, input), { recursive: true })
    )
  );
  await symlink(join(repositoryRoot, 'node_modules'), join(packageCopy, 'node_modules'), 'dir');

  const manifest = JSON.parse(await readFile(join(packageCopy, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('Package identity is unavailable');
  }
  const registry = await startLocalNpmRegistry({ repositoryRoot, workRoot });
  const npm = { command: process.execPath, arguments: [requiredNpmCli()] };

  const packed = await run(
    npm.command,
    [...npm.arguments, 'pack', '--json'],
    {
      cwd: packageCopy,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: 120_000
    }
  );
  if (packed.code !== 0 || packed.signal !== null) {
    throw redactedCommandFailure('npm pack', packed, [workRoot, repositoryRoot]);
  }
  const archives = (await readdir(packageCopy)).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error('npm pack output was not unique');
  const archive = join(packageCopy, archives[0]);
  const archiveBytes = await readFile(archive);
  const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');

  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'opnsense-mcp-consumer', version: '0.0.0', private: true }, null, 2)}\n`,
    { mode: 0o600 }
  );
  const installed = await run(
    npm.command,
    [...npm.arguments, 'install', '--ignore-scripts', '--no-audit', '--no-fund', archive],
    {
      cwd: consumer,
      environment: isolatedNpmEnvironment(paths, registry.url, {
        npm_config_ignore_scripts: 'true'
      }),
      timeoutMs: 180_000
    }
  );
  if (installed.code !== 0 || installed.signal !== null) {
    throw redactedCommandFailure('npm install', installed, [workRoot, repositoryRoot]);
  }

  const listed = await run(
    npm.command,
    [...npm.arguments, 'ls', '--all', '--json', '--omit=dev'],
    {
      cwd: consumer,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: 60_000
    }
  );
  if (listed.code !== 0 || listed.signal !== null) {
    throw redactedCommandFailure('npm ls', listed, [workRoot, repositoryRoot]);
  }
  const lock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'));
  const expected = [...lockProductionProjection(lock)].sort();
  const observed = [...installedGraph(JSON.parse(listed.stdout))]
    .filter((entry) => entry !== `${manifest.name}@${manifest.version}`)
    .sort();
  if (observed.join('\n') !== expected.join('\n')) {
    throw new Error(
      `Installed production graph differs from the committed lock projection (${String(observed.length)} vs ${String(expected.length)})`
    );
  }

  const installedTarget = join(consumer, 'node_modules', manifest.name, 'dist/main.js');
  const emitted = await readFile(installedTarget);
  const prefix = Buffer.from(
    '#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-or-later\n',
    'utf8'
  );
  if (!emitted.subarray(0, prefix.length).equals(prefix)) {
    throw new Error('Installed bin target lost its shebang or licence header');
  }
  const unknown = registry.unknownRequests();
  if (unknown.length !== 0) {
    throw new Error(`Fixture registry saw ${String(unknown.length)} unknown request(s)`);
  }

  return {
    archiveSha256,
    packageName: manifest.name,
    packageVersion: manifest.version,
    installedCommand: Object.freeze({
      command: join(consumer, 'node_modules/.bin/opnsense-mcp'),
      arguments: Object.freeze([])
    }),
    installedTarget,
    consumerRoot: consumer,
    registryUnknownRequests: unknown,
    cleanup: async () => {
      await registry.close();
      await rm(packageCopy, { force: true, recursive: true });
      await rm(consumer, { force: true, recursive: true });
      await rm(paths.home, { force: true, recursive: true });
      await rm(paths.cache, { force: true, recursive: true });
    }
  };
}

function requiredNpmCli() {
  const npmCli = process.env.npm_execpath;
  if (typeof npmCli !== 'string' || npmCli === '') throw new Error('npm CLI path is unavailable');
  return npmCli;
}
```

- [ ] **Step 5: Write the TypeScript declarations**

Create `scripts/testing/prepare-installed-package.d.mts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export interface PreparedCommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type PreparedCommandRunner = (
  command: string,
  argumentsList: readonly string[],
  options: {
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
  }
) => Promise<PreparedCommandResult>;

export interface PreparedInstalledPackage {
  readonly archiveSha256: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installedCommand: { readonly command: string; readonly arguments: readonly string[] };
  readonly installedTarget: string;
  readonly consumerRoot: string;
  readonly registryUnknownRequests: readonly string[];
  cleanup(): Promise<void>;
}

export declare const PACKAGE_INPUTS: readonly string[];
export declare function redactedCommandFailure(
  label: string,
  result: PreparedCommandResult,
  secrets: readonly string[]
): Error;
export declare function prepareInstalledPackage(options: {
  readonly repositoryRoot: string;
  readonly workRoot: string;
  readonly run: PreparedCommandRunner;
}): Promise<PreparedInstalledPackage>;
```

- [ ] **Step 6: Rewrite `withInstalledPackage` on top of the helper**

In `tests/integration/installed-package.test.ts`, replace lines 27-151 (`PACKAGE_INPUTS` through the end of `withInstalledPackage`) with:

```ts
import {
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../support/private-fixture-root.js';
import {
  prepareInstalledPackage,
  type PreparedInstalledPackage
} from '../../scripts/testing/prepare-installed-package.mjs';

const PACKAGE_TEST_TIMEOUT_MS = 300_000;
const MCP_COMMAND_TIMEOUT_MS = 3_000;
const COMMAND_CLEANUP_TIMEOUT_MS = 2_000;

const preparationRunner = async (
  command: string,
  argumentsList: readonly string[],
  options: { readonly cwd: string; readonly environment: Readonly<Record<string, string>>; readonly timeoutMs: number }
) =>
  runBoundedCommand(
    { command, arguments: [...argumentsList] },
    {
      cwd: options.cwd,
      environment: { ...options.environment },
      input: '',
      timeoutMs: options.timeoutMs,
      cleanupTimeoutMs: COMMAND_CLEANUP_TIMEOUT_MS
    }
  );

async function withInstalledPackage(
  assertion: (installed: PreparedInstalledPackage) => Promise<void>
): Promise<void> {
  const workRoot = await createPrivateFixtureRoot('opnsense-installed-package');
  let prepared: PreparedInstalledPackage | undefined;
  try {
    prepared = await prepareInstalledPackage({
      repositoryRoot: resolve('.'),
      workRoot,
      run: preparationRunner
    });
    await assertion(prepared);
  } finally {
    if (prepared !== undefined) await prepared.cleanup();
    await removePrivateFixtureRoot(workRoot);
  }
}
```

Then update the two tests:

- The first test body becomes `withInstalledPackage(async ({ installedTarget }) => { const emitted = await readFile(installedTarget); ... })` with the same shebang assertion (the helper already checks it; the test keeps its own independent assertion).
- The second test replaces `({ archiveSha256, command }, packageCopy)` with `({ archiveSha256, installedCommand, consumerRoot })`, uses `installedCommand` in `runInstalledCommand`, keeps `expect(evidence.package?.sha256).toBe(archiveSha256)`, and replaces the final `packageRoot` absence assertions with:

```ts
      await expect(access(consumerRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(fixtureRoot)).rejects.toMatchObject({ code: 'ENOENT' });
```

Capture `consumerRoot` into an outer `let consumerPath: string | undefined` inside the assertion so it is still readable after `withInstalledPackage` returns, exactly as `packageRoot` was. Delete the now-unused `WORST_CASE_PACKAGE_TEST_MS` guard, the `PACK_TIMEOUT_MS`/`INSTALL_TIMEOUT_MS` constants, `requireSuccessfulCommand`, `packageHarnessPlatform`, `localArchiveInstallArguments`, `symlink`, `cp`, `mkdir`, `mkdtemp`, `readdir`, `createHash`, `tmpdir`, `dirname`, and `COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS` imports if TypeScript reports them unused.

Replace the fixture root of the second test (`mkdtemp(join(tmpdir(), 'mcp-product1a-fixture-'))`) with `createPrivateFixtureRoot('mcp-product1a-fixture')` and its `rm` with `removePrivateFixtureRoot`.

- [ ] **Step 7: Run the tests to verify they pass, with an empty npm cache**

Run:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
D=$(mktemp -d "$HOME/.opnsense-mcp-fixtures/emptycache-XXXX")
npm_config_cache=$D npx vitest run tests/integration/installed-package.test.ts tests/integration/installed-package-harness.test.ts
rm -rf "$D"
```

Expected: all tests pass. This is the exact condition that fails today. Then re-run without the empty cache to confirm both paths pass.

- [ ] **Step 8: Prove the diagnostic is bounded and redacted**

Add to `tests/integration/installed-package-harness.test.ts`:

```ts
  it('bounds and redacts a failed preparation command diagnostic', () => {
    const failure = redactedCommandFailure(
      'npm install',
      {
        code: 1,
        signal: null,
        stdout: '',
        stderr: `${'q'.repeat(4096)} /private/work/secret-path npm error code ENOTCACHED`
      },
      ['/private/work/secret-path']
    );

    expect(failure.message).toContain('npm install failed (exit 1, signal null)');
    expect(failure.message).toContain('ENOTCACHED');
    expect(failure.message).not.toContain('/private/work/secret-path');
    expect(failure.message).toContain('<redacted>');
    expect(failure.message.length).toBeLessThan(700);
  });
```

Import `redactedCommandFailure` from `'../../scripts/testing/prepare-installed-package.mjs'` at the top of that file.

Run: `npx vitest run tests/integration/installed-package-harness.test.ts` — expected PASS.

- [ ] **Step 9: Run the focused static gates**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run format:check && npm run lint && npm run typecheck && npm run license:check`

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add scripts/testing/prepare-installed-package.mjs scripts/testing/prepare-installed-package.d.mts \
  tests/support/installed-package-harness.ts tests/integration/installed-package-harness.test.ts \
  tests/integration/installed-package.test.ts
git commit -m "test: install the packaged server from a hermetic loopback registry"
```

- [ ] **Step 11: Record the slice in the ledger**

Append to `.superpowers/sdd/progress.md`:

```markdown
P0-A step 3 (installed-package group): complete (commit <sha>).
  - Cause: `npm install --offline` resolved the local tarball's transitive dependencies from
    packuments left in the user's npm cache; a clean cache reproduces `ENOTCACHED`.
  - `scripts/testing/prepare-installed-package.mjs` packs the repository package, starts the
    lock-derived loopback registry, installs into a consumer with a new home, empty user/global npm
    configuration, an empty cache, and proxy sentinels, then verifies the `npm ls` production graph
    against the committed lock projection, the installed shebang/licence prefix, and that the
    registry saw zero unknown requests.
  - `--offline` was removed from the install path; isolation and the complete local fixture, not npm
    cache mode, prove there is no Internet dependency.
  - Command failures now surface a bounded, redacted exit-code and stderr diagnostic instead of
    `npm install failed`.
```

Then commit the ledger.

---

### Task 4: OpenCode output-limit scenario reaches the fake client

**Files:**
- Modify: `scripts/run-opencode-smoke.mjs` (`runBounded`, `run`, new exported `runSmoke`)
- Modify: `tests/integration/opencode-smoke-runner.test.mjs:202-277`
- Test: `tests/integration/opencode-smoke-runner.test.mjs`

**Interfaces:**
- Consumes: `prepareInstalledPackage` (Task 3), `createPrivateFixtureRoot`/`removePrivateFixtureRoot` (Task 1).
- Produces:

```ts
export interface SmokeResult {
  readonly status: 'passed' | 'blocked';
  readonly exitCode: 0 | 3;
  readonly blockedReason: string | null;
  readonly modelFailure: 'spawn' | 'timeout' | 'output-limit' | null;
  readonly groupCleanupConfirmed: boolean;
}
export function runSmoke(options: {
  evidencePath: string;
  preparePackage?: () => Promise<PreparedInstalledPackage>;
  openCodeBinary?: string;
  outputLimitBytes?: number;
  workRoot?: string;
}): Promise<SmokeResult>;
export const OUTPUT_LIMIT_BYTES: number;
```

- [ ] **Step 1: Write the failing output-limit test**

Replace `tests/integration/opencode-smoke-runner.test.mjs:202-247` (the `writes blocked evidence and removes temporary state when model output exceeds the bound` test) with:

```js
  it('reaches the fake client, exceeds the configured cap, and confirms group cleanup', async () => {
    const fixtureRoot = await createPrivateFixtureRoot('opnsense-opencode-output-limit');
    const fakeOpenCode = join(fixtureRoot, 'opencode');
    const evidencePath = join(fixtureRoot, 'evidence.json');
    const rootsBefore = await smokeRoots();
    try {
      await writeFile(
        fakeOpenCode,
        `#!/usr/bin/env node
const command = process.argv.slice(2);
if (command[0] === '--version') {
  process.stdout.write('1.18.3\\n');
} else if (command[0] === 'mcp' && command[1] === 'list') {
  process.stdout.write('opnsense connected\\n');
} else if (command[0] === 'run') {
  process.stdout.write('x'.repeat(4096));
  setInterval(() => {}, 1_000);
} else {
  process.exitCode = 64;
}
`,
        { mode: 0o700 }
      );
      await chmod(fakeOpenCode, 0o700);

      const result = await runSmoke({
        evidencePath,
        preparePackage: async () => prepared,
        openCodeBinary: fakeOpenCode,
        outputLimitBytes: 64,
        workRoot: fixtureRoot
      });
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));

      expect(result).toEqual({
        status: 'blocked',
        exitCode: 3,
        blockedReason: 'model-service-unavailable',
        modelFailure: 'output-limit',
        groupCleanupConfirmed: true
      });
      expect(OUTPUT_LIMIT_BYTES).toBe(4 * 1024 * 1024);
      expect(evidence).toMatchObject({
        status: 'blocked',
        blockedReason: 'model-service-unavailable',
        checks: { mcpConnected: true, cleanupConfirmed: true }
      });
      expect(JSON.stringify(evidence)).not.toContain(fixtureRoot);
      expect(await smokeRoots()).toEqual(rootsBefore);
    } finally {
      await removePrivateFixtureRoot(fixtureRoot);
    }
  }, 120_000);
```

Add at the top of the file:

```js
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../../scripts/testing/private-fixture-root.mjs';
import { prepareInstalledPackage } from '../../scripts/testing/prepare-installed-package.mjs';
import {
  BoundedCommandFailure,
  buildOpenCodeEvidence,
  collectToolEvidence,
  runModelCommand,
  runSmoke,
  OUTPUT_LIMIT_BYTES
} from '../../scripts/run-opencode-smoke.mjs';

let preparationRoot;
let prepared;

beforeAll(async () => {
  preparationRoot = await createPrivateFixtureRoot('opnsense-opencode-package');
  prepared = await prepareInstalledPackage({
    repositoryRoot: repository,
    workRoot: preparationRoot,
    run: runFixtureCommand
  });
}, 300_000);

afterAll(async () => {
  if (prepared !== undefined) await prepared.cleanup();
  if (preparationRoot !== undefined) await removePrivateFixtureRoot(preparationRoot);
});
```

with a `runFixtureCommand(command, argumentsList, options)` helper in the same file that spawns the command with `spawn(command, argumentsList, { cwd: options.cwd, env: options.environment, shell: false, stdio: ['ignore','pipe','pipe'] })`, enforces `options.timeoutMs` with a `SIGKILL` on the process group, and resolves `{ code, signal, stdout, stderr }`.

Also update the second existing test (`leaves existing evidence untouched and exits locally after a configuration failure`) to use `createPrivateFixtureRoot`/`removePrivateFixtureRoot` instead of `mkdtemp(join(tmpdir(), ...))`; it keeps using `runCli` because it must prove the CLI wrapper's local-failure behaviour, and it must now pass `OPNSENSE_SMOKE_SKIP_PACKAGE` — no: instead give it `OPENCODE_BIN: 'relative-opencode'` **and** assert it fails before packaging by checking that the run takes the configuration path; move the absolute-path validation of `OPENCODE_BIN` in `run()` to before the packaging step (Step 3 below) so this test no longer depends on npm at all.

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/integration/opencode-smoke-runner.test.mjs`

Expected: FAIL with `SyntaxError: The requested module '../../scripts/run-opencode-smoke.mjs' does not provide an export named 'runSmoke'`.

- [ ] **Step 3: Refactor the runner**

In `scripts/run-opencode-smoke.mjs`:

1. Export the cap: `export const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;` (replacing the module-private constant).
2. Give `runBounded` an options-driven cap and confirmed group cleanup:

```js
function processGroupHasMembers(group) {
  return new Promise((resolveInspection, rejectInspection) => {
    const inspector = spawn('/bin/ps', ['-axo', 'pgid='], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '';
    inspector.stdout.on('data', (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(0, 4 * 1024 * 1024);
    });
    inspector.once('error', () => rejectInspection(new Error('Process group status failed')));
    inspector.once('close', (code, signal) => {
      if (code !== 0 || signal !== null) {
        rejectInspection(new Error('Process group status failed'));
        return;
      }
      resolveInspection(
        output.split(/\r?\n/u).some((line) => line.trim() === String(Math.abs(group)))
      );
    });
  });
}

async function confirmGroupExit(pid, deadlineMs = 5_000) {
  if (process.platform === 'win32' || pid === undefined) return false;
  const started = process.hrtime.bigint();
  while (Number(process.hrtime.bigint() - started) / 1e6 < deadlineMs) {
    if (!(await processGroupHasMembers(-pid))) return true;
    await new Promise((wait) => setTimeout(wait, 25));
  }
  return false;
}
```

`runBounded(command, arguments_, options)` gains `options.outputLimitBytes ?? OUTPUT_LIMIT_BYTES`, and on any bounded failure (`spawn`, `timeout`, `output-limit`) it: kills the group, awaits the child `close` event, awaits `confirmGroupExit(child.pid)`, and rejects with a `BoundedCommandFailure` carrying `groupCleanupConfirmed`. Add `groupCleanupConfirmed` as a second constructor parameter defaulting to `false`:

```js
export class BoundedCommandFailure extends Error {
  constructor(kind, groupCleanupConfirmed = false) {
    if (!BOUNDED_COMMAND_FAILURES.has(kind)) throw new Error('Invalid bounded command failure');
    super('Bounded command failed');
    this.name = 'BoundedCommandFailure';
    this.kind = kind;
    this.groupCleanupConfirmed = groupCleanupConfirmed;
  }
}
```

3. `runModelCommand` returns the failure detail so the caller can record it:

```js
export async function runModelCommand(execute) {
  try {
    const result = await execute();
    return result.code === 0 && result.signal === null
      ? { status: 'completed', result }
      : { status: 'blocked' };
  } catch (error) {
    if (error instanceof BoundedCommandFailure) {
      return {
        status: 'blocked',
        failure: error.kind,
        groupCleanupConfirmed: error.groupCleanupConfirmed === true
      };
    }
    throw error;
  }
}
```

The existing test `classifies a bounded model %s failure as external unavailability` must be updated to `expect(outcome).toEqual({ status: 'blocked', failure: kind, groupCleanupConfirmed: false })`, and the non-zero-result test keeps `{ status: 'blocked' }`.

4. Replace `run()`'s inline packaging with an injectable seam and validate `OPENCODE_BIN` first:

```js
export async function runSmoke(options) {
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Node.js 22 is required');
  const evidencePath = resolve(options.evidencePath);
  const outputLimitBytes = options.outputLimitBytes ?? OUTPUT_LIMIT_BYTES;
  const openCode = options.openCodeBinary ?? process.env.OPENCODE_BIN ?? join(homedir(), '.opencode', 'bin', 'opencode');
  if (!isAbsolute(openCode)) throw new Error('OPENCODE_BIN must be absolute');
  const preparePackage = options.preparePackage ?? defaultPreparePackage;
  ...
}
```

where `defaultPreparePackage` creates its own private fixture root and calls `prepareInstalledPackage` with a `run` adapter around `runBounded`. `runSmoke` keeps every existing evidence rule (mock target, `opencode --version`, `mcp list --pure`, the routed prompt, secret redaction, cleanup confirmation) and additionally records `modelFailure` and `groupCleanupConfirmed` from the routed outcome. It returns `{ status, exitCode, blockedReason, modelFailure, groupCleanupConfirmed }` where `exitCode` is `3` when blocked and `0` when passed, and it still writes the evidence file with mode `0o600` after the redaction check.

`run()` becomes the thin CLI wrapper:

```js
async function run() {
  const evidencePath = parseArguments(process.argv.slice(2));
  const result = await runSmoke({ evidencePath });
  process.stdout.write(`OpenCode Product 1A smoke: ${result.status}\n`);
  process.exitCode = result.exitCode;
}
```

The temporary smoke root created by `runSmoke` for the mock/config/XDG directories must move from `mkdtemp(join(tmpdir(), 'opnsense-opencode-smoke-'))` to `options.workRoot ?? await createPrivateFixtureRoot('opnsense-opencode-smoke')`; keep the `cleanupConfirmed` proof by checking absence of the directory it created. When `options.workRoot` is supplied the runner creates and removes a `smoke-<random>` subdirectory of it, so `smokeRoots()` in the test — which lists `tmpdir()` — stays empty and still proves nothing leaks to the global temporary directory.

- [ ] **Step 4: Run the test to verify it passes**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/integration/opencode-smoke-runner.test.mjs`

Expected: all tests pass, including `reaches the fake client, exceeds the configured cap, and confirms group cleanup`.

- [ ] **Step 5: Prove the fake client really was reached**

Temporarily change the fake client's `run` branch to `process.stdout.write('x'.repeat(4))` (below the 64-byte cap) and re-run the single test.

Expected: FAIL, because `modelFailure` is no longer `'output-limit'` and `blockedReason` becomes `tool-routing-unverified`. Restore the fake to `4096` bytes and re-run — expected PASS. This proves the assertion depends on the cap actually being exceeded rather than on packaging.

- [ ] **Step 6: Run the focused static gates**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run format:check && npm run lint && npm run typecheck && npm run license:check`

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/run-opencode-smoke.mjs tests/integration/opencode-smoke-runner.test.mjs
git commit -m "test: prove the OpenCode output-limit path reaches the fake client"
```

- [ ] **Step 8: Record the slice in the ledger**

Append to `.superpowers/sdd/progress.md`:

```markdown
P0-A step 4 (OpenCode output-limit): complete (commit <sha>).
  - Cause: the nominal output-limit test died inside the runner's own `npm install --offline`
    packaging step and never reached the fake client.
  - `runSmoke()` now takes an injectable package preparation seam, output cap, OpenCode binary, and
    work root; the focused test prepares the installed package once and injects it.
  - The scenario proves the fake client was reached (`mcpConnected: true`), that the configured cap
    was actually exceeded (`modelFailure: 'output-limit'`), and that the child closed with a
    confirmed empty process group before blocked evidence was finalized.
  - The expected result is asserted before the evidence file is read, and the test never
    manufactures evidence.
```

Then commit the ledger.

---

### Task 5: Full exit gate for P0-A

**Files:**
- Modify: `.superpowers/sdd/progress.md`
- Test: the whole suite plus both conformance profiles

- [ ] **Step 1: Run the complete verification gate**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run license:check && npm run verify && npm run test:conformance`

Expected: `verify` reports every test file passing (57+ files, 990+ tests, no failures), and conformance reports `13/13` for both `2025-11-25` and `2026-07-28`.

- [ ] **Step 2: Re-run the exact Linux-CI-equivalent conditions**

Run:

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
D=$(mktemp -d "$HOME/.opnsense-mcp-fixtures/cigate-XXXX")
TMPDIR=/tmp npm_config_cache=$D npx vitest run; rm -rf "$D"
```

Expected: zero failures. This single command reproduces both original causal conditions (sticky global temporary directory and an empty npm cache) at once.

- [ ] **Step 3: Prove there is no residue**

Run:

```bash
git diff --check
test ! -e results && echo "no results directory"
git status --porcelain=v1 --untracked-files=all
ls -a "$HOME/.opnsense-mcp-fixtures"
```

Expected: `git diff --check` silent, no `results` directory, git status clean apart from `.superpowers/sdd/progress.md` if it is not yet committed, and the fixtures directory empty apart from `.` and `..`.

- [ ] **Step 4: Request a subagent review**

Dispatch a fresh reviewer with the P0-A section of `docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md`, the diff `git diff 786f092..HEAD`, and the instruction to check specifically: no production security policy was relaxed; no assertion was weakened; no fallback to the user cache, public registry, or a working-tree module exists; no private path enters a committed file; and every new test genuinely fails without its fix. Act on the findings through `superpowers:receiving-code-review` before Step 5.

- [ ] **Step 5: Close the increment in the ledger and push**

Append to `.superpowers/sdd/progress.md`:

```markdown
P0-A: COMPLETE (commits <first>..<last>).
  - Exit gate: the three regressions failed before their fixes and pass after them; `npm run verify`
    and both conformance profiles pass on Node 22; the combined Linux-CI-equivalent run
    (`TMPDIR=/tmp` plus an empty npm cache) is green; no temporary config, package, process, or
    smoke evidence remains after the run.
  - No production security policy, output limit, cleanup contract, or evidence integrity rule was
    weakened.
```

Then:

```bash
git add .superpowers/sdd/progress.md
git commit -m "docs: close P0-A public CI recovery"
git push origin main
```

Confirm with `git status -sb` that `main` is level with `origin/main`, and verify the public CI run for the pushed commit is green before starting P0-B.

---

## Self-Review

**Spec coverage (P0-A section of the design):**

| Spec requirement | Task |
| --- | --- |
| Preserve a minimal deterministic reproduction and identify the causal boundary before editing production code | Established evidence section; Task 1 Step 1, Task 3 Step 1, Task 4 Step 2 |
| Move the configure fixture below a canonical private user-owned ancestor | Task 1 Steps 2-4 |
| Add a regression proving a sticky group/other-writable ancestor remains refused | Task 1 Steps 5-6 |
| Do not relax the production secure-file, link, ownership, revalidation, fsync, or rollback contract | Global constraints; Task 1 Step 6 restores `src/config/configure.ts` byte-identical |
| One deterministic loopback-only npm registry fixture from the committed lock and the `npm ci` tree | Task 2 Step 3 |
| Enumerate unique production `name@version`, verify installed identity and path containment, pack with scripts disabled into a private temporary directory | Task 2 Step 3 (`lockEntries`, `verifiedPackage`, `packPackage`) |
| New home, empty user/global npm configuration, empty explicit cache, loopback registry, disabled audit/fund/scripts, proxy/registry sentinels | Task 3 Step 4 (`isolatedNpmEnvironment`) |
| Normalized `npm ls` production graph equals the committed lock projection | Task 3 Step 4 (`installedGraph` vs `lockProductionProjection`) |
| Installed bin/shebang and package digest must match | Task 3 Step 4 and the retained test assertions in Task 3 Step 6 |
| Registry must report no unknown request | Task 3 Step 4 (`registryUnknownRequests` non-empty throws) |
| Helper removes and proves absence of registry, cache, consumer, and tarballs | Task 2 Step 3 `close()`, Task 3 Step 4 `cleanup()`, Task 2 Step 1 fifth test, Task 3 Step 6 absence assertions |
| Remove npm's `--offline` flag from this path | Task 3 Step 2 |
| Bounded, redacted exit code and stderr diagnostic on command failure | Task 3 Step 4 (`redactedCommandFailure`) and Step 8 |
| Both the installed-package harness and the real OpenCode runner consume the preparation helper | Task 3 Step 6 and Task 4 Step 3 (`defaultPreparePackage`) |
| Focused output-limit test injects the already-prepared installed invocation | Task 4 Step 1 (`preparePackage: async () => prepared`) |
| Prove the fake client was reached and the configured byte cap was actually exceeded | Task 4 Steps 1 and 5 |
| Wait for child close and confirmed process-group cleanup before finalizing blocked evidence | Task 4 Step 3 (`confirmGroupExit`) |
| Assert the expected process result before reading evidence; never manufacture evidence | Task 4 Step 1 (result asserted first) |
| Exit gate: regressions red then green, `npm run verify`, both conformance profiles, public CI on Node 22, no weakening, no residue | Task 5 |

**Placeholder scan:** every code step contains complete code; every command step names the exact command and expected output. The only deliberately deferred detail is the exact set of unused imports to delete in Task 3 Step 6, which is resolved by running `npm run typecheck` in the same task rather than by guessing.

**Type consistency:** `createPrivateFixtureRoot`/`removePrivateFixtureRoot` keep identical signatures in the `.ts` and `.mjs` forms. `startLocalNpmRegistry` returns the object described in `local-npm-registry.d.mts` and consumed by `prepare-installed-package.mjs` (`registry.url`, `registry.unknownRequests()`, `registry.close()`). `prepareInstalledPackage` returns `PreparedInstalledPackage`, whose `installedCommand`, `installedTarget`, `consumerRoot`, `archiveSha256`, and `cleanup()` are exactly the members used in Tasks 3 and 4. `runModelCommand`'s widened return shape is updated in both its producer and its existing tests in Task 4 Step 3.

## Out of scope for this plan

P0-B (truthful standalone and public boundary) and P0-C (durable and correct first mutation) are separate subsystems and get their own plans, written immediately before their execution:

- `docs/superpowers/plans/2026-07-25-p0-b-truthful-public-boundary.md` — written after P0-A is green, because its documentation tasks must be derived from the live catalogue of the post-P0-A commit.
- `docs/superpowers/plans/2026-07-25-p0-c-durable-first-mutation.md` — written after P0-B, because the alias read-back, pagination, and counter semantics tasks depend on the outcome of the disposable-VM `searchItem` probe that the spec requires before those tasks can be specified honestly.

Approved-asset selection for all three is `none`; any future reuse must pass the provenance workflow and be listed explicitly in the corresponding plan.
