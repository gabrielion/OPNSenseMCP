# BLOCKED / SUPERSEDED — DO NOT EXECUTE

> **Hard stop:** This plan is superseded and must not be executed task by task. Its useful requirements are
> inputs to the rewrite, not executable instructions. Product and Guided plans must first be rewritten
> against `docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md` and
> `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md`, then independently reviewed.
> Product Task 1 must not start until that checkpoint is complete.
> Replacement routing now lives in
> `docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md`. The content below remains historical input
> and is not the Product 1A implementation plan.

# OPNsense Product Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the independently reviewed public OPNsense product contract behind the MCP v2 capability catalog and closed policy kernel, with independently implemented runtime code and executable evidence for every declared behavior.

**Architecture:** A versioned, independently reviewed public contract is the normative source for exact capability names, policy, feature flags, resource scopes, and mutation lifecycle requirements. A small OPNsense HTTPS client feeds a generated typed resource catalog and one generic CRUD engine; curated domain capabilities compose the same client and safety contracts for behavior that cannot be expressed by the catalog. A separate mutable evidence manifest links the immutable contract to offline, disposable-VM, and agentic evidence.

**Tech Stack:** Node.js 22.19 or newer within major 22, strict TypeScript ESM, Zod 4, MCP TypeScript v2 beta.4 adapters supplied by the foundation plan, Vitest, disposable OPNsense 26 VM, existing provenance-approved VM and agentic harnesses.

## Global Constraints

- Project license is `AGPL-3.0-or-later`.
- Use Node.js 22.19 or newer within major 22 in development and CI.
- Import MCP types only through the adapter interfaces created by the foundation plan.
- Never copy mixed-lineage production code; implement behavior from public OPNsense contracts, black-box observations, and provenance-approved tests.
- `READ_ONLY=true` is the default and every OPNsense configuration mutation requires a strict pre-change backup.
- Never place credentials in process arguments, logs, audit records, fixtures, or MCP results.
- Use only the disposable managed OPNsense VM for live operations.
- Preserve all 96 typed OPNsense resources and exactly the capabilities in the reviewed public contract.
- Foundation's temporary `advanced-api` fixture vocabulary exists only before Product Task 5. Product Task 5
  atomically replaces it with distinct `raw-api`, `configure`, and `iac` flags (plus `restore`, `shell`, and
  `ssh`) before any advanced product capability exists; no released product configuration accepts the
  aggregate value.
- An unsupported or unclassified mutation fails closed; a mutation without an exact resolved resource scope
  is refused whenever `ALLOWED_RESOURCES` is active.
- Construct domain capability definitions through `createProductCatalog(dependencies)`. Handlers close over
  typed injected services; they never import a mutable singleton client, filesystem service, or global
  application context.
- Every task uses TDD and ends in an atomic local commit. Do not push.

## Planned file structure

```text
src/
  opnsense/
    client.ts                 # HTTPS boundary, auth, TLS, retry, abort and response normalization
    errors.ts                 # Sanitized domain error hierarchy
    types.ts                  # Public request/result interfaces
    catalog/
      schema.ts               # ResourceDefinition and command schemas
      resources.data.ts       # Reviewed generated data for all typed resources
      resources.ts            # Validated catalog loader and lookup
    generic/
      service.ts              # List/get/search/create/update/delete/apply/service operations
      schemas.ts              # Generic operation input/output Standard Schemas
  features/
    network/                  # Interface, VLAN, DHCP, ARP and diagnostics capabilities
    firewall/                 # Rules, aliases, NAT and policy capabilities
    dns/                      # Unbound, Dnsmasq and blocklist capabilities
    proxy/                    # HAProxy capabilities
    certificates/             # Trust and ACME capabilities
    monitoring/               # Monit and service-status capabilities
    backup/                   # Snapshot metadata, storage and restore capabilities
    ssh/                      # Fixed parameterized SSH-backed configuration gaps
    advanced/                 # Explicitly gated raw API, legacy shell and IaC capabilities
docs/contracts/
  opnsense-product.v1.json        # Normative reviewed capability/resource contract
  opnsense-product.v1.sha256      # Public SHA-256 over the exact contract bytes
  opnsense-product.v1.review.json # Public independent-review record bound to the digest
tests/
  contract/                   # Deterministic client/catalog/domain tests
  evidence/
    opnsense-product-evidence.json # Mutable paths and attestation IDs; never normative
  integration/                # Full MCP-to-mock tests
  vm/                         # Live OPNsense read/write/readback/cleanup tests
scripts/contracts/
  validate-opnsense-product.mjs # Exact contract/digest/review/runtime/evidence validator
```

## Shared interfaces

The following interfaces are fixed for all tasks in this plan:

```ts
export interface OPNsenseRequest {
  method: 'GET' | 'POST';
  path: `/api/${string}`;
  body?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
  operationTimeoutMs?: number;
}

export interface OPNsenseResponse<T> {
  readonly status: number;
  readonly data: T;
  readonly requestId?: string;
}

export interface OPNsenseClient {
  request<T>(request: OPNsenseRequest): Promise<OPNsenseResponse<T>>;
  close(): Promise<void>;
}

export type ResourceCommand =
  | 'search'
  | 'get'
  | 'add'
  | 'set'
  | 'del'
  | 'toggle';

export interface ResourceDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly module: string;
  readonly controller: string;
  readonly wrapper: string;
  readonly commands: Readonly<Partial<Record<ResourceCommand, string>>>;
  readonly applyPath?: `/api/${string}`;
}

export interface GenericOperationResult<T = unknown> {
  readonly resource: string;
  readonly operation: 'list' | 'get' | 'create' | 'update' | 'delete' | 'apply' | 'service';
  readonly ok: boolean;
  readonly changed: boolean;
  readonly applied?: boolean;
  readonly id?: string;
  readonly value?: T;
}

```

Tasks 1–4 compile using only the interfaces above and the completed Foundation exports. Task 5 introduces
`ProductDependencies`, `PolicyRuntimeDependencies`, the product catalog/context factories, sealed preflight,
dynamic scope resolution, and mutation execution metadata before the first product mutation capability is
defined. Tasks 6–12 consume those exact Task 5 exports; earlier tasks have no mutation context field.

### Task 1: Publish the independently reviewed product contract

**Files:**
- Create: `docs/contracts/opnsense-product.v1.json`
- Create: `docs/contracts/opnsense-product.v1.sha256`
- Create: `docs/contracts/opnsense-product.v1.review.json`
- Create: `tests/evidence/opnsense-product-evidence.json`
- Create: `scripts/contracts/validate-opnsense-product.mjs`
- Create: `tests/contract/product-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the Foundation policy/feature-flag vocabulary only, public OPNsense documentation, and recorded
  observations from the disposable managed VM. It must not consume an existing implementation's listing,
  registry, policy table, snapshots, or executable tests as the source of truth.
- Produces: immutable `opnsense-product.v1.json`, its public digest and independent-review record; mutable
  `opnsense-product-evidence.json`; `validateProductContractFiles()`; and
  `validateRuntimeContract(catalog, contract, evidence, options?)` for later release gates. Define exact
  `RuntimeContractValidationOptions` fields `requireEvidenceFiles: boolean` and
  `reviewedExtensions: readonly ReviewedContractExtension[]`; each extension value contains its parsed
  immutable contract, SHA-256, independent review, and evidence manifest. An extension may add capabilities
  but cannot redefine the 96 resources or collide with a base/extension MCP name. The pure validator never
  discovers files implicitly; CLI wrappers may discover only schema-valid reviewed extension bundles and
  pass them explicitly.

- [ ] **Step 1: Write the failing contract, digest, review, and lifecycle tests**

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import contract from '../../docs/contracts/opnsense-product.v1.json' with { type: 'json' };
import evidence from '../evidence/opnsense-product-evidence.json' with { type: 'json' };
import {
  validateProductContractData,
  validateProductContractFiles
} from '../../scripts/contracts/validate-opnsense-product.mjs';

describe('reviewed OPNsense product contract', () => {
  it('has an exact public digest, independent approval, and 96 resources', async () => {
    const result = await validateProductContractFiles({
      contractPath: 'docs/contracts/opnsense-product.v1.json',
      digestPath: 'docs/contracts/opnsense-product.v1.sha256',
      reviewPath: 'docs/contracts/opnsense-product.v1.review.json',
      evidencePath: 'tests/evidence/opnsense-product-evidence.json'
    });
    expect(result).toMatchObject({ errors: [], resourceCount: 96 });
    expect(result.contractSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile('docs/contracts/opnsense-product.v1.sha256', 'utf8')).toBe(
      `${result.contractSha256}  opnsense-product.v1.json\n`
    );
  });

  it('requires a lifecycle or independently reviewed irreversible exclusion for every firewall write', () => {
    const firewallWrites = contract.capabilities.filter(
      (row) => row.policy.effect === 'firewall-write'
    );
    expect(firewallWrites.length).toBeGreaterThan(0);
    for (const row of firewallWrites) {
      expect(['lifecycle', 'reviewed-exclusion']).toContain(row.vmRecipe.mode);
    }

    const target = firewallWrites.at(-1);
    if (target === undefined) throw new Error('Expected at least one firewall write');
    const rowIndex = contract.capabilities.findIndex((row) => row.mcpName === target.mcpName);
    const malformed = structuredClone(contract) as unknown as Record<string, unknown>;
    const rows = structuredClone(contract.capabilities) as unknown as Array<Record<string, unknown>>;
    const row = rows[rowIndex];
    if (row === undefined) throw new Error(`Missing cloned row: ${target.mcpName}`);
    rows[rowIndex] = { ...row, vmRecipe: undefined };
    malformed.capabilities = rows;
    expect(validateProductContractData(malformed, evidence).errors).toContain(
      `missing vmRecipe: ${target.mcpName}`
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run: `npm test -- tests/contract/product-contract.test.ts`

Expected: FAIL because the contract, digest, review, evidence manifest, and validator do not exist.

- [ ] **Step 3: Author and independently review the normative public contract**

Create strict JSON rows with this shape; every property shown is required and unknown properties fail
validation. `policy.resourceScopes` is the exact static set or, for a parsed resolver, the exact allowed upper
bound. The only valid feature flags are `raw-api`, `configure`, `iac`, `restore`, `shell`, and `ssh`.
The three advanced surfaces remain distinct so one opt-in never grants another.

```json
{
  "schemaVersion": 1,
  "firmware": { "family": "OPNsense", "major": 26 },
  "capabilities": [
    {
      "id": "server.status",
      "mcpName": "server_status",
      "defaultExposure": true,
      "policy": {
        "effect": "read",
        "resourceScopes": ["server.status"],
        "requiredFeatureFlags": [],
        "backup": "none",
        "audit": "none",
        "confirmation": "none",
        "timeoutMs": 1000,
        "redactFields": []
      },
      "scopeResolver": null,
      "vmRecipe": {
        "mode": "read-probe",
        "fixture": "server-status",
        "verify": ["status-is-ok", "read-only-state-matches"]
      }
    }
  ],
  "resources": []
}
```

For a dynamic generic capability, set `scopeResolver` to the exact declarative recipe
`{ "kind": "resource-input", "inputField": "resource" }` and list every permitted registry scope in
`policy.resourceScopes`; the Task 5 sealed resolver must return a non-empty subset of that list after Zod
parsing. A static capability uses `scopeResolver: null`.

Author the rows from public OPNsense API behavior and fresh disposable-VM observations. Record observation
commands without credentials. A reviewer who did not author the artifact checks every capability name,
Foundation policy field, flag, resource scope, endpoint recipe, and exclusion. Commit a public strict review
record containing `schemaVersion`, `contractSha256`, distinct non-empty `authorId` and `reviewerId`,
`decision: "approved"`, `reviewedAt`, and a non-empty array of public source references. The validator rejects
self-review, a non-approved decision, or a review digest that differs from the contract bytes.

Every capability has an explicit `vmRecipe`. Every `firewall-write` row uses exactly one of:

- `lifecycle`: non-empty `fixture`, `setup`, `verify`, reverse-ordered `cleanup`, and `absence` arrays;
- `reviewed-exclusion`: `reasonCode: "irreversible"`, a concrete non-empty rationale, reviewer identity,
  review timestamp, and at least two offline adversarial evidence requirements.

Absence of `vmRecipe` is always an error. `read-probe` and `local-lifecycle` are valid only for read and
local-write rows respectively. Never treat an unavailable recipe as an empty evidence array or a skipped
test.

- [ ] **Step 4: Create the non-normative evidence manifest**

Use this separate exact TypeScript shape when producing the JSON, keyed by contract MCP name:

```ts
export interface ProductEvidenceManifest {
  readonly schemaVersion: 1;
  readonly contractSha256: string;
  readonly capabilities: Readonly<Record<string, {
    readonly offline: readonly string[];
    readonly vm: readonly string[];
    readonly agentic: readonly string[];
  }>>;
}
```

Require `contractSha256` to be the exact 64-character lowercase digest from the public digest file. Evidence
rows may change as tests and attestations improve, but may contain only `offline`, `vm`, and `agentic` arrays. They cannot redefine names,
policy, flags, scopes, or VM recipes. The evidence key set must equal the contract MCP-name set exactly.

- [ ] **Step 5: Implement the exact validator**

```js
const featureFlags = new Set(['raw-api', 'configure', 'iac', 'restore', 'shell', 'ssh']);
const effects = new Set(['read', 'local-write', 'firewall-write']);

