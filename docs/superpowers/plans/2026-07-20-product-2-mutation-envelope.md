# Product 2 — Central Mutation Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement this plan task-by-task with a fresh subagent and two-stage
> review per task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared, fail-closed write-path safety envelope to the capability kernel — target lock,
sealed preflight, redacted audit, strict verified backup, state revalidation, bounded execution, outcome
verification, and lock release in one fixed order — proven entirely with synthetic services and
deterministic tests, adding **no public mutation** and admitting **no real OPNsense write adapter**.

**Architecture:** Keep the existing closed capability kernel (`src/capabilities/kernel.ts`) and composition
root (`src/app/application-context.ts`). Read-effect dispatch keeps its current fast path unchanged. Add a
second, write-only path: a new `defineWriteCapability` factory captures each mutation's `preflight` and
`verifyOutcome` callbacks in kernel-private `WeakMap`s (trusted static startup code, exactly like the existing
resolver/handler capture); cross-cutting `MutationEnvelopeServices` (lock, backup, audit) are injected into
`createCapabilityDispatcher`. A new kernel-internal `executeMutationEnvelope` runs the fixed lifecycle. The
envelope is exercised by **synthetic write capabilities defined in tests only**; the product catalog continues
to expose only the four read tools.

**Tech Stack:** Node.js 22 (ESM), TypeScript strict, Zod v4 (`zod/v4`), Vitest, `@modelcontextprotocol/server`.

## Global Constraints

- Node.js `>=22.19 <23`; validate only with `/opt/homebrew/opt/node@22/bin` on this workstation. Install with
  `npm ci --ignore-scripts`.
- Never target a production firewall. No real OPNsense write adapter is admitted in Product 2. Never log,
  commit, or pass credentials; secrets never appear in arguments, audit records, logs, MCP results, or fixtures.
- Capability modules, schemas, refinements, and captured callbacks (`handler`, `resolver`, and the new
  `preflight`/`verifyOutcome`) are trusted static startup code. Do not mutate a schema after `defineCapability`.
  Do not load third-party capability code in-process. Do not add an executable-object or callback admission path.
- Preserve all existing read behavior and every current test. Preserve the paused, uncommitted Windows/
  distribution working-tree changes; do not fold them into these commits.
- Every task ends with `npm run typecheck`, `npm run license:check`, its focused tests, `git diff --check`, and
  one atomic local commit. No push, publication, or release.
- The v0.1 public surface stays exactly `server_status`, `opn_describe`, `opn_get`, `opn_list`. This plan adds
  no exposed tool and changes no `tools/list` bytes.

## Normative envelope order (fixed — assert exactly)

From `specs/2026-07-19-operation-catalog-progressive-discovery-design.md:214` and
`specs/2026-07-17-independent-mcp-v2-rebuild-design.md:126`, after admission (authorization + optional
confirmation) a write runs, in this exact order:

1. **target lock** — acquire the target's exclusive mutation lock; busy fails closed.
2. **sealed preflight** — run the capability's declared side-effect-free bounded read-only preflight; bind an
   effect plan plus an observed-state digest.
3. **redacted audit intent** — record the mutation intent (no secrets, no raw args).
4. **strict verified backup** — create and checksum-verify a pre-change snapshot; a failed or unverified
   backup prevents the write.
5. **state revalidation** — re-observe and prove the digest still matches the sealed preflight before the
   first write.
6. **bounded execution** — run only the sealed apply phase, abortable and timed out.
7. **outcome verification** — verify the declared outcome by read-back.
8. **final audit** — record the redacted result.
9. **lock release** — always, in a fail-closed `finally`.

On any post-backup failure, timeout, or unverifiable outcome the server **preserves the backup**, returns
**fixed reconciliation guidance**, records the final audit, releases the lock, and **never blind-restores** and
**never reports the outcome as success**.

## Binding decisions

- Product 2 adds no public mutation. The envelope is exercised only by synthetic `firewall-write`/`local-write`
  capabilities constructed inside tests. `createProductCapabilityCatalog` is unchanged.
