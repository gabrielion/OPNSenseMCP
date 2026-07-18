# Guided Workflows, Client Distribution, and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three safe, pedagogical OPNsense workflows, one-command installation for Codex, Claude Code, OpenCode, and Kimi, verified npm and MCP Registry distribution, approachable project documentation, and an evidence-backed first release.

**Architecture:** Workflow capability factories plug into the foundation catalog and consume the parity layer only through one typed resource gateway. For an apply call, the single closed kernel pipeline parses and admits the request, reserves and revalidates its single-use prepared plan in sealed preflight state, writes the audit intent, creates one strict backup, and only then invokes the handler. Mutations register idempotent compensation before outbound writes, verification and inverse rollback are explicit, and rollback uses an independent bounded signal. Codex and Claude Code install primarily through repository marketplace plugins, current Node-based Kimi Code uses its native plugin manifest, and OpenCode uses its native top-level `mcp` configuration because OpenCode's JS/TS hook plugins are not MCP-server packages. Direct MCP configuration remains the documented Codex/Claude/Kimi fallback. Package, plugin, Registry, documentation, and release claims are generated from committed manifests and canonical attestations.

**Tech Stack:** Node.js `>=22.19 <23`, strict TypeScript ESM, the existing direct `zod/v4` dependency, the existing Vitest runner, exact MCP SDK packages selected by the foundation plan, JSON Schema, ShellCheck, disposable OPNsense 26 VM, Codex CLI, Claude Code, OpenCode, Kimi Code CLI, Claude Code's `sonnet` model selector with the resolved model identity recorded in every attestation, npm, MCP Inspector, and the official MCP Registry publisher. Exact clients and test tools, their source, and artifact hashes are release inputs recorded in `tests/clients/versions.json`, not timeless claims in this plan.

## Global Constraints

- Put `SPDX-License-Identifier: AGPL-3.0-or-later` in every header-capable source, test, script, generated text artifact, and plugin skill. Headerless package, server, and plugin manifests carry exact AGPL metadata wherever their official schema permits it; schema-constrained MCP configs or marketplace catalogs without a license field must resolve to an adjacent AGPL plugin manifest and root `LICENSE`, and may not invent an unsupported key. `npm run license:check` is a mandatory green gate before every task commit.
- Use Node.js `>=22.19 <23` for development, CI, packaging, installers, and release scripts; set the package engine to that exact range.
- Do not copy implementation expression of uncertain provenance. Implement from this specification, public OPNsense behavior, approved fixtures, and disposable-VM observations.
- Never use a production firewall for development, tests, examples, screenshots, or benchmark runs.
- Default to `READ_ONLY=true`. Hide and refuse every firewall-writing capability until the operator explicitly changes the private server configuration.
- Require one successful strict OPNsense configuration backup before the first outbound mutation of every apply execution. A failed backup aborts the workflow.
- Never expose a private key, API secret, backup XML, audit payload, or credential-bearing command line in MCP content, logs, process listings, fixtures, attestations, or documentation.
- Keep credentials in one private file outside the repository. Marketplace plugins resolve the documented platform-default path and honor `OPNSENSE_CONFIG_FILE` as an override; direct MCP configurations contain only that path in `OPNSENSE_CONFIG_FILE`, never a credential.
- Treat prompts, skills, descriptions, annotations, and caller booleans as guidance rather than authorization. The closed catalog and kernel remain authoritative.
- Use an opaque prepared-plan token for each mutation. Bind it to the caller subject, workflow, operation, normalized arguments, observed-state digest, expiry, reservation, and single-use state. Acquire and hold the per-firewall mutation lock, then reserve and live-revalidate the plan in kernel preflight after parse, dynamic scope checks, confirmation handling, and limiter admission but before audit intent and backup. The lease seals configuration and relevant-state digests. After backup and before handler invocation, the kernel requires the backup hash to match the sealed configuration digest and performs bounded read-only revalidation of both digests; otherwise it refuses before mutation. Only the sealed reserved plan may reach the handler; caller input and execution context can never inject it.
- Ask at most one material clarification question in one response. Never infer an interface, virtual IP, DNS scope, certificate trust, device identity, or public reachability.
- Restrict the first publication workflow to internal DNS and an internal CA. Do not claim public DNS, public certificate issuance, ISP traversal, or Internet reachability.
- Run one managed VM at a time and prove reverse cleanup. Every VM-backed command in this plan must use the shared `npm run vm:with -- npm run test:vm` launcher shape, whose `finally` path aggregates residue and stop failures; raw provision/test/stop chains are forbidden. If the lab packet filter is disabled, report only guest-side DNS, TLS, HAProxy, backend, and configuration evidence.
- Keep all version, model, dataset, schema, package, client, and firmware claims machine-readable and exact.
- Use TDD for every implementation task. See the named test fail for the intended reason before adding product code.
- End each task with the stated atomic local commit. Do not push or publish until the final release task and explicit operator authorization.
- Do not weaken an assertion, accept an indeterminate exit code, suppress a command failure, or add a bypass to make a gate green.
- Use only the canonical public identifiers derived from the package and plugin manifests: package `@gabrielion/opnsense-mcp`, executable `opnsense-mcp`, MCP server `opnsense`, plugin `opnsense-mcp`, and skill `opnsense-guide`. Only manifest-derived canonical public identifiers are accepted; no aliases or compatibility bins exist.
- Put this concise notice in README, package-facing documentation, and MCP Registry documentation: “OPNsense MCP is an independent project and is not affiliated with or endorsed by the OPNsense project or Deciso. OPNsense remains a trademark of its owners.” Keep project naming consistent and describe this as a non-affiliation/trademark notice, never as legal clearance.

## Cross-plan contracts

This plan starts after the MCP v2 foundation and OPNsense product-parity tasks have established the following exports. These names and import paths are fixed integration contracts.

| Owner | Export | Contract consumed here |
| --- | --- | --- |
| Foundation | `src/server/build-server.ts::buildServer(application: ApplicationContext, transport: TransportKind): McpServer` | Registers the workflow capabilities, prompts, and `SERVER_INSTRUCTIONS` without leaking MCP transport types into domain code. |
| Foundation | `src/capabilities/catalog.ts::CapabilityCatalog` with `getByMcpName(name)` | Closed catalog instance owned by `ApplicationContext` and used for listing, dispatch, docs, and coverage. |
| Foundation | `src/capabilities/dispatch.ts::dispatchCapability(request, context): Promise<CapabilityResult>` | Sole package-root execution facade. Public requests use `name` and `arguments`; every dispatch remains inside the closed catalog and policy kernel. |
| Foundation | package-internal `src/capabilities/kernel.ts::defineCapability`; safe contracts `CapabilityDefinition`, `CapabilityExecutionContext`, `ServerContext`, and `CapabilityResult` from `src/capabilities/types.ts`; opaque `src/app/application-context.ts::ApplicationContext` | Capability factories provide typed handlers to the closed kernel; `CapabilityDefinition` exposes policy and schemas but no handler or confirmation authority. The internal dispatcher is not a cross-plan/public contract. |
| Parity | `src/app/product-context.ts::createProductApplicationContext(config, dependencies, extensions): ApplicationContext` and `ProductDependencies` | Sole production composition root; injects domain services and policy dependencies without globals. |
| Parity Task 5 | Types `CapabilityPreflightContext`, `CapabilityPreflightLease`, `FirewallPreflightObservation`, `PreflightExecutionMetadata`, and `MutationExecutionMetadata` from `src/capabilities/types.ts`; package-internal `requirePreflightValue` and `requireMutationMetadata` from `src/capabilities/kernel.ts` | Private preflight and mutation handoff. `defineCapability` stores preflight and handlers in private weak maps; `CapabilityDefinition` exposes neither. Only the kernel creates/settles sealed metadata. |
| Parity Task 5 | `src/security/firewall-preflight.ts::createFirewallPreflight` | Builds the mandatory sealed configuration/relevant-state observation for a firewall-write preflight without exposing mutation metadata. |
| Parity | `src/opnsense/client.ts::createOPNsenseClient(config): OPNsenseClient` | HTTPS boundary for direct probes that are not typed resources. |
| Parity | `src/opnsense/catalog/resources.ts::getResource(name)` and `listResources()` | Exact 96-resource catalog. |
| Parity | `src/opnsense/generic/service.ts::createGenericResourceService(client, catalog)` | Resource list/get/create/update/delete/apply primitives. |
| Parity | `src/features/backup/service.ts::BackupService` | Strict pre-change snapshot invoked by the kernel pipeline. Workflow handlers receive only backup metadata. |
| Parity | `src/security/audit-log.ts::AuditLog` | Redacted intent, refusal, completion, and rollback events. |

Add one adapter over the parity layer. Workflow modules must not construct controller paths or call mutation endpoints directly.

```ts
// src/workflows/resource-gateway.ts
export const WORKFLOW_RESOURCE_KEYS = [
  'interfaces_vip', 'trust_ca', 'trust_cert', 'haproxy_server', 'haproxy_backend',
  'haproxy_acl', 'haproxy_action', 'haproxy_frontend', 'unbound_host_override',
  'unbound_dnsbl', 'kea_dhcpv4_reservation', 'dnsmasq_host'
] as const;
export type ResourceKey = (typeof WORKFLOW_RESOURCE_KEYS)[number];

export interface ResourceQuery {
  readonly filters?: Readonly<Record<string, string | number | boolean>>;
  readonly limit?: number;
}

export interface WorkflowResourceGateway {
  list<T>(resource: ResourceKey, query?: ResourceQuery): Promise<readonly T[]>;
  get<T>(resource: ResourceKey, id: string): Promise<T | null>;
  create<T>(
    resource: ResourceKey,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly apply: false }
  ): Promise<{ readonly id: string; readonly value: T }>;
  update<T>(
    resource: ResourceKey,
    id: string,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly apply: false }
  ): Promise<T>;
  remove(resource: ResourceKey, id: string, options: { readonly apply: false }): Promise<void>;
  readSettings<T>(module: string, controller: string): Promise<T>;
  writeSettings(
    module: string,
    controller: string,
    fields: Readonly<Record<string, unknown>>,
    options: { readonly apply: false }
  ): Promise<void>;
  apply(group: 'interfaces' | 'haproxy' | 'unbound' | 'dhcp'): Promise<void>;
  probe<T>(probe: WorkflowProbe, signal: AbortSignal): Promise<T>;
}

export type WorkflowProbe =
  | { readonly kind: 'dns'; readonly server: string; readonly hostname: string; readonly sourceAddress?: string }
  | { readonly kind: 'tls'; readonly address: string; readonly serverName: string; readonly expectedCaFingerprint: string }
  | { readonly kind: 'http'; readonly url: string; readonly hostHeader?: string; readonly expectedStatus: number }
  | { readonly kind: 'haproxy-runtime'; readonly backendId: string }
  | { readonly kind: 'device-lease'; readonly identifier: string }
  | { readonly kind: 'network-diagnostics'; readonly input: Readonly<Record<string, unknown>> };
```

`createWorkflowResourceGateway()` translates these calls to `createGenericResourceService()` and approved domain services. It validates module/controller probe identifiers against a closed table. Resource-specific `filters` are also a closed table: the gateway obtains a bounded bootgrid page and applies exact normalized predicates locally unless a separately attested domain service provides that filter. It never forwards invented filter keys to an OPNsense controller. The `apply` option is deliberately unavailable on individual creates, updates, and deletes so the workflow owns dependency ordering.

