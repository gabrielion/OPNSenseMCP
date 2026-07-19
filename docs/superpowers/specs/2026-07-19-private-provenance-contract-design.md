# Private Provenance Contract Design

**Date:** 2026-07-19

**Status:** Owner-approved implementation contract

**Project license:** AGPL-3.0-or-later

## Purpose

Create one fail-closed private contract between the owner-supplied migration evidence and every later
provenance command. The contract must let the project reuse only explicitly authorized owner-authored assets,
rewrite uncertain assets independently, keep discarded assets absent, and prove those decisions without
publishing private source mappings or review evidence.

This is a one-time maintainer and release boundary. It is not part of the installed MCP server and normal
builds, tests, client installation, and runtime never require private provenance inputs.

## Decision

The former monolithic provenance Task 2 is split into five independently reviewed increments:

1. **Task 2A1 — pure private contract:** one canonical schema, one pure parser, one public immutable
   migration-group map, composition projection, and sanitized typed failures. It reads no environment,
   filesystem, Git, subprocess, platform, or private input.
2. **Task 2A2 — accepted-context preflight:** the sole external-input loader, stable POSIX filesystem
   inspection, physical Git corpus and index verification, purpose readiness, redacted CLI, and private-tool
   Windows refusal. It prepares, activates, copies, scans, and releases nothing.
3. **Task 2B — private preparation and activation:** verify a synthetic or owner-supplied bundle, compose an
   allow-listed source outside Git, produce a draft private baseline for explicit review, and activate only a
   separately digest-bound accepted snapshot.
4. **Task 2C — approved copying:** copy only an authorized public group after complete preflight, stage all
   bytes, and use a verified rollback journal if installation fails.
5. **Task 2D — scanning and release projection:** scan public and private evidence, strengthen the AGPL gate,
   and project only independently reviewed final digests into the public manifest.

Each increment has its own TDD cycle, independently reviewable local commit range, combined acceptance gate,
and independent review. Preparation, copying, scanning, and release projection all consume the same parser;
none may define a second private schema.

## Trust model

The public manifest remains the only publishable inventory. It contains exactly 105 `approved`, 3 `rewrite`,
and 8 `discard` destinations and exposes no source mapping or private evidence.

The private baseline is an external authorization snapshot. It records where an approved input came from,
which bytes were reviewed, which migration decisions were made, and which final destination digest an
independent reviewer is attested to expect. A script may calculate an observed digest for comparison, but
calculated data never becomes approval evidence automatically.

The owner/operator is the root of trust because that person already controls the repository, private inputs,
and release credentials. The threat model covers malicious or malformed inputs, poisoned Git/process state,
filesystem races, accidental evidence drift, secret disclosure, and tooling that might otherwise approve its
own observations. It does not claim to prevent a malicious owner from editing both code and evidence. Human
independence remains an operator attestation and is reported as such.

No provenance command modifies an accepted baseline. Preparation may create a draft; after human review, the
operator creates a new accepted snapshot and points the environment file to it. Later state changes likewise
produce a new reviewed snapshot instead of silently editing the authority used by an active command.

Every accepted snapshot is also bound to `OPNSENSE_PROVENANCE_BASELINE_SHA256`, an expected digest communicated
through the reviewer channel and supplied separately from the baseline file. Preparation may compute the
observed digest for a reviewer but may not populate, infer, or default this expected value. The loader hashes the
exact canonical baseline bytes and refuses a mismatch before parsing authority. This proves that a command
consumed the reviewed snapshot rather than a later edit; it still does not turn operator identities into
cryptographically authenticated people.

The private baseline and composed source stay outside the repository. They are never committed, packaged,
copied into test output, serialized into a public report, or required by a clean clone.

## Public migration groups

`scripts/provenance/groups.mjs` owns a deeply frozen destination map for the six approved groups already
published in the migration plan:

- `installer-plugin`: 11 destinations;
- `recent-docs`: 16 destinations;
- `vm-onboarding`: 25 destinations;
- `agentic`: 28 destinations;
- `security-backup`: 10 destinations;
- `other-tests`: 15 destinations.

