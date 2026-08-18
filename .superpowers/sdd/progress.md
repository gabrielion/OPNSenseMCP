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
    (b) KNOWN PARKED RACES (Slice 2 bounded retry): concurrent loser observes nlink=2 during winner's
        link->unlink window and spuriously reports integrity error on healthy key (allowed by spec);
        concurrent startup cleanup can unlink another live starter's not-yet-linked candidate, whose
        linkSync/unlinkSync then throws raw path-bearing ENOENT (and the unlinkSync inside catch masks
        the original error). Slice 2's bounded retry must cover BOTH races by retrying the whole
        publication attempt, not just revalidation.
  - Gate results:
    - `npm run license:check`: exit 0
    - `npm run verify`: exit 0 (61 files / 1194 tests, format/lint/typecheck/license all pass)
    - `npm run test:conformance`: exit 0 (2025-11-25 and 2026-07-28 profiles, 13/13 each)
    - `git diff --check`: exit 0
  - Required Slice 2 carry-over: unsafe-ancestor validation (spec 'State root and target identity',
    directory-discipline paragraph) is not implemented. ensurePrivateDirectory validates canonical path
    and leaf owner/mode but never walks ancestor ownership/writability. Unreachable in Slice 1 (defaults
    under $HOME); required decision in Slice 2 (implement the ancestor walk or record an explicit scope
    ruling).

