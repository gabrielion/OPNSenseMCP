# OPNsense Product Vertical Plan Index

**Status:** Routing document; not directly executable

**Goal:** Replace the superseded parity monolith with independently reviewed vertical plans that deliver
useful OPNsense behavior early, preserve the closed MCP safety architecture, and attach the right evidence to
each product claim.

**Primary product outcome:** A non-specialist can install the local MCP server, ask a natural-language network
question, let the agent discover the exact supported operation, and receive a bounded OPNsense result. Writes
remain hidden by default and are introduced only after the common backup/audit/scope envelope is proven.

## Why this routing replaces the monolith

The official OPNsense API reference is intentionally broad and regular, but its generated tables identify
endpoints and likely HTTP methods more reliably than exact parameters or behavioral semantics. HTTP `POST`
also covers both read-like searches and mutations. Therefore generated breadth is a source of candidates, not
an authorization policy or proof of correctness.

The product uses the approved hybrid MCP design:

- a small fixed tool surface with one immutable effect/policy per capability;
- a reviewed data-only operation catalogue with exact schemas and evidence recipes;
- `opn_describe` plus MCP resources for progressive discovery;
- curated workflows for behavior that cannot safely fit one generic resource operation;
- one internal HTTPS client, kept separate from MCP registration and policy decisions.

The product does not use one tool per endpoint, a module-level arbitrary `method` dispatcher, runtime
reflection over a third-party client, or catalogue size as a reliability claim.

## Product increments

### Product 1A — First useful read-only vertical

Write and independently review one executable plan that adds only:

- the minimal versioned operation-contract envelope;
- `system.status` as a singleton read backed by documented `GET /api/core/system/status`;
- `core.services` as a bounded collection read. The official guide illustrates
  `POST /api/core/service/search` with pagination while the generated Core table currently lists `GET`; use
  the guide's POST shape for the mock candidate, record the discrepancy, and seal the OPNsense 26 transport
  contract only after Product 1B observes it on the disposable VM. Its read effect is reviewed rather than
  inferred from either candidate HTTP verb;
- `opn_describe`, `opn_get`, and `opn_list` with strict inputs, bounded/sanitized outputs, deterministic
  suggestions, and context-budget evidence;
- the minimum pedagogical instruction update: describe an unfamiliar resource first, clarify an ambiguous
  non-technical request, and never infer permission to mutate from user intent;
- OPNsense connection configuration and an internal abortable HTTPS client with Basic API-key authentication,
  TLS verification by default, optional explicit CA file, fixed timeouts, response limits, no retries for
  uncertain operations, and sanitized errors;
- unit, contract, mock, full MCP-to-mock, and locally packed-tarball-to-mock tests using only fresh synthetic
  fixtures.
- one isolated OpenCode smoke on the already available local client, using the installed tarball against the
  mock to discover and call the exact read capability; record the exact OpenCode version and make no claim for
  any other client yet.

Exit evidence: the locally packed MCP server can discover both resources, read system status, and list services
against the mock while `READ_ONLY=true`; the instructions handle an ambiguous request pedagogically. This
increment makes only the recorded OpenCode smoke claim and no VM, broad-catalogue, plugin, Windows, benchmark,
or release claim.

### Product 1B — Disposable-VM read and contributor path

Write and independently review a separate executable plan for a clean-room disposable OPNsense 26 lab. It
must derive its implementation from public OPNsense/QEMU contracts and fresh observations, not from a private
legacy asset. Host prerequisite diagnosis, image checksum pinning, credential isolation, start/stop ownership,
timeout, and residue checks are part of the product evidence.

Exit evidence: one command diagnoses prerequisites, one managed VM is provisioned, the packaged MCP server
performs the same `system.status` read and the `core.services` collection read, records which service-search
method and request shape OPNsense 26 actually accepts, and aligns the contract, mock, and tests before Product 1
is complete. Cleanup proves the VM is stopped with no repository credential or temporary MCP configuration.
Contributor documentation records both the happy path and every prerequisite the fresh host actually needed.

Product milestone 1 is complete only when both 1A and 1B pass. Product 1A implementation does not wait for
private provenance or VM migration.

### Product 2 — Central mutation envelope

Add no public mutation yet. Reuse and re-prove the foundation's default-true `READ_ONLY` hiding, forged-call
refusal, and operation-specific resource scopes, then add the real redacted audit intent/result, strict verified
configuration backup, target lock, sealed preflight/revalidation, bounded execution, outcome verification, and
fail-closed cleanup services. Use synthetic services and deterministic tests before any OPNsense write adapter
is admitted.

Exit evidence: every bypass path fails closed and the exact lifecycle order is asserted. A passing envelope
does not claim that a firewall mutation is available.

### Product 3 — One reversible, backed-up mutation

Choose one bounded OPNsense resource only after its live read contract and cleanup recipe are observed on the
disposable VM. Add its strict create/update/delete or enabled-state schema without widening any other resource.

Exit evidence: setup owned state, read it, take and verify the backup, mutate through MCP, read back the exact
effect, reverse it, prove absence, and stop the VM. Any indeterminate outcome preserves backup and reconciliation
guidance; it is never reported as success.

### Product 4 — Independently shippable use-case verticals

