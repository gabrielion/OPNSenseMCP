# OPNSenseMCP — progress ledger

BASE before Task 1: 8d7aa59
Windows WIP parked: git stash "windows-distribution-wip-paused"

Task 1: complete (commits 8d7aa59..baaa779, gates green, 890/890)
  - Refinement A: envelope routing + services invariant key on defineWriteCapability membership
    (writeEnvelopePreflights WeakMap), NOT effect string — preserves foundation local-write fixtures
    and elicitation/factory/default-application tests.
  - Refinement B: defineWriteCapability uses <TInput,TOutput> (apply output == verified output).

Tasks 2-4 (consolidated): complete (commit baaa779..<head>, gates green, 909/909)
  - Envelope services: lock.ts, backup.ts (0700/0600, symlink-refused, checksum), audit.ts (bounded, redacted).
  - kernel executeMutationEnvelope: fixed 9-step order; every post-backup failure preserves backup +
    reconciliation guidance in the fixed message; no backupId crosses the MCP boundary; no blind restore.
  - Consolidated plan Tasks 2/3/4 into one atomic commit (one coherent algorithm) since subagent review
    is unavailable; remaining: Task 5 (composition wiring + bypass re-proofs + full gate).

Task 5 (bypass re-proofs + gate): complete (commit d4ed571..f4dea3e)
  - YAGNI deviation: did NOT wire dead envelope services into production composition (product catalog
    exposes 0 writes). Real wiring belongs to Product 3 when a real mutation is admitted. Proven instead:
    READ_ONLY hides+refuses envelope caps before any service runs; forged name -> UNKNOWN_CAPABILITY;
    reads never touch services.
  - Gate: verify green EXCEPT installed-package (tests/integration) fails ONLY on the OpenCode evidence
    tarball-sha pin (tests/fixtures/opencode.product1a.json). Source additions changed the tarball; the
    4 read tools are unchanged. Regeneration requires `npm run smoke:opencode` (opencode CLI + model),
    an owner/environment step. NOT faked. Conformance 2025+2026 = 13/13. 923/924 vitest.

Product 2 status: envelope complete and green; open item = regenerate OpenCode evidence via smoke.

Product 2 CLOSED (commit 4fcf605): OpenCode Product 1A evidence regenerated via the real
`npm run smoke:opencode` (model opencode/north-mini-code-free routed the 3 reads; status=passed;
genuine new tarball sha256 6fe2183...). Full `npm run verify` green: 49 files / 924 tests, plus
operations/format/lint/typecheck/license. Conformance 2025+2026 = 13/13. The mutation envelope is
complete and every gate passes with no outstanding red. Next: Product 3 (first reversible mutation).

=== PRODUCT 3 (first reversible mutation) — deterministic vertical COMPLETE ===
Spec: docs/superpowers/specs/2026-07-20-product-3-first-mutation-design.md (commit cf8996c)
Plan: docs/superpowers/plans/2026-07-20-product-3-first-mutation.md (commit c0e19e4)
Executed inline. Commits:
  6b7f510 T1 admit firewall.alias to catalogue/contract (OperationEffect+firewall-write, generator/contract widened, describe advertises writes)
  154c63a T2 alias write adapter + closed client arms (add/del/reconfigure/search)
  31f08f9 T3 kernel defineWriteResourceCapability + effectiveResourceScopes threading
  0fd64ed T4 opn_list genuine multi-resource dispatch (union output)
  843f057 T5 opn_create/opn_delete verbs + elicitation (alias-schema.ts)
  046e0b5 T6 OPNsense config-backup service + raw client byte-path
  e2cf524 T7 production composition wiring (catalog+services+backup root)
  03cfeab T8 MCP-to-mock full lifecycle (both eras) + failure paths + OpenCode evidence reseal (sha e055d9e0)
Gate: npm run verify GREEN (56 files / 963 tests + operations/format/lint/typecheck/license).
      test:conformance 2025+2026 = 13/13. No outstanding red.
Deviations from plan (all recorded): none material; delete output simplified to {item:{id}} (no boolean in
  JSON-schema contract); write-verb selectableResourceScopes = resourcesSupporting(op) (firewall.alias only).
OPEN: T9 disposable-VM seal (exit gate). transportStatus still 'documented', evidence.vm 'pending'.
  T9 step 1 offline runner is committed with alias-ACL bootstrap, installed-package MCP lifecycle and cleanup
  coverage. Live VM boot (T9 step 2) remains owner/env (M3 READY via TCG, slow).

Cutover Task 1A: complete (commits 03cfeab..c61d305, review clean).

Cutover Task 1B: complete (Product 3 disposable-VM seal).
  - Live runner PASS on the disposable local OPNsense 26.1.6 VM: the bounded firewall.alias
    list → create → list → delete → list lifecycle completed, and cleanup reported the VM stopped
    with no residue. No production target was contacted.
  - The observed firewall.alias list/create/delete transports are sealed as vm-observed-26.1.6 with
    verified-product3 evidence; reconfigure remains an apply command, not a separately sealed operation.
  - Bootstrap ACL correction: the disposable mutation account uses the granular configuration-history
    and alias-edit stock ACLs, not user-config-readonly, which would reject mutable model saves.
  - OpenCode Product 1A evidence was regenerated against the resealed package and synthetic HTTPS target;
    the three expected read tools were observed, with secret redaction and cleanup confirmed.

Cutover Task 1: complete (Task 1A + Task 1B).

Repository cutover: complete (2026-07-24).
  - `gabrielion/OPNSenseMCP` is the canonical PUBLIC repository. Its `main` history was replaced,
    with an exact force-with-lease, by the sealed Product 3 tip `2722bedc4f9229e4b886e362675d8ff15cd40589`.
  - A fresh public clone has root `1f809e645232dc58226cef5edf9e81906c6e13a8` and tree
    `01966da758e3192fcef55865a762a5cbc7b1af05`; the former public tip is absent and no legacy tag
    was published.
  - The legacy repository is preserved separately on GitHub as PRIVATE, with its recovery tag
    verified. Pre-cutover committed and uncommitted work is also retained in local recovery refs
    and verified bundles; no private path or bundle digest is published here.
  - Final canonical gates: `npm run verify` = 57 files / 990 tests; conformance in both protocol
    eras = 13/13; OpenCode smoke passed against the synthetic target; disposable OPNsense 26.1.6
    Product 3 lifecycle and cleanup passed. No production firewall was contacted.
  - Fresh-clone post-push gates under Node 22: operation descriptors and license headers passed.