=== P0-C SLICE 1.1 (hardening of Slice 1 + 0.1.1 candidate) — COMPLETE, NOT YET LANDED ===
Branch: p0c/slice1.1-hardening (2026-08-17/18), base fc3b100 from main, commits fc3b100..989f503.
  - N1/N2 — the two concurrent-first-start races parked by Slice 1 are CLOSED
    (src/state/identity-key.ts):
    - cleanupCandidates now tolerates ENOENT: a peer sweeping our candidate is not a failure. Every
      other unlink/link/read failure is classified persistent and throws the SAME static sentence, so
      no raw errno and no absolute private path can escape ensureIdentityKey any more.
    - Bounded retry: MAX_ATTEMPTS = 5 whole attempts (sweep -> exists -> publish -> validated read).
      Transient = link ENOENT, post-publication unlink ENOENT, and nlink != 1 when it is the ONLY
      failing predicate (the winner's link->unlink window). Everything else throws immediately.
    - Evidence is a REAL multi-process race test (tests/state/identity-key-race.test.ts): 12 Node
      children on a shared wall-clock barrier, 4 fresh rounds plus a planted-residue pass. Pre-fix
      19-28% of starters failed per round at 12-way and 33-43% at 20-way (residue scenario 11/12);
      post-fix a stress diagnostic saw 0 failures in 576 starters across 12- and 20-way, fresh roots
      and planted residue, with one agreed key per race and no candidate residue.
    - MAX_ATTEMPTS ruling: it STAYS 5. After the barrier was tightened (Atomics.wait sleep instead of
      a busy spin — ~60 CPU-seconds saved per race-file run, and a measurably sharper reproducer), the
      deepest observed chain was 4 of 5 attempts at 20-way with 0/960 exhaustions. Revisit only if
      reconcile-era concurrency grows.
    - Trap: the race children import a COMPILED build passed as an argument, and beforeAll compiles
      src into a private scratch dir — never dist/, which three sibling tests in the same parallel
      project read or execute. A hand-run pointed at dist/ tests whatever was last built there.
  - N4 — canonical entry point (src/state/state-root.ts): openResolvedStateRoot resolves the state
    root BEFORE validating it, so the macOS /var -> /private/var spelling that integration actually
    hands the state layer is accepted instead of being refused with the opaque directory-integrity
    error; a non-normalized or relative override is rejected with its own dedicated static message.
    CARRY-OVER WORDING (do not write "unchanged"): at this entry a symlinked ANCESTOR converts from
    fail-closed to fail-open — it now resolves and proceeds, so identity.key can land wherever a
    same-uid ancestor redirect points. That is the real delta the Slice 2 unsafe-ancestor decision
    must weigh.
  - N5 — strict origin admission (src/state/target-identity.ts): trailing dot, empty label,
    underscore and port 0 are rejected; IP literals are exempt from the label rules. new URL()
    punycodes IDNs before the checks, so unicode hosts still pass. A trailing dot after an IPv4 is
    folded into the address by WHATWG parsing and stays accepted (same identity) — the dispatch
    premise that it would be rejected was wrong. PRODUCT NOTE: underscored internal hostnames
    (a_b.example) are now rejected with only the opaque static error.
  - Dead-module removal: src/capabilities/envelope/backup.ts (the synthetic duplicate) and its test
    are deleted — zero importers in src/ and scripts/, and the live config-backup.ts test file was
    verified assertion-by-assertion to be a strict superset of the deleted one. The live
    config-backup.ts feature is byte-untouched (path-scoped diff empty), per the user's constraint.
  - CI gate: `npm run evidence:check` now runs in its OWN independent evidence-freshness job in
    ci.yml (no needs:, and nothing needs it) and inline in release.yml before publishing; both are
    pinned by whole-line, comment-proof regexes in tests/foundation/documentation.test.ts. Rationale:
    hanging the gate off `verify` would fail verify on every packed-content change and therefore SKIP
    the `protocol` job, costing both conformance profiles for the whole window until the reseal.
    Isolated, a stale seal reddens one job and every other signal survives.
  - 0.1.1 bump: 13 files, 19 insertions / 19 deletions. The task brief listed 8 version sites; grep
    plus control experiments found five more. The sealed fixture was NOT touched.
  - Expected-RED state on this branch, by structural necessity: `npm run verify` fails EXACTLY ONE
    assertion — tests/integration/installed-package.test.ts:234, sealed fixture package.version
    0.1.0 vs package.json 0.1.1 (measured 2026-08-18: Test Files 1 failed | 60 passed (61), Tests
    1 failed | 1209 passed (1210)). evidence:check (exit 1) and evidence:verify (exit 2) are stale by
    design too. Only the landing sequence's real smoke:opencode and vm:product3 restore all three;
    hand-editing either evidence document would fabricate evidence and is forbidden.
  - Gate results for the docs commit (Node v22.23.1):
    - `npm run license:check`: exit 0
    - `npm run test:conformance`: exit 0 (13/13, both profiles)
    - `git diff --check`: exit 0
    - `npm run verify`: exit 1 on the single assertion above, everything else green
  - Truth fixes shipped with this entry: vitest.config.ts and installed-package.test.ts no longer
    call the sealed-digest equality a release-only concern; CONTRIBUTING.md and docs/project-status.md
    no longer claim CI skips evidence:check; the accurate digest blast radius is now stated the same
    way everywhere — the tarball digest moves with src/** (through dist/), README.md, LICENSE,
    package.json and the two tsconfigs, and NOT with scripts/**, docs/**, tests/**, .github/** or
    evals/**; a package-lock.json bump matters only when it moves the toolchain that produces dist/.
  - Slice 2 carry-overs (UPDATED — the two Slice 1 races are CLOSED and no longer carried):
    (a) Unsafe-ancestor validation: implement the ancestor walk or record an explicit scope ruling,
        weighing the fail-open delta recorded under N4 above.
    (b) R1-R9, the kernel/types refactors from the 2026-08-17 review:
        R1 move lock release out of `finally` and give it a LOCK_RELEASE_FAILED outcome;
        R2 have LockHandle.release report its result instead of swallowing it;
        R3 enforce the terminal audit through a single helper;
        R4 BackupService.create(BackupRequest) instead of positional arguments;
        R5 bounded acquire/exists/release that accept abort signals;
        R6 a durable backup root replacing the tmpdir store;
        R7 lazy mutation-service construction so win32 stays read-only;
        R8 an origin seam from the composed application;
        R9 extend the audit ALLOWED_KEYS.
    (c) Version-drift test: the version is hand-synced across 13 files with no drift assertion.
        Derive the literals from package.json or add the assertion.
    (d) config-backup.ts: its comment still references the module this slice deleted, and the
        repository's now-sole backup discipline has 3 unguarded legs (nlink=1, checksum mismatch,
        truncation) — roughly a 15-line test addition.
  - Landing check to perform, not to assume: the first green `main` run must be confirmed to have
    actually EXECUTED the evidence-freshness job, not reported green because an earlier step failed
    and the job never ran.

=== P0-C IDENTITY-KEY RETRY MARGIN (CI-observed flake) — COMPLETE, NOT YET LANDED ===
Branch: p0c/identity-key-retry-margin (2026-08-18), base fbecc85 from main, commits 980ccea and the
commit carrying this entry. Touches src/state/identity-key.ts, tests/state/identity-key.test.ts,
docs/project-status.md, this ledger. Not pushed.
  - Trigger: GitHub Actions run 32084653665 (release workflow, ubuntu-24.04, 2-4 vCPU,
    `npm run verify`) — tests/state/identity-key-race.test.ts test 1, ONE starter of twelve printed
    `fail Identity key failed its integrity checks`. Two other CI executions of the SAME commit
    passed, as had hundreds of local macOS runs (576-starter stress: 0 failures, deepest chain 4/5).
  - Method: reproduce, do not argue. A disposable 2-vCPU Ubuntu 24.04.4 / kernel 6.8 VM (colima,
    deleted afterwards) with TMPDIR on an ext4 docker volume — NOT overlayfs, NOT tmpfs — running the
    repository's own child harness. Pristine code fails 100 of 280 starters there (35.7 %).
  - VERDICT: transient-retry exhaustion, and nothing else. With the classifier instrumented, the
    PERSISTENT bucket was hit ZERO times in 280 Linux starters. There is no Linux-specific errno
    misclassification to fix: unlink/link/open of a just-removed entry return ENOENT on Linux exactly
    as on darwin, and the darwin/Linux differences in this area (unlink of a directory: EPERM vs
    EISDIR) are persistent on both platforms, so no classification moves.
  - THE MECHANISM IS NOT WHAT THE CODE'S COMMENTS CLAIMED, and the old comments have been rewritten.
    The nlink window (a winner caught between its link and its unlink) occurred ZERO times. The
    dominant transient is link->ENOENT, 897 occurrences: `cleanupCandidates` unlinks EVERY
    candidate-patterned entry including live peers' in-flight candidates, and `writeCandidate` makes
    its candidate's NAME visible before it fsyncs the contents. Measured in-container: open+write of
    32 bytes 0.011 ms, fsync 0.388 ms median (0.573 max) — the vulnerable window is ~35x the work it
    protects. On APFS that step is cheap, which is precisely why macOS cannot reproduce this class
    at all: 0 failures at 20-way even under 96 competing spinner processes. DO NOT accept a green
    macOS stress as evidence about identity-key concurrency; use a few-vCPU Linux box on a
    journalling filesystem.
  - Fix (src/state/identity-key.ts): MAX_ATTEMPTS 5 -> 10, plus a bounded jittered pause between
    attempts — 0, 5, 10, 20, 40 then 50 ms cap, each multiplied by 0.5 + f where f in [0,1) comes
    from a splitmix32 avalanche over (pid, attempt). Derived, never Math.random and never
    randomBytes: reproducible under test, and mixing the attempt as well as the pid stops two
    starters that collide on one rung from staying correlated on the next. Nine retries cost at most
    412 ms (155-391 ms swept over 200 000 pids). The first rung is 0 ms on purpose: ~30 % of the
    starters that take it succeed on the very next attempt, because a swept candidate usually means
    a peer has already published and the retry short-circuits on the existing key. Blocking uses
    Atomics.wait on a module-level SharedArrayBuffer nobody notifies — startup is synchronous, and a
    spin loop would burn the core the peer needs in order to finish publishing.
  - ABLATION, the reason the pause is in this commit and not just the bigger number: 10 attempts with
    the backoff DISABLED still failed 29 % and 8 % of starters across two 2-vCPU runs, with the depth
    histogram piled against the new ceiling. The desynchronising pause is the fix; the extra attempts
    are headroom. After both: 724 Linux starters, 0 failures, deepest chain 4 of 10.
  - Seam: `ensureIdentityKey(root, dependencies?)` takes an injectable `wait`, in the style of
    runCommandLine's dependencies parameter, so the schedule is pinned by a unit test with no real
    sleeping and no fake timers. The pure `identityKeyRetryDelayMs(attempt, pid)` is exported for the
    same test. NEITHER is re-exported from src/state/index.ts — the package's public surface is
    unchanged and `ensureIdentityKey(root)` still works.
  - Review follow-ups folded in (second commit): the injected wait is called inside a try/catch that
    converts anything it throws into the static sentence — proven RED first, since a throwing wait
    previously leaked `clock unavailable at /private/var/folders/...` straight to the caller; the
    default wait refuses non-finite and non-positive values (Atomics.wait reads Infinity as "no
    timeout"); the budget assertion tightened from < 500 to < 425 against the schedule's own 412 ms
    worst case; two swapped it.each title placeholders fixed.
  - Gate results (Node v22.23.1):
    - `npx vitest run tests/state/`: 4 files / 76 tests, green (run 3x on the first commit's tree),
      then 77 tests green on the second
    - `npm run verify`: exit 0 (61 files / 1227 tests on the first commit, 1228 on the second)
    - `npm run test:conformance`: exit 0 (2025-11-25 and 2026-07-28 profiles)
    - `npm run license:check`: exit 0 — `git diff --check`: exit 0
    - eslint / prettier / tsc on the touched files: clean
  - CARRY-OVER (real fix, deliberately not bundled into a robustness patch): stop sweeping LIVE
    peers' candidates. `cleanupCandidates` currently deletes any candidate-patterned entry on every
    attempt, which is what creates the race the backoff now out-waits. Sweep once per process start
    (crash residue cannot appear mid-run) or age-gate the sweep to candidates older than a second or
    two; either removes the race class instead of tolerating it, and would leave the retry budget
    nearly unused. Related: `writeCandidate` could fsync before the name is linkable at all.
  - Trap for a future session: if that race test flakes again, instrument RETRY DEPTH, not the
    classifier. The classifier was correct on both platforms the whole time; the budget was not.

=== P0-C SLICE 2A (envelope prep refactors) — COMPLETE, NOT YET LANDED ===
Branch: p0c/slice2a-envelope-prep (2026-08-18), base 98c33f5 from main, commits 98c33f5..92c275b
plus the two commits carrying this entry. Plan:
docs/superpowers/plans/2026-08-18-p0c-slice2a-envelope-prep-refactors.md (8 tasks, one commit each;
implementers and task reviewers on opus effort max, per the user mandate). Goal: reshape the
mutation-envelope interfaces and the composition root so Slice 2b can drop in durable
backup/audit/lock as pure service swaps — R1-R5, R7, R8 from the 2026-08-17 review plus four
carry-overs — with ZERO observable behaviour change on every reachable path EXCEPT two deliberate,
plan-ordered, test-pinned carve-outs, both strictly fail-safe and both stated here so the headline
stops overclaiming: (1) R5 — a lock or backup service that never answers now refuses
LOCK_UNAVAILABLE/BACKUP_FAILED at the capability's timeout, where the dispatch used to hang forever
(tests/capabilities/mutation-envelope.test.ts:375, :389, :409); (2) R7 — a mutation-service
construction failure now yields a read-only server, where startup used to crash
(tests/app/default-application.test.ts:559, which stubs TMPDIR to an absent path and so disproves the
plan's "cannot fail on darwin/linux" premise). Every other refusal code, result shape and event order
is unchanged, which is what the canary below pins.
  - CANARY, the slice's most load-bearing assertion, re-run by every task: the envelope's step-order
    event list must not change. IT DID NOT. In the "runs the fixed order and returns the verified
    output on success" test of tests/capabilities/mutation-envelope.test.ts, the asserted EVENT ARRAY
    is byte-identical between 98c33f5 and the final tree, and still reads, in order: lock.acquire,
    preflight, audit.intent, backup.create, preflight, handler, verify, audit.result, lock.release.
    Reproduce it with the command, not with the digest alone — a digest without its extraction is
    unverifiable, and a narrower extraction of "the same" array yields a different one:
      sed -n '/runs the fixed/,/]);/p' tests/capabilities/mutation-envelope.test.ts | md5
    gives 7e6d085af5111f34ceace93ef780e473 on both trees; that range covers the it() header through
    the first `]);`, i.e. the event array plus the four lines above it. Claim exactly that, and
    nothing wider: the
    surrounding it() block is NOT byte-identical, because Task 3 added 13 lines of BackupRequest
    assertions inside it, so a whole-block diff is 13 additions and no deletions. No refusal code,
    result shape or event order moved anywhere this slice.
  - R2 + R1 (56d0362, 71c8f72): LockHandle.release() now returns Promise<'released' | 'unconfirmed'>
    and the in-process handle always reports 'released' (a process-local token cannot fail to drop).
    executeMutationEnvelope's try/finally became a labeled block — every former `return X` is
    `result = X; break envelope;` — so ONE sequential release runs after the terminal audit, its
    report captured into a deliberately unused local (Slice 3 turns 'unconfirmed'-after-verified-
    success into LOCK_RELEASE_FAILED). Review round 1 restored the exception safety net the
    restructure had deleted: a catch/release/rethrow guard, RED-reproduced with a throwing getter,
    because one leak of the process-wide lock is a restart-only write outage. Slice 3 must know there
    are now TWO release sites and that the catch deliberately never converts to LOCK_RELEASE_FAILED.
  - R3 (a50b9e7): one `finishWith(outcome, backupId?)` helper carries EVERY terminal audit site, so a
    new branch cannot skip the result record. The count moved inside this slice and any future
    statement of it must be recounted, not copied: 9 sites at a50b9e7 and 0a6288b, then 11 from
    9f171c2 onward (R5's bounding added the create- and exists-runner non-value BACKUP_FAILED
    refusals), 11 at the final tree — kernel.ts:1741, 1756, 1761, 1766, 1782, 1792, 1797, 1807, 1817,
    1822, 1825. The preflight and intent exits legitimately bypass the helper: they never reach step
    8. `terminalAuditRecorded` is captured and discarded exactly where Slice 3's AUDIT_RESULT_FAILED
    precedence will read it.
  - R4 (0a6288b): BackupService.create(BackupRequest, signal) — targetKey, capabilityId, mcpName,
    argumentsSha256, effectiveResourceScopes, observedStateDigest, effectPlanDigest, all
    kernel-supplied and already canonicalized — replaces the positional scope string. The request is
    built OUTSIDE the try on purpose: reading the sealed digests is not a backup failure.
  - R5 (9f171c2): no unbounded service call is left. acquire, create, exists and both release sites
    run under runBounded with the capability's timeout, and create/exists each take their OWN
    runner's signal (sharing one silently hands the second call the first's leftover budget).
    Release is bounded with an undefined caller signal on purpose — an already-aborted signal would
    skip the thunk and leak the process-wide lock — and that choice is pinned.
  - R7 + R8 (850635b, 3603290): mutation services are built by one EAGER, GUARDED fail-closed helper
    — not a lazy one, whatever R7's review title said: buildMutationServices runs at startup inside
    createDefaultApplicationRuntime, so the degrade fires there and not at the first write; if
    construction throws, the runtime serves a READ-ONLY catalogue instead of failing to start. The
    composition root now holds the parsed connection config and hands the builder the real origin
    (parsed.url), returned and ignored this slice. Discovery: `services: undefined` alone crashes
    dispatch because the catalogue still holds the envelope capability; the guard at kernel:1870 is
    UNTESTED and catalog.test.ts:386-391 is the real coverage.
  - Sweep-once (53994c6, 33545b6): cleanupCandidates is hoisted out of the retry loop into
    sweepCandidatesOnce(), called once per ensureIdentityKey call before attempt 1, so a retry can no
    longer remove a live peer's in-flight candidate. The wrapper exists because the sweep left the
    one place that enforced the module's static-error contract: with the guard deleted, a readdirSync
    EACCES reached the caller WITH the private state-root path in it (RED-proven by a 0o300 root
    test). Retry/backoff machinery byte-untouched. The trade is named in the module: a peer that dies
    between its own link and its own unlink WHILE we are retrying leaves residue this call will not
    sweep, holding nlink at 2 until the budget runs out, where the old per-attempt sweep recovered it
    on attempt 2 — accepted because that residue is indistinguishable by name from the live candidate
    we must not touch, needs a microsecond crash window inside our ~400 ms retry window, and the next
    start sweeps it.
  - Sweep-once stress (darwin, scratch harness only, 3 interleaved repetitions per side to cancel
    machine drift, 20 starters x 20 rounds = 400 starters each). Retry-depth histograms:
      barrier,   before: 1:245/2:145/3:10 | 1:273/2:115/3:12 | 1:272/2:125/3:3
      barrier,   after:  1:298/2:93/3:9   | 1:265/2:123/3:12 | 1:295/2:95/3:10
      staggered, before: 1:235/2:102/3:53/4:10 | 1:234/2:105/3:52/4:9 | 1:227/2:111/3:52/4:10
      staggered, after:  1:332/2:44/3:16/4:8 | 1:320/2:48/3:25/4:7 | 1:323/2:41/3:29/4:6/5:1
    Swept-candidate transients (link->ENOENT, the class this change targets): staggered 220 -> 97
    (-56 %), retried 42 % -> 19 %; barrier 111 -> 99, inside the noise band. 0 failures, 0 key
    disagreements, 0 residue on both sides in every run.
  - DARWIN CAVEAT, mandatory alongside those numbers: macOS numbers CHARACTERIZE THE MECHANISM, they
    are NOT fix verification. darwin/APFS cannot reproduce this failure class at all (0 failures with
    and without the change), exactly as the retry-margin entry above warns. The load-bearing evidence
    is the 2-vCPU Linux/ext4 procedure re-run against the sweep-once tree — a candidate for the
    Slice 2b exit gate. The retry budget was deliberately NOT shrunk before that evidence exists.
    Also: the plan's "deepest <= 2" expectation was WRONG, and the anomaly was reported rather than
    tuned away — sweep-once bounds each PEER to one sweep, not each starter to one loss, so depth is
    bounded by peer count (19 independent startup sweeps at 20-way), and the barrier configuration
    cannot show the effect at all because every peer is inside its first attempt there anyway.
  - Task 7 (92c275b): version-drift test (tests/foundation/version-drift.test.ts — 6 files,
    7 literals, derived from package.json; server-status.ts additionally gets an occurrence count,
    since one `includes` cannot see one of its two literals drift), the backup-discipline legs, and
    the two stale comments (config-backup.ts's reference to the module Slice 1.1 deleted;
    state-root.ts's falsified "widens the accepted spelling, not the accepted directory").
  - Task 7 DISCOVERY, which reshaped the 2b list: the plan's premise for backup legs (b)/(c) was
    FALSE. The nlink/mode/truncation guards live in readRegularPrivateFile, reached ONLY from
    create's write-path re-read, and create computes its sha256 and DISCARDS it — nothing persists
    the digest or the length. exists() therefore proves presence and privacy only (id pattern,
    O_RDONLY|O_NOFOLLOW open, fstat, nlink === 1) and never reads a byte, while kernel.ts:1751 treats
    exists === true as "backup verified" (L1760-1764 turn a false into the BACKUP_FAILED refusal).
    No implementation of exists ALONE can close this. Per the brief's own fallback the module was not
    patched (path-scoped diff empty after every mutation experiment); legs (b)/(c) landed INVERTED as
    red-if-fixed pins of current behaviour (the idiom of 3603290), leg (a) is a true pin (mutation M1
    reddens it alone; M3 — a stand-in content guard — reddens exactly the two pins).
  - Gate results on the final tree (Node v22.23.1, PATH=/opt/homebrew/opt/node@22/bin:$PATH):
    - `npm run license:check`: exit 0
    - `npm run verify`: exit 0 — 62 test files / 1244 tests passed, format/lint/typecheck/license/
      build all green. No expected-RED this slice: nothing here touches the sealed fixture's version
      claim, which already records 0.1.1.
    - `npm run test:conformance`: exit 0 on both pinned profiles (2025-11-25 and 2026-07-28),
      0 failed and 0 warnings in every scenario.
    - `git diff --check`: exit 0
    - evidence:check / evidence:verify are stale ON PURPOSE on this branch (the slice changed src/**,
      which moves the tarball digest, and non-evidence commits follow the attestation). They were NOT
      run and NOT resealed; only the real smoke:opencode and vm:product3 producers clear them, in the
      landing sequence.
  - Slice 2b/3 carry-overs (the full list, with reasons, is docs/project-status.md "Immediate
    next-session objective / Task 3"):
    (a) Unsafe-ancestor validation: still undecided, wording unchanged. It is now stated at the code
        site too (state-root.ts cites the docs heading by name — do not rename that heading).
    (b) R6 durable backup root + the durable backup/audit/lock implementations behind the reshaped
        interfaces.
    (c) NEW 2b PREREQUISITE, belongs with R6: persist the create-time digest and make exists() (or a
        verify) check content; also close the mode gap, since exists() skips the 0600 check and a
        post-write chmod is invisible. Two red-if-fixed pins in config-backup.test.ts flip when it
        lands.
    (d) R9 audit ALLOWED_KEYS extension, deferred to 2b with its durable consumer (widening the
        allow-list without one adds dead surface; BackupRequest is the prepared extension point).
    (e) transactionId is missing from BOTH BackupRequest and AuditRecord — the one spec field a
        service cannot synthesize. Symmetric 2b addition.
    (f) Separate target-reachability from write-availability in the catalogue: catalog.ts (exposes
        writes) and opnsense/list.ts (reads) both key off the single aliasAdapter.available flag, so
        the R7 degrade kills alias READS. openResolvedStateRoot throws unconditionally on win32, so
        in 2b that degrade IS the win32 path — shipping it unsplit is a win32 read regression against
        R7's own goal. Red-if-fixed pin in the default-application degrade test.
    (g) The origin seam carries parsed.url VERBATIM; 2b must canonicalize before deriving a target id.
    (h) Make catalog.listAll REQUIRED: its optionality weakens two guards that fall back to an empty
        list — the holdings evidence at kernel:1989 and the sealUnavailableCapabilities dedup.
    (i) Lock contract: an acquire aborted after the manager granted the handle leaks it (the runner
        discards the value) — use runOperation's retain-hook precedent; release() needs a signal to
        be truly bounded; 2b's service contracts must REQUIRE signal honouring, because runBounded
        bounds the WAIT, not the operation.
    (j) Sweep-once verification on 2-vCPU Linux (see the darwin caveat) and, unimplemented, the
        inode-scoped retry sweep: a retry-time sweep restricted to candidates sharing the published
        key's inode would recover peer-crash-mid-publication residue without touching a live
        candidate, which holds a distinct inode until the instant it links. Still open from the
        retry-margin entry: writeCandidate could fsync before the name is linkable at all.
    (k) Drift-test scope: 6 files / 7 literals; the 0.1.1 bump touched 13 sites and the rest are
        sealed-evidence and client-identity pins, excluded on purpose. The assertion is SUBSTRING
        containment (brief-mandated), so a site reading 0.1.11 would satisfy version 0.1.1.
    (l) SLICE 3: AUDIT_RESULT_FAILED / LOCK_RELEASE_FAILED semantics (both hooks already sit as
        discarded locals at the points Slice 3 will read them); hoist finishWith('success') out of
        the parse try, or a throwing success-audit re-enters finishWith('INVALID_OUTPUT') = double
        record under the wrong code; terminalAuditRecorded=false conflates "audit failed" with "never
        reached step 8" (gate on verified success); kernel:1870 untested; EXECUTION_FAILED is
        indistinguishable from an upstream 403 (UX backlog) — a candidate for the Slice 3 refusal
        vocabulary; a caller abort is masked at every step EXCEPT step 2 — a step-2 preflight abort
        whose cause is the caller maps to refusal('CANCELLED') at kernel:1700-1707 (runtime-proven in
        the T8 re-review), and the entry check at kernel:1674 refuses an already-aborted call the same
        way, while elsewhere the abort surfaces as the step's own code (LOCK_UNAVAILABLE step 1
        :1683, deliberate per its own comment; BACKUP_FAILED step 4 :1741/:1756;
        STATE_REVALIDATION_FAILED step 5 :1782; OUTCOME_INDETERMINATE step 6 :1792, deliberate since a
        write may have landed; OUTCOME_UNVERIFIED step 7 :1807), so Slice 3 decides which of those
        should surface as CANCELLED and the answer is not "all of them". DO NOT write "there is no
        cancellation vocabulary": 'CANCELLED' IS in the RefusalCode union (types.ts:128) with messages
        at kernel:136 and mcp/results.ts:12. That false wording reached this entry by transcription
        from the workspace ledger's Task 4 note, which is now corrected at its source.
        And R3's single-helper invariant is pinned by a ONE-SHOT grep rather than a test —
        Slice 3 must encode "every terminal path leaves through finishWith" as an execution-boundary
        source-text test, or it decays (the 9-versus-11 drift under R3 above is what that decay looks
        like).
  - Minor deferrals recorded by the task reviews and NOT fixed here: envelope paths 9/10
    (INVALID_OUTPUT) have no test at all (pre-existing); a throwing envelope rejects dispatch()
    instead of fail-closing to a refusal (deliberate, Slice 4 question); the terminal-audit pin is
    one-directional (stimulus deletion undetected); the step-4 comment overstates its equivalence
    with step 5; the value-false sentinel at the exists short-circuit is unexplained in code; the R7
    degrade is silent (no logging seam — graduates to needed in 2b) and leaks a temp root on double
    failure; two identity-key comment looseness items; the 0o300 and 0o500 sweep tests fail-not-
    false-pass under uid 0.
  - DISTRIBUTION, recorded here because the tree cannot prove it (controller-attested 2026-08-18,
    outside this slice's diff): 0.1.1 IS PUBLISHED to npm. A GitHub Release v0.1.1 triggered
    release.yml, which published over OIDC with no stored credential after the user approved the
    npm-publish environment; the registry state was verified the same day with
    `npx -y @gabrielion/opnsense-mcp@0.1.1 --version` -> 0.1.1, run OUTSIDE the repository (inside
    it, npx resolves the local package by name and never queries the registry — the self-name trap).
    The release tag lives on GitHub; a local clone has only v0.1.0, so absence of a v0.1.1 tag is NOT
    evidence of an unpublished version. docs/project-status.md asserted publication as an open task
    in three places until this entry; all three are corrected.
  - Landing sequence for this branch (controller): merge ff -> real smoke:opencode (src/** changed)
    -> full gates green -> candidate fixture commit -> vm:product3 -> attestation commit ->
    evidence:verify 0 + evidence:check 0 -> push -> confirm all four CI jobs executed. No release
    this slice (0.1.1 is already out; see DISTRIBUTION above).
