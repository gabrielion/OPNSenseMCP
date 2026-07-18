# OPNSenseMCP Independent MCP v2 Rebuild Design

**Date:** 2026-07-17

**Status:** Approved for implementation

**Project license:** AGPL-3.0-or-later

## Purpose

Build a new, independently versioned OPNSenseMCP implementation that preserves the complete supported
product while replacing its internal architecture. The server must remain safe for a production-sensitive
firewall, easy to install in mainstream coding agents, and unusually transparent about what its tests do
and do not prove.

The new repository starts with a clean Git history. Provenance-approved assets created for this project may
be migrated. Files with mixed or uncertain lineage must be rewritten from behavioral requirements, public
specifications, and observations made against disposable OPNsense virtual machines.

The owner-supplied private pre-publication Git bundle is the authoritative history input. Some newer
owner-authored assets exist only in the owner's current working tree, so the same private preparation step
also captures an explicit allow-list of those bytes into an immutable overlay. It validates a
caller-supplied bundle digest, materializes a mode-`0700` read-only combined source outside the new
repository, and creates a mode-`0600` audit baseline. Neither input path, digest, mapping, reference, nor
content enters the public tree. Normal builds and tests never require either source; only the one-time
migration and private release provenance gate do.

## Product boundary

"Complete product" means every capability that is demonstrably reachable through the supported server,
CLI, installer, test harness, or separately supported runtime entry point. It includes capabilities that are
disabled by default and exposed only through explicit feature flags.

The replacement must cover:

- the curated MCP tools and the registry-driven OPNsense resource surface;
- read, create, update, delete, apply, service-control, describe, and advanced API capabilities where the
  current product exposes them;
- configuration backups, audit logs, restore guidance, and opt-in executable restore;
- default read-only operation, resource allow-lists, feature flags, secret redaction, and fail-closed tool
  classification;
- fixed parameterized SSH features and the legacy free-form shell surface when explicitly enabled;
- stdio, Streamable HTTP, and an isolated compatibility path for the deprecated SSE transport;
- development bootstrap, OPNsense VM provisioning, deterministic tests, live VM tests, agentic evaluation,
  attestations, installers, client plugins, and release documentation.

Dead, abandoned, or unreachable prototypes are not product functionality. They must not be migrated merely
because they exist in an older source tree. A future dashboard would be designed as a new product feature.

## Technology baseline

- Node.js 22.19 or newer within major 22 is the development and CI runtime.
- TypeScript uses strict type checking and ESM.
- MCP packages are pinned exactly to `2.0.0-beta.4` during initial development:
  - `@modelcontextprotocol/server`;
  - `@modelcontextprotocol/client` as a development dependency;
  - `@modelcontextprotocol/node` for Node HTTP integration;
  - The optional `@modelcontextprotocol/express` helper package is not installed because this project
    owns a stricter middleware order: exact Host -> exact serialized Origin -> shutdown admission gate ->
    bounded body receipt -> authentication. The gate closes synchronously before transport-owner drainage
    so active HTTP/1.1 connections cannot admit another MCP request after shutdown begins.
- Because the v2 beta server package does not expose the deprecated SSE transport, the optional legacy SSE
  adapter pins `@modelcontextprotocol/sdk` exactly to `1.29.0` and isolates its server and types from the v2
  assembly. It shares only the typed capability catalog and business handlers, and its necessity is reviewed
  again before release.
- Zod 4 supplies Standard Schema definitions and is a direct dependency.
- No code imports `@modelcontextprotocol/core-internal`.
- Lockfiles and all test-tool versions are committed and exact.

Before a public release, the project must re-evaluate the stable MCP SDK available at that date. If
`2.0.0` is stable, the release candidate must repin to it and pass the entire offline, applicable protocol,
client, VM, and agentic test matrix. A beta package must not be published as a stable project release without an
explicit, documented exception.

## Architecture

### Server factory and protocol adapter

`buildServer(context): McpServer` is the only place that assembles MCP primitives. Business logic never
depends on transport objects or beta-specific request shapes.

- `serveStdio(buildServer)` is the default entry point and serves compatible 2025 and 2026 protocol clients.
- Streamable HTTP uses `createMcpHandler(buildServer)` plus the official Node adapter.
- Deprecated SSE, when explicitly enabled for a legacy client, runs through a separate compatibility adapter
  with the same HTTP security policy and no business logic; it is disabled by default and cannot silently
  downgrade a Streamable HTTP session.