export function validateProductContractData(contract, evidence) {
  const errors = [];
  const capabilityNames = contract.capabilities.map((row) => row.mcpName);
  const resourceNames = contract.resources.map((row) => row.key);
  if (new Set(capabilityNames).size !== capabilityNames.length) errors.push('duplicate MCP name');
  if (new Set(resourceNames).size !== resourceNames.length) errors.push('duplicate resource');
  if (contract.resources.length !== 96) errors.push('expected 96 resources');
  for (const row of contract.capabilities) {
    if (!effects.has(row.policy.effect)) errors.push(`invalid effect: ${row.mcpName}`);
    if (row.policy.requiredFeatureFlags.some((flag) => !featureFlags.has(flag))) {
      errors.push(`invalid feature flag: ${row.mcpName}`);
    }
    if (row.vmRecipe === undefined) {
      errors.push(`missing vmRecipe: ${row.mcpName}`);
    } else if (
      row.policy.effect === 'firewall-write' &&
      !['lifecycle', 'reviewed-exclusion'].includes(row.vmRecipe.mode)
    ) {
      errors.push(`unsafe firewall vmRecipe: ${row.mcpName}`);
    }
  }
  if (!sameStringSet(Object.keys(evidence.capabilities), capabilityNames)) {
    errors.push('evidence capability set differs from contract');
  }
  return { errors };
}
```

This excerpt is only the core loop. The implementation must additionally use strict Zod 4 schemas imported
as `import * as z from 'zod/v4'`, reject unknown keys at every object level, verify exact policy combinations,
validate lifecycle/exclusion fields, enforce exact capability/resource sets, verify the evidence digest,
hash the exact UTF-8 contract bytes, parse the one-line digest file, and validate the independent review
record. `validateRuntimeContract()` compares each runtime `CapabilityDefinition` by `mcpName`, then
`id`, `policy.effect`, ordered `policy.resourceScopes`, ordered `policy.requiredFeatureFlags`, backup, audit,
confirmation, timeout, and ordered redaction fields; it reports typed per-name issues and never accepts
counts as equality.

Add synthetic tests proving that `{ requireEvidenceFiles: true, reviewedExtensions: [] }` retains exact base
set equality, an independently reviewed extension in `options.reviewedExtensions` contributes its exact
capability rows to the expected union, and an unreviewed,
digest-mismatched, resource-bearing, or name-colliding extension fails before runtime comparison. This is the
only supported route for later guided workflow capabilities; a mutable parity list is never normative.

- [ ] **Step 6: Run the focused gate**

Run: `npm test -- tests/contract/product-contract.test.ts && npm run product-contract:validate`

Expected: PASS and a line beginning `OPNsense product contract valid:` followed by the exact digest from the
public `.sha256` file and `, 96 resources`.

- [ ] **Step 7: Commit the reviewed public contract**

```bash
git add docs/contracts tests/evidence tests/contract/product-contract.test.ts scripts/contracts package.json package-lock.json
git commit -m "docs: publish reviewed OPNsense product contract"
```

After this commit, `opnsense-product.v1.json`, its digest, and its review record never change in this plan.
A normative change requires a new contract version, new public digest, and a new independent review. Later
tasks may update only `tests/evidence/opnsense-product-evidence.json`.

### Task 2: Implement the OPNsense HTTPS boundary

**Files:**
- Create: `src/opnsense/types.ts`
- Create: `src/opnsense/errors.ts`
- Create: `src/opnsense/client.ts`
- Create: `tests/contract/opnsense-client.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: configuration-derived `OPNsenseClientConfig` containing URL, key, secret, `verifyTls`, optional
  public `caPem`, response bound, `connectTimeoutMs`, `operationTimeoutMs`, and a bounded GET-retry policy.
- Produces: the `OPNsenseClient` interface defined above.

- [ ] **Step 1: Write failing tests for the observed HTTP contract**

```ts
it('omits Content-Type on GET and uses Basic auth without leaking it', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
  const client = createOPNsenseClient(testConfig, fetch);
  await client.request({ method: 'GET', path: '/api/core/system/status' });
  const call = fetch.mock.calls.at(0);
  if (call === undefined) throw new Error('Expected one fetch call');
  const init = call[1];
  if (init === undefined) throw new Error('Expected fetch init');
  expect(new Headers(init.headers).has('content-type')).toBe(false);
  expect(new Headers(init.headers).get('authorization')).toMatch(/^Basic /);
});

it('treats an HTTP 200 result:failed payload as a domain failure', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ result: 'failed', validations: { name: 'required' } }));
  const client = createOPNsenseClient(testConfig, fetch);
  await expect(client.request({ method: 'POST', path: '/api/firewall/filter/addRule', body: {} }))
    .rejects.toMatchObject({ code: 'OPNSENSE_REJECTED' });
});
```

Add these exact path, retry, and error-classification cases to the same file:

```ts
it.each([
  ['dot segment', '/api/core/../system/status'],
  ['single dot segment', '/api/core/./status'],
  ['double separator', '/api/core//status'],
  ['encoded separator', '/api/core/%2fstatus'],
  ['query suffix', '/api/core/system/status?full=1']
])('rejects an unsafe %s before fetch', async (_name, path) => {
  const fetchImpl = vi.fn();
  const client = createOPNsenseClient(testConfig, fetchImpl as typeof fetch);
  await expect(client.request({ method: 'GET', path: path as `/api/${string}` }))
    .rejects.toMatchObject({ code: 'OPNSENSE_UNSAFE_PATH' });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('retries only safe GET failures within the operation deadline', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ rows: [] }));
  const client = createOPNsenseClient(
    { ...testConfig, maxGetRetries: 1, retryBaseDelayMs: 1 },
    fetchImpl as typeof fetch,
    dispatcherFactory,
    immediateSleep
  );
  await expect(client.request({ method: 'GET', path: '/api/core/system/status' }))
    .resolves.toMatchObject({ status: 200 });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it('never retries POST, invalid JSON, oversized output, or result:failed', async () => {
  const responses = [
    new Response('{}', { status: 503 }),
    new Response('{', { status: 200 }),
    new Response(JSON.stringify({ value: 'x'.repeat(1024) }), { status: 200 }),
    Response.json({ result: 'failed' })
  ];
  for (const response of responses) {
    const fetchImpl = vi.fn().mockResolvedValue(response);
    const client = createOPNsenseClient(
      { ...testConfig, maxResponseBytes: 64, maxGetRetries: 2 },
      fetchImpl as typeof fetch
    );
    await expect(client.request({ method: 'POST', path: '/api/firewall/filter/addRule', body: {} }))
      .rejects.toBeInstanceOf(OPNsenseClientError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  }
});

it.each([
  ['HTTP', new Response('{}', { status: 500 }), 'OPNSENSE_HTTP_ERROR'],
  ['invalid JSON', new Response('{', { status: 200 }), 'OPNSENSE_INVALID_JSON'],
  [
    'oversized output',
    new Response(JSON.stringify({ value: 'x'.repeat(1024) })),
    'OPNSENSE_RESPONSE_TOO_LARGE'
  ]
])('maps %s failures', async (_name, response, code) => {
  const client = createOPNsenseClient(
    { ...testConfig, maxResponseBytes: 64, maxGetRetries: 0 },
    vi.fn().mockResolvedValue(response) as typeof fetch
  );
  await expect(client.request({ method: 'GET', path: '/api/core/system/status' }))
    .rejects.toMatchObject({ code });
});

it('distinguishes connect timeout, operation timeout, and caller cancellation', async () => {
  await expect(runConnectTimeout()).rejects.toMatchObject({ code: 'OPNSENSE_CONNECT_TIMEOUT' });
  await expect(runOperationTimeout()).rejects.toMatchObject({ code: 'OPNSENSE_TIMEOUT' });

  const controller = new AbortController();
  controller.abort(new Error('caller cancelled'));
  const client = createOPNsenseClient(testConfig, neverFetch);
  await expect(
    client.request({
      method: 'GET',
      path: '/api/core/system/status',
      signal: controller.signal
    })
  ).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
});

it('pins every request to the configured origin', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(Response.json({ rows: [] }));
  const client = createOPNsenseClient(testConfig, fetchImpl as typeof fetch);
  await client.request({ method: 'GET', path: '/api/core/system/status' });
  const requested = fetchImpl.mock.calls[0]?.[0];
  expect(requested).toBeInstanceOf(URL);
  expect((requested as URL).origin).toBe(new URL(testConfig.baseUrl).origin);
});

it('keeps TLS verification on by default and scopes the lab opt-out to this client', async () => {
  const created: unknown[] = [];
  const globalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const dispatcherFactory = (options: unknown) => {
    created.push(options);
    return fakeDispatcher;
  };
  createOPNsenseClient({ ...testConfig, verifyTls: true }, fetch, dispatcherFactory);
  createOPNsenseClient({ ...testConfig, verifyTls: false }, fetch, dispatcherFactory);
  expect(created).toEqual([
    expect.objectContaining({ connect: expect.objectContaining({ rejectUnauthorized: true }) }),
    expect.objectContaining({ connect: expect.objectContaining({ rejectUnauthorized: false }) })
  ]);
  expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(globalTlsSetting);
});
```

- [ ] **Step 2: Run the client tests and verify the red state**

Run: `npm test -- tests/contract/opnsense-client.test.ts`

Expected: FAIL because `createOPNsenseClient` does not exist.

- [ ] **Step 3: Implement the typed, abortable client**

Pin `undici` exactly to `8.7.0`; never use `NODE_TLS_REJECT_UNAUTHORIZED`. Create one client-owned dispatcher
so a disposable-lab TLS opt-out cannot affect another HTTP client in the process. Reject a configured base
URL containing credentials, query, fragment, or a non-root path. `safeApiUrl()` must parse path segments
before URL construction: require `/api/`, reject `//`, `.` or `..` segments, backslashes, percent encoding,
query/fragment delimiters, and any segment outside `[A-Za-z0-9_.-]+`; then assert the resulting origin equals
the configured origin.

```ts
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';

export interface OPNsenseClientConfig {
  readonly baseUrl: string;
  readonly key: string;
  readonly secret: string;
  readonly verifyTls: boolean;
  readonly caPem?: string;
  readonly maxResponseBytes: number;
  readonly connectTimeoutMs: number;
  readonly operationTimeoutMs: number;
  readonly maxGetRetries: 0 | 1 | 2;
  readonly retryBaseDelayMs: number;
}

export function createOPNsenseClient(
  config: OPNsenseClientConfig,
  fetchImpl: typeof undiciFetch = undiciFetch,
  dispatcherFactory: (options: Agent.Options) => Dispatcher = (options) => new Agent(options),
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void> = abortableSleep
): OPNsenseClient {
  const base = validateBaseUrl(config.baseUrl);
  const dispatcher = dispatcherFactory({
    connect: {
      timeout: config.connectTimeoutMs,
      rejectUnauthorized: config.verifyTls,
      ...(config.caPem === undefined ? {} : { ca: config.caPem })
    }
  });
  return {
    async request<T>(request: OPNsenseRequest): Promise<OPNsenseResponse<T>> {
      const operationSignal = AbortSignal.timeout(
        request.operationTimeoutMs ?? config.operationTimeoutMs
      );
      const signal = request.signal
        ? AbortSignal.any([request.signal, operationSignal])
        : operationSignal;
      const headers = new Headers({ authorization: `Basic ${Buffer.from(`${config.key}:${config.secret}`).toString('base64')}` });
      if (request.method === 'POST') headers.set('content-type', 'application/json');
      const url = safeApiUrl(base, request.path);
      const response = await requestWithSafeGetRetries({
        method: request.method,
        maxRetries: request.method === 'GET' ? config.maxGetRetries : 0,
        retryBaseDelayMs: config.retryBaseDelayMs,
        signal,
        sleep,
        execute: () => fetchImpl(url, {
          method: request.method,
          headers,
          signal,
          dispatcher,
          ...(request.method === 'POST'
            ? { body: JSON.stringify(request.body ?? {}) }
            : {})
        })
      });
      const data = await readBoundedJson(response, config.maxResponseBytes, signal);
      assertOPNsenseSuccess(response.status, data);
      const requestId = response.headers.get('x-request-id');
      return {
        status: response.status,
        data: data as T,
        ...(requestId === null ? {} : { requestId })
      };
    },
    close: () => dispatcher.close()
  };
}
```

Set `content-type: application/json` only inside the POST branch before executing the request. Retry only
GET network failures and HTTP 408/502/503/504, at most `maxGetRetries` where configuration accepts only
integers 0–2. Never retry POST, HTTP 200 semantic failures, invalid JSON, oversized output, cancellation, or
either timeout. Map an Undici connect-timeout cause to `OPNSENSE_CONNECT_TIMEOUT`, expiry of the operation
signal to `OPNSENSE_TIMEOUT`, an already-aborted or later-aborted caller signal to `OPERATION_CANCELLED`, and
other transport failures to sanitized `OPNSENSE_NETWORK_ERROR`. Every backoff is abortable and remains inside
the one operation deadline. Use conditional object spreads for `body`, `ca`, `requestId`, and every optional
field so the code passes `exactOptionalPropertyTypes`.

- [ ] **Step 4: Run focused and type gates**

Run: `npm test -- tests/contract/opnsense-client.test.ts && npm run typecheck`

Expected: PASS with no secret value present in snapshots or output.

- [ ] **Step 5: Commit the HTTP boundary**

```bash
git add src/opnsense tests/contract/opnsense-client.test.ts package.json package-lock.json
git commit -m "feat: add hardened OPNsense HTTP client"
```

### Task 3: Load and validate the 96-resource catalog

