# OPNsense Product 3 — First Reversible, Backed-Up Mutation Design

**Date:** 2026-07-20

**Status:** Approved through delegated owner decision; written specification

## Context

Products 1A and 1B delivered the first useful read-only vertical (`system.status`, `core.services`) and the
disposable OPNsense-26 VM harness that sealed the `core.services` transport to `vm-observed-26.1.6`. Product 2
added the fail-closed write-path safety envelope to the capability kernel — target lock, sealed preflight,
redacted audit intent, strict verified backup, state revalidation, bounded execution, outcome verification,
final audit, and lock release in one fixed order — proven entirely with synthetic services and no public
mutation. The product catalogue therefore still exposes only four read tools, and `defineWriteCapability` is
exercised only by tests.

Product 3 admits the first real mutation. Per the vertical routing document it must choose exactly one bounded
resource, add only its reviewed write schema without widening any other resource, and prove a reversible
lifecycle: set up owned state, read it, take and verify a backup, mutate through MCP, read back the exact
effect, reverse it, prove absence, and stop the VM. Any indeterminate outcome preserves the backup and
reconciliation guidance and is never reported as success.

## Goals

- Admit `firewall.alias` (a single **host** alias) with create and delete operations behind the generic
  write verbs, running the Product 2 mutation envelope end to end against a real OPNsense write adapter.
- Add generic write-resource dispatch to the kernel so `opn_create` and `opn_delete` resolve a visible
  resource exactly like `opn_get`/`opn_list` do for reads, then run the envelope.
- Wire real cross-cutting envelope services (strict OPNsense configuration backup, target lock, redacted
  audit sink) into the production composition root for the first time.
- Prove the whole lifecycle and every failure path with deterministic contract, unit, and MCP-to-mock tests,
  then seal the alias transport on the disposable VM.

## Non-goals and non-claims

- No `opn_update`/`opn_set_enabled`, no alias toggle, and no other firewall or non-firewall resource.
- No non-host alias type, no alias content beyond a bounded reviewed shape.
- No change to the read verbs' behaviour or the four existing tools' contracts.
- No new agentic or client claim: the OpenCode Product 1A smoke keeps its read-only routing claim unchanged;
  Product 3 does not assert that any model routes a mutation.
- No public-Internet, ACME, HAProxy, DNS, Windows, benchmark, or release claim.
- VM evidence proves only the tested firmware and scenario; a passing deterministic layer is not a VM claim.

## Chosen resource and lifecycle

The first mutation is a firewall **host alias**, the smallest self-contained create/delete lifecycle that
proves "read back the exact effect" and "prove absence." The reviewed create attributes are bounded:

- `name`: `^[A-Za-z0-9_]{1,32}$` (OPNsense alias name rule);
- `type`: the literal `host`;
- `content`: 1..64 reviewed host entries, each a syntactically valid IPv4/IPv6 address or hostname label,
  bounded in length;
- `description`: optional bounded free text.

The exact reversible lifecycle Product 3 must demonstrate:

1. **Setup owned state** — start from a VM/mock with the alias absent.
2. **Read** — `opn_list firewall.alias` returns an empty result, confirming absence.
3. **Backup** — the envelope takes and verifies a strict OPNsense configuration backup before the first write.
4. **Mutate** — `opn_create firewall.alias` stages `addItem` then applies `reconfigure`; the envelope confirms
   the outcome by reading the alias back.
5. **Read back** — `opn_list firewall.alias` returns the exact created alias.
6. **Reverse** — `opn_delete firewall.alias` stages `delItem` then applies `reconfigure`.
7. **Prove absence** — `opn_list firewall.alias` returns an empty result again.
8. **Stop** — the VM is stopped with no residue (VM layer only).

## Architecture

### Operation catalogue and contract

`OperationEffect` (`src/operations/types.ts`) widens from `'read'` to `'read' | 'firewall-write'`, matching
the kernel's `CapabilityEffect`. A new `firewall.alias` descriptor is added to the generated catalogue with:

- a `list` read operation over `POST /api/firewall/alias/searchItem` (bounded pagination, reviewed row shape);
- a `create` firewall-write operation over `POST /api/firewall/alias/addItem` plus the apply command
  `POST /api/firewall/alias/reconfigure`;
- a `delete` firewall-write operation over `POST /api/firewall/alias/delItem/{uuid}` plus the same apply.

Each write operation records its reviewed effect, resource scope `firewall.alias`, capability id, size limits,
`transportStatus: 'documented'` (candidate, derived from the official reference and the legacy contract shape,
not inferred from the HTTP verb), and `evidence.vm: 'pending'`. `scripts/generate-operation-descriptors.mjs`
and `operation-contract.v1.json` are extended; contract and schema digests are regenerated. The transport is
sealed to `vm-observed-26.x` only after the disposable VM observes the exact request/response and cleanup.

### OPNsense write adapter

A new `src/opnsense/alias-adapter.ts` exposes a bounded interface parallel to the read adapter:

- `searchHostAliases(input, signal)` → validated, bounded rows (`uuid`, `name`, `type`, `description`);
- `createHostAlias(attributes, signal)` → `addItem` then `reconfigure`; returns the created `uuid`;
- `deleteHostAlias(uuid, signal)` → `delItem` then `reconfigure`.

Every response is parsed with a strict `zod/v4` schema and cross-checked with invariants: `addItem` must return
`{ result: 'saved', uuid }` with a well-formed UUID; `reconfigure` must report an applied status; `delItem`
must return `{ result: 'deleted' }`. Any deviation throws a sanitized error and never a partial success. An
unavailable target yields a frozen unavailable adapter exactly like the read path.

### Kernel: generic write-resource dispatch

A new factory `defineWriteResourceCapability<TParsedInput, TResolvedInput, TOutput>` composes the two
mechanisms already present in `src/capabilities/kernel.ts`:

- the **resource-resolution** registration used by `defineResourceCapability` — `selectableResourceScopes`, a
  `resolver`, and a `refusalDetailVocabulary` captured in the existing kernel-private `WeakMap`s so
  `authorizeRequest` resolves the visible resource and binds `effectiveResourceScopes`;
- the **envelope** registration used by `defineWriteCapability` — `preflight` and `verifyOutcome` captured in
  `writeEnvelopePreflights`/`writeEnvelopeVerifiers` so `executeAuthorized` routes the capability through
  `executeMutationEnvelope`.

Because resource resolution (`authorizeRequest`) and envelope routing (`isMutationEnvelopeCapability`) already
key on independent `WeakMap` membership, a capability registered in both resolves its resource first and then
runs the fixed envelope. The factory enforces the same write matrix as `defineWriteCapability` (effect is not
`read`, `audit` is `required`, and a `firewall-write` carries a `strict` backup) and reuses
`defineResourceCapability`'s policy shape (no capability-level `resourceScopes`; scopes come from the
resolver). One kernel adjustment is required: `executeMutationEnvelope`'s execution context must include
`effectiveResourceScopes` when the capability is resource-resolving, matching the non-envelope path.

No schema or callback is mutated after definition. The factory is trusted static startup code and is not an
admission boundary for third-party plugins.

### Generic write verbs

`opn_create` and `opn_delete` are defined with `defineWriteResourceCapability`. Their generic inputs are:

- `opn_create`: `{ resource: string, attributes: object }`. The resolver checks the resource is visible, has a
  `create` operation, and the adapter is available, then validates `attributes` against that resource's
  reviewed create schema (today the host-alias schema) and returns the resolved input with
  `effectiveResourceScopes: ['firewall.alias']`.
- `opn_delete`: `{ resource: string, id: string }`. The resolver applies the same visibility/operation/adapter
  checks and validates the identifier contract.

The verbs are generic-ready with exactly one arm today; a second write resource in Product 4 adds an arm
without touching the kernel. Both carry `confirmation: 'elicitation'`, `effect: 'firewall-write'`,
`backup: 'strict'`, `audit: 'required'`, and destructive/idempotent annotations appropriate to each verb.
`opn_describe` surfaces the create schema so an agent discovers the exact attributes before calling.