Post-cutover P0 hardening program: design checkpoint in progress (2026-07-25).
  - Owner direction: reuse is permitted only for assets already approved by the provenance contract; every
    reuse still crosses private preflight, exact copy, independent destination review, public digest/verdict,
    and the normal provenance/license/verification gates.
  - Selected approach: no broad legacy merge. Continue on the clean public repository with vertical
    reimplementation; the private archive remains a behavioural inventory and recovery source.
  - P0-A: recover the three public CI failure groups (configure, installed-package, OpenCode output-limit)
    from causal reproductions without weakening assertions or evidence.
    Diagnosed: configure fixtures cross Linux `/tmp` (`01777`) and are correctly refused by the secure
    ancestor policy; installed-package and the nominal output-limit test both depend on an incomplete user
    npm cache, with the latter failing before it reaches the fake client. No production security policy is
    to be relaxed; package installation will use a lock-derived loopback-only npm registry with isolated
    home/config/cache, and process cleanup must be confirmed.
  - P0-B: align docs and the standalone boundary, keep alias writes explicitly experimental and require a
    non-empty `firewall.alias` allow-list. Exact flag: `experimental-alias-write`; an empty allow-list keeps
    all reads but authorizes zero writes. Add a real VM-produced, commit-bound attestation and exact
    ACL/evidence/non-claim documentation.
  - P0-C: persist backup/audit/locking safely across processes and restarts, then close host-alias syntax,
    target identity, local reconciliation, indeterminate-write classification, pagination, full-state
    identity, exact create/delete verification, and 201-row coverage.
  - Approved-asset selection for these P0s: `none`. The approved legacy audit candidate failed the new
    durability/concurrency review, so P0-C is a clean implementation; future reuse remains allowed only via
    the recorded provenance workflow.
  - Draft spec:
    docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md
  - Status: spec APPROVED by the owner as written (2026-07-25). Implementation started.

P0 plan decomposition (2026-07-25): one plan per increment, not one plan for all three.
  - P0-A plan committed now: docs/superpowers/plans/2026-07-25-p0-a-public-ci-recovery.md
  - P0-B plan is written after P0-A is green, because its documentation tasks must be derived from
    the live catalogue of the post-P0-A commit.
  - P0-C plan is written after P0-B, because the alias read-back, pagination, and counter-semantics
    tasks depend on the outcome of the disposable-VM `searchItem` probe that the spec requires
    before those tasks can be specified honestly.
  - Approved-asset selection for all three increments remains `none`.

P0-A causal reproductions recorded before any fix (Node 22.23.1):
  - configure: `TMPDIR=/tmp npx vitest run tests/config/configure.test.ts` = 16 failed / 8 passed.
    `/private/tmp` is `01777`, correctly refused by the `requireSafeAncestor` `(mode & 0o022)` check
    in src/config/configure.ts. Whole-suite run under the same TMPDIR fails only in that one file
    (16 failed / 974 passed of 990), so no other test is sticky-directory sensitive.
  - installed-package: with an empty `npm_config_cache`, both tests fail with `npm install failed`;
    `npm install --offline` depends on packuments left in the user's npm cache.
  - registry fixture feasibility: `npm pack` cannot build the fixture tarballs because npm 10.9.8
    runs `prepare` lifecycle scripts for directory specs even with `--ignore-scripts`; a staged
    `package/` directory archived with `/usr/bin/tar` installs correctly with an empty cache and an
    unreachable registry. The lock has 96 non-dev entries and no optional/os/cpu/install-script
    entries, so the lock projection is an exact `name@version` set equality.

P0-A plan committed: f91128f (docs/superpowers/plans/2026-07-25-p0-a-public-ci-recovery.md).

P0-A step 1 (configure group): complete (commit aead07a).
  - Fix is fixture-only: tests/support/private-fixture-root.ts and
    scripts/testing/private-fixture-root.mjs create roots below $HOME/.opnsense-mcp-fixtures and
    fail closed on an unsafe ancestor chain. `git diff -- src/` is empty; src/config/configure.ts is
    byte-identical.
  - New regression `rejects a sticky world-writable ancestor without creating anything below it`
    was proven to FAIL against a deliberately weakened `(mode & 0o002) && !sticky` check, which was
    then reverted and re-verified as an empty src diff.
  - Gate: `TMPDIR=/tmp npx vitest run tests/config/configure.test.ts` = 25/25 and the plain run =
    25/25; prettier/eslint/typecheck/license-headers pass; $HOME/.opnsense-mcp-fixtures is empty
    after the run.

P0-A step 4a (bounded-command cleanup, independent half of the output-limit slice): complete
  (commit 6bb7865).
  - `scripts/run-opencode-smoke.mjs`: bounded spawn/timeout/output-limit failures now await child
    close plus a proven-empty owned process group (`/bin/ps -axo pgid=`, 5s bound) before being
    reported; the confirmation travels through `runModelCommand`; the output cap is per-call
    injectable and `OUTPUT_LIMIT_BYTES` (4 MiB) is exported.
  - Gate: `npx vitest run tests/integration/opencode-smoke-runner.test.mjs` = 11/11, prettier and
    eslint clean.
  - Remaining for step 4b: injectable package preparation, and the end-to-end assertion that a real
    terminated group reported `groupCleanupConfirmed: true`.

P0-A step 2 (registry fixture): complete (commit 52e609b, subagent-implemented, reviewed inline).
  - scripts/testing/local-npm-registry.mjs serves the 95 distinct lock-derived name@version pairs
    (96 lock entries; content-type@2.0.0 appears twice) on a random loopback port after verifying
    each installed identity and path containment.
  - npm pack cannot build the fixture tarballs: npm 10.9.8 runs `prepare` for directory specs even
    with --ignore-scripts. Tarballs are staged as `package/` and archived with /usr/bin/tar.
  - Correction found during integration: npm legitimately probes the ONE optional peer the lock does
    not install (@cfworker/json-schema, declared optional by @modelcontextprotocol/sdk). That set is
    derived from the lock and answered with a recorded 404 via absentRequests(); a missing REQUIRED
    peer throws at fixture start. Without this, the "zero unknown requests" invariant was violated by
    correct npm behaviour.
  - eslint.config.js: the type-aware rule set cannot apply to hand-written .d.mts declaration files;
    they now join the disableTypeChecked block. This was the only production-config change in P0-A.
  - Gate: 7/7 registry tests. Independent hermeticity proof: express installs from the fixture with
    an empty cache and dead proxy sentinels and resolves to the locked 5.2.1; the negative control
    (public registry + same sentinels) fails ECONNREFUSED, so the success is not network leakage.