**Files:**
- Create: `src/opnsense/catalog/schema.ts`
- Create: `src/opnsense/catalog/resources.data.ts`
- Create: `src/opnsense/catalog/resources.ts`
- Create: `tests/contract/resource-catalog.test.ts`

**Interfaces:**
- Consumes: the 96 normative `resources` rows from `docs/contracts/opnsense-product.v1.json`.
- Produces: `getResource(name): ResourceDefinition` and `listResources(): readonly ResourceDefinition[]`.

- [ ] **Step 1: Write the failing catalog tests**

```ts
it('loads 96 uniquely named and command-addressable resources', () => {
  const resources = listResources();
  expect(resources).toHaveLength(96);
  expect(new Set(resources.map(item => item.key)).size).toBe(96);
  for (const resource of resources) {
    expect(() => safePathSegment(resource.module)).not.toThrow();
    expect(() => safePathFragment(resource.controller)).not.toThrow();
    expect(() => safePathSegment(resource.wrapper)).not.toThrow();
    expect(resource.commands.search).toBeTruthy();
    expect(resource.commands.get).toBeTruthy();
    expect(Object.values(resource.commands).every(Boolean)).toBe(true);
  }
});

it('rejects an unknown resource without constructing a path', () => {
  expect(() => getResource('../system')).toThrowError('Unknown OPNsense resource');
});

it.each(['.', '..', 'core//system', 'core/./system', 'core/../system', 'core/%2fsystem'])(
  'rejects unsafe path data %s',
  (value) => expect(() => safePathFragment(value)).toThrow('Unsafe OPNsense path fragment')
);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- tests/contract/resource-catalog.test.ts`

Expected: FAIL because the catalog modules do not exist.

- [ ] **Step 3: Define the strict catalog schema and loader**

```ts
import * as z from 'zod/v4';

const safeSegmentSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(?:[.-][A-Za-z0-9_-]+)*$/)
  .refine((value) => value !== '.' && value !== '..');
const safeFragmentSchema = z.string().superRefine((value, context) => {
  if (value.includes('//') || value.includes('\\') || value.includes('%')) {
    context.addIssue({ code: 'custom', message: 'unsafe path separator or encoding' });
    return;
  }
  for (const segment of value.split('/')) {
    if (!safeSegmentSchema.safeParse(segment).success) {
      context.addIssue({ code: 'custom', message: 'unsafe path segment' });
    }
  }
});
const apiPathSchema = z
  .string()
  .regex(/^\/api\//)
  .superRefine((value, context) => {
    if (!safeFragmentSchema.safeParse(value.slice('/api/'.length)).success) {
      context.addIssue({ code: 'custom', message: 'unsafe API path' });
    }
  });
export const resourceDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  category: z.string().regex(/^[a-z][a-z0-9_]*$/),
  module: safeSegmentSchema,
  controller: safeFragmentSchema,
  wrapper: safeSegmentSchema,
  commands: z.object({
    search: safeSegmentSchema,
    get: safeSegmentSchema,
    add: safeSegmentSchema.optional(),
    set: safeSegmentSchema.optional(),
    del: safeSegmentSchema.optional(),
    toggle: safeSegmentSchema.optional()
  }).strict(),
  applyPath: apiPathSchema.optional()
}).strict();
```

Generate `resources.data.ts` deterministically from the reviewed contract without renaming `key`, `module`,
`controller`, `wrapper`, `commands.del`, or `applyPath`. The generator verifies the public contract digest
before emitting data. Normalize stored apply paths once to the client-facing `/api/...` form; `apiPath()` and
the HTTP boundary both revalidate all segments. A changed endpoint requires a new versioned public contract
and independent review, never an unreviewed hand edit to generated runtime data.

- [ ] **Step 4: Run catalog, contract, and type gates**

Run: `npm test -- tests/contract/resource-catalog.test.ts tests/contract/product-contract.test.ts && npm run typecheck`

Expected: PASS, exactly 96 resources, zero duplicate names, zero unsafe path fragments.

- [ ] **Step 5: Commit the catalog**

```bash
git add src/opnsense/catalog tests/contract/resource-catalog.test.ts
git commit -m "feat: add validated OPNsense resource catalog"
```

### Task 4: Implement generic read operations

**Files:**
- Create: `src/opnsense/generic/schemas.ts`
- Create: `src/opnsense/generic/service.ts`
- Create: `tests/contract/generic-read.test.ts`

**Interfaces:**
- Consumes: `OPNsenseClient`, `getResource` and caller-supplied resource/identifier/filter inputs.
- Produces: `list`, `get`, and `describe` methods returning `GenericOperationResult`.

- [ ] **Step 1: Write failing list/get/describe tests**

```ts
const service = createGenericResourceService(fakeClient, catalog);
await expect(service.list({ resource: 'firewall_filter', searchPhrase: 'enabled', current: 2, rowCount: 25 }))
  .resolves.toMatchObject({ resource: 'firewall_filter', operation: 'list', ok: true, changed: false });
expect(fakeClient.requests[0]).toMatchObject({
  method: 'POST',
  path: '/api/firewall/filter/searchRule',
  body: { current: 2, rowCount: 25, sort: {}, searchPhrase: 'enabled' }
});
await expect(service.get({ resource: 'firewall_filter', id: 'rule-1' }))
  .resolves.toMatchObject({ operation: 'get', id: 'rule-1' });
await expect(service.list({ resource: '../unknown' })).rejects.toThrow('Unknown OPNsense resource');
```

Cover pagination bounds, search-phrase and sort-body bounds, malformed `rows` responses, wrapper unwrapping,
identifiers, empty results, and output size limits. Do not invent controller-specific filter fields: only body
keys attested by the bootgrid contract (`current`, `rowCount`, `sort`, `searchPhrase`) are generic.

- [ ] **Step 2: Verify the red state**

Run: `npm test -- tests/contract/generic-read.test.ts`

Expected: FAIL because the generic service does not exist.

- [ ] **Step 3: Implement read operations without dynamic path input**

```ts
export function createGenericResourceService(client: OPNsenseClient, catalog: ResourceCatalog) {
  return {
    async list(input: GenericListInput): Promise<GenericOperationResult<readonly unknown[]>> {
      const resource = catalog.get(input.resource);
      const command = requireCommand(resource, 'search');
      const path = apiPath(resource.module, resource.controller, command);
      const body = bootgridBody(input, { maxRowCount: 500, maxSearchLength: 256 });
      const response = await client.request<Record<string, unknown>>({ method: 'POST', path, body });
      return { resource: resource.key, operation: 'list', ok: true, changed: false, value: readBootgridRows(response.data) };
    },
    async get(input: GenericGetInput): Promise<GenericOperationResult> {
      const resource = catalog.get(input.resource);
      const command = requireCommand(resource, 'get');
      const path = apiPath(resource.module, resource.controller, command, validateIdentifier(input.id));
      const response = await client.request({ method: 'GET', path });
      return { resource: resource.key, operation: 'get', ok: true, changed: false, id: input.id, value: unwrapResource(response.data, resource.wrapper) };
    }
  };
}
```

- [ ] **Step 4: Run the read contract tests**

Run: `npm test -- tests/contract/generic-read.test.ts && npm run typecheck`

Expected: PASS and no caller-controlled controller or command path.

- [ ] **Step 5: Commit generic reads**

```bash
git add src/opnsense/generic tests/contract/generic-read.test.ts
git commit -m "feat: add generic OPNsense read operations"
```

### Task 5: Extend the Foundation safety runtime and implement backup, audit, and restore

**Files:**
- Modify: `src/capabilities/types.ts`
- Modify: `src/capabilities/catalog.ts`
- Create: `src/features/backup/storage.ts`
- Create: `src/features/backup/service.ts`
- Create: `src/features/backup/capabilities.ts`
- Create: `src/security/call-limits.ts`
- Create: `src/security/firewall-preflight.ts`
- Modify: `src/security/audit-log.ts`
- Modify: `src/capabilities/kernel.ts`
- Modify: `src/capabilities/dispatch.ts`
- Modify: `src/app/application-context.ts`
- Modify: `src/app/default-application.ts`
- Create: `src/app/product-context.ts`
- Create: `src/app/product-runtime.ts`
- Create: `src/config/product-feature-flags.ts`
- Create: `src/config/product-runtime-config.ts`
- Modify: `src/config/feature-flags.ts`
- Modify: `src/config/runtime-config.ts`
- Modify: `tests/capabilities/catalog.test.ts`
- Create: `tests/security/product-policy-kernel.test.ts`
- Create: `tests/app/product-context.test.ts`
- Create: `tests/app/default-product-runtime.test.ts`
- Create: `tests/contract/backup-storage.test.ts`
- Create: `tests/integration/backup-dispatch.test.ts`
- Create: `tests/security/call-limits.test.ts`

**Interfaces:**
- Consumes: Foundation kernel-internal `defineCapability`, `CapabilityCatalog.getByMcpName()`,
  `CapabilityPolicy`, `CapabilityExecutionContext`, opaque `ApplicationContext`,
  `OwnedApplicationRuntime`, the OPNsense history export endpoint,
  filesystem configuration, and the migrated `AuditLog` contract.
- Produces: sealed parsed-input resource resolution and preflight leases; `PreflightExecutionMetadata`,
  `MutationExecutionMetadata`, `PolicyRuntimeDependencies`, `ProductDependencies`,
  `createFirewallPreflight()`, `createProductCatalog()`, `createProductApplicationContext()`,
  `createProductRuntimeFromEnvironment()`;
  `BackupService.create`, `list`,
  `getMetadata`, `verify`, `delete`, and `restoreGuidance`; and the typed environment-to-`FeatureFlag` map.

- [ ] **Step 0: Migrate the approved safety contracts as the RED half of this task**

Execute provenance-migration Task 6 now: copy only group `security-backup`, adapt its final imports to the
foundation policy/dispatch/server boundaries, and run its focused commands. They must be RED for the missing
independent backup service or exact policy behavior, not for syntax, stale paths, or missing test fixtures.
Do not commit. Continue with the steps below and make the migrated contracts green in this task.

- [ ] **Step 1: Write failing Foundation-extension tests before any product mutation definition**

Use only `defineCapability()`; never spread a returned `CapabilityDefinition` to replace its handler because
the Foundation stores handlers in a `WeakMap`. Assert nested policy fields and the Foundation lookup name:

```ts
import * as z from 'zod/v4';

it('resolves parsed dynamic scopes, reserves preflight, then audits and backs up', async () => {
  const events: string[] = [];
  const capability = defineCapability({
    id: 'opnsense.generic.create',
    mcpName: 'opn_create',
    title: 'Create OPNsense resource',
    description: 'Create one declared OPNsense resource.',
    inputSchema: z.object({ resource: z.enum(['firewall_filter', 'firewall_alias']) }).strict(),
    outputSchema: z.object({ changed: z.literal(true) }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    transports: ['stdio'],
    policy: {
      effect: 'firewall-write',
      resourceScopes: ['firewall_filter', 'firewall_alias'],
      requiredFeatureFlags: [],
      backup: 'strict',
      audit: 'required',
      confirmation: 'elicitation',
      timeoutMs: 10_000,
      redactFields: []
    },
    resolveResourceScopes: (input) => [input.resource],
    preflight: async () => {
      events.push('preflight');
      return {
        value: Object.freeze({ reservationId: 'reservation-1' }),
        firewallObservation: {
          configurationSha256: 'a'.repeat(64),
          relevantStateSha256: 'b'.repeat(64),
          revalidate: async () => {
            events.push('revalidate');
            return {
              configurationSha256: 'a'.repeat(64),
              relevantStateSha256: 'b'.repeat(64)
            };
          }
        },
        release: async () => { events.push('release'); },
        consume: async () => { events.push('consume'); }
      };
    },
    handler: async (_input, context) => {
      events.push('handler');
      const reservationSchema = z.object({ reservationId: z.literal('reservation-1') }).strict();
      expect(requirePreflightValue(
        context,
        (value) => reservationSchema.parse(value)
      )).toEqual({ reservationId: 'reservation-1' });
      expect(context.mutation).toEqual({
        backupId: 'backup-1',
        backupCreatedAt: '2026-07-17T10:00:00.000Z',
        auditIntentId: 'intent-1'
      });
      return { changed: true };
    }
  });
  const catalog = new CapabilityCatalog([capability]);
  expect(catalog.getByMcpName('opn_create')?.policy).toMatchObject({
    effect: 'firewall-write',
    resourceScopes: ['firewall_filter', 'firewall_alias'],
    requiredFeatureFlags: []
  });
  const application = createProductApplicationContext(
    writableTestConfig(),
    fakeProductDependencies(events),
    [capability]
  );
  const outcome = await callConfirmedCapability(
    application,
    'opn_create',
    { resource: 'firewall_filter' }
  );
  expect(outcome).toMatchObject({ structuredContent: { changed: true } });
  expect(events).toEqual([
    'lock',
    'preflight',
    'audit-intent',
    'backup',
    'revalidate',
    'handler',
    'consume',
    'audit-complete',
    'unlock'
  ]);
});

it('releases a preflight reservation when strict backup refuses before handler entry', async () => {
  const { application, events } = applicationWithFailingBackupAndPreparedCapability();
  await expect(callConfirmedCapability(application, 'prepared_apply', preparedInput))
    .resolves.toMatchObject({
      isError: true,
      structuredContent: { code: 'BACKUP_REQUIRED' }
    });
  expect(events).toEqual([
    'lock', 'preflight', 'audit-intent', 'backup', 'release', 'audit-refusal', 'unlock'
  ]);
});

it('consumes the reservation once handler invocation starts, including handler failure', async () => {
  const { application, events } = applicationWithFailingPreparedHandler();
  await expect(callConfirmedCapability(application, 'prepared_apply', preparedInput))
    .resolves.toMatchObject({
      isError: true,
      structuredContent: { code: 'EXECUTION_FAILED' }
    });
  expect(events).toEqual([
    'lock', 'preflight', 'audit-intent', 'backup', 'revalidate', 'handler', 'consume',
    'audit-failure', 'unlock'
  ]);
});

it('does not expose sealed handler, resolver, or preflight callbacks on a definition', () => {
  const definition = createPreparedMutationFixture();
  expect(Object.keys(definition)).not.toContain('handler');
  expect(Object.keys(definition)).not.toContain('resolveResourceScopes');
  expect(Object.keys(definition)).not.toContain('preflight');
});
```