The 105 destinations must match the approved public inventory exactly once. Group membership is public and
cannot be reassigned by a private baseline. The copier accepts only one of these six literal names and never
accepts an arbitrary destination or destination root.

## Canonical private baseline

The baseline is UTF-8 JSON with two-space indentation, stable key order, stable public-inventory order, and
exactly one terminal newline. Its maximum size is 2 MiB. Duplicate members, a byte-order mark, malformed UTF-8,
noncanonical bytes, unknown keys, or an unknown schema version fail closed.

The exact top-level keys are:

```json
{
  "schemaVersion": 1,
  "inventorySha256": "<lowercase SHA-256>",
  "sourceEvidence": {},
  "scanPolicy": {},
  "baselineReview": {},
  "assets": []
}
```

`inventorySha256` is the SHA-256 of the canonical JSON projection of the public array containing only
`destination` and `class`. The parser also compares every private row with the live immutable public inventory;
the digest is a binding and diagnostic invariant, not a substitute for exact row equality.

### Source evidence

`sourceEvidence` has exactly:

```json
{
  "bundleSha256": "<lowercase SHA-256>",
  "selectedRevision": "<lowercase 40- or 64-character Git object ID>",
  "compositionSha256": "<lowercase SHA-256>",
  "corpusRefCount": 1,
  "corpusRefFingerprintSha256": "<lowercase SHA-256>",
  "corpusObjectCount": 1,
  "corpusFingerprintSha256": "<lowercase SHA-256>",
  "similarityIndexBlobCount": 1,
  "similarityIndexSha256": "<lowercase SHA-256>"
}
```

`compositionSha256` covers a canonical ordered array with exactly `destination`, `class`,
`sourceAuthorization`, and `scanReference`. Its projected `sourceAuthorization` contains only `origin`,
`relativePath`, `mappingRelationship`, `contentSha256`, `sizeBytes`, `mode`, and `bundleRelationship`; its
projected `scanReference` contains only `relativePath`, `mappingRelationship`, `contentSha256`, and `sizeBytes`.
It excludes identities, rationale, review state, and scan policy. This binds all prepared source and
scan-reference bytes while allowing later independent reviews to create a new snapshot without changing the
composition identity. `scanPolicy` is separately covered by the canonical baseline snapshot, its expected
baseline digest, and its top-level review; removing a scan reference changes both the exact row schema and
composition digest.

`corpusRefCount` is an integer from 1 through 10,000, `corpusObjectCount` is an integer from 1 through
100,000, and `similarityIndexBlobCount` is an integer from 0 through `corpusObjectCount`. These structural
bounds are enforced by the pure parser before later preflight re-enumerates the retained corpus and index.

The prepared private root also retains a fixed bare mirror named `corpus.git` containing the complete verified
bundle. `corpusRefCount` and `corpusRefFingerprintSha256` bind the canonical bytewise-sorted bundled ref-name and
target-object-ID projection; at most 10,000 refs are accepted. The selected revision must be a commit reachable
from that exact ref set. Any bundle prerequisite or thin/incomplete object closure is refused.
`corpusObjectCount` counts every unique object physically present in the self-contained bundle pack, including
objects unreachable from a ref. `corpusFingerprintSha256` hashes their canonical bytewise-sorted projection
containing object type, exact raw-content SHA-256, and byte length. Corpus construction refuses more than
100,000 unique objects, any object over 67,108,864 bytes, or more than 1,073,741,824 aggregate object bytes. It
streams bytes and never materializes the corpus list in the public repository.

Preparation also creates a fixed private `similarity-index` over every physically bundled text blob, not only
the 116 selected references. `similarityIndexBlobCount` equals the number of strict-UTF-8, non-NUL corpus blobs;
`similarityIndexSha256` binds the canonical per-blob content digest and sorted shingle-hash sets. The later scan
compares every text blob in the release tree and full new history against this complete index, except the one
exact authorized destination for an approved source. Modified expression from an unselected legacy blob is
therefore still detected.

