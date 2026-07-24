# Post-cutover P0 Hardening Design

**Date:** 2026-07-25

**Status:** Owner-directed draft; implementation awaits written-spec review

## Outcome

Make the clean-history `OPNSenseMCP` repository a truthful, independently usable base before adding broad
feature parity. The work is split into three ordered P0 increments:

1. recover the public CI without weakening a gate;
2. make the standalone/public boundary accurate and keep writes explicitly experimental;
3. make the first mutation durable and semantically correct.

Only after all three increments are green may the project expand into the next read-only diagnostic vertical.

## Current evidence

The live product path is `src/main.ts` → `createDefaultApplicationRuntime` → the product capability catalogue
→ MCP registration and dispatch. With `READ_ONLY=true`, it exposes four tools (`server_status`,
`opn_describe`, `opn_get`, `opn_list`) over `system.status`, `core.services`, and read access to
`firewall.alias`. With writes enabled, `opn_create` and `opn_delete` are also exposed for host aliases.
Parallel or historical source trees are not part of the product unless this entry-point trace proves they are.

The repository is now the canonical public project with a clean Git history, while the former implementation
is retained separately and privately. The clean project does not depend at runtime on that private archive,
OpenCode, or the disposable VM. It is not yet ready to claim a standalone public release:

- the current public Linux CI run is red in the configure and installed-package groups and in the test named
  for the OpenCode output-limit path; the latter currently fails during package preparation before reaching
  the fake client;
- the README describes a stale read-only boundary and omits the implemented secure configure flow;
- mutation backups are stored in a per-run temporary directory deleted at normal shutdown, audit is an
  in-memory ring, and the lock is process-local;
- alias validation and read-back do not yet meet the Product 3 specification for exact host syntax,
  pagination, full-state identity, and exact outcome verification;
- packaging, release provenance, client support, and compatibility claims are incomplete.

Historical successful VM and OpenCode observations remain evidence for their exact tested scenario, not a
canonical attestation for the current public commit.

## Considered approaches

### 1. Import broad legacy parity

Copy the former registry, tools, IaC, shell, and dashboard trees into the clean repository. This would raise
the visible feature count quickly, but it would also restore the coupling, unsafe generic escape hatches,
duplicated architectures, and unverifiable surface that the cutover removed. Rejected.

### 2. Freeze permanently at the read-only slice

Repair CI and publish only the four read tools. This is the smallest release path, but it abandons the
already-proven bounded mutation architecture and postpones important safety defects. Retained only as the
public fallback if the durable mutation P0 does not complete.

### 3. Controlled reuse plus vertical reimplementation

Selected. Reuse only assets already authorized by the provenance contract, repair the product base, keep the
first write explicitly experimental until its durable guarantees are proven, and then add capabilities as
small end-to-end verticals. Legacy behaviour is an inventory and test oracle, not a source tree to merge.

## Global invariants

- Never target or test a production firewall. Live proofs use only the disposable local OPNsense VM.
- Use Node.js 22.19 or newer within major 22 for every deterministic gate.
- Preserve the centralized authorization, confirmation, backup, audit, revalidation, and verification order.
- Never weaken an assertion, ignore an exit code, reseal evidence without the real producer, or call a
  structural check an end-to-end proof.
- No credential, raw backup XML, private archive path, private source mapping, or private digest enters a
  public file, log, MCP result, or process argument.
- The current entry point and reachable dispatch define the product surface; dormant trees define nothing.
- Each implementation slice starts with a failing test, ends with focused and full gates, and is recorded in
  `.superpowers/sdd/progress.md` with its commit and remaining limitations.

## Approved-asset reuse

The owner authorizes reuse of already-approved assets, but the existing provenance lifecycle remains the
admission boundary:

1. select only a public-manifest destination whose class is `approved`;
2. run the private preflight against the accepted authorization snapshot;
3. copy only the exact authorized input to its exact destination;
4. independently review the resulting destination;
5. record the public destination digest and `approved-migrated` verdict;
6. run the public provenance, license, secret, and deterministic verification gates.

An approved row that is still `approved-pending-migration` is authorization to run this workflow, not
authorization to bypass it. New product code, adaptations, renamed expressions, or changes outside an exact
authorized destination are clean implementations and receive new tests. Public documentation records only
the destination-side result.

No exact legacy asset is selected for P0-A or P0-B. P0-C also uses a clean implementation: the approved
`src/security/audit-log.ts` candidate was reviewed and rejected because its global-environment coupling,
unbounded/interleavable writes, incomplete ancestor/link checks, and missing directory fsync do not satisfy
this design. Its append/`0600`/fsync/intent-result ideas may inform new code, but no expression is copied.
Every later plan must list the exact approved destinations it will migrate, or explicitly say `none`, before
opening the private provenance input.

