# Provenance-Gated Test Infrastructure Migration Implementation Plan

> **NORMATIVE STATUS (2026-07-19):** Public Task 1 is complete. The former private checkpoint P0, Task 2,
> and Tasks 3-11 below are retained only as historical design input and **must not execute as written**.
> Task 2A is replaced by
> `docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md`. Task 2B preparation/activation,
> the real operator checkpoint, Task 2C copying, and Task 2D scanning/release projection each require their own
> owner-approved plan and independent review. Clean-room product implementation may continue independently,
> but no approved legacy asset may cross the private boundary until the replacement sequence authorizes it.

**Goal:** Migrate the provenance-approved installer, client plugins, documentation, VM harness,
agentic evaluation, safety tests, and integration helpers into the new implementation without
publishing private provenance evidence or carrying uncertain implementation text forward.

**Architecture:** Task 1 establishes only one minimal public manifest, its immutable public inventory, and
the code that validates both. It does not read private evidence or build a release manifest. Later private
source mappings and audit evidence live only in an external, untracked baseline selected by
`OPNSENSE_PROVENANCE_BASELINE`; approved input bytes come only from the prepared external source selected
by `OPNSENSE_MIGRATION_SOURCE`. That source is an immutable private composition of the verified history
bundle and an explicitly reviewed, allow-listed snapshot of newer owner-authored working-tree assets.
Copying is fail-closed, rewrite-class files are authored independently, discard-class files stay absent,
and every release is scanned both as public source and against the private baseline before it can be
declared publishable.

**Tech Stack:** Node.js 22.19 or newer within major 22, strict TypeScript ESM, Vitest for the integrated
Task 1 test, shell and Python harnesses already listed in the later inventory, JSON manifests, SHA-256,
Git, AGPL-3.0-or-later.

---

## Historical scope and invariants (not executable)

All commands use the repository root (`process.cwd()`) as destination; tools accept no destination-root
argument. `OPNSENSE_MIGRATION_SOURCE` selects the audited external working tree and
`OPNSENSE_PROVENANCE_BASELINE` selects the private, untracked authorization and audit baseline. The
baseline is never copied, projected beyond the approved public fields, printed, committed, or released.

`docs/provenance/migration-manifest.json` has exactly this top-level shape:

```json
{
  "schemaVersion": 1,
  "assets": []
}
```

Each asset has exactly these keys:

```json
{
  "destination": "path/inside/repository",
  "class": "approved",
  "contentSha256": null,
  "auditVerdict": "approved-pending-migration"
}
```

Lifecycle rules:

- `approved`: until final release review, digest `null` and verdict `approved-pending-migration`, including
  after source migration closes. Only after all later product, workflow, packaging, documentation, and
  agentic edits are complete may an independent destination review recorded in the private baseline supply
  the exact digest and verdict `approved-migrated`. A tool must never approve a digest merely because it
  computed that digest.
- `rewrite`: digest `null` and verdict `pending-independent-rewrite` until independent authorship and
  review; afterward, the replacement digest and verdict `independently-rewritten`.
- `discard`: the digest is always `null`, the verdict is `discarded`, and the destination must be absent.

For a sealed row, `contentSha256` is the SHA-256 of the exact stage-0 Git index blob, not of checkout bytes.
The verifier also requires the worktree path to be clean relative to that index entry. This keeps the public
digest stable when Windows `core.autocrlf` changes checkout line endings while still refusing unstaged drift.

No other public field is allowed. The immutable inventory is the exact destination-to-class mapping in
Appendices A-C: 105 `approved`, 3 `rewrite`, and 8 `discard`. Counts alone never establish inventory
identity.

`npm run provenance:scan` works in a clean clone; an optional baseline adds private checks. Its report
exposes only aggregate counts, verdicts, and `externalBaselineUsed`; it accepts explicitly pending approved
rows during migration and three pending rewrite rows, while reporting migration and release eligibility false.
`npm run provenance:scan:migration` requires both external inputs, all 105 approved source mappings marked
copied and adapted in the private baseline, every destination present, and all 8 discarded rows absent. It
explicitly permits the 105 approved and 3 rewrite public rows to remain pending because later guided tasks
still modify them; migration eligibility means only source-inventory closure. `npm run
provenance:scan:release` requires both inputs and independently reviewed final destination digests and
verdicts for all 105 approved plus all 3 rewrite rows. Either local preflight exits 2 when input is invalid.

All copied and new files must use SPDX identifier `AGPL-3.0-or-later` where an SPDX header is applicable.
License checks must reject conflicting package, plugin, generated, and documentation metadata.

## Interleaved execution contract

This plan is intentionally interleaved with the product-parity plan so a migrated test is never committed
as a permanently red standalone task:

1. public Task 1 is complete and remains the immutable public-contract baseline;
2. current private work follows only the Task 2A routing index and each independently reviewed Task 2A1 and
   Task 2A2 implementation plan;
3. future Task 2B, 2C, and 2D plans must preserve this normative order: synthetic
   contract/review; synthetic preparation/review; real draft; independent source/snapshot review; separately
   supplied baseline digest; activation; accepted-context preflight; copier review; then group copying;
4. do not execute historical Tasks 3–11 or P0 text below directly; later replacement plans must explicitly
   reactivate each applicable product migration step;
5. treat the former Tasks 5–10 only as historical dependency notes: agentic infrastructure depended on a live
   catalogue, safety and shared tests depended on the corresponding product slices, documentation followed
   implemented behavior, and discard coverage remained continuous;
6. reactivate the former Task 11 closure only through a reviewed replacement after every applicable approved
   destination is present and adapted; final destination review and sealing remain a later release concern.

No task may run `npm test` or `provenance:scan:migration` while its stated architecture dependencies are
absent. Focused RED commands belong to the owning implementation task and must become green before that
atomic commit.

## Historical private checkpoint P0: superseded, do not execute

The following description is retained only to explain earlier design decisions. Do not execute it. It formerly
placed this checkpoint after public Tasks 1–2 and before the first copy in Task 3. It creates no tracked
file and has no commit. The operator supplies five values outside Git:

- `OPNSENSE_HISTORY_BUNDLE`: the owner-supplied complete Git bundle;
- `OPNSENSE_HISTORY_BUNDLE_SHA256`: the independently communicated expected digest;
- `OPNSENSE_OWNER_WORKTREE`: the owner-controlled working tree containing newer approved assets that are
  absent from the bundle;
