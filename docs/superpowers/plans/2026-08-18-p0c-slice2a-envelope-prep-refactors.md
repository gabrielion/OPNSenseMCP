# P0-C Slice 2a — Envelope Prep Refactors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the mutation-envelope interfaces and the composition root so Slice 2b can drop in
durable backup/audit and the kernel lock as pure service swaps — applying refactors R1–R5 and
R7–R9 from the 2026-08-17 review, the test-structure fixes it demanded, and the small carry-overs
(sweep-once, version-drift test, backup-discipline test legs, two stale comments) — with **zero
observable behavior change** on every reachable path.

**Architecture:** Interface-first: widen `LockHandle`/`BackupService`/`AuditSink` contracts in
`src/capabilities/types.ts`, follow the compiler through `kernel.ts`, `envelope/*`, and the fakes;
restructure `executeMutationEnvelope` so the lock release is sequential (not `finally`) and the
nine terminal-audit sites collapse into one helper; make the composition root build mutation
services fail-closed-lazily and expose the origin seam. Every task ends with the full deterministic
suite green and unchanged envelope step-order assertions.

**Tech Stack:** TypeScript strict, Vitest, Node 22 built-ins. No new dependency.

**Authority:** docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md (P0-C section);
the R1–R9 findings recorded in `.superpowers/sdd/progress.md` (2026-08-17/18 entries). Where this
plan and the spec disagree, the spec wins. **Behavior-preservation rule:** new refusal codes
(`AUDIT_RESULT_FAILED`, `LOCK_RELEASE_FAILED`) and durable semantics belong to Slices 2b/3 — this
slice must not change any observable result, refusal, or event order. The envelope step-order test
(`tests/capabilities/mutation-envelope.test.ts` "runs the fixed order...") is the canary: its
event list must stay exactly `lock.acquire, preflight, audit.intent, backup.create, preflight,
handler, verify, audit.result, lock.release`.

## Global Constraints