## P0-A — Recover deterministic public CI

### Scope

Recover all failed groups on Ubuntu/Node 22 and keep the passing compatibility floor intact:

- configure tests;
- fresh-pack/fresh-install package tests;
- OpenCode output-limit smoke evidence.

### Design

For each group, preserve a minimal deterministic reproduction and identify the causal boundary before editing
production code.

The configure failures are fixture failures, not transaction failures. On Linux the fixture is created below
the global `/tmp` directory, whose sticky `01777` mode is correctly rejected by the secure writer's
ancestor-chain validation. Move the fixture below a canonical private user-owned ancestor and add a regression
that proves a sticky group/other-writable ancestor remains refused. Do not relax the production secure-file,
link, ownership, revalidation, fsync, or rollback contract.

The package and nominal OpenCode-output-limit failures share a non-hermetic package-preparation boundary:
`npm install --offline` resolves a local tarball in a fresh consumer without a lock and therefore depends on
packuments left in the user's npm cache. A recorded clean-cache reproduction returns `ENOTCACHED`; the
output-limit test never reaches its fake client.

Replace that dependency with one deterministic, loopback-only npm registry fixture. From the committed lock
and the `node_modules` tree produced by `npm ci --ignore-scripts`, the fixture enumerates every unique
production `name@version`, verifies the installed package identity and path containment, and packs it with
scripts disabled into a private temporary directory. It serves only canonical packuments and tarballs for
those locked versions on a random loopback port. The consumer receives a new home, empty user/global npm
configuration, an empty explicit cache, the loopback registry, disabled audit/fund/scripts, and proxy/registry
sentinels that make any non-loopback request fail. After installation, the normalized `npm ls` production
graph must equal the committed lock projection, the installed bin/shebang and package digest must match, and
the registry must report no unknown request. The helper removes and proves absence of registry, cache,
consumer, and tarballs. No user cache, public registry, hidden proxy, or developer working-tree module is a
fallback.

Remove npm's `--offline` flag from this path: the install is a normal script/audit/fund-disabled npm
install directed exclusively at the loopback registry. Network isolation and the complete local fixture, not
npm cache mode, prove that no Internet dependency exists.

On command failure, expose only a bounded, redacted exit code and stderr diagnostic so the causal error is not
replaced by `npm install failed`. The installed-package harness and the real OpenCode runner both consume this
preparation helper; the focused output-limit test injects the already-prepared installed invocation so its
failure cannot be masked by packaging.

Factor the OpenCode output-limit scenario so it proves the fake client was reached and the configured byte
cap was actually exceeded. After termination, wait for child close and confirmed process-group cleanup before
finalizing blocked evidence. Assert the expected process result before reading evidence so an absent file
cannot mask a local setup failure; the test may not manufacture evidence.

### Exit gate

- the three regressions fail before their respective fixes and pass after them;
- `npm run verify`, both MCP conformance profiles, and the public CI workflow pass on Node 22;
- no test weakens private-file validation, package isolation, output limits, cleanup, or evidence integrity;
- no temporary config, package, process, or smoke evidence remains after the run.

## P0-B — Truthful standalone and public boundary

### Scope

Align the reachable product, public documentation, default exposure, provenance status, and operator workflow.

### Write containment

Until P0-C is complete, public/default operation remains read-only. The exact new feature-flag token is
`experimental-alias-write`. Host-alias writes require all of:

- `READ_ONLY=false`;
- `ENABLED_FEATURE_FLAGS` containing `experimental-alias-write`;
- a non-empty `ALLOWED_RESOURCES` containing `firewall.alias`;
- stdio or Streamable HTTP transport.

An absent or empty allow-list continues to mean all catalogued scopes for read capabilities, but means no
allowed scope for every non-read effect. A non-empty allow-list filters reads and writes as it does today.
Listing and direct/forged dispatch enforce identical `READ_ONLY`, flag, scope, and transport conditions, in
that order. Legacy SSE always omits elicitation-backed writes. Stdio and Streamable HTTP list statically
eligible writes; at call time a client without negotiated `elicitation.form` receives
`CONFIRMATION_UNAVAILABLE` before a challenge or write. Discovery is not made session-dependent.

The Product 3 runner explicitly uses `READ_ONLY=false`,
`ENABLED_FEATURE_FLAGS=experimental-alias-write`, and
`ALLOWED_RESOURCES=system.status,core.services,firewall.alias`. Completing P0-C may remove the experimental
label only through a separate reviewed decision; it does not silently widen the default surface.