P0-A step 3 (installed-package group): complete (commit 834e41d).
  - scripts/testing/prepare-installed-package.mjs packs, installs into an isolated consumer
    (new HOME, empty user/global npm config, empty cache, loopback registry, audit/fund/scripts
    disabled, proxy sentinels), then verifies the npm ls production graph against the lock
    projection, the installed shebang/licence prefix, and zero unknown registry requests.
  - --offline removed; --no-package-lock/--no-save dropped so the consumer graph is real.
  - Gate: with an EMPTY npm cache (the exact CI condition) installed-package + harness = 19/19,
    in ~52s. The committed OpenCode package sha256 pin still matches, so the tarball is unchanged.

P0-A step 4b (output-limit reaches the fake client): complete (commit 697c04b).
  - runSmoke() exposes an injectable preparation seam, output cap, OpenCode binary and work root,
    and validates OPENCODE_BIN before any packaging (so the configuration-failure test no longer
    depends on npm at all).
  - The scenario proves mcpConnected (fake client reached), modelFailure='output-limit' (configured
    cap actually exceeded) and groupCleanupConfirmed=true (real terminated group proven empty).
  - Teeth proof: lowering the fake client's output below the configured cap makes the test FAIL.
  - Gate: opencode-runner project 11/11.

P0-A step 5 (residue hardening): complete (commit 2cab3dd).
  - The deliberately timed-out teeth-proof run leaked one fixture root, because a vitest hard
    timeout skips the `finally` that removes it. The helpers now track outstanding roots and each
    suite teardown asserts it had to reclaim NONE, so a skipped cleanup fails loudly instead of
    accumulating silently. Found by the exit-gate residue check, not by a test.

P0-A full gates (2026-07-25, Node 22.23.1):
  - `npm run license:check` pass; `npm run verify` = 58 files / 1000 tests pass.
  - `npm run test:conformance` = both 2025-11-25 and 2026-07-28 profiles, 13/13, exit 0.
  - Repository residue: `git diff --check` clean, no `results` directory, no untracked files, and
    $HOME/.opnsense-mcp-fixtures empty after every run.
  - Combined Linux-CI-equivalent run (sticky TMPDIR=/tmp AND an empty npm_config_cache together,
    i.e. both original causal conditions at once): vitest exit 0, 58 files / 1000 tests passed, no
    residue. A first attempt reported the exit code of the trailing residue check rather than
    vitest's, so it was discarded and re-run capturing VITEST_EXIT explicitly.
  - `git diff 786f092..HEAD -- src/` is EMPTY: no production source changed in the whole increment.
    The only non-test change is one eslint.config.js line for .d.mts declaration files.

P0-A review round (subagent adversarial review of 786f092..HEAD): 10 findings, ALL accepted as real
  after independent verification, all fixed before any push.
  - HIGH 1: `groupCleanupConfirmed` was initialized `true` and only ever assigned on the bounded-
    failure branch, so a PASSING smoke reported a confirmed process-group cleanup it had never
    measured. Now `null` = not measured; only a measured `false` blocks; a discarded
    BoundedCommandFailure from `opencode --version` no longer loses its observation. New regression
    proves a completed model command reports `groupCleanupConfirmed: null`.
  - HIGH 2: the residue assertions scanned `tmpdir()`, which the new code never writes to, so both
    were tautologies. They now assert on the private fixture base and the injected work root.
  - HIGH 3: the deleted WORST_CASE budget guard was a real invariant, and the new child budgets
    summed to EXACTLY the outer timeout (180+300+120 = 600s). Budgets are now named constants
    (120/180/60s + registry budget) with a test asserting the sum is strictly below the outer
    timeout; the registry archiver and listen paths gained timeouts they lacked entirely.
  - MED 4: `localArchiveInstallArguments` had become dead code that a test still "verified"; the
    real argv is now `hermeticInstallArguments`, used by the actual install.
  - MED 5: the "no developer working-tree module" claim was overbroad — `prepack` builds `tsc`
    against the repository tree by design. The comment now scopes the no-fallback claim to the
    consumer install and states that repacked fixture tarballs are NOT integrity-verified against
    the lock: hermetic means no network, not a supply-chain proof.
  - MED 6: smoke teardown swallowed failures and `cleanupConfirmed` covered only an inner
    subdirectory; teardown failures now block confirmation and the whole owned root must be absent.
  - MED 7: the deleted "no pre-built dist" assertion is restored inside the helper that owns the copy.
  - MED 8: the residue proof is widened from `consumerRoot` back to the entire work root.
  - MED 9: CLI exit-code mapping lost its coverage; `run()` is injectable and directly tested for
    exit 3/0, its report line, and argument rejection before any smoke runs.
  - LOW 10: `process-cleanup-unconfirmed` could mask `secret-redaction-failed`; overwrites are now
    ordered least-to-most severe.
  - Reviewer non-findings: no production security policy relaxed (src/ byte-identical), the
    expected-absent peer set cannot silently grow and a required missing peer fails closed, no
    private data, and no manufactured or resealed evidence.

P0-A push 1 (f119d6e) -> public CI STILL RED on one test, cause found and fixed:
  - The push fixed all three targeted groups (configure, hermetic install, OpenCode runner all green
    on Ubuntu), but exposed a PRE-EXISTING defect the old failure had masked:
    `installed-package.test.ts` pinned the `.tgz` digest of the sealed OpenCode evidence, and gzip is
    NOT reproducible across platforms.
  - Proven empirically, macOS vs node:22.23.1 Docker container:
      .tgz digest        macOS cd97c35f... vs Linux ea0c3cd5...  DIFFERS
      uncompressed tar   cf9de45ca009...   on BOTH               IDENTICAL
    So the packaged content is reproducible; only the gzip layer is not.
  - Fix: pin the uncompressed-archive digest (`package.tarSha256`, evidence schemaVersion 1 -> 2).
    Strictly stronger than the old pin, not weaker.
  - The evidence was regenerated by its REAL producer (`npm run smoke:opencode`, OpenCode 1.18.3,
    model opencode/north-mini-code-free): status=passed, three expected reads observed, secrets
    absent, cleanup confirmed. Nothing was hand-edited. The sealed tarSha256 equals the digest
    measured independently inside the Linux container.
  - Verified on Linux BEFORE pushing this time: the previously failing test passes 2/2 in a
    node:22.23.1 container.

P0-A adversarial workflow review (4 lenses, each finding independently refuted): 19 raised,
  18 refuted, 1 survived — and it was correct:
  - The "portable" tar digest still encoded the packing host's umask. npm's portable tar
    normalization is `mode = (mode | 0o600) & ~0o22`: it collapses 0644/0664 but PRESERVES the
    group/other read bits, so a contributor on umask 027 would pack 0640 and get a different digest
    for byte-identical content — reading as "the package was tampered with", whose natural remedy
    (reseal) would silently rebase the public pin onto their umask.
  - Fix: build and pack are now separate steps so the emitted tree can be mode-normalized in
    between (files 0644, directories 0755, symlinks untouched); `npm pack --ignore-scripts` then
    packs the normalized tree. A focused test pins the normalizer.
  - Proven: the full preparation under umask 022, 027 and 077 all produce cf9de45ca009..., equal to
    the sealed evidence. The overclaiming comment was corrected to state exactly what was verified.