Every private scan re-verifies the bare mirror, full physical object enumeration, ref projection, corpus count
and fingerprint, and similarity index before using them. Every old blob is an exact-reuse comparison candidate;
only an approved source digest at its one authorized destination is exempt. `forbiddenBlobSha256` therefore
adds reviewed denies from outside the bundle and may be empty without weakening complete-bundle exact-reuse
coverage.

Credential and forbidden-reference preparation scans cover raw blob content plus commit and annotated-tag
messages across the complete physical corpus. Release scans cover the release tree and the same object kinds in
the full new history. Similarity applies only to strict-text blobs because commit metadata is checked by literal
and credential rules instead.

### Scan policy

`scanPolicy` has exactly:

```json
{
  "forbiddenBlobSha256": [],
  "forbiddenReferences": [],
  "similarityAlgorithm": "token-5-jaccard-v1",
  "similarityThresholdPermille": 750
}
```

At most 512 unique forbidden blob digests and 256 unique forbidden references are accepted, and at least one
reference must use category `legacy-reference`. Blob digests are in ascending raw-byte order. References are
in ascending order by the raw UTF-8 bytes of `category`, then by their decoded strict-UTF-8 bytes; uniqueness
uses that exact `(category, decoded bytes)` pair. A forbidden
reference contains exactly `category` and `utf8Base64`; its decoded value must be valid UTF-8, non-empty, at
most 4096 bytes, and is held only in memory. `category` is one of `legacy-reference`, `private-path`, or
`private-identifier`. Reports expose only this category.

`token-5-jaccard-v1` converts CRLF and bare CR to LF, normalizes strict UTF-8 text to NFC, folds case with
uppercase followed by NFC,
extracts maximal Unicode letter, number, or underscore tokens, and compares sets of five-token shingles with
Jaccard similarity. Sources below 20 tokens use exact normalized-byte comparison instead. The fixed threshold
is 750 permille. An input is binary when strict UTF-8 decoding fails or its bytes contain NUL; binary inputs use
exact digest comparison only. Changing the algorithm or threshold requires a new schema version and review; a
private file cannot weaken it.

Each shingle is framed as the ASCII domain separator `opnsense-mcp-shingle-v1` plus NUL, followed by five
four-byte unsigned big-endian UTF-8 byte lengths and their token bytes, then hashed with SHA-256. Preparation
refuses if one digest maps to two byte-distinct framed shingles. A release-side hash match is provisional and is
counted in the Jaccard intersection only after regenerating and byte-comparing the framed source shingle, so a
hash collision cannot create similarity.

The canonical `similarity-index` is one binary file. It begins with ASCII `OPNSENSEMCP-SIMIDX`, NUL, and version
byte `0x01`. Records are sorted by raw 32-byte corpus-content SHA-256 and contain that digest, a four-byte
unsigned big-endian count, then the record's unique raw 32-byte shingle digests in bytewise order. Empty
shingle sets use count zero. No duplicate content or shingle record is allowed. The complete file is capped at
2,147,483,648 bytes and is the input to `similarityIndexSha256`.

### Baseline review

`baselineReview` contains exactly `reviewerId` and `verdict`. A preparation draft uses null reviewer plus
verdict `pending`. A reviewed snapshot uses a non-null opaque reviewer identifier plus verdict
`reviewed-snapshot`.
Preparation is required to emit `pending`; no command may promote its own output. Copying and private scan or
release purposes refuse a baseline that is not `reviewed-snapshot`. This verdict means the container was
reviewed, not that every row is ready: each purpose still enforces its row-level readiness rules. The snapshot
reviewer may also be a row reviewer, but must differ from every author or integrator recorded in that snapshot.

### Asset rows

Every private asset row has exactly these keys:

```json
{
  "destination": "path/in/public/inventory",
  "class": "approved",
  "sourceAuthorization": null,
  "scanReference": null,
  "integrationReview": null,
  "destinationReview": null,
  "discardReview": null
}
```