### Documentation and evidence

Update the README and operator documentation to state:

- the exact default and experimental tools/resources derived from the live catalogue;
- the secure interactive `configure` command and private configuration-file rules;
- the exact OPNsense ACLs proven for read-only and alias-write disposable accounts;
- stdio as the default transport and the bounded status/non-claims of HTTP transports;
- which firmware, host, client, and lifecycle scenarios were actually tested;
- that raw API, free-form shell/SSH, bulk IaC, restore, dashboard, and broad legacy parity are absent.

Add a single producer,
`scripts/vm/product3-alias.mjs --attestation-out <absolute-path>`, for
`docs/evidence/product3-vm.json`. It refuses a dirty starting tree and captures the tested commit and tree,
Node/host and protocol/client versions, pinned image release and digest, exact scenario and policy inputs, and
fixed setup/lifecycle/cleanup/residue booleans. It writes canonical versioned JSON atomically only after the
real lifecycle, cleanup, and residue proof succeed; it never records credentials, raw responses, XML,
backup identifiers, or private paths.

The evidence is committed separately after the tested commit to avoid self-reference. Its verifier accepts
it for a later commit only when the diff from the tested commit contains no change except that evidence file.
The prior Product 3 observation remains explicitly historical; it is never rebound or synthesized. The
producer runs once after P0-B and again after P0-C.

Remove or redact every stale non-synthetic private absolute path and obsolete status claim from the public
tree. Historical design records remain only after this sanitation; describing a private path as historical
does not make publishing it acceptable.

### Exit gate

- docs, generated catalogue evidence, `tools/list`, and direct dispatch agree;
- without a target, exactly four read tools are listed, `server_status` and `opn_describe` succeed, and
  `opn_get`/`opn_list` refuse with `TARGET_UNAVAILABLE` without network I/O;
- with a configured disposable target and `READ_ONLY=true`, all four reads succeed with bounded results;
- writes remain hidden/refused unless every experimental condition is satisfied;
- a missing/empty write scope fails closed;
- package/runtime operation requires no private archive, legacy repository, OpenCode, or VM asset;
- public files contain no private path, mapping, credential, or unsupported release claim.

## P0-C — Durable and correct first mutation

### State root and target identity

`OPNSENSE_MCP_STATE_DIR` is the only override and must be absolute. Defaults are:

- macOS: `$HOME/Library/Application Support/opnsense-mcp/state`;
- Linux: `$XDG_STATE_HOME/opnsense-mcp`, or `$HOME/.local/state/opnsense-mcp`;
- Windows: no write support in P0-C; requesting the write flag fails closed until an equivalent ACL and lock
  contract is designed and tested.

Every POSIX directory is owned by the current user with mode `0700`; every regular state file is owned by the
current user, single-linked, and mode `0600`. The loader rejects symlinks, unsafe ancestors, unexpected hard
links, ownership drift, non-canonical paths, and path components not generated by trusted code.

The root contains one random 256-bit `identity.key`. On concurrent first starts, each process writes and
fsyncs a private exclusive temporary file, then publishes it without replacement using a hard link. Exactly
one link wins; the winner and every loser unlink their own temporary path, and losers reread the winner. On
startup, fixed-name-pattern candidate files are opened without following links and validated; a candidate
sharing the published key's inode or an unpublished private candidate is safely unlinked, which recovers a
crash between link and cleanup without removing the published link. The parent directory is fsynced after
publication and cleanup, and no process uses the key until it is current-user-owned, `0600`, single-linked,
and exactly 32 bytes. An existing key is never overwritten.

The lock/state target identity is the normalized HTTPS origin only — scheme, lower-case ASCII hostname, and
effective port — never credentials. Effective TLS server name and configured CA digest remain validation
metadata, but do not split the lock when a CA or equivalent TLS configuration rotates. The directory id is
lower-case base32 `HMAC-SHA-256(identity.key, canonicalOrigin)`, so endpoint enumeration cannot recover it.
Changing credentials or TLS material preserves the target id; changing origin does not. Different origins
that reach the same firewall remain outside the single-host locking claim.

The fixed layout is:

```text
targets/<targetId>/
  lock
  audit/YYYY-MM.jsonl
  backups/<backupId>/{config.xml,metadata.json}
```

The composition root injects this target id into the mutation services; the kernel removes its global
`opnsense-config` key and uses the injected id for locking, backup, audit, and reconciliation.

### Durable backup and audit