P0-A: COMPLETE and CLOSED (commits f91128f..2d39e10, pushed to origin/main).
  - PUBLIC CI GREEN on 2d39e10: verify, compatibility-floor and protocol all success
    (run 30153126218). This is the increment's real exit gate, observed rather than assumed.
  - Local gates on the same tree: license:check, verify = 58 files / 1005 tests, conformance 13/13
    in both protocol eras, git diff --check clean, no residue.
  - `git diff 786f092..2d39e10 -- src/` is EMPTY: the entire increment changed zero production
    source. The only non-test changes are one eslint.config.js line (.d.mts) and vitest.config.ts
    (test grouping).
  - Known flake, NOT introduced here and NOT claimed fixed: tests/conformance/run-conformance.test.mjs
    "destroys the held upstream response when the upstream ClientRequest errors" failed once with
    read ECONNRESET under full-suite load. It passes 3/3 in isolation and 175/175 for its file. The
    package fixtures were moved to their own sequential group to remove the contention this
    increment added; that is a mitigation, not a proof of stability.

=== P0-B (truthful public boundary) — IN PROGRESS ===
Plan: docs/superpowers/plans/2026-07-26-p0-b-truthful-public-boundary.md (commit 96dda31), 9 slices.
  Five slices go beyond the approved spec, each answering a defect the five-lens assessment found and
  an independent verifier confirmed: the false backup promise, the blind confirmation, the unvalidated
  allow-list, UNKNOWN_CAPABILITY for an unconfigured target, and the per-commit evidence pin.
  Recorded deviation: the spec's literal ALLOWED_RESOURCES value (line 184) hides server_status,
  because server_status declares the uncatalogued scope `server.status`; the runner will use the
  four-token value and Task 4 catalogues the scope.

P0-B slice 1 (truthful refusal text): complete (commit f62b25f).
  - OUTCOME_INDETERMINATE and OUTCOME_UNVERIFIED claimed "the pre-change backup is preserved" and told
    the operator to reconcile against it. The backup root is mkdtempSync under tmpdir and a shutdown
    closer rmSync's it (src/app/default-application.ts:94-126), so the instruction pointed at a file
    that does not survive the process. Both messages now state only what is true.
  - The text lived in THREE copies (kernel.ts, results.ts, and an independent copy in
    tests/security/policy-kernel.test.ts). A new test pins the first two byte-identical; another
    forbids any message from claiming a preserved backup while the store is per-process.
  - One assertion demanded the word 'preserved' (mutation-envelope.test.ts:255) — the assertion itself
    encoded the false claim. Re-pointed, not deleted: it now requires the actionable instruction AND
    forbids any preservation promise. Same treatment in create-/delete-capability tests.
  - Gate: verify 1007/1007, conformance untouched, lint/format/typecheck/license green.

P0-B slice 8 (evidence pin scoping): complete (commit ca95423), PULLED FORWARD out of plan order.
  - Reason: slice 1 changed src/, which changed the packaged content, which broke the sealed-digest
    pin inside `npm run verify` — exactly the failure mode the assessment predicted, on the first
    slice. Deferring the fix would have meant a red per-commit gate for the whole increment.
  - `npm run verify` keeps every installation proof and now asserts the sealed evidence still
    describes THIS package (name, version, well-formed portable digest). Digest EQUALITY moved to
    `npm run evidence:check` (new vitest project `evidence`, excluded from the default run).
  - CURRENT STATE, deliberate: `npm run evidence:check` is RED
    (built a73438bf... vs sealed cf9de45c...). That is the gate working: the package really did
    change. It is re-sealed by its real producer (`npm run smoke:opencode`) at the end of P0-B, never
    by hand. Public CI runs `npm run verify` only, so CI stays green.

P0-B slice 2 (descriptive write confirmation): complete (commit 3e3b7df).
  - Before: src/mcp/confirmation.ts sent one fixed string for every create and delete, so the human
    gate was a blind yes/no. After: `create firewall.alias "lab_hosts" (1 entry)` /
    `delete firewall.alias "<uuid>"`, asserted end to end in BOTH MCP eras.
  - Design fact that shaped it: the effect-plan digest is computed inside executeMutationEnvelope
    step 2, i.e. AFTER confirmation (kernel.ts:1566), so it could not be rendered. The capability
    supplies `summarizeChange(resolvedInput)`; the kernel seals it (control characters stripped,
    subject bounded to 72 code points, other fields to 32). Required by the type, so no future write
    can be added without describing itself.
  - The sealed capability-definition key allow-list correctly refused `summarizeChange` until it was
    declared there — the AGENTS.md guard working as intended.
  - Test placement corrected mid-slice: a "hostile alias name" test at the integration level would
    have passed WITHOUT exercising the boundary, because AliasCreateAttributesSchema already limits
    names to ^[A-Za-z0-9_]{1,32}$. The sealing test now lives at the kernel boundary with a fixture
    capability that deliberately returns newlines and 200 characters.
  - Two lint errors were fixed at the root rather than suppressed: `[...string]` became Array.from
    (code-point iteration is what the bound counts), and the control-character assertion stopped
    inspecting the JSON-serialised form, where such characters are escaped and the check proved
    nothing.
  - Gate: verify 1010/1010, conformance exit 0, lint/format/typecheck/license green.

P0-B slices 3+4+5 (write containment, scope vocabulary, target routing): complete (commit 28905e1).
  - Absent ALLOWED_RESOURCES = all reads, ZERO writes. Enforced at all three deciding points
    (catalog.isExposed, authorizeRequest scope rung, post-resolution recheck) so a direct call
    cannot bypass what listing hides. `experimental-alias-write` added to FeatureFlagSchema and
    required by opn_create/opn_delete.
  - src/capabilities/resource-scopes.ts seals the scope vocabulary (descriptor keys + server.status)
    and PRODUCT_MCP_NAMES. ALLOWED_RESOURCES tokens are validated: a typo is now a startup error,
    not a silently narrower surface.
  - A catalogued-but-unregistered product tool answers TARGET_UNAVAILABLE instead of
    UNKNOWN_CAPABILITY.
  - STRENGTHENED, not merely adapted: the envelope-services guard used exposure as its evidence, and
    since a write is now hidden by default it would have gone silent. Two tests caught it. The guard
    now asks the catalogue via a new `listAll()` on CapabilityCatalogView, so a dispatcher built
    without services cannot even HOLD a write capability — stricter than before this increment.
  - Test fallout, all setup and never assertions: ~60 harness sites had to name their scope. Several
    fixtures declared `resourceScopes: []`, which under an explicit allow-list can never be
    authorized; they were given real scopes rather than relaxing the rule.
  - Two process failures worth remembering: two scripted replacements silently did nothing because
    prettier had reformatted the target text, costing two full gate cycles. Edits are now verified
    to have landed before any gate is run.
  - Gate: verify 1016/1016, conformance exit 0, lint/format/typecheck/license green.

