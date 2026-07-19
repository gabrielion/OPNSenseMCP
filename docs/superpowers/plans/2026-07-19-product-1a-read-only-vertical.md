# Product 1A Read-Only Vertical — Implementation Plan

> **Execution:** Use `superpowers:subagent-driven-development` and TDD. The owner delegated plan
> approval; keep this plan deliberately narrow and make implementation progress the priority.

**Goal:** Ship the first demonstrable product slice: a packed local MCP server can describe two
OPNsense resources, read system status, and page services through a synthetic HTTPS OPNsense mock,
including one versioned OpenCode smoke.

**Architecture:** Keep the existing closed capability kernel and composition root. Add one tiny,
versioned, data-only operation contract; a kernel-private resource resolver for generic read tools;
one internal HTTPS client; and three fixed MCP capabilities (`opn_describe`, `opn_get`, `opn_list`).
There is no arbitrary API dispatcher and no mutation.

## Binding decisions

- Product 1A contains exactly `system.status` and `core.services`; `server_status` remains available.
- `system.status` uses `GET /api/core/system/status`.
- The mock candidate for `core.services` uses `POST /api/core/service/search` with Bootgrid fields
  `current`, `rowCount`, `sort`, and `searchPhrase`. Official OPNsense documentation conflicts with
  its generated GET table, so Product 1B must observe and seal the real OPNsense 26 contract.
- Inputs are strict. Describe results are capped at five and unknown-resource suggestions at three.
  Service pages are 1–100 rows; queries are at most 128 UTF-8 characters. Responses are bounded and
  expose only reviewed fields.
- Generic-resource resolution is trusted static startup code captured inside the kernel. It parses
  before resource authorization, selects only a closed descriptor, supplies only effective visible
  scopes to the handler, and never appears on `CapabilityDefinition` or the MCP boundary.
- `OPNSENSE_CONFIG_FILE` is the only runtime pointer to credentials. The private strict JSON contains
  `url`, `apiKey`, `apiSecret`, optional `caFile`, and optional bounded `timeoutMs` and
  `maxResponseBytes`. HTTPS and certificate verification are mandatory; a private CA is explicit.
- Missing target configuration leaves the MCP server protocol-clean and discoverable but target reads
  fail with one fixed sanitized refusal. This preserves offline conformance and diagnostics.
- No retry occurs. Every request is abortable, timed out, response-size limited, and restricted to a
  reviewed method/path supplied by the closed descriptor.
- Product evidence uses only fresh synthetic fixtures. No VM, old repository, private bundle, real
  firewall, credentials, plugin, mutation, Windows, benchmark, release, or broad-client claim.

## Task 1: Closed generic-resource authorization seam

**Files:** Modify `src/capabilities/{types,kernel,catalog}.ts`, `src/mcp/results.ts`; add focused
kernel/catalog/result tests.

- [ ] RED: prove a generic resource tool cannot currently be visible for one allowed resource while
  selecting and authorizing only that resource.
- [ ] Add a separate trusted `defineResourceCapability` path. Capture its resolver and selectable
  scopes in kernel-private weak collections; keep public definitions data-only and immutable.
- [ ] Parse strict input, resolve against the visibility-filtered closed scopes, canonicalize the
  resolved input, then authorize the exact effective scopes before invoking the handler.
- [ ] Add fixed safe refusal codes/details for unknown resource, unavailable operation, invalid
  resource input, and unavailable target. Details are bounded public names only.
- [ ] Prove allow-list filtering, direct forged calls, deterministic visible-only suggestions, raw
  input non-reachability, resolver immutability, and unchanged behavior for existing capabilities.
- [ ] Run focused tests, `npm run typecheck`, `npm run license:check`, and commit atomically.

## Task 2: Two-resource contract and progressive discovery

**Files:** Add `src/operations/` contract/loader/generated descriptors and generator; add
`src/capabilities/opnsense/describe.ts`; modify catalog and instructions; add contract, discovery,
instruction, and context-budget tests.