Capability factories capture typed services and pass a typed handler and optional typed preflight callback
to `defineCapability`; they do not read globals and the transport-neutral execution context does not become
a service locator. Compose these exact workflow dependencies into the catalog while returning the
foundation `ApplicationContext`; do not introduce a second server-context abstraction:

```ts
export interface WorkflowDependencies {
  readonly workflowResources: WorkflowResourceGateway;
  readonly preparedPlans: PreparedPlanStore;
  readonly clock: { now(): Date };
  readonly randomBytes: (size: number) => Uint8Array;
}

export function createWorkflowApplicationContext(
  config: RuntimeConfig,
  product: ProductDependencies,
  workflow: WorkflowDependencies
): ApplicationContext {
  return createProductApplicationContext(config, product, createWorkflowCapabilities(workflow));
}
```

`createWorkflowCapabilities(workflow)` returns definitions created by per-capability `defineCapability`
factories and closes over only the supplied gateway/store/clock/random source. Its policy objects use the
Foundation vocabulary exactly: `policy.effect`, `policy.resourceScopes`,
`policy.requiredFeatureFlags`, `policy.backup`, `policy.audit`, `policy.confirmation`, and
`policy.timeoutMs`. Guided workflows require no feature flag; `requiredFeatureFlags` is `[]`, rather than an
invented workflow flag. Catalog lookups use `getByMcpName()`. `createServerFactory()` and `buildServer()`
continue to receive the ordinary `ApplicationContext` plus an explicit transport; request callbacks create
the safe `ServerContext` only for `dispatchCapability()`.

The Product Task 5 kernel order is fixed: catalog/exposure/read-only/feature checks; Zod parse and
normalization; dynamic resource scopes and allow-list; Foundation elicitation if declared; limiter
admission plus acquisition of the per-firewall mutation lock; sealed preflight; fsynced audit intent; strict
backup; handler invocation; output validation; final audit. Preflight receives
`CapabilityPreflightContext`, never mutation metadata, and returns a
`CapabilityPreflightLease` with `{ value, release(), consume(), firewallObservation? }`. Every
firewall-write lease includes an observation with `configurationSha256`, `relevantStateSha256`, and bounded
`revalidate(signal)`. The kernel calls `release()` exactly
once if execution stops before handler invocation, or `consume()` exactly once when invocation begins,
including handler/output/final-audit failure. Lease-settlement failures are aggregated with the primary
failure.

Preflight may perform bounded read-only OPNsense revalidation through its factory-closed gateway, but it
must not perform mutation I/O. An apply preflight atomically reserves the token, checks its
subject/workflow/operation/expiry and current observed-state digest, and seals both that digest and the
exact effect plan in a branded immutable `ReservedPreparedPlan` lease value. The handler
obtains it only with `requirePreflightValue(context, ReservedPreparedPlanSchema.parse)`; it never consumes a
token itself. The kernel also supplies Product Task 5's immutable
`CapabilityExecutionContext.mutation`. Handlers fail closed if either sealed value is missing before
touching the gateway, using `requireMutationMetadata(context)` rather than trusting a structural object.
The mutation lock remains held through handler verification/rollback, lease settlement, and final audit.
After strict backup but before constructing handler metadata, the kernel requires
`backup.sha256 === firewallObservation.configurationSha256`, calls
`firewallObservation.revalidate(signal)`, and compares both returned digests with the sealed values. A
mismatch returns Product Task 5's `PRECONDITION_CHANGED`, releases the plan lease because invocation never
began, and performs no mutation.
Preparation, verification, diagnosis, prompts, resources, and client skills receive
neither preflight nor mutation metadata.

## Planned file map

```text
src/
  workflows/
    contracts.ts
    prepared-plans.ts
    resource-gateway.ts
    execution.ts
    internal-service/{schemas,planner,executor,verifier,capabilities}.ts
    device-domain/{schemas,resolver,planner,executor,verifier,capabilities}.ts
    diagnosis/{schemas,service,capabilities}.ts
  mcp/
    instructions.ts
    prompts.ts
  config/
    private-config.ts
  cli/
    index.ts
    install.ts
    doctor.ts
    uninstall.ts
  installers/
    contracts.ts
    distribution-identity.ts
    ownership.ts
    codex.ts
    claude-code.ts
    opencode.ts
    kimi.ts
    skills.ts
skills/opnsense-guide/SKILL.md
plugins/opnsense-mcp/
  .codex-plugin/plugin.json
  .claude-plugin/plugin.json
  .mcp.json
  skills/opnsense-guide/SKILL.md
kimi.plugin.json
.agents/plugins/marketplace.json
.claude-plugin/marketplace.json
scripts/
  bootstrap
  doctor
  test
  distribution/render-manifests.mjs
  release/{check-namespaces,validate-package,validate-plugins,publish}.mjs
tests/
  workflows/
  mcp/
  installers/
  clients/
  release/
  docs/
  smoke/claude-doc-consistency.mjs
  vm/workflows/
  agentic/{datasets,attestations}/
docs/
  testing.md
  clients.md
  workflows.md
  security.md
  release.md
package.json
server.json
README.md
CONTRIBUTING.md
AGENTS.md
CLAUDE.md
```

---

### Task 1: Build the prepared-plan and rollback runtime

**Files:**
- Create: `docs/contracts/opnsense-workflows.v1.json`
- Create: `docs/contracts/opnsense-workflows.v1.sha256`
- Create: `docs/contracts/opnsense-workflows.v1.review.json`
- Create: `tests/evidence/opnsense-workflow-evidence.json`
- Create: `tests/contract/workflow-contract.test.ts`
- Modify: `scripts/contracts/validate-opnsense-product.mjs`
- Modify: `package.json`
- Create: `src/workflows/contracts.ts`
- Create: `src/workflows/prepared-plans.ts`
- Create: `src/workflows/resource-gateway.ts`
- Create: `src/workflows/execution.ts`
- Create: `src/workflows/catalog.ts`
- Create: `tests/workflows/prepared-plans.test.ts`
- Create: `tests/workflows/execution.test.ts`

**Interfaces:**
- Consumes: `CapabilityExecutionContext`, `CapabilityPreflightLease`, `requirePreflightValue()`, `requireMutationMetadata()`, `ApplicationContext`, `ProductDependencies`, `createProductApplicationContext()`, `createGenericResourceService()`, `getResource()`, and `listResources()` from the fixed cross-plan contracts. Backup/audit/limiter services remain kernel-owned Product dependencies and are not injected into workflow handlers.
- Produces: an immutable independently reviewed workflow-contract extension plus evidence manifest;
  `PreparedPlanStore`, `PreparedPlan`, `WorkflowResourceGateway`, `WorkflowExecution`, `RollbackAction`,
  `executePreparedWorkflow()`, `createWorkflowCapabilities()`, and `createWorkflowApplicationContext()`.

- [ ] **Step 0: Publish the reviewed workflow contract extension before implementation**

Write a failing `tests/contract/workflow-contract.test.ts` against Product Task 1's reviewed-extension
validator, then author `opnsense-workflows.v1.json`, its exact SHA-256 file, a distinct-author/reviewer
approval record, and its mutable evidence manifest. The extension binds to the base product-contract digest,
declares no resources, and contains exactly these nine capability names with the policies used below:
`prepare_internal_service`, `verify_internal_service`, `apply_internal_service`,
`remove_internal_service`, `prepare_device_domain_block`, `verify_device_domain_block`,
`apply_device_domain_block`, `remove_device_domain_block`, and `diagnose_network_problem`. The two `apply_*`
rows are `firewall-write` with strict backup/audit and reviewed VM lifecycles; the other seven are reads.
Reject unknown keys, name collisions, mutable policy overrides, missing lifecycle recipes, digest drift, and
self-review. Extend `validateRuntimeContract()` only through Product Task 1's
`options.reviewedExtensions` array;
do not create a parallel parity manifest. Run the focused contract test and commit these contract records in
the same Task 1 commit after the prepared-plan runtime becomes green. Register
`workflow-contract:validate` as a file-level gate for the immutable extension, digest, review, and exact
evidence key set; empty evidence arrays are permitted while Tasks 2–5 implement rows incrementally. Do not
run exact runtime-union validation until Task 5. Product Task 1's pure validator always receives exact
`RuntimeContractValidationOptions`; the CLI may discover only schema-valid reviewed bundles and passes them
explicitly. Neither command may silently ignore an unreviewed extension file.

- [ ] **Step 1: Write failing prepared-plan reservation tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  ReservedPreparedPlanSchema,
  createPreparedPlanStore
} from '../../src/workflows/prepared-plans.js';

it('reserves a bound plan once and burns it only when invocation begins', async () => {
  const store = createPreparedPlanStore({
    ttlMs: 5 * 60_000,
    clock: fixedClock('2026-07-17T10:00:00.000Z'),
    randomBytes: deterministicBytes
  });
  const issued = store.issue({
    subjectId: 'stdio:local-operator',
    workflow: 'internal-service',
    operation: 'create',
    normalizedInput: { hostname: 'documents.home.arpa' },
    observedState: { dns: null },
    payload: { serviceId: 'svc_documents' }
  });

  expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const lease = await store.reserve(issued.token, {
    subjectId: 'stdio:local-operator',
    workflow: 'internal-service',
    operation: 'create',
    observedState: { dns: null }
  });
  expect(ReservedPreparedPlanSchema.parse(lease.value).payload).toEqual({
    serviceId: 'svc_documents'
  });
  await lease.consume();
  await expect(store.reserve(issued.token, {
    subjectId: 'stdio:local-operator',
    workflow: 'internal-service',
    operation: 'create',
    observedState: { dns: null }
  })).rejects.toMatchObject({ code: 'PLAN_TOKEN_USED' });
});
```

Add cases for the wrong subject/workflow/operation, expiration at the exact deadline, random-token lookup,
normalized key ordering, observed-state drift, constant-time digest comparison, and bounded eviction. Two
concurrent reservations of one token must yield exactly one lease. Prove that `release()` before handler
invocation makes the token reservable again, that `consume()` burns it, and that either settlement method is
idempotent but the opposite transition is refused. Assert that reservation and settlement errors contain
no plan payload or token.

- [ ] **Step 2: Write failing execution tests**

```ts
it('rolls back completed actions in exact reverse order', async () => {
  const events: string[] = [];
  await expect(executePreparedWorkflow({
    context: sealedWorkflowContext({
      plan: reservedFixturePlan(),
      mutation: { backupId: 'backup-1', backupCreatedAt: '2026-07-17T10:00:00.000Z', auditIntentId: 'audit-1' }
    }),
    buildSteps: () => [
      reversibleStep('create-backend', events),
      reversibleStep('create-dns', events),
      failingStep('apply-unbound', events)
    ],
    verifyRollback: async () => events.push('verify-rollback')
  })).rejects.toMatchObject({ code: 'WORKFLOW_APPLY_FAILED', backupId: 'backup-1' });

  expect(events).toEqual([
    'register:undo-create-backend',
    'do:create-backend',
    'register:undo-create-dns',
    'do:create-dns',
    'register:undo-apply-unbound',
    'do:apply-unbound',
    'undo:apply-unbound',
    'undo:create-dns',
    'undo:create-backend',
    'verify-rollback'
  ]);
});
```

Add cases for missing sealed preflight metadata, missing mutation metadata, cancellation before the first
action, cancellation during apply, a mutation that commits and then reports failure, idempotent repeated
compensation, rollback-action failure, rollback verification failure, successful verification, redacted
audit events, and the invariant that the workflow never asks the backup service for a second backup. Assert
that every `register:*` event precedes its `do:*` event, rollback always receives a fresh
`AbortSignal.timeout(30_000)` independent of the caller signal, all compensations are attempted in reverse
order, and the final error retains the primary failure plus every rollback and rollback-verification
failure. Add an integration trace proving the per-firewall mutation lock is acquired before preflight and
held through rollback/final audit, and a post-backup digest mismatch refuses before compensation
registration or mutation. Cover backup SHA mismatch, revalidated configuration mismatch, revalidated
relevant-state mismatch, and revalidation failure separately; mismatches return `PRECONDITION_CHANGED`, a
probe failure fails closed, none invokes the handler, and each settles the plan with `release()` exactly
once.

- [ ] **Step 3: Run the focused tests and confirm the red state**

Run:

```bash
npx vitest run tests/workflows/prepared-plans.test.ts tests/workflows/execution.test.ts
```

Expected: FAIL because the workflow runtime modules do not exist. No unrelated test may fail first.

- [ ] **Step 4: Implement the typed contracts and in-memory token store**

```ts
export type WorkflowName = 'internal-service' | 'device-domain-block';
export type WorkflowOperation = 'create' | 'update' | 'remove';