- `OPNSENSE_PRIVATE_WORK_ROOT`: an empty private directory outside the repository;
- `OPNSENSE_MIGRATION_ENV_FILE`: a new private environment-file destination outside the repository.

The reviewed preparation procedure must:

1. require a mode-`0700` private root and refuse symlinks, repository descendants, broad home/root targets,
   an unverified digest, an invalid/incomplete Git bundle, or a dirty/reused source;
2. materialize the selected owner-authored revision read-only, then copy only independently reviewed,
   explicitly mapped overlay assets from the owner worktree. Refuse symlinks, non-regular sources,
   destination collisions, missing mappings, and any overlay asset already available as the accepted bundle
   version unless the reviewer explicitly records why the newer owner-authored bytes supersede it. Freeze
   the composed source read-only without checking out unrelated content into the public repository and
   without printing paths, refs, object IDs, authors, or content;
3. build a mode-`0600` private baseline containing the 116 destination mappings, private source class,
   approved source digests,
   executable-bit authorization, authorship review, discard rules, forbidden-expression fingerprints, and
   later destination-review slots;
4. scan the complete bundle and the selected overlay bytes for credentials. A discovered credential is
   reported only by category;
   it is excluded from every inventory group and must be rotated before any reuse;
5. create a mode-`0600` environment file outside Git defining only `OPNSENSE_MIGRATION_SOURCE` and
   `OPNSENSE_PROVENANCE_BASELINE`, then verify both resolve under the private root.

The preparation test uses a synthetic bundle and synthetic author/digest sentinel. The real checkpoint is
reviewed interactively and recorded only in the private baseline. If any of these inputs is unavailable,
migration is blocked explicitly; normal foundation/product development may continue clean-room, but no
approved asset copy or release provenance claim may proceed.

Historically, the superseded flow would have invoked `npm run provenance:prepare-private` and sourced a
two-variable environment file. That command and recipe are invalid for the current three-variable,
separately digest-bound contract and must not be used.

---

## Task 1: Establish the public manifest contract

**Files:**

- Create: `docs/provenance/migration-manifest.json`
- Create: `scripts/provenance/inventory.mjs`
- Create: `scripts/provenance/verify-manifest.mjs`
- Create: `tests/provenance/migration-manifest.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

### Step 1: Write the failing manifest tests

Create one Vitest suite that loads the committed JSON and asserts:

```js
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.assets.length, 116);
assert.deepEqual(countByClass(manifest.assets), {
  approved: 105,
  rewrite: 3,
  discard: 8,
});

for (const asset of manifest.assets) {
  assert.deepEqual(
    Object.keys(asset).sort(),
    ['auditVerdict', 'class', 'contentSha256', 'destination'],
  );
}
```

Also assert that destinations are unique, repository-relative, slash-normalized, non-empty, and cannot
escape the repository. The test-owned expected inventory must repeat all 116 exact destination-to-class
mappings from Appendices A-C as literals; it must not import the production inventory or derive expectations
from the committed manifest. Assert exact bytewise UTF-8 destination order with `Buffer.compare`, not only
counts and never locale-sensitive order.

At Task 1, all approved rows have digest `null` and verdict `approved-pending-migration`; all rewrite rows
have digest `null` and verdict `pending-independent-rewrite`; discard rows have digest `null` and verdict
`discarded`. Exercise the complete lifecycle matrix in synthetic manifests:

| Class | Pending state | Sealed state |
| --- | --- | --- |
| `approved` | `null` + `approved-pending-migration` | lowercase Git-blob SHA-256 + `approved-migrated` |
| `rewrite` | `null` + `pending-independent-rewrite` | lowercase Git-blob SHA-256 + `independently-rewritten` |
| `discard` | `null` + `discarded` | none; every other combination is invalid |

Reject every other class, verdict, digest type/case/length, and class-state combination. Assert exact
top-level and asset key allow-lists. Require one canonical JSON serialization: two-space indentation, one
terminal newline, stable top-level/asset key order, and stable asset order. Comparing the parsed and
validated value with this canonical serialization must also reject duplicate JSON member names and
noncanonical encodings without adding a permissive JSON dependency. Cap the manifest at 256 KiB.

Exercise the real validator CLI in initialized temporary Git repositories by spawning its absolute script
path while each fixture repository is `cwd`. Every valid public-manifest fixture contains the full exact 116-row
inventory. Lifecycle tests mutate only state, filesystem, or Git-index conditions; inventory and path tests
mutate only the row needed to prove that the exact mapping fails closed. Cover:

- zero, two, unknown, absolute, or noncanonical manifest arguments; exactly one argument equal to
  `docs/provenance/migration-manifest.json` is accepted;
- a `cwd` that is not the real Git worktree root;
- NUL, backslash, POSIX-absolute, drive-qualified, UNC-like, empty, `.`, `..`, `.git` (case-insensitive),
  duplicate-separator, trailing-separator, non-NFC, Windows-invalid-character, trailing-dot/space, and
  Windows-reserved-device destination forms;
- byte-distinct destinations that collide after Unicode normalization or case folding, and a present entry
  whose real directory-entry case differs from the manifest even on a case-insensitive filesystem;
- a pending destination that is absent, present as a regular file, present as a directory, or reached
  through a symlinked path component;
- pending rewrite files that are already present and tracked, matching the current `README.md` and
  `CONTRIBUTING.md` state;
- sealed approved and rewrite rows with a stage-0 regular-file index entry, matching or mismatching Git-blob
  digest, missing/unmerged/symlink index modes, and clean or dirty worktree bytes;
- a symlinked manifest, a symlinked destination leaf, and non-regular destination types supported by the
  host fixture;
- every discard destination absent from both the current filesystem and the Git index, including a staged
  path deleted only from the worktree;
- duplicate destinations, a count-preserving class swap, extra fields, oversize input, malformed JSON, and
  the full invalid lifecycle cross-product.

Symlink fixtures run on hosts that support creating them; the final native-Windows gate must exercise the
same refusal with a junction or symlink available to the runner. A platform that cannot create the fixture
may skip only that fixture with the operating-system error recorded, never the production check.

The CLI exposes only fixed error codes, the known repository-relative destination when safe, and aggregate
success counts. It never echoes malformed values, absolute paths, environment values, or file contents.
Exit `0` means valid, `1` means a manifest/content violation, and `2` means invocation or repository
preflight failure. Set private-baseline environment variables to sentinels in a test and prove Task 1 neither
reads nor prints them.

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run tests/provenance/migration-manifest.test.ts
```