Destinations and classes must match all 116 public rows exactly and in bytewise UTF-8 order. Every private
relative path uses the Task 1 NFC and Windows-portable path rules, including reserved devices, forbidden
characters, exact component case, and normalization/case-fold collision refusal. `.git` components are always
forbidden. JSON escapes that decode to an unpaired UTF-16 surrogate are rejected before path normalization or
encoding; every accepted path is a sequence of Unicode scalar values. A source path equal to its public
destination uses `mappingRelationship=same-path`. A different portable path uses
`mappingRelationship=renamed` and requires a private rationale digest before source or snapshot review can
become terminal. The mapping is bounded to one inventory destination and never creates a second public
destination, intermediate runtime tree, or unrestricted copy path.

#### Approved rows

An approved row has a non-null `sourceAuthorization` with exactly:

- `origin`: `bundle` or `overlay`;
- `relativePath`: portable path under the prepared source;
- `mappingRelationship`: `same-path` or `renamed`;
- `mappingRationaleSha256`: null for same-path, and required for an approved renamed mapping;
- `contentSha256`: lowercase SHA-256 of the authorized bytes;
- `sizeBytes`: integer from 0 through 67,108,864;
- `mode`: `100644` or `100755`;
- `authorId` and `reviewerId`: opaque bounded identifiers;
- `reviewVerdict`: `pending-source-review` or `approved-for-migration`;
- `bundleRelationship`: `selected`, `absent`, or `supersedes`;
- `supersessionRationaleSha256`: null unless an accepted overlay supersedes bundle bytes, where it is
  required.

`origin=bundle` requires `bundleRelationship=selected`. An overlay requires `absent` or
`supersedes`. Pending source review requires a null reviewer. A pending `supersedes` row emitted by preparation
has a null supersession rationale while the top-level snapshot is also pending. Approved source review, or a
reviewed top-level snapshot, requires a non-null supersession rationale digest. Approved source review requires
a non-null reviewer different from the author. Preparation always emits pending source review. The parser never
prints either identity or rationale digest.

Every opaque identity is an ASCII token from 1 through 128 characters matching
`^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$`; it is not a display name and never appears in public output.
Identity tokens are operator attestations, not authenticated accounts or cryptographic signatures. The parser
can prove structural separation and that tooling did not fill approval fields; it cannot prove the real-world
identity of the humans behind those tokens. Release documentation must describe this evidence as
operator-attested independent review, not cryptographically verified authorship.

Approved rows have `scanReference=null`, `discardReview=null`, and a non-null `integrationReview` containing
exactly `group`, `verdict`, `integratorId`, and `reviewerId`. It has one of two states:

- pending: verdict `pending`, integrator and reviewer IDs both null;
- integrated: verdict `copied-and-adapted`, distinct non-null integrator and reviewer IDs.

Their `destinationReview` contains exactly `expectedContentSha256`, `authorId`, `reviewerId`, and `verdict`.
It is either fully pending with null digest and identities, or fully reviewed with an expected lowercase
SHA-256 of the raw stage-0 Git blob content, `authorId` exactly equal to `integrationReview.integratorId`, a
different independent reviewer, and verdict `approved-migrated`.

#### Rewrite rows

A rewrite row has `sourceAuthorization=null`, `integrationReview=null`, and `discardReview=null`. It has a
non-null private `scanReference` containing exactly `relativePath`, `mappingRelationship`,
`mappingRationaleSha256`, `contentSha256`, and `sizeBytes`, used to detect copied expression; `sizeBytes` has the
same 67,108,864-byte per-reference maximum and that reference is never copy authorization. A renamed scan
reference requires a rationale digest before top-level snapshot review.

Its `destinationReview` is either fully pending or fully reviewed with expected SHA-256 of the raw stage-0 Git
blob content, distinct author and reviewer identities, and verdict `independently-rewritten`.

#### Discard rows

A discard row has `sourceAuthorization=null`, `integrationReview=null`, and `destinationReview=null`. Its
private `scanReference` has the same exact five-key shape and mapping rules as a rewrite scan reference and
supplies the old path, digest, and byte length for exact-reuse and similarity checks. It uses the same
67,108,864-byte per-reference maximum. `discardReview` contains exactly one key with verdict `discarded`. No
discarded destination may exist in the filesystem, Git index, tracked history, package, or prepared copy set.

