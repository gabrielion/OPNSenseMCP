# P0-C Slice 2b — Durable Mutation State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shutdown-scoped tmpdir backup store with the durable state root, drop the durable
backup, append-only audit and kernel-backed inter-process lock in behind the Slice-2a service
interfaces as pure swaps, make the backup content actually verified, extend the audit shape
(`transactionId` + `ALLOWED_KEYS`), split alias reads from alias writes in the catalogue, canonicalize
the origin seam, tighten the lock contract, decide unsafe-ancestor and retention, and prove a backup is
RESTORABLE (not merely present) on the disposable VM.

**Architecture:** Two halves in one document. **Slice 2b.1** (Tasks 1–10) is deterministic and
VM-free: it changes types and the composition root, adds durable state modules, and swaps them in
behind `LockHandle`/`BackupService`/`AuditSink`. The kernel mutation envelope is touched only for
`transactionId` threading and the two lock-contract carry-overs (release-signal, late-grant retain-hook)
— its **step-order canary stays byte-identical**. **Slice 2b.2** (Tasks 11–13) adds the restore
round-trip attestation (a new sibling VM producer), the evidence plumbing for its new checks, and the
docs/ledger/gates. The cut line is marked below; 2b.1 alone is larger than Slice 2a and is expected to
run across more than one review sitting.

**Tech Stack:** TypeScript strict, Vitest, Node 22 built-ins (`node:fs`, `node:crypto`, `node:child_process`,
`node:net`), `/usr/bin/lockf` (macOS) / `/usr/bin/flock` (Linux). No new runtime dependency.