Ledger publication note (2026-07-25): `.superpowers/sdd/progress.md` is tracked and public in this
  repository (it already was at 786f092) even though `.gitignore` lists `.superpowers/sdd/`, so
  `git add` needs `-f`. Leaving it stale would publish a false status, so it is kept current.
  Whether it should remain public is an open P0-B sanitation decision for the owner.

P0-B slice 6 (truthful public documentation): complete (commits 44acead, 0d4d0d9, ead64c5).
  - Method: five parallel readers, one per area, each confronting every public claim with the code
    path that decides it, then independent refuters on each finding. 98 claims checked, 28 findings
    ranked. The subject was MY OWN rewrite of README.md, and it did not survive contact: the
    envelope order was inverted, elicitation was described as HIDING write tools when it refuses at
    call time, and the ALLOWED_RESOURCES example given would have broken any server that copied it
    (the allow-list filters reads too, so server_status and both documented reads would vanish).
    Writing honestly is not the same as writing verifiably; only the confrontation with the source
    separates them.
  - REAL PRODUCT DEFECT found by this pass and fixed (44acead): opn_delete accepted any alias UUID,
    while its observed-state digest AND its outcome verifier both read HOST aliases only. Deleting a
    network or GeoIP alias would have passed revalidation and been reported to the caller as a
    VERIFIED SUCCESS, with the capability unable to observe the target at all. Preflight now refuses
    with PREFLIGHT_FAILED before the first write; the new test proves no delete call is issued.
  - Regression from slice 3 caught here (0d4d0d9): scripts/vm/product3-alias.mjs still started the
    server with READ_ONLY=false alone, so the containment work had silently disabled the disposable
    VM lifecycle runner. Slice 7 would have failed at its first check.
  - Documentation corrections, each anchored in code: real 11-step envelope order (audit intent
    BEFORE backup); the three listing conditions vs the call-time elicitation condition; a complete
    ALLOWED_RESOURCES example; `configure` ignores OPNSENSE_CONFIG_FILE, needs a TTY, never
    overwrites; backup deleted at shutdown, no restore and no rollback; audit is an in-memory ring of
    1024; opn_list returns host entries only. Unproven claims about live VM mutation and the
    100-alias pagination ceiling are now stated as explicit NON-claims.
  - tests/foundation/documentation.test.ts asserts the corrected wording on whitespace-normalized
    prose so reflowing a paragraph cannot silently drop a promise. 15/15.
  - Gate: verify exit 0, 1020/1020 across 58 files, lint/format/typecheck/license green.
    `npm run evidence:check` remains RED by design until the end-of-P0-B re-seal.

P0-B slice 7 (commit-bound disposable-VM attestation): COMPLETE
  (commits 6113770, f002f14, 4981db1, 6f086b4, 7931d4b).
  - The producer now refuses a dirty tree and a non-absolute output, binds the exact tested commit,
    tree, policy inputs, pinned image and fixed checks, and writes canonical schema-v2 JSON only
    after lifecycle, VM cleanup and residue proof. The verifier returns 0 coherent, 2 stale and
    1 unreadable, and permits a later P0-C replacement without widening the evidence-only delta.
  - TDD: the initial missing producer/verifier contract failed first; commit/tree drift, incomplete
    VM cleanup, wrong image pin, symlink evidence, missing-parent durability and later evidence
    replacement each received a focused red/green proof. Independent task review found no open
    source-level Critical or Important issue.
  - Correction to the prior blockage record: the sanitized Product 3 summary discarded
    Product1bBootstrapError.stage, so `failureStage=bootstrap` proved only that bootstrap rejected;
    it did NOT prove authentication failed or that the supplied value was invalid. The standalone
    read-only bootstrap and the exact Product 3 ACL bootstrap later both completed against fresh
    disposable overlays, showing that neither remained a supported persistent root-cause attribution.
  - Commit 4981db1 now preserves only the twelve fixed, allow-listed bootstrap stages while rejecting
    arbitrary stages and every error detail. Strict TDD included a negative teeth proof; full gates
    passed, and independent review found no Critical, Important or Minor issue.
  - The first complete post-diagnostic Product 3 run passed all twelve fixed checks and produced real
    evidence. The required format gate then caught that Prettier attempted to own the compact canonical
    bytes. Commit 6f086b4 excludes only `docs/evidence/product3-vm.json` from Prettier and pins that
    boundary in a package-contract regression; the attestation verifier remains the format owner.
  - The invalidated uncommitted artifact was deleted, never hand-edited. A second real producer run
    against 6f086b4 passed doctor, VM start, bootstrap, package install, writable surface, alias
    absence/create/read/delete/final absence, VM stop and residue proof. Commit 7931d4b contains only
    the resulting `docs/evidence/product3-vm.json`.
  - Fresh post-producer gates under Node 22.23.1: license passed; verify passed 58 files / 1045 tests;
    both conformance eras passed every configured scenario with zero failures or warnings
    (2025: 1/1, 1/1, 2/2; 2026: 2/2, 1/1, 13/13); `git diff --check` passed;
    `npm run evidence:verify` returned 0 before and after the evidence-only commit. Independent
    reviews of both producer artifacts found no Critical, Important or Minor issue.
  - The recorded Product 3 producer attempts owned only the disposable local VM and completed cleanup
    with vmStopped=true and residueFree=true. The final attested run proves the same properties; no
    production target was contacted and no attestation was synthesized.
  - Once committed, this tracked ledger update will advance HEAD beyond the evidence-only commit. The
    real producer must renew the evidence after the remaining tracked P0-B exit-gate work; the verifier
    will then return 2 until that final renewal, never be bypassed or manually resealed.

P0-B resumed exit-gate documentation correction: complete (commits aba410a..5d91d5f, review clean).
  - Replaced the plan's two literal NUL bytes with textual `\0`, so the plan is valid UTF-8 text.
  - README now names every excluded broad legacy surface required by the approved spec.
  - CONTRIBUTING now distinguishes all four live MCP read-tool calls from the two downstream
    OPNsense API calls made by the last two tools.
  - TDD: the two assertions failed before the prose change and passed afterwards; the complete
    documentation test file passed 18/18. Independent task review found no open finding.