### Step 2: Add private-input ignore rules

Add these patterns without weakening existing ignores:

```gitignore
.migration-private/
*.provenance-baseline.json
```

Test both file text and `git check-ignore`: the two exact sentinel paths must be ignored by these rules,
while `.migration-private-sibling/sentinel` and `sentinel.provenance-baseline.json.extra` remain visible. Do not
weaken or reinterpret unrelated existing ignore rules. Task 1 has no external-baseline path and must not
introduce one.

### Step 3: Implement the minimal public validator

`inventory.mjs` exports a deeply frozen, bytewise UTF-8 sorted array containing the exact 116 public
destination-to-class mappings in Appendices A-C and the fixed class counts. It contains no source mapping,
review identity, private digest, group label, or environment lookup. Inventory construction rejects
nonportable destinations, non-NFC strings, and normalization/case-fold collisions before exporting.

`verify-manifest.mjs` validates the bounded canonical bytes, exact schema, exact immutable inventory,
lifecycle matrix, destination safety, stable order, Git-index absence for discard rows, and destination
bytes for every sealed row. It first proves that `cwd` is the real Git worktree root. It performs path checks
with slash/segment rules independent of host path normalization, then walks every existing component with
`lstat` and exact directory-entry-name comparison; a present pending or sealed leaf must be a regular
non-symlink file. A pending approved or rewrite destination may be absent or present but is always reported
pending. Every discard destination must be absent from both filesystem and index.

For a sealed row, invoke Git only with an argv array: read the exact stage-0 entry and mode, obtain its blob
without passing content through a shell, hash those canonical blob bytes with SHA-256, and require the
worktree path to be clean relative to that index entry. Reject missing, unmerged, symlink, submodule, or
case-mismatched index entries. Never log Git object IDs. The validator never infers, requests, or reads a
private source or baseline.

Task 1 deliberately has no builder. A release builder may be specified only after Task 2 versions one
private-baseline schema and parser shared by preparation, copy, scan, and build commands. That later builder
must consume independently recorded expected destination digests; it may never turn a digest it computed
itself into review evidence.

### Step 4: Register focused scripts

Add:

```json
{
  "scripts": {
    "provenance:verify": "node scripts/provenance/verify-manifest.mjs docs/provenance/migration-manifest.json"
  }
}
```

Merge these entries into the existing scripts object; do not replace other scripts.