- Protocol-specific elicitation, request state, structured content, and error conversion stay inside the MCP
  adapter.

This boundary permits an SDK upgrade without rewriting OPNsense operations, safety policy, or tests.

### Capability catalog

A typed capability catalog is the single source of truth for every exposed operation. Each record contains:

- stable capability and MCP names;
- human title, description, input schema, output schema, and annotations;
- handler reference and supported transports;
- read, local-write, or firewall-write effect;
- OPNsense resource scopes;
- required feature flags and credentials;
- backup, audit, confirmation, timeout, rate-limit, and redaction policies.

Tool listing, direct dispatch, documentation, client metadata, test coverage, and the agentic dataset are
derived from this catalog. An undeclared capability fails closed. MCP annotations remain descriptive only;
the server-side policy engine is authoritative.

### OPNsense boundary

The OPNsense layer contains an independently implemented HTTPS client, typed endpoint definitions, response
normalization, and domain modules. It preserves observed OPNsense API quirks without copying an earlier
implementation.

All outbound calls have:

- TLS verification by default;
- explicit connect and operation timeouts;
- cancellation support;
- bounded retries for safe transient failures only;
- sanitized errors and response-size limits;
- no credentials in command lines, logs, audit records, or MCP results.

Registry generation is reproducible and reviewable. Generated files record their public schema source,
firmware target, command, and content hash.

### Safety envelope

Every dispatch passes through one shared envelope before reaching a handler:

1. resolve the capability from the closed catalog;
2. verify exposure flags and caller scope;
3. validate and normalize structured input;
4. enforce read-only mode and resource allow-lists;
5. enforce rate and timeout limits and acquire the target firewall's mutation lock when required;
6. run the capability's declared side-effect-free, bounded read-only preflight and bind the exact effect
   plan plus observed-state digest;
7. record a redacted refusal or mutation intent;
8. create a strict pre-change snapshot for every OPNsense configuration mutation and prove its state still
   matches the sealed preflight before the first write;
9. execute only the sealed apply phase with cancellation;
10. verify the declared outcome, sanitize output, record the final audit event, and return structured MCP
    content.

`READ_ONLY=true` is the default. Mutations are both hidden from discovery and refused at dispatch, so cached
or forged tool names cannot bypass policy. Raw API, restore, IaC, fixed SSH, and free-form shell capabilities
remain separately gated. Free-form shell access stays off in recommended deployments.

Backups contain sensitive firewall configuration. Directories use mode `0700`, files use `0600`, symlinks
are refused, checksums are verified, and backup XML never crosses the MCP boundary. Every firewall mutation,
including advanced API, IaC, SSH, and shell paths, requires a strict pre-change backup. A failed backup
prevents the mutation. Privileged local changes that do not touch OPNsense configuration remain audited and
declare an explicit recovery policy in the capability catalog.

### High-level workflows

Expert tools remain available for parity, but common user goals gain typed workflows:

- publish, verify, and remove an HTTPS service on the internal network using internal DNS, an internal
  certificate, and HAProxy;
- block a domain for a specified device without silently applying a global block;
- investigate a network problem in read-only mode and explain observations in non-technical language.

Mutating workflows use a two-step prepare/apply contract. Preparation returns an exact plan and an opaque,
short-lived state token bound to the user context, method, normalized arguments, observed state, and expiry.
Application revalidates the state and completes every side-effect-free dependency preflight before taking one
strict recovery snapshot. It then applies the sealed changes in dependency order and verifies the result.
On failure it restores or compensates from that same recovery anchor without replacing it; rollback is
audited, verified, and a rollback failure remains an explicit failed transaction requiring operator action.
Caller-provided confirmation booleans are never trusted as proof of consent.

For internal service publication, DNS is announced last. Verification covers DNS resolution, certificate
SAN and chain, HAProxy state, backend reachability, and cleanup residue. Managed objects carry ownership
metadata; collisions with unmanaged objects fail closed.

### Pedagogical behavior

Short server `instructions` establish the default behavior: accept non-technical requests, begin with
read-only discovery, ask one material question at a time, never invent topology, explain the effect and
recovery path before a mutation, and distinguish proof from hypothesis.

Discoverable prompts cover network diagnosis, internal service publication, and device-scoped domain
blocking. Prompts are user-controlled conveniences, not security controls. Equivalent client skills provide
the guidance when a host does not surface MCP prompts or instructions consistently.

