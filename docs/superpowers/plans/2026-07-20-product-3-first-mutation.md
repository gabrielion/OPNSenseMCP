# Product 3 — First Reversible, Backed-Up Mutation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` to implement this plan task-by-task with a fresh subagent and two-stage
> review per task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admit the first real OPNsense mutation — create and delete a firewall **host alias** through the
generic write verbs, running the Product 2 mutation envelope end to end against a real write adapter — proven
by deterministic contract, unit, and MCP-to-mock tests, then sealed on the disposable VM.

**Architecture:** Widen the operation catalogue to a second resource (`firewall.alias`) with read + firewall-write
operations; add a kernel factory `defineWriteResourceCapability` that composes the existing resource-resolution
and mutation-envelope registrations; extend `opn_list` to genuine multi-resource dispatch; define `opn_create`
and `opn_delete`; wire real envelope services (OPNsense config backup, in-process lock, redacted audit) into
the composition root for the first time.

**Tech Stack:** Node.js 22 (ESM), TypeScript strict, Zod v4 (`zod/v4`), Vitest, `@modelcontextprotocol/server`,
synthetic HTTPS OPNsense mock, QEMU/OPNsense-26 disposable VM (Product 1B harness).

## Global Constraints

- Node.js `>=22.19 <23`; validate only with `/opt/homebrew/opt/node@22/bin` on this workstation
  (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`). Install with `npm ci --ignore-scripts`.
- Never target a production firewall; the disposable Product 1B VM is the only live target. Never log, commit,
  or pass credentials; secrets never appear in arguments, audit records, adapter errors, results, logs, or
  fixtures.
- Capability modules, Zod schemas, refinements, transforms, and captured callbacks (`handler`, `resolver`,
  `preflight`, `verifyOutcome`) are trusted static startup code. Do not mutate a schema after definition, do not
  load third-party capability code in-process, and do not add an executable-object or callback admission path.
- Preserve all existing read behaviour and every current test. Preserve the paused, uncommitted Windows/
  distribution stash; do not fold it into these commits.
- Every task ends with `npm run typecheck`, `npm run license:check`, its focused tests, `git diff --check`, and
  one atomic local commit. No push, publication, or release.
- Lint is strict (`--max-warnings 0`): no `!` non-null assertions, no unnecessary casts, no void-returning arrow
  shorthand, `String()` on template expressions, and closure-mutated booleans are flagged; run `npm run lint`
  before the final task commit where practical.
- The mutation-envelope order is normative and unchanged from Product 2: lock → sealed preflight → redacted
  audit intent → strict verified backup → state revalidation → bounded execution → outcome verification → final
  audit → lock release. Every post-backup failure preserves the backup, returns fixed reconciliation guidance,
  never blind-restores, never reports success, and never lets `backupId` cross the MCP boundary.

## Binding decisions

- One resource only: `firewall.alias`, a single **host** alias. Create attributes are bounded: `name`
  `^[A-Za-z0-9_]{1,32}$`; `type` the literal `host`; `content` 1..64 entries, each a bounded IPv4/IPv6/hostname
  string (`maxLength` 253); `description` optional, `maxLength` 255. No `opn_update`, `opn_set_enabled`, toggle,
  non-host type, or any other resource.
- Both write verbs carry `effect: 'firewall-write'`, `backup: 'strict'`, `audit: 'required'`,
  `confirmation: 'elicitation'`.
- `opn_list` becomes genuinely multi-resource; its advertised output is a reviewed per-resource union (service
  row | alias row); the handler validates against the resolved resource's row shape. `opn_get` stays
  `system.status`-only.
- The generator (`scripts/generate-operation-descriptors.mjs`) and the HTTPS client
  (`src/opnsense/https-client.ts`) are closed allow-lists; each new resource/operation is added by widening
  their explicit tables, never by inferring from an HTTP verb.
- The envelope backup service snapshots the **OPNsense running configuration** (`GET /api/core/backup/download/this`),
  not a local marker; it reuses the Product 2 private-file discipline (dir `0700`, file `0600`, no symlink,
  checksum verified on write and re-read) with a raised size bound for real `config.xml`.
- Deterministic layers (Tasks 1–8) are the focused Product 3 gate. The disposable-VM seal (Task 9) is the exit
  gate; it is run on the M3 under TCG and is not a merge blocker for the deterministic work.

---

## Task 1: Admit `firewall.alias` into the operation catalogue and contract

**Files:**
- Modify: `src/operations/types.ts` (widen `OperationEffect`).
- Modify: `src/operations/operation-contract.v1.json` (add the `firewall.alias` resource, its three operations,
  and their `$defs` schemas; rename `contractId`).
- Modify: `scripts/generate-operation-descriptors.mjs` (widen the closed validator tables).
- Regenerate: `src/operations/generated/descriptors.ts` (via `npm run operations:generate`).
- Test: `tests/operations/contract.test.ts` and/or `tests/operations/descriptors.test.ts` (extend existing
  operation tests; create if absent under `tests/operations/`).

**Interfaces produced (consumed by Tasks 2–8):**
- `OperationEffect = 'read' | 'firewall-write'`.
- Descriptor `firewall.alias` with `operations`: `list` (`effect:'read'`, `POST /api/firewall/alias/searchItem`,
  `capabilityId:'opnsense.list'`), `create` (`effect:'firewall-write'`, `POST /api/firewall/alias/addItem`,
  `capabilityId:'opnsense.create'`, apply `POST /api/firewall/alias/reconfigure`), `delete`
  (`effect:'firewall-write'`, `POST /api/firewall/alias/delItem`, `capabilityId:'opnsense.delete'`, same apply).
- Each `firewall.alias` operation carries `transportStatus:'documented'`, `evidence.vm:'pending'`.

- [ ] **Step 1 — RED:** extend the operations test to assert `getOperationDescriptor('firewall.alias')` exists
  with exactly the three operations above, that `firewall.alias/create` and `/delete` have
  `effect:'firewall-write'` and `resourceScope:'firewall.alias'`, and that the contract digest is stable across
  a second generation. Run: `npx vitest run tests/operations` — expected FAIL (resource absent).
- [ ] **Step 2:** widen `OperationEffect` in `src/operations/types.ts` to `'read' | 'firewall-write'`; add
  `applyCommand?: OperationCommand` to `RuntimeOperationDescriptor` for write operations' reconfigure step.
- [ ] **Step 3:** in `scripts/generate-operation-descriptors.mjs`: add `'firewall.alias'` to
  `EXPECTED_RESOURCES`; add three entries to `EXPECTED_OPERATION_TUPLES['firewall.alias']` (an array — change
  the per-resource tuple to a list); relax `resources.length !== 2` to `!== 3` and `operations.length !== 1` to
  `>= 1 && <= 3`; permit `effect` `'read' | 'firewall-write'`; require `applyCommand` (method/path) on
  firewall-write operations; replace the exact `sourceReferences` equality with membership in the allow-set
  `{https://docs.opnsense.org/development/api.html, .../api/core/core.html, .../api/core/firewall.html,
  .../api/core/backup.html}`; rename `contractId` check to `'opnsense-product-contract'`; keep
  `FORBIDDEN_SCHEMA_PROPERTY_NAMES` (alias property names `name/type/content/description/uuid` are permitted).
- [ ] **Step 4:** in `operation-contract.v1.json`, rename `contractId` to `opnsense-product-contract`; add the
  `firewall.alias` resource (module `firewall`, controller `alias`, wrapper `alias`, `sourceReferences` the
  firewall doc URL) with the three operations, each referencing new `$defs` schemas: `AliasListInput`
  (`page`/`pageSize`/`query`), `AliasListOutput` (`page`/`pageSize`/`total`/`items[]` of
  `uuid`/`name`/`type`/`description`), `AliasCreateInput` (`name`/`type`/`content[]`/`description`),
  `AliasCreateOutput` (`item` of `uuid`/`name`/`type`/`content[]`/`description`), `AliasDeleteInput` (`id`),
  `AliasDeleteOutput` (`item` of `id`/`deleted`).
- [ ] **Step 5:** run `npm run operations:generate` to regenerate `descriptors.ts`; run
  `npx vitest run tests/operations` (PASS), `npm run operations:check`, `npm run typecheck`,
  `npm run license:check`, `git diff --check`. Commit: `feat: admit firewall.alias into the operation catalogue`.

## Task 2: OPNsense firewall-alias write adapter and closed client arms

**Files:**
- Modify: `src/opnsense/https-client.ts` (add closed request arms + contract checks for the four alias commands).
- Create: `src/opnsense/alias-adapter.ts` (`createOPNsenseAliasAdapter`, `UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER`).
- Test: `tests/opnsense/alias-adapter.test.ts` (new).

**Interfaces produced:**
- Client arms: `{ operation:'firewall.alias/list', payload: AliasSearchPayload, signal }`,
  `{ operation:'firewall.alias/create', payload: AliasAddPayload, signal }`,
  `{ operation:'firewall.alias/reconfigure', signal }`,
  `{ operation:'firewall.alias/delete', id: string, signal }` (the delete path is
  `/api/firewall/alias/delItem/{uuid}`; the client appends the validated uuid).
- `OPNsenseAliasAdapter`: `readonly available: boolean`;
  `searchHostAliases(input: { page; pageSize; query }, signal) => Promise<AliasListOutput>`;
  `createHostAlias(attributes: { name; type:'host'; content: readonly string[]; description }, signal) =>
  Promise<AliasCreateOutput>`; `deleteHostAlias(id: string, signal) => Promise<AliasDeleteOutput>`.
- `UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER` mirrors `UNAVAILABLE_OPNSENSE_READ_ADAPTER` (frozen, rejects).

- [ ] **Step 1 — RED:** in `tests/opnsense/alias-adapter.test.ts` build a fake `OPNsenseHttpsClient` whose
  `request` returns canned OPNsense payloads. Assert: `createHostAlias` sends `addItem` then `reconfigure` and
  returns the created `uuid` (from `{ result:'saved', uuid }`); a `{ result:'failed' }` add rejects with a
  sanitized error and never calls `reconfigure`; a `reconfigure` without an applied status rejects;
  `deleteHostAlias` sends `delItem/{uuid}` then `reconfigure` and returns `{ item:{ id, deleted:true } }`;
  `searchHostAliases` maps `rows` to bounded alias items and rejects a malformed row. Run:
  `npx vitest run tests/opnsense/alias-adapter.test.ts` — expected FAIL (module missing).
- [ ] **Step 2:** extend `https-client.ts`: add the four alias arms to the closed request union, add
  `requireOperation('firewall.alias', 'list'|'create'|'delete', …)` contract checks against the generated
  runtime descriptor (method/path/limits), validate the `delItem` uuid with `^[0-9a-f-]{36}$`, and build the
  `reconfigure` request from the operation's `applyCommand`. Reuse the existing response-limit/JSON discipline.
- [ ] **Step 3:** implement `src/opnsense/alias-adapter.ts` with strict `zod/v4` response schemas
  (`AddItemResponse = { result:'saved', uuid: <uuid> }`, `ReconfigureResponse = { status:'ok' }` or
  `{ result:'saved' }` per the observed shape — accept the documented applied markers,
  `SearchResponse = { rows, rowCount, total, current }`, `DelItemResponse = { result:'deleted' }`) and the
  add→reconfigure / del→reconfigure sequencing with fail-closed errors. Freeze all outputs.
- [ ] **Step 4:** run `npx vitest run tests/opnsense/alias-adapter.test.ts` (PASS), `npm run typecheck`,
  `npm run license:check`, `git diff --check`. Commit: `feat: add OPNsense firewall-alias write adapter`.

## Task 3: Kernel `defineWriteResourceCapability` and envelope scope threading

**Files:**
- Modify: `src/capabilities/kernel.ts` (new exported factory; thread `effectiveResourceScopes` into
  `executeMutationEnvelope`'s `makeContext`).
- Test: `tests/capabilities/write-resource-capability-definition.test.ts` (new).

**Interfaces produced (consumed by Task 5):**
- `defineWriteResourceCapability<TParsedInput, TResolvedInput, TOutput>({ id, mcpName, title, description,
  inputSchema, outputSchema, annotations, transports, selectableResourceScopes, refusalDetailVocabulary, policy,
  resolver, preflight, handler, verifyOutcome }) => CapabilityDefinition`. `policy` omits `resourceScopes`
  (scopes come from the resolver, as in `defineResourceCapability`); the factory enforces the write matrix
  (`effect !== 'read'`, `audit === 'required'`, `firewall-write ⇒ backup === 'strict'`) and captures `resolver`
  in `resourceResolvers`/`resourceSelectableScopes`/`resourceRefusalDetailVocabularies` and `preflight`/
  `verifyOutcome` in `writeEnvelopePreflights`/`writeEnvelopeVerifiers`.
- The envelope execution context now includes `effectiveResourceScopes` for resource-resolving write
  capabilities (mirrors `executeAuthorized`'s non-envelope branch at `kernel.ts:1486-1488`).

- [ ] **Step 1 — RED:** in the new test, define a synthetic `firewall-write` write-resource capability over a
  fake adapter. Assert: the factory rejects a `read` effect, a missing `audit:'required'`, and a missing
  `backup:'strict'` by throwing `Invalid capability definition`; a well-formed definition is
  `isKernelDefinedCapability`; dispatching it through `createCapabilityDispatcher` (with synthetic
  lock/backup/audit services) resolves the resource (an unknown resource refuses `UNKNOWN_RESOURCE` with visible
  suggestions) and then runs the envelope (a successful call records `intent` then `result:'success'` audit
  phases and returns the parsed output). Run:
  `npx vitest run tests/capabilities/write-resource-capability-definition.test.ts` — expected FAIL (export
  missing).
- [ ] **Step 2:** implement `defineWriteResourceCapability` by composing the bodies of
  `defineResourceCapability` (resolver/scope/vocabulary capture, `defineCapability` with resolved-input handler)
  and `defineWriteCapability` (write-matrix validation, `preflight`/`verifyOutcome` capture). Reuse the existing
  private helpers; add a `WRITE_RESOURCE_CAPABILITY_DEFINITION_KEYS` allow-list.
- [ ] **Step 3:** in `executeMutationEnvelope`, when `resourceResolvers.has(capability)`, add
  `effectiveResourceScopes: authorization.effectiveResourceScopes` to the frozen `makeContext` object.
- [ ] **Step 4:** run `npx vitest run tests/capabilities/write-resource-capability-definition.test.ts` (PASS),
  `npm run typecheck`, `npm run license:check`, `git diff --check`. Commit:
  `feat: add generic write-resource capability factory`.

## Task 4: Extend `opn_list` to genuine multi-resource dispatch

**Files:**
- Modify: `src/capabilities/opnsense/list.ts` (per-resource resolve + handler dispatch + output union).
- Modify: `src/capabilities/catalog.ts` and `src/app/*` only as needed to pass the alias adapter to the list
  capability factory (final wiring lands in Task 7; here accept an optional alias adapter parameter defaulting
  to the unavailable adapter).
- Test: `tests/opnsense/list-capability.test.ts` (extend/create).

**Interfaces produced:**
- `createOPNsenseListCapability(readAdapter, aliasAdapter = UNAVAILABLE_OPNSENSE_ALIAS_ADAPTER)`.
- `opn_list` output union: `ServiceListItem | AliasListItem`; the resolver returns the actually resolved
  resource and `effectiveResourceScopes: [input.resource]`; the handler dispatches `core.services →
  readAdapter.listServices`, `firewall.alias → aliasAdapter.searchHostAliases`.

- [ ] **Step 1 — RED:** extend the list test: `opn_list firewall.alias` (visible) returns alias-shaped items
  from a fake alias adapter; `opn_list core.services` still returns service items; a resource whose descriptor
  lacks a `list` op refuses `OPERATION_NOT_AVAILABLE`; an alias row is validated (a malformed alias row makes the
  handler reject → `INVALID_OUTPUT`); requesting `firewall.alias` when the alias adapter is unavailable refuses
  `TARGET_UNAVAILABLE`. Run: `npx vitest run tests/opnsense/list-capability.test.ts` — expected FAIL.
- [ ] **Step 2:** rewrite the `list.ts` resolver to stop hardcoding `core.services`: validate visibility and the
  `list` operation from the descriptor, check the resource-appropriate adapter's `available`, and return
  `{ resource: input.resource, page, pageSize, query }` with `effectiveResourceScopes: [input.resource]`. Widen
  `ListOutput` to `z.discriminatedUnion`-free union of the two row shapes (bounded), and dispatch the handler by
  `input.resource`, validating the resource's row shape before returning.
- [ ] **Step 3:** run `npx vitest run tests/opnsense/list-capability.test.ts` (PASS), `npm run typecheck`,
  `npm run license:check`, `git diff --check`. Commit: `feat: make opn_list dispatch by resolved resource`.

## Task 5: `opn_create` and `opn_delete` write verbs

**Files:**
- Create: `src/capabilities/opnsense/create.ts`, `src/capabilities/opnsense/delete.ts`.
- Create: `src/capabilities/opnsense/alias-schema.ts` (shared reviewed host-alias create schema + digests).
- Test: `tests/opnsense/create-capability.test.ts`, `tests/opnsense/delete-capability.test.ts` (new).

**Interfaces produced (consumed by Task 7):**
- `createOPNsenseCreateCapability(aliasAdapter)` → `opn_create` (`{ resource, attributes }`), and
  `createOPNsenseDeleteCapability(aliasAdapter)` → `opn_delete` (`{ resource, id }`), both via
  `defineWriteResourceCapability` with `effect:'firewall-write'`, `backup:'strict'`, `audit:'required'`,
  `confirmation:'elicitation'`, `annotations` (`destructiveHint:true` for delete).
- `preflight(input, ctx)` reads the current alias set (`aliasAdapter.searchHostAliases`) and returns
  `{ observedStateDigest: sha256(rows), effectPlanDigest: sha256(resource+op+attributes|id) }`.
- `handler` calls `createHostAlias`/`deleteHostAlias`; `verifyOutcome` re-reads and confirms presence
  (create: the new `uuid`/`name` is present) or absence (delete: the `id` is gone).

- [ ] **Step 1 — RED (create):** in `create-capability.test.ts`, dispatch `opn_create` with synthetic
  lock/backup/audit services and a fake alias adapter through `createCapabilityDispatcher`. Assert: an invalid
  `attributes` (bad `name`, non-`host` type, empty/over-long `content`) refuses `INVALID_RESOURCE_INPUT`; a
  valid create returns `confirmation-required`, and completing it runs the envelope and returns the created
  alias view with the `uuid` and no `backupId`; a backup failure refuses `BACKUP_FAILED` before any adapter
  write; a `verifyOutcome` mismatch refuses `OUTCOME_UNVERIFIED` with the backup preserved. Run:
  `npx vitest run tests/opnsense/create-capability.test.ts` — expected FAIL.
- [ ] **Step 2:** implement `alias-schema.ts` (the bounded create schema from Binding decisions) and `create.ts`
  using `defineWriteResourceCapability`; the resolver validates `attributes` against the alias schema and
  returns `effectiveResourceScopes: ['firewall.alias']`.
- [ ] **Step 3:** run `npx vitest run tests/opnsense/create-capability.test.ts` (PASS).
- [ ] **Step 4 — RED (delete):** in `delete-capability.test.ts`, assert `opn_delete` with a valid `id` confirms,
  envelopes, and returns `{ item:{ id, deleted:true } }`, proving absence in `verifyOutcome`; an unknown
  resource refuses `UNKNOWN_RESOURCE`; a delete whose read-back still shows the alias refuses
  `OUTCOME_UNVERIFIED`. Run: `npx vitest run tests/opnsense/delete-capability.test.ts` — expected FAIL.
- [ ] **Step 5:** implement `delete.ts` analogously. Run: `npx vitest run tests/opnsense/delete-capability.test.ts`
  (PASS), `npm run typecheck`, `npm run license:check`, `git diff --check`. Commit:
  `feat: add opn_create and opn_delete firewall-alias verbs`.

## Task 6: Real OPNsense configuration-backup service

**Files:**
- Modify: `src/opnsense/https-client.ts` (add a `core.backup/download` arm returning raw bytes, or a dedicated
  bounded text response path — `config.xml` is not JSON, so add a `requestBytes`-style closed arm with an
  applied content-type check for `application/octet-stream`/`text/xml`).
- Create: `src/capabilities/envelope/config-backup.ts` (`createOPNsenseConfigBackupService`).
- Test: `tests/capabilities/envelope/config-backup.test.ts` (new).

**Interfaces produced (consumed by Task 7):**
- `createOPNsenseConfigBackupService(client, rootDir): BackupService` — `create(scope, signal)` fetches
  `GET /api/core/backup/download/this`, writes the bytes privately (dir `0700`, file `0600`, `O_EXCL|O_NOFOLLOW`,
  single hard link), verifies a re-read checksum, and returns `{ backupId }`; `exists(backupId)` re-verifies.
  Raise the byte bound to `2 * 1024 * 1024` for a real `config.xml`. `backupId` bytes never leave the process.

- [ ] **Step 1 — RED:** with a fake client returning fixed config bytes, assert `create` stores a `0600` file
  and returns a 32-hex `backupId`; `exists` is true for it and false for a forged id; a client error rejects (so
  the envelope maps it to `BACKUP_FAILED`); a symlinked target is refused. Run:
  `npx vitest run tests/capabilities/envelope/config-backup.test.ts` — expected FAIL.
- [ ] **Step 2:** add the closed backup-download arm to the client (bounded, applied content-type, no JSON
  parse) and implement `config-backup.ts` reusing the private-file helpers from
  `src/capabilities/envelope/backup.ts` (extract shared helpers if cleaner, keeping the Product 2 backup tests
  green).
- [ ] **Step 3:** run `npx vitest run tests/capabilities/envelope/config-backup.test.ts` (PASS),
  `npm run typecheck`, `npm run license:check`, `git diff --check`. Commit:
  `feat: add OPNsense configuration-backup envelope service`.

## Task 7: Compose the write surface into production

**Files:**
- Modify: `src/capabilities/catalog.ts` (`createProductCapabilityCatalog` accepts read + alias adapters and, when
  the alias adapter is available, registers `opn_create`/`opn_delete` and the alias-aware `opn_list`).
- Modify: `src/app/application-context.ts` (accept and pass `MutationEnvelopeServices` to
  `createCapabilityDispatcher`).
- Modify: `src/app/default-application.ts` (build the alias adapter from the same client; construct the real
  `MutationEnvelopeServices` — `createInProcessMutationLockManager`, `createOPNsenseConfigBackupService`,
  `createBoundedAuditSink` — under a private per-run backup root; thread them through).
- Test: `tests/capabilities/catalog.test.ts`, `tests/app/default-application.test.ts` (extend), and a focused
  exposure test.

**Interfaces produced:**
- Production exposes `server_status`, `opn_describe`, `opn_get`, `opn_list`, `opn_create`, `opn_delete` when a
  target is configured; under `READ_ONLY=true` or an unavailable target, the two write verbs are hidden.

- [ ] **Step 1 — RED:** assert that a catalog built with an available alias adapter + services exposes six tools
  on both transports, that `READ_ONLY=true` hides `opn_create`/`opn_delete` (and `tools/list` shows only the
  four reads), and that constructing a dispatcher exposing the write verbs **without** services throws
  `Mutation envelope services are required to expose a write capability`. Run:
  `npx vitest run tests/capabilities/catalog.test.ts tests/app/default-application.test.ts` — expected FAIL.
- [ ] **Step 2:** implement the catalog and composition wiring. Guard: when the alias adapter is unavailable,
  register neither write verb and pass no services (preserving today's read-only production path); when
  available, register the write verbs and pass the constructed services. Ensure the backup root is created with
  `0700` and cleaned by the owned-runtime closers.
- [ ] **Step 3:** run the focused tests (PASS), `npm run typecheck`, `npm run lint`, `npm run license:check`,
  `git diff --check`. Commit: `feat: expose firewall-alias mutation verbs in production composition`.

## Task 8: MCP-to-mock full lifecycle, failure paths, and packaged read surface

**Files:**
- Create: `tests/integration/firewall-alias-mutation.test.ts` (new; synthetic HTTPS OPNsense mock supporting
  `searchItem`/`addItem`/`delItem`/`reconfigure`/`backup/download/this`).
- Modify: `tests/integration/installed-package.test.ts` only if needed to assert the write verbs stay hidden
  under `READ_ONLY` in the packed tarball (the four-read assertion at `:313` remains).
- Test: the new integration test plus the full gate.

- [ ] **Step 1 — RED:** drive a full MCP session (initialize → tools/list → the lifecycle). Assert the exact
  reversible lifecycle: `opn_list firewall.alias` empty → `opn_create` returns a confirmation challenge →
  completing it envelopes and returns the created alias → `opn_list` shows it → `opn_delete` confirms and
  removes it → `opn_list` empty again. Assert the mock observed `GET /api/core/backup/download/this` before the
  first `addItem`. Assert failure paths on separate mock configurations: a failing backup download →
  `BACKUP_FAILED` with no `addItem`; a `reconfigure` failure after `addItem` → `OUTCOME_UNVERIFIED`/
  `EXECUTION_FAILED` with the backup preserved, fixed reconciliation guidance, and no `backupId` in any
  response. Run: `npx vitest run tests/integration/firewall-alias-mutation.test.ts` — expected FAIL.
- [ ] **Step 2:** implement the mock and test harness (reuse the mock style from
  `scripts/run-opencode-smoke.mjs:191` and existing MCP-to-mock tests). Fix any wiring gaps surfaced.
- [ ] **Step 3:** run the new test (PASS), then the full gate: `npm run verify`, `npm run test:conformance`,
  `git diff --check`. If the packaged read surface is unchanged, the OpenCode evidence needs no regeneration;
  if `installed-package` fails only on the tarball sha, regenerate it per Task 9's note (not a hand-edit).
  Commit: `test: prove firewall-alias reversible mutation against the mock`.

## Task 9: Disposable-VM seal (exit gate; owner/environment step)

**Files:**
- Create: `scripts/vm/product3-alias.mjs` (a live runner mirroring `scripts/vm/product1b-live.mjs`).
- Modify: `package.json` (`vm:product3` script), `src/operations/operation-contract.v1.json` +
  `scripts/generate-operation-descriptors.mjs` (seal `firewall.alias` write `transportStatus` to
  `vm-observed-26.x` and `evidence.vm` to `verified-product3` after observation).
- Test: `tests/vm/product3-alias.test.mjs` (offline unit coverage of the runner’s parsing/lifecycle, like
  `tests/vm/product1b-live.test.mjs`).

- [ ] **Step 1:** implement and unit-test the runner offline (no VM): it must set up the alias absent, run the
  MCP lifecycle against the VM connection, record the exact request/response and cleanup, and stop the VM with
  no residue. Commit: `feat: add Product 3 disposable-VM alias runner`.
- [ ] **Step 2 (owner/env):** on the M3, run `npm run vm:doctor`, `npm run vm:prepare-image`, `npm run vm:start`,
  `npm run vm:bootstrap`, then `npm run vm:product3`; capture the observed transport; seal the descriptors;
  regenerate; run `npm run vm:stop` and confirm no residue. Commit:
  `feat: seal firewall-alias transport on the disposable OPNsense 26 VM`. This step is expected to run slowly
  under TCG emulation and is not a blocker for Tasks 1–8.

---

## Self-review notes

- **Spec coverage:** catalogue/contract (Task 1), adapter (Task 2), kernel factory + scope threading (Task 3),
  generic `opn_list` (Task 4), `opn_create`/`opn_delete` + elicitation (Task 5), config-backup service (Task 6),
  composition wiring + `READ_ONLY` hiding (Task 7), MCP-to-mock lifecycle + all failure paths + packaged read
  surface (Task 8), VM seal + non-claims (Task 9). Every spec section maps to a task.
- **Closed-gate reminders:** the generator and HTTPS client are allow-lists (Tasks 1, 2, 6) — widen their
  explicit tables, never infer from a verb.
- **Envelope invariants:** backup preserved, fixed reconciliation guidance, no blind restore, `backupId`
  audit-only — asserted in Tasks 5 and 8.
- **Naming consistency:** `searchHostAliases`/`createHostAlias`/`deleteHostAlias` (adapter),
  `defineWriteResourceCapability`, `createOPNsenseConfigBackupService`, `opnsense.create`/`opnsense.delete`
  capability ids, `opn_create`/`opn_delete` mcp names — used identically across tasks.
