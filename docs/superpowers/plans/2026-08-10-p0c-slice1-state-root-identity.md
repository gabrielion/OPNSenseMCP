# P0-C Slice 1 — Durable State Root and Target Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable private state root, the concurrency-safe `identity.key`, and the
HMAC-derived per-target directory identity that every later P0-C slice (durable backup/audit,
inter-process lock, reconciliation) will consume.

**Architecture:** A new self-contained `src/state/` module with three files: pure origin/target-id
derivation, platform-aware state-root path resolution, and filesystem publication of a 256-bit
identity key using the exclusive-temp-then-hard-link protocol from the approved design. Nothing is
wired into the mutation envelope yet — that is Slice 2 — so this slice changes no reachable server
behavior and ships as a fully tested library unit with its focused proof.

**Tech Stack:** Node.js 22 built-ins only (`node:crypto`, `node:fs`, `node:path`, `node:os`),
TypeScript strict, Vitest. No new runtime dependency.

**Authority:** `docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md`, section
“P0-C — Durable and correct first mutation”, subsections “State root and target identity”. Where
this plan and the spec disagree, the spec wins.

## Slice sequence (separate future plans — do not implement here)

The spec splits P0-C into five slices; this plan is only the first. Each later slice gets its own
plan once the previous one is merged:

1. **This plan** — state root, identity key, target identity.
2. Durable backup + append-only monthly audit + inter-process kernel lock (consumes `StateRoot`,
   `ensureIdentityKey`, `deriveTargetId`).
3. Kernel outcome semantics (`not-started` / `may-have-started`, `OUTCOME_INDETERMINATE`,
   `AUDIT_RESULT_FAILED`, `LOCK_RELEASE_FAILED`).
4. Exact host-alias syntax, full pagination, sealed read-back contract (needs a one-off VM probe).
5. `reconcile --json`, retention, disposable-VM lifecycle evidence and the P0-C exit gate.

## Global Constraints

- Node 22 only: `PATH=/opt/homebrew/opt/node@22/bin:$PATH` on this workstation; never validate with
  the default Node. Install with `npm ci --ignore-scripts`.
- Work on a feature branch created at execution start (see Task 0). **Never push non-evidence
  commits to `main`**: the Product 3 VM attestation is commit-bound and any such push turns CI red.
  Landing on `main` happens at the end of the slice with the evidence renewal sequence from
  `docs/project-status.md`.
- Every new file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later` (first line —
  `npm run license:check` enforces it).
- No new runtime dependency; `node:` built-ins only.
- Never place credentials, endpoints, or firewall data in state paths, file contents, error
  messages, or test names. The target id must be underivable without `identity.key` (HMAC, not a
  hash of the origin).
- Filesystem discipline everywhere: directories `0700`, regular files `0600`, single hard link,
  opened with `O_NOFOLLOW`, canonical paths only, current-user ownership. Reject drift; never
  silently repair modes of pre-existing entries.
- Windows (`win32`) fails closed: resolving a state root throws; no write support in P0-C.
- Before the final commit of the slice: `npm run license:check && npm run verify &&
  npm run test:conformance && git diff --check`.
- After every commit, append the increment to `.superpowers/sdd/progress.md` (its directory is
  gitignored — use `git add -f .superpowers/sdd/progress.md`).

## File Structure

- Create: `src/state/target-identity.ts` — pure functions: origin canonicalization, RFC 4648
  lower-case base32, HMAC target-id derivation, target path layout.
- Create: `src/state/state-root.ts` — platform default resolution, override validation, private
  directory creation/validation, `StateRoot` handle.
- Create: `src/state/identity-key.ts` — candidate/publish/cleanup protocol for `identity.key`.
- Create: `src/state/index.ts` — barrel re-export (what Slice 2 imports).
- Test: `tests/state/target-identity.test.ts`
- Test: `tests/state/state-root.test.ts`
- Test: `tests/state/identity-key.test.ts`

`tests/**/*.test.{ts,mjs}` is already matched by the `parallel` Vitest project — no config change.

---

### Task 0: Branch setup

**Files:** none (git only).

- [ ] **Step 1: Create the feature branch from up-to-date main**

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
git switch main && git pull --ff-only
git switch -c p0c/slice1-state-identity
npm ci --ignore-scripts
```