### Step 5: Make the tests pass

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run tests/provenance/migration-manifest.test.ts
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run provenance:verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:conformance
git diff --check
```

**Commit:** Stage the Task 1 files with message `build: add minimal provenance manifest`.

---

## Historical Task 2: superseded, do not execute

> **BLOCKED / REQUIRES A NEW PREFLIGHT — DO NOT EXECUTE THIS TASK AS WRITTEN.** The remainder of this task
> is retained as design input only. The active Task 2A index now routes separately reviewed Task 2A1 and Task
> 2A2 plans; Task 2B preparation, Task 2C copying, and Task 2D scanning/release projection remain blocked behind
> their own future contracts. Do not inspect the owner bundle or run checkpoint P0 through this historical
> sequence.
>
> This execution block also covers Tasks 3–11 below. They remain useful design sketches, but their stale
> filenames and commands are not implementation instructions unless a later reviewed replacement explicitly
> reactivates the applicable work.

**Files:**

- Create: `scripts/provenance/copy-approved.mjs`
- Create: `scripts/provenance/prepare-private-inputs.mjs`
- Create: `scripts/provenance/scan-release.mjs`
- Create: `scripts/provenance/report.mjs`
- Create: `tests/provenance/copy-approved.test.mjs`
- Create: `tests/provenance/prepare-private-inputs.test.mjs`
- Create: `tests/provenance/scan-release.test.mjs`
- Modify: `scripts/check-license-headers.mjs`
- Create: `tests/provenance/license-headers.test.mjs`
- Modify: `package.json`

### Step 1: Write private-preparation and copier failure tests

Use a synthetic complete Git bundle and a synthetic owner worktree to test the P0 procedure end to end:
verified caller-supplied digest, private modes, owner-authored revision selection, allow-listed overlay
capture, bundle/overlay collision refusal, credential-category refusal, private baseline shape, and zero
private value in stdout/stderr. Inject review decisions in tests; the real command requires an interactive
reviewer and refuses non-interactive self-approval.

Use temporary repositories and sentinel bytes. Test that copying fails before writing when:

- `OPNSENSE_MIGRATION_SOURCE` is absent, not a directory, or resolves to the destination repository;
- `OPNSENSE_PROVENANCE_BASELINE` is absent, not a regular file, inside the destination repository, or
  readable by unintended users on a POSIX host;
- the requested group or destination is not authorized by the baseline;
- the source digest differs from the private approved digest;
- a selected manifest row is `rewrite` or `discard`;
- a destination is a symlink, escapes the root, or already contains unexpected bytes;
- any copy would be partial.

Run:

```bash
node --test tests/provenance/copy-approved.test.mjs
node --test tests/provenance/prepare-private-inputs.test.mjs
```

### Step 2: Implement transactional approved copying

The copier must:

1. resolve the destination from `process.cwd()`;
2. validate both external inputs without logging their values;
3. load the selected inventory group from the public destination list;
4. obtain its private source mapping and approved input digest from the external baseline;
5. validate every source and destination before writing any file;
6. stage bytes in a private temporary directory under the destination;
7. preserve executable bits explicitly authorized by the baseline;
8. atomically install the full group;
9. verify the installed bytes again but leave the public row `approved-pending-migration`;
10. delete the temporary directory on success or failure.

Copying proves only that the selected input bytes were authorized. Any subsequent adaptation changes those
bytes and therefore remains pending until Task 11 obtains independent review and an external expected
destination digest. The copier cannot seal or update public provenance rows.

The command shape is:

```bash
npm run provenance:copy -- --group installer-plugin
```

There is deliberately no destination argument and no unrestricted path-copy mode.

### Step 3: Write public and private scanner tests

The public scan must fail on:

- manifest digest drift or an absent sealed approved destination;
- a present discard destination;
- unresolved rewrite rows in release mode;
- secrets, private configuration, or credentials in tracked files, staged files, nonignored task-candidate
  files, or Git history;
- license metadata that is not `AGPL-3.0-or-later`;
- a dirty generated manifest;
- suspicious paths, symlinks, or files outside the declared inventory introduced by migration tooling.

The optional private scan must additionally detect exact disallowed object reuse, private reference text,
and similarity above the thresholds supplied by the external baseline. Fixtures must generate sentinel
values at runtime so no sensitive identity is committed.

Assert that reports never echo matching text, digests from the private baseline, input locations, or
source mappings. A failure identifies only destination, check category, and remediation class.

Run:

```bash
node --test tests/provenance/scan-release.test.mjs
```

### Step 4: Implement scanner modes

`scan-release.mjs` runs the public checks unconditionally over tracked files, the index, and every nonignored
working-tree candidate; no pre-commit file can evade secret, license, forbidden-reference, or path checks.
Pending approved rows are permitted in the ordinary public scan and force both eligibility booleans false.
When the external baseline exists, it performs the private comparisons in memory and sets
`externalBaselineUsed` to `true`; otherwise it sets it to `false` and clearly labels the result public-only.

With `--require-baseline`, require both environment variables before scanning and exit 2 on preflight
failure. `--migration-inventory` requires the private copied/adapted record for all 105 approved rows while
accepting all public approved/rewrite rows as pending. Without that mode, unresolved approved or rewrite rows
fail the final release scan. Exit 1 means an audit violation and exit 0 means every check required by the
chosen mode passed.

`report.mjs` emits a stable JSON object containing only:

- schema version;
- public manifest digest;
- 105/3/8 counts;
- public, private, secrets, license, and history verdicts;
- `externalBaselineUsed`;
- migration and release eligibility booleans.

Never serialize check inputs, matching content, private fingerprints, or private object identities.

### Step 5: Register and verify scripts

Add:

```json
{
  "scripts": {
    "provenance:copy": "node scripts/provenance/copy-approved.mjs",
    "provenance:prepare-private": "node scripts/provenance/prepare-private-inputs.mjs",
    "provenance:scan": "node scripts/provenance/scan-release.mjs",
    "provenance:scan:migration": "node scripts/provenance/scan-release.mjs --require-baseline --migration-inventory",
    "provenance:scan:release": "node scripts/provenance/scan-release.mjs --require-baseline",
    "license:check": "node scripts/check-license-headers.mjs"
  }
}
```

Extend the foundation-owned `license:check` implementation rather than adding a second scanner. It walks
tracked, staged, and nonignored task-candidate files and applies extension-aware comment syntax for
TypeScript, JavaScript, MJS, Python, shell, and PHP. Every applicable source must contain `SPDX-License-Identifier:
AGPL-3.0-or-later` in its allowed header window. A small explicit allow-list covers generated data whose
generator carries the header and formats that cannot carry comments; the test rejects broad directory or
glob exceptions and any conflicting license metadata.

Run:

```bash
node --test tests/provenance/copy-approved.test.mjs
node --test tests/provenance/prepare-private-inputs.test.mjs
node --test tests/provenance/scan-release.test.mjs
npm run license:check
npm run provenance:scan
git diff --check
```

**Commit:** Stage the Task 2 files with message `build: enforce provenance-gated migration`.

---

## Historical Task 3: Migrate installer and client plugins — superseded, do not execute

**Files:** The 11 `installer-plugin` approved destinations in Appendix A.

### Step 2: Copy the approved group

Preflight without printing values:

```bash
test -n "${OPNSENSE_MIGRATION_SOURCE:-}"
test -d "$OPNSENSE_MIGRATION_SOURCE"
test -n "${OPNSENSE_PROVENANCE_BASELINE:-}"
test -f "$OPNSENSE_PROVENANCE_BASELINE"
npm run provenance:copy -- --group installer-plugin
```

Review every diff. Adapt package names, imports, server entry point, client locations, and claims to the
new implementation. The private baseline maps the two approved runtime assets directly to
`src/cli/{install,serve}.ts`; never create an intermediate runtime tree. Guided-workflows Task 6 later
refactors and completes those final CLI modules. It also privately maps the two approved legacy-named skill
sources directly to `plugins/opnsense-mcp/skills/opnsense-guide/`; adapt their public name immediately and
never create the forbidden source-name destination. Do not copy adjacent files.

### Step 3: Verify client packages

Run:

```bash
node --test tests/plugin/package.test.mjs tests/installer/install.test.mjs
npm run provenance:verify
npm run provenance:scan
git diff --check
```

**Commit:** Stage the Task 3 files with message `feat: migrate audited client installers`.

---

## Historical Task 4: Migrate developer bootstrap and VM harness — superseded, do not execute

**Files:** The 25 `vm-onboarding` approved destinations in Appendix A; create
`scripts/vm/with-managed-vm.mjs` and `tests/vm/with-managed-vm.test.mjs` as new clean-room safety assets.

### Step 1: Write host-contract failures first

Before adapting scripts, require Node.js 22.19 diagnostics, pinned image checksums, one managed VM, external
private credentials, fail-closed plugin and firmware checks, idempotent cleanup, and no migration variables
in runtime VM scripts. The wrapper test uses injected child functions to prove that it registers stop and
residue actions before provisioning, runs residue and stop in `finally` after setup/call/verification
failures, and reports the primary failure together with every cleanup failure. Run the offline harness tests:

```bash
node --test tests/setup/bootstrap-dev.test.mjs
node --test tests/vm/image-checksum.test.mjs tests/vm/install-plugins.test.mjs
node --test tests/vm/provision-one-vm.test.mjs tests/vm/start-vm-reproducibility.test.mjs
node --test tests/vm/vm-doctor.test.mjs tests/vm/registry-diff.test.mjs
node --test tests/vm/with-managed-vm.test.mjs
python3 -m unittest tests/vm/test_bootstrap_secret_hygiene.py
```

### Step 2: Copy and adapt the VM group

```bash
npm run provenance:copy -- --group vm-onboarding
```

Adapt root discovery, package scripts, generated registry destinations, and server launch contracts only.
`scripts/setup/bootstrap-dev.sh` diagnoses missing dependencies and prints commands, but never elevates or
installs host software without an explicit action.

Implement `with-managed-vm.mjs` as the only live-test launcher. It performs doctor, provisions at most one
managed instance, invokes the requested test command without a shell, then always runs residue verification
and `vm:stop` from `finally`. Test cases register their inverse cleanup before the first mutation. Cleanup
uses its own bounded signal, not the cancelled test signal; an aggregate error preserves the primary cause,
cleanup failures, residue failure, and stop failure. Expose package script `vm:with` and forbid raw
`vm:provision && test` chains in documentation/release tests.

### Step 3: Verify offline VM tooling

Rerun Step 1, then:

```bash
npm run vm:doctor
node --test tests/vm/with-managed-vm.test.mjs
npm run provenance:verify
npm run provenance:scan
git diff --check
```

`vm:doctor` may report missing dependencies, but must give a clear action and never partially provision.

**Commit:** Stage the Task 4 files with message `test: migrate disposable vm harness`.

---

## Historical Task 5: Migrate the agentic evaluation harness — superseded, do not execute

**Files:** The 28 `agentic` approved destinations in Appendix A.

### Step 1: Define failing evaluation invariants

Before adapting the runner, retain or add tests proving:

- model provider, exact model name, CLI version, and profile are explicit in attestations;
- the default profile is low-cost and configurable rather than hard-coded;
- checkpoints bind to Git state, dataset, harness, registry, model, and CLI configuration;
- setup or cleanup failure invalidates a run;
- every runnable turn needs an expected successful tool call and meaningful verification;
- tool results in public attestations are represented by SHA-256 digests rather than raw sensitive data;
- temporary MCP configurations are private and removed on every exit path;
- a quota or capacity interruption exits distinctly and can resume from a compatible checkpoint;
- public results cannot be called canonical unless every required attestation field and residue check passes.

Run:

```bash
python3 -m unittest discover -s tests/agentic/deepeval -p 'test_*.py'
node --test tests/agentic/temp-config-hygiene.mjs tests/agentic/verify-bridge-cleanup.test.mjs
```

### Step 2: Copy the approved agentic group

```bash
npm run provenance:copy -- --group agentic
```

Adapt tool discovery to `src/capabilities/catalog.ts`, resource coverage to
`src/opnsense/catalog/resources.ts`, server startup to `src/server/build-server.ts`, and tool execution to
`src/capabilities/dispatch.ts`. Keep model selection in
`tests/agentic/model-config.json`; do not bake a provider-specific model alias into code or documentation.

Preserve the two evaluation profiles:

- `operator-preauthorized` for explicitly authorized mutation in a disposable lab;
- `interactive-pedagogy` for vague requests where the agent must clarify before mutation.

### Step 3: Validate the dataset offline

Run:

```bash
npm run groundtruth:setup
npm run groundtruth:validate
python3 -m unittest discover -s tests/agentic/deepeval -p 'test_*.py'
node --test tests/agentic/temp-config-hygiene.mjs tests/agentic/verify-bridge-cleanup.test.mjs
npm run provenance:verify
git diff --check
```

**Commit:** Stage the Task 5 files with message `test: migrate attested agentic evaluation`.

---

## Historical Task 6: Migrate approved safety and backup tests — superseded, do not execute

**Files:** The 10 `security-backup` approved destinations in Appendix A.

### Step 1: Write new-kernel failures first

Adapt tests first. Require forged-call refusal, read-only hiding and dispatch refusal, strict pre-mutation
snapshotting, mutation refusal on snapshot failure, redacted private audit files, symlink refusal,
fail-closed HTTP security, and no secrets in arguments or logs. Run:

```bash
node --test tests/integration/backup-flow.mjs tests/integration/backup-id-collision.mjs
node --test tests/integration/guardrails.mjs tests/integration/transport-security.mjs
node --test tests/integration/live-script-secret-hygiene.mjs
node --test tests/smoke/log-file-mode.mjs tests/smoke/redaction.mjs
```

### Step 2: Copy and adapt the approved group

```bash
npm run provenance:copy -- --group security-backup
```

Map audit logging to `src/security/audit-log.ts` and tests to
`buildServer(application, transport)`. The two approved architectural destinations are adapted as reached,
stateless seams rather than copied as competing implementations:

- `src/security/operation-policy.ts` exports only pure product-policy decision/redaction helpers and is
  imported by `src/capabilities/kernel.ts`; it owns no dispatcher, handler, ledger, backup, audit instance,
  lock, or mutable state;
- `src/http/security.ts` composes the already canonical Host/Origin/limit/auth middleware and is imported by
  `src/http/runtime.ts`; it owns no listener, MCP handler, token property, session store, or alternate HTTP
  server.

Architecture tests require those exact incoming imports and reject any second dispatch/server tree. Keep
`src/capabilities/dispatch.ts` as the package-root facade. Product-parity Task 5 consumes the migrated audit
log and must not create a second one. Do not copy the rewrite-class backup storage.

### Step 3: Verify the group

Rerun Step 1, then:

```bash
npm run typecheck
npm run provenance:verify
npm run provenance:scan
git diff --check
```

The focused commands are expected RED immediately after adaptation because independent backup storage is not
implemented yet. Continue directly with product-parity Task 5; that task must make them green and stage this
entire group in its single atomic commit. Never commit this recipe by itself.

---

## Historical Task 7: Migrate shared and integration test infrastructure — superseded, do not execute

**Files:** The 15 `other-tests` approved destinations in Appendix A.

### Step 1: Add adapter contract tests

Require helpers to use public interfaces: stdio MCP initialization, credentials from a private environment
file, mode-0600 temporary JSON with cleanup, observed mock behavior, generated catalog checks, and explicit
live-SSH feature and disposable-VM gates. Run:

```bash
node --test tests/smoke/list-tools.mjs tests/smoke/claude-doc-consistency.mjs
node --test tests/integration/mcp-against-mock.mjs
node --test tests/unit/ssh-config-editor.test.mjs
```

### Step 2: Copy the approved group

```bash
npm run provenance:copy -- --group other-tests
```

Adapt imports only to `src/server/build-server.ts`, `src/capabilities/{catalog,dispatch}.ts`,
`src/opnsense/client.ts`, and `src/opnsense/catalog/resources.ts`. Do not import transport request objects
or SDK internals.

### Step 3: Verify mock and smoke layers

Run:

```bash
npm run build
node --test tests/smoke/list-tools.mjs tests/smoke/claude-doc-consistency.mjs
node --test tests/integration/mcp-against-mock.mjs
node --test tests/unit/ssh-config-editor.test.mjs
npm run provenance:verify
npm run provenance:scan
git diff --check
```

Run this recipe only after product-parity Tasks 1–10. Continue directly with product-parity Task 11 and stage
the entire group in its offline-parity commit; never commit an adapted red harness separately.

---

## Historical Task 8: Migrate and sanitize approved technical documentation — superseded, do not execute

**Files:** The 16 `recent-docs` approved destinations in Appendix A.

### Step 1: Write documentation checks first

Add a test rejecting machine paths, private provenance, unattested current scores, static catalog counts,
obsolete entry points, unsupported client claims, unsafe production guidance, conflicting license metadata,
and public scans presented as release authorization. Generate private sentinels at runtime. Run:

```bash
node --test tests/smoke/documentation-hygiene.mjs
```

### Step 2: Copy approved documentation

```bash
npm run provenance:copy -- --group recent-docs
```

Review architecture, commands, claims, packages, clients, and safety. Historical results must remain
non-canonical and redacted. Distinguish deterministic, protocol, VM, model-driven, and untested Internet
evidence.

### Step 3: Verify documentation

Run:

```bash
node --test tests/smoke/documentation-hygiene.mjs tests/smoke/claude-doc-consistency.mjs
npm run provenance:verify
npm run provenance:scan
git diff --check
```

**Commit:** Stage the Task 8 files with message `docs: migrate audited technical guidance`.

---

## Historical Task 9: Register and protect rewrite handoffs — superseded, do not execute

**Files:**

- Modify: `docs/provenance/migration-manifest.json`
- Modify: `tests/provenance/migration-manifest.test.mjs`
- Modify: `tests/provenance/copy-approved.test.mjs`
- Modify: `tests/provenance/scan-release.test.mjs`

The three rows are `README.md`, `CONTRIBUTING.md`, and `src/features/backup/storage.ts`. This migration plan
must not create, copy, edit, digest, review, or seal any of them. The guided-workflows plan owns both guides;
product-parity Task 5 owns backup storage and `BackupService` orchestration.

### Step 1: Write handoff-state tests

Assert that all three rows remain class `rewrite`, digest `null`, and verdict
`pending-independent-rewrite`. Also assert that no approved group includes them and that the copier refuses
each destination even if a private baseline attempts to authorize it.

```bash
node --test tests/provenance/migration-manifest.test.mjs tests/provenance/copy-approved.test.mjs
```

### Step 2: Test scan-mode separation

Add fixtures proving that the public and baseline-backed migration scans pass with exactly these three
pending rows, while the final release scan fails until their owning plans provide reviewed destination
digests and verdicts. Runtime-generate all private sentinels.

```bash
node --test tests/provenance/scan-release.test.mjs
npm run provenance:scan
```

Expected: the public scan passes but reports all unsealed approved rows as pending and migration eligibility
false. The private source-migration gate is intentionally deferred to Task 11 after all approved inputs have
been copied, adapted, and accounted for; it does not require final destination review.

### Step 3: Record the handoff without creating owner files

Run `git status --short` and fail the task if any of the three destinations was created or modified here.
The later owning plans may implement them independently; only the release plan runs
`npm run provenance:build:release` and `npm run provenance:scan:release` after all 105 approved and all 3
rewrite destinations are final and independently reviewed.

**Commit:** Stage only the manifest and provenance tests with message
`test: protect independent rewrite handoffs`.

---

## Historical Task 10: Keep discarded assets absent — superseded, do not execute

**Files:**

- Confirm absent: the 8 `discard` destinations in Appendix C.
- Create: `tests/protocol/server-initialization.test.ts`
- Create: `tests/integration/iac-capabilities.test.ts`
- Create: `tests/live/acme.vm.test.mjs`
- Create: `tests/live/device-dns-policy.vm.test.mjs`
- Create: `tests/live/monitoring.vm.test.mjs`
- Create: `tests/unit/capabilities/acme.test.ts`
- Create: `tests/unit/capabilities/device-dns-policy.test.ts`
- Create: `tests/unit/capabilities/monitoring.test.ts`

The replacement tests are new assets, not migrations and not part of the 116-row provenance inventory. They
are authored from public behavior, the approved design, capability schemas, and disposable-VM observation
only. They are owned by the task that makes each RED test green:

| Replacement coverage | Owning task |
| --- | --- |
| MCP initialization, prompts and negotiation | Foundation Tasks 5–8 |
| ACME, device-scoped DNS and monitoring unit tests | Product-parity Task 8 |
| IaC policy and dispatch | Product-parity Task 10 |
| ACME, device DNS and monitoring VM lifecycles | Product-parity Task 12 |

Do not create a duplicate `tests/protocol/server-initialization.test.ts` if foundation coverage already
proves the same contract.

### Step 1: Add a discard-absence gate

Add a manifest test that asserts every discard destination is absent from both the working tree and Git
index. Add a history scan that detects reintroduction without printing matched private content.

Run:

```bash
node --test tests/provenance/migration-manifest.test.mjs
```

### Step 2: Verify replacement unit and protocol coverage was created by its owner

The owning tasks write failing tests first for:

- MCP initialization, instructions, prompts, capability negotiation, and unsupported-feature fallback;
- IaC capability listing, policy classification, backup requirement, apply confirmation, and forged dispatch;
- ACME schema validation and safe error normalization;
- device-scoped DNS blocking that cannot silently become global;
- monitoring read behavior and explicitly gated mutations.

After the owning tasks are complete, run the exact existing replacement paths (omit the protocol duplicate
when foundation tests are authoritative):

```bash
npx vitest run tests/integration/iac-capabilities.test.ts
npx vitest run tests/unit/capabilities/acme.test.ts tests/unit/capabilities/device-dns-policy.test.ts tests/unit/capabilities/monitoring.test.ts
```

### Step 3: Verify owner-created live tests with explicit lab gates

The live tests must refuse to run unless:

- the disposable managed VM marker is present;
- the expected firmware and plugins are healthy;
- credentials come from `APIKEY_ENV` outside the repository;
- the capability is explicitly enabled;
- setup, verification, reverse cleanup, absence proof, and VM shutdown are all recorded.

Never test against a production firewall. Run only after the unit and mock layers pass:

```bash
npm run vm:with -- npm run test:vm -- --only acme
npm run vm:with -- npm run test:vm -- --only device-dns-policy
npm run vm:with -- npm run test:vm -- --only monitoring
```

Stage only the discard-absence manifest/history gate here. Replacement tests are already committed with
their owning product tasks; do not create a second coverage commit.

**Commit:** Stage only the Task 10 discard-absence gate with message
`test: keep discarded migration assets absent`.

---

## Historical Task 11: Close the source-migration inventory — superseded, do not execute

**Files:**

- Create: `docs/provenance/migration-audit.json`
- Create: `scripts/provenance/generate-migration-audit.mjs`
- Create: `tests/provenance/migration-audit.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