`callConfirmedCapability()` is a test-only helper built on the pinned official MCP Client and its form
elicitation handler. It connects to `buildServer(application, transport)` and accepts the elicitation round;
it does not import the kernel constructor, settlement port, ledger, or a raw dispatch method. All product
policy integration tests therefore exercise `createProductApplicationContext()` and the same signed,
one-shot adapter path as the executable.

Also cover: resolver execution only after successful input parsing; resolver output must be non-empty, unique,
and a subset of declared `policy.resourceScopes`; an allow-list is checked against resolved scopes, not the
whole declared upper bound; a thrown resolver or preflight is sanitized; preflight never receives mutation
metadata; `preflight` is absent for ordinary reads; `mutation` is absent for reads and local writes; missing
policy dependencies make a mutation-bearing context fail construction; and lease settlement errors are
reported together with, rather than replacing, a primary refusal or execution failure. Add a concurrent
test proving the per-firewall-target lock is held before the first preflight read and through final audit and
lease settlement. Add two TOCTOU tests: one changes configuration between preflight and backup, and one
changes relevant prepared state after backup. Both return `PRECONDITION_CHANGED`, never invoke the handler,
release the reservation, audit the refusal, and retain the strict snapshot as an ordinary verified backup.
Add an ignored-abort firewall-write fixture: advance the cancellation deadline while its handler is paused,
prove dispatch and the target lock remain pending, let the handler settle, then require
`OUTCOME_INDETERMINATE`, consumed lease, redacted indeterminate audit, retained backup, released lock, and no
side effect after the returned result.

- [ ] **Step 2: Verify the Foundation-extension red state**

Run: `npm test -- tests/security/product-policy-kernel.test.ts tests/app/product-context.test.ts tests/app/default-product-runtime.test.ts tests/capabilities/catalog.test.ts && npm run typecheck`

Expected: FAIL because the Foundation types, sealed kernel hooks, policy dependencies, and product composition
root do not yet exist. No product mutation capability may be implemented before this test becomes green.

- [ ] **Step 3: Extend `defineCapability`, catalog exposure, and execution context**

Add these exact public contracts to `src/capabilities/types.ts`:

```ts
export interface CapabilityPreflightContext {
  readonly signal: AbortSignal;
  readonly transport: TransportKind;
  readonly argumentsSha256: string;
  readonly principalId?: string;
}

export interface CapabilityPreflightLease {
  readonly value: unknown;
  readonly firewallObservation?: FirewallPreflightObservation;
  release(): Promise<void>;
  consume(): Promise<void>;
}

export interface FirewallPreflightObservation {
  readonly configurationSha256: string;
  readonly relevantStateSha256: string;
  revalidate(signal: AbortSignal): Promise<{
    readonly configurationSha256: string;
    readonly relevantStateSha256: string;
  }>;
}

export interface PreflightExecutionMetadata {
  readonly value: unknown;
}

export interface MutationExecutionMetadata {
  readonly backupId: string;
  readonly backupCreatedAt: string;
  readonly auditIntentId: string;
}

export interface CapabilityExecutionContext {
  readonly signal: AbortSignal;
  readonly readOnly: boolean;
  readonly transport: TransportKind;
  readonly principalId?: string;
  readonly preflight?: PreflightExecutionMetadata;
  readonly mutation?: MutationExecutionMetadata;
}

```

Keep `src/capabilities/types.ts` pure. Define `requirePreflightValue()` and
`requireMutationMetadata()` beside the private seals in `src/capabilities/kernel.ts`; capability factories
may import these package-internal helpers by relative source path, but `src/index.ts` and package exports
must not expose them.

Extend the private generic input accepted by `defineCapability()` with:

```ts
readonly resolveResourceScopes?: (input: TInput) => readonly string[];
readonly preflight?: (
  input: TInput,
  context: CapabilityPreflightContext
) => Promise<CapabilityPreflightLease>;
```

Store both callbacks in module-private `WeakMap<CapabilityDefinition, ...>` instances beside the Foundation
handler vault in `src/capabilities/kernel.ts`. Seal `PreflightExecutionMetadata` and
`MutationExecutionMetadata` with module-private `WeakSet`s there; kernel-internal
`requirePreflightValue()` and `requireMutationMetadata()` reject absent or structurally forged values.
Export no callback getter or raw invoker. Add immutable safe metadata
`resourceScopeMode: 'fixed' | 'dynamic'` to `CapabilityDefinition`; defineCapability() computes it from the
presence of the sealed resolver, callers cannot set it, and kernel definition validation proves the metadata
matches its private WeakMap. The definition retains nested `policy.effect`, `policy.resourceScopes`, and
`policy.requiredFeatureFlags`; it exposes no handler, resolver, preflight, lease, or service.
`CapabilityCatalog` continues to use `getByMcpName()` and may read only resourceScopeMode. When an allow-list is active, ordinary
fixed-scope definitions retain the Foundation all-declared-scopes predicate. A definition with a sealed
dynamic resolver is visible only when its non-empty declared upper bound intersects the allow-list; direct
dispatch resolves a non-empty exact scope set and requires every resolved scope to be allowed. Tests
distinguish those two cases so the generic resource capability is usable without weakening fixed-scope
exposure.

Extend the Foundation kernel's single authorizeRequest() helper, not dispatch or the MCP adapter. On initial
dispatch, a sealed resolver produces a unique UTF-16-sorted frozen effective-scope array before confirmation
issuance; every scope must belong to the declared upper bound. The pending confirmation entry binds that
exact array. On settlement the Foundation has already deleted every known confirmation ID synchronously,
before any binding or authorization validation. The same helper then reparses input, reruns the resolver and
allow-list check, and requires exact canonical array equality; no failure may restore or reinsert the consumed
entry. A changed, empty, duplicate, out-of-upper-bound, or newly disallowed scope returns
CONFIRMATION_INVALID and never enters the limiter or preflight. Add accepted-round tests for scope drift and
allow-list refusal, plus sequential/concurrent replay after each mismatch, with handler, limiter, preflight,
audit, and backup spies all untouched.

- [ ] **Step 4: Extend the closed kernel and product composition root**

Define these exact Task 5 composition contracts:

```ts
export interface PolicyRuntimeDependencies {
  readonly backup: BackupService;
  readonly audit: AuditLog;
  readonly callLimiter: CallLimiter;
}

export interface ProductDependencies extends PolicyRuntimeDependencies {
  readonly opnsense: OPNsenseClient;
}

export function createProductCatalog(
  dependencies: ProductDependencies,
  extensions?: readonly CapabilityDefinition[]
): CapabilityCatalog;

export function createProductApplicationContext(
  config: RuntimeConfig,
  dependencies: ProductDependencies,
  extensions?: readonly CapabilityDefinition[]
): ApplicationContext;

export function createFirewallPreflight<TInput extends Record<string, unknown>>(
  backup: BackupService,
  readRelevantState: (input: TInput, signal: AbortSignal) => Promise<unknown>
): (
  input: TInput,
  context: CapabilityPreflightContext
) => Promise<CapabilityPreflightLease>;
```

Place `createFirewallPreflight()` in `src/security/firewall-preflight.ts`; the observation and lease types
remain in `src/capabilities/types.ts` with the other sealed capability contracts.

Add a source-internal `createApplicationContextWithPolicyRuntime(config, catalog, policyDependencies)`
composition helper without changing the public Foundation `createApplicationContext(config, catalog?)`
or its read-only default. Only `src/app/product-context.ts` may import this helper; it still captures the
confirmation adapter port in the Foundation module-private WeakMap. `createProductApplicationContext()`
builds one catalog, then passes the same backup/audit/limiter instances to the one closed capability kernel.
Construction fails if a catalog containing a
local-write or firewall-write definition lacks policy dependencies. Product and extension capability
factories close over injected typed services and call `defineCapability()`; they never spread definitions,
replace a sealed handler, or import mutable singletons.
`createFirewallPreflight()` uses `BackupService.fingerprintCurrentConfig()` plus `sha256Json()` over the
normalized relevant read state, and returns a lease whose revalidator repeats both bounded reads. Product-
context construction rejects any `firewall-write` definition without a sealed preflight callback; dispatch
also requires its lease to contain `firewallObservation`.
Extend the Foundation `RefusalCode` union with the exact product codes `AUDIT_REQUIRED`, `BACKUP_REQUIRED`,
`PRECONDITION_CHANGED`, `RATE_LIMITED`, and `SERVER_BUSY`; all returned messages are static and secret-free.

The kernel pipeline's exact order is:

1. catalog lookup with `getByMcpName()`, transport, read-only, and `requiredFeatureFlags` gates;
2. Zod input parsing and canonical argument digest;
3. sealed resolver execution on parsed input; reject empty/duplicate/out-of-upper-bound scopes and enforce
   the allow-list against the resolved set;
4. kernel one-shot confirmation issuance or accepted one-shot settlement;
5. rate/queue admission, then acquisition of the per-firewall-target mutation lock;
6. sealed preflight reservation and bounded read-only observation while holding that lock;
7. fsynced redacted audit intent;
8. strict backup for `firewall-write`, followed immediately by backup/digest and current-state revalidation;
9. handler invocation with conditionally spread, frozen `preflight` and `mutation` metadata;
10. output parsing, lease settlement, final audit, and lock release.

Foundation `OUTCOME_INDETERMINATE` is mandatory for an in-flight write whose cancellation deadline or caller
abort wins before the handler settles. The kernel keeps the per-target lock, preflight lease, backup and audit
ownership until that handler actually settles; it then records a fixed redacted indeterminate final audit,
consumes the lease, and releases the lock. It never reports TIMEOUT, CANCELLED, success, or rollback for that
write. The result includes only the static reconciliation code/guidance plus backup metadata already safe for
MCP; it contains no late handler output/error. Every concrete mutation task must provide a bounded readback
verification path used by operator-directed reconciliation, and live tests cover an ignored-signal late
handler: dispatch remains pending until settlement, no side effect happens after the result, the lock spans
settlement/final audit, and the backup remains available. Automatic restore is forbidden.