Elicitation is used only when the client advertises support. Unsupported confirmation or missing material
input fails closed and returns a clear next step. Secrets are never requested through form elicitation.

## Transport security

Stdio is the recommended deployment. It writes protocol messages only to stdout and all diagnostics to
stderr or private files.

Streamable HTTP is disabled unless explicitly configured. When enabled it requires:

- exact Origin validation with HTTP 403 for an invalid Origin;
- Host validation and loopback-only binding by default;
- authenticated requests, authorization checked on every request, and least-privilege scopes;
- cryptographically random session identifiers that are never treated as authentication;
- bounded bodies, requests, streams, sessions, and concurrency;
- clean shutdown and cancellation handling.

Remote exposure requires TLS and standards-compliant authorization. A local development exception must be
explicit, loopback-only, loudly documented, and unavailable in production mode.

## Distribution and client support

The server is published as a public npm package with a minimal executable shim. Credentials remain in one
private configuration file outside client JSON and outside process arguments.

Release metadata includes a validated `server.json` and a verified namespace suitable for the official MCP
Registry. The registry entry points to the npm artifact; it does not replace package hosting.

Codex, Claude Code, OpenCode, and Kimi each receive:

- an idempotent installer or documented one-command configuration;
- a connection smoke test against the installed client version;
- a pedagogical skill or equivalent client guidance;
- an uninstall path that preserves user-owned configuration and secrets.

Support is claimed only after a real smoke test. Client paths and formats are obtained from current official
client documentation and are never guessed.

Codex and Claude Code use their native repository marketplace manifests. Current Kimi Code uses its native
custom-plugin installation flow, including an embedded MCP server declaration and pedagogical skill. OpenCode
plugins are runtime hook modules rather than MCP packages, so OpenCode support uses its native `mcp`
configuration and management commands instead of pretending an incompatible marketplace artifact exists.

## Provenance and migration

The migration inventory uses three classes:

- **approved:** independently reviewed owner-authored assets supported either by the verified history bundle
  or by the immutable allow-listed owner-worktree overlay; copy and adapt under AGPL-3.0-or-later while the
  private baseline retains the source class;
- **rewrite:** mixed-lineage files whose requirements may be retained but whose expression must be replaced;
- **discard:** inherited, obsolete, or unreachable files that are neither copied nor published.

The verified private inputs support direct reuse of the project's VM harness, agentic evaluation, guardrails,
transport-security tests, backup tests, installer, plugins, and recent documentation modules, subject to
adapting imports and assertions to the new architecture. The public README, contribution guide, and backup
implementation are rewritten. Obsolete tests outside the active test chain are discarded and recreated only
when their behavior remains part of the product boundary.

Every migrated file gets a minimal public provenance entry recording only its destination, class, reviewed
destination digest, and audit verdict. Source mappings, source commits, approved input digests, and review
evidence remain in an external private baseline. Before publication, automated exact-blob, similarity,
forbidden-reference, and secret scans run against the release tree and full new history with that baseline.
The private history bundle and baseline are never copied or published.

## Testing strategy

### Deterministic offline gate

Every commit runs formatting, linting, strict type checking, build, unit tests, mock integration tests,
schema/catalog validation, generated-file drift checks, secret scans, license checks, and `git diff --check`.

Adversarial tests cover forged hidden calls, missing classifications, read-only bypass attempts, resource
scope bypasses, backup and audit failures, redaction, unsafe paths, output injection, transport attacks,
timeouts, cancellation, concurrency, and rollback failures.

### MCP protocol gate

The official MCP conformance package is pinned and its applicable, product-facing scenarios are run for both
the 2025 protocol and the 2026 draft supported by the selected beta. The committed evidence names every
scenario; it is targeted interoperability evidence, not a claim that the product implements the artificial
fixtures required by the complete conformance suite. Product-owned tests also exercise:

- capability discovery and negotiation;
- tools, resources, prompts, instructions, structured results, and execution errors;
- stdio as a child process;
- Streamable HTTP directly through the web-standard handler;
- elicitation and its fail-closed fallback;
- invalid inputs, missing arguments, pagination, cancellation, and concurrent calls.

MCP Inspector CLI provides an additional reproducible smoke workflow; its UI is documented for contributors.

### OPNsense VM gate