export interface PreparedPlan<TPayload extends object = Record<string, unknown>> {
  readonly id: string;
  readonly subjectId: string;
  readonly workflow: WorkflowName;
  readonly operation: WorkflowOperation;
  readonly normalizedInputHash: string;
  readonly observedStateHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly payload: Readonly<TPayload>;
}

export interface PreparedPlanStore {
  issue<TPayload extends object>(input: IssuePreparedPlan<TPayload>): IssuedPreparedPlan;
  reserve<TPayload extends object>(
    token: string,
    binding: PlanBinding & { readonly observedState: unknown }
  ): Promise<CapabilityPreflightLease>;
  revoke(token: string): void;
}
```

Import `CapabilityPreflightLease` from Product Task 5 and define
`ReservedPreparedPlanSchema` with the existing `zod/v4` dependency. Store 256-bit random tokens only as
SHA-256 digests and keep an explicit `issued | reserved | consumed` state. Canonicalize JSON recursively
before hashing. Set the default TTL to five minutes, cap live entries at 1,000, and evict expired entries on
every issue and reservation. Reservation atomically compares binding and current observed-state digests and
returns the sealed plan as the lease value. `release()` returns `reserved` to `issued`; `consume()` erases
the secret token entry and marks its digest consumed until expiry so a replay receives
`PLAN_TOKEN_USED` rather than a timing oracle.

- [ ] **Step 5: Implement resource and execution adapters**

`createWorkflowResourceGateway()` must call `getResource()` for every key in `WORKFLOW_RESOURCE_KEYS` at construction and fail before serving if one is absent. Define a closed direct-probe map for DNS, TLS, HTTP, HAProxy runtime, device leases, and diagnostics. Each mutation passes `{ apply: false }`; only `apply(group)` may trigger reconfiguration.

```ts
export interface WorkflowStep {
  readonly id: string;
  readonly apply: (
    signal: AbortSignal,
    registerCompensation: (action: RollbackAction) => void
  ) => Promise<Readonly<Record<string, unknown>>>;
}

export interface RollbackAction {
  readonly id: string;
  readonly rollback: (signal: AbortSignal) => Promise<void>;
}

export interface WorkflowExecution {
  readonly context: CapabilityExecutionContext;
  readonly signal: AbortSignal;
  readonly buildSteps: (plan: ReservedPreparedPlan) => readonly WorkflowStep[];
  readonly verify: (signal: AbortSignal) => Promise<WorkflowVerification>;
  readonly verifyRollback: (signal: AbortSignal) => Promise<RollbackVerification>;
}

export async function executePreparedWorkflow(input: WorkflowExecution): Promise<WorkflowExecutionResult> {
  const plan = requirePreflightValue(input.context, ReservedPreparedPlanSchema.parse);
  const mutation = requireMutationMetadata(input.context);
  const compensations: RollbackAction[] = [];
  const registerCompensation = (action: RollbackAction) => {
    if (compensations.some(({ id }) => id === action.id)) throw workflowError('DUPLICATE_COMPENSATION');
    compensations.push(action);
  };
  try {
    const steps = input.buildSteps(plan);
    for (const step of steps) {
      await step.apply(input.signal, registerCompensation);
    }
    const verification = await input.verify(input.signal);
    return { changed: compensations.length > 0, backupId: mutation.backupId, verification };
  } catch (primaryFailure) {
    const rollbackSignal = AbortSignal.timeout(30_000);
    const rollbackFailures = await rollbackReverse(compensations, rollbackSignal);
    const rollbackVerification = await verifyRollbackCapturingFailure(input, rollbackSignal);
    throw workflowApplyError({
      primaryFailure,
      backupId: mutation.backupId,
      rollbackFailures,
      rollbackVerification
    });
  }
}
```

Every executor registers an idempotent compensation before its first outbound mutation. The compensation
uses deterministic ownership IDs and recorded pre-state, so it safely handles a lost mutation response and
can run more than once. A gateway adapter may instead expose a transactional receipt only when its contract
proves that no committed write can be reported without that receipt; tests instrument this boundary. Always
use the independent 30-second rollback signal, even when the primary failure was not cancellation, and keep
attempting later inverse actions after one fails. Audit step identifiers and result digests, never raw
fields. Product Task 5 performs the post-backup configuration/relevant-state comparison before this runtime
or any mutation closure is invoked.

- [ ] **Step 6: Integrate dependencies through the product composition root**

Implement `createWorkflowCapabilities(workflow)` as a list of `defineCapability` factory results whose
private callbacks close over `workflowResources`, `preparedPlans`, `clock`, and `randomBytes`; pass those
definitions as extensions to `createProductApplicationContext`. Do not add these services to
`ServerContext` or expose a handler on `CapabilityDefinition`. Apply factories return a
`CapabilityPreflightLease` from `preflight`, read the plan in the handler only through
`requirePreflightValue`, read mutation metadata only through `requireMutationMetadata`, use
`policy.confirmation: 'none'`, and declare only valid Foundation feature
flags. A firewall-write factory composes the plan reservation with
`createFirewallPreflight()` so its returned lease includes the mandatory sealed configuration and
relevant-state observation. Assert that the kernel acquires the target lock before calling it, matches
the strict backup hash and bounded revalidation before handler invocation, and releases the plan lease on
`PRECONDITION_CHANGED`. Assert that `preflight` and `mutation` metadata are present only in execution
contexts created by the kernel at their documented phases and cannot be caller-set.

- [ ] **Step 7: Run the workflow runtime and foundation safety gates**

Run:

```bash
npx vitest run tests/workflows/prepared-plans.test.ts tests/workflows/execution.test.ts tests/security/product-policy-kernel.test.ts tests/integration/backup-dispatch.test.ts tests/contract/workflow-contract.test.ts
npm run typecheck
npm run license:check
```

Expected: PASS. The event trace proves one backup precedes workflow actions and inverse actions run in reverse order.

- [ ] **Step 8: Commit the runtime**

```bash
git add docs/contracts/opnsense-workflows.v1.json \
  docs/contracts/opnsense-workflows.v1.sha256 \
  docs/contracts/opnsense-workflows.v1.review.json \
  tests/evidence/opnsense-workflow-evidence.json \
  tests/contract/workflow-contract.test.ts \
  scripts/contracts/validate-opnsense-product.mjs \
  package.json \
  src/workflows tests/workflows/prepared-plans.test.ts tests/workflows/execution.test.ts
git commit -m "feat: add prepared workflow execution runtime"
```

### Task 2: Prepare and verify internal HTTPS publication

**Files:**
- Create: `src/workflows/internal-service/schemas.ts`
- Create: `src/workflows/internal-service/planner.ts`
- Create: `src/workflows/internal-service/verifier.ts`
- Create: `src/workflows/internal-service/capabilities.ts`
- Create: `tests/workflows/internal-service-prepare.test.ts`
- Create: `tests/workflows/internal-service-verify.test.ts`
- Modify: `src/workflows/catalog.ts`
- Modify: `tests/evidence/opnsense-workflow-evidence.json`

**Interfaces:**
- Consumes: `WorkflowResourceGateway`, `PreparedPlanStore`, `CapabilityDefinition`, and the parity resources `interfaces_vip`, `trust_ca`, `trust_cert`, `haproxy_server`, `haproxy_backend`, `haproxy_acl`, `haproxy_action`, `haproxy_frontend`, and `unbound_host_override`.
- Produces: read capabilities `prepare_internal_service` and `verify_internal_service`, plus `InternalServicePlan` consumed by Task 3.

The first release supports an internal FQDN ending in `.home.arpa`, an HTTP or HTTPS backend on a private address, one internal CA, a certificate scoped to the requested hostname, a shared managed HAProxy HTTPS frontend, and an Unbound host override announced last. It must not request or manage a public DNS record or public certificate.

- [ ] **Step 1: Write failing schema and clarification tests**

```ts
const result = await prepareInternalService({
  serviceName: 'Paperless',
  hostname: 'documents.home.arpa',
  backendUrl: 'http://10.20.0.15:8000'
}, contextWithTwoCandidateListenAddresses());

expect(result).toEqual({
  status: 'needs-input',
  question: {
    id: 'listen_address',
    text: 'Sur quelle adresse interne OPNsense HAProxy doit-il écouter pour documents.home.arpa ?',
    choices: ['10.20.0.1', '10.20.0.254']
  }
});
expect(context.mutationCalls).toBe(0);
```

Cover missing backend URL, non-private backend address, non-`.home.arpa` hostname, IP-literal hostname, ambiguous interface, unmanaged DNS collision, unmanaged HAProxy collision, duplicate managed service, inaccessible backend, existing managed CA, shared frontend reuse, and exactly one question per result.

- [ ] **Step 2: Write failing prepared-plan and verification tests**

```ts
const prepared = await prepareInternalService({
  serviceName: 'Paperless',
  hostname: 'documents.home.arpa',
  backendUrl: 'http://10.20.0.15:8000',
  listenAddress: '10.20.0.254',
  listenInterface: 'lan'
}, cleanInternalContext());

expect(prepared).toMatchObject({
  status: 'prepared',
  operation: 'create',
  planToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
  summary: 'Publier Paperless uniquement sur le réseau interne à https://documents.home.arpa',
  recovery: { strategy: 'inverse-actions', backupRequired: true }
});
expect(prepared.changes.map(change => change.resource)).toEqual([
  'interfaces_vip',
  'trust_ca',
  'trust_cert',
  'haproxy_server',
  'haproxy_backend',
  'haproxy_acl',
  'haproxy_action',
  'haproxy_frontend',
  'unbound_host_override'
]);
```

For `verify_internal_service`, test REST linkage, DNS resolution to the listen address, certificate SAN, certificate chain to the expected internal CA fingerprint, HAProxy runtime state, HTTP status from the backend route, missing private-key fields, and distinct `proven`, `failed`, and `not-observed` checks.

- [ ] **Step 3: Run the focused tests and confirm the red state**

Run:

```bash
npx vitest run tests/workflows/internal-service-prepare.test.ts tests/workflows/internal-service-verify.test.ts
```

Expected: FAIL because the internal-service planner, verifier, and capability records do not exist.

- [ ] **Step 4: Define strict schemas and stable ownership identifiers**

```ts
export const PrepareInternalServiceInputSchema = z.object({
  serviceName: z.string().trim().min(1).max(64),
  hostname: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+home\.arpa$/),
  backendUrl: z.string().url().refine(isPrivateHttpUrl, 'Backend must use HTTP or HTTPS on a private address'),
  listenAddress: z.union([z.ipv4(), z.ipv6()]).optional(),
  listenInterface: z.string().regex(/^[A-Za-z0-9_.-]{1,32}$/).optional()
}).strict();