- Read-effect capabilities never enter the envelope; their dispatch path and results are byte-for-byte
  unchanged. A regression test asserts this.
- `MutationEnvelopeServices = { lock: MutationLockManager, backup: BackupService, audit: AuditSink }` is an
  optional parameter of `createCapabilityDispatcher`. Invariant, enforced at dispatcher construction: if the
  catalog exposes any capability whose `policy.effect !== 'read'`, the services must be present, else construction
  throws. A read-only catalog needs no services (today's production path).
- Effect → required policy, validated in `defineWriteCapability`: `firewall-write` requires `backup: 'strict'`
  and `audit: 'required'`; `local-write` requires `audit: 'required'` and may use `backup: 'none'` with a
  declared recovery note. Any write effect requires a non-empty `preflight` and `verifyOutcome`.
- New `RefusalCode`s added in `src/capabilities/types.ts` and mirrored into **both** exhaustive
  `Record<RefusalCode, string>` maps (`src/capabilities/kernel.ts:96` and `src/mcp/results.ts:10`, the only two
  in the tree): `LOCK_UNAVAILABLE`, `PREFLIGHT_FAILED`, `BACKUP_FAILED`, `STATE_REVALIDATION_FAILED`,
  `OUTCOME_UNVERIFIED`. Aborted writes keep the existing `OUTCOME_INDETERMINATE`. Every write refusal message is
  fixed and sanitized. Adding a code without updating both maps fails `npm run typecheck`.
- Reconciliation refusals (`OUTCOME_INDETERMINATE`, `OUTCOME_UNVERIFIED`) surface only their fixed guidance
  string via `REFUSAL_MESSAGES`. The preserved `backupId` and the preservation fact are recorded only in the
  server-side audit `result` record and **never cross the MCP boundary**; no backup content, no raw firewall
  state, and no dynamic detail is added to the client-facing refusal.
- Backup artifacts: directory mode `0700`, file mode `0600`, symlinks refused, checksum verified on write and
  re-read; backup bytes never cross the MCP boundary or appear in a result/audit record. Product 2 ships a
  synthetic filesystem-backed `BackupService` used only by deterministic tests and the composition wiring; it
  performs no network I/O.
- Audit records contain: capability id, mcpName, effect, `argumentsSha256`, effective resource scopes, phase
  (`intent`/`result`), decision/outcome code, and monotonic sequence — never raw arguments, output, or secrets.
  The `AuditSink` is bounded (ring buffer) and append-only within the process.
- Confirmation stays as implemented; the existing elicitation `completion` path routes into the same
  `executeMutationEnvelope`, so a confirmed write is enveloped identically to a direct one.

---

## Task 1: Write-effect seam, refusal vocabulary, and service interfaces

**Files:**
- Modify: `src/capabilities/types.ts` (add the five `RefusalCode`s; add `MutationEnvelopeServices`,
  `MutationLockManager`, `BackupService`, `AuditSink`, `AuditRecord`, `PreflightResult` interfaces).
- Modify: `src/capabilities/kernel.ts` (add `REFUSAL_MESSAGES` entries; add the `defineWriteCapability` factory
  with kernel-private `preflightCallbacks`/`verifyOutcomeCallbacks` `WeakMap`s and effect→policy validation;
  add a no-op envelope branch stub in `executeAuthorized` guarded by effect).
- Modify: `src/mcp/results.ts` (mirror the five new `REFUSAL_MESSAGES` entries so the exhaustive
  `Record<RefusalCode, string>` still typechecks).
- Test: `tests/capabilities/write-capability-definition.test.ts` (new).

**Interfaces produced (consumed by Tasks 2–5):**
- `defineWriteCapability<TInput, TApply, TOutput>({ ...capabilityFields, policy, preflight, handler,
  verifyOutcome })` → `CapabilityDefinition`. `preflight(input, ctx) => Promise<PreflightResult>` where
  `PreflightResult = { readonly effectPlanDigest: string; readonly observedStateDigest: string }`.
  `verifyOutcome(input, applyOutput, ctx) => Promise<boolean>`.
- `MutationLockManager.acquire(targetKey, signal) => Promise<LockHandle | null>`; `LockHandle.release() =>
  Promise<void>`.
- `BackupService.create(scope, signal) => Promise<{ backupId: string } >` (throws on unverified);
  `BackupService.exists(backupId) => Promise<boolean>`.
- `AuditSink.record(record: AuditRecord) => void`.

- [ ] **Step 1 — RED:** add `tests/capabilities/write-capability-definition.test.ts` asserting that
  `defineWriteCapability` (a) rejects a `firewall-write` policy without `backup: 'strict'`, without
  `audit: 'required'`, or with a missing/non-function `preflight`/`verifyOutcome` by throwing
  `Invalid capability definition`; (b) accepts a well-formed synthetic `firewall-write` definition and returns a
  data-only `CapabilityDefinition` that passes `isKernelDefinedCapability`. Run:
  `npx vitest run tests/capabilities/write-capability-definition.test.ts` — expected FAIL (export missing).
- [ ] **Step 2:** add the five refusal codes to `RefusalCode` and to **both** `REFUSAL_MESSAGES` maps
  (`src/capabilities/kernel.ts` and `src/mcp/results.ts`) with fixed sanitized strings; bake the reconciliation
  guidance into the `OUTCOME_INDETERMINATE` and `OUTCOME_UNVERIFIED` messages. Add the service/record interfaces
  to `types.ts`.
- [ ] **Step 3:** implement `defineWriteCapability` by composing the existing `defineCapability` (reuse its
  sealed metadata copy) then capturing `preflight`/`verifyOutcome` in kernel-private `WeakMap`s and validating
  the effect→policy matrix. Keep the public definition data-only (no new own-keys leak onto `CapabilityDefinition`).
- [ ] **Step 4:** in `executeAuthorized`, branch on `capability.policy.effect`: `read` keeps the current path;
  a write effect calls a new `executeMutationEnvelope(...)` that, for now, throws `Capability handler is
  unavailable` if services are absent (stub; real body arrives Task 2–4). Add a construction-time invariant in
  `createCapabilityDispatcher` that any exposed non-read capability requires `MutationEnvelopeServices`.
- [ ] **Step 5:** run `npx vitest run tests/capabilities/write-capability-definition.test.ts` (PASS),
  `npm run typecheck`, `npm run license:check`, `git diff --check`. Commit:
  `feat: add write-capability definition and envelope seam`.

## Task 2: Lock → preflight → audit intent (steps 1–3), with synthetic services

**Files:**
- Create: `src/capabilities/envelope/lock.ts` (`createInProcessMutationLockManager`), `.../backup.ts`
  (`createLocalBackupService` — used from Task 3, scaffolded here), `.../audit.ts` (`createBoundedAuditSink`).
- Modify: `src/capabilities/kernel.ts` (`executeMutationEnvelope` steps 1–3 + fail-closed release).
- Test: `tests/capabilities/envelope/lock.test.ts`, `.../audit.test.ts`,
  `tests/capabilities/mutation-envelope-order.test.ts` (new; extended through Task 4).

- [ ] **Step 1 — RED:** in `mutation-envelope-order.test.ts`, build a dispatcher over a catalog view holding one
  synthetic `firewall-write` capability plus recording service doubles. Assert that a dispatch (a) acquires the
  lock before running preflight, (b) runs preflight before recording the audit `intent`, and (c) when
  `lock.acquire` resolves `null`, refuses with `LOCK_UNAVAILABLE`, records no audit intent, and never calls
  preflight/handler. Run the file — expected FAIL.
- [ ] **Step 2:** implement `createInProcessMutationLockManager` (per-`targetKey` mutual exclusion, fail-closed
  `null` when held, `release()` idempotent) with `lock.test.ts` covering contention, release, and re-acquire.
- [ ] **Step 3:** implement `createBoundedAuditSink` (ring buffer, monotonic sequence, redaction — rejects any
  record whose fields include raw arguments/output) with `audit.test.ts`.
- [ ] **Step 4:** implement `executeMutationEnvelope` steps 1–3: acquire lock (`LOCK_UNAVAILABLE` on null); run
  the captured `preflight` inside `runOperation` bounds (`PREFLIGHT_FAILED` on throw/abort, lock released);
  record redacted audit `intent`. On any failure so far, release the lock and record nothing that leaks input.
- [ ] **Step 5:** run the three test files, `npm run typecheck`, `npm run license:check`, `git diff --check`.
  Commit: `feat: add mutation lock, audit sink, and envelope preflight`.

## Task 3: Strict verified backup → state revalidation (steps 4–5)

**Files:**
- Modify: `src/capabilities/envelope/backup.ts` (`createLocalBackupService`: temp-dir store, `0700`/`0600`,
  symlink refusal, checksum verify on write and re-read; no network).
- Modify: `src/capabilities/kernel.ts` (`executeMutationEnvelope` steps 4–5).
- Test: `tests/capabilities/envelope/backup.test.ts` (new),
  extend `tests/capabilities/mutation-envelope-order.test.ts`.

- [ ] **Step 1 — RED (backup):** `backup.test.ts` requires directory `0700`, file `0600`, refusal on a symlinked
  path, checksum mismatch → throw, and that `create` returns only a `backupId` (never bytes). Run — FAIL.
- [ ] **Step 2:** implement `createLocalBackupService` to satisfy those tests using `node:fs` with
  `O_NOFOLLOW`-equivalent `lstat` guards mirroring `src/opnsense/config.ts` bounded-file discipline.
- [ ] **Step 3 — RED (order):** extend the order test: after audit intent, a `firewall-write` calls
  `backup.create` before any handler call; a backup throw refuses with `BACKUP_FAILED`, releases the lock,
  records the final audit, and never calls the handler. Then revalidation re-runs `preflight`; a changed
  `observedStateDigest` refuses with `STATE_REVALIDATION_FAILED`, **preserving** the backup (assert
  `backup.exists(backupId) === true`) and releasing the lock. Run — FAIL.
- [ ] **Step 4:** implement steps 4–5 in `executeMutationEnvelope`: for `backup: 'strict'` create+verify the
  backup (`BACKUP_FAILED` fail-closed, no write); re-run `preflight` and compare `observedStateDigest`
  (`STATE_REVALIDATION_FAILED` fail-closed). Thread `backupId` into the reconciliation-capable result envelope.
- [ ] **Step 5:** run backup + order tests, `npm run typecheck`, `npm run license:check`, `git diff --check`.
  Commit: `feat: add strict verified backup and state revalidation`.

## Task 4: Bounded execution → verification → final audit → release + reconciliation (steps 6–9)

**Files:**
- Modify: `src/capabilities/kernel.ts` (`executeMutationEnvelope` steps 6–9; reconciliation refusals).
- Test: extend `tests/capabilities/mutation-envelope-order.test.ts`; add
  `tests/capabilities/mutation-envelope-reconciliation.test.ts`; add `tests/mcp/results.test.ts` cases for the
  five new codes.

- [ ] **Step 1 — RED (success order):** assert a fully successful synthetic write emits exactly:
  `lock.acquire → preflight → audit(intent) → backup.create → preflight(revalidate) → handler →
  verifyOutcome → audit(result) → lock.release`, in that order, and returns `{ kind: 'success', output }`
  with the parsed/canonicalized output. Run — FAIL.
- [ ] **Step 2 — RED (fail-closed matrix):** in the reconciliation test assert, using the recording audit sink
  and backup double: (a) `verifyOutcome` returns `false` → refusal `OUTCOME_UNVERIFIED` whose message is the
  fixed guidance, the final audit `result` record names the preserved `backupId`, `backup.exists(backupId)` is
  `true`, and the lock is released; (b) handler abort/timeout → `OUTCOME_INDETERMINATE` with the same
  preservation/guidance/release; (c) handler throw → `EXECUTION_FAILED`, backup preserved, lock released; (d) a
  `verifyOutcome` throw is treated as unverified, not success; (e) `lock.release` is called exactly once on
  every path. Assert no path performs an automatic restore and no refusal carries a `backupId` across the MCP
  boundary. Run — FAIL.
- [ ] **Step 3:** implement steps 6–9: run the sealed `handler` via `runOperation` (reuse the existing
  `aborted-write → OUTCOME_INDETERMINATE` semantics); on success run `verifyOutcome` (`OUTCOME_UNVERIFIED` on
  `false`/throw); parse/canonicalize output exactly as the read path; record the redacted final audit `result`
  (with `backupId` server-side only); release the lock in a `finally`. Reconciliation refusals surface only the
  fixed guidance message.
- [ ] **Step 4:** add `tests/mcp/results.test.ts` cases asserting `refusalResult` renders each new code as its
  fixed message with `structuredContent: { code }` and no `backupId`/detail leak (the `Record<RefusalCode>` map
  is already total from Task 1).
- [ ] **Step 5:** run all envelope tests, `npm run typecheck`, `npm run license:check`, `git diff --check`.
  Commit: `feat: complete mutation envelope execution, verification, and reconciliation`.

## Task 5: Composition wiring, bypass re-proofs, and full gate

**Files:**
- Modify: `src/app/application-context.ts` and `src/app/default-application.ts` (construct the concrete
  `MutationEnvelopeServices` and pass them to `createCapabilityDispatcher`; drain lock/backup/audit resources
  through the existing owned-runtime close order).
- Test: `tests/app/*` composition tests; `tests/capabilities/read-path-unchanged.test.ts` (new);
  extend `tests/mcp/*` dual-era integration to re-prove read-only hiding and forged-write refusal.

- [ ] **Step 1 — RED (bypass):** assert with `READ_ONLY=true` (production default) the catalog still lists only
  the four read tools on both transports, a forged direct dispatch of a `firewall-write` mcpName is refused
  `READ_ONLY` before any lock/backup/audit call, and constructing a dispatcher that exposes a write capability
  without services throws. Run — FAIL where wiring is missing.
- [ ] **Step 2 — RED (read unchanged):** `read-path-unchanged.test.ts` dispatches `server_status`/`opn_get`/
  `opn_list` and asserts the lock/backup/audit doubles were never touched and results equal the pre-envelope
  baseline. Run — FAIL if the read branch regressed.
- [ ] **Step 3:** wire concrete services into the composition root; keep the product catalog read-only so no
  mutation is exposed; ensure `closeApplicationContext` drains/releases envelope resources. Make Steps 1–2 pass.
- [ ] **Step 4:** run the full gate: `npm run operations:check`, `npm run format:check`, `npm run lint`,
  `npm run typecheck`, `npm run license:check`, `npm test`, then `npm run test:conformance` and
  `npm run provenance:verify` and `git diff --check`. All green.
- [ ] **Step 5:** request an independent whole-increment review (spec-conformance + code-quality). Commit:
  `feat: wire mutation envelope into composition with bypass proofs`. Do not push or publish.

## Product 2 exit

The kernel runs the fixed nine-step envelope for every write-effect dispatch, proven by synthetic
`firewall-write`/`local-write` capabilities and deterministic service doubles; every bypass, lock-contention,
preflight, backup, revalidation, execution, and verification failure fails closed, preserves the backup where a
write may have started, emits redacted intent/result audit, releases the lock, and never blind-restores. Read
dispatch is byte-for-byte unchanged and the public surface is still the four read tools.

## Explicit non-claims

- No firewall mutation is available. No real OPNsense write adapter, backup endpoint, or SSH path is admitted.
- The synthetic `BackupService` proves the local file discipline only; it does not prove OPNsense's
  configuration-history snapshot. That is Product 3 against the disposable VM.
- No new exposed tool, plugin, client, Windows, benchmark, or release claim. No push or publication.