- Node 22 only: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`; `npm ci --ignore-scripts`.
- Feature branch `p0c/slice2a-envelope-prep` from up-to-date `main` (Task 0). Never push
  non-evidence commits to `main`; landing uses the documented evidence sequence (real
  `smoke:opencode` reseal — `src/**` changes move the tarball digest — then real `vm:product3`).
- Model policy (user mandate): implementers and task reviewers on Opus, effort max.
- SPDX header on any new file; no new runtime dependency; `.js` ESM specifiers; strictTypeChecked
  eslint `--max-warnings 0`; `noUncheckedIndexedAccess` (charAt, not bracket-index, for string
  concat); braces on void-returning concise arrows in tests.
- Static error messages in `src/state/`; never place credentials, endpoints, or firewall data in
  any thrown message or audit record.
- Strict TDD per task; run the focused file while iterating, the full `npx vitest run tests/`
  once before each commit.
- Commit style: repo prefixes, lower-case subject, trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Before the final commit: `npm run license:check && npm run verify && npm run test:conformance &&
  git diff --check` all exit 0 (no expected-RED this slice: nothing here touches the sealed
  fixture's version claim; `evidence:check`/`evidence:verify` go stale on the branch by design and
  are restored at landing).
- Repo ledger `.superpowers/sdd/progress.md` updated in Task 8 (`git add -f`).

## File Structure

- Modify: `src/capabilities/types.ts` — `LockHandle`, `MutationLockManager`, `BackupService`,
  new `BackupRequest` (no new required `AuditRecord` fields this slice).
- Modify: `src/capabilities/kernel.ts` — `executeMutationEnvelope` only (region ~1650–1780):
  sequential release, `finishWith` helper, `BackupRequest` construction, bounded service calls.
- Modify: `src/capabilities/envelope/lock.ts`, `src/capabilities/envelope/config-backup.ts`,
  `src/capabilities/envelope/audit.ts` (signature-only conformance; behavior identical).
- Modify: `src/app/default-application.ts` — lazy fail-closed service construction + origin seam.
- Modify: `src/state/identity-key.ts` — sweep once per call chain (carry-over).
- Modify tests: `tests/capabilities/mutation-envelope.test.ts` (argument-capturing fakes),
  `tests/capabilities/dispatch.test.ts` (signature conformance), `tests/app/default-application.test.ts`
  (drop source-text assertions, add behavioral ones), `tests/capabilities/envelope/config-backup.test.ts`
  (3 discipline legs), `tests/state/identity-key.test.ts` (sweep-once pin).
- Create: `tests/foundation/version-drift.test.ts`.
- Modify: `docs/project-status.md`, `.superpowers/sdd/progress.md` (Task 8).

---

### Task 0: Branch setup

- [ ] `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`
- [ ] `git switch main && git pull --ff-only && git switch -c p0c/slice2a-envelope-prep`
- [ ] `npm ci --ignore-scripts && npm run verify` → exit 0 required before Task 1.

---

### Task 1: R2 + R1 — lock release reports, and leaves the `finally`

**Files:** `src/capabilities/types.ts` (~:185-191), `src/capabilities/kernel.ts` (~:1668-1778),
`src/capabilities/envelope/lock.ts`, `tests/capabilities/mutation-envelope.test.ts`,
`tests/capabilities/dispatch.test.ts` (if its rejecting stubs name `release`).

**Contract changes:**

```ts
export interface LockHandle {
  release(): Promise<'released' | 'unconfirmed'>;
}
```

`createInProcessMutationLockManager` returns `'released'` (it cannot fail to release an in-process
token). In `executeMutationEnvelope`, replace the `try { ... } finally { release }` shape with:
every branch inside the current `try` assigns `let result: CapabilityResult` and `break`s a single
labeled block (or returns via a local function) so that after the block, ONE sequential
`await lock.release()` runs — its result **captured into a local and deliberately unused this
slice** (a one-line comment says Slice 3 turns `'unconfirmed'`-after-verified-success into
`LOCK_RELEASE_FAILED`) — and then `return result`. A release that THROWS is still swallowed
exactly as today (catch → nothing). The abort/refusal paths before lock acquisition are untouched.

**Steps:**
- [ ] **RED:** in `tests/capabilities/mutation-envelope.test.ts`, extend the fake lock's `release`
  to `() => { events.push('lock.release'); return Promise.resolve('released' as const); }` — the
  compile now fails against the old `Promise<void>` contract? No: widening the RETURN type of a
  fake is assignable to `Promise<void>`... so the honest RED is a NEW test: "release is awaited
  after the terminal audit and its report is tolerated", using a fake whose `release` returns
  `'unconfirmed'` and asserting the envelope result is STILL the normal success (behavior
  preserved this slice) and that `events` ends `audit.result, lock.release`. This test fails
  against the old interface at the type level (`'unconfirmed'` not assignable to `void` → tsc/
  vitest transform error) — acceptable RED per the plan's convention that a missing-contract
  compile failure is a failing test. Record it.
- [ ] **Implement** the contract + kernel restructure + lock.ts return value.
- [ ] **GREEN:** `npx vitest run tests/capabilities/` — the step-order canary unchanged; new test
  green. `npx tsc -p tsconfig.json --noEmit`.
- [ ] Commit: `refactor: report lock release and run it outside the finally`

---

### Task 2: R3 — one terminal-audit helper

**Files:** `src/capabilities/kernel.ts` (the nine `recordAudit('result', ...)` sites at ~:1710-1765),
`tests/capabilities/mutation-envelope.test.ts`.

Inside `executeMutationEnvelope`, add a local helper:

```ts
const finishWith = (outcome: RefusalCode | 'success', backupId?: string): boolean =>
  recordAudit('result', outcome, backupId);
```

and route ALL nine terminal sites through it (`finishWith('BACKUP_FAILED', backupId); result =
refusal('BACKUP_FAILED');` etc., and the success site). The returned boolean is captured at each
site into a single `let terminalAuditRecorded: boolean` local — read by nothing this slice, with
the one-line comment that Slice 3's `AUDIT_RESULT_FAILED` precedence lives here. No call site may
bypass the helper (grep gate: exactly ONE `recordAudit('result'` occurrence remains — inside
`finishWith`).

- [ ] **RED:** new test — a fake audit sink that THROWS on `phase === 'result'` (today: swallowed
  by `recordAudit`'s catch); assert the envelope still returns success and events still end
  `audit.result, lock.release`. This pins today's behavior so Slice 3's change will be a
  deliberate test edit, not an accident. (It may pass immediately against current code — that is
  acceptable here because the test's purpose is a behavior PIN before restructuring; record that
  it passed pre-change, then verify it still passes post-change.)
- [ ] **Implement**; grep gate `grep -c "recordAudit('result'" src/capabilities/kernel.ts` → 1.
- [ ] **GREEN** + canary unchanged. Commit: `refactor: collapse the terminal audit into one helper`

---

### Task 3: R4 — the backup request carries what the spec requires

**Files:** `src/capabilities/types.ts`, `src/capabilities/kernel.ts` (step 4, ~:1700-1717),
`src/capabilities/envelope/config-backup.ts`, `tests/capabilities/mutation-envelope.test.ts`,
`tests/capabilities/envelope/config-backup.test.ts`, `tests/capabilities/dispatch.test.ts` (stubs).

**Contract:**

```ts
export interface BackupRequest {
  readonly targetKey: string;
  readonly capabilityId: string;
  readonly mcpName: string;
  readonly argumentsSha256: string;
  readonly effectiveResourceScopes: readonly string[];
  readonly observedStateDigest: string;
  readonly effectPlanDigest: string;
}

export interface BackupService {
  create(request: BackupRequest, signal: AbortSignal): Promise<{ readonly backupId: string }>;
  exists(backupId: string, signal: AbortSignal): Promise<boolean>;
}
```

The kernel builds the request at step 4 from `capability`, `authorization`, and the sealed
preflight (`sealed.observedStateDigest`, `sealed.effectPlanDigest`) — all already in scope.
`createOPNsenseConfigBackupService.create` accepts the request and (this slice) uses only what it
used before (the download + store path are unchanged; it may record nothing new — Slice 2b's
durable metadata consumes the rest). `exists` gains the signal parameter and ignores it this
slice. The `MUTATION_TARGET_KEY` literal becomes the `targetKey` field.

- [ ] **RED (the review's test-prep item #1):** replace the zero-arg fakes with argument-CAPTURING
  fakes:

```ts
const backupRequests: BackupRequest[] = [];
// in the fake: create: (request, signal) => { backupRequests.push(request); ... }
```

  and a new assertion in the success-path test: `expect(backupRequests[0]?.targetKey).toBe('opnsense-config');`
  plus `expect(backupRequests[0]?.observedStateDigest).toBe(<the digest the fake preflight produces>)`
  (read the harness's preflight fake to name the exact literal). Against current code this fails
  at the type level (fakes no longer match `BackupService`) — the required RED.
- [ ] **Implement**; keep `config-backup.test.ts` green by adapting its constructions to the new
  signature (behavior assertions unchanged).
- [ ] **GREEN** + canary. Commit: `refactor: hand the backup service the request the spec names`

---

### Task 4: R5 — no unbounded envelope step

**Files:** `src/capabilities/kernel.ts` (steps 1, 4, 9), `tests/capabilities/mutation-envelope.test.ts`.

Wrap `services.lock.acquire`, `services.backup.create`, `services.backup.exists`, and the
sequential `lock.release` in the existing `runBounded(timeoutMs, context.signal, ...)` machinery
(release: bounded but its timeout maps to the same swallowed-failure behavior as today — a bounded
abort of release is 'unconfirmed'-equivalent and IGNORED this slice). Mapping on timeout/abort:
acquire → `LOCK_UNAVAILABLE` (unchanged code), create/exists → `BACKUP_FAILED` via `finishWith`
(unchanged codes). No new refusal codes.

- [ ] **RED:** new test — a fake lock whose `acquire` never resolves; with the envelope's
  `timeoutMs`, assert the dispatch resolves to the `LOCK_UNAVAILABLE` refusal instead of hanging
  (use vitest fake timers or a short real timeout — read how existing timeout tests in this file
  drive `timeoutMs`, and mirror that mechanism exactly). Fails today (hangs / times the test out)
  — cap the test with its own timeout and assert completion.
- [ ] **Implement**; **GREEN** + canary. Commit: `refactor: bound every envelope service call`

---

### Task 5: R7 + R8 — fail-closed lazy services and the origin seam

**Files:** `src/app/default-application.ts` (~:88-128), `tests/app/default-application.test.ts`.

Restructure the configured branch:

1. Extract a local `buildMutationServices(client: OPNsenseHttpsClient, origin: string):
   { services: MutationEnvelopeServices; dispose: () => void } | undefined` — today it constructs
   exactly what the current inline code constructs (tmpdir store, in-process lock, bounded audit
   ring; `dispose` removes the backup root) and CANNOT fail on darwin/linux; wrap its body in
   try/catch returning `undefined` on any throw, so a future `openResolvedStateRoot` failure (win32,
   unwritable root — Slice 2b) degrades to a read-only server instead of killing startup. When it
   returns `undefined`, the application context is created WITHOUT services — the kernel's existing
   no-services guard then refuses writes (`EXECUTION_FAILED`) and the write tools are not listed
   (existing exposure gate). The `origin` parameter is the seam (R8): pass
   `loadOPNsenseConnectionConfig(configPath)`'s `.url` — hold the parsed config in a local instead
   of inlining it into `createOPNsenseHttpsClient(...)`. `buildMutationServices` does not USE
   origin this slice beyond storing it in a closure-level comment-free constant that Slice 2b will
   consume — to keep it honest, have it RETURN the origin in its result object
   (`{ services, dispose, origin }`) and have the caller ignore it; that is a real seam, not a
   dead parameter.
2. **Test-prep item #2:** in `tests/app/default-application.test.ts`, DELETE the source-text
   assertions (`expect(factory).toContain('createInProcessMutationLockManager()')` and the
   `createOPNsenseConfigBackupService(client` one, ~:440-450) and replace with behavioral tests:
   (a) with a valid config file, the runtime's catalog exposes the write tools under the write
   gates (or: dispatching the write capability reaches the envelope — mirror how existing tests in
   this file observe the composed application; read the file first and reuse its harness); (b) NEW:
   if service construction throws (inject by... the factory is not injectable — so simulate the
   failure path structurally: export `buildMutationServices` for tests? No — keep it private;
   instead assert the fail-closed CONTRACT at the kernel level, which
   `tests/capabilities/dispatch.test.ts` already covers via `services === undefined`, and at the
   app level assert only that a valid config still yields listed write tools. Record in the report
   that the throw-path becomes reachable and directly testable in Slice 2b when
   `openResolvedStateRoot` is in the path.)

- [ ] **RED:** the replacement behavioral test (a) written first — it should pass against current
  code IF the harness observes real behavior (it is a pin, like Task 2's; record pre/post). The
  DELETED source-text tests are the actual RED: after the restructure they would fail, proving
  they were coupled to source text — delete them in the same commit as the restructure.
- [ ] **Implement**; **GREEN**: `npx vitest run tests/app/ tests/capabilities/`. Commit:
  `refactor: build mutation services fail-closed and expose the origin seam`

---

### Task 6: Carry-over — sweep candidates once, not every attempt

**Files:** `src/state/identity-key.ts`, `tests/state/identity-key.test.ts`.

Today `attemptEnsureIdentityKey` runs `cleanupCandidates` on EVERY attempt, so live peers keep
deleting each other's in-flight candidates — the race class the backoff out-waits. Change: sweep
only on the FIRST attempt of an `ensureIdentityKey` call (pass `attempt === 1` down, or hoist the
sweep out of the attempt loop into `ensureIdentityKey` before the loop). Crash residue is still
removed (first attempt always sweeps); a peer's in-flight candidate created AFTER our sweep is no
longer deleted by our retries. The retry/backoff machinery stays exactly as is (it still protects
the remaining first-sweep window).

- [ ] **RED — two-level proof (a module-private decision is not directly observable, so pin it at
  both levels):** (1) hoisting the sweep out of the attempt loop is the change; pin it with a test
  that plants a candidate INSIDE the retry pause via the existing injectable `wait` seam — the
  injected `wait` writes a fresh valid-pattern candidate file into the root on its first
  invocation, the run is driven into retries by a planted stray hard link removed by the same
  injected `wait` on its second invocation... if that choreography proves brittle in practice, the
  implementer may fall back to level (2) alone and MUST say so in the report. (2) the race file
  re-run TWICE green (fresh + residue scenarios), plus the same 20-way scratch stress the
  retry-margin fix used, reporting the retry-depth histogram before/after — with mutual sweeping
  structurally impossible after attempt 1, the depth should collapse (expect deepest ≤ 2); if it
  does not collapse, report the anomaly instead of tuning anything.
- [ ] **Implement** (hoist sweep before the loop OR `if (shouldSweep(attempt))` inside — prefer the
  hoist; keep `shouldSweep` only if the hoist proves awkward, and delete this option from the code
  if unused). Update the file's mechanism comments (the 0 ms rung rationale references mutual
  sweeping — soften to past tense: the sweep no longer recurs, the rung still covers the
  first-sweep window).
- [ ] **GREEN:** `npx vitest run tests/state/` ×2 including the race file; stress histogram in the
  report. Commit: `fix: sweep identity-key candidates once per start, not per retry`

---

### Task 7: Carry-overs — version-drift test, backup-discipline legs, stale comments

**Files:** Create `tests/foundation/version-drift.test.ts`; modify
`tests/capabilities/envelope/config-backup.test.ts`, `src/capabilities/envelope/config-backup.ts`
(comment only), `src/state/state-root.ts` (comment only).

1. **Version drift** (13 hand-synced sites caused a missed-pin class in Task 1.1-7): a test that
   reads `package.json`'s version and asserts each PRODUCT pin file contains it:
   `src/main.ts` (`CLI_VERSION = '<v>'`), `src/capabilities/foundation/server-status.ts` (both
   literals), `src/server/build-server.ts`, `src/http/legacy-sse.ts`, `scripts/run-conformance.mjs`,
   `scripts/vm/product1b-live.mjs` (the `status.version` assertion line). Read each file as text
   and assert `content.includes(version)` with a per-file failure message naming the file. Do NOT
   assert on sealed fixtures or client-identity pins.
2. **Backup discipline legs** (~15 lines, live module's only copy since the dead one was deleted):
   in `config-backup.test.ts`, add three tests against the real service + synthetic target the
   file already constructs: (a) a stored backup file given a second hard link → `exists` false;
   (b) a stored file truncated by one byte → `exists` false; (c) a stored file with one flipped
   byte (checksum mismatch) → `exists` false. RED-first: if any of the three passes trivially or
   fails for the wrong reason, STOP and report — that is a live-module gap (the Task 1.1-5 review
   predicted these guards exist at config-backup.ts:42/:53/:88 — the tests should pass after
   plumbing, i.e. they are pins; record pre/post behavior).
3. **Stale comments** (both files get resealed at landing anyway): `config-backup.ts:22-25` drop
   the reference to the deleted synthetic module; `state-root.ts` `openResolvedStateRoot` comment
   ("widens the accepted spelling, not the accepted directory") → state the fail-open ancestor
   delta and point at the Slice 2 unsafe-ancestor decision.

- [ ] RED/GREEN per item; `npx vitest run tests/foundation/version-drift.test.ts
  tests/capabilities/envelope/` green. Commit:
  `test: pin version sites and the backup discipline, and true up two comments`

**AS LANDED:** item 2's legs (b) and (c) are DEFERRED, not delivered. The premise was false — the
three guards live in `readRegularPrivateFile`, reached only from `create`'s write-path re-read, and
`create` persists neither digest nor length, so no implementation of `exists` alone can detect a
truncated or flipped backup. Legs (b)/(c) landed INVERTED, as red-if-fixed pins of current
behaviour; leg (a) (`nlink`) is a true pin. Content verification is a Slice 2b prerequisite, to be
done with R6's durable backup root, and the two pins go red the moment it lands.

---

### Task 8: Docs, ledger, gates

**Files:** `docs/project-status.md`, `.superpowers/sdd/progress.md` (`git add -f`).

- `docs/project-status.md`: current-mutation-limitations section gains one sentence (interfaces
  reshaped for durability — services still process-lifetime); the Slice 2 carry-over list is
  UPDATED: R1–R5/R7–R8 done (one line each with what changed; R9 was deliberately deferred to 2b
  alongside its durable consumer), sweep-once done, drift test done, comments done; REMAINING for
  2b/3: R6 durable root + durable backup/audit/lock implementations, R9 audit-field extension,
  unsafe-ancestor decision (unchanged wording), `AUDIT_RESULT_FAILED`/`LOCK_RELEASE_FAILED`
  semantics (Slice 3), the UX backlog note (`EXECUTION_FAILED` vs upstream 403 — refusal
  vocabulary is opened in Slice 3; note it as a candidate there), AND these review-mandated 2b
  prerequisites: **separate target-reachability from write-availability in the catalogue** (one
  shared `aliasAdapter.available` flag currently makes the R7 degrade kill alias READS; on win32
  `openResolvedStateRoot` throws unconditionally, so in 2b the degrade IS the win32 path — without
  the split, 2b ships a win32 read regression against R7's own goal; a red-if-fixed pin exists in
  the degrade test); the origin seam carries `parsed.url` verbatim (2b must canonicalize before
  deriving a target id); `transactionId` missing from both `BackupRequest` and `AuditRecord`
  (symmetric 2b addition); the late-granted-lock retain-hook note; the Slice 3 audit notes from
  Task 2 (success-audit inside the parse try; terminalAuditRecorded conflation; kernel:1870
  untested).
- Ledger entry in the file's style: what changed, the canary (step-order unchanged), the
  sweep-once stress histogram, gates.
- [ ] Gates: `npm run license:check && npm run verify && npm run test:conformance && git diff
  --check` all 0 (`evidence:*` stale on-branch by design).
- [ ] Commit: `docs: record the envelope prep slice`

---

## Landing (controller, after final review)

finishing-a-development-branch → merge ff → real `smoke:opencode` (src changed) → full gates green
→ candidate fixture commit → `vm:product3` → attestation commit → `evidence:verify` 0 +
`evidence:check` 0 → push → confirm all four CI jobs executed. No release this slice.

## Self-review notes

- R6 (durable root replacing tmpdir) and R9's actual new audit fields are deliberately ABSENT: R6
  is Slice 2b's core, and widening `ALLOWED_KEYS` without a durable consumer would add dead
  surface; the type extension point is prepared by Task 3's `BackupRequest` instead.
- Task 2's and Task 5(a)'s pins may pass pre-change; both are recorded as pins (the plan calls
  this out) — the reviewer should treat "passed before and after" as their success mode.
- Task 6's sweep-once keeps the backoff untouched; if the stress histogram does NOT collapse
  (deepest > 2 at 20-way), the implementer reports it as an anomaly instead of tuning anything.
- The step-order canary is the slice's single most load-bearing assertion; every task re-runs it.