**Authority:** `docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md` (P0-C: "State
root and target identity", "Durable backup and audit", "Inter-process lock and retention"); the
carry-forward list in `docs/project-status.md` lines 542–661; the Slice-2a AS-LANDED notes in
`docs/superpowers/plans/2026-08-18-p0c-slice2a-envelope-prep-refactors.md`; the user-mandated restore
exit gate (2026-08-18). **Where this plan and the spec disagree, the spec wins** — except the two
deliberate deviations flagged for adjudication in "Open questions" (retention hook point; unsafe-ancestor).

**Behavior-preservation rule (the canary):** `tests/capabilities/mutation-envelope.test.ts`
"runs the fixed order and returns the verified output on success" asserts the event list
`lock.acquire, preflight, audit.intent, backup.create, preflight, handler, verify, audit.result,
lock.release`. That list must stay exactly this, byte for byte, at the end of every task. It is the
single most load-bearing assertion of the slice, re-run on every task.

## Global Constraints

- **Node 22 only:** `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`; `npm ci --ignore-scripts`.
  Never validate with the default Node 26.
- **Never target or test a production firewall.** Live proofs use only the disposable local OPNsense VM.
- **ESLint strictTypeChecked `--max-warnings 0`; `noUncheckedIndexedAccess` on** (use `.charAt`, not
  bracket-index, for string concat; guard every array/record index); **prettier `--check`** clean.
- SPDX header (`// SPDX-License-Identifier: AGPL-3.0-or-later`) on every new file; `.js` ESM specifiers
  on relative imports; braces on void-returning concise arrows in tests.
- Static error messages in `src/state/` and every new durable module; **no credential, endpoint,
  firewall datum, XML, backup id, or private path** in any thrown message, audit record, or MCP result.
- Strict TDD per task: run the focused file while iterating, `npx vitest run tests/` once before each
  commit. Every task re-runs the envelope canary.
- Commit style: repo prefixes, lower-case subject, trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Evidence discipline:** never hand-edit sealed evidence; `evidence:check`/`evidence:verify` go stale
  on-branch by design and are restored at landing by a real `smoke:opencode` reseal (src/** moves the
  tarball digest) followed by a real VM attestation. The repo ledger `.superpowers/sdd/progress.md`
  updates via `git add -f`.
- Before the final commit: `npm run license:check && npm run verify && npm run test:conformance &&
  git diff --check` all exit 0.
- Model policy (user mandate): implementers and task reviewers on `model: "opus"`, effort `max`.

## File Structure

- Modify: `src/capabilities/types.ts` — `transactionId` on `BackupRequest` and `AuditRecord`;
  `LockHandle.release(signal)`; (no other contract widening this slice).
- Modify: `src/capabilities/envelope/audit.ts` — `ALLOWED_KEYS` + validation + copy gain `transactionId`.
- Modify: `src/capabilities/kernel.ts` — envelope `transactionId` generation + threading (Task 1);
  `CapabilityCatalogView.listAll` required, both `?? []` fallbacks removed (Task 2); lock-contract
  carry-overs (Task 7). No canary change.
- Modify: `src/capabilities/catalog.ts` — separate reachability (reads) from write-exposure (Task 3).
- Rewrite: `src/capabilities/envelope/config-backup.ts` — durable `backups/<backupId>/{config.xml,metadata.json}`
  layout, persisted digest+length, `exists()` that reads and verifies content + `0600` + length (Task 4).
- Create: `src/capabilities/envelope/durable-audit.ts` — append-only monthly JSONL sink (Task 5).
- Create: `src/capabilities/envelope/kernel-lock.ts` + `src/capabilities/envelope/lock-waiter.mjs` —
  kernel-backed inter-process lock (Task 6).
- Modify: `src/capabilities/envelope/lock.ts` — in-process manager honours the new `release(signal)` (Task 7).
- Create: `src/capabilities/envelope/retention.ts` — pre-write retention maintenance (Task 9).
- Modify: `src/state/state-root.ts` — unsafe-ancestor walk OR recorded ruling (Task 10, adjudication-gated).
- Modify: `src/app/default-application.ts` — durable-root wiring, canonicalized origin seam, catalogue
  split, kernel lock + durable audit + durable backup swap (Task 8).
- Create: `scripts/vm/product3-restore.mjs` + `tests/vm/product3-restore.test.mjs` — restore round-trip (Task 11).
- Modify: `scripts/vm/attestation.mjs`, `scripts/verify-vm-attestation.mjs`,
  `tests/vm/*`, `tests/foundation/documentation.test.ts`, `tests/foundation/package-contract.test.ts` —
  new checks `backupRestored`, `stateReverted` (Task 12).
- Modify tests throughout: `tests/capabilities/mutation-envelope.test.ts`, `tests/capabilities/dispatch.test.ts`,
  `tests/capabilities/envelope/{config-backup,audit,lock}.test.ts`, `tests/capabilities/catalog.test.ts`,
  `tests/app/default-application.test.ts`.
- Modify: `docs/project-status.md`, `.superpowers/sdd/progress.md` (Task 13, `git add -f`).

---

### Task 0: Branch setup

- [ ] `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`
- [ ] `git switch main && git pull --ff-only && git switch -c p0c/slice2b-durable-state`
- [ ] `npm ci --ignore-scripts && npm run verify` → exit 0 required before Task 1.

---

## ===== Slice 2b.1 — durable state, deterministic and VM-free (Tasks 1–10) =====

### Task 1: R9 + `transactionId` — the audit shape the spec names

**Files:** `src/capabilities/types.ts` (`BackupRequest` :201-209, `AuditRecord` :218-227),
`src/capabilities/envelope/audit.ts` (`ALLOWED_KEYS` :9-18, validation :40-53, copy :54-63),
`src/capabilities/kernel.ts` (`executeMutationEnvelope` entry ~:1637, `recordAudit` :1650-1667,
`backupRequest` :1728-1736), `tests/capabilities/mutation-envelope.test.ts` (audit fake :160-169,
success test), `tests/capabilities/envelope/audit.test.ts` (`record()` helper),
`tests/capabilities/envelope/config-backup.test.ts` (`REQUEST` :25-33), `tests/capabilities/dispatch.test.ts`.

**Interfaces:**
- Produces: `BackupRequest.transactionId: string` and `AuditRecord.transactionId: string` (both
  required, 32-lowercase-hex). The kernel generates ONE `transactionId` per envelope run and threads
  the same value into the intent audit, the result audit, and the backup request — the field a service
  cannot synthesize (spec, "Durable backup and audit").
- Consumes (Task 4, Task 5): the persisted `transactionId`.

- [ ] **RED (symmetry, behavioural):** extend the mutation-envelope audit fake to capture records, and
  assert the same `transactionId` reaches intent, result and the backup request:

```ts
// in makeHarness(): capture full records
readonly auditRecords: AuditRecord[];
// ...
audit: {
  record: (record) => {
    events.push(`audit.${record.phase}`);
    auditRecords.push(record);
    if (opts.auditIntentThrow === true && record.phase === 'intent') throw new Error('audit');
    if (opts.auditResultThrow === true && record.phase === 'result') throw new Error('audit');
  }
}
```

```ts
it('threads one transactionId through both audits and the backup request', async () => {
  const harness = makeHarness();
  await dispatch(makeCapability(harness.events), harness.services);
  const txids = harness.auditRecords.map((r) => r.transactionId);
  expect(txids[0]).toMatch(/^[0-9a-f]{32}$/u);
  expect(new Set(txids).size).toBe(1);
  expect(harness.backupRequests[0]?.transactionId).toBe(txids[0]);
});
```

  This fails to compile first (fakes/records lack `transactionId`), which is the required RED per the
  slice convention that a missing-contract compile failure is a failing test. Record it.
- [ ] **Implement:**
  - `types.ts`: add `readonly transactionId: string;` to `BackupRequest` and to `AuditRecord`.
  - `audit.ts`: add `'transactionId'` to `ALLOWED_KEYS`; in the validation block require
    `isBoundedString(value.transactionId)`; add `transactionId: value.transactionId` to the frozen copy.
  - `kernel.ts`: at the top of `executeMutationEnvelope`, after the preflight/verify guard, add
    `const transactionId = secureRandomBytes(TRANSACTION_ID_BYTES).toString('hex');` with a
    module const `const TRANSACTION_ID_BYTES = 16;` (128-bit, matching `backupId`). Add
    `transactionId` to the frozen record in `recordAudit` and to the `backupRequest` object literal.
  - Fix every construction the compiler flags: `audit.test.ts` `record()` helper, `config-backup.test.ts`
    `REQUEST`, any `dispatch.test.ts` stub (its `record: vi.fn()` needs no change; its backup stubs
    reject and construct nothing).
- [ ] **GREEN:** `npx vitest run tests/capabilities/ tests/capabilities/envelope/` — new test green,
  **canary unchanged**. `npx tsc -p tsconfig.json --noEmit`.
- [ ] Commit: `feat: thread a transactionId through the audit shape and widen ALLOWED_KEYS`

---

### Task 2: Make `catalog.listAll` required

**Files:** `src/capabilities/kernel.ts` (`CapabilityCatalogView.listAll?` :296, `sealUnavailableCapabilities`
`?? []` :1217, `holdsEnvelopeCapability` `?? []` :1994), `tests/capabilities/catalog.test.ts`,
plus any `CapabilityCatalogView` test double the compiler flags.

**Interfaces:**
- Produces: `CapabilityCatalogView.listAll(): readonly CapabilityDefinition[]` (required — the `?`
  is removed). The two guards now consult it directly with no empty-list fallback, so widening the
  allow-list later cannot reveal an unprotected write on an already-built dispatcher.

- [ ] **RED:** remove the `?` from `listAll` on `CapabilityCatalogView` and delete both `?? []`
  fallbacks (`catalog.listAll()` at :1217 and :1994). Run `npx tsc -p tsconfig.json --noEmit`: every
  `CapabilityCatalogView` double without a `listAll` now fails to compile — that is the RED. Enumerate
  the failures (search `listExposed(` doubles in `tests/capabilities/mutation-envelope-bypass.test.ts`,
  `tests/security/*.test.ts`, `tests/foundation/documentation.test.ts` if any implement the view
  directly rather than via `CapabilityCatalog`).
- [ ] **Implement:** add `listAll()` to each flagged double (return the double's definition array).
  `CapabilityCatalog.listAll()` (:72-74) already satisfies the tightened interface.
- [ ] **GREEN:** `npx tsc` clean; `npx vitest run tests/capabilities/ tests/security/ tests/foundation/`;
  canary unchanged. Commit: `refactor: require catalog.listAll and drop the empty-list guard fallbacks`

---

### Task 3: Separate target-reachability from write-availability in the catalogue

**Files:** `src/capabilities/catalog.ts` (`createProductCapabilityCatalog` :77-96),
`src/app/default-application.ts` (catalogue calls :160-162), `tests/app/default-application.test.ts`
(degrade pin :559-612, the flip is :597-605), `tests/capabilities/catalog.test.ts`.

**Interfaces:**
- Produces: `createProductCapabilityCatalog(adapter, aliasAdapter, exposeAliasWrites = aliasAdapter.available)`.
  `aliasAdapter` still governs alias **reads** (via `list.ts`'s internal `aliasAdapter.available` check,
  unchanged); the new third parameter alone governs whether the alias **writes** are pushed/sealed.
- Consumes (Task 8): the composition root passes a **reachable** `aliasAdapter` even when the mutation
  envelope could not be built, with `exposeAliasWrites: false`.

**Why:** today one `aliasAdapter.available` flag drives both. When the backup root fails, the root
passes no `aliasAdapter`, so alias reads die with the writes. On win32 `openResolvedStateRoot` throws
unconditionally, so that degrade IS the ordinary win32 path — shipping it unsplit hands every Windows
operator a read regression, the opposite of R7's goal.

- [ ] **RED:** flip the degrade pin in `default-application.test.ts` from red-if-fixed to the intended
  behaviour. Replace the `TARGET_UNAVAILABLE` expectation (:597-605) and its DEFERRED-WRONG-SHAPE
  comment with a success expectation: with a reachable target but a failed local backup root, an
  `opn_list` of `firewall.alias` **succeeds** (reads survive), while `opn_create`/`opn_delete` remain
  unlisted (writes sealed). Keep the existing "writes are gone, reads still answer" tools-list
  assertion (:575-580) — it already asserts the four-read surface. Add the alias-read success:

```ts
await expect(
  dispatchCapability(
    { name: 'opn_list', arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' } },
    { application: runtime.application, transport: 'stdio' }
  )
).resolves.toMatchObject({ kind: 'success' });
```

  This fails today (reads refuse `TARGET_UNAVAILABLE` because the root passes no `aliasAdapter`).
- [ ] **Implement:**
  - `catalog.ts`: add the third parameter; gate `capabilities.push(...writes)` and the
    `sealUnavailableCapabilities(catalog, writes)` else-branch on `exposeAliasWrites` instead of
    `aliasTargetAvailable`. The list capability still receives the real `aliasAdapter`.
  - `default-application.ts` (paired with Task 8): the reachable-but-no-envelope branch calls
    `createProductCapabilityCatalog(readAdapter, aliasAdapter, false)`. **Keep the both-available branch
    as the two-argument call** `createProductCapabilityCatalog(readAdapter, aliasAdapter)` (the default
    `exposeAliasWrites = aliasAdapter.available = true`) so the source-text pins at
    `default-application.test.ts:624` and `:642-652` (`toContain('createProductCapabilityCatalog(readAdapter, aliasAdapter)')`
    and "only file with that substring") stay green — a three-arg call would break that exact substring.
- [ ] **GREEN:** `npx vitest run tests/app/ tests/capabilities/catalog.test.ts`; canary unchanged.
  Commit: `fix: keep alias reads when the local backup root is unavailable`

---

### Task 4: Durable, content-verified backup — flip the two red-if-fixed pins

**Files:** rewrite `src/capabilities/envelope/config-backup.ts`;
`tests/capabilities/envelope/config-backup.test.ts` (first test :50-67, nlink pin :101-107,
the two pins :116-139).

**Interfaces:**
- Consumes: `BackupRequest` (now with `transactionId`, Task 1), `ConfigBackupSource` (unchanged).
- Produces: `createOPNsenseConfigBackupService(source, backupsDir)` implementing `BackupService`.
  Layout per spec: `backupsDir/<backupId>/{config.xml,metadata.json}`, both `0600`, dir `0700`,
  published by writing+fsync into a private sibling temp dir then atomic `rename` then fsync of
  `backupsDir`. `create()` persists `metadata.json` = `{ schemaVersion: 1, transactionId, backupId,
  targetKey, capabilityId, mcpName, argumentsSha256, effectiveResourceScopes, observedStateDigest,
  effectPlanDigest, byteLength, xmlSha256, createdAt }` (all safe ids/digests — never XML, never
  credentials). `exists(backupId, signal)` reopens BOTH files `O_RDONLY|O_NOFOLLOW`, revalidates
  owner + `nlink === 1` + `mode 0600` on each, parses metadata (bounded), reopens `config.xml`,
  asserts `size === metadata.byteLength` and `size <= 2 MiB`, reads the bytes and asserts
  `sha256(bytes) === metadata.xmlSha256`. Any fault → `false`. The XML never crosses MCP.

**This is the core of the slice.** Today `create` computes the digest and discards it; `exists` stats
without reading and skips the `0600` check. The two pins record that. This task makes them true.

- [ ] **RED — flip both pins to the intended assertions:**

```ts
it('rejects a stored backup truncated after the write verification', async () => {
  const store = join(root, 'store');
  const service = createOPNsenseConfigBackupService(source(), store);
  const created = await service.create(REQUEST, signal);
  const path = join(store, created.backupId, 'config.xml');
  truncateSync(path, statSync(path).size - 1);
  expect(await service.exists(created.backupId, signal)).toBe(false); // was: .toBe(true)
});

it('rejects a byte flipped in a stored backup after the write verification', async () => {
  const store = join(root, 'store');
  const service = createOPNsenseConfigBackupService(source(), store);
  const created = await service.create(REQUEST, signal);
  const path = join(store, created.backupId, 'config.xml');
  const bytes = readFileSync(path);
  bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
  writeFileSync(path, bytes);
  expect(await service.exists(created.backupId, signal)).toBe(false); // was: .toBe(true)
});
```

  Add the mode-gap leg (the third gap the requirements name):

```ts
it('rejects a stored backup whose mode was widened after the write', async () => {
  const store = join(root, 'store');
  const service = createOPNsenseConfigBackupService(source(), store);
  const created = await service.create(REQUEST, signal);
  chmodSync(join(store, created.backupId, 'config.xml'), 0o644);
  expect(await service.exists(created.backupId, signal)).toBe(false);
});
```

  Rewrite the first test's file-shape assertions (:59-66) for the directory layout: the backup dir
  exists at `join(store, created.backupId)` mode `0700`, contains exactly `['config.xml','metadata.json']`,
  each `0600`, `config.xml` bytes equal `CONFIG_XML`, and `metadata.json` parses with
  `xmlSha256 === sha256(CONFIG_XML)` and `byteLength === CONFIG_XML.length`. Update the nlink pin
  (:101-107) and the symlink pin (:88-96) to the `config.xml` path under `<backupId>/`.
- [ ] **Run RED:** `npx vitest run tests/capabilities/envelope/config-backup.test.ts` — the three
  content/mode legs fail against the current flat-file, stat-only service. Record.
- [ ] **Implement** the rewrite. `create`: download → bound-check (empty / >2 MiB) → compute
  `xmlSha256` and `byteLength` → mkdir private sibling temp dir → write+fsync `config.xml` (O_EXCL,
  0600) and `metadata.json` (O_EXCL, 0600) → re-read `config.xml` and assert digest (keep the
  write-path check) → fsync temp dir → `rename` to `<backupId>` → fsync `backupsDir`. `exists`: the
  full reopen-and-verify described above, all faults caught → `false`. Static messages only.
- [ ] **GREEN:** the file green; canary unchanged (this module is behind `BackupService`; the kernel is
  untouched — a pure swap). Commit: `feat: persist and verify backup content, not just presence`

---

### Task 5: Durable append-only audit sink

**Files:** create `src/capabilities/envelope/durable-audit.ts` + `tests/capabilities/envelope/durable-audit.test.ts`.
`src/capabilities/envelope/audit.ts` (the bounded ring) stays for tests/fixtures.

**Interfaces:**
- Consumes: `AuditRecord` (with `transactionId`).
- Produces: `createDurableAuditSink(auditDir): AuditSink` — appends one canonical JSONL line per record
  to `auditDir/YYYY-MM.jsonl` (UTC month), each line `<= 4096` bytes, through an owner-checked,
  `nlink === 1`, `O_APPEND | O_NOFOLLOW | O_CREAT` (0600) descriptor, `fsync` before `record()`
  returns. The record body carries only the safe ids/digests/scopes + phase + outcome (+ optional
  `backupId`) — the same fields the ring already validates. A line that would exceed 4096 bytes, a
  non-owner/multi-link/symlink segment, or a failed `fsync` throws a static-message error (visible
  corruption, never swallowed). It runs under the target lock (the envelope records intent and result
  inside the lock/release span), so no internal locking is added.

- [ ] **RED:** write `durable-audit.test.ts` against a `mkdtemp` dir: (a) two records append two lines
  to the same monthly segment, each a JSON object whose keys are exactly the allowed set, parseable and
  in append order; (b) a record whose serialized line would exceed 4096 bytes throws; (c) a segment
  file given a second hard link before `record()` makes the next `record()` throw; (d) the file is
  `0600` and `fsync` was invoked (inject an `fsyncSync` spy via a small seam, or assert durability by
  reopening in a fresh sink instance and reading the lines back). Fails — module absent.
- [ ] **Implement** `durable-audit.ts`. Reuse the ring's `ALLOWED_KEYS`/validation shape (import or
  duplicate the guard — do not export handler data). Segment name from `new Date().toISOString().slice(0,7)`.
- [ ] **GREEN:** the file green; canary unchanged. Commit: `feat: add the durable monthly audit log`

---

### Task 6: Kernel-backed inter-process lock (waiter + manager)

**Files:** create `src/capabilities/envelope/lock-waiter.mjs` and `src/capabilities/envelope/kernel-lock.ts`;
`tests/capabilities/envelope/kernel-lock.test.ts`.

**Interfaces:**
- Produces: `createKernelMutationLockManager(lockFilePath, deps?): MutationLockManager`. `acquire`
  opens+validates the fixed `lockFilePath` `O_NOFOLLOW` (owner, `nlink === 1`, `0600`, create if
  absent), then spawns the platform helper passing ONLY the inherited descriptor (never the path or a
  target id in argv/env): Linux `/usr/bin/flock <fd> node lock-waiter.mjs`; macOS
  `/usr/bin/lockf -s -t 5 /dev/fd/<fd> node lock-waiter.mjs`. The bundled waiter signals acquisition on
  a private pipe only after the OS lock is held, then blocks reading that pipe for the envelope lifetime;
  the handle's `release(signal)` closes the pipe and confirms helper exit (`'released'`), reporting
  `'unconfirmed'` if the child cannot be confirmed gone. Acquisition bounded to 5 s → `null`. A
  missing/untrusted helper (validate the fixed absolute helper path: regular file, root/owner, not
  writable by group/other), premature helper exit, or an unsupported platform fails closed. Process
  death releases the OS lock (verified below) — no PID/stale-file heuristic.

**Verified platform facts (probed on this workstation, Node 22, darwin):** `/usr/bin/lockf` exists;
`/usr/bin/flock` does not (it is the Linux helper). `lockf -s -t 0 <fd>` in the no-command descriptor
form takes an `flock(2)`-style lock on the descriptor's open file description: a probe with two distinct
descriptions returned `{first:0, second:75, third:0}` — acquired, `EX_TEMPFAIL` while held by another
description, released by close. The **command** form `lockf … cmd` releases when `cmd` exits, which is
exactly why the long-lived waiter is required to hold the lock for the envelope lifetime.

- [ ] **RED:** `kernel-lock.test.ts`: (a) two managers over the SAME `lockFilePath` serialize —
  the second `acquire` returns `null` within the bound while the first handle is held, and succeeds
  after `release`; (b) `release()` resolves `'released'` and a subsequent `acquire` succeeds;
  (c) killing the helper child mid-hold frees the lock (spawn a real helper, `process.kill` it, assert
  a fresh `acquire` succeeds) — proves process-death release; (d) an injected spawn whose helper exits
  before signalling → `acquire` returns `null` (fail-closed); (e) a `lockFilePath` that is a symlink →
  `acquire` returns `null`. Use the real helpers on the host; skip cleanly (`it.skipIf`) where the
  platform helper is absent, and assert the unsupported-platform branch via an injected `platform` dep.
- [ ] **Implement** `lock-waiter.mjs` (argv-free: fd 3 held by the parent's spawn, pipe on fd 3 or a
  dedicated inherited pipe; write one readiness byte, then `read` until EOF, then exit 0) and
  `kernel-lock.ts` (descriptor validation, helper-path validation, bounded spawn, readiness race,
  handle with `release(signal)`).
- [ ] **GREEN:** the file green; canary unchanged (production swap is Task 8). Commit:
  `feat: add the kernel-backed inter-process mutation lock`

---

### Task 7: Lock contract — release honours a signal, and a late-granted lock is retained not leaked

**Files:** `src/capabilities/types.ts` (`LockHandle` :189-191), `src/capabilities/envelope/lock.ts`
(in-process handle :14-24), `src/capabilities/envelope/kernel-lock.ts` (Task 6 handle),
`src/capabilities/kernel.ts` (acquire :1680-1684, release :1858),
`tests/capabilities/mutation-envelope.test.ts` (release fake :133-138, a new leak test).

**Interfaces:**
- Produces: `LockHandle.release(signal: AbortSignal): Promise<'released' | 'unconfirmed'>`. Both
  managers accept and honour the signal (the in-process one ignores it — dropping a token cannot fail —
  documented with the repo's `void` idiom). The kernel envelope passes the release runner's signal:
  `runBounded(timeoutMs, undefined, (signal) => lock.release(signal))` at :1858 — the bound becomes
  real because the handle can now cooperate with it.
- Late-grant retain-hook: `acquire` at :1680 must not leak a handle granted just as its bound fires.
  Mirror `runOperation`'s retain precedent (:1532-1541): when the bounded acquire aborts but the
  underlying `acquire` still resolves a non-null handle, release that handle (fire-and-forget, bounded,
  signal-free) instead of discarding it. The success path is unchanged — the retain-hook fires only on
  the aborted branch — so the **canary success order is byte-identical**.

- [ ] **RED:** (a) update the mutation-envelope release fake to `(signal) => { events.push('lock.release'); void signal; return Promise.resolve(opts.lockReleaseReport ?? 'released'); }` and confirm the canary and the existing `unconfirmed`-tolerated test still pass. (b) New leak test: a fake `acquire` that resolves a handle whose `release` records a `leak-release` event AFTER the acquire bound has already fired (drive with a short `timeoutMs` and a deferred acquire resolution); assert the dispatch refuses `LOCK_UNAVAILABLE` AND that `release` was eventually called on the late handle (no leak). Fails today (the runner discards the value).
- [ ] **Implement** the `release(signal)` widening across `types.ts`, both managers, and the kernel
  release call; add the acquire retain-hook at :1680. Keep the abort→`LOCK_UNAVAILABLE` mapping.
- [ ] **GREEN:** `npx vitest run tests/capabilities/`; **canary byte-identical**;
  `npx tsc` clean. Commit: `fix: give lock release a signal and retain a late-granted lock`

---

### Task 8: Durable-root wiring — the composition root swaps in the durable services

**Files:** `src/app/default-application.ts` (`buildMutationServices` :97-129, `createDefaultApplicationRuntime`
:131-178), `tests/app/default-application.test.ts` (compose test :472-557, degrade test from Task 3).
Uses `openResolvedStateRoot`, `ensureIdentityKey`, `canonicalizeOrigin`, `deriveTargetId`,
`ensureTargetDirectory` from `src/state/`, and the durable modules from Tasks 4–7 + Task 9's retention.

**Interfaces:**
- Consumes: `openResolvedStateRoot(override, env)`, `ensureIdentityKey(root)` → `Uint8Array(32)`,
  `canonicalizeOrigin(url)`, `deriveTargetId(key, canonicalOrigin)`, `ensureTargetDirectory(root, targetId)`.
- Produces: `buildMutationServices(client, origin)` that (a) resolves the durable state root from
  `OPNSENSE_MCP_STATE_DIR` (the only override) or the platform default, (b) `ensureIdentityKey`,
  (c) **canonicalizes the origin seam** — `deriveTargetId(key, canonicalizeOrigin(origin))` (R8 passed
  `parsed.url` verbatim; this closes it; `deriveTargetId` re-checks canonical form and throws
  `INVALID_ORIGIN` otherwise), (d) `ensureTargetDirectory` → `<targetDir>`, (e) builds
  `backup = createOPNsenseConfigBackupService(client, join(targetDir,'backups'))`,
  `audit = createDurableAuditSink(join(targetDir,'audit'))`,
  `lock = createKernelMutationLockManager(join(targetDir,'lock'))`, running retention maintenance
  (Task 9) before returning. On ANY throw (win32 `openResolvedStateRoot`, unwritable root,
  unsupported platform, no lock helper) it returns `undefined` — the fail-closed degrade — and the root
  passes a reachable `aliasAdapter` with `exposeAliasWrites: false` (Task 3) so reads survive.
  `dispose` no longer removes the durable root (it is durable by design — see retention, Task 9); it
  closes the lock helper and leaves the state on disk.

- [ ] **RED:** in the compose test (:472-557), which already runs the full six-tool write lifecycle
  against a synthetic target, add an assertion that the backup landed durably under the state root:
  stub `OPNSENSE_MCP_STATE_DIR` to a `mkdtemp` dir, run the `opn_create` lifecycle, then assert a
  `backups/<id>/{config.xml,metadata.json}` pair exists under `targets/<targetId>/` and survives a
  second `createDefaultApplicationRuntime()` (durability across restart, spec exit gate). Also assert
  the audit segment `targets/<targetId>/audit/YYYY-MM.jsonl` has an `intent` and a `result` line.
  Fails today (tmpdir store, disposed at shutdown).
- [ ] **Implement** the wiring. Keep the both-available catalogue call two-arg (Task 3). Remove the
  `mkdtempSync(tmpdir(), …)` store and the `rmSync(root)` dispose. Hold the parsed config in a local
  and pass `parsed.url` to `buildMutationServices` (the seam), canonicalizing inside.
- [ ] **GREEN:** `npx vitest run tests/app/`; canary unchanged. Commit:
  `feat: back the mutation envelope with the durable state root`

---

### Task 9: Retention maintenance before the first write

**Files:** create `src/capabilities/envelope/retention.ts` + `tests/capabilities/envelope/retention.test.ts`;
called from `config-backup.ts` `create()` (Task 4) at the start, before writing the new backup.

**Interfaces:**
- Produces: `maintainRetention(targetDir): void` — before publishing a new backup: retain the newest
  **100** resolved backups AND **30 days** (both conditions must permit deletion; a backup is
  "resolved" when its `transactionId` has a terminal `result` line in the audit; unresolved backups are
  never purged); retain audit segments **365 days**, preserving any segment containing an unresolved
  transaction. A corrupt metadata/audit entry, a failed deletion/fsync, or insufficient space throws a
  static-message error — which, since it runs inside `create()`, becomes `BACKUP_FAILED` before the
  first firewall write (spec: "refuses the new mutation before the first write").

**Hook-point deviation (flagged for adjudication, Open Question 4):** the spec says retention runs
"before a new intent" (before step 3). Running it there would add a step to the kernel envelope and is
NOT a pure swap; it risks the canary. This plan runs it inside `backup.create` (step 4) — after intent,
before any firewall write — preserving the byte-identical canary. The refusal-before-write guarantee is
kept. **RULED (user, 2026-08-18): confirmed — retention runs inside `backup.create`.**

- [ ] **RED:** `retention.test.ts` against a `mkdtemp` target dir seeded with 101 resolved backups +
  matching audit → the oldest resolved backup is deleted, unresolved ones are kept, a backup <30 days
  is kept even beyond count 100; a corrupt metadata entry throws. Fails — module absent.
- [ ] **Implement** `retention.ts`; call `maintainRetention(dirname(backupsDir))` (or pass the target
  dir) at the top of `create()`. Keep `create()`'s content-verification path (Task 4) intact.
- [ ] **GREEN:** `retention.test.ts` + `config-backup.test.ts` green (the retention call must not
  break the single-backup tests — seed thresholds so a lone backup is retained); canary unchanged.
  Commit: `feat: enforce backup and audit retention before each mutation`

---

### Task 10: Unsafe-ancestor validation — decide it *(ADJUDICATED 2026-08-18: implement the walk)*

**Ruling (user, 2026-08-18): implement the walk.** The discharge is the ancestor walk, because the exact validation already exists
twice in this repo — `requireSafeAncestor` in `src/config/configure.ts:108-117` and
`assertPrivateAncestors` in `tests/support/private-fixture-root.ts:24-40` — so it is low-cost, and the
fail-open delta is real: after `openResolvedStateRoot` canonicalizes through a symlinked **ancestor**,
`identity.key` and every durable target land wherever a same-uid ancestor redirect points.

**Files:** `src/state/state-root.ts` (`openResolvedStateRoot` :99-117, `ensurePrivateDirectory` :64-85),
`tests/state/state-root.test.ts`.

- [ ] **RED:** a test that builds a root under a **symlinked same-uid ancestor** and asserts
  `openResolvedStateRoot` throws `DIRECTORY_INTEGRITY` (today it resolves and proceeds — the documented
  fail-open at :104-114). Also assert a group/other-writable ancestor throws. Use the
  `private-fixture-root` helper's ancestor discipline to build the safe control case.
- [ ] **Implement** a `requireSafeAncestor`-style walk over the canonical path components in
  `openResolvedStateRoot` (each ancestor: directory, not a symlink, owned by root or the current uid,
  not group/other-writable), reusing the `configure.ts` predicate shape. Update the :104-114 comment
  from "delta is undecided" to the recorded decision.
- [ ] **GREEN:** `npx vitest run tests/state/`; canary unchanged. Commit:
  `feat: reject unsafe ancestors when opening the durable state root`
- [ ] **If the controller instead rules to accept the delta:** replace the implementation steps with a
  recorded scope ruling in `docs/project-status.md` and `.superpowers/sdd/progress.md` that states
  exactly the delta accepted (same-uid symlinked-ancestor redirect of durable state), the residual
  risk, and why it is tolerated; no code change; note it in the Task 13 ledger.

---

## ===== CUT LINE — Slice 2b.2: restore round-trip + evidence (Tasks 11–13) =====

Everything above lands, is reviewed, and passes the deterministic gates before 2b.2 begins. 2b.2 touches
no `src/**` product code (so it does not re-move the OpenCode tarball digest); its unit tests use
injected seams, and its proof is a live VM run recorded at landing.

### Task 11: Restore round-trip scenario *(restore mechanism ADJUDICATED 2026-08-18: QMP + probe)*

**Files:** create `scripts/vm/product3-restore.mjs` + `tests/vm/product3-restore.test.mjs`.
Reuses `product1b-bootstrap.mjs` (console driving), `product1b-lifecycle.mjs`
(`startDisposableVm`/`stopDisposableVm`/`buildQemuArguments`), `product1b-connection.mjs`,
`product1b-live.mjs`, and the `product3-alias.mjs` building blocks (`runInstalledAliasLifecycle`,
`inspectGitWorktree`, `writeVmAttestationAtomic`).

**Sibling vs. extend (recommendation):** a SIBLING script, not an extension of `product3-alias.mjs`.
Reasoning: `product3-alias.mjs` is a stable full-lifecycle producer with a sealed attestation shape and
its own CI evidence; bolting a reboot+restore phase onto it doubles its failure surface and forces a
schema bump on the existing evidence. A sibling keeps `docs/evidence/product3-vm.json` untouched and
lets the restore attestation carry its own checks and its own evidence file.

**Round-trip (spec of the new gate):** observe alias state A over REST (the alias absent) → create a
backup through the product (the strict pre-write snapshot the envelope takes on `opn_create`) → apply a
real mutation through the product (the existing alias create → present) → **restore the backup onto the
firewall over the console/SSH mechanism** (config restore is NOT reachable over REST — verified
REST/SSH boundary) → observe over REST that state reverted to A (alias absent again). New checks:
`backupRestored`, `stateReverted`.

**Restore mechanism (recommended default; adjudication-gated).** The only credential-free privileged
entry on the pinned image is the loader single-user shell, reachable at boot. Re-entering it after the
mutation phase requires forcing a guest reset, which the current `buildQemuArguments` forbids
(`-monitor none`, `-no-reboot`, :497-518). Recommended default: a **scenario-scoped** QEMU variant that
adds a QMP monitor unix socket; after the mutation phase, issue `system_reset` over QMP to re-enter the
loader, then drive the proven `product1b-bootstrap.mjs` loader→single-user→shell→heredoc-upload sequence
to overwrite `/conf/config.xml` with the staged backup XML and continue to multi-user, then verify state
A over REST. This diverges from the pinned launch contract and MUST be scenario-scoped so
`product1b`/`product3-alias` stay byte-identical. It needs a live probe (like the spec's mandatory
`searchItem` probe) to confirm the guest re-imports `/conf/config.xml` on boot and the alias reverts.
**RULED (user, 2026-08-18): QMP + probe approved**, scenario-scoped exactly as described above. The
offline unit tests below never depended on the ruling.

- [ ] **RED (deterministic, injected seams — mirrors `tests/vm/product3-alias.test.mjs`):** write
  `product3-restore.test.mjs` driving `runProduct3Restore` with fakes for `startVm`/`stopVm`/`bootstrap`/
  `createArtifacts`/`installPackage`/`runInstalled`/a new `restoreOverConsole` seam/`inspectGit`/
  `writeAttestation`. Assert: (a) the happy path sets every check including `backupRestored` and
  `stateReverted` and writes an attestation via the injected writer; (b) a `restoreOverConsole` that
  throws leaves `backupRestored:false`, `stateReverted:false`, `failureStage` set, no attestation
  written; (c) a post-restore REST readback that still shows the mutation leaves `stateReverted:false`;
  (d) the summary carries only fixed booleans (no path, no credential, no XML). Fails — script absent.
- [ ] **Implement** `product3-restore.mjs` (structure copied from `product3-alias.mjs`: `emptyChecks`
  gains `backupRestored`/`stateReverted`; `runProduct3Restore` orders observe→backup→mutate→restore→
  reobserve; `restoreOverConsole({ consolePath, backupXml })` is the injectable seam that, live, drives
  the QMP reset + single-user overwrite). The live QMP/console code lands only after adjudication; the
  seam and its tests land now.
- [ ] **GREEN:** `npx vitest run tests/vm/product3-restore.test.mjs`. No `src/**` changed. Commit:
  `test: add the restore round-trip scenario behind injected seams`

---

### Task 12: Evidence plumbing for the new checks

**Files:** `scripts/vm/attestation.mjs` (`VM_ATTESTATION_CHECK_KEYS` :17-30, builder :120-165),
`scripts/verify-vm-attestation.mjs` (`EVIDENCE_RELATIVE_PATH` :10, `soleEvidencePath` :44-47,
`gitStateIsCoherent` :100-147, `verifyVmAttestation` :149-168), `tests/vm/product3-restore.test.mjs`
(attestation serialization pin), `tests/foundation/documentation.test.ts` (:259 `toMatchObject` on
checks, :284 README link, :366 command), `tests/foundation/package-contract.test.ts`
(:65,:165 evidence-path expectations).

**Interfaces:**
- Produces: a restore attestation whose check set is the alias set plus `backupRestored` and
  `stateReverted`. **RULED (user, 2026-08-18): the restore evidence lands as the new file
  `docs/evidence/product3-restore-vm.json`**; `docs/evidence/product3-vm.json`, its producer and its
  12-key check set stay untouched.
- Mechanics the ruling forces — do NOT widen `VM_ATTESTATION_CHECK_KEYS`: the builder's
  `recordWithExactKeys` (:145) rejects unknown keys and the verifier round-trips the sealed 12-check
  evidence through `buildVmAttestation` (:157), so widening the global set would invalidate the
  existing sealed evidence this ruling protects. Instead:
  - `attestation.mjs`: export `VM_RESTORE_ATTESTATION_CHECK_KEYS` = the 12 existing keys +
    `backupRestored` + `stateReverted`, sorted, frozen. Extract the builder body into an internal
    `buildAttestationWithCheckKeys(input, checkKeys)`; `buildVmAttestation`/`serializeVmAttestation`
    keep their exact current behavior by delegating with `VM_ATTESTATION_CHECK_KEYS`; add
    `buildVmRestoreAttestation`/`serializeVmRestoreAttestation` delegating with the restore set.
    Every other pin (schemaVersion 2, image, scenario flags/scopes, clientVersion, node pattern) is
    shared unchanged — the restore scenario runs the same product profile.
  - `verify-vm-attestation.mjs`: verify BOTH evidence files (each via `readEvidenceFile`, parsed by
    its own builder, serialization-equal, git-coherent). Widen the "only evidence changed" rules —
    `soleEvidencePath` and the HEAD===commit worktree case — from "exactly this one path" to "a
    non-empty subset of the two evidence relative paths", so the two attestation commits can land in
    either order at the landing sequence. Non-zero exit if either file fails.

- [ ] **RED:** in `tests/vm/product3-restore.test.mjs`: `serializeVmRestoreAttestation` accepts a
  14-key all-true checks record and rejects (`VM_ATTESTATION_INVALID`) an input missing either new
  key; and `serializeVmAttestation` REJECTS a 14-key checks record — the sealed alias shape must stay
  untouched, which is exactly the regression this task must not cause. Extend `documentation.test.ts`
  (README link/command for the restore producer) and `package-contract.test.ts` (new evidence path).
  Fails — the exports do not exist.
- [ ] **Implement:** the `attestation.mjs` extraction + new exports; the verifier two-file loop and
  subset rule; the README text the documentation test pins.
- [ ] **GREEN:** `npx vitest run tests/vm/ tests/foundation/`. Commit:
  `feat: attest and verify the restore round-trip evidence`

---

### Task 13: Docs, ledger, gates

**Files:** `docs/project-status.md`, `.superpowers/sdd/progress.md` (`git add -f`).

- `docs/project-status.md`: mark the 2b carry-forwards done (R6 durable root/backup/audit/lock;
  content verification with the two pins flipped; R9 + `transactionId`; catalogue reachability/write
  split; canonicalized origin seam; `catalog.listAll` required; lock signal/retain contract; retention;
  unsafe-ancestor per the ruling). Record the deliberate deviations (retention hook point; whichever
  ancestor ruling landed) and the deferrals (backup metadata's TLS-context digest — needs a request
  field not authorized this slice; reconcile CLI and the other P0-C slices remain future work).
- Record the **sweep-once Linux exit-gate decision** (Open Question 5): **separate tracked errand, not a
  2b blocker** — the sweep-once fix already landed in 2a and is independent of 2b's durable work; the
  retry budget stays as-is until that Linux evidence exists.
- Carry the **drift-test scope note** forward (docs/project-status.md "Drift-test scope": 6 files /
  7 literals, sealed-evidence and client-identity pins excluded on purpose, substring-containment
  caveat). 2b ships no version bump, so no code change — the note must survive the status-file
  rewrite, not be dropped by it.
- Ledger entry in the file's style: what changed, the canary (step-order byte-identical), the durable
  layout, the lock probe facts, the adjudications and their rulings, gates.
- [ ] **Gates:** `npm run license:check && npm run verify && npm run test:conformance && git diff
  --check` all exit 0 (`evidence:*` stale on-branch by design; restored at landing).
- [ ] Commit: `docs: record the durable mutation-state slice`

---

## Landing (controller, after final review)

1. **Commit the plan file itself** — `git add -f docs/superpowers/plans/2026-08-18-p0c-slice2b-durable-mutation-state.md`
   and commit it (the 2a plan stayed untracked until final review; do not repeat that).
2. `superpowers:finishing-a-development-branch` → merge ff to `main`.
3. Real `smoke:opencode` reseal (src/** changed by 2b.1) → full gates green.
4. Candidate fixture commit → live `vm:product3` (existing alias attestation) → attestation commit.
5. **Live restore proof** (after Open Question 2 is adjudicated and the live mechanism implemented):
   run the restore producer → its attestation commit → `evidence:verify` 0 + `evidence:check` 0.
6. Push → confirm all four CI jobs executed (parallel, installed-package, opencode-runner,
   evidence-freshness). **No release this slice** (0.1.1 is already on npm).
7. Track the **sweep-once 2-vCPU Linux** verification as a separate errand; record its result in the
   ledger when it lands; do not shrink the retry budget before then.

## Open questions flagged for controller/user adjudication

> **ALL FIVE ADJUDICATED 2026-08-18 by the user.** The recommended option governs in every case:
> (1) implement the ancestor walk; (2) scenario-scoped QMP reset + single-user console overwrite,
> with the live probe; (3) sibling `product3-restore.mjs` + new `docs/evidence/product3-restore-vm.json`;
> (4) retention runs inside `backup.create`; (5) sweep-once Linux verification is a separate tracked
> errand, not a 2b gate. The gates on Tasks 9/10/11 are lifted.

1. **Unsafe-ancestor (Task 10) — recommend implementing the walk.** The exact validation already exists
   twice in-repo (`configure.ts:108`, `private-fixture-root.ts:24`); the fail-open delta redirects
   durable state (incl. `identity.key`) through any same-uid symlinked ancestor. Alternative: a recorded
   scope ruling accepting the delta. Needs a decision before Task 10 runs.
2. **Restore mechanism (Task 11) — recommend a scenario-scoped QEMU QMP monitor + `system_reset` +
   the proven single-user console overwrite of `/conf/config.xml`, plus a live probe** that the guest
   re-imports config on boot and the alias reverts. This diverges from the pinned `buildQemuArguments`
   (`-monitor none`, `-no-reboot`) and must stay scenario-scoped. Alternative: provision a privileged
   multi-user console/SSH path at bootstrap (larger security-posture change on the disposable account).
   Needs a decision before the LIVE restore step; the offline seam + tests are unblocked.
3. **Restore script location & evidence file (Tasks 11–12) — recommend a sibling
   `scripts/vm/product3-restore.mjs` writing a new `docs/evidence/product3-restore-vm.json`**, leaving
   `product3-alias.mjs` and its evidence untouched. Confirm, or direct extension of the existing
   producer with a `schemaVersion` bump.
4. **Retention hook point (Task 9) — recommend running retention inside `backup.create` (step 4)** to
   keep the canary byte-identical, rather than the spec's literal "before a new intent" (step 3). The
   refusal-before-first-write guarantee is preserved. Confirm the deviation, or accept a canary change.
5. **Sweep-once Linux verification (exit gate) — recommend a separate tracked errand, not a 2b gate.**
   Confirm.

## Self-review notes

**Requirement → task mapping (every 2b brief bullet has a task; NONE unmapped):**
- R6 durable state root replacing tmpdir → Task 8; durable backup → Task 4; append-only audit → Task 5;
  kernel-backed lock → Task 6; all behind Slice-2a interfaces as pure swaps (kernel envelope untouched
  except Tasks 1 & 7, whose changes leave the success canary byte-identical).
- Backup content verification + flip the two red-if-fixed pins + close the `0600` gap → Task 4.
- R9 `ALLOWED_KEYS` extension + `transactionId` on `BackupRequest` AND `AuditRecord` symmetrically → Task 1.
- Catalogue: separate reachability from write-availability (degrade pin flips; win32 becomes the
  ordinary path) → Task 3; `catalog.listAll` required → Task 2.
- Canonicalize the origin seam before deriving a target id → Task 8 (`deriveTargetId(key,
  canonicalizeOrigin(parsed.url))`).
- Signal honouring in service contracts / `release(signal)` / late-grant retain-hook → Task 7 (the
  durable modules honour their `signal`s by construction — the backup's `create` awaits real I/O under
  the runner's signal, the lock bounds acquisition at 5 s).
- Unsafe-ancestor decision (implement OR ruling, adjudication) → Task 10.
- Durable-root retention/purge decision (the "/tmp secrets" argument) → Task 9 + the dispose change in
  Task 8 (no more shutdown purge of durable state).
- NEW restore round-trip attestation → Task 11; evidence plumbing (verifier + check-count) → Task 12.
- Sweep-once Linux exit-gate decision → recommended in Task 13 / exit gate (separate errand).
- Non-goal: restore-as-MCP-tool → recorded in Non-goals below.

**Non-goals (kept out on purpose):** exposing restore as an MCP tool (reserved future slice; the
`restore` feature flag exists in `src/config/feature-flags.ts`; restore is SSH-side — the user's
architecture decision); the `reconcile --json` CLI and the spec's reconcile-based durable-state proof
(not in the 2b brief — the restore round-trip is the exit-gate proof instead); mutation outcome
`may-have-started` classification; host-alias strict syntax / pagination / `searchItem` read-back
probe; the backup metadata TLS-context digest (needs a `BackupRequest` field the brief did not
authorize); and every Slice-3 exclusion (`AUDIT_RESULT_FAILED`/`LOCK_RELEASE_FAILED` semantics, the
success-audit hoist, `EXECUTION_FAILED`-vs-403 vocabulary, caller-abort masking, the R3 source-text
test). None of these are pulled in.

**Type consistency:** `transactionId: string` (32-hex) is the same name and shape on `BackupRequest`,
`AuditRecord`, the persisted `metadata.json`, and the durable audit line across Tasks 1/4/5.
`release(signal: AbortSignal)` is uniform across `LockHandle`, the in-process manager, the kernel
manager, and the kernel call site (Task 7). `createProductCapabilityCatalog(adapter, aliasAdapter,
exposeAliasWrites?)` — the two-arg call is preserved for the both-available branch so the source-text
pins survive (Task 3). `createKernelMutationLockManager(lockFilePath)` /
`createDurableAuditSink(auditDir)` / `createOPNsenseConfigBackupService(source, backupsDir)` are the
three durable constructors the composition root wires in Task 8.

**Canary discipline:** only Tasks 1 and 7 touch `executeMutationEnvelope`, and both are proven against
the byte-identical event list on the success path; Tasks 4/5/6/9 change modules that sit BEHIND the
service interfaces, so the kernel — and its canary — never sees them. Every task re-runs the canary.

**Deferrals recorded honestly (mirroring the 2a AS-LANDED convention):** the retention hook-point
deviation and the metadata TLS-context digest are documented, not hidden; the live restore mechanism is
seam-tested now and proven live only at landing, after adjudication.