Catalogue expansion is a continuous supporting lane, not a parity gate. Each operation tuple actually exposed
gets reviewed schema/effect/scope metadata and its required offline, mock, VM, and agentic evidence. Plugins are
individually opt-in and verified on the target. Curated tools and workflows are added only where generic
resource semantics are insufficient.

Deliver the three chosen scenarios as separate executable plans with separate exit gates:

1. **Product 4A — pedagogical read-only investigation:** collect a bounded set of network observations, explain
   them for a non-specialist, and ask for clarification instead of inventing a diagnosis. Mock plus disposable-
   VM reads are required; no mutation is admitted.
2. **Product 4B — per-device domain block:** clarify the device identity and enforcement point, prepare a
   bounded plan, then use the proven mutation envelope and VM lifecycle to apply, read back, reverse, and prove
   absence.
3. **Product 4C — internal service publication:** compose local DNS, a local certificate, and the selected
   reverse-proxy plugin only after every primitive has its own proof. The workflow verifies the internal URL,
   reverses owned state, and proves no residue.

Public DNS, public ACME, and Internet exposure remain outside the local-lab claim until a later public-cloud
test environment exists. Product 5 and an initial release do not wait for all three Product 4 plans or for
catalogue parity; they require evidence only for the capabilities and workflows actually shipped.

Fresh clean-room implementations and tests may proceed immediately. Reuse of a legacy test, VM script, or
documentation asset waits for its approved provenance copy gate. Structural coverage and live behavior remain
separate metrics.

### Product 5 — Clients and pedagogy

After Product 1 is stable, write the replacement Guided plan for one-command local use from Claude Code,
Codex, OpenCode, Kimi Code CLI, and other explicitly tested MCP clients; it may proceed while later Product 4
verticals are still being developed. Instructions and prompts teach the agent to
clarify vague non-technical requests, discover schemas before unfamiliar operations, explain planned changes,
and preserve read-only defaults. Each support statement is tied to a versioned client smoke.

Prefer each client's native marketplace/plugin format where that format can package an MCP server; retain a
direct MCP-configuration fallback. OpenCode support uses its native `mcp` configuration rather than presenting
an unrelated JavaScript hook as an MCP plugin.

The published package and client setup use ordinary Node.js/npm or `npx`; Windows users do not install WSL,
QEMU, a native helper, or a postinstall service merely to run the MCP server. Public documentation carries the
AGPL-3.0-or-later license and the independent-project/non-affiliation notice without implying endorsement by
OPNsense or Deciso.

### Product 6 — Pre-publication proof

Repin all MCP v2 packages together to the stable release, rerun deterministic and official conformance gates,
then run the complete canonical agentic benchmark on the clean release candidate. Finally obtain the mandatory
native Windows installed-package evidence as the last platform gate. Only committed attestations may feed
README scores or release claims.
The benchmark model is an explicit parameter with the owner-selected balanced default (Claude Sonnet for the
Claude CLI runner); every attestation records the resolved model identity, CLI version, git revision, hashes,
tool trace digests, setup/cleanup, and residue result. On capacity or quota failure, the runner writes the
checkpoint and stops with a distinct status; the same command resumes later without silently switching model
or changing the comparison.

Any fix after the canonical benchmark—including a Windows-only fix—creates a new candidate and requires the
deterministic gates, benchmark, and final Windows gate to run again in that order.

## Evidence ladder

Every vertical moves through the smallest applicable sequence:

1. contract/schema validation;
2. pure unit tests;
3. MCP-to-mock behavior;
4. disposable-VM lifecycle when target behavior is claimed;
5. client routing when client support is claimed;
6. agentic benchmark on the clean release candidate;
7. native Windows package/runtime/mock evidence last.

A later layer never retroactively repairs a missing earlier contract. VM evidence proves only the tested
firmware/scenario; the local lab does not prove public-Internet DNS, ACME, or provider routing. A future public
cloud lab is a long-term roadmap item after the local safety and release gates, not part of the initial product.

## Plan and implementation gates

- Product 1A is the next product plan to write and review. It may be planned and implemented independently of
  private provenance Task 2A/2B.
- Each Product increment has its own executable TDD plan, two-stage independent review, focused gate, atomic
  local commits, and explicit non-claims.
- Product 4 expansion never becomes a release threshold by resource count. Every operation shipped must have
  its required evidence; an unimplemented resource remains simply unavailable rather than release-blocking.
- No Product plan may silently import interfaces from the superseded parity plan. It must consume the current
  foundation exports and the approved operation-catalog and supported-host designs.
- No push, publication, package release, benchmark score, or broad compatibility claim is authorized by this
  routing document.

## Normative inputs

- `docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md`
- `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md`
- `docs/superpowers/plans/2026-07-17-mcp-v2-foundation.md` and current reachable foundation source
- Official OPNsense API reference: <https://docs.opnsense.org/development/api.html>
- Official OPNsense Core endpoints: <https://docs.opnsense.org/development/api/core/core.html>
- Official MCP TypeScript SDK v2 source/docs: <https://github.com/modelcontextprotocol/typescript-sdk>
- Official Claude Code MCP documentation: <https://code.claude.com/docs/en/mcp>
- Official OpenCode MCP documentation: <https://opencode.ai/docs/mcp-servers>
- Official Kimi Code CLI source: <https://github.com/MoonshotAI/kimi-cli>