`preflight` runs before audit, backup, or any firewall mutation I/O and receives no mutation metadata. It may
perform bounded read-only revalidation through a service captured by the capability factory (for example,
re-reading a prepared plan's observed state); it cannot invoke a mutating service or construct mutation
metadata. A callback that reserves state and then fails before returning its lease releases that reservation
in its own `finally`; add a focused test for this path. The kernel
calls `release()` exactly once when execution stops after reservation but before handler invocation. Once
handler invocation begins, it calls `consume()` exactly once even if the handler, output parser, or final
audit fails. The handler receives only sealed `preflight.value`, never the lease methods. A prepared-plan
capability therefore reserves a single-use plan in preflight and the handler cannot re-fetch or re-consume a
token. Aggregate a primary failure with lease-settlement failure without losing either cause.

Every `firewall-write` preflight lease contains a sealed `firewallObservation`. Under the held lock, preflight
records the SHA-256 of the complete current configuration and of the relevant normalized state. After
`BackupService.create()`, require the backup record SHA-256 to equal the sealed configuration digest, then
call `firewallObservation.revalidate()` with a fresh bounded read-only signal and require both returned
digests to equal their sealed values. Refuse with `PRECONDITION_CHANGED` before handler entry on any mismatch
or missing observation. This catches changes made by the GUI, another API client, or another process despite
the process-local lock. Keep the lock through lease settlement and final audit.

For `firewall-write`, create the audit intent, successful strict snapshot, and successful post-backup
revalidation before constructing frozen `MutationExecutionMetadata`. Use conditional spreads so
`context.preflight` and `context.mutation` are absent,
not `undefined`, when inapplicable. This common metadata is the only backup/audit authorization passed to
product and later guided-workflow handlers.

- [ ] **Step 5: Add secret-safe product runtime configuration and feature mapping**

Create `loadProductRuntimeConfiguration(env)` in `src/config/product-runtime-config.ts`. It composes the
Foundation `loadRuntimeConfig(env)` with a strict `OPNsenseClientConfig` and private filesystem paths. The
default executable requires `OPNSENSE_URL`, `OPNSENSE_API_KEY`, and `OPNSENSE_API_SECRET`; direct test/library
construction through `createProductApplicationContext(config, dependencies)` remains environment-free.
Use canonical variables only:

- `OPNSENSE_VERIFY_TLS` defaults true and accepts only true/false;
- optional `OPNSENSE_CA_FILE` is an absolute regular non-symlink file, at most 1 MiB, read synchronously only
  during startup because the default composition seam is synchronous;
- bounded response/connect/operation/retry settings map exactly to `OPNsenseClientConfig`;
- `OPNSENSE_BACKUP_PATH` and `OPNSENSE_AUDIT_LOG` default below the platform state directory
  (`XDG_STATE_HOME` when absolute, otherwise `homedir()/.local/state/opnsense-mcp`), never inside the repo;
- limiter variables use the exact bounds in Step 8.

Validation errors contain only field names. They never contain URL credentials, key, secret, CA contents,
token, or a supplied path basename. Add table tests for missing/malformed secrets, unsafe URL/TLS/CA/path,
every numeric boundary, and sentinel absence. Do not accept secrets in command-line arguments.

```ts
import type { FeatureFlag } from './feature-flags.js';

export type ProductFeatureEnvironmentKey =
  | 'ENABLE_RAW_API_TOOL'
  | 'ENABLE_CONFIGURE_TOOL'
  | 'IAC_ENABLED'
  | 'ENABLE_RESTORE_TOOLS'
  | 'ENABLE_SHELL_TOOLS'
  | 'ENABLE_SSH_FEATURES';

export const PRODUCT_FEATURE_ENV = {
  ENABLE_RAW_API_TOOL: 'raw-api',
  ENABLE_CONFIGURE_TOOL: 'configure',
  IAC_ENABLED: 'iac',
  ENABLE_RESTORE_TOOLS: 'restore',
  ENABLE_SHELL_TOOLS: 'shell',
  ENABLE_SSH_FEATURES: 'ssh'
} as const satisfies Readonly<Record<ProductFeatureEnvironmentKey, FeatureFlag>>;
```

Extend runtime parsing to accept only `true` or `false` for these six environment keys and union enabled
mapped values with `ENABLED_FEATURE_FLAGS`. Capability policy always stores the resulting valid
`FeatureFlag` (`raw-api`, `configure`, `iac`, `restore`, `shell`, or `ssh`), never an environment-variable
name. Extend Foundation's schema to this exact six-value vocabulary in this task, update its focused tests,
and reject the former aggregate `advanced-api` value. Add table-driven tests proving every mapping is
one-to-one and that enabling one advanced environment key leaves the other two flags disabled.

- [ ] **Step 6: Write failing filesystem and backup-dispatch tests**

```ts
expect((await stat(backupDirectory)).mode & 0o777).toBe(0o700);
expect((await stat(backupFile)).mode & 0o777).toBe(0o600);
await expect(storage.read(symlinkName)).rejects.toMatchObject({ code: 'BACKUP_UNSAFE_PATH' });
await expect(storage.read(corruptName)).rejects.toMatchObject({ code: 'BACKUP_CHECKSUM_MISMATCH' });
expect(JSON.stringify(await callTool('get_backup', { id }))).not.toContain('<opnsense>');
```

Add same-millisecond collision, atomic write, failed fsync, audit intent, strict audit, deletion, retention,
redacted arguments, and forged direct dispatch cases. With a fake clock and controlled promises, also prove
that reads obey a configurable concurrency ceiling, all firewall writes are globally serialized, a bounded
queue refuses overflow before audit/backup, and a per-principal rate limit refuses excess calls without
sleeping or invoking a handler.

- [ ] **Step 7: Verify the backup-service red state**

Run: `npm test -- tests/contract/backup-storage.test.ts tests/integration/backup-dispatch.test.ts tests/security/call-limits.test.ts`

Expected: FAIL because the independent storage and service do not exist. The provenance migration has
already established the approved `src/security/audit-log.ts` contract; this task extends it rather than
creating a competing audit implementation.

- [ ] **Step 8: Implement storage and backup capabilities from the documented contract**

```ts
export interface BackupRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly reason: string;
}

export interface BackupService {
  create(reason: string, signal?: AbortSignal): Promise<BackupRecord>;
  fingerprintCurrentConfig(signal?: AbortSignal): Promise<{ readonly sha256: string }>;
  list(): Promise<readonly BackupRecord[]>;
  getMetadata(id: string): Promise<BackupRecord>;
  verify(id: string): Promise<BackupRecord>;
  restoreGuidance(id: string): Promise<{
    readonly backup: BackupRecord;
    readonly executableRestoreAvailable: boolean;
    readonly steps: readonly string[];
  }>;
  delete(id: string): Promise<void>;
}
```

Use exclusive creation, `lstat` before and after opening, private modes, checksum verification, atomic
metadata replacement, and XML-free MCP result projections.

Implement the call limiter as an injected, deterministic kernel dependency. Defaults are 8 concurrent
reads, 1 active write per firewall target, 32 queued calls, and 120 calls per principal per rolling minute. Parse
`MCP_MAX_CONCURRENT_READS`, `MCP_MAX_QUEUED_CALLS`, and `MCP_RATE_LIMIT_PER_MINUTE` as bounded positive
integers. Queue/rate admission and the per-target mutation lock happen before preflight, intent, and backup;
once admitted, the kernel pipeline preserves the required lock → preflight → audit-intent → backup →
revalidation → handler → final-audit → unlock order. No handler may acquire
or bypass the limiter directly.

Implement `createOwnedProductServicesFromEnvironment(env, factories?)` and
`createProductRuntimeFromEnvironment(env, factories?)` in `src/app/product-runtime.ts`. The first constructs
exactly one validated RuntimeConfig, OPNsenseClient, BackupService, AuditLog, and CallLimiter and returns the
source-internal `{ config, dependencies, close }` ownership record. Only product-runtime.ts itself and the
later guided `src/app/workflow-runtime.ts` may import that service factory; it is not a package-root export or
ApplicationContext property. The second passes those same instances to
`createProductApplicationContext()` and returns the Foundation `OwnedApplicationRuntime` shape by calling
`createOwnedApplicationRuntime(application, serviceClosers)`. The optional factories object is
source-internal and exists only for sentinel tests. Initialization is transactional: if any later constructor
fails, independently close every already-created closeable. `close()` is idempotent and independently closes
the OPNsense dispatcher and any future closeable audit/backup resource within the product-service phase; one
failure never skips another and all are aggregated. It must not close those services directly before the
Foundation lifecycle barrier: once runtime close begins, no new initial dispatch or confirmation completion
is admitted, admitted handlers are drained, and only then may OPNsense, audit, backup, lock, and limiter
services close.

Replace the body of `src/app/default-application.ts::createDefaultApplicationRuntime()` with
`createProductRuntimeFromEnvironment(process.env)`. This is a required product gate, not a release follow-up.
No executable may call the Foundation-only `createApplicationContext(loadRuntimeConfig())` path afterward.
`tests/app/default-product-runtime.test.ts` builds with sentinel environment and fake owned services, starts
the real `buildServer(runtime.application, 'stdio')`, and proves tools/list contains the exact product catalog
implemented through this task (including a product read and backup metadata capability), not only
`server_status`. It also covers partial construction, idempotent close, and secret-free errors.

Define backup/restore capability factories only after Steps 3–5 compile. Build every definition through
`defineCapability()` with the exact nested policy from the reviewed contract. `restore_backup_ssh` is a
`firewall-write` requiring both `restore` and `ssh`; metadata/list/verify/guidance reads expose no XML, and
local backup deletion is a separately audited local-write. No handler reads a global client or backup
singleton.

- [ ] **Step 9: Run type, default-composition, backup, audit, policy, and redaction gates**

Run: `npm run typecheck && npm test -- tests/capabilities/catalog.test.ts tests/app/product-context.test.ts tests/app/default-product-runtime.test.ts tests/contract/backup-storage.test.ts tests/integration/backup-dispatch.test.ts tests/security`

Expected: PASS with private modes and no XML or secret output.

- [ ] **Step 10: Commit the Foundation extension, product context, and safety services**

```bash
git add src/capabilities src/features/backup src/security src/app src/config \
  tests/capabilities/catalog.test.ts tests/app/product-context.test.ts \
  tests/app/default-product-runtime.test.ts tests/contract/backup-storage.test.ts \
  tests/integration/backup-dispatch.test.ts tests/security
git commit -m "feat: add sealed product mutation safety runtime"
```

The staged set also includes every adapted `security-backup` destination from provenance Task 6. The commit
is forbidden unless both the new Vitest contracts and migrated Node tests are green.

### Task 6: Implement generic mutations through the closed kernel

**Files:**
- Modify: `src/opnsense/generic/service.ts`
- Modify: `src/opnsense/generic/schemas.ts`
- Create: `src/opnsense/generic/capabilities.ts`
- Modify: `src/app/product-context.ts`
- Modify: `README.md`
- Modify: `tests/foundation/documentation.test.ts`
- Create: `tests/contract/generic-write.test.ts`
- Create: `tests/integration/generic-write-policy.test.ts`

**Interfaces:**
- Consumes: Task 5 `ProductDependencies`, sealed `MutationExecutionMetadata`, dynamic-scope resolver,
  `defineCapability()`, and central policy kernel.
- Produces: `create`, `update`, `delete`, `apply`, and contract-declared service methods returning
  `GenericOperationResult`, plus `createGenericCapabilities(dependencies)`.

- [ ] **Step 1: Write failing mutation and policy tests**

```ts
it('backs up before a create and treats applied:false as failure', async () => {
  const events: string[] = [];
  const service = createGenericResourceService(fakeClient(events), catalog);
  await expect(service.create({ resource: 'haproxy_backend', value: { name: 'test' } }))
    .rejects.toMatchObject({ code: 'OPNSENSE_APPLY_FAILED' });
  expect(events).toEqual(['add', 'apply']);
});

it('refuses a direct forged mutation in read-only mode', async () => {
  await expect(
    dispatchThroughProductContext('opn_delete', { resource: 'firewall_filter', id: 'x' }, {
      readOnly: true
    })
  ).resolves.toMatchObject({ kind: 'refused', code: 'READ_ONLY' });
});
```

Add this policy matrix:

```ts
it.each([
  [
    'resource outside allow-list',
    { allowedResourceScopes: ['firewall_alias'], resource: 'firewall_filter' },
    'RESOURCE_NOT_ALLOWED'
  ],
  [
    'unscoped mutation with allow-list',
    { allowedResourceScopes: ['firewall_filter'], useUnscopedCapability: true },
    'RESOURCE_NOT_ALLOWED'
  ],
  ['strict backup failure', { backupError: new Error('disk full') }, 'BACKUP_REQUIRED'],
  ['strict audit intent failure', { auditStrict: true, auditError: new Error('fsync failed') }, 'AUDIT_REQUIRED']
])('%s', async (_name, override, code) => {
  await expect(runGenericMutationWithPolicy(override)).resolves.toMatchObject({
    kind: 'refused',
    code
  });
});

it('uses separate contract policy for service status and a mutating service action', async () => {
  await expect(callServiceStatus({ readOnly: true })).resolves.toMatchObject({ changed: false });
  await expect(callServiceAction('restart', { readOnly: true })).resolves.toMatchObject({
    kind: 'refused',
    code: 'READ_ONLY'
  });
});

it('reports an idempotent no-change without applying', async () => {
  const result = await updateExistingValueWithPolicy({ before: fixture, after: fixture });
  expect(result).toMatchObject({ ok: true, changed: false, applied: false });
  expect(fakeClient.requests).toEqual([]);
});
```

In the same RED step, replace only the temporary Foundation documentation assertion that expects the README
to claim no firewall mutation capability is registered. Require the truthful transitional statement instead:
generic mutation capabilities now exist, but `READ_ONLY=true` remains the default and hides and refuses them
at both listing and dispatch. Deliberately leave README unchanged for this RED run, so the new documentation
assertion fails alongside the missing mutation implementation.

- [ ] **Step 2: Verify the red state**

Run: `npm test -- tests/contract/generic-write.test.ts tests/integration/generic-write-policy.test.ts tests/foundation/documentation.test.ts`

Expected: FAIL because mutation methods and integration mappings do not exist and the temporary Foundation
documentation still claims that no mutation capability is registered.

- [ ] **Step 3: Implement one mutation primitive and derive all verbs from it**

```ts
async function mutate(input: GenericMutationInput, commandName: 'add' | 'set' | 'del'): Promise<GenericOperationResult> {
  const resource = catalog.get(input.resource);
  const command = requireCommand(resource, commandName);
  const path = commandName === 'add'
    ? apiPath(resource.module, resource.controller, command)
    : apiPath(resource.module, resource.controller, command, validateIdentifier(input.id));
  const response = await client.request<Record<string, unknown>>({
    method: 'POST',
    path,
    ...(commandName === 'del' ? {} : { body: { [resource.wrapper]: input.value } })
  });
  const result = normalizeMutationResult(resource, commandName, input.id, response.data);
  if (!result.ok) throw new OPNsenseOperationError('OPNSENSE_REJECTED', result);
  if (result.changed && resource.applyPath !== undefined) {
    const applied = await client.request<Record<string, unknown>>({ method: 'POST', path: resource.applyPath });
    requireApplySuccess(applied.data);
  }
  return result;
}
```

Create each generic capability through `defineCapability()` inside `createGenericCapabilities()`; never
attach or replace a handler on an existing definition. Use the exact nested contract policy. Each generic
mutation declares the complete mutable registry-key upper bound in `policy.resourceScopes` and provides the
Task 5 sealed `resolveResourceScopes(parsed) => [getResource(parsed.resource).key]`. Its handler calls
`requireMutationMetadata(context)` before invoking the service. Public delete maps only to the catalog's
exact `del` command. `toggle` uses its exact command and an independently validated final `1` or `0` path
segment. Apply is a separate exact catalog path and any apply failure fails visibly; it is never silently
downgraded to `applied:false`.

Each generic firewall-write definition also installs `createFirewallPreflight()`. Its relevant-state reader
captures the addressed resource (or proven absence for create) under the per-target mutation lock. The
post-backup revalidator must match both the strict backup configuration digest and this resource-state digest
before the service can send its first POST.

Keep read-only service status and a mutating service action in separately classified contract capabilities;
never branch from a Foundation `effect: 'read'` definition into a restart/reload handler. The integration
test asserts `audit-intent`, `backup`, first outbound mutation, optional apply, and final audit order. Backup
is performed only by the kernel; the generic service neither accepts nor constructs backup metadata.

Now replace the obsolete README sentence with the transitional statement required by the RED documentation
test. Keep the explicit not-product-complete and not-release-ready notice. This handoff is mandatory in Task
6 itself; Guided Task 8 later rewrites the high-level public documents but must not be the first task to
remove a claim that Task 6 has made false.

- [ ] **Step 4: Run mutation, policy, and backup tests**

Run: `npm test -- tests/contract/generic-write.test.ts tests/integration/generic-write-policy.test.ts tests/contract/backup-policy.test.ts tests/foundation/documentation.test.ts && npm run typecheck`

Expected: PASS; event assertions prove backup precedes the first outbound mutation.

- [ ] **Step 5: Commit generic mutations**

```bash
git add src/opnsense/generic/service.ts src/opnsense/generic/schemas.ts \
  src/opnsense/generic/capabilities.ts src/app/product-context.ts \
  README.md tests/foundation/documentation.test.ts \
  tests/contract/generic-write.test.ts tests/integration/generic-write-policy.test.ts
git commit -m "feat: route generic mutations through strict safety policy"
```

### Task 7: Rebuild network, firewall, and diagnostics capabilities

**Files:**
- Create: `src/features/network/capabilities.ts`
- Create: `src/features/network/service.ts`
- Create: `src/features/firewall/capabilities.ts`
- Create: `src/features/firewall/service.ts`
- Modify: `src/app/product-context.ts`
- Create: `tests/contract/network-firewall.test.ts`
- Create: `tests/integration/network-firewall-mcp.test.ts`

**Interfaces:**
- Consumes: Task 5 product dependencies and safety contracts plus the generic resource service.
- Produces: the exact interface, VLAN, DHCP, ARP, diagnostic, firewall-rule, alias, and NAT definitions in
  the reviewed product contract.

- [ ] **Step 1: Generate failing public-contract cases for this domain**

```ts
for (const expected of contractCapabilities(['network', 'firewall', 'diagnostics'])) {
  const name = expected.mcpName;
  it(`${name} is registered with matching effect and scope`, () => {
    expect(capabilityCatalog.getByMcpName(name)).toMatchObject({
      id: expected.id,
      policy: {
        effect: expected.policy.effect,
        resourceScopes: expected.policy.resourceScopes,
        requiredFeatureFlags: expected.policy.requiredFeatureFlags
      }
    });
  });
}
```

Add an explicit regression vector for each observed behavior:

```ts
it.each([
  ['normalizes firewall booleans', () => normalizeFirewallRule({ enabled: '1' }), { enabled: true }],
  ['accepts a two-label alias host', () => normalizeAliasHost('example.com'), 'example.com'],
  ['maps NAT destination port', () => normalizeNat({ destination_port: '443' }), { destinationPort: 443 }],
  ['keeps IPv6 interface addresses', () => normalizeInterface({ ipv6: ['2001:db8::1/64'] }), { ipv6: ['2001:db8::1/64'] }]
])('%s', (_name, run, expected) => expect(run()).toEqual(expected));

it('bounds diagnostics and removes every matching duplicate', () => {
  expect(boundDiagnosticOutput('x'.repeat(70_000))).toHaveLength(65_536);
  expect(removeDuplicateRows([{ id: 'a' }, { id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }]);
});
```

- [ ] **Step 2: Verify the domain red state**

Run: `npm test -- tests/contract/network-firewall.test.ts tests/integration/network-firewall-mcp.test.ts`

Expected: FAIL with exact missing MCP names listed by the contract helper.

- [ ] **Step 3: Implement domain adapters as small compositions**

```ts
export function createFirewallCapabilities(
  dependencies: FirewallDependencies
): readonly CapabilityDefinition[] {
  return [
    createCustomReadCapability('list_firewall_rules', dependencies.listFirewallRules),
    createCustomReadCapability('get_firewall_rule', dependencies.getFirewallRule),
    createCustomReadCapability('find_firewall_rules', dependencies.findFirewallRules),
    createMappedCreateCapability('create_firewall_rule', 'firewall_filter', dependencies),
    createMappedCreateCapability('create_firewall_preset', 'firewall_filter', dependencies),
    createMappedUpdateCapability('update_firewall_rule', 'firewall_filter', dependencies),
    createMappedDeleteCapability('delete_firewall_rule', 'firewall_filter', dependencies),
    createMappedToggleCapability('toggle_firewall_rule', 'firewall_filter', dependencies),
    createCustomReadCapability('get_arp_table', dependencies.getArpTable),
    createCustomReadCapability('interface_list_overview', dependencies.listInterfaceOverview)
  ];
}
```

The curated firewall list adapter reads the automation-rule tree, normalizes selected option values, and
uses bounded bootgrid and read-only rule-stat fallbacks so GUI-created rules remain visible. It must never
invent a mutable identifier for a statistics-only row. Every curated write delegates to the exact
`firewall_filter` catalog commands, applies once, and verifies the created/updated/deleted state. Every
`create*Capability` helper above calls `defineCapability()` with the contract's nested policy and closes over
only injected dependencies; every firewall write installs `createFirewallPreflight()` for its independently
read relevant state, and mutation handlers call `requireMutationMetadata(context)`. Each custom function
has its own Zod 4 schema, bounded structured output, and direct unit tests.

- [ ] **Step 4: Run domain and generic regression tests**

Run: `npm test -- tests/contract/network-firewall.test.ts tests/integration/network-firewall-mcp.test.ts tests/contract/generic-read.test.ts tests/contract/generic-write.test.ts && npm run typecheck`

Expected: PASS with zero missing domain capability.

- [ ] **Step 5: Commit the network/firewall domain**

```bash
git add src/features/network src/features/firewall src/app/product-context.ts tests/contract/network-firewall.test.ts tests/integration/network-firewall-mcp.test.ts
git commit -m "feat: implement contracted network and firewall capabilities"
```

### Task 8: Rebuild DNS, proxy, certificate, and monitoring capabilities

**Files:**
- Create: `src/features/dns/capabilities.ts`
- Create: `src/features/dns/service.ts`
- Create: `src/features/proxy/capabilities.ts`
- Create: `src/features/certificates/capabilities.ts`
- Create: `src/features/monitoring/capabilities.ts`
- Modify: `src/app/product-context.ts`
- Create: `tests/contract/service-domains.test.ts`
- Create: `tests/integration/service-domains-mcp.test.ts`

**Interfaces:**
- Consumes: Task 5 product dependencies and safety contracts plus the generic resource service.
- Produces: every contract-declared Unbound, Dnsmasq, DNS blocklist, HAProxy, Trust, ACME, Monit, and
  service-control capability.

This task owns the independently recreated ACME, device-scoped DNS, and monitoring unit tests listed in
provenance Task 10. Write them RED before implementing the relevant capability, then include them in the
same green commit. Device-scoped blocking must prove it cannot silently fall back to a global block.

- [ ] **Step 1: Write generated registration failures and focused regressions**

```ts
expectMissingCapabilitiesToBeEmpty(['dns', 'proxy', 'certificates', 'monitoring']);
await expect(unblockDomain({ domain: 'example.com' })).resolves.toMatchObject({ removed: expect.any(Number) });
expect(mockStore.blocklist.filter(item => item.domain === 'example.com')).toEqual([]);
```

Add these concrete assertions:

```ts
it('purges all duplicates for a two-label domain', () => {
  expect(removeDomain([{ domain: 'example.com' }, { domain: 'example.com' }], 'example.com')).toEqual([]);
});
it('maps HAProxy links and rejects an unsuccessful reconfigure', async () => {
  expect(normalizeHaproxyBackend({ linkedServers: 'srv-1,srv-2' })).toMatchObject({ serverIds: ['srv-1', 'srv-2'] });
  await expect(assertApplied({ result: 'saved', applied: false })).rejects.toMatchObject({ code: 'OPNSENSE_APPLY_FAILED' });
});
it('never projects ACME secrets or certificate private keys', () => {
  expect(projectAcme({ name: 'account', apiKey: testSecret })).toEqual({ name: 'account' });
  expect(projectCertificate({ name: 'cert', privateKey: testSecret, fingerprint: 'aa' })).toEqual({ name: 'cert', fingerprint: 'aa' });
});
it('covers Monit CRUD and read-only service status', async () => {
  await expect(monit.create(monitFixture)).resolves.toMatchObject({ changed: true });
  await expect(monit.update('monit-1', monitFixture)).resolves.toMatchObject({ id: 'monit-1' });
  await expect(monit.delete('monit-1')).resolves.toMatchObject({ changed: true });
  await expect(serviceStatus('monit', { readOnly: true })).resolves.toMatchObject({ changed: false });
  await expect(serviceAction('monit', 'restart', { readOnly: true })).resolves.toMatchObject({
    kind: 'refused',
    code: 'READ_ONLY'
  });
});
```

- [ ] **Step 2: Verify the domain red state**

Run: `npm test -- tests/contract/service-domains.test.ts tests/integration/service-domains-mcp.test.ts`

Expected: FAIL with missing capability names and the domain regressions.

- [ ] **Step 3: Implement domain capability arrays and custom normalizers**

```ts
export function createServiceCapabilities(
  dependencies: ServiceDomainDependencies
): readonly CapabilityDefinition[] {
  return [
    ...createDnsCapabilities(dependencies),
    ...createHaproxyCapabilities(dependencies),
    ...createCertificateCapabilities(dependencies),
    ...createMonitoringCapabilities(dependencies)
  ];
}
```

All create/update/delete operations use the generic mutation service; only composite searches, result
normalization, secure certificate projection, and domain-specific idempotency receive custom handlers. Each
factory creates fresh sealed definitions through `defineCapability()` and uses the exact nested policy from
the reviewed contract; every firewall write installs `createFirewallPreflight()` over its normalized domain
state, and no definition or handler singleton is imported.

- [ ] **Step 4: Run service-domain and security regressions**

Run: `npm test -- tests/contract/service-domains.test.ts tests/integration/service-domains-mcp.test.ts tests/security/output-redaction.test.ts && npm run typecheck`

Expected: PASS, no private key in snapshots, and `applied:false` is an execution error.

- [ ] **Step 5: Commit service domains**

```bash
git add src/features/dns src/features/proxy src/features/certificates src/features/monitoring src/app/product-context.ts tests/contract/service-domains.test.ts tests/integration/service-domains-mcp.test.ts
git commit -m "feat: implement contracted service capabilities"
```

### Task 9: Rebuild fixed SSH-backed configuration gaps

**Files:**
- Create: `src/features/ssh/executor.ts`
- Create: `src/features/ssh/assets.ts`
- Create: `src/features/ssh/capabilities.ts`
- Create: `src/features/ssh/php/` parameterized assets listed by the reviewed contract
- Modify: `src/app/product-context.ts`
- Modify: `src/app/product-runtime.ts`
- Modify: `src/config/product-runtime-config.ts`
- Create: `tests/contract/ssh-capabilities.test.ts`
- Modify: `tests/app/default-product-runtime.test.ts`
- Create: `tests/vm/ssh-capabilities.test.mjs`

**Interfaces:**
- Consumes: structured validated arguments, SSH credentials supplied outside process arguments, Task 5 sealed
  mutation metadata, and the migrated managed-VM harness from provenance Task 4.
- Produces: fixed interface assignment, IP, toggle, system, NTP, PPPoE, wireless, and restore operations
  declared by the reviewed contract.

- [ ] **Step 1: Write failing argument, asset, and backup-order tests**

```ts
const ipv4 = sshCatalog.getByMcpName('interface_set_ipv4');
if (ipv4 === undefined) throw new Error('Missing interface_set_ipv4');
expect(() => ipv4.inputSchema.parse({ interface: 'lan;id', address: '10.0.0.1/24' })).toThrow();
await expect(dispatchFixedSsh('interface_toggle', validArgs)).resolves.toMatchObject({ kind: 'success' });
expect(events.slice(0, 3)).toEqual(['audit-intent', 'backup', 'upload-fixed-asset']);
expect(spawnArgs.join(' ')).not.toContain(testSecret);
```

Add command-injection strings, unknown tool names, asset checksum mismatch, host-key policy, timeout, cleanup,
restore reboot, and read-only refusal tests.

- [ ] **Step 2: Verify the red state**

Run: `npm test -- tests/contract/ssh-capabilities.test.ts`

Expected: FAIL because the SSH catalog and executor do not exist.

- [ ] **Step 3: Implement a no-free-text executor**

```ts
import * as z from 'zod/v4';

export interface FixedSshOperation<
  I extends Record<string, unknown>,
  O extends Record<string, unknown>
> {
  readonly name: string;
  readonly asset: string;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly requiresReboot: boolean;
}

export interface FixedSshTransport {
  uploadVerifiedAsset(asset: string, signal: AbortSignal): Promise<void>;
  runAsset(asset: string, input: unknown, signal: AbortSignal): Promise<unknown>;
}

export interface FixedSshExecutionContext {
  readonly signal: AbortSignal;
  readonly transport: FixedSshTransport;
  readonly mutation: MutationExecutionMetadata;
}

export async function executeFixedSsh<
  I extends Record<string, unknown>,
  O extends Record<string, unknown>
>(operation: FixedSshOperation<I, O>, input: I, context: FixedSshExecutionContext): Promise<O> {
  const parsed = operation.input.parse(input);
  await context.transport.uploadVerifiedAsset(operation.asset, context.signal);
  return operation.output.parse(await context.transport.runAsset(operation.asset, parsed, context.signal));
}
```

Credentials travel through protected stdin or file descriptors, never argv. Assets accept JSON on stdin and
never interpolate caller text into a command. The executor must not call `BackupService` itself: the central
dispatch kernel creates exactly one strict pre-change snapshot and passes its ID in `context.mutation`.
Each SSH capability is created through `defineCapability()` with valid `requiredFeatureFlags` (`ssh`, plus
`restore` for restore) and calls `requireMutationMetadata(capabilityContext)` before constructing the internal
`FixedSshExecutionContext`. Firewall-writing SSH definitions install `createFirewallPreflight()` using the
fixed asset's independent readback state. Extend `ProductDependencies` in this task with
`readonly fixedSsh?: FixedSshExecutor`; bind factories to that injected instance with conditional spreads,
and fail product-context construction if an enabled contract capability requires a missing executor.

Extend product runtime configuration and ownership in this same task. When the normalized `ssh` feature is
disabled, construct no SSH object and read no SSH credential file. When enabled, require a validated
username, port, pinned known-hosts file, and exactly one private key file or password file; every path is
absolute, regular, non-symlink, outside the repository, mode `0600` on POSIX, and bounded to 1 MiB. Derive the
default host only from the already validated OPNsense URL, permit an explicit host override only after exact
hostname/IP validation, and never offer an insecure host-key option. The executor passes credentials through
protected stdin/file descriptors, never argv or logs.

`createOwnedProductServicesFromEnvironment()` constructs and owns exactly one FixedSshTransport/Executor when
required, adds it to the same ProductDependencies used by createProductApplicationContext(), and closes it
independently with the existing client/backup/audit resources. Initialization remains transactional. Add
default-runtime tests for feature disabled (no credential read), feature enabled with missing/unsafe config
(fail closed), successful sentinel construction, capability reachability, partial failure, idempotent close,
and secret-free errors. No test uses the production firewall.

- [ ] **Step 4: Run offline tests, then the disposable VM tests**

Run offline: `npm test -- tests/contract/ssh-capabilities.test.ts && npm run typecheck`

Run live: `npm run vm:with -- npm run test:vm:ssh`

Expected: offline PASS; the managed wrapper provisions/uses only the disposable VM, registers cleanup before
each mutation, applies and reads back, reverses cleanup, proves zero residue, and stops the VM even on failure.

- [ ] **Step 5: Commit fixed SSH capabilities**

```bash
git add src/features/ssh src/app/product-context.ts src/app/product-runtime.ts \
  src/config/product-runtime-config.ts tests/app/default-product-runtime.test.ts \
  tests/contract/ssh-capabilities.test.ts tests/vm/ssh-capabilities.test.mjs
git commit -m "feat: implement contracted fixed SSH operations"
```

### Task 10: Restore explicitly gated advanced capabilities

**Files:**
- Create: `src/features/advanced/raw-api.ts`
- Create: `src/features/advanced/configure.ts`
- Create: `src/features/advanced/shell.ts`
- Create: `src/features/advanced/iac.ts`
- Create: `src/features/advanced/capabilities.ts`
- Create: `src/config/private-config.ts`
- Modify: `src/app/product-context.ts`
- Modify: `src/app/product-runtime.ts`
- Modify: `src/config/product-runtime-config.ts`
- Create: `tests/contract/advanced-capabilities.test.ts`
- Create: `tests/integration/advanced-policy.test.ts`
- Modify: `tests/app/default-product-runtime.test.ts`

**Interfaces:**
- Consumes: valid Foundation `FeatureFlag` values, the Task 5 policy kernel, strict backups, audit,
  OPNsense client, and optional SSH/shell transports.
- Produces: the raw API, legacy shell, configuration, and IaC capabilities declared by the reviewed contract.

This task owns the independently recreated `tests/integration/iac-capabilities.test.ts` from provenance
Task 10. Write it RED before the IaC adapter and include it in this task's green commit.

The advanced contract set is explicit: `configure`, `opn_api_call`, `iac_plan_deployment`,
`iac_apply_deployment`, `iac_destroy_deployment`, `iac_list_resource_types`, `cli_execute`,
`cli_fix_interface_blocking`, `cli_reload_firewall`, `cli_show_routing`, `cli_fix_dmz_routing`,
`cli_check_nfs`, `cli_apply_changes`, `ssh_execute`, `ssh_fix_interface_blocking`,
`ssh_fix_dmz_routing`, `ssh_enable_intervlan_routing`, `ssh_reload_firewall`, `ssh_show_routing`,
`ssh_show_pf_rules`, `ssh_backup_config`, `ssh_restore_config`, `ssh_check_nfs_connectivity`,
`ssh_system_status`, `ssh_test_vlan_connectivity`, `ssh_quick_dmz_fix`, and `ssh_batch_execute`.

- [ ] **Step 1: Write fail-closed exposure and dispatch tests**

```ts
expect(listToolNames(defaultApplication)).not.toContain('opn_api_call');
await expect(dispatchDirect('opn_api_call', rawArgs, defaultApplication)).resolves.toMatchObject({
  kind: 'refused',
  code: 'FEATURE_DISABLED'
});
await expect(dispatchDirect('opn_api_call', rawArgs, readOnlyAdvancedApplication)).resolves.toMatchObject({
  kind: 'refused',
  code: 'READ_ONLY'
});
await expect(dispatchDirect('opn_api_call', rawArgs, allowListedAdvancedApplication))
  .resolves.toMatchObject({ kind: 'refused', code: 'RESOURCE_NOT_ALLOWED' });
```

Add tests proving strict backup and audit for every advanced mutation, path character validation, IaC plan
versus apply/destroy effects, shell default-off behavior, timeouts, output bounds, and secret redaction.

- [ ] **Step 2: Verify the red state**

Run: `npm test -- tests/contract/advanced-capabilities.test.ts tests/integration/advanced-policy.test.ts`

Expected: FAIL because advanced modules do not exist.

- [ ] **Step 3: Implement advanced adapters without weakening policy**

```ts
export function createAdvancedCapabilities(
  dependencies: AdvancedDependencies
): readonly CapabilityDefinition[] {
  return [
    createContractCapability('opn_api_call', rawApiSchema, dependencies.executeRawApi),
    createContractCapability('configure', configureSchema, dependencies.configureLocal),
    createContractCapability('iac_plan_deployment', iacPlanSchema, dependencies.planIac),
    createContractCapability('iac_apply_deployment', iacApplySchema, dependencies.applyIac),
    createContractCapability('iac_destroy_deployment', iacDestroySchema, dependencies.destroyIac),
    createContractCapability(
      'iac_list_resource_types',
      z.object({}).strict(),
      dependencies.listIacResourceTypes
    ),
    ...createLegacyContractCapabilities(dependencies, legacyOperations)
  ];
}
```

In this task, extend `ProductDependencies` with optional typed `configure`, `iac`, `legacyShell`, and
`legacySsh` services and update `createProductCatalog()` to pass only present services through conditional
spreads. Product-context construction fails when an enabled contract row lacks its required service. The
default context, and a context enabling only unrelated flags, compiles without constructing shell, SSH, or
IaC services.

Extend `createOwnedProductServicesFromEnvironment()` in this task rather than leaving those interfaces
dependency-injection-only. Construct each adapter only for its own flag: `raw-api` wraps the already owned
OPNsenseClient, `iac` constructs the IaC adapter/state, and `configure` constructs the secure configure
service. Enabling any one must neither construct nor expose the other two. The configure tool atomically
writes the validated platform private configuration for the next process start and returns restart guidance;
it never hot-swaps the opaque ApplicationContext, returns credentials, or changes the current target
mid-request.
Create the minimal permission-hardened `src/config/private-config.ts` store here and make
loadProductRuntimeConfiguration() resolve `OPNSENSE_CONFIG_FILE`/the documented platform default with
explicit environment overrides. Guided Task 6 later extends this same module with interactive installer UX;
it must not add a second store. Use Guided Task 6's already specified version-1 JSON shape now, reject unknown
top-level/credential fields, write atomically, and enforce `0700`/`0600` on POSIX or the documented current-
user/SYSTEM/Administrators ACL on Windows.
When all three required OPNsense credential environment fields are present, configuration loading must not
open the platform-default private file at all; this is required for hermetic conformance/release processes.
An explicitly set OPNSENSE_CONFIG_FILE remains validated and authoritative according to the documented merge
contract. Tests use a trap file to prove the complete-environment path performs no private-file read.

When `shell` is active, require the validated SSH configuration from Task 9 and construct bounded legacy CLI
and SSH adapters over that remote transport; never execute a caller command on the MCP host. If the required
feature is enabled but its config/service cannot be constructed, default runtime startup fails with field
names only. If disabled, no IaC state, SSH credential, shell transport, or configure store is opened.
IaC state lives under the validated platform state directory with private permissions and is independently
closed. Extend the owned cleanup/partial-initialization aggregate to every advanced service.

Default-runtime tests enable each feature combination separately and together, list the expected exposed
rows, execute a harmless sentinel adapter call, prove missing dependencies/configuration fail closed, and
prove partial initialization/idempotent aggregate cleanup with no secret or path basename in errors. The
complete default composition must therefore remain executable after Tasks 9 and 10, not merely compilable
through injected test dependencies.

`createContractCapability()` looks up the immutable reviewed row and calls `defineCapability()` with its
exact nested policy. It never passes `ENABLE_RAW_API_TOOL`, `ENABLE_CONFIGURE_TOOL`, `IAC_ENABLED`, or any
other environment name as a feature flag: raw API rows use only `raw-api`, configure uses only `configure`,
IaC rows use only `iac`, and the remaining policies use `restore`, `shell`, or `ssh` as reviewed. IaC
apply/destroy definitions install a sealed parsed-input scope resolver whose output is a non-empty
subset of the row's declared `policy.resourceScopes`. Raw/free-text operations have no safe resolver and are
therefore refused whenever a resource allow-list is active.

Define the legacy rows explicitly rather than inferring policy from names or HTTP verbs:

```ts
const legacyOperations = [
  { mcpName: 'cli_execute', schema: cliExecuteSchema, run: executeCli },
  { mcpName: 'cli_fix_interface_blocking', schema: emptySchema, run: fixInterfaceBlockingCli },
  { mcpName: 'cli_reload_firewall', schema: emptySchema, run: reloadFirewallCli },
  { mcpName: 'cli_show_routing', schema: emptySchema, run: showRoutingCli },
  { mcpName: 'cli_fix_dmz_routing', schema: dmzFixSchema, run: fixDmzRoutingCli },
  { mcpName: 'cli_check_nfs', schema: nfsCheckSchema, run: checkNfsCli },
  { mcpName: 'cli_apply_changes', schema: emptySchema, run: applyChangesCli },
  { mcpName: 'ssh_execute', schema: sshExecuteSchema, run: executeSsh },
  { mcpName: 'ssh_fix_interface_blocking', schema: emptySchema, run: fixInterfaceBlockingSsh },
  { mcpName: 'ssh_fix_dmz_routing', schema: dmzFixSchema, run: fixDmzRoutingSsh },
  { mcpName: 'ssh_enable_intervlan_routing', schema: intervlanSchema, run: enableIntervlanRouting },
  { mcpName: 'ssh_reload_firewall', schema: emptySchema, run: reloadFirewallSsh },
  { mcpName: 'ssh_show_routing', schema: emptySchema, run: showRoutingSsh },
  { mcpName: 'ssh_show_pf_rules', schema: emptySchema, run: showPfRulesSsh },
  { mcpName: 'ssh_backup_config', schema: emptySchema, run: backupConfigSsh },
  { mcpName: 'ssh_restore_config', schema: restoreConfigSchema, run: restoreConfigSsh },
  { mcpName: 'ssh_check_nfs_connectivity', schema: nfsCheckSchema, run: checkNfsSsh },
  { mcpName: 'ssh_system_status', schema: emptySchema, run: systemStatusSsh },
  { mcpName: 'ssh_test_vlan_connectivity', schema: vlanTestSchema, run: testVlanConnectivity },
  { mcpName: 'ssh_quick_dmz_fix', schema: dmzFixSchema, run: quickDmzFix },
  { mcpName: 'ssh_batch_execute', schema: sshBatchSchema, run: batchExecuteSsh }
] as const;
```

Map each row through `createContractCapability()`, which obtains effect, `policy.resourceScopes`, and valid
`requiredFeatureFlags` from the reviewed contract, then calls `defineCapability()`. A mismatch between the
hard-coded adapter name and the contract is a construction error. Unscoped rows are refused whenever an
allow-list is active. Advanced firewall-write handlers call `requireMutationMetadata(context)` and cannot opt
out of backup, audit, or `createFirewallPreflight()`; free-text operations use the complete configuration as
their relevant state when no narrower safe read model exists. Every advanced firewall-write contract row already has either a lifecycle recipe or
a reviewed irreversible exclusion; Task 12 must execute or validate that exact recipe.

- [ ] **Step 4: Run advanced and global guardrail tests**

Run: `npm test -- tests/contract/advanced-capabilities.test.ts tests/integration/advanced-policy.test.ts tests/security && npm run typecheck`

Expected: PASS with every advanced capability hidden and refused by default.

- [ ] **Step 5: Commit advanced adapters and executable ownership**

```bash
git add src/features/advanced src/config/private-config.ts src/config/product-runtime-config.ts \
  src/app/product-context.ts src/app/product-runtime.ts tests/contract/advanced-capabilities.test.ts \
  tests/integration/advanced-policy.test.ts tests/integration/iac-capabilities.test.ts \
  tests/app/default-product-runtime.test.ts
git commit -m "feat: compose gated advanced capabilities"
```

### Task 11: Pass the exact offline contract gate and expose read-only MCP resources

**Files:**
- Modify: `scripts/contracts/validate-opnsense-product.mjs`
- Modify: `tests/evidence/opnsense-product-evidence.json`
- Modify: `src/app/application-context.ts`
- Modify: `src/app/product-context.ts`
- Create: `src/app/resource-document.ts`
- Create: `src/mcp/product-resources.ts`
- Modify: `src/server/build-server.ts`
- Modify: `tests/architecture/execution-boundary.test.ts`
- Create: `docs/operations.md`
- Create: `tests/mcp/product-resources.test.ts`
- Create: `tests/integration/full-surface.test.ts`
- Create: `tests/integration/mock-opnsense-contract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the complete `CapabilityCatalog`, immutable reviewed product contract, mutable evidence manifest,
  mock OPNsense server, all domain modules, `ApplicationContext`, and the Foundation MCP server adapter.
- Produces: exact `npm run product-contract:validate` and `npm run test:mock` gates plus real MCP list/read
  resources at `opnsense://catalog/capabilities`, `opnsense://catalog/resources`, and
  `opnsense://docs/operations`.

- [ ] **Step 0: Migrate shared test infrastructure against the completed product surface**

Execute provenance-migration Task 7 now: copy only group `other-tests`, adapt it to the public foundation and
product interfaces, and keep any failure visible. This group is staged only in this task's final green
offline-contract commit.

- [ ] **Step 1: Write failing exact runtime/evidence and mock assertions**

```ts
it('implements exactly the reviewed contract with executable evidence', async () => {
  const result = await validateRuntimeContract(capabilityCatalog, contract, evidence, {
    requireEvidenceFiles: true,
    reviewedExtensions: []
  });
  expect(result.issues).toEqual([]);
});
```

Make the mock test execute at least one successful read and one strict backup-backed write through MCP for
every resource command shape, plus direct forged calls for every hidden capability. Compare definitions by
`catalog.getByMcpName(row.mcpName)` and exact `id`, nested policy fields, exposure, and resolver declaration;
never compare only counts.

- [ ] **Step 2: Write failing real MCP resource adapter tests**

```ts
it('lists and reads the three safe product resources through MCP', async () => {
  const client = await createInMemoryMcpClient(productApplication);
  const listed = await client.listResources();
  expect(listed.resources.map((resource) => resource.uri).sort()).toEqual([
    'opnsense://catalog/capabilities',
    'opnsense://catalog/resources',
    'opnsense://docs/operations'
  ]);

  for (const resource of listed.resources) {
    const read = await client.readResource({ uri: resource.uri });
    expect(read.contents).toHaveLength(1);
    const serialized = JSON.stringify(read.contents);
    expect(serialized).not.toContain(testApiKey);
    expect(serialized).not.toContain(testApiSecret);
    expect(serialized).not.toContain('<opnsense>');
    expect(serialized).not.toContain(backupDirectory);
  }
});

it('publishes summaries and operational guidance without mutation entry points', async () => {
  const capabilities = await readJsonResource('opnsense://catalog/capabilities');
  expect(capabilities.contractSha256).toBe(reviewedContractSha256);
  const firstCapability = capabilities.capabilities.at(0);
  if (firstCapability === undefined) throw new Error('Expected a capability summary');
  expect(firstCapability).toEqual({
    id: expect.any(String),
    mcpName: expect.any(String),
    title: expect.any(String),
    effect: expect.stringMatching(/^(read|local-write|firewall-write)$/),
    requiredFeatureFlags: expect.any(Array)
  });
  const resources = await readJsonResource('opnsense://catalog/resources');
  expect(resources.resources).toHaveLength(96);
  const firstResource = resources.resources.at(0);
  if (firstResource === undefined) throw new Error('Expected a resource summary');
  expect(firstResource).not.toHaveProperty('controller');
  expect(firstResource).not.toHaveProperty('applyPath');
});
```

Also prove unknown URIs return the MCP resource-not-found error, resource reads never call
`dispatchCapability()` or the kernel handler path, and neither listing nor reading receives
`PreflightExecutionMetadata` or `MutationExecutionMetadata`.

- [ ] **Step 3: Run the complete contract, mock, and resource gate and inspect failures**

Run: `npm run product-contract:validate && npm run test:mock && npm test -- tests/mcp/product-resources.test.ts`

Expected before completion: non-zero with exact missing capability or evidence rows, never a generic count.

- [ ] **Step 4: Close each typed issue without weakening the validator**

Use the validator's typed issue kind to update one exact artifact:

```ts
for (const issue of validateRuntimeContract(capabilityCatalog, contract, evidence).issues) {
  if (issue.kind === 'missing-capability') throw new Error(`add CapabilityDefinition for ${issue.mcpName}`);
  if (issue.kind === 'policy-mismatch') throw new Error(`correct nested policy for ${issue.mcpName}`);
  if (issue.kind === 'resolver-mismatch') throw new Error(`correct sealed resolver for ${issue.mcpName}`);
  if (issue.kind === 'missing-evidence') throw new Error(`add executable evidence for ${issue.mcpName}`);
  if (issue.kind === 'unexpected-capability') throw new Error(`remove undeclared ${issue.mcpName}`);
  assertNever(issue);
}
```

Resolve the reported artifact and rerun the same command after each change. Do not add name-only coverage
markers and do not relax exact set equality.

- [ ] **Step 5: Implement and register the read-only product resources**

Keep `src/mcp/product-resources.ts` transport-neutral; it imports no MCP SDK type. Define immutable data-only
`ApplicationResourceDocument` values:

```ts
export interface ApplicationResourceDocument {
  readonly uri: `opnsense://${string}`;
  readonly name: string;
  readonly description: string;
  readonly mimeType: 'application/json' | 'text/markdown';
  readonly text: string;
}