### Step 1: Prove every approved source migration is accounted for

After interleaved Tasks 3–10 have committed their adapted destinations and replacement/absence gates,
require the private baseline to record for every approved group its authorized source, successful copy,
adaptation owner, and present destination. This is source-migration evidence, not final destination approval;
all 105 public approved rows remain `approved-pending-migration` so guided work can still change them.

Then run without printing either private path or digest:

```bash
test -n "${OPNSENSE_PROVENANCE_BASELINE:-}"
test -f "$OPNSENSE_PROVENANCE_BASELINE"
npm run provenance:verify
npm run provenance:scan:migration
```

The gate exits non-zero on a missing source decision, destination, adaptation record, or discard absence. It
must not write a digest or change a public lifecycle state.

### Step 2: Add the public-only CI gate

CI must run without either external environment variable:

```bash
npm ci
npm run provenance:verify
npm run provenance:scan
npm run license:check
npm run typecheck
npm run build
npm test
npm run groundtruth:validate
git diff --check
```

The CI scan verifies any already sealed digest, all pending-state shapes, discarded-file absence, candidate
and history secret hygiene, license metadata, generated drift, and new-history integrity. It reports
`externalBaselineUsed: false`, accepts the 105 approved plus 3 rewrite pending rows, and claims neither
private migration completion nor release eligibility.