export const VerifyInternalServiceInputSchema = z.object({
  hostname: PrepareInternalServiceInputSchema.shape.hostname
}).strict();
```

Derive `serviceId` as `svc_` plus the first 16 lowercase hex characters of SHA-256 over the canonical hostname. Use `'opnsense-mcp:internal-service:' + serviceId` in every managed description. Use `opnsense-mcp-internal-ca` for the sole managed root CA and `opnsense-mcp-internal-https` for the shared frontend. Reject an object with a matching name or endpoint but no exact ownership description.

- [ ] **Step 5: Implement read-only discovery and plan preparation**

Discovery order is deterministic:

1. validate the hostname and backend URL;
2. probe backend reachability without credentials;
3. read candidate internal interface addresses and managed virtual IPs;
4. inspect DNS, CA, certificate, HAProxy server/backend/ACL/action/frontend objects;
5. reject unmanaged collisions;
6. ask one question if the listen address or interface remains material and unresolved;
7. canonicalize observed objects and issue the five-minute token.

The plan records exact create, update, reuse, and apply operations, expected postconditions, inverse actions, CA trust guidance, and the fact that client devices must trust the internal CA. It returns no certificate private key and performs no mutation.

- [ ] **Step 6: Implement structured verification**

```ts
export interface InternalServiceVerification {
  readonly hostname: string;
  readonly overall: 'proven' | 'failed' | 'not-observed';
  readonly checks: readonly {
    readonly id: 'managed-objects' | 'dns' | 'certificate-san' | 'certificate-chain' | 'haproxy' | 'backend';
    readonly status: 'proven' | 'failed' | 'not-observed';
    readonly evidence: string;
  }[];
  readonly modified: false;
}
```

Read managed object relationships first, then run the closed DNS, TLS, HAProxy-runtime, and HTTP probes. Evidence contains resource IDs, addresses, fingerprints, status codes, and digests only. A certificate check must prove that the requested hostname is in SAN and that the chain terminates at the recorded CA fingerprint.

- [ ] **Step 7: Register the read capabilities**

Create both records with dependency-injected `defineCapability` factories. Their nested policy is
`effect: 'read'`, `backup: 'none'`, `audit: 'none'`, `confirmation: 'none'`, explicit
`resourceScopes`, and `requiredFeatureFlags: []`; no workflow-only feature flag exists in the Foundation
vocabulary. Record their unit, mock, VM, and agentic paths only in the mutable
`opnsense-workflow-evidence.json`; the reviewed extension rows are immutable. Assert
`catalog.getByMcpName()` returns the definitions. They remain visible when `READ_ONLY=true`.

- [ ] **Step 8: Run the focused and catalog gates**

Run:

```bash
npx vitest run tests/workflows/internal-service-prepare.test.ts tests/workflows/internal-service-verify.test.ts tests/capabilities/catalog.test.ts tests/contract/workflow-contract.test.ts
npm run typecheck
```

Expected: PASS. Preparation emits no mutation and verification contains no private key.

- [ ] **Step 9: Commit preparation and verification**

```bash
git add src/workflows/internal-service src/workflows/catalog.ts tests/evidence/opnsense-workflow-evidence.json tests/workflows/internal-service-prepare.test.ts tests/workflows/internal-service-verify.test.ts
git commit -m "feat: prepare and verify internal service publication"
```

### Task 3: Apply and remove internal HTTPS publication

**Files:**
- Create: `src/workflows/internal-service/executor.ts`
- Create: `tests/workflows/internal-service-apply.test.ts`
- Create: `tests/workflows/internal-service-rollback.test.ts`
- Create: `tests/integration/internal-service-policy.test.ts`
- Modify: `src/workflows/internal-service/capabilities.ts`
- Modify: `src/workflows/catalog.ts`
- Modify: `tests/evidence/opnsense-workflow-evidence.json`

**Interfaces:**
- Consumes: `InternalServicePlan`, `PreparedPlanStore`, `WorkflowResourceGateway`, `executePreparedWorkflow()`, `requirePreflightValue()`, and `requireMutationMetadata()`.
- Produces: firewall-writing capability `apply_internal_service` and read capability `remove_internal_service`. Removal prepares an `operation: 'remove'` token; only `apply_internal_service` mutates.

- [ ] **Step 1: Write failing apply-order and safety tests**

```ts
const application = writableApplication(events);
const result = await dispatchCapability(
  { name: 'apply_internal_service', arguments: { planToken: prepared.planToken } },
  { application, transport: 'stdio' }
);