Across all source authorizations and scan references, the accepted aggregate byte length is at most 536,870,912
bytes. Limits are checked before reading source content.

## Shared interfaces

`scripts/provenance/private-baseline.mjs` exports only:

```text
parsePrivateBaseline(bytes, publicContract) -> deeply frozen baseline
canonicalPrivateBaseline(value) -> canonical bytes
privateCompositionProjection(value) -> canonical non-public projection bytes
```

`bytes` accepts a `Buffer` or `Uint8Array` and is copied before decoding so caller mutation cannot change the
validated snapshot. `canonicalPrivateBaseline` and `privateCompositionProjection` reconstruct fresh objects in
the prescribed key order and the authoritative `MIGRATION_INVENTORY` row order and reject a missing, unknown,
duplicate, destination-mismatched, or class-mismatched structural member. They do not establish
semantic validity or review readiness; `parsePrivateBaseline` is the only function that applies the full
schema/state/live-public-contract validation and compares the reconstructed canonical bytes with the copied raw
input. The composition projector accepts the same complete top-level structural shape but emits only the
specified reduced asset projection.

`publicContract` is a narrow dependency-integrity assertion, not caller-provided policy. Its five properties
must be the exact immutable `MIGRATION_INVENTORY`, `MIGRATION_CLASS_COUNTS`, `portableCollisionKey`,
`compareDestinations`, and `isPortableDestination` exports from `scripts/provenance/inventory.mjs`. The parser
accepts only a plain non-Proxy wrapper with exactly five ordered, enumerable own data properties; it rejects
accessors, symbol/non-enumerable extras, alternate prototypes, and any replacement object, array, count map, or
callback by identity before invocation. It then uses a separately constructed frozen wrapper around the five
authoritative exports for every later validation and digest. The caller wrapper is never reused as authority,
so arbitrary caller callbacks, Proxy traps, or time-varying getters never become path or inventory authority.

The parser is pure: it reads no environment, filesystem, clock, network, Git configuration, or process state;
it writes nothing and emits no diagnostics. Validation failures use one typed internal error without carrying
the rejected value.

`scripts/provenance/private-context.mjs` exports:

```text
loadPrivateContext({ repositoryRoot, purpose, group, environment })
  -> deeply frozen { baseline, baselinePath, sourceRoot, corpusRoot, similarityIndexRoot }
```

`purpose` is one of `audit-scan`, `copy`, `migration-scan`, `release-scan`, or `release-build`. The loader is the only code
allowed to read `OPNSENSE_PROVENANCE_BASELINE`, `OPNSENSE_PROVENANCE_BASELINE_SHA256`, and
`OPNSENSE_MIGRATION_SOURCE`. Later commands receive the validated context and may not read those variables
independently. `corpusRoot` and `similarityIndexRoot` are the verified `corpus.git` and `similarity-index`
siblings under the common private parent. Private preparation has separate bundle, owner-overlay, and output
preflight because no accepted baseline exists yet; it uses the same canonicalizer and parser to prove its draft
but cannot call an accepted-context purpose.

`group` is one of the six public group names when `purpose=copy` and is null for every other purpose. Purpose
readiness is fail-closed:

- `copy` requires `reviewed-snapshot` plus approved source review for every row in the selected group;
- `audit-scan` requires `reviewed-snapshot` and internally coherent rows but deliberately permits pending
  source, integration, and destination states;
- `migration-scan` requires `reviewed-snapshot` and approved source review for all 105 approved rows plus completed
  integration review for all 105;
- `release-scan` and `release-build` additionally require reviewed final destination digests for all 105
  approved and 3 rewrite rows.

The loader validates private authority readiness; the consuming scan or builder separately validates current
filesystem and Git state. A ready baseline alone never proves that migration or release is complete.

The ordinary `provenance:scan` always runs its public checks without private input. If none of the three private
variables is present it reports public-only evidence. If all three are present it loads `audit-scan` and adds
private comparisons while keeping migration and release eligibility false for pending rows. A partial set of
private variables is a preflight error, never a silent public-only fallback.