export function createProductResourceDocuments(
  catalog: CapabilityCatalog,
  resources: readonly ResourceDefinition[],
  contractSha256: string,
  operationsMarkdown: string
): readonly ApplicationResourceDocument[];
```

The capability summary projects only `id`, `mcpName`, `title`, `policy.effect`, and
`policy.requiredFeatureFlags`. The resource summary projects only `key`, `label`, `category`, and available
command names; it omits controller/apply paths. The operational document explains read-only defaults,
feature flags, allow-lists, strict backups, audit behavior, disposable-VM-only testing, and authenticated
proxy requirements without embedding environment values, credentials, backup XML, filesystem paths, or
live status. Freeze documents at application construction, bound each document to 256 KiB, and accept only
the three literal URIs.

Extend the opaque application internals with a copied/frozen readonly resource-document array; the public
ApplicationContext remains exactly `{ catalog }`. The existing source-internal product composition helper
accepts the data-only documents, and `createProductApplicationContext()` always builds the three documents
from the same catalog/resources/contract digest used by validation. Add one narrow
`listApplicationResourceDocuments(application)` helper imported only by `src/server/build-server.ts`.
`buildServer()` generically registers immutable constant read callbacks for every document for both stdio and
HTTP. No callback, service, dispatcher, config, or mutation authority may enter a document. Foundation
contexts list zero resources; product contexts list exactly three. Add architecture tests for the import
allow-list and data-only keys, plus a test that spreading/forging an ApplicationContext loses the private
documents and is rejected.

- [ ] **Step 6: Run the full deterministic project gate**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run build && npm test && npm run product-contract:validate && git diff --check`