### Step 3: Add the private migration preflight

Run with the external audit inputs:

```bash
test -n "${OPNSENSE_MIGRATION_SOURCE:-}"
test -d "$OPNSENSE_MIGRATION_SOURCE"
test -n "${OPNSENSE_PROVENANCE_BASELINE:-}"
test -f "$OPNSENSE_PROVENANCE_BASELINE"
npm run provenance:scan:migration
```

### Step 4: Generate a revision-bound redacted public audit artifact

`docs/provenance/migration-audit.json` may contain only:

- schema version and generation timestamp;
- base Git revision and a SHA-256 digest over the exact staged candidate tree excluding this audit artifact;
- a boolean proving there are no unstaged or nonignored untracked files outside the declared Task 11 set;
- public manifest digest;
- 105 pending approved, 3 pending rewrite, and 8 discard counts;
- aggregate public, private, secrets, license, and history verdicts;
- `externalBaselineUsed: true`;
- source-migration eligibility true and release eligibility false.

`generate-migration-audit.mjs` accepts no revision or digest argument. It derives `HEAD`, enumerates the exact
staged Task 11 candidate paths, rejects any unrelated worktree/index entry, hashes their normalized path and
bytes except the output artifact, and consumes the in-memory scanner result. Add a snapshot test that rejects
any extra field, recomputes the candidate digest, and scans all string values against runtime-generated
private sentinels. The artifact must contain no source mapping, private object identity, comparison content,
or input location.