The shared parser rejects cross-phase impossibilities before purpose checks. An approved destination cannot be
integrated until its source review is approved, and cannot have final destination review until integration is
complete. Copy purpose additionally requires selected rows to have pending integration and destination review;
an already integrated row is not silently overwritten. Rewrite destination review moves only from fully pending
to fully reviewed. Discard rows have no source, integration, or destination-review state. A
`reviewed-snapshot` may intentionally contain unrelated pending groups so migration can proceed group by group;
the stricter migration and release purposes still require their complete terminal matrices.

## Private preparation contract

The later preparation command is the only producer of a baseline draft. It requires the five operator-supplied
values already defined by checkpoint P0: bundle path, independently communicated bundle SHA-256, owner
worktree, empty private root, and new private environment-file path.

It verifies the bundle digest and completeness before materializing anything; retains and fully unbundles the
physical pack into a self-contained bare mirror; and checks out one selected revision without executing hooks.
For each of the 116 fixed public destinations it first tests the same relative path. When a reviewed migration
requires a renamed source, the owner supplies that one private relative path through bounded non-echoing input;
the command never searches for or guesses a replacement. At the chosen path, bundle-only bytes select `bundle`;
owner-only bytes become a pending `overlay`; identical bytes in both select `bundle`. Differing bytes in both
have no default: an interactive owner must explicitly select the overlay as `supersedes`, and later independent
source review plus rationale digests for supersession and renaming are still required. The command refuses dirty
or reused outputs, symlinks, non-regular files, missing mapped sources, mapping collisions, unresolved byte
collisions, or a private root equal to a filesystem root, home root, or repository ancestor/descendant.

The owner supplies the opaque author identity and any collision decision through bounded non-echoing standard
input, never a process argument. Preparation records observed bytes and that selection but leaves every source
review and top-level baseline review pending. Thus the original five P0 values remain sufficient and no second
mapping schema is introduced.

Before an asset can enter the composition, the command scans the complete bundle and selected overlay bytes
for credential categories. A match reports only its fixed category, excludes the affected bytes from every
group, and blocks preparation until the credential is rotated. Tests use generated sentinels; no real
credential value is committed. Generic detector patterns are public code and receive their own adversarial
tests in the preparation increment.

Successful preparation creates a mode-`0700` private root, a frozen source composition, a canonical mode-`0600`
baseline draft with top-level and per-source review still pending, the fixed verified bare mirror, and the
complete bound similarity index. It reserves but does not create a usable environment file. After separate
review, an activation step consumes the
reviewer-communicated expected baseline digest through bounded non-echoing standard input; it never computes or
defaults that expected value. It writes the mode-`0600` environment file defining only
`OPNSENSE_MIGRATION_SOURCE`, `OPNSENSE_PROVENANCE_BASELINE`, and
`OPNSENSE_PROVENANCE_BASELINE_SHA256`. It prints no private path, ref, identity, digest, mapping, or content.
Environment-file values reject C0 controls and DEL and use one tested POSIX single-quote serializer; shell
metacharacters remain literal and cannot add a command or a fourth assignment.

## External-input preflight

The loader and `scripts/provenance/private-preflight.mjs` require:

- execution from the real Git worktree root;
- all three documented private-selection environment variables, with no alternative variable or CLI path
  override;
- lowercase 64-character `OPNSENSE_PROVENANCE_BASELINE_SHA256` and absolute path values for the other two
  variables; paths are NFC, reject C0 controls and DEL, and are at most 4096 encoded bytes;
- a baseline regular file, source directory, bare `corpus.git` directory, and regular `similarity-index` file
  outside the repository;
- a baseline file, source directory, `corpus.git`, and `similarity-index` that are direct children of one common
  private parent outside the repository, filesystem root, and user home root;
- a common private parent that is neither an ancestor nor a descendant of the repository and is on one device
  with all of its retained children;
- exact real component case and no symlink or junction component;
- a current-user-owned parent with mode `0700` and baseline with mode `0600` on POSIX;
- prepared source directories with owner mode `0500`, regular files with `0400` for baseline mode `100644` or
  `0500` for baseline mode `100755`, and no group/other permission on any component;