expect(events).toEqual([
  'limits:admit',
  'firewall-lock:acquire',
  'plan:reserve-and-revalidate',
  'audit:intent',
  'backup:create',
  'state:post-backup-revalidate',
  'vip:create',
  'interfaces:apply',
  'ca:create',
  'certificate:create',
  'haproxy-server:create',
  'haproxy-backend:create',
  'haproxy-acl:create',
  'haproxy-action:create',
  'haproxy-frontend:update',
  'haproxy:apply',
  'dns:create',
  'unbound:apply',
  'verify',
  'audit:final',
  'firewall-lock:release'
]);
expect(result).toMatchObject({
  kind: 'success',
  output: { changed: true, backupId: 'backup-1', verification: { overall: 'proven' } }
});
```

Add cases for hidden listing in read-only mode, forged direct dispatch, wrong subject, expired token,
concurrent reservation, replayed token, observed-state drift after preparation, and unmanaged collision
found by preflight. Prove the order `parse -> dynamic scopes -> limits:admit -> firewall-lock -> plan:reserve ->
audit:intent -> backup:create -> post-backup-state-check -> handler-mutation`, that preflight receives no
mutation metadata, that backup/audit never run when preflight refuses, and that backup failure releases the
reservation before the first gateway mutation so a retry can reserve it. Also cover state drift between
preflight and the completed backup: `PRECONDITION_CHANGED` releases the plan lease because the handler was
not invoked, the audit records the backup metadata, and no mutation occurs.
Cover missing sealed preflight metadata, missing mutation metadata, and failed verification after
invocation; once handler invocation begins, the token remains consumed on every result.

- [ ] **Step 2: Write failing rollback and removal tests**

Fail at every action boundary in a table-driven test. Assert exact reverse deletion, restoration of prior shared-frontend fields, reapplication of HAProxy and Unbound after inverse changes, deletion of a CA or virtual IP only when the workflow created it and no other managed object references it, and residue verification.

```ts
const removal = await removeInternalService({ hostname: 'documents.home.arpa' }, managedContext());
expect(removal).toMatchObject({
  status: 'prepared',
  operation: 'remove',
  planToken: expect.any(String),
  changes: expect.arrayContaining([{ action: 'remove', resource: 'unbound_host_override' }])
});
expect(managedContext().mutationCalls).toBe(0);
```

- [ ] **Step 3: Run the focused tests and confirm the red state**

Run:

```bash
npx vitest run tests/workflows/internal-service-apply.test.ts tests/workflows/internal-service-rollback.test.ts tests/integration/internal-service-policy.test.ts
```

Expected: FAIL because the executor and mutating catalog record do not exist.

- [ ] **Step 4: Implement apply revalidation and dependency order**

The public `apply_internal_service` input schema accepts exactly `{ planToken: string }`. Its private
`defineCapability` preflight callback atomically reserves the token, re-reads every observed object,
verifies `observedStateHash` and the managed-object ownership markers, and returns the reserved plan in a
`CapabilityPreflightLease` combined with `createFirewallPreflight()`'s sealed configuration/relevant-state
observation. This happens under the target lock before audit and backup. The Product kernel matches the
strict backup hash and revalidation before handler invocation. The handler never looks up the token: it
uses `requirePreflightValue(context, ReservedPreparedPlanSchema.parse)`, calls
`requireMutationMetadata(context)`, and builds reversible steps from the sealed plan. Each executor registers its
idempotent compensation before the corresponding gateway mutation.

Envelope and handler order is fixed:

1. while the per-firewall lock is still held, the kernel matches the backup configuration hash and revalidates both sealed digests; refuse before handler invocation on drift;
2. create the optional virtual IP and apply interfaces;
3. create or reuse the managed internal CA and create the hostname certificate;
4. create HAProxy server, backend, ACL, action, and shared-frontend link fields;
5. apply HAProxy and prove its configuration accepted;
6. create the Unbound host override last and apply Unbound;
7. invoke the Task 2 verifier.

Do not run a full backup restore automatically. Return the strict backup identifier as a manual recovery anchor when inverse rollback is incomplete.

- [ ] **Step 5: Implement removal as prepare-only plus tokenized apply**

`remove_internal_service` reads all owned objects and external references, refuses an unmanaged dependency, orders removal as DNS, HAProxy link/action/ACL/backend/server/certificate, and then conditionally CA and virtual IP. It issues an `operation: 'remove'` token. `apply_internal_service` branches on the plan operation and executes the inverse dependency order. The postcondition is absence of every service-owned object, no stale shared-frontend reference, and continued health of unrelated services.

- [ ] **Step 6: Register and classify both capabilities**

```ts
export function createApplyInternalServiceCapability(
  dependencies: InternalServiceCapabilityDependencies
): CapabilityDefinition {
  return defineCapability({
    id: 'workflow.internal-service.apply',
    mcpName: 'apply_internal_service',
    title: 'Apply an internal HTTPS publication plan',
    description: 'Apply one reserved internal publication or removal plan.',
    inputSchema: z.object({ planToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict(),
    outputSchema: InternalServiceApplyResultSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'firewall-write',
      resourceScopes: [
        'interfaces_vip', 'trust_ca', 'trust_cert', 'haproxy_server', 'haproxy_backend',
        'haproxy_acl', 'haproxy_action', 'haproxy_frontend', 'unbound_host_override'
      ],
      requiredFeatureFlags: [],
      backup: 'strict',
      audit: 'required',
      confirmation: 'none',
      timeoutMs: 120_000,
      redactFields: ['planToken']
    },
    preflight: (input, context) => dependencies.preflight.reserveInternalService(input, context),
    handler: (_input, context) => dependencies.executor.applyReserved({
      plan: requirePreflightValue(context, ReservedPreparedPlanSchema.parse),
      mutation: requireMutationMetadata(context),
      signal: context.signal
    })
  });
}
```

The handler in this snippet is private to `defineCapability`; it is absent from the returned
`CapabilityDefinition`. The prepared token is workflow state, not a new Foundation
`ConfirmationPolicy`, so `confirmation` remains `'none'`. Classify the factory-created
`remove_internal_service` definition as `policy.effect: 'read'` because it only prepares. Test that a
cached MCP name cannot bypass `catalog.getByMcpName()`, read-only mode, or an allowed-resource set.

- [ ] **Step 7: Run workflow, safety, and parity gates**

Run:

```bash
npx vitest run tests/workflows/internal-service-apply.test.ts tests/workflows/internal-service-rollback.test.ts tests/integration/internal-service-policy.test.ts tests/security/product-policy-kernel.test.ts tests/integration/backup-dispatch.test.ts tests/contract/workflow-contract.test.ts
npm run typecheck
```

Expected: PASS. Exactly one backup precedes every successful or failed apply, and removal preparation never writes.

- [ ] **Step 8: Commit internal publication mutation support**

```bash
git add src/workflows/internal-service src/workflows/catalog.ts tests/evidence/opnsense-workflow-evidence.json tests/workflows/internal-service-apply.test.ts tests/workflows/internal-service-rollback.test.ts tests/integration/internal-service-policy.test.ts
git commit -m "feat: apply and remove internal service publication"
```

### Task 4: Add device-scoped DNS blocking

**Files:** Create `src/workflows/device-domain/{schemas,resolver,planner,executor,verifier,capabilities}.ts`, `tests/workflows/device-domain.test.ts`, `tests/integration/device-domain-policy.test.ts`, and `tests/vm/workflows/device-domain.test.mjs`; modify `src/workflows/catalog.ts` and `tests/evidence/opnsense-workflow-evidence.json`.

**Interfaces:** Produce read capabilities `prepare_device_domain_block`, `verify_device_domain_block`, and `remove_device_domain_block`, plus firewall-writing `apply_device_domain_block`. Consume `unbound_dnsbl`, `kea_dhcpv4_reservation`, and `dnsmasq_host`; resolve hostname, MAC, or IP through the closed device-lease probe. `remove_device_domain_block` prepares `operation: 'remove'`; only apply mutates.

- [ ] Write failing tests proving that `device: 'tablet-salon'` resolves to one stable address, ambiguous devices ask one question, dynamic leases require a reservation, unsupported reservation backends fail closed, two-label domains remain valid, existing duplicates are all normalized, unmanaged entries are preserved, and a missing domain or device never mutates.
- [ ] Test disabled global DNSBL: preparation returns one question asking whether to enable it; only a repeated call with `enableDnsBlocklist: true` may issue a token. Record and restore the prior enabled state. `reserveCurrentAddress: true` is a requested plan operation, not authorization to apply.
- [ ] Test the exact schemas:

```ts
import * as z from 'zod/v4';

const DeviceDomainInput = z.object({
  device: z.string().trim().min(1).max(128),
  domain: z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  includeSubdomains: z.boolean().default(true),
  reserveCurrentAddress: z.boolean().optional(),
  reservationProvider: z.enum(['kea', 'dnsmasq']).optional(),
  enableDnsBlocklist: z.boolean().optional()
}).strict();
```

- [ ] Run `npx vitest run tests/workflows/device-domain.test.ts tests/integration/device-domain-policy.test.ts`; expect FAIL because the workflow factories are absent.
- [ ] Implement preparation with a `/32` `source_nets` selector and normalized `blocklists`/`wildcards`. Store ownership as `'opnsense-mcp:device-domain:' + sha256(canonicalDeviceAndDomain).slice(0, 16)`. Disclose that application-level encrypted DNS or VPNs can bypass the firewall resolver; do not claim prevention.
- [ ] Implement the capability factory's private preflight under the per-firewall mutation lock with atomic token reservation and bounded current-state revalidation before audit/backup. Compose its lease with `createFirewallPreflight()`; the kernel matches the strict backup configuration hash and revalidates both sealed digests before invoking the handler. The handler obtains only the sealed plan with `requirePreflightValue` and Product Task 5's sealed mutation value with `requireMutationMetadata`, then performs optional reservation, DNSBL settings write, one Unbound apply, source-specific DNS verification, and reverse rollback. Register every idempotent compensation before its mutation. Verification returns `blocked-for-device`, `not-blocked-for-device`, and an unchanged control-source result.
- [ ] Implement removal as prepare-only and make apply remove every owned duplicate while retaining unrelated device/domain entries. Factory definitions use nested Foundation policy fields, `requiredFeatureFlags: []`, and `confirmation: 'none'`; the prepared token is not a confirmation-policy value.
- [ ] In the VM test, register fixture cleanup before setup mutation, create a synthetic `.home.arpa` override, query from two guest source addresses, prove the selected `/32` is blocked and the control source resolves, remove it, prove both resolve, and verify no owned object remains. The test body uses `try/finally`, while every invocation goes through the outer `npm run vm:with -- ...` wrapper so residue verification and VM stop also run after failure.
- [ ] Run `npx vitest run tests/workflows/device-domain.test.ts tests/integration/device-domain-policy.test.ts tests/contract/workflow-contract.test.ts && npm run typecheck`; expect PASS. Defer the wrapped live command to Task 9.
- [ ] Commit:

```bash
git add src/workflows/device-domain src/workflows/catalog.ts tests/evidence/opnsense-workflow-evidence.json tests/workflows/device-domain.test.ts tests/integration/device-domain-policy.test.ts tests/vm/workflows/device-domain.test.mjs
git commit -m "feat: add device scoped domain blocking workflow"
```

### Task 5: Add pedagogical diagnosis, instructions, prompts, and skill

**Files:** Create `src/workflows/diagnosis/{schemas,service,capabilities}.ts`,
`src/app/workflow-runtime.ts`, `tests/app/default-workflow-runtime.test.ts`,
`skills/opnsense-guide/SKILL.md`, `tests/workflows/diagnosis.test.ts`, and
`tests/contract/workflow-runtime.test.ts`; modify the Foundation-owned
`src/app/default-application.ts`,
`src/mcp/instructions.ts`, `src/mcp/prompts.ts`, `tests/mcp/instructions.test.ts`,
`tests/mcp/prompts.test.ts`, and `tests/mcp/elicitation.test.ts`, plus
`src/workflows/catalog.ts`, `tests/evidence/opnsense-workflow-evidence.json`, and `package.json`.

**Interfaces:** Produce read-only tool `diagnose_network_problem`; MCP prompts `diagnose_network_problem`, `publish_internal_service`, and `block_domain_for_device`; `SERVER_INSTRUCTIONS`; skill `opnsense-guide`; and `createWorkflowRuntimeFromEnvironment()` as the final executable composition root. Publication and blocking prompts may prepare a plan but never call apply.

- [ ] Write failing diagnosis tests using the non-technical request “Internet est lent sur mon ordinateur, regarde sans rien modifier et explique-moi simplement.” Missing identity returns one plain-language question. A complete request reads DHCP/ARP, interface state, routes, matching rules, states, and bounded logs, with zero mutation and zero backup calls.
- [ ] Assert the output contract separates `observations` with evidence/source, `hypotheses` with confidence/reason, `summary`, `nextQuestion`, `recommendedActions`, and literal `modified: false`. A hypothesis must never be labeled as proof.
- [ ] Extend the existing Foundation prompt and elicitation tests, without replacing their earlier assertions. Prove the three exact names remain discoverable, diagnosis is read-only, the two mutation-oriented prompts stop after clarification/preparation, elicitation is used only when the client advertises form elicitation, unsupported elicitation returns a next step, and no form requests a secret.
- [ ] Run `npx vitest run tests/workflows/diagnosis.test.ts tests/mcp/instructions.test.ts tests/mcp/prompts.test.ts tests/mcp/elicitation.test.ts`; expect FAIL for the missing diagnosis capability and new workflow-specific guidance, not because Vitest, Zod, instructions, prompts, or elicitation modules are absent.
- [ ] Revise the existing `SERVER_INSTRUCTIONS` so its first 512 characters remain self-contained: accept plain language, start read-only, ask one material question at a time, never invent topology, explain impact and recovery before changes, and separate evidence from hypotheses. `buildServer()` already registers it under the Foundation contract; do not add a second registration path.
- [ ] Implement the diagnosis with closed read probes, bounded time window `1..1440`, optional `device` and `destination`, and no raw shell. Create its definition with a dependency-injected `defineCapability` factory and nested policy `effect: 'read'`, `requiredFeatureFlags: []`, `backup: 'none'`, `audit: 'none'`, and `confirmation: 'none'`, so it remains available under read-only mode.
- [ ] Write `skills/opnsense-guide/SKILL.md` with the same decision sequence, the exact tool/prompt names, prepare/apply consent boundary, backup explanation, simple French and English examples, and no secrets. Validate its front matter and internal links.
- [ ] Create the first exact runtime-union test now that all nine rows exist. Call Product Task 1's pure
validator with `{ requireEvidenceFiles: true, reviewedExtensions: [workflowExtension] }`; require the runtime
catalog to equal the reviewed base-plus-workflow union with every evidence row non-empty. Register
`workflow-runtime:validate` for this exact call, and make `product-contract:validate` discover the same
schema-valid reviewed bundle and pass it explicitly. Run the focused tests plus `npx vitest run
tests/capabilities/catalog.test.ts tests/contract/workflow-contract.test.ts
tests/contract/workflow-runtime.test.ts && npm run workflow-contract:validate && npm run
workflow-runtime:validate && npm run typecheck`; expect the exact union to pass and zero recorded mutation.
- [ ] Implement `createWorkflowRuntimeFromEnvironment(env, factories?)` in
`src/app/workflow-runtime.ts`. It calls the source-internal Product
`createOwnedProductServicesFromEnvironment()`, builds one generic resource service, WorkflowResourceGateway,
PreparedPlanStore, clock, and random source, then passes those exact dependencies to
`createWorkflowApplicationContext()`. Initialization is transactional and `close()` delegates exactly once to
the owned Product services even after partial workflow construction failure. No service, secret, dispatcher,
or close authority is attached to opaque ApplicationContext.
- [ ] Replace `src/app/default-application.ts::createDefaultApplicationRuntime()` with
`createWorkflowRuntimeFromEnvironment(process.env)`. This is the final production composition root; no
Foundation-only or Product-only default remains reachable from `dist/main.js` or the HTTP entrypoint.
`tests/app/default-workflow-runtime.test.ts` uses read-only sentinel env/factories. It requires the safe
catalog reference and contract validator to contain the exact reviewed base-plus-nine-workflow union, then
uses the real buildServer to require `tools/list` to equal exactly the catalog's read-only exposed subset with
every write absent, plus the three read-only product resources and three prompts. It calls a product read and
`diagnose_network_problem`, proves no mutation on startup/listing, covers partial
initialization/idempotent cleanup, and asserts all errors/results omit secrets.
- [ ] Commit:

```bash
git add src/app/workflow-runtime.ts src/app/default-application.ts src/workflows/diagnosis \
  src/mcp/instructions.ts src/mcp/prompts.ts skills/opnsense-guide src/workflows/catalog.ts \
  tests/app/default-workflow-runtime.test.ts tests/evidence/opnsense-workflow-evidence.json \
  tests/workflows/diagnosis.test.ts tests/contract/workflow-runtime.test.ts \
  tests/mcp/instructions.test.ts tests/mcp/prompts.test.ts tests/mcp/elicitation.test.ts package.json
git commit -m "feat: add pedagogical guidance and read only diagnosis"
```

### Task 6: Build the private configuration and four client installers

**Files:** Create `src/cli/{index,doctor,uninstall}.ts`,
`src/installers/{contracts,distribution-identity,ownership,codex,claude-code,opencode,kimi,skills}.ts`, root
`kimi.plugin.json`, `scripts/distribution/render-manifests.mjs`,
`tests/installers/{private-config,clients,plugins,uninstall}.test.ts`, and
`tests/clients/{versions.json,smoke.mjs}`. Modify/adapt the already provenance-migrated
`.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json`,
`plugins/opnsense-mcp/{.codex-plugin/plugin.json,.claude-plugin/plugin.json,.mcp.json}`,
`plugins/opnsense-mcp/skills/opnsense-guide/{SKILL.md,agents/openai.yaml}`,
`src/cli/{install,serve}.ts`, `tests/plugin/package.test.mjs`, and
`tests/installer/install.test.mjs`; extend Product Task 10's single
`src/config/private-config.ts` store with interactive installer operations; modify the independently authored root
`skills/opnsense-guide/SKILL.md` and `package.json`. Do not recreate or overwrite a migrated file as if it
were new: preserve its provenance row while refactoring it to the final client contract.

**Interfaces:** `opnsense-mcp` with no arguments serves stdio; `opnsense-mcp http` starts the same hardened
authenticated loopback HTTP entrypoint for explicit local use and accepts no token/secret flag; `install --client
codex|claude-code|opencode|kimi|all`, `doctor`, and `uninstall` manage only owned entries. Codex and
Claude Code use marketplace/plugin commands by default and accept `--direct-mcp` only as a documented
fallback. Current Node-based Kimi Code uses its native plugin as the primary documented flow and current
MCP JSON as fallback. OpenCode uses native MCP configuration, not an invented MCP plugin. The config path is
`${XDG_CONFIG_HOME:-$HOME/.config}/opnsense-mcp/config.json` on POSIX and
`%APPDATA%\OPNsenseMCP\config.json` on Windows.

- [ ] Write failing fake-home tests for interactive hidden secret input, non-interactive environment input,
atomic replacement, redacted errors, idempotence, collision refusal, preservation of unknown client
settings, and uninstall that keeps secrets unless `--remove-secrets` is explicitly confirmed. On POSIX,
assert directory mode `0700` and file mode `0600`. On native Windows, do not assert POSIX modes: use an
injected ACL adapter backed by `icacls`/`Get-Acl` and assert protected inheritance plus access limited to
the current user SID, `SYSTEM`, and `BUILTIN\Administrators`; simulate and reject ACL-hardening failure.
- [ ] Use this strict private file shape:

```json
{"version":1,"opnsense":{"url":"https://192.168.1.1","apiKey":"sentinel-key","apiSecret":"sentinel-secret","verifyTls":true},"safety":{"readOnly":true,"strictBackup":true}}
```

- [ ] Run `npx vitest run tests/installers/private-config.test.ts tests/installers/clients.test.ts tests/installers/plugins.test.ts tests/installers/uninstall.test.ts`; expect FAIL because the four final adapters, plugin manifests, and private JSON configuration are absent. Preserve the approved installer/serve behavior that the migration tests already prove; refactor it in place instead of adding a parallel launcher tree.
- [ ] Implement secret input only through a hidden terminal prompt or `OPNSENSE_URL`,
`OPNSENSE_API_KEY`, and `OPNSENSE_API_SECRET` in non-interactive mode. Never accept a secret flag. The
server resolves the platform-default private file and honors `OPNSENSE_CONFIG_FILE`; direct client entries
contain only that path. Use the ACL rules above on Windows and fail closed if they cannot be established.
- [ ] Implement `loadDistributionIdentity()` from `package.json`, the two marketplace manifests, and the
three native plugin manifests. It returns the exact package name/version, `packageSpec`, repository `owner/repo`, release
tag, marketplace name, and plugin name after proving all manifests agree. No installer, test, generated MCP
config, or documentation may hardcode a package-plus-initial-version spec. Production `packageSpec` is
`${packageName}@${version}`; local tests use a `withPackedArtifact()` helper that creates a validated
temporary directory, runs `npm pack --pack-destination` into it, passes `file:${tarballPath}`, and removes
that directory in `finally`.
- [ ] Create the repository marketplace/plugin layout. `.agents/plugins/marketplace.json` points to
`./plugins/opnsense-mcp` and includes Codex installation/authentication policy. The Codex and Claude native
plugin manifests use name `opnsense-mcp`, the manifest-derived version, AGPL metadata, the packaged skill,
and `.mcp.json`.
`.claude-plugin/marketplace.json` uses the same marketplace/plugin names. Development rendering targets a
temporary staging tree and the packed tarball; the release renderer pins the npm package version, tag, and
root `kimi.plugin.json` identity. The root location is mandatory because Kimi installs the repository URL
as the plugin root. The Kimi manifest uses the same manifest-derived version and AGPL metadata, points only
through `./plugins/opnsense-mcp/...` paths to the packaged skill/instructions, and embeds the rendered server
entry under `mcpServers`; it never references `.mcp.json` or an unsupported `configFile`. The renderer copies
the canonical skill into every native plugin and fails on content drift.
- [ ] Make the primary Codex adapter spawn these exact locally attested command shapes, filling values from
`DistributionIdentity`: `['plugin','marketplace','add', ownerRepo, '--ref', releaseTag]`, then
`['plugin','add', pluginName + '@' + marketplaceName]`. Make the primary Claude Code adapter spawn
`['plugin','marketplace','add', ownerRepo, '--scope', 'user']`, then
`['plugin','install', pluginName + '@' + marketplaceName, '--scope', 'user']`. Claude Code `2.1.178` does
not expose a marketplace `--ref` flag, so do not invent one; its release marketplace entry pins the plugin
source to the immutable tag and exact version. Capture help/version evidence in the versions manifest and fail
before changing client state if the installed command surface differs.
- [ ] Keep direct MCP installation as `--direct-mcp` fallback for Codex/Claude/Kimi and as the sole
OpenCode MCP integration. Derive every `packageSpec`: Codex direct uses
`['mcp','add','opnsense','--env','OPNSENSE_CONFIG_FILE=' + configPath,'--','npx','-y',packageSpec]`;
Claude direct uses
`['mcp','add','--scope','user','opnsense','--env','OPNSENSE_CONFIG_FILE=' + configPath,'--','npx','-y',packageSpec]`.
OpenCode edits the documented top-level `mcp.opnsense` entry in
`~/.config/opencode/opencode.json` with `type: "local"`,
`command: ['npx','-y',packageSpec]`, `enabled: true`, and only the config-path environment entry; it must
never write the obsolete `mcpServers` shape. Use `jsonc-parser` edits so comments and unknown keys survive.
The installed CLI's interactive `opencode mcp add` is documented but is not used for unattended edits;
verify with `opencode mcp list` (or its attested `ls` alias). Doctor prints the official
`npm install -g opencode-ai` and recommended Homebrew tap choices without running either unprompted.
- [ ] Document the primary current Kimi Code command inside Kimi Code as
`/plugins install https://github.com/gabrielion/OPNSenseMCP`; do not invent a non-interactive shell
equivalent for a slash command. The installed plugin resolves `kimi.plugin.json`, its skill, and its
`mcpServers` entry from the downloaded repository root; nested-manifest discovery is not assumed. The CLI
installer's default `--client kimi` prepares the private config and returns that exact in-product command
as an incomplete next step until the user confirms the third-party source and runs `/reload` or starts a new
session and `doctor` then observes the plugin; it must not claim installation success. Its
`--client kimi --direct-mcp` fallback edits the current user file
`~/.kimi-code/mcp.json`, preserving unknown keys while adding
`mcpServers.opnsense = { command: "npx", args: ["-y", packageSpec], env: {
OPNSENSE_CONFIG_FILE: configPath }, enabled: true }`. Test the project override at
`.kimi-code/mcp.json` separately without modifying it during a user-level install. Explicitly reject the
phasing-out Python `kimi-cli`, `~/.kimi`, and `kimi mcp add` paths.
- [ ] On native Windows, derive the executable array
`['cmd','/d','/s','/c','npx','-y',packageSpec]` and test quoting with a config path containing spaces.
Doctor requires Node.js `>=22.19 <23`, prints official install choices, and never installs a client without
interactive consent.
- [ ] Before adding a marketplace, plugin, or named `opnsense` MCP entry, classify it as absent,
exact-owned, or collision. Fail on collision. Codex/Claude uninstall uses their plugin removal commands and
removes a marketplace only when the installer owns it; never edit a plugin cache. OpenCode/Kimi uninstall
removes exact-owned direct entries only; Kimi native plugin uninstall follows the current `/plugins` flow.
Native plugins own the Codex/Claude/Kimi skill. For direct OpenCode/Kimi installations, copy the packaged
pedagogical file to the current documented client location and preserve a user-modified copy by comparing
its installed hash.
- [ ] Validate real manifests, not hand-written lookalikes. In isolated homes, have the test harness pass
its validated `stagingRoot` to the pinned Codex CLI's official `plugin marketplace add` plus `plugin add
opnsense-mcp@opnsense-mcp` ingestion path (the locally attested Codex build has no standalone `plugin
validate` command), and run `claude plugin validate --strict` on both the plugin and marketplace root before
local marketplace add/install. Clone a local Git fixture with root `kimi.plugin.json`, validate it with the
pinned current Node-based Kimi Code package, and execute a real isolated native plugin install of that
fixture; a nested-only manifest fixture must fail. Require successful MCP listing
from every installed plugin. At release, repeat against the immutable repository tag rather than a
working-tree path.
- [ ] Populate `tests/clients/versions.json` with `clients` and `testTools` rows. Every row records executable,
exact version output, package or release URL, verification date, artifact SHA-256, and source integrity.
Include exact MCP Inspector and `mcp-publisher` versions, not floating `npx`/download commands. The current
workstation evidence is Codex CLI `0.145.0-alpha.18` and Claude Code CLI `2.1.178`; OpenCode `1.18.3` was
observed only as a desktop application while the `opencode` CLI is absent, so it is explicitly
unverified/not a support claim; current Kimi Code is also absent. Candidate-release CI must install and hash
exact official `opencode-ai` and Node-based `@moonshot-ai/kimi-code` artifacts, replace those rows with
verified CLI evidence, and permit no missing row. The versions test rejects any legacy Python `kimi-cli`
source or `~/.kimi` path.
- [ ] Against a sentinel mock server, run each pinned client's native MCP status/list path and require a
successful handshake; additionally run `opencode run --format json` and require one real
`diagnose_network_problem` call. Never use a firewall credential. Run
`npx vitest run tests/installers && node tests/clients/smoke.mjs --installed-only && npm run typecheck`;
local discovery may explicitly skip only absent binaries, while dedicated release jobs permit no skip.
- [ ] Commit:

```bash
git add src/config src/cli src/installers .agents .claude-plugin plugins kimi.plugin.json scripts/distribution skills/opnsense-guide package.json tests/installers tests/clients
git commit -m "feat: install OPNsense MCP in four coding clients"
```

### Task 7: Package npm and MCP Registry distribution

**Files:** Create `server.json`,
`scripts/release/{check-namespaces,validate-package,validate-plugins,verify-remote-clients,publish}.mjs`, and
`tests/release/{package,names,distribution}.test.ts`; modify `package.json`,
`tests/clients/versions.json`, the Task 6 distribution manifests, and `.github/workflows/ci.yml`.

- [ ] Write failing package and naming tests requiring name `@gabrielion/opnsense-mcp`, version `0.1.0`,
`mcpName: "io.github.gabrielion/opnsense-mcp"`, `type: "module"`, engine
`">=22.19 <23"`, public access, sole bin `opnsense-mcp`, and a files allow-list containing only runtime
output, README, AGPL license, skill, and `server.json`. Derive expected versioned specs from the manifest.
Scan runtime, generated distribution, installers, plugin content, and user docs for the global forbidden
legacy-name set while excluding the gate's own fixture; fail on any emitted previous package, executable,
launcher, or skill alias.
- [ ] Add a failing distribution-doc test for the exact non-affiliation/trademark notice in README, the
packed npm README/package-facing metadata, and MCP Registry-facing metadata. It must use the canonical
project name consistently and reject any statement that the project has legal clearance, OPNsense/Deciso
affiliation, endorsement, or official status.
- [ ] Require `server.json` schema
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`, the same name/version,
GitHub repository `https://github.com/gabrielion/OPNSenseMCP`, npm package transport `stdio`, and only the
non-secret optional `OPNSENSE_CONFIG_FILE` override because the executable also resolves the documented
platform default. Require the npm, MCP Registry, Codex, Claude, and Kimi manifests to agree exactly on package,
version, repository, executable, plugin, and skill identities, and to resolve to the same AGPL license
without adding fields rejected by an official schema.
- [ ] Run `npx vitest run tests/release/package.test.ts tests/release/names.test.ts tests/release/distribution.test.ts`; expect FAIL until metadata, generated distribution coherence, and validation scripts exist.
- [ ] Implement `check-namespaces.mjs` to verify npm authentication and ownership of `@gabrielion`, query the exact npm name, query the exact MCP Registry name, and fail on an unexpected owner or occupied incompatible record. It must never silently rename either identifier.
- [ ] Implement `validate-package.mjs` with `mkdtemp` and `try/finally`: clean build; run
`npm pack --json --pack-destination packRoot` through a no-shell argument array, where `packRoot` is the
validated `mkdtemp` result, so no tarball lands in the repository;
extract there; inspect the allow-list and AGPL metadata/headers; scan for secrets and backup XML; install the
exact tarball in a second empty temp project; start stdio; list capabilities/prompts; run the exact hashed
MCP Inspector and `mcp-publisher validate server.json` tools from `tests/clients/versions.json`; then remove
only the validated temp roots in `finally`. Add injected-failure tests at pack, extract, install, handshake,
and publisher validation boundaries and assert cleanup every time.
- [ ] Implement `validate-plugins.mjs` to render a temporary development distribution from that packed
tarball, run the pinned Codex marketplace-add/plugin-add ingestion in an isolated home, and run the pinned
Claude `plugin validate --strict`, marketplace-add, and plugin-install flow in a separate isolated home,
then validate/install the Kimi native plugin with the exact pinned `@moonshot-ai/kimi-code` artifact.
Check that all three list the same MCP tools and packaged skill, then clean their homes in `finally`. The
committed release manifests pin the exact package version and immutable tag name only; they must not embed a
commit SHA that cannot exist until the evidence commit and signed tag are created. Pre-tag release validation
proves that every rendered source resolves from the anticipated tag name and package version without a
floating ref. After tag creation, the release validator resolves the signed tag locally, verifies its full
target commit SHA is the current evidence commit, and verifies every tag-pinned manifest from those resolved
bytes without rewriting a manifest.
- [ ] Implement `publish.mjs` as dry-run by default and as three explicit resumable execute phases; there is
no one-shot execute mode. Every phase revalidates the clean signed tag, exact HEAD, namespace/name/license,
plugin/package checks, hashes, and immutable manifests and prints the irreversible action before doing it:
  1. `--execute --phase git` pushes the evidence commit and signed tag, then reads the remote GitHub tag back
     and requires its peeled commit SHA to equal HEAD;
  2. `--execute --phase npm` requires that verified remote tag, runs
     `spawn('npm', ['publish', tarballPath, '--access', 'public'])`, and verifies the exact immutable package
     through `npm view` plus a clean install;
  3. `--execute --phase registry` requires the separately signed remote-client attestation described below,
     authenticates the pinned `mcp-publisher`, publishes the Registry record, and verifies the Registry API.
The script never downloads an unpinned latest tool. It writes resumable operational state only outside the
repository and binds it to tag, HEAD, package hash, manifest hash, and tool hashes; a mismatch refuses the
next phase. Local pre-push plugin validation resolves the signed tag through an isolated local bare-repository
fixture, not GitHub.
- [ ] Implement `verify-remote-clients.mjs --execute` as the mandatory command between npm and Registry
phases. It loads the phase state, verifies the remote Git tag and exact npm artifact again, creates clean
isolated homes, and runs the exact pinned Codex, Claude, Kimi and OpenCode install/handshake checks. It writes
canonical `remote-client-attestation.json` only to the external operational state directory, binding full
HEAD, signed tag object and peeled commit, package/tarball/manifest/tool hashes, exact client versions,
commands as redacted argument arrays, exit results, and timestamp. Sign that JSON with the same configured
operator identity used for the Git tag (support Git's OpenPGP or SSH signing modes; fail closed for an
unsupported/unverifiable signer), then immediately verify the detached signature. Inject signer/verifier and
client runners in tests; never log private signing material. Registry phase re-verifies the signature and
every binding and refuses stale, copied, unsigned, partially successful, or differently hashed evidence.
- [ ] Run `npx vitest run tests/release && node scripts/release/validate-package.mjs && node scripts/release/validate-plugins.mjs && npm run license:check && git diff --check`; expect PASS without publishing and with no tarball or temporary plugin home left in the repository.
- [ ] Commit `git add package.json server.json scripts/release tests/release tests/clients/versions.json .agents .claude-plugin plugins kimi.plugin.json .github/workflows/ci.yml && git commit -m "build: prepare npm, plugin, and MCP Registry distribution"`.

### Task 8: Make local development and user documentation immediate

**Files:** Create `scripts/{bootstrap,doctor,test}`, `docs/{clients,workflows,security}.md`,
`scripts/docs/validate-claims.mjs`, and `tests/docs/claims.test.ts`; modify the independently authored
`README.md` and `CONTRIBUTING.md`, the phase-scoped `tests/foundation/documentation.test.ts`, plus
`AGENTS.md`, `CLAUDE.md`, `docs/testing.md`, `docs/release.md`, and the provenance-approved
`tests/smoke/claude-doc-consistency.mjs`.

- [ ] Write failing tests that require the first bytes of `CONTRIBUTING.md` to be the fenced commands
`./scripts/bootstrap`, `./scripts/doctor`, and `./scripts/test`; derive every README package, plugin,
marketplace, version, and tag command from committed manifests; require the primary Codex/Claude
marketplace commands plus labeled direct-MCP fallbacks; reject forbidden legacy names, benchmark numbers
without a committed canonical report, external-network claims, or missing/inconsistent non-affiliation and
trademark language. Extend
`tests/smoke/claude-doc-consistency.mjs` to compare `AGENTS.md`, `CLAUDE.md`, README, docs, package scripts,
and all three native plugin manifests for exact commands and guardrails. In the same failing-test commit,
modify or remove every foundation-only documentation assertion that would reject the now-implemented
firewall capabilities; the README/CONTRIBUTING rewrite must never leave a stale no-mutation contract.
Add a bootstrap process-seam test that records every spawned executable and argument separately and requires
the dependency install call to be exactly `npm` with `['ci', '--ignore-scripts']`. Reject `npm install`,
plain `npm ci`, `--foreground-scripts`, shell-string execution, and any second npm dependency-install
invocation. This restriction does not forbid the separately confirmed `brew`/`apt-get` host-package
installation behind `--install-host-deps`.
- [ ] Run:

  ```bash
  if test -x /opt/homebrew/opt/node@22/bin/node; then
    export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  fi
  node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
  npx --no-install vitest run tests/docs/claims.test.ts
  node --test tests/smoke/claude-doc-consistency.mjs
  ```

  Expect FAIL because the immediate-start contract, agent-guide revisions, generated install commands,
  evidence sections, and foundation-to-product contract handoff are not yet coherent.
- [ ] Implement `bootstrap` to require Node `>=22.19 <23`, run exactly
`npm ci --ignore-scripts`, create pinned Python environments,
verify every client/test-tool artifact against `tests/clients/versions.json`, and detect QEMU plus client
CLIs. On macOS print the exact missing `brew install qemu coreutils` command; on Debian/Ubuntu print
`sudo apt-get install qemu-system-x86 qemu-utils ovmf curl jq`. Install host packages only after
interactive confirmation with `--install-host-deps`.
- [ ] Implement `doctor` as read-only checks for runtime versions, virtualization, image cache, POSIX
permissions or native Windows ACLs, disposable VM state, clients, npm identity, pinned Inspector, and
Registry publisher. Redact secrets. Implement `test` with offline default and explicit `--vm`, `--clients`,
`--agentic`, and `--all` layers. Every VM-dependent layer delegates to
`npm run vm:with -- npm run test:vm`; neither the script nor docs may spell a raw
provision/test/stop chain, and the wrapper's `finally` owns residue verification and stop.
- [ ] Write a high-level README with manifest-generated one-command install tabs. For the first release,
Codex shows `codex plugin marketplace add gabrielion/OPNSenseMCP --ref v0.1.0` then
`codex plugin add opnsense-mcp@opnsense-mcp`; Claude Code shows
`claude plugin marketplace add gabrielion/OPNSenseMCP --scope user` then
`claude plugin install opnsense-mcp@opnsense-mcp --scope user`, with its marketplace entry visibly pinned to
the release tag/version. Kimi Code shows `/plugins install https://github.com/gabrielion/OPNSenseMCP`,
the third-party confirmation, then `/reload` (or a new session); OpenCode shows its native top-level `mcp`
configuration plus `opencode mcp list` verification. Codex,
Claude, and Kimi direct MCP configuration is labeled fallback. Include these natural-language examples: publish Paperless internally at
`https://documents.home.arpa`; block `tiktok.com` only on the living-room tablet; and “Internet est lent sur
mon ordinateur, regarde sans rien modifier et explique-moi simplement.” Explain read-only default and
strict backup before every write near the first example.
- [ ] Put the exact global non-affiliation/trademark notice in the high-level README and package/Registry
documentation sections, without calling it legal review or legal clearance. The docs coherence test checks
the same canonical `OPNsense MCP` spelling everywhere user-facing.
- [ ] Add concise “Tested today”, “Not claimed yet”, and “Roadmap” sections. Link machine-readable evidence. State that the local VM proves OPNsense configuration, internal DNS, internal certificate, HAProxy, backend, cleanup, and client connection only; it does not prove public exposure. Include no benchmark score until Task 9 commits one.
- [ ] Put detailed primary/fallback client commands and uninstall behavior in `docs/clients.md`,
prepare/preflight/apply/recovery in `docs/workflows.md`, wrapped VM/conformance/agentic layers in
`docs/testing.md`, safety boundaries in `docs/security.md`, and immutable package/plugin/tag release steps
in `docs/release.md`. Revise `AGENTS.md` and `CLAUDE.md` with the same Node range, Vitest commands, single
VM wrapper, preflight-before-backup boundary, AGPL/name gates, evidence limitations, and no-push rule.
- [ ] Run:

  ```bash
  if test -x /opt/homebrew/opt/node@22/bin/node; then
    export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  fi
  node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
  ./scripts/bootstrap
  ./scripts/doctor
  ./scripts/test
  npx --no-install vitest run tests/docs/claims.test.ts
  node --test tests/smoke/claude-doc-consistency.mjs
  npm run license:check
  git diff --check
  ```

  Expect PASS, with doctor clearly labeling unavailable optional live layers, the coherence test reporting
  no drift, and the foundation-only documentation contract replaced or removed rather than weakened around
  a stale no-mutation claim.
- [ ] Commit:

  ```bash
  git add \
    scripts/bootstrap scripts/doctor scripts/test scripts/docs/validate-claims.mjs \
    README.md CONTRIBUTING.md AGENTS.md CLAUDE.md \
    docs/clients.md docs/workflows.md docs/security.md docs/testing.md docs/release.md \
    tests/docs/claims.test.ts tests/foundation/documentation.test.ts \
    tests/smoke/claude-doc-consistency.mjs
  git commit -m "docs: simplify setup workflows and test evidence"
  ```

### Task 9: Prove workflows, run the canonical benchmark, and release

**Files:** Modify the provenance-approved `tests/agentic/deepeval/run_eval.py`,
`tests/agentic/model-config.json`, `tests/agentic/ground-truth.csv`, and `tests/vm/` workflow harness;
create `tests/agentic/deepeval/test_workflow_oracles.py`,
`tests/release/installed-runtime.test.mjs`,
`scripts/provenance/generate-release-audit.mjs`, and
`tests/provenance/release-audit.test.mjs`. In the final evidence-only commit, create
`tests/agentic/attestations/v0.1.0/report.json` and
`tests/agentic/attestations/v0.1.0/redacted-tool-trace.jsonl`, and modify only the generated evidence block
in `README.md`, the reviewed README row in `docs/provenance/migration-manifest.json`, and generated
`docs/provenance/release-audit.json`. `docs/testing.md` is finalized in Task 8 and is not part of the evidence
delta. Do not add a second TypeScript evaluation runner beside the migrated Python harness.

- [ ] Write failing oracle tests for both profiles. `interactive-pedagogy` starts underspecified, requires one clarification with zero mutation, then preparation, then a separate explicit apply turn. `operator-preauthorized` still requires a prepared token. Cover successful create/verify/remove for internal publication, block/verify/remove for one device, and simple read-only diagnosis. Require cleanup predicates proving absence.
- [ ] Set `tests/agentic/model-config.json` initially to
`{"default_model":"sonnet","allowed_models":["sonnet","opus","haiku"],"default_effort":"medium"}`.
Treat the model values as Claude Code selectors, never as exact model identities. Preserve the migrated
`--model`, `--only`, `--checkpoint`, and `--attestation-out` behavior and add repeatable `--profile` values
`interactive-pedagogy` and `operator-preauthorized`; validate every selector, resolve and record the exact
provider/model identity reported by the CLI for every run, and make a canonical run fail if that identity
cannot be attested. It also rejects model mixing, a dirty start tree, missing setup/cleanup, or residue.
Capacity/quota stops with exit `3` and resumes only with the same commit, hashes, selector, resolved model,
CLI, profiles, and checkpoint. README benchmark automation uses the `sonnet` selector by default unless the
operator explicitly selects and labels another model.
- [ ] Record commit SHA, dirty state, firmware, exact model and CLI/client versions, dataset/harness/catalog/registry hashes, per-turn tool inputs, SHA-256 result digests, setup/cleanup outcomes, residue, wall time, token/cost totals, and checkpoint lineage. Generate a redacted public tool trace with inputs, capability names, outcome summaries, and result digests so README readers can inspect representative calls. Never record secrets, private keys, raw firewall responses, or backup content.
- [ ] Run `python3 -m unittest discover -s tests/agentic/deepeval -p
  'test_workflow_oracles.py'`; expect FAIL before the dataset rows and runner support, then PASS after minimal
implementation. Rerun the full migrated Python harness suite to prove existing checkpoint, hygiene, metric,
predicate, and attestation behavior did not regress. Commit these implementation inputs before any canonical
run:

```bash
git add tests/agentic/deepeval tests/agentic/model-config.json tests/agentic/ground-truth.csv tests/vm \
  tests/release/installed-runtime.test.mjs scripts/provenance/generate-release-audit.mjs \
  tests/provenance/release-audit.test.mjs
git commit -m "test: add guided workflow evaluation profiles"
```

- [ ] Before freezing the tested parent, re-evaluate the stable official MCP SDK. If stable `2.0.0` is
available, pin it exactly. A beta dependency blocks a stable release unless a written exception is approved
and the version is explicitly prerelease. Render package and plugin manifests from the package version and
anticipated immutable release tag; never type a versioned npm spec by hand. Obtain independent review of
every final approved destination and all three independently rewritten destinations, recording each expected
digest in the private baseline only after review. Then run `npm run provenance:build:release`, `npm run
provenance:scan:release`, `npm run workflow-contract:validate`, and `npm run workflow-runtime:validate`;
require exactly 105
`approved-migrated`, 3 `independently-rewritten`, and 8 `discarded` rows. Commit every SDK, generated
manifest, reviewed provenance, workflow evidence, or documentation change now. After this point, any
non-evidence change invalidates the candidate and restarts the review, sealing, and gates.
- [ ] On that clean candidate parent, run offline and protocol gates: `./scripts/test`, all five committed
applicable official MCP scenarios for the supported 2025 and 2026 protocol versions, the exact hashed MCP
Inspector CLI smoke, `node scripts/release/validate-package.mjs`,
`node scripts/release/validate-plugins.mjs`, `npm run provenance:verify`, secret scan,
dependency/license/name review, and `git diff --check`. Every command must exit `0`; evidence must call this
targeted interoperability and must not claim the complete artificial-fixture suite.
- [ ] Pack the exact candidate, install the tarball into a fresh temporary directory, and run
`tests/release/installed-runtime.test.mjs` against the repository mock OPNsense with sentinel credentials.
Through the installed `opnsense-mcp` binary, require stdio and authenticated loopback HTTP to expose the same
read-only exposed subset derived from the reviewed product-plus-nine-workflow catalog, three resources, three
prompts, read-only default, and working `server_status` plus one product read. Inspect the opaque
application's safe catalog reference (or the generated reviewed contract resource) separately to require the
complete exact union, including hidden writes. Launch HTTP only as `opnsense-mcp http` with sentinel
MCP_HTTP environment; the command accepts no token argument. Assert every write is absent from `tools/list`,
the Foundation-only and Product-only default factories are unreachable, cleanup is idempotent, stdout is
protocol-clean, and no packed file/output contains a sentinel secret. This test is mandatory inside
`validate-package.mjs`, not an optional client smoke.
- [ ] Run `./scripts/test --clients`; require all four exact client artifacts and test tools to match
`tests/clients/versions.json`, all three isolated local candidate native plugin installs to succeed, all four handshakes,
and the real OpenCode end-to-end tool call. OpenCode's desktop-only `1.18.3` observation is insufficient; a
missing or unverified CLI is a release failure, not a skip.
- [ ] Run every live test through the shared wrapper, one managed VM at a time:

```bash
npm run vm:with -- npm run test:vm -- --only internal-service
npm run vm:with -- npm run test:vm -- --only device-domain
npm run vm:with -- npm run test:vm
```

Each workflow registers inverse fixture cleanup before mutation; `vm:with` independently verifies residue
and stops the VM in `finally`, aggregates primary and cleanup/stop failures, and leaves no credential or
fixture in the repository. No raw `vm:provision`, manual stop, or shell `&&` lifecycle appears in a release
command.
- [ ] With the worktree still clean, run the complete benchmark once through the same wrapper with the
default `sonnet` selector and both repeatable profiles, using checkpoint resume only after exit `3`:

```bash
test -n "${OPNSENSE_RELEASE_EVIDENCE_DIR:-}"
npm run vm:with -- tests/agentic/deepeval/.venv/bin/python tests/agentic/deepeval/run_eval.py --profile interactive-pedagogy --profile operator-preauthorized --attestation-out "$OPNSENSE_RELEASE_EVIDENCE_DIR/report.json" --checkpoint "$OPNSENSE_RELEASE_EVIDENCE_DIR/checkpoint.jsonl"
```

Record the exact resolved model rather than guessing it in source. Reject any run with setup,
expected-call, verification, cleanup, residue, wrapper cleanup, or stop failure. The report's tested commit
must equal the clean `HEAD` at run start and must later be the immediate parent of the evidence commit. The
runner validates that `OPNSENSE_RELEASE_EVIDENCE_DIR` is a private directory outside the repository and
never prints its path or checkpoint content.
- [ ] Generate the public report and redacted trace from the external result, then update only README's
machine-delimited generated evidence block. Before committing, require
`git diff --name-only` to contain exactly
`tests/agentic/attestations/v0.1.0/report.json`,
`tests/agentic/attestations/v0.1.0/redacted-tool-trace.jsonl`, and `README.md` before provenance generation;
a structural README test rejects changes outside that block. Independently review the final README bytes,
record only that expected digest in the private baseline, run `npm run provenance:build:release`, and require
the manifest diff to change only the README rewrite row's digest while retaining verdict
`independently-rewritten`. Generate `docs/provenance/release-audit.json` without caller-supplied hashes. The
generator must load and hash the committed `docs/provenance/migration-audit.json`, prove that its recorded
base revision and candidate digest still bind the completed source migration, and require its
`sourceMigrationEligible` verdict. It then binds that migration-audit digest, the tested parent,
report/trace digests, final manifest digest, and the exact evidence candidate. Because the release-audit
file cannot hash itself, define the candidate digest over the other four allowed evidence paths only
(`report.json`, `redacted-tool-trace.jsonl`, `README.md`, and `migration-manifest.json`); after generation,
the validator hashes the release-audit bytes separately and verifies the five-path staged set. Run its
adversarial schema/redaction/binding test and `npm run provenance:scan:release`. The report records its parent
commit, dirty-start `false`, both profiles, and all required hashes/evidence.
- [ ] Commit only the evidence delta:

```bash
git add tests/agentic/attestations/v0.1.0/report.json \
  tests/agentic/attestations/v0.1.0/redacted-tool-trace.jsonl \
  README.md docs/provenance/migration-manifest.json docs/provenance/release-audit.json
git commit -m "test: attest first guided workflow benchmark"
```

The release validator must prove `report.testedCommit === HEAD^`, the evidence commit touches exactly those
five paths, the README diff is confined to its generated block, the manifest diff is confined to the
re-reviewed README row, and the generated release audit binds the committed migration-audit digest, the
four-input evidence-candidate digest that explicitly excludes the release-audit output, and the separately
computed final release-audit digest. Then run
`node scripts/docs/validate-claims.mjs && node scripts/release/check-namespaces.mjs && node
scripts/release/validate-package.mjs && node scripts/release/validate-plugins.mjs && npm run
workflow-contract:validate && npm run workflow-runtime:validate && npm run provenance:scan:release`; require the report
hashes, package, Registry metadata, AGPL declaration, plugin tag/version, name gate, and Git tree to agree
exactly.
- [ ] After explicit operator authorization, create signed tag `v0.1.0` at the evidence commit. Verify that
the diff from the attested parent to the signed tag is still only the report, redacted trace, and generated
README evidence block plus the narrowly scoped manifest and release-audit updates. Resolve that signed tag
through an isolated local bare-repository fixture and rerun every plugin/package test against the packed
artifact. Inspect `node scripts/release/publish.mjs` dry-run output, then execute the irreversible phases in
dependency order:

```bash
node scripts/release/publish.mjs --execute --phase git
node scripts/release/publish.mjs --execute --phase npm
node scripts/release/verify-remote-clients.mjs --execute
node scripts/release/publish.mjs --execute --phase registry
```

After the Git phase, require the GitHub tag's peeled SHA to equal the local signed tag. After npm, verify the
exact-version clean install, then verify Codex `marketplace add --ref v0.1.0` plus plugin add, Claude
marketplace/plugin install resolving the pinned tag/version, Kimi native plugin install from that tag, and
clean-room OpenCode native-MCP plus Kimi direct-MCP fallback. A remote client failure stops before Registry
publication and is reported as a partial release requiring correction/new version; never move or overwrite
the published tag/package. Registry lookup is verified only after the final phase.

Release is complete only when complete parity, deterministic tests, the named applicable official MCP
protocol scenarios, four client handshakes, OpenCode end-to-end execution, disposable-VM
configuration/readback/cleanup, both agentic profiles, provenance, secrets, dependencies, license and
trademark-disclaimer checks,
package inspection, namespace ownership, and documentation claims all pass with committed evidence.