### Read-back path (generic `opn_list`)

The lifecycle's read, read-back, and prove-absence steps go through the existing read verb, so `opn_list`
becomes genuinely multi-resource. Today its resolver and handler hardcode `core.services`; Product 3 makes the
resolver return the actually resolved resource and the handler dispatch by that resource
(`core.services` → `listServices`, `firewall.alias` → `searchHostAliases`). The tool's advertised output
widens to a reviewed per-resource union — the existing service row shape plus a bounded alias row
(`uuid`, `name`, `type`, `description`) — and the handler validates against the resolved resource's row shape
so a resource can never return another resource's rows. `opn_get` remains the singleton reader for
`system.status` only (a host alias is a collection, so it is read through `opn_list`); it gains no alias arm.
This read extension carries `effect: 'read'` and changes no write policy.

### Confirmation

Both write verbs require elicitation confirmation. `dispatch` returns a `confirmation-required` challenge; the
client re-submits the identical request through the already-proven completion path, which re-authorizes
(re-resolving the resource and re-checking scope) before `executeMutationEnvelope` runs. A declined or expired
confirmation refuses without any write. Confirmation binds the capability id, canonical arguments digest,
transport, and principal, exactly as Product 2 established.

### Envelope composition wiring

For the first time the production composition constructs real `MutationEnvelopeServices` and threads them
`createDefaultApplicationRuntime` → `createApplicationContext` → `createCapabilityDispatcher`:

- **Backup** — a strict OPNsense configuration backup service. It fetches the running configuration via
  `GET /api/core/backup/download/this`, writes it to a private per-run location with `0700`/`0600` permissions,
  refuses symlinks, and records a content checksum, reusing the Product 2 backup primitives
  (`src/capabilities/envelope/backup.ts`). `create` returns an opaque `backupId`; `exists` re-verifies the
  stored bytes against the checksum. The `backupId` is audit-only and never crosses the MCP boundary.
- **Lock** — an in-process exclusive lock keyed on the single mutation target `opnsense-config`, so concurrent
  writes serialize and a failed acquire refuses with `LOCK_UNAVAILABLE`.
- **Audit** — a bounded, redacted audit sink that records each phase (`intent`, `result`) with the capability
  id, mcp name, effect, canonical arguments digest, effective scopes, outcome, and optional audit-only
  `backupId`; secrets and raw attributes never appear.

The kernel already throws if an envelope capability is exposed while services are undefined, so wiring is
complete before the verbs are exposed. The composition also builds the alias write adapter from the same
HTTPS client as the read adapter and passes it into `createProductCapabilityCatalog`, which now registers
`opn_create`, `opn_delete`, and the extended `opn_list` alongside the existing read tools. When the target is
unavailable or the server is `READ_ONLY`, the write verbs are hidden or refused before any service runs,
exactly as the Product 2 bypass proofs assert.

## Data flow

A successful `opn_create firewall.alias`:

1. `authorizeRequest` validates input, resolves `firewall.alias` from the visible scopes, validates the
   attributes, and binds `effectiveResourceScopes`.
2. `confirmation: 'elicitation'` returns a challenge; the client re-submits and the completion path
   re-authorizes identically.
3. `executeMutationEnvelope` runs: acquire lock → bounded preflight (adapter `searchHostAliases` →
   `{ observedStateDigest, effectPlanDigest }`) → audit intent → strict config backup + verify → revalidate
   (re-run preflight; digests must match) → bounded apply (`createHostAlias`: `addItem` then `reconfigure`) →
   verify outcome (read the alias back and confirm it matches the plan) → parse/snapshot output → final audit →
   release lock.
4. The tool result is the bounded created-alias view; the `uuid` is returned to the caller as the reviewed
   identifier, while the `backupId` is not.

`opn_delete` is symmetric: the preflight observes the alias present, the apply runs `delItem` then
`reconfigure`, and the outcome verifier confirms absence.