- current-user ownership and link count one for every baseline, source, and corpus regular file;
- every source path to resolve beneath the validated source root as a regular file;
- the exact baseline bytes to match the separately supplied expected digest;
- observed bytes, sizes, modes, composition digest, full physical corpus, ref projection, counts, fingerprints,
  and similarity index to match the reviewed snapshot.

Git subprocesses use argument arrays, an allow-listed environment, literal pathspecs, system/global config
isolation, disabled replacement objects, disabled external diff/textconv/fsmonitor, fixed output limits, and
bounded timeouts. Small control commands use a 10-second deadline and 32 MiB accumulated-output cap, matching
the public validator. Corpus and index commands stream object bytes directly to bounded hash/index sinks rather
than accumulating stdout. Their overall deadline in seconds is
`min(900, 60 + ceil(corpusBytes / 8_388_608))`; each individual object uses
`min(60, 10 + ceil(objectBytes / 8_388_608))`. Metadata remains capped at 32 MiB. No source content or private
identifier is passed through a shell.

Sensitive regular files are opened with `O_NOFOLLOW` through bounded file descriptors, then `fstat`-checked
before and after streaming. Device, inode, type, size, owner, mode, and link count must remain stable through
the operation; path identity is rechecked before any copy uses the bytes. A changed path fails the complete
preflight instead of retrying against new content.

The bare mirror is self-contained: no shallow boundary, promisor remote, object alternate, replacement ref,
hook, symlink, submodule checkout, or hard-linked object file is accepted. `git cat-file --batch-all-objects`
must enumerate the same physical object corpus that preparation fingerprinted. Git verification runs with
optional locks disabled and may not repair, prune, repack, or fetch missing data.

The preflight CLI accepts only `--purpose <literal>` and, for copy purpose, one `--group <literal>`. Unknown,
duplicate, missing, or reordered forms fail with exit 2. Paths and private values are never command-line
arguments.

The baseline `mode` is the intended Git destination mode; the prepared source's restrictive filesystem mode is
only its private-storage protection.

The public manifest verifier remains fully cross-platform. The private preparation, `audit-scan`, copy,
migration-scan, release-scan, and release-build commands initially refuse `win32` with fixed exit code 2 because
POSIX modes do not prove Windows ACL confidentiality. This maintainer-only restriction does not affect the npm
package, installer, MCP runtime, client adapters, or final native-Windows product smoke. Adding private Windows
release tooling requires a separate design that validates ACLs by SID without extra user-installed software.

## Copy and rollback semantics

The later copier validates the complete selected group before its first destination write. It stages all
source bytes in a repository-owned private temporary directory, records the exact pre-existing destination
state, installs each leaf with same-filesystem atomic replacement, and verifies every installed digest and
mode.

A multi-file group is not described as crash-atomic. If an ordinary failure occurs after the first
replacement, the copier restores every touched path from its journal in reverse order and verifies the restored
state before returning. Failed or incomplete rollback is a distinct terminal failure requiring operator
action. The copier never changes the public manifest or private baseline and never copies rewrite or discard
rows.

## Release projection

The later release builder is a projection, not a reviewer. For each approved or rewrite row it requires an
already reviewed private destination digest and verifies that digest against the clean stage-0 Git blob. It may
then produce candidate public manifest bytes containing only the existing public fields and reviewed verdict.

The builder never writes review identities, source mappings, input digests, scan references, private paths, or
policy values to the repository. It refuses dirty worktree bytes, missing or non-regular index modes, pending
reviews, self-review, or any digest it observed but did not receive as independent expected evidence.

## Diagnostics and exit behavior

Private CLIs print one stable success summary or one fixed error code. They never print:

- absolute paths or environment values;
- source mappings, Git object IDs, or private digests;
- author, integrator, or reviewer identities;
- forbidden reference text or matching content;
- malformed JSON fragments, stack traces, or underlying subprocess stderr.