P0-B corrective policy-order slice: complete (commits 2ca0f83, 83f0275; review clean).
  - Listing and direct/forged dispatch now apply READ_ONLY, feature flag, resource scope and
    transport in the approved order, before target availability.
  - With no target, only the four reads are listed; eligible forged alias writes return
    TARGET_UNAVAILABLE only after all four policy gates, with no handler or network I/O.
  - Unavailable write metadata lives in a kernel-private WeakMap, absent from the exported
    catalogue surface. Alias-adapter availability is snapshot once at startup.
  - TDD: initial priority/no-target regressions and both review regressions failed before their
    fixes. Final focused gate passed 195/195, full verify passed 1105/1105, both conformance
    profiles passed, and independent re-review found no open finding.

P0-B installed-runtime cwd isolation: complete (commit e815ebd, review clean).
  - Product 1A, Product 1B and Product 3 now carry the exact installed invocation
    `{command, arguments, cwd}` and launch from the isolated consumer root.
  - A shared validator rejects missing, relative, malformed or NUL-bearing invocation data before
    any transport or process starts; the checkout is never reconstructed as the runtime cwd.
  - TDD: Product 1A/1B/3 and portable-harness regressions failed before propagation. Final VM
    runner gate passed 65/65, the focused cwd gate passed 9/9, the installed harness passed 19/19,
    and independent review found no open finding.
  - The complete verify/conformance gates remain reserved for the final combined candidate; one
    combined Vitest run exited 0 without a readable summary and is not used as counted evidence.

P0-B later-commit attestation worktree check: complete (commit f8b9800, review clean).
  - The verifier now inventories staged, unstaged and non-ignored untracked paths in both
    attestation states. Pre-evidence permits only the evidence path; a later evidence commit
    requires a completely clean worktree and index.
  - TDD: tracked unstaged, tracked staged and untracked later-commit fixtures each returned 0
    before the fix and now return stale=2. The focused verifier block passed 10/10 and the complete
    documentation test passed 21/21.
  - No evidence file was edited or regenerated. Independent review found no open finding.

P0-B Product 3 installed-process lifecycle: complete (commits 5954ce7, 472944e; review clean).
  - Product 1B and Product 3 now share one hardened stdio lifecycle: validated consumer cwd,
    bounded connect/request/total/close, actively consumed 1 MiB stderr ceiling with zero-byte
    success policy, strict capabilities, idempotent close, and observed child exit 0/no signal.
  - Product 3 retains pinned protocol 2026-07-28 and elicitation.form; every timeout, diagnostic,
    stderr overflow, nonzero exit, signal or unconfirmed close fails the lifecycle and blocks the
    attestation path.
  - TDD: nine Product 3 lifecycle regressions failed before extraction. The final Product 1B +
    Product 3 gate passed 77/77. Review found and TDD-corrected one lost Product 1B shallow-freeze
    compatibility guarantee; independent re-review found no open finding.

P0-B resumed final exit gate: complete through the pre-attestation candidate
  (commits 0c42e43, 368c8c8; final adversarial review clean).
  - The real OpenCode Product 1A producer passed against the installed package and changed only
    `tests/fixtures/opencode.product1a.json`. Its sealed-package check passed before the evidence
    commit; the evidence was never hand-edited.
  - A whole-branch adversarial review found two Important defects. First, a timed-out SDK close
    could return while its installed MCP child remained alive. The shared lifecycle now requires
    the captured ChildProcess termination surface, sends SIGKILL after a failed bounded close, and
    observes the child close under a second bound before returning. Product 1B and Product 3 tests
    prove the forced termination and listener cleanup.
  - Second, public CI and the documented release gate could remain green while
    `evidence:verify` declared the commit-bound VM attestation stale. CI now runs the official
    verifier, and the release gate requires both package evidence and VM-attestation verification.
    The wording records the exact supported evidence-only successor-commit rule.
  - TDD: the lifecycle and gate assertions failed in the expected three cases before the fixes.
    The combined Product 1B, Product 3 and documentation gate passed 99/99. The final re-review
    found no open Critical, Important or Minor issue.
  - Fresh pre-attestation gates under Node 22.23.1: license passed; verify passed 58 files /
    1127 tests; both conformance eras passed every configured scenario with zero failures or
    warnings (2025: 1/1, 1/1, 2/2; 2026: 2/2, 1/1, 13/13); provenance and sealed OpenCode
    evidence passed; `git diff --check` passed.
  - This ledger commit intentionally precedes the final real Product 3 producer. The VM evidence
    verifier must remain stale until that producer succeeds against the final clean candidate and
    an evidence-only commit is created.

DeepEval + real OPNsense agent-evaluation design and handoff: documentation candidate
  (2026-07-28; no implementation or benchmark result yet).
  - The owner selected DeepEval as the canonical open-source framework and approved the high-level
    architecture: Claude Code host -> installed OPNSenseMCP -> owned disposable OPNsense VM -> MCP
    readback, followed by deterministic state-transition gates and DeepEval agent-quality metrics.
  - The written design follows the current DeepEval MCP model and pins the first implementation to
    `deepeval==4.1.4`, the PyPI release checked on 2026-07-28 (the versionless docs still display a
    “DeepEval 4.0” banner). It covers live tool-catalogue/call/result capture, single- and multi-turn
    metrics, repeat policy, privacy, failure classification, report boundaries and a success-shaped no-op
    regression. LLM-judged scores cannot override a failed VM state or cleanup check.
  - The initial alias mutation contract is absent -> create -> same UUID present -> delete same UUID ->
    absent, observed through the installed MCP server. This is real configuration readback, not packet-flow
    proof and not broad production coverage.
  - The 28 historical `tests/agentic/**` destinations remain `approved-pending-migration` with no public
    content digest. The superseded migration task is not executable. Initial work therefore uses clean-room
    `tests/evals/**` and `scripts/evals/**` paths; historical behaviors inform requirements only.
  - `docs/project-status.md` now records project vision, reachable tools, P0-A/B/C state, evidence lifecycle,
    commands, provenance constraints, traps, exact next gate and a copy/paste prompt for a context-free
    session on another machine. Root `AGENTS.md` now points agents to that durable state and makes proof,
    credential, review and handoff rules explicit.
  - Next design gate: the owner reviews the complete written specification. Only after approval should
    `superpowers:writing-plans` produce the TDD implementation plan. There is no canonical agentic score to
    publish at this point.

