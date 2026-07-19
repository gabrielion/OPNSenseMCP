# OPNsense Operation Catalog and Progressive Discovery Design

**Date:** 2026-07-19

**Status:** Approved through delegated owner decision; written specification

## Context

OPNsense exposes a large, regular API surface spanning base modules and optional plugins. Mapping every API
method to one MCP tool would create an unreasonably large tool surface. Grouping every method of a module
behind one `method` string reduces the number of tool names, but it still sends a large method enumeration to
clients, mixes reads and destructive writes behind one policy identity, and cannot express exact parameters or
effects without rebuilding a second dispatcher inside that tool.

The approved architecture and implementation plans already establish the safer foundation: one closed
capability catalog, one authoritative policy kernel, a versioned OPNsense resource contract, generic resource
operations, curated domain capabilities, read-only by default, and strict backup-before-write. This design
keeps those boundaries and strengthens the operation catalog, validation, discovery, plugin, and context-size
contracts before product implementation begins.

## Decision

Use a hybrid surface:

- a small fixed set of generic resource tools with one unambiguous effect each;
- curated domain tools and guided workflows for operations whose semantics cannot be represented safely by a
  generic resource verb;
- progressive discovery through `opn_describe` and read-only MCP resources;
- a deterministic generated operation catalog whose source is a reviewed public contract, never runtime
  reflection over a client library.

Do not add a module-level `method: string` dispatcher. Do not add one MCP tool per OPNsense endpoint. Do not
extract the HTTPS client into another package until a second real consumer exists.

This specification supersedes conflicting clauses in
`docs/superpowers/plans/2026-07-17-opnsense-product-parity.md` and
`docs/superpowers/plans/2026-07-17-guided-workflows-clients-release.md`. No Product Task may start until those
plans are rewritten and reviewed against this specification. In particular, the revised plans must replace
the old `ResourceDefinition` and generic-result contracts, implement real search/describe behavior, remove
public generic apply and service operations, eliminate handler-side raw-value parsing, key evidence by resource
operation tuple, add individual plugin configuration, expose only public operation names in MCP resources, and
use `opn_set_enabled` rather than an ambiguous toggle capability.

## Public MCP surface

The generic public tools are:

- `opn_describe`: find visible resource summaries by bounded query or describe one exact visible resource and
  its available operations;
- `opn_list`: search or paginate a collection;
- `opn_get`: retrieve one declared resource;
- `opn_create`: create one resource with a reviewed create schema;
- `opn_update`: update one resource with a reviewed update schema;
- `opn_delete`: delete one resource with a reviewed identifier contract;
- `opn_set_enabled`: idempotently set one resource's reviewed enabled state.

`opn_describe`, `opn_list`, and `opn_get` are read capabilities. Each mutation verb is a separate
`firewall-write` capability and therefore cannot share a policy identity with a read. Apply/reconfigure is an
internal catalog step executed and verified by an admitted mutation; it is not a generic public tool. Service
status and service mutation are represented by separately classified curated capabilities, not one ambiguous
generic service dispatcher.

One MCP capability has one immutable policy. No caller-supplied discriminator may select a different handler,
effect, backup rule, audit rule, confirmation rule, or redaction rule. For a generic operation, a resource key
may select only one reviewed data-only descriptor from the closed catalog: exact scope, schema, endpoint,
plugin prerequisite, and apply metadata. The capability's immutable resolver validates and seals that descriptor
before authorization and preflight; it cannot select executable code or weaken policy. Any other aggregation is
allowed only when every branch shares the capability's exact policy and each branch has a reviewed runtime
schema. Dynamic lookup of a client method is never an authorization boundary.

High-level tools retain exact domain schemas and human descriptions. They compose the generic service or
dedicated adapters without bypassing the policy kernel. Raw API access remains a distinct advanced capability,
disabled by default and outside the generic resource contract.

## Reviewed operation catalog

The versioned public product contract is the normative input. For each resource it records:

- stable key, label, category, module, controller, wrapper, and firmware target;
- required OPNsense plugin and supported plugin version range when applicable;
- each supported public operation and its exact OPNsense command;
- operation effect, local input schema reference, local output schema reference, and size limits;
- apply/reconfigure behavior when required;
- immutable capability assignment and the effective resource scope selected by that capability's sealed
  resolver;
- offline, mock, VM lifecycle, and agentic evidence requirements.

Every schema reference is a local JSON Pointer into declarative `$defs` contained in the same versioned
contract document. The contract digest therefore binds the schema bytes reviewed with each operation. External
schema references, executable validators, callbacks, and schema files mutable outside that digest are invalid.
Feature flags, credentials, backup, audit, confirmation, timeout, and redaction remain immutable
capability-level policy. An operation requiring a different policy class must use a distinct curated
capability; a resource descriptor may only narrow the effective resource scope and add target compatibility
prerequisites.