Exit `0` means the requested private preflight or audit completed. Exit `1` means an audit/content violation in
a command that had valid inputs. Exit `2` means usage, platform, repository, environment, filesystem, or private
input preflight failure. Task 2A's preflight therefore returns only `0` or `2`.

## TDD and review gates

Tasks 2A1 and 2A2 use only synthetic values, temporary repositories, temporary private roots, generated
sentinel identities, and generated byte content. Neither inspects the real bundle, old repository, VM,
firewall, or user credentials.

The Task 2A1 focused suite must prove:

- exact canonical schema, duplicate-member rejection, key allow-lists, size bound, and deep freezing;
- exact 116-row inventory and six-group partition;
- the complete valid and invalid state matrices for approved, rewrite, and discard;
- digest, mode, size, identity separation, overlay, and supersession rules;
- exact composition projection and exclusion of identities, rationales, review state, and scan policy;
- positional canonical key order at every object nesting level and exact public-inventory row order;
- that pure parsing cannot access environment, filesystem, Git, subprocess, platform, clock, or network;
- that parsing cannot manufacture or default review evidence.

The Task 2A2 focused suite must prove:

- portable Windows/Unicode path and collision predicates as host-independent unit projections, plus real POSIX
  symlink and exact-entry-case refusal;
- absent, malformed, in-repository, overbroad, permission-unsafe, or caller-poisoned external inputs;
- fixed simulated and later native-Windows private-tool refusal while the public verifier remains portable;
- Git configuration, index, attributes, replacement-ref, diff, and environment isolation;
- deadline calculation at every corpus-size boundary and streamed object verification without accumulated
  content output;
- zero private sentinel value in stdout and stderr on every success and failure path;
- complete private-corpus binding and refusal of an absent, truncated, extra-ref, or fingerprint-mismatched
  mirror;
- refusal when the separately supplied reviewed-baseline digest is absent or mismatched;
- that preflight cannot manufacture or default review evidence.

Task 2B owns environment-file serialization and activation. Its focused suite must cover newline, quote,
backtick, command-substitution, duplicate-assignment, trailing-payload, exclusive-creation, and exact-mode
adversarial cases before an activation implementation is accepted. Copier and release-projection tasks extend
the no-self-approval proof at their own boundaries.

After their own RED and GREEN evidence, Tasks 2A1 and 2A2 each pass their Node 22 focused tests,
`npm run provenance:verify`, `npm run license:check`, `npm run verify`, both MCP conformance profiles, and
`git diff --check`. Each receives an independent specification-conformance review and code-quality review.
The combined Task 2A acceptance review must approve the schema, parser boundary, path security, redaction, and
Windows claim before private preparation starts.

## Out of scope for Task 2A

- Opening or validating the real owner bundle.
- Reading the old repository or owner worktree.
- Creating the real private baseline or environment file.
- Copying, adapting, or sealing any migration asset.
- Running an OPNsense VM, firewall test, agentic benchmark, or client subscription.
- Publishing a package, tag, release, benchmark result, or Windows support claim.

## Normative plan routing

The blocked Task 2 and checkpoint P0 text in the existing migration plan remain historical design input and
must not execute directly. The implementation-plan index now routes through: pure synthetic contract
implementation and review; synthetic accepted-context preflight implementation and review; synthetic private
preparation implementation and review; real draft generation; independent source and snapshot review;
separately supplied baseline digest; activation; real accepted-context preflight; independently reviewed copier;
then group copying. Historical Tasks 3 through 11 remain blocked until replacement plans explicitly reactivate
the applicable work.

## Success criteria

- One parser is authoritative for all later private provenance commands.
- A clean clone validates the public manifest without any private input.
- Private evidence cannot enter logs, reports, Git, packages, or public manifest fields.
- Private authorization and observed bytes remain separate; tooling cannot populate approval evidence, while
  the documented owner-controlled trust assumption remains explicit.
- The six public groups partition all and only the 105 approved destinations.
- Every private path and byte set is bounded, external, regular, case-exact, and symlink-free.
- The one-time private gate makes no false Windows confidentiality claim while the shipped product remains a
  native-Windows target.
- No real private source is consulted before Task 2A is independently approved.