### Step 5: Stage the exact candidate and run complete deterministic verification

Stage only the Task 11 implementation files except the generated audit, run all gates against tracked,
staged, and nonignored candidates, generate the audit, then stage it. Never use a broad `git add`:

```bash
git add package.json .github/workflows/ci.yml \
  scripts/provenance/generate-migration-audit.mjs \
  tests/provenance/migration-audit.test.mjs
npm ci
npm run typecheck
npm run build
npm test
npm run groundtruth:validate
npm run provenance:verify
npm run provenance:scan
npm run provenance:scan:migration
npm run license:check
git fsck --full --strict
git diff --check
git diff --cached --check
node scripts/provenance/generate-migration-audit.mjs
git add docs/provenance/migration-audit.json
node --test tests/provenance/migration-audit.test.mjs
npm run provenance:scan
git diff --cached --check
git status --short --branch
```

### Step 6: Run applicable live layers

Use the shared fail-safe wrapper; do not provision or stop in a fragile command chain:

```bash
npm run vm:doctor
npm run vm:with -- npm run test:vm
```

Expected: the wrapper executes residue verification and `vm:stop` even when the test command fails, and
returns non-zero with aggregated diagnostics if either cleanup action fails.

Run targeted agentic conversations to validate the migrated harness, but do not publish a full benchmark
or infer release readiness from this migration gate.

### Step 7: Commit the gate and obtain final migration-gate review

Commit the Task 11 files with message `ci: require migration provenance audit`.

Request final independent review of the four-field projection, 105/3/8 counts, fail-closed copying, both scan
modes, rewrite independence, discard coverage, candidate-bound report redaction, and AGPL-3.0-or-later
metadata.

At this point the backup replacement has already been independently authored in product-parity Task 5. The
README and contribution guide were independently initialized for the foundation and remain assigned to
guided-workflows Task 8 for their complete product and contributor content. All three public rows stay
pending together with all 105 approved rows until the release plan obtains independent final-destination
reviews after every non-evidence edit. The release plan alone may rebuild their digests, require 105
`approved-migrated` plus three `independently-rewritten` verdicts, run
`npm run provenance:scan:release`, and authorize tagging or publication.

---

## Appendix A: Approved destination inventory

The following 105 destinations are class `approved`. The public manifest stores only each destination,
class, reviewed destination digest, and audit verdict. Group labels below are execution conveniences for
the copier and are not extra public manifest fields.

### Group `installer-plugin` — 11

1. `.agents/plugins/marketplace.json`
2. `.claude-plugin/marketplace.json`
3. `plugins/opnsense-mcp/.claude-plugin/plugin.json`
4. `plugins/opnsense-mcp/.codex-plugin/plugin.json`
5. `plugins/opnsense-mcp/.mcp.json`
6. `plugins/opnsense-mcp/skills/opnsense-guide/SKILL.md`
7. `plugins/opnsense-mcp/skills/opnsense-guide/agents/openai.yaml`
8. `tests/plugin/package.test.mjs`
9. `src/cli/install.ts`
10. `src/cli/serve.ts`
11. `tests/installer/install.test.mjs`

### Group `recent-docs` — 16

1. `docs/superpowers/plans/2026-07-17-release-install-safety-benchmark.md`
2. `docs/superpowers/specs/2026-07-17-release-install-safety-benchmark-design.md`
3. `SECURITY.md`
4. `docs/adding-api-modules.md`
5. `docs/api-coverage-matrix.md`
6. `docs/ground-truth-eval.md`
7. `docs/production.md`
8. `docs/release.md`
9. `docs/ssh-features.md`
10. `docs/superpowers/plans/2026-06-22-ssh-backed-coverage.md`
11. `docs/superpowers/plans/2026-07-17-agentic-run1-audit.json`
12. `docs/superpowers/plans/2026-07-17-agentic-run1-audit.md`
13. `docs/superpowers/specs/2026-06-21-cleanup-hardening-backlog.md`
14. `docs/superpowers/specs/2026-06-22-ssh-backed-coverage-design.md`
15. `docs/testing.md`
16. `docs/tool-descriptions.md`