- [ ] RED: require a schema-versioned two-resource contract, reproducible contract/schema digests,
  and `opn_describe` query/exact behavior.
- [ ] Define local schemas and metadata for only the two read tuples. Mark the service-search
  transport `mock-candidate` and preserve both official documentation references.
- [ ] Generate deterministic data-only descriptors and fail contract validation on external schema
  references, missing effects/scopes/evidence, duplicate keys, or generated drift.
- [ ] Implement `opn_describe`: at most five stable summaries, exact safe schemas/digests, and at most
  three deterministic suggestions drawn only from visible resources. Never return API paths.
- [ ] Update instructions: describe unfamiliar resources first, clarify an ambiguous non-technical
  request, and never infer mutation permission.
- [ ] Measure canonical `tools/list` bytes with the approved 131072-byte total and 16384-byte per-tool
  ceilings; record the focused evidence in a committed JSON fixture.
- [ ] Run focused tests, generator drift check, typecheck/license gates, and commit atomically.

## Task 3: Secure HTTPS reads and product composition

**Files:** Add `src/opnsense/{config,https-client,read-adapter}.ts` and
`src/capabilities/opnsense/{get,list}.ts`; modify runtime config, default application composition,
catalog, and relevant exact-tool tests; add synthetic HTTPS mock, client, adapter, composition, and
dual-era MCP integration tests.

- [ ] RED: start a synthetic HTTPS target and prove the current packed application cannot execute the
  two resource reads.
- [ ] Load the private config without exposing it on `ApplicationContext`; require an absolute regular
  POSIX `0600` file in this increment and strict JSON/HTTPS URL validation.
- [ ] Implement Basic key/secret auth, TLS verification/default trust or explicit CA, abort/timeout,
  request/response bounds, exact method/path requests, no retries, and fixed sanitized failures.
- [ ] Normalize only reviewed response fields. `opn_get` accepts only `system.status`; `opn_list`
  accepts only `core.services` and returns a bounded page envelope.
- [ ] Replace the existing default composition body with the product-owned catalog/client and pass the
  client closer through the existing owned-runtime drain order. Keep `server_status`.
- [ ] Prove both MCP eras list the four read tools and can describe/get/list against the mock with
  `READ_ONLY=true`; test TLS/auth/error redaction and allow-list/direct-call refusal.
- [ ] Run focused tests, full `npm run verify`, and commit atomically.

## Task 4: Installed package, OpenCode smoke, and user evidence

**Files:** Extend installed-package fixtures/tests; add isolated OpenCode smoke runner/evidence;
update `README.md`, `CONTRIBUTING.md`, package scripts, and Product 1A evidence/non-claims.

- [ ] RED: require a clean `npm pack` install to discover and execute all Product 1A reads against a
  separately owned synthetic HTTPS mock.
- [ ] Extend the existing bounded installed-package harness without adding runtime prerequisites or
  weakening POSIX cleanup. Prove config/CA/mock ownership, secret redaction, EOF shutdown, and residue
  cleanup.
- [ ] Run an isolated project-level OpenCode configuration against the installed tarball and mock.
  Record exact OpenCode version, package SHA, tool selected, result digest, cleanup, and narrow claim.
  If the authenticated model service is externally unavailable, retain deterministic package proof
  and report the smoke as blocked—never substitute another client or claim success.
- [ ] Document one concise local mock quick-start, what 1A proves, the POST/GET uncertainty delegated to
  1B, and the explicit non-claims. Do not publish or push.
- [ ] Run `npm run license:check`, `npm run verify`, both conformance profiles,
  `npm run provenance:verify`, `git diff --check`, and a final independent whole-branch review.

## Product 1A exit

The packed server, with `READ_ONLY=true`, exposes only read effects and proves describe/status/services
through MCP against the synthetic HTTPS mock, while its instructions turn an ambiguous request into a
pedagogical clarification instead of an invented diagnosis or change. A passing OpenCode run supports only
its recorded version.
Product 1B remains responsible for the disposable OPNsense 26 VM, real transport observation, contributor
VM bootstrap, and live cleanup evidence.