- [ ] **Step 2: Confirm a clean baseline**

Run: `npm run verify`
Expected: exit 0. Do not start Task 1 otherwise.

---

### Task 1: Origin canonicalization

**Files:**
- Create: `src/state/target-identity.ts`
- Test: `tests/state/target-identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canonicalizeOrigin(url: string): string` — returns
  `https://<lower-case-ascii-host>:<effective-port>` with the port always explicit; throws
  `Error('Invalid OPNsense origin')` on anything else.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { canonicalizeOrigin } from '../../src/state/target-identity.js';

describe('canonicalizeOrigin', () => {
  it('lower-cases the host and makes the default port explicit', () => {
    expect(canonicalizeOrigin('https://Firewall.Example.NET')).toBe(
      'https://firewall.example.net:443'
    );
  });

  it('keeps an explicit port and accepts IP literals', () => {
    expect(canonicalizeOrigin('https://192.0.2.1:8443')).toBe('https://192.0.2.1:8443');
    expect(canonicalizeOrigin('https://[2001:DB8::1]')).toBe('https://[2001:db8::1]:443');
  });

  it('treats an explicit default port and a bare origin as the same identity', () => {
    expect(canonicalizeOrigin('https://a.example:443')).toBe(canonicalizeOrigin('https://a.example'));
  });

  it.each([
    ['http://a.example', 'non-https scheme'],
    ['https://user:pw@a.example', 'credentials in the URL'],
    ['https://a.example/api', 'a path'],
    ['https://a.example/?x=1', 'a query'],
    ['https://a.example/#f', 'a fragment'],
    ['not a url', 'unparseable input'],
    ['', 'empty input']
  ])('rejects %s (%s)', (input) => {
    expect(() => canonicalizeOrigin(input)).toThrow('Invalid OPNsense origin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/target-identity.test.ts`
Expected: FAIL — cannot resolve `src/state/target-identity.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later

const INVALID_ORIGIN = 'Invalid OPNsense origin';

// The canonical origin is the whole lock/state identity: scheme, lower-case ASCII host, effective
// port. Credentials, TLS material, paths and queries must never influence or enter it.
export function canonicalizeOrigin(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(INVALID_ORIGIN);
  }
  if (parsed.protocol !== 'https:') throw new Error(INVALID_ORIGIN);
  if (parsed.username !== '' || parsed.password !== '') throw new Error(INVALID_ORIGIN);
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error(INVALID_ORIGIN);
  }
  const host = parsed.hostname;
  if (host === '' || !/^[\x21-\x7e]+$/u.test(host) || host !== host.toLowerCase()) {
    // URL already lower-cases and punycodes hostnames; anything still outside printable ASCII or
    // still upper-case did not come from that normalization and is refused rather than repaired.
    throw new Error(INVALID_ORIGIN);
  }
  const port = parsed.port === '' ? '443' : parsed.port;
  return `https://${host}:${port}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/target-identity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/state/target-identity.ts tests/state/target-identity.test.ts
git commit -m "feat: canonicalize the OPNsense origin that names durable state"
```

---

### Task 2: Base32 and target-id derivation

**Files:**
- Modify: `src/state/target-identity.ts` (append)
- Test: `tests/state/target-identity.test.ts` (append)

**Interfaces:**
- Consumes: `canonicalizeOrigin` (Task 1).
- Produces:
  - `base32LowerNoPadding(bytes: Uint8Array): string` — RFC 4648 alphabet, lower-case, unpadded;
  - `deriveTargetId(identityKey: Uint8Array, canonicalOrigin: string): string` — 52-char id;
    throws `Error('Invalid identity key')` unless the key is exactly 32 bytes, and
    `Error('Invalid OPNsense origin')` unless the origin is already canonical;
  - `targetDirectoryPath(stateRootPath: string, targetId: string): string` —
    `<root>/targets/<targetId>`; throws `Error('Invalid target id')` on a malformed id.

- [ ] **Step 1: Write the failing test (append to the same file)**

```ts
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
  base32LowerNoPadding,
  deriveTargetId,
  targetDirectoryPath
} from '../../src/state/target-identity.js';

describe('base32LowerNoPadding', () => {
  // RFC 4648 section 10 test vectors, lower-cased, padding stripped.
  it.each([
    ['f', 'my'],
    ['fo', 'mzxq'],
    ['foo', 'mzxw6'],
    ['foob', 'mzxw6yq'],
    ['fooba', 'mzxw6ytb'],
    ['foobar', 'mzxw6ytboi']
  ])('encodes %s as %s', (input, expected) => {
    expect(base32LowerNoPadding(Buffer.from(input, 'ascii'))).toBe(expected);
  });
});

describe('deriveTargetId', () => {
  const key = randomBytes(32);
  const origin = 'https://firewall.example.net:443';

  it('is deterministic, 52 chars of lower-case base32', () => {
    const id = deriveTargetId(key, origin);
    expect(id).toMatch(/^[a-z2-7]{52}$/u);
    expect(deriveTargetId(key, origin)).toBe(id);
  });

  it('changes with the origin but not with anything else', () => {
    expect(deriveTargetId(key, 'https://firewall.example.net:8443')).not.toBe(
      deriveTargetId(key, origin)
    );
  });

  it('changes with the identity key, so ids are not enumerable from origins', () => {
    expect(deriveTargetId(randomBytes(32), origin)).not.toBe(deriveTargetId(key, origin));
  });

  it('rejects a wrong-size key and a non-canonical origin', () => {
    expect(() => deriveTargetId(randomBytes(31), origin)).toThrow('Invalid identity key');
    expect(() => deriveTargetId(key, 'https://Firewall.example.net:443')).toThrow(
      'Invalid OPNsense origin'
    );
    expect(() => deriveTargetId(key, 'https://firewall.example.net')).toThrow(
      'Invalid OPNsense origin'
    );
  });
});

describe('targetDirectoryPath', () => {
  it('lays out targets/<id> under the state root', () => {
    const id = deriveTargetId(randomBytes(32), 'https://a.example:443');
    expect(targetDirectoryPath('/private/state', id)).toBe(join('/private/state', 'targets', id));
  });

  it('rejects anything that is not a derived id', () => {
    for (const bad of ['', 'UPPER', 'short', '../escape', 'a'.repeat(52).replace('a', '/')]) {
      expect(() => targetDirectoryPath('/private/state', bad)).toThrow('Invalid target id');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/target-identity.test.ts`
Expected: FAIL — `base32LowerNoPadding` is not exported.

- [ ] **Step 3: Write minimal implementation (append)**

```ts
import { createHmac } from 'node:crypto';
import { join } from 'node:path';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const IDENTITY_KEY_BYTES = 32;
const TARGET_ID_PATTERN = /^[a-z2-7]{52}$/u;

export function base32LowerNoPadding(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      // charAt (not bracket indexing): under noUncheckedIndexedAccess the latter types as
      // string | undefined and fails the repo's restrict-plus-operands lint rule.
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

export function deriveTargetId(identityKey: Uint8Array, canonicalOrigin: string): string {
  if (identityKey.length !== IDENTITY_KEY_BYTES) throw new Error('Invalid identity key');
  if (canonicalizeOrigin(canonicalOrigin) !== canonicalOrigin) {
    throw new Error(INVALID_ORIGIN);
  }
  const digest = createHmac('sha256', identityKey).update(canonicalOrigin, 'utf8').digest();
  return base32LowerNoPadding(digest);
}

export function targetDirectoryPath(stateRootPath: string, targetId: string): string {
  if (!TARGET_ID_PATTERN.test(targetId)) throw new Error('Invalid target id');
  return join(stateRootPath, 'targets', targetId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/target-identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/target-identity.ts tests/state/target-identity.test.ts
git commit -m "feat: derive the per-target state identity from an HMAC key"
```

---

### Task 3: State-root path resolution

**Files:**
- Create: `src/state/state-root.ts`
- Test: `tests/state/state-root.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface StateRootEnvironment { readonly platform: NodeJS.Platform; readonly env: Readonly<Record<string, string | undefined>>; readonly homeDir: string }`
  - `resolveStateRootPath(override: string | undefined, environment: StateRootEnvironment): string`
    — throws `Error('Durable state is not supported on this platform')` on `win32` and every
    platform other than `darwin`/`linux`; throws
    `Error('OPNSENSE_MCP_STATE_DIR must be an absolute path')` on a relative override.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { resolveStateRootPath } from '../../src/state/state-root.js';

const HOME = '/home/operator';

function environment(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {}
): { platform: NodeJS.Platform; env: Record<string, string | undefined>; homeDir: string } {
  return { platform, env, homeDir: HOME };
}

describe('resolveStateRootPath', () => {
  it('uses the absolute override verbatim on any supported platform', () => {
    expect(resolveStateRootPath('/private/tmp/state', environment('linux'))).toBe(
      '/private/tmp/state'
    );
  });

  it('rejects a relative override', () => {
    expect(() => resolveStateRootPath('relative/state', environment('linux'))).toThrow(
      'OPNSENSE_MCP_STATE_DIR must be an absolute path'
    );
  });

  it('defaults to Application Support on macOS', () => {
    expect(resolveStateRootPath(undefined, environment('darwin'))).toBe(
      `${HOME}/Library/Application Support/opnsense-mcp/state`
    );
  });

  it('prefers an absolute XDG_STATE_HOME on Linux and falls back to ~/.local/state', () => {
    expect(
      resolveStateRootPath(undefined, environment('linux', { XDG_STATE_HOME: '/var/state' }))
    ).toBe('/var/state/opnsense-mcp');
    expect(
      resolveStateRootPath(undefined, environment('linux', { XDG_STATE_HOME: 'not-absolute' }))
    ).toBe(`${HOME}/.local/state/opnsense-mcp`);
    expect(resolveStateRootPath(undefined, environment('linux'))).toBe(
      `${HOME}/.local/state/opnsense-mcp`
    );
  });

  it('fails closed on Windows and on unknown platforms, even with an override', () => {
    for (const platform of ['win32', 'freebsd'] as const) {
      expect(() => resolveStateRootPath(undefined, environment(platform))).toThrow(
        'Durable state is not supported on this platform'
      );
      expect(() => resolveStateRootPath('/abs', environment(platform))).toThrow(
        'Durable state is not supported on this platform'
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/state-root.test.ts`
Expected: FAIL — cannot resolve `src/state/state-root.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { isAbsolute, join } from 'node:path';

export interface StateRootEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

const UNSUPPORTED = 'Durable state is not supported on this platform';

export function resolveStateRootPath(
  override: string | undefined,
  environment: StateRootEnvironment
): string {
  // The platform gate comes first so Windows fails closed even with a configured override.
  if (environment.platform !== 'darwin' && environment.platform !== 'linux') {
    throw new Error(UNSUPPORTED);
  }
  if (override !== undefined) {
    if (!isAbsolute(override)) {
      throw new Error('OPNSENSE_MCP_STATE_DIR must be an absolute path');
    }
    return override;
  }
  if (environment.platform === 'darwin') {
    return join(environment.homeDir, 'Library', 'Application Support', 'opnsense-mcp', 'state');
  }
  const xdgStateHome = environment.env.XDG_STATE_HOME;
  if (xdgStateHome !== undefined && isAbsolute(xdgStateHome)) {
    return join(xdgStateHome, 'opnsense-mcp');
  }
  return join(environment.homeDir, '.local', 'state', 'opnsense-mcp');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/state-root.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/state-root.ts tests/state/state-root.test.ts
git commit -m "feat: resolve the durable state root per platform, failing closed elsewhere"
```

---

### Task 4: Private directory discipline and the StateRoot handle

**Files:**
- Modify: `src/state/state-root.ts` (append)
- Test: `tests/state/state-root.test.ts` (append)

**Interfaces:**
- Consumes: `targetDirectoryPath` (Task 2).
- Produces:
  - `ensurePrivateDirectory(path: string): void` — creates the directory with mode `0700` when
    missing; always validates: canonical path (`realpathSync(path) === path`), directory, owned by
    the current uid, mode exactly `0700`. Throws
    `Error('State directory failed its integrity checks')` otherwise. Never repairs modes.
  - `interface StateRoot { readonly path: string; readonly targetsPath: string }`
  - `openStateRoot(path: string): StateRoot` — `ensurePrivateDirectory` on the root and on
    `<root>/targets`, returns a frozen handle.
  - `ensureTargetDirectory(root: StateRoot, targetId: string): string` — validates the id via
    `targetDirectoryPath`, ensures the per-target directory, returns its path.

- [ ] **Step 1: Write the failing test (append; add imports at the top of the file)**

```ts
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ensurePrivateDirectory,
  ensureTargetDirectory,
  openStateRoot
} from '../../src/state/state-root.js';
import { deriveTargetId } from '../../src/state/target-identity.js';

function scratch(): string {
  // realpathSync: on macOS tmpdir() is /var/..., a symlink to /private/var/..., and the canonical
  // path check must operate on the canonical form.
  return mkdtempSync(join(realpathSync(tmpdir()), 'opnsense-state-test-'));
}

describe('ensurePrivateDirectory / openStateRoot', () => {
  it('creates missing directories 0700 and accepts them on re-open', () => {
    const base = scratch();
    try {
      const rootPath = join(base, 'state');
      const root = openStateRoot(rootPath);
      expect(root.path).toBe(rootPath);
      expect(root.targetsPath).toBe(join(rootPath, 'targets'));
      // Idempotent and still valid on a second open.
      expect(openStateRoot(rootPath).targetsPath).toBe(join(rootPath, 'targets'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a pre-existing directory with drifted permissions instead of repairing it', () => {
    const base = scratch();
    try {
      const rootPath = join(base, 'state');
      mkdirSync(rootPath, { mode: 0o755 });
      expect(() => openStateRoot(rootPath)).toThrow('State directory failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked root', () => {
    const base = scratch();
    try {
      const real = join(base, 'real');
      mkdirSync(real, { mode: 0o700 });
      const alias = join(base, 'alias');
      symlinkSync(real, alias);
      expect(() => openStateRoot(alias)).toThrow('State directory failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a regular file where a directory is required', () => {
    const base = scratch();
    try {
      const rootPath = join(base, 'state');
      writeFileSync(rootPath, 'not a directory', { mode: 0o600 });
      expect(() => ensurePrivateDirectory(rootPath)).toThrow(
        'State directory failed its integrity checks'
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('ensureTargetDirectory', () => {
  it('creates targets/<id> with the same discipline and returns its path', () => {
    const base = scratch();
    try {
      const root = openStateRoot(join(base, 'state'));
      const id = deriveTargetId(randomBytes(32), 'https://a.example:443');
      const targetPath = ensureTargetDirectory(root, id);
      expect(targetPath).toBe(join(root.targetsPath, id));
      expect(ensureTargetDirectory(root, id)).toBe(targetPath);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a malformed id before touching the filesystem', () => {
    const base = scratch();
    try {
      const root = openStateRoot(join(base, 'state'));
      expect(() => ensureTargetDirectory(root, '../escape')).toThrow('Invalid target id');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/state-root.test.ts`
Expected: FAIL — `ensurePrivateDirectory` is not exported.

- [ ] **Step 3: Write minimal implementation (append)**

```ts
import { closeSync, constants, fstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { targetDirectoryPath } from './target-identity.js';

const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;
const DIRECTORY_INTEGRITY = 'State directory failed its integrity checks';

export function ensurePrivateDirectory(path: string): void {
  try {
    // A raw EEXIST/EACCES message embeds the filesystem path; wrap it so the error stays static.
    mkdirSync(path, { recursive: true, mode: 0o700 });
  } catch {
    throw new Error(DIRECTORY_INTEGRITY);
  }
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    throw new Error(DIRECTORY_INTEGRITY);
  }
  if (canonical !== path) throw new Error(DIRECTORY_INTEGRITY);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  } catch {
    throw new Error(DIRECTORY_INTEGRITY);
  }
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isDirectory() ||
      stats.uid !== process.getuid?.() ||
      (stats.mode & 0o777) !== 0o700
    ) {
      throw new Error(DIRECTORY_INTEGRITY);
    }
  } finally {
    closeSync(fd);
  }
}

export interface StateRoot {
  readonly path: string;
  readonly targetsPath: string;
}

export function openStateRoot(path: string): StateRoot {
  ensurePrivateDirectory(path);
  const targetsPath = join(path, 'targets');
  ensurePrivateDirectory(targetsPath);
  return Object.freeze({ path, targetsPath });
}

export function ensureTargetDirectory(root: StateRoot, targetId: string): string {
  const path = targetDirectoryPath(root.path, targetId);
  ensurePrivateDirectory(path);
  return path;
}
```

Note: `mkdirSync(recursive)` applies `0700` only to directories it creates; a pre-existing
`0755` directory is caught by the validation and refused — the test above proves it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/state-root.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/state-root.ts tests/state/state-root.test.ts
git commit -m "feat: enforce the private directory discipline on the state root"
```

---

### Task 5: Identity key — publication and never-overwrite

**Files:**
- Create: `src/state/identity-key.ts`
- Test: `tests/state/identity-key.test.ts`

**Interfaces:**
- Consumes: `StateRoot` (Task 4).
- Produces: `ensureIdentityKey(root: StateRoot): Uint8Array` — returns the 32 published key bytes;
  publishes them on first call using the exclusive-candidate + hard-link protocol; throws
  `Error('Identity key failed its integrity checks')` when the published key is invalid. It never
  overwrites an existing published key.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  chmodSync,
  linkSync,
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
    ['wrong size', (path: string) => writeFileSync(path, Buffer.alloc(31), { mode: 0o600 })],
    ['loose mode', (path: string) => { writeFileSync(path, Buffer.alloc(32), { mode: 0o600 }); chmodSync(path, 0o644); }]
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/identity-key.test.ts`
Expected: FAIL — cannot resolve `src/state/identity-key.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;
const O_DIRECTORY = (constants.O_DIRECTORY as number | undefined) ?? 0;

function fsyncDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY | O_DIRECTORY | NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function readValidatedKey(path: string): Uint8Array {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isFile() ||
      stats.uid !== process.getuid?.() ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600 ||
      stats.size !== KEY_BYTES
    ) {
      throw new Error(KEY_INTEGRITY);
    }
    const buffer = Buffer.alloc(KEY_BYTES);
    let offset = 0;
    while (offset < KEY_BYTES) {
      const read = readSync(fd, buffer, offset, KEY_BYTES - offset, offset);
      if (read === 0) throw new Error(KEY_INTEGRITY);
      offset += read;
    }
    return buffer;
  } finally {
    closeSync(fd);
  }
}

// Startup recovery: any fixed-pattern candidate is either the residue of a crash between link and
// cleanup (it shares the published key's inode) or an unpublished private candidate of a dead
// process. Both are safe to unlink; the published name itself is never touched.
function cleanupCandidates(rootPath: string): void {
  const candidates = readdirSync(rootPath).filter((name) => CANDIDATE_PATTERN.test(name));
  for (const name of candidates) unlinkSync(join(rootPath, name));
  if (candidates.length > 0) fsyncDirectory(rootPath);
}

function keyExists(rootPath: string): boolean {
  try {
    const fd = openSync(join(rootPath, KEY_NAME), constants.O_RDONLY | NOFOLLOW);
    closeSync(fd);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Error(KEY_INTEGRITY);
  }
}

export function ensureIdentityKey(root: StateRoot): Uint8Array {
  cleanupCandidates(root.path);
  if (keyExists(root.path)) return readValidatedKey(join(root.path, KEY_NAME));

  const candidatePath = join(
    root.path,
    `${KEY_NAME}.candidate-${randomBytes(8).toString('hex')}`
  );
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
    closeSync(fd);
  }
  try {
    // Publication without replacement: exactly one concurrent starter wins this hard link.
    linkSync(candidatePath, join(root.path, KEY_NAME));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      unlinkSync(candidatePath);
      throw error;
    }
    // A concurrent process won; fall through and reread the winner.
  }
  unlinkSync(candidatePath);
  fsyncDirectory(root.path);
  return readValidatedKey(join(root.path, KEY_NAME));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/identity-key.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/identity-key.ts tests/state/identity-key.test.ts
git commit -m "feat: publish the durable identity key without replacement"
```

---

### Task 6: Identity key — crash recovery and race-loser semantics

**Files:**
- Test: `tests/state/identity-key.test.ts` (append; no production change expected — these tests
  pin the recovery behavior already implemented in Task 5, and any failure is a Task 5 defect to
  fix in `src/state/identity-key.ts`)

- [ ] **Step 1: Write the tests**

```ts
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
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/state/identity-key.test.ts`
Expected: PASS. If any recovery test fails, the fix belongs in `src/state/identity-key.ts`
(Task 5's cleanup/validation logic), never in the test.

- [ ] **Step 3: Run the whole state suite together**

Run: `npx vitest run tests/state/`
Expected: PASS (all three files).

- [ ] **Step 4: Commit**

```bash
git add tests/state/identity-key.test.ts
git commit -m "test: pin identity-key crash recovery and race-loser semantics"
```

---

### Task 7: Barrel export, gates, ledger

**Files:**
- Create: `src/state/index.ts`
- Modify: `.superpowers/sdd/progress.md` (append)

**Interfaces:**
- Produces (what Slice 2 will import from `../state/index.js`): `canonicalizeOrigin`,
  `deriveTargetId`, `targetDirectoryPath`, `resolveStateRootPath`, `openStateRoot`,
  `ensureTargetDirectory`, `ensureIdentityKey`, and the types `StateRoot`,
  `StateRootEnvironment`.

- [ ] **Step 1: Write the barrel**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export {
  base32LowerNoPadding,
  canonicalizeOrigin,
  deriveTargetId,
  targetDirectoryPath
} from './target-identity.js';
export {
  ensurePrivateDirectory,
  ensureTargetDirectory,
  openStateRoot,
  resolveStateRootPath
} from './state-root.js';
export type { StateRoot, StateRootEnvironment } from './state-root.js';
export { ensureIdentityKey } from './identity-key.js';
```

- [ ] **Step 2: Run the full gates**

```bash
npm run license:check && npm run verify && npm run test:conformance && git diff --check
```

Expected: every command exits 0. `verify` includes format/lint — if Prettier or ESLint reformats
the new files, apply and keep the result.

- [ ] **Step 3: Append the increment to the ledger**

Append to `.superpowers/sdd/progress.md` a dated entry recording: the slice, the three modules,
the key invariants proved (canonical origin identity, HMAC/base32 id underivable without the key,
0700/0600/`O_NOFOLLOW`/canonical-path discipline, publication without replacement, candidate
cleanup), and the exact test commands run.

- [ ] **Step 4: Commit**

```bash
git add src/state/index.ts
git add -f .superpowers/sdd/progress.md
git commit -m "feat: expose the durable-state module for the next P0-C slice"
```

- [ ] **Step 5: Do not push to main**

The branch stays local (or is pushed as a branch only). Landing on `main` is a separate decision
that must follow the evidence renewal sequence in `docs/project-status.md` (“Task 2 — evidence
renewal sequence”), because this slice's commits invalidate the commit-bound VM attestation.

---

## Self-review notes

- Spec coverage of “State root and target identity”: override/defaults/Windows (Task 3), directory
  discipline and layout (Task 4), identity-key protocol with crash/candidate recovery and
  never-overwrite (Tasks 5–6), origin normalization and HMAC/base32 target id with
  credential-independence (Tasks 1–2). The composition-root injection of the target id into the
  mutation services is deliberately deferred to Slice 2, which owns the kernel changes — the spec
  lists it under the kernel's locking/backup/audit consumers.
- The `identity.key` "exactly 32 bytes" validation, fsync-before-publish, fsync-of-parent, and
  EEXIST-loser reread are each pinned by a test.
- One known simplification, allowed by the slice split: concurrent cleanup by two *live* processes
  can unlink each other's candidate before `linkSync`, which surfaces as ENOENT and fails that
  starter closed instead of retrying. The spec requires exactly-one-winner and losers rereading —
  both hold; a bounded retry can be added in Slice 2 when the kernel starts calling this under the
  inter-process lock, where the observable requirement lives.