## Error handling and fail-closed invariants

- Lock unavailable → `LOCK_UNAVAILABLE`, no further step.
- Preflight failure/timeout/cancel → `PREFLIGHT_FAILED`/`TIMEOUT`/`CANCELLED`, before any backup or write.
- Backup creation or verification failure → `BACKUP_FAILED`, before any write.
- State drift between preflight and revalidation → `STATE_REVALIDATION_FAILED`; the backup is preserved.
- Apply aborted (timeout/cancel) → `OUTCOME_INDETERMINATE`; apply rejected → `EXECUTION_FAILED`; outcome
  unverifiable → `OUTCOME_UNVERIFIED`. Each preserves the backup and emits the fixed reconciliation guidance
  ("do not retry blindly; reconcile the target against the preserved backup"), never blind-restores, and never
  reports success.
- The `backupId` appears only in audit records, never in any MCP result, log line, or fixture.
- Secrets never appear in arguments, audit records, adapter errors, results, or fixtures.

## Testing and evidence ladder

1. **Contract/schema** — the `firewall.alias` descriptor validates against the operation contract; digests are
   stable; the write effect and scope are exactly as reviewed.
2. **Unit** — the alias adapter parses valid responses, rejects malformed ones, and enforces the add/apply and
   del/apply invariants; the `defineWriteResourceCapability` factory rejects a read effect, a missing audit, a
   missing strict backup for a firewall write, and a malformed definition, and both resolves the resource and
   routes the envelope; `opn_list` dispatches by resolved resource and validates each resource's row shape,
   never returning one resource's rows for another.
3. **MCP-to-mock** — a full MCP session against a synthetic HTTPS OPNsense mock drives the entire lifecycle,
   including the elicitation round-trip, and asserts each failure path preserves the backup and reconciliation
   guidance without a blind restore. A locally packed tarball repeats the read surface; the write surface is
   asserted hidden under `READ_ONLY`.
4. **Disposable VM** — the Product 1B harness (`vm:start`/`vm:bootstrap`) hosts OPNsense 26 under TCG; a live
   runner performs setup → read → backup → create → read back → delete → prove absence, records the exact
   request/response and cleanup, seals the transport to `vm-observed-26.x`, and stops the VM with no residue.

Deterministic layers 1–3 are the focused Product 3 gate; layer 4 is the exit seal and is run when a VM host is
available. `npm run verify` and `npm run test:conformance` remain green throughout, and the OpenCode evidence
is regenerated only if the packaged read surface changes.

## Alternatives considered

- **Single-resource write capability (no generic dispatch).** Smaller kernel change, but it would either
  duplicate the resolver logic per verb later or force a disruptive refactor when the second write resource
  arrives. Generic write-resource dispatch now keeps read and write discovery symmetric.
- **No confirmation for the first mutation.** Simpler tests, but a firewall write is exactly where the
  pedagogy requires an explicit, confirmed change; elicitation is already proven and cheap to reuse.
- **Toggle/enabled-state as the first mutation.** Smaller payload, but it cannot demonstrate "prove absence,"
  which is the core reversibility evidence; a create/delete host alias does.
- **Reusing the synthetic Product 2 backup as the production backup.** It backs up a local target, not the
  OPNsense configuration; a firewall write must snapshot the running config so a failed change is
  reconcilable.

## Normative inputs

- `docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md` (Product 3 definition and evidence ladder)
- `docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md` (generic verbs,
  effects, resource scoping, progressive discovery)
- `docs/superpowers/specs/2026-07-17-independent-mcp-v2-rebuild-design.md` (effect vocabulary and the fixed
  write-path envelope)
- Product 2 implementation in `src/capabilities/kernel.ts` and `src/capabilities/envelope/*`
- Official OPNsense firewall alias endpoints: <https://docs.opnsense.org/development/api/core/firewall.html>
- Official OPNsense core backup endpoints: <https://docs.opnsense.org/development/api/core/backup.html>