Serial-bootstrap progress deadline fix (2026-07-29).
  - Defect: `bootstrapProduct1b` armed one deadline from connection (`timeoutMs`, default 30 s) and matched
    only console output arriving after connect. `startDisposableVm` returns as soon as the guest answers on
    its API port, which happens long before getty prints `login:`. Measured on the reference workstation:
    API ready 69 s after qemu launch, `login:` at 112 s. Feeding the password immediately made the runner
    watch [69 s, 99 s] and miss the prompt, failing at stage `login` every time; the historical interactive
    runs passed only because an operator's typing latency shifted that window onto the prompt.
  - The console itself was never at fault. A raw capture through `net.createConnection` showed the full boot
    transcript and the prompt `FreeBSD/amd64 (OPNsense.internal) (ttyu0)\r\n\r\nlogin: ` with no trailing
    newline, followed by silence. The existing connect-time newline already covers a prompt printed before
    connect, so only the deadline needed changing.
  - TDD: three tests failed first in tests/vm/product1b-bootstrap.test.mjs — a slow boot that keeps writing
    must still reach the prompt (rejected at 310 ms with stage `login`), a console that chatters forever
    without a prompt must fail closed on the absolute cap (took 5 003 ms instead of 400 ms), and an unusable
    `overallTimeoutMs` must be refused at stage `validation`. A fourth test pins the preserved fail-closed
    behaviour for a console that never writes at all.
  - Fix: `timeoutMs` now bounds absence of console progress and is re-armed on every data chunk; a new
    `overallTimeoutMs` (default 600 s, max 1 800 s) keeps an endlessly chattering console from hanging the
    runner. No change to the login/menu/shell/upload state machine, the credential handling, or the fixed
    failure shape.
  - Product 3 VM attestation is renewed in the following evidence-only commit, produced with the password
    delivered immediately at the hidden prompt: that run is itself the live proof of the fix.

Handoff to a larger workstation (2026-07-29).
  - Reason: the original Mac has too little RAM to keep running the disposable VM alongside the test
    suites. The branch is pushed so the work resumes elsewhere.
  - Published state: `codex/p0b-resume-wip` at `562004b`. Gates on that exact tree, Node 22.23.1:
    license, verify (58 files / 1131 tests), conformance 2025 + 2026 (13/13 on the final profile),
    provenance, sealed OpenCode evidence and `git diff --check` all passed.
  - `npm run evidence:verify` returns 2 at handoff, by design. The Product 3 attestation in `12bc618`
    was produced by a real VM run with all twelve checks true, but it binds `3fcb8a3`; `7ad2684` and
    `562004b` are later non-evidence commits. Renewing it is the first task on the new machine and no
    completion may be claimed until the verifier returns 0.
  - NOT YET PROVED LIVE: the serial-bootstrap deadline fix in `7ad2684` is covered by deterministic tests
    only. The renewal run is its live proof and should be performed with the password typed immediately
    at the hidden prompt. A failure at stage `login` would mean the recorded root-cause analysis is
    incomplete and must be reopened rather than worked around.
  - The last successful producer run used a deliberately delayed password delivery to land inside the old
    30 s window. That workaround is no longer needed and should not be reintroduced.

Credential-free serial bootstrap (2026-07-29, larger workstation).
  - The password path is removed rather than fixed. The pinned nano image never marks its console
    `insecure`, so its loader offers an unauthenticated single-user root shell. The bootstrap now selects
    loader option `2`, remounts `/` read-write, stages the existing
    `buildProduct1bBootstrapHelper(FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES)` helper as base64, decodes it with
    the guest's own `openssl`, registers a stock `rc.syshook.d/start` hook, and exits to multi-user. The
    helper then runs under configd and prints the existing `PRODUCT1B_BOOTSTRAP_FRAME_*` framing on the
    serial console. `readSecretLine` and every credential prompt are gone from all runner paths.
  - Sequencing: `startDisposableVm` does not return until the guest answers TLS on 127.0.0.1:18443 (~65 s),
    but the loader menu appears at ~3.3 s and QEMU's `wait=off` chardev DISCARDS console output while no
    client is attached. The bootstrap therefore runs from a `bootstrapConsole` callback invoked between
    process launch and the readiness probe; it cannot be applied to an already running VM.
  - Two guest-side traps, both fixed by matching the repository's existing heredoc uploader: base64 written
    as one ~5 000-character line decodes to an EMPTY file because the guest decoder is line-oriented (use
    standard 76-character lines), and ~500-character commands sent every 150 ms overrun the emulated tty
    input buffer and strand the shell in quote-continuation (drive every command from the shell prompt).
  - Rejected with a definitive negative result: seeding a random root password with `pw usermod` in
    single-user. OPNsense regenerates `/etc/master.passwd` from `config.xml` at multi-user boot, so the
    seeded credential is discarded and login fails.
  - Live proof of the `7ad2684` progress-deadline fix was obtained by DIRECT MEASUREMENT rather than by the
    originally planned renewal run, because the new bootstrap removes the `login:` path entirely and makes
    that proof impossible by construction. Over three boots: maximum console silence 11 754 ms against the
    30 000 ms progress deadline (~18 s margin), `login:` at 95–126 s against the 600 000 ms absolute cap,
    and the old single 30 s window armed at connect missed the prompt by 10.7 s and 3.5 s.

Event-loop liveness defect in the bootstrap retry gap (2026-07-29).
  - Symptom: the runner exited code 0 with NO summary and left an orphaned qemu reparented to PID 1.
  - Root cause: in `onConsoleLost` the failed socket is destroyed and set to `undefined`, and every other
    loop anchor was already unref'd — the qemu child (`child.unref()`), `overallTimer`, `progressTimer` and
    `retryTimer`. During the reconnect gap nothing kept the loop alive, so node exited mid-`await`,
    abandoning the caller. The tests missed it because the fake `net` server already exists when
    `createConnection` runs (so attempt 1 succeeds) and vitest's own loop masks the emptiness.
  - Fix: `retryTimer` is no longer unref'd; it is the only pending work in that window. The two deadline
    timers stay unref'd — they are safety bounds covered by the live socket during normal streaming.
  - Regression: a bare child process (not vitest) drives `bootstrapProduct1b` at a nonexistent socket path
    with bounded retries and asserts the promise SETTLED before exit. Before the fix it recorded
    `{settled:false, outcome:'none'}`; after, `{settled:true, outcome:'rejected:connecting'}`.

