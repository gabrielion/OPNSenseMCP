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

Ledger publication note (2026-07-25): `.superpowers/sdd/progress.md` is tracked and public in this
  repository (it already was at 786f092) even though `.gitignore` lists `.superpowers/sdd/`, so
  `git add` needs `-f`. Leaving it stale would publish a false status, so it is kept current.
  Whether it should remain public is an open P0-B sanitation decision for the owner.