Only disposable managed OPNsense VMs are used. The harness performs host diagnostics, pinned-image and
plugin verification, provisioning, credential creation outside the repository, live tests, reverse cleanup,
residue checks, and shutdown. One managed VM runs at a time.

Live tests verify API behavior and real OPNsense configuration readback. They distinguish this evidence from
packet-filter, ISP, public DNS, public certificate, or Internet-reachability claims.

### Agentic gate

The ground-truth dataset covers every runnable capability and every typed resource, plus pedagogical
multi-turn workflows. Two profiles remain separate:

- `operator-preauthorized` for a disposable lab where mutations are explicitly authorized;
- `interactive-pedagogy` for vague requests where clarification must precede mutation.

Claude Sonnet is the default benchmark model and the runner accepts an explicit model parameter. A canonical
run records the exact model and CLI version, commit and dirty state, firmware, dataset/harness/catalog hashes,
tool inputs, result digests, setup, cleanup, residue, costs, and checkpoints. Capacity or quota failures stop
cleanly; a canonical run never silently switches or mixes models.

OpenCode receives a real end-to-end smoke run. Other clients receive installation and connection smoke tests
until a versioned trace adapter permits equivalent scoring.

## Documentation design

The README is intentionally high-level:

1. what the server helps a user accomplish;
2. compelling natural-language examples;
3. one-command installation for supported clients;
4. read-only-by-default and backup-before-write guarantees;
5. three concise evidence sections: tested today, not claimed yet, and roadmap;
6. the latest canonical benchmark result with links to machine-readable evidence.

`CONTRIBUTING.md` starts with three commands:

```bash
./scripts/bootstrap
./scripts/doctor
./scripts/test
```

Detailed VM, MCP conformance, agentic evaluation, security, release, and provenance guidance lives under
`docs/`. Claims distinguish deterministic structure, mock behavior, VM configuration behavior, agentic
observation, and external network behavior.

## Roadmap for external testing

The first complete release proves behavior in a disposable local OPNsense VM. It does not claim direct
Internet exposure through a real provider.

The long-term final test layer is a disposable cloud laboratory with a public IP, controlled public DNS zone,
public certificate issuance, HAProxy publication, external probes, strict cost limits, and automatic teardown.
It validates public reachability and provider behavior without ever using a production firewall.

## Delivery sequence

1. Establish the clean AGPL repository and implement the pinned MCP v2 foundation with offline and targeted
   protocol gates.
2. Establish public provenance tooling, then privately prepare the verified bundle plus allow-listed owner
   overlay and migrate only installer and VM substrate whose dependencies already exist.
3. Implement product parity Tasks 1–11. Migrate each safety or integration test group inside the exact product
   task that takes it from RED to green; never commit a permanently red migration task.
4. Migrate the now-reachable agentic harness, prove live parity with fail-safe VM cleanup, sanitize technical
   documentation, account for all 105 approved source migrations without freezing later destination bytes,
   and close the source-migration audit.
5. Add pedagogical workflows and distribution: native Codex/Claude marketplaces, the Kimi Code custom
   plugin flow, the
   OpenCode MCP adapter, npm, MCP Registry, README, contributing guide, and operational documentation.
6. Re-evaluate and, when available, repin the stable MCP SDK; complete all non-evidence implementation,
   independently review and seal the 105 approved plus 3 rewritten final destinations, and repeat every gate.
7. Select that clean sealed commit as the benchmark parent, run the full canonical benchmark, and allow only
   attestation artifacts, the redacted trace, the generated README evidence block, and their narrowly scoped
   provenance manifest/release-audit updates between the tested parent and signed tag. Re-review the final
   README digest, complete provenance/legal review, and only then publish after explicit operator
   authorization.

## Release gates

No push or public release is allowed until all of the following are true:

- the complete supported-product parity matrix is green;
- the project license and file headers are AGPL-3.0-or-later;
- no discarded or mixed-lineage expression remains in the release tree or its new Git history;
- deterministic tests and every committed applicable official MCP protocol scenario pass;
- supported clients connect successfully;
- live VM tests pass with verified cleanup and no secret residue;
- a canonical agentic report names the clean tested parent commit, and an automated gate proves the delta to
  the signed release tag contains only attestation artifacts, a redacted trace, the generated README evidence
  block, and the manifest/release-audit fields mechanically required to seal that re-reviewed README digest;
- README claims match the committed evidence;
- the selected MCP SDK is release-approved and exactly pinned;
- provenance, secret, dependency, and legal reviews are complete.