Live installs migrated to the hermetic lock-pinned preparation (2026-07-29).
  - Defect: both live runners installed with `npm install --offline --no-package-lock --no-save`. The fresh
    consumer resolves the archive's ranges without a lock, so it selects the newest published matching
    version instead of the locked one. `@modelcontextprotocol/server` declares `hono: ^4.11.4`; the lock
    pins and caches `4.12.30`; upstream published `4.12.32`, which was never cached, so the install failed
    `ENOTCACHED` and both runners stopped at `failureStage: package`. The proof depended on upstream release
    timing, not on this repository. This is exactly the non-hermetic boundary the P0-A design already
    identified and replaced for the installed-package suite in `834e41d`; only the VM path was left behind.
  - Fix: `installCurrentPackage` now delegates to `scripts/testing/prepare-installed-package.mjs`, whose
    loopback registry serves only lock-derived versions and additionally verifies the installed production
    graph against the lock projection, the shebang/licence prefix, and zero unknown registry requests.
    `packageInstalled: true` is therefore a strictly stronger claim than before.
  - It returns `{invocation, cleanup}` because the caller must close the fixture registry: an open listening
    socket would keep the event loop alive past the summary. Both runners release it before removing the
    temporary root, in a separate `try` so a release failure still runs the removal.
  - Gate: tests/vm 144 passed; standalone hermetic preparation 5.3 s with `registryUnknownRequests: []`.

Pinned image moved to OPNsense 26.7 (2026-07-29).
  - Owner decision: the getting-started documentation must target the latest OPNsense, so the pin moves
    from 26.1.6 to 26.7 (official SHA-256 `28d5e2f3...cb9d`, 490 849 116 bytes, published 2026-07-13).
  - `scripts/vm/attestation.mjs` hard-constrained BOTH the release string and the image digest, so the
    producer would have refused every 26.7 attestation. Seven verifier tests failed with `code 1` and
    located it. Anyone bumping the pin again must change that file too.
  - Two references to 26.1.6 must NOT follow the pin: the sealed `tests/fixtures/product1b.live.json`
    records a real past run on 26.1.6, and the README line describing it. Those are historical facts, not
    configuration. The pin advances; already-produced evidence keeps the version it actually observed.
  - The credential-free serial bootstrap works unchanged on 26.7: the loader regex, the single-user prompt
    and the syshook staging all hold. That was the main risk of the bump.
  - `transportStatus: vm-observed-26.1.6` is deliberately NOT promoted to 26.7 in this increment. Those
    claims stay historically true, the alias operations have not yet been re-observed on 26.7, and the
    change would cascade into `contractDigest` (pinned at scripts/vm/product1b-live.mjs:66). Separate
    increment, and it must be sequenced before an attestation run rather than after.

OPNsense 26.7 makes the system status field polymorphic (2026-07-29).
  - Defect: `npm run test:product1b` on 26.7 returned `failureStage: reads` with ONLY `systemStatus` false;
    `core.services` passed over the same credentials, TLS session and client, so the failure was specific
    to that one operation.
  - Root cause: `metadata.system.status` is an INTEGER for a least-privilege API client on a freshly booted
    firewall and a STRING once a subsystem has posted a status. The core controller seeds the field with
    `SystemStatusCode::OK->value` and only overwrites it with the enum name later. Enum: ERROR = -1,
    WARNING = 0, NOTICE = 1, OK = 2. The adapter's `z.string()` rejected the integer, so the tool returned
    `EXECUTION_FAILED`.
  - Investigation trap worth remembering: three hypotheses (response shape, Zod schema, missing ACL) were
    all wrong because they were tested with a GUI session cookie, which returns the STRING. The MCP server
    authenticates with an API key, which returned the INTEGER. Reproduce through the product's own path
    before reasoning about causes; the runner's deliberate error redaction means a dedicated diagnostic is
    required rather than inference.
  - Fix: the schema accepts `string | int(-1..2)` and normalizes to the documented name, failing closed if
    upstream ever widens the range rather than surfacing a bare integer as a health status.
  - Also observed, and important for the setup tutorial: `/api/core/firmware/status` returns 403 to the
    least-privilege account. That is the endpoint the community's OPNsense MCP docs recommend as a
    connection test, so our documentation must use `/api/core/system/status` instead.
  - Gate: read-adapter 11/11 (4 numeric cases, string passthrough, out-of-enum rejection); `test:product1b`
    on 26.7 `status: passed` with all eleven checks true and no residue.

Product 1B live proof fully green (2026-07-29).
  - `npm run test:product1b` returned `status: passed` with all eleven checks true — doctor, vmStarted,
    bootstrap, packageInstalled, readOnlySurface, serverStatus, resourceDescription, systemStatus,
    servicesPage, vmStopped, residueFree — and exited within 40 s of the VM stopping, leaving no qemu
    process and no instance directory. This is the first run to prove the credential-free bootstrap and the
    hermetic install together against a real disposable VM.

=== P0-C SLICE 1 (durable state root + target identity) — COMPLETE ===
Branch: p0c/slice1-state-identity (2026-08-10)
  - New module src/state/ with three implementations (target-identity.ts, state-root.ts, identity-key.ts)
    and one barrel export (index.ts); tests/state/ provides 40 conformance tests covering all paths.
  - Invariants proved:
    - Canonical origin (https scheme only, lower-cased host, explicit default port 443 or explicit non-default,
      no credentials/path/query/fragment, static error strings).
    - Target identity: lowercase unpadded base32 of HMAC-SHA-256(identity.key, canonicalOrigin), exactly
      52 characters, cryptographically underivable without possession of the 32-byte key.
    - State root resolution: absolute override respected on darwin and linux (XDG_STATE_HOME or ~/.local/state
      default on linux, Application Support on darwin), win32 and unknown platforms fail closed even with
      override.
    - Directory discipline: 0700 mode on state root and targets/<id>, 0600 on identity.key, canonical
      absolute paths enforced, O_NOFOLLOW option used for all operations, directory drift rejected and
      never automatically repaired.
    - Identity key publication: exclusive winner via link->unlink protocol with exactly one survivor,
      losers reread the published key, fsync before publish and fsync parent of published key, crash
      residue (candidate files) swept at startup, existing key never overwritten, validated owner/0600/nlink1/
      32-bytes on every opening.
  - Two traps for Slice 2 (inter-process lock):
    (a) noUncheckedIndexedAccess: bracket-indexing a string then concatenating fails restrict-plus-operands
        — use charAt() instead.
    (b) KNOWN PARKED RACE: a concurrent loser can observe nlink=2 during the winner's link->unlink window
        and spuriously report an integrity error on a healthy key. This is not a defect; the race exists
        in the spec. Slice 2 must add bounded revalidation retry when the kernel calls this under the
        inter-process lock.
  - Gate results:
    - `npm run license:check`: exit 0
    - `npm run verify`: exit 0 (58 files / 1194 tests, format/lint/typecheck/license all pass)
    - `npm run test:conformance`: exit 0 (2025-11-25 and 2026-07-28 profiles, 13/13 each)
    - `git diff --check`: exit 0