Each envelope run gets independent random 128-bit `transactionId` and `backupId` values. Backup metadata is
versioned and contains only target id, a digest of the effective TLS context, both ids, UTC timestamp, byte
length, XML SHA-256, capability id, effective scopes, arguments SHA-256, pre-state digest, and effect-plan
digest.

Backup publication creates a private sibling temporary directory with exclusive names, writes and fsyncs XML
and metadata, rereads and verifies size/checksum/shape, fsyncs the temporary directory, atomically renames it
to `backups/<backupId>`, then fsyncs `backups/`. `create()` succeeds only afterward. Every `exists()` reopens
both files without following links and revalidates ownership, modes, link counts, bounds, metadata, length,
and checksum. The XML remains capped at 2 MiB and never crosses MCP.

Audit is canonical JSONL segmented by UTC month, with one bounded line of at most 4096 bytes for `intent` and
one terminal `result` per transaction. Records contain only the same safe ids/digests/scopes plus phase and
fixed outcome. Under the target lock, each line is appended through an owner-checked,
single-linked `O_APPEND|O_NOFOLLOW` file and fsynced before `record()` returns. A partial tail, duplicate
terminal, missing terminal, invalid field, or failed fsync is visible corruption, never ignored.

Intent failure refuses before backup or write. After a durable intent, every path attempts a durable terminal
record. If that record cannot be durably confirmed — even after a verified target change — MCP returns the
new fixed refusal `AUDIT_RESULT_FAILED`, never success, and directs the operator to local reconciliation.

### Inter-process lock and retention

Use a kernel-backed advisory lock, not a PID/stale lockfile. The parent opens and validates the fixed lock file
with `O_NOFOLLOW`, then passes only an inherited descriptor to the helper — never the path or target id in
argv or environment. Linux runs a fixed, validated `/usr/bin/flock` against that descriptor; macOS runs a
fixed, validated `/usr/bin/lockf` against `/dev/fd/<n>`. Each execs a bundled Node waiter that signals
acquisition only after the OS lock is held and remains alive on a private pipe for the envelope lifetime.
Acquisition is bounded to five seconds. Missing/untrusted helpers, premature helper exit, or an unsupported
platform fail closed. Process death releases the kernel lock, so there is no stale-file stealing or PID-reuse
heuristic. This is a local-host lock, not a distributed lock.

A terminal audit outcome describes the verified target outcome, not whether MCP delivered success. After
that terminal is durable, the envelope closes the waiter pipe and confirms helper exit. If a verified success
cannot confirm release, MCP returns the new fixed refusal `LOCK_RELEASE_FAILED` with "change already
verified; do not retry blindly; run local reconciliation", and writes no second terminal. If terminal-audit
and release confirmation both fail, `AUDIT_RESULT_FAILED` has precedence. If a mutation already has a more
informative non-success result, that code remains primary and local reconciliation also reports the lock
condition.

Before a new intent, retention maintenance must succeed. Resolved transactions retain at least the newest 100
backups and at least 30 days; both conditions must permit deletion. Unresolved transactions are never purged
automatically. Audit segments retain at least 365 days, and any segment containing an unresolved transaction
is preserved. A corrupt entry, failed deletion/fsync, or insufficient space refuses the new mutation before
the first write.

### Local reconciliation

`opnsense-mcp reconcile --json` is part of P0-C. By default it inventories every structurally valid
`targets/<targetId>` directory so origin/TLS changes cannot hide old unresolved state; an optional
`--current-target` filter derives the current origin through the normal private configuration path. It
acquires each target lock briefly, performs no network I/O and no mutation, and validates the entire local
structure, permissions, metadata, checksums, audit chain, orphan temporary entries, and unresolved intents.
Its bounded JSON output may include local target/transaction/backup ids and safe metadata, but never endpoint,
credentials, XML, or raw arguments. Exit codes are `0` for coherent/no unresolved state, `2` when
reconciliation is required, and `1` for unreadable or corrupt state. Restore, acknowledge, deletion, and
automatic repair remain out of scope.

### Mutation outcome semantics

The generic write-handler boundary gains a sealed failure classification. A failure before the first HTTPS
write is handed to the client is `not-started`; once `addItem`/`delItem` is invoked, every timeout, abort,
network/parse error, or later `reconfigure` failure is `may-have-started`. The kernel maps the latter only to
`OUTCOME_INDETERMINATE` with the durable backup and reconciliation guidance; it may never collapse to
`EXECUTION_FAILED`. Verification failure remains `OUTCOME_UNVERIFIED`. Focused tests cover every boundary
before request, during write, after saved/deleted response, during reconfigure, during read-back, final audit,
and lock release.