Expected: all commands exit 0, exact capability set, 96 resources, and no dirty generated drift.

- [ ] **Step 7: Commit offline contract completion and MCP resources**

```bash
git add src/app src/mcp/product-resources.ts src/server/build-server.ts docs/operations.md \
  tests scripts/contracts package.json package-lock.json
git commit -m "test: prove offline product contract and resources"
```

### Task 12: Prove live contract behavior with fail-safe cleanup

**Files:**
- Modify: `scripts/vm/with-managed-vm.mjs`
- Modify: `tests/vm/with-managed-vm.test.mjs`
- Create: `tests/vm/support/product-lifecycle.mjs`
- Create: `tests/vm/product-contract.test.mjs`
- Create: `tests/vm/residue-check.mjs`
- Modify: `tests/evidence/opnsense-product-evidence.json`
- Modify: `docs/testing.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the migrated provenance Task 4 `scripts/vm/with-managed-vm.mjs` launcher, full MCP server,
  immutable reviewed product contract, and lifecycle recipes.
- Produces: `npm run test:vm:product-contract`, per-capability live evidence, aggregate failure diagnostics,
  residue attestation, and unconditional managed-VM shutdown.

- [ ] **Step 1: Strengthen the shared wrapper contract before adding a lifecycle**

Extend `tests/vm/with-managed-vm.test.mjs` with injected failures at doctor, provision, setup, mutation,
verification, per-case cleanup, residue verification, and stop. Assert that the migrated wrapper:

- installs bounded `SIGINT`/`SIGTERM` traps before provisioning and removes them at exit;
- registers global residue and stop actions before provisioning;
- invokes the requested command without a shell and never places credentials in argv;
- runs per-case cleanup in reverse order from `finally`, using a fresh bounded cleanup signal;
- always runs residue verification and `vm:stop`, even after a primary or cleanup failure;
- throws one `AggregateError` preserving the primary error plus every cleanup, residue, and stop error;
- returns non-zero for any primary or cleanup failure.

Run: `node --test tests/vm/with-managed-vm.test.mjs`

Expected: FAIL at the first missing trap, ordering, or aggregation behavior. Make only the shared migrated
wrapper green; do not create a second VM launcher.

- [ ] **Step 2: Add a targeted failing lifecycle with cleanup registered first**

```js
test('firewall rule lifecycle is backed up, applied, read back and removed', async () => {
  await runProductLifecycle(contractCapability('create_firewall_rule'), async (lifecycle) => {
    const setup = await fixtures.create('firewall-rule', lifecycle);
    let created;
    lifecycle.registerCleanup('delete-firewall-rule', async (cleanupSignal) => {
      await cleanupFirewallRule(created?.id, setup, cleanupSignal);
    });
    created = await mcp.callTool('create_firewall_rule', setup.input);
    assert.equal(created.changed, true);
    await assertRuleMatches(created.id, setup.expected);
  });
});
```

`fixtures.create()` receives the lifecycle registry and must register inverse cleanup before each fixture
mutation. The capability cleanup closure is registered before `mcp.callTool()`, even when its created ID is
not known yet. `runProductLifecycle()` uses `try/finally`, runs every registered cleanup in reverse order,
then independently executes every recipe absence predicate. Cleanup uses its own timeout signal, not a
cancelled operation signal, and aggregates primary, cleanup, and absence errors.

Generate the full set directly from the immutable contract without optional recipe filtering:

```js
const firewallWrites = contract.capabilities.filter(
  (row) => row.policy.effect === 'firewall-write'
);
for (const capability of firewallWrites) {
  if (capability.vmRecipe.mode === 'lifecycle') {
    test(capability.mcpName, () => executeContractLifecycle(capability));
    continue;
  }
  if (capability.vmRecipe.mode === 'reviewed-exclusion') {
    test(`${capability.mcpName} has an approved irreversible exclusion`, () => {
      assert.equal(capability.vmRecipe.reasonCode, 'irreversible');
      assert.equal(capability.vmRecipe.reviewerId, contractReview.reviewerId);
      assert.ok(evidence.capabilities[capability.mcpName].offline.length >= 2);
    });
    continue;
  }
  assert.fail(`invalid firewall vmRecipe: ${capability.mcpName}`);
}
```

- [ ] **Step 3: Run one targeted live case only through the shared wrapper**

Run: `npm run vm:with -- npm run test:vm:product-contract -- --only create_firewall_rule`

Expected: the new test initially fails at the first unimplemented or mismatched live behavior; its registered
cleanup, recipe absence proof, global residue check, and VM stop still run and appear in the aggregate report.

- [ ] **Step 4: Fix behavior and verify forward plus reverse state**

Change only the responsible client/catalog/domain module. The test must read back requested fields through
the OPNsense API and independently prove absence during cleanup. Rerun the same `vm:with` command; never
chain provisioning, the test command, and stopping with shell operators.

- [ ] **Step 5: Run every live recipe once targeted cases are green**

Run: `npm run vm:with -- npm run test:vm:product-contract`

Expected: every lifecycle row passes setup, mutation, independent readback, reverse cleanup, and absence;
every reviewed exclusion is reported separately rather than counted as live execution; residue count is
zero; and the wrapper records successful VM stop. Any cleanup/residue/stop failure invalidates the run.

Only after this command succeeds, update the mutable evidence manifest with the exact VM test/report paths
for each executed row. Never edit the v1 contract, digest, or review record.

- [ ] **Step 6: Re-run deterministic gates after the live fixes**

Run: `npm run build && npm test && npm run product-contract:validate && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 7: Commit live contract evidence**

```bash
git add src scripts/vm/with-managed-vm.mjs tests/vm tests/evidence/opnsense-product-evidence.json docs/testing.md package.json
git commit -m "test: prove live OPNsense product contract"
```