### Group `vm-onboarding` — 25

1. `scripts/setup/bootstrap-dev.sh`
2. `tests/setup/bootstrap-dev.test.mjs`
3. `tests/vm/install-extra-ca.sh`
4. `tests/vm/assign-wan.sh`
5. `tests/vm/bootstrap-apikey.py`
6. `tests/vm/build-registry-snapshot.test.mjs`
7. `tests/vm/build-registry.mjs`
8. `tests/vm/disable-pf.sh`
9. `tests/vm/enable-ssh.py`
10. `tests/vm/image-checksum.test.mjs`
11. `tests/vm/image-sha256.txt`
12. `tests/vm/install-plugins.sh`
13. `tests/vm/install-plugins.test.mjs`
14. `tests/vm/introspect-api.py`
15. `tests/vm/provision-one-vm.test.mjs`
16. `tests/vm/provision.sh`
17. `tests/vm/registry-diff.mjs`
18. `tests/vm/registry-diff.test.mjs`
19. `tests/vm/start-vm-reproducibility.test.mjs`
20. `tests/vm/start-vm.sh`
21. `tests/vm/stop-vm.sh`
22. `tests/vm/test_bootstrap_secret_hygiene.py`
23. `tests/vm/vm-doctor.sh`
24. `tests/vm/vm-doctor.test.mjs`
25. `tests/vm/vm-exec.py`

### Group `agentic` — 28

1. `tests/agentic/deepeval/gt_tool_policy.py`
2. `tests/agentic/model-config.json`
3. `tests/agentic/deepeval/exposed-tools.txt`
4. `tests/agentic/deepeval/gt_assurance.py`
5. `tests/agentic/deepeval/gt_attestation.py`
6. `tests/agentic/deepeval/gt_checkpoint.py`
7. `tests/agentic/deepeval/gt_lib.py`
8. `tests/agentic/deepeval/gt_metrics.py`
9. `tests/agentic/deepeval/irreversible-exclusions.json`
10. `tests/agentic/deepeval/requirements.txt`
11. `tests/agentic/deepeval/run_eval.py`
12. `tests/agentic/deepeval/semantic-contracts.json`
13. `tests/agentic/deepeval/setup.sh`
14. `tests/agentic/deepeval/test_agent_trace.py`
15. `tests/agentic/deepeval/test_attestation_adversarial.py`
16. `tests/agentic/deepeval/test_checkpoint.py`
17. `tests/agentic/deepeval/test_config_hygiene.py`
18. `tests/agentic/deepeval/test_hygiene_gate.py`
19. `tests/agentic/deepeval/test_infra_classification.py`
20. `tests/agentic/deepeval/test_metrics_adversarial.py`
21. `tests/agentic/deepeval/test_predicate_inventory.py`
22. `tests/agentic/deepeval/test_result_claims.py`
23. `tests/agentic/deepeval/test_validate_adversarial.py`
24. `tests/agentic/ground-truth.csv`
25. `tests/agentic/run-agentic.mjs`
26. `tests/agentic/temp-config-hygiene.mjs`
27. `tests/agentic/verify-bridge-cleanup.test.mjs`
28. `tests/agentic/verify-bridge.mjs`

### Group `security-backup` — 10

Rows 2 and 3 are mandatory reached behavior adaptations with the stateless roles defined in Task 6; they are
not byte copies and may not retain the source architecture.

1. `src/security/audit-log.ts`
2. `src/security/operation-policy.ts`
3. `src/http/security.ts`
4. `tests/integration/backup-flow.mjs`
5. `tests/integration/backup-id-collision.mjs`
6. `tests/integration/guardrails.mjs`
7. `tests/integration/live-script-secret-hygiene.mjs`
8. `tests/integration/transport-security.mjs`
9. `tests/smoke/log-file-mode.mjs`
10. `tests/smoke/redaction.mjs`

### Group `other-tests` — 15

1. `tests/README.md`
2. `tests/helpers/live-api-client.mjs`
3. `tests/helpers/mcp-client.mjs`
4. `tests/helpers/private-temp-json.mjs`
5. `tests/inspect.sh`
6. `tests/integration/mcp-against-mock.mjs`
7. `tests/integration/mcp-against-vm.mjs`
8. `tests/integration/ssh-config-sections-vm.mjs`
9. `tests/integration/ssh-features-vm.mjs`
10. `tests/integration/ssh-restore-vm.mjs`
11. `tests/integration/ssh-system-vm.mjs`
12. `tests/mock-opnsense/server.mjs`
13. `tests/smoke/claude-doc-consistency.mjs`
14. `tests/smoke/list-tools.mjs`
15. `tests/unit/ssh-config-editor.test.mjs`

---

## Appendix B: Independent rewrite inventory

These three destinations retain class `rewrite` after independent replacement and review:

1. `README.md`
2. `CONTRIBUTING.md`
3. `src/features/backup/storage.ts`

---

## Appendix C: Discard inventory

These eight destinations retain class `discard`, digest `null`, verdict `discarded`, and must stay absent:

1. `tests/integration/acme-live-test.mjs`
2. `tests/integration/dnsbl-live-test.mjs`
3. `tests/integration/monit-live-test.mjs`
4. `tests/integration/test-auto-initialization.ts`
5. `tests/integration/test-iac-components.ts`
6. `tests/unit/acme-client.test.js`
7. `tests/unit/dnsbl-subscription.test.js`
8. `tests/unit/monit.test.js`

---

## Historical execution handoff (superseded, do not execute)

Before Task 1, confirm the destination and preserve unrelated changes with `git status --short --branch`
and `git log -5 --oneline`.

Before copying, validate both external inputs without displaying values. Task 1 runs exactly its Step 5 gates;
it must not call the not-yet-implemented `provenance:scan`. After the separately preflighted Task 2 creates
that command, later tasks run their focused tests, `npm run provenance:verify`, `npm run provenance:scan`,
and `git diff --check`. The handoff separately lists deterministic, public-scan, private-release, VM, and
agentic results; external limitations; and created files and commits.

No completion claim is allowed from counts alone. Completion requires the independently rewritten assets,
recreated behavioral coverage, full redacted local release audit, and all applicable test layers on the final
clean revision.