Contract entries are authored from current public OPNsense documentation or source contracts and fresh
disposable-VM observations. A generator verifies the contract digest, emits data-only endpoint metadata and
closed runtime schemas, records the firmware target and source references, and produces stable content hashes.
CI regenerates into a temporary location and refuses any unreviewed difference.

Generation must not:

- instantiate or reflect over a third-party API client;
- crawl a live website during normal build, test, install, or publication;
- infer read/write/destructive effects from HTTP verbs or method-name prefixes;
- expose a newly discovered endpoint or plugin property without contract review;
- accept an external schema reference, executable schema, or callback object from an extension.

The HTTPS client remains a small internal boundary consuming validated catalog requests. It owns TLS,
authentication, timeouts, cancellation, response limits, safe retries, and sanitized errors. It contains no
MCP registration or policy decision.

## Runtime validation

Every generic input schema is strict and bounded. During the capability input-schema phase, before allow-list
authorization, confirmation digesting, preflight, or network I/O, the runtime resolves the selected resource
from the closed catalog and parses the resource-specific operation payload with the generated schema. It then
freezes one normalized input bound to the exact descriptor and schema digests. Policy scope resolution,
confirmation, and preflight consume only that normalized input; the handler receives neither the caller's raw
resource value nor an opportunity to reselect a descriptor. Unknown fields are rejected before authorization.

A resource may be readable without being generically writable. A generic mutation tuple `(resource key,
public operation)` is exposed only when all of the following exist:

- a reviewed resource-specific input schema;
- an exact effect and resource scope;
- a strict backup and audit policy;
- a bounded preflight and post-write verification contract;
- a VM lifecycle recipe or an independently reviewed exclusion for a genuinely irreversible operation.

Missing write metadata fails closed during application composition and contract validation; it is not deferred
to the first live call. The generic `value: Record<string, unknown>` shape may exist only at the transport
boundary before resource-specific parsing. No handler or HTTPS request receives that unparsed value.

Success responses are validated against bounded operation-specific output schemas. A generic response schema
must at least define the exact envelope, collection or object shape, size limits, and sensitive-field policy;
it need not pretend that undocumented row fields are statically known. Unknown output properties are dropped
unless the reviewed contract explicitly permits bounded passthrough for a resource demonstrated to be
non-sensitive, and central recursive redaction still applies afterward. Curated capabilities expose exact
domain output schemas. Malformed or oversized OPNsense responses become fixed sanitized errors. Raw backup XML,
private keys, credentials, packet captures, and other declared sensitive fields never cross the MCP boundary.

## Progressive discovery and errors

In query mode, `opn_describe` returns at most five deterministic visible resource summaries. In exact-resource
mode it returns only safe public metadata:

- resource key, label, category, and description;
- available public operations and their effects;
- required plugin and feature state;
- bounded input and output JSON Schemas;
- schema and contract digests.

It omits API paths, credentials, configuration values, backup contents, audit paths, and hidden operations.
The existing product resource index remains a compact summary; a resource-specific read or template may expose
the same safe description for clients that support MCP resources. `opn_describe` remains available because not
all target clients use resources equally.

Unknown resource names return `UNKNOWN_RESOURCE` with at most three deterministic suggestions selected only
from resources visible to the active application and caller context; the error does not echo the unknown input.
An unsupported verb returns `OPERATION_NOT_AVAILABLE` and the visible verbs for that resource. Invalid data
returns `INVALID_RESOURCE_INPUT` with bounded field names and constraints but never rejected values. The
runtime never autocorrects a name, silently selects another resource, or dispatches a suggested operation.

Server instructions and the pedagogical prompt tell an agent to call `opn_describe` before a generic mutation
when it does not already have the exact current schema. A prepared workflow does not need this extra call
because its own schema and planner are authoritative.

## Optional plugins

Plugins are opt-in individually in the private configuration. There is no global `include all plugins` switch
in the recommended product surface. Enabling one plugin cannot expose another plugin's resources.

Plugin-backed resources are visible only when their plugin is explicitly enabled. Before the first resource
operation, a bounded read-only target inventory request verifies the OPNsense firmware against the reviewed
catalog range and, when applicable, verifies that the required plugin and supported version are present.
Mutations revalidate these prerequisites inside their sealed preflight rather than relying on a stale read
cache. A mismatch returns `TARGET_FIRMWARE_UNSUPPORTED` or `PLUGIN_UNAVAILABLE` before mutation audit intent or
backup. A forged call to a hidden plugin resource is refused by the same catalog and policy boundaries as every
other hidden capability.

Curated workflows may declare required plugins. Their prepare step reports the missing prerequisite
pedagogically and performs no mutation. Disposable-VM setup installs only the plugins required by the scenario
under test and verifies their exact versions.

## Context budget