### Host-alias correctness

The admitted host syntax and canonicalization are exact:

- IPv4 must already be canonical dotted decimal; a multi-digit octet with a leading zero is rejected;
- syntactically valid unscoped/unbracketed IPv6 is accepted, then normalized to lower-case RFC 5952;
- an ASCII LDH hostname without trailing dot is accepted case-insensitively, then lower-cased; its normalized
  form is 1..253 bytes with labels 1..63 bytes, alphanumeric at both ends, and no underscore, wildcard,
  Unicode/IDNA input, or empty label;
- content has 1..64 entries, is canonicalized then lexicographically sorted, and rejects duplicates after
  canonicalization;
- alias-name collision checks are ASCII case-insensitive; description is accepted as Unicode, normalized to
  NFC, then checked for at most 255 UTF-8 bytes and no NUL/C0/C1 control character.

`POST /api/firewall/alias/searchItem` is the single read-back source. Before relying on it, a targeted
disposable-VM probe must observe and seal the host row's `content` field, its separator/normalization, and the
pagination counters' meanings. If that firmware does not return stable content, P0-C stops and writes remain
experimental; handler input is never echoed as verification and no undocumented endpoint is invented. The
public alias list then includes the same canonical content used by verification.

Enumeration uses page size 100, at most 100 pages and 10,000 host aliases. For every page, `current` equals
the request; `rowCount` must follow the one meaning sealed by the VM probe rather than the current
dual-acceptance heuristic. `total` remains constant and bounded, each returned-row count matches that sealed
counter contract, and UUIDs plus case-folded names are globally unique. Premature empty pages, repeated page
digests, duplicate rows, shape/byte-limit failures, or total drift fail closed. For the pre-state digest,
canonical rows are sorted by canonical UUID and the full UUID/name/type/content/description array is hashed;
response order alone can never create drift.

Create first proves no case-folded name collision, then verifies exactly one row with the returned UUID and
the complete canonical attributes after reconfigure. Delete first proves the exact UUID and complete item
exist, then verifies its absence across the complete paginated result. A deterministic 201-alias fixture
proves three-page traversal, drift, duplicate, loop, and truncation defences.

The disposable VM lifecycle must create a private temporary `OPNSENSE_MCP_STATE_DIR`, create only owned
firewall state, restart the installed MCP between mutation phases, prove the durable state through
`reconcile --json`, delete the owned alias, prove absence, stop the VM, delete the local state root, and prove
both firewall and local residue absent. The attestation records the booleans, never the state path. No
production target is contacted.

### Exit gate

- verified backup and audit records survive restart and normal shutdown;
- crash/failure tests preserve reconciliation evidence without leaking XML or credentials;
- two local processes serialize or one fails closed; forged direct calls cannot bypass the envelope;
- the reconciliation command distinguishes clean, unresolved, and corrupt local state without network I/O;
- Windows and POSIX hosts missing a trusted lock helper refuse experimental writes at startup;
- every may-have-started and final-audit failure returns its fixed non-success code and guidance;
- strict alias syntax, full pagination, drift detection, exact create verification, and exact delete
  verification pass in deterministic tests;
- the bounded lifecycle passes on the disposable VM and records machine-readable evidence;
- `npm run license:check`, `npm run verify`, both conformance profiles, provenance verification, and
  `git diff --check` pass.

## Execution order and commit discipline

1. Complete P0-A as three regression-first, independently reviewable fixes.
2. Complete P0-B without adding capabilities.
3. Split P0-C into state/identity/reconciliation, lock/backup/audit, kernel outcome semantics,
   alias syntax/pagination/read-back, and disposable-VM evidence slices.
4. Integrate a P0-C slice only after its focused proof, then run the complete exit gate and update the
   progress ledger after every atomic commit.

No feature expansion is mixed into these commits. A failure in one increment does not justify skipping or
weakening another.

## Roadmap after P0

The next product increment is a read-only diagnostic vertical, implemented cleanly and selected from
interfaces, DHCP leases, ARP/neighbour state, routes, and bounded firewall inspection. These reads deliver
useful parity without expanding mutation risk and can proceed alongside the standalone distribution plan.

Later increments may add bounded VLAN/firewall primitives and a redesigned device-block workflow. Internal
DNS, certificates, HAProxy, fixed parameterized SSH, restore, and reboot require separate designs. Raw API
dispatch, free-form shell/SSH, bulk-imported legacy registries, legacy IaC/macros, Redis/Postgres cache, and
the former dashboard are not carried forward by default.