The tool surface is bounded for clients that load every definition, even when another client offers tool
search. A deterministic test measures the exact public `tools/list` definitions for the default read-only
profile, the writable base profile, each supported plugin profile, and the supported maximal profile. It sorts
tools by MCP name, recursively sorts every JSON object key by Unicode code point while preserving array order,
rejects non-finite numbers, serializes the resulting definition array with `JSON.stringify` and no surrounding
JSON-RPC envelope or whitespace, and measures `Buffer.byteLength(serialized, 'utf8')`. A single-tool measurement
uses the same canonicalization on that tool object. Every profile enforces:

- at most `131072` UTF-8 bytes for the complete compact tool-definition array;
- at most `16384` UTF-8 bytes for any one compact tool definition;
- no enumeration of raw OPNsense method names inside a generic tool schema;
- no complete resource-key catalogue duplicated inside each generic tool schema;
- no duplicate method catalogue embedded in runtime code.

The test records actual byte totals, tool count, and largest definition as machine-readable evidence. These are
initial anti-regression and resource-consumption budgets, not proof of client interoperability. Plugin profiles
must remain within the same limits or reduce their initial surface through progressive discovery; enabling
plugins is not permission to discard the budget. Changing either limit requires a reviewed design change.
Versioned client smokes remain the evidence that a real client can discover and route the surface correctly.

## Safety and recovery

Existing safety contracts remain authoritative:

- `READ_ONLY=true` hides and refuses every firewall mutation by default;
- a strict verified configuration backup precedes the first outbound write of every admitted mutation;
- after admission, target lock, sealed preflight, redacted audit intent, strict verified backup, state
  revalidation, bounded execution, output verification, final audit, and lock release preserve that fixed order;
- credentials and sensitive configuration never appear in arguments, logs, MCP results, or evidence;
- TLS verification is enabled by default and private certificate authorities use an explicit CA file.

A full configuration restore is not an automatic generic error handler. A workflow may execute a reviewed,
idempotent compensating action and verify it while retaining the original backup. If compensation is unsafe or
the outcome is indeterminate, the server preserves the backup, reports fixed reconciliation guidance, and
requires an explicit separately authorized restore. This prevents a blind restore from undoing concurrent or
otherwise valid changes.

## Testing and evidence

The deterministic gate proves:

- exact contract, schema, generated-data, and digest agreement;
- strict parsing and normalization for every exposed operation shape;
- refusal of missing schemas, classifications, scopes, plugin metadata, and evidence recipes;
- unknown-field, oversized-input, malformed-output, suggestion, and information-disclosure behavior;
- context budgets and absence of duplicate raw method catalogues;
- read-only, allow-list, feature, plugin, backup, audit, confirmation, timeout, cancellation, and redaction
  bypass resistance.

Mock tests exercise at least one success and one representative failure for every operation shape and every
resource family. Curated capabilities have direct contract tests for their domain semantics.

Every exposed generic mutation tuple `(resource key, public operation)` has a separately keyed disposable-VM
lifecycle or reviewed irreversible exclusion; evidence keyed only by the generic MCP tool name is insufficient.
A lifecycle sets up owned state, reads it, mutates it through MCP, reads back the exact effect, reverses or
compensates it, and proves no owned residue. Plugin-backed lifecycles also prove plugin inventory and version
checks. The VM wrapper always performs global residue verification and shutdown.

The agentic dataset includes resource discovery, an exact-schema mutation, unknown-resource suggestions,
plugin prerequisites, read-only refusals, and a vague request that must be clarified. Benchmark reports separate
correct tool selection from API success and never treat catalog coverage as behavioral evidence.

Client smokes include semantically distinct prompts or deterministic routing probes that must select the exact
generic or curated capability for the recorded client version. A small tool count or a client's advertised tool
search feature is not accepted as evidence of correct discovery.

## Rejected alternatives

### One tool per OPNsense endpoint

This maximizes static schema precision but creates an excessive discovery surface, duplicates policy metadata,
and makes cross-client context behavior depend on tool-search support.

### One dispatcher tool per OPNsense module

This reduces tool names but combines unrelated effects, requires a large nested method catalogue, weakens
operation-specific validation, and lets client-library surface changes influence the MCP contract.

### Separate published API client package now

The internal HTTPS boundary is already independently testable. A second package would add release ordering,
version skew, provenance, and support cost without a second consumer. Extraction remains possible later without
changing its interface.

## Success criteria

- No public generic tool accepts or dispatches an arbitrary OPNsense method name.
- Every exposed generic mutation tuple has a strict resource-specific schema and either an executable VM
  lifecycle or an independently reviewed irreversible exclusion with required offline evidence.
- Read and write operations have different capability identities and authoritative effects.
- Progressive discovery gives agents exact current schemas without placing the complete API in `tools/list`.
- Optional plugins are enabled and verified individually.
- The generated catalog is deterministic, review-bound, drift-checked, and independent of runtime reflection.
- The default and plugin tool surfaces meet the fixed serialized context budgets.
- Catalog breadth is never presented as proof of correctness; mock, VM, and agentic evidence remain distinct.
