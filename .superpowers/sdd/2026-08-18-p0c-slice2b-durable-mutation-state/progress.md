# SDD ledger — plan: docs/superpowers/plans/2026-08-18-p0c-slice2b-durable-mutation-state.md

Branch: `p0c/slice2b-durable-state` off main `1d4f049`. Plan committed first thing: `e8ce167`
(includes the five user adjudications of 2026-08-18 — ancestor walk IMPLEMENT; restore via
scenario-scoped QMP reset + single-user console + live probe; sibling restore producer with new
evidence file `docs/evidence/product3-restore-vm.json`; retention inside `backup.create`;
sweep-once Linux verification = separate errand, NOT a 2b gate).

Task 0: complete — branch created, `npm ci --ignore-scripts` + `npm run verify` green
(62 files / 1244 tests) on Node v22.23.1. Plan commit amended to `959de45` (includes the two
controller pre-flight fixes below).

Pre-flight scan: two plan defects found and fixed BEFORE Task 1, both in the committed plan:
(1) the drift-test scope note (project-status.md:623-626, informational brief item) was unmapped —
added to Task 13's doc bullets; (2) Task 12's implement step widened the GLOBAL
`VM_ATTESTATION_CHECK_KEYS`, which contradicts the user ruling (sibling evidence file, existing
sealed 12-check evidence untouched): `recordWithExactKeys` (attestation.mjs:145) is an exact-key
check and the verifier round-trips the sealed evidence through `buildVmAttestation`, so widening
invalidates it. Rewrote Task 12: second frozen key set `VM_RESTORE_ATTESTATION_CHECK_KEYS`,
internal `buildAttestationWithCheckKeys(input, checkKeys)` extraction with byte-identical existing
exports, new `buildVmRestoreAttestation`/`serializeVmRestoreAttestation`, and the verifier checks
BOTH evidence files with the changed-path rule widened to a subset of the two evidence paths.
Verified during scan: `runInstalledAliasLifecycle`/`inspectGitWorktree`/`writeVmAttestationAtomic`
ARE exported from product3-alias.mjs (Task 11's reuse needs no producer change); all sampled plan
line anchors exact; spec retention wording confirmed at design-spec :311-315.

Canary (re-run every task): `tests/capabilities/mutation-envelope.test.ts` "runs the fixed order
and returns the verified output on success" — event list `lock.acquire, preflight, audit.intent,
backup.create, preflight, handler, verify, audit.result, lock.release`, byte-identical:
`sed -n '/runs the fixed/,/]);/p' tests/capabilities/mutation-envelope.test.ts | md5` =
`7e6d085af5111f34ceace93ef780e473` (baseline on main).

Model policy (user mandate): implementers AND task reviewers on opus, effort max.
REVISED by the user 2026-08-19 (quota running out faster than expected): implementers on SONNET
from now on. Task reviewers stay on opus (the revision names implementations only; the quality
net matters more with smaller implementers); scoped re-reviews of small fix diffs on sonnet;
final whole-branch review stays on the most capable model (fable). Fix rounds 1-3 still RESUME
the original implementer whatever its model. The Task 10 implementer was already in flight on
opus when the revision arrived — left to finish (kill+re-dispatch costs more than completion);
sonnet applies from the next fresh dispatch (Tasks 11-13).
DEVIATION 2026-08-18 (~18:40-19:30): the opus pool returned 529 Overloaded on five consecutive
dispatch/resume attempts over ~45 min (Task 1 implementer; one attempt ran 18 tool-uses of pure
reading before being cut — worktree verified clean after). Fallback: dispatch on FABLE (capability
tier ABOVE opus, so the mandate's floor — never below opus for code — is kept in spirit). Re-probe
opus on each subsequent task dispatch; return to opus as soon as it answers. RESOLVED: the Task 1
reviewer dispatch went through on opus (~20:00) — mandate resumed from there; only the Task 1
implementer (agent ad5c3f5b0800131db) is fable.

Task 1 (transactionId + ALLOWED_KEYS): implementer commit `62e8da6` (fable, DONE_WITH_CONCERNS —
concern = the documented sealed-evidence on-branch staleness, correctly NOT resealed). Review
(opus): SPEC ✅ all values verified independently, canary md5 identical at 959de45 and 62e8da6,
verdict APPROVED with 2 findings. Fix round 1 (resumed implementer): Important — the new test
can't distinguish per-run from per-process transactionId; second dispatch + inequality required.
Task 1: minor (deferred): audit.ts:51 boundedness of the transactionId guard unpinned — a bare
typeof check would pass every test; only ALLOWED_KEYS presence + copy are pinned (final review
triages).
Task 1: fix round 1 closed — commit `0934a21` (test-only, two-dispatch freshness test proven RED
under a simulated module-scope hoist), scoped re-review verdict FINDING CLOSED (canary md5 intact
at 0934a21, 19/19 file, no scope creep, no new findings).
Task 1: minor (deferred): freshness is pinned across DISPATCHERS (the test helper builds one per
call), not across runs of one long-lived dispatcher; a dispatcher-scope hoist would evade it while
production (default-application.ts:108) builds a single dispatcher. Closing needs shared test-infra
rework — final review triages.
Task 1: complete (commits 62e8da6 + 0934a21).

Task 2 (catalog.listAll required): implementer commit `a0f099b` (opus, DONE; +7/-6, exactly ONE
structural view double existed — policy-kernel.test.ts:689 — verified exhaustively, no casts).
Review (opus): SPEC ✅, APPROVED, no Critical/Important. Canary intact. Review found coverage
stronger than reported: catalog.test.ts:386 was already a BEHAVIOURAL pin on the deleted fallback
(feature-flags-off catalogue throws solely via holdsEnvelopeCapability).
Task 2: minor (deferred): kernel.ts:296-297 doc comment says listAll "Used ONLY by the
construction-time envelope-services guard" but sealUnavailableCapabilities:1220 is a second caller
— one-line correction when the region is next touched (Task 3 does NOT touch kernel.ts).
Task 2: minor (deferred): kernel.ts:1988-1997 exposedEnvelopeCapability loop is dead work now the
fallback is gone (listExposed ⊆ listAll for every real catalogue) — keep as defence-in-depth or
drop; deliberate-keep note.
Task 2: complete (commit a0f099b).

Task 3 (catalogue reachability/write split): implementer commit `b20a938` (opus, DONE_WITH_CONCERNS;
4 files +73/-20). Review (opus): SPEC ✅, APPROVED. Degrade pin flipped to success; two-arg
source-text pins intact; third param default proven behavior-preserving for every caller; fixture
widening (searchItem branch on the degrade target) judged faithful AND required for falsifiability.
Task 3: minor (deferred): degrade fixture fallback answers every unmatched path 200 system-status
(write test uses 404 {}) — unexpected requests undetectable; pre-existing shape.
Task 3: minor (deferred): catalog.ts:89 nothing forbids exposeAliasWrites:true with an unavailable
adapter (writes would catalogue then fail at execution) — latent internal footgun, no caller does it.
Task 3: SLICE-3 CARRY (for Task 13 docs): with writes sealed but target reachable, opn_create
refuses TARGET_UNAVAILABLE (kernel.ts:1334 hard-coded) — misleading (target IS available; the local
envelope is not). Refusal vocabulary is Slice-3 territory; add to the Slice-3 exclusion list with
this rationale. This is what a win32 operator will see.
Task 3: complete (commit b20a938).

Task 4 (durable content-verified backup): implementer commit `7615572` (opus, DONE; rewrite of
config-backup.ts + test, +372/-71; falsifiability proven via 4 mutation probes post-GREEN because
the RED legs failed on path shape once the layout changed). Review (opus): SPEC ✅ — single-open
exists() deviation ACCEPTED as strictly stronger than the brief's reopen wording; reviewer ran 9
probes + a 30-case fault battery (all false, zero escaping throws). Fix round 1 in flight for two
Importants: (1) post-rename fsync failure orphans the published <backupId>/ dir (reproduced, store
mode 0300); (2) three added disciplines unpinned (assertPrivateDirectory, backupId binding,
read-side extra-key rejection — each deletable with 9/9 green).
Task 4: minor (deferred): create() hard-refuses empty/>512-char preflight digests that kernel only
type-checks as string — unreachable today, new coupling handler-shape→backup availability.
Task 4: minor (deferred): exists() hashes up to 2 MiB synchronously — runBounded can't interrupt a
sync block; acceptable at bound, flagged by implementer.
Task 4: minor (deferred): exists() ignores an aborted signal on a valid backup (returns true) —
pre-existing; kernel's runBounded owns cancellation.
Task 4: reviewer caveat for Task 8: O_NOFOLLOW guards only the final path component — a symlinked
STORE ROOT is still followed today; the store-root privacy check is deliberately Task 8's
ensurePrivateDirectory + Task 10's ancestor walk.
Task 4: fix round 1 closed — commit `cb49978` (+84/-3; rename hands undo role stagingDir→
publishedDir, orphan repro now leaves []; 4 new test legs each falsifiable one-to-one). Re-review:
FINDINGS CLOSED, no new Critical/Important. New minor (deferred): the durability leg infers
post-rename failure from a write-only (0300) store → misreports if run as root; same
root-sensitivity class as the existing owner/mode legs.
Task 4: complete (commits 7615572 + cb49978).

Task 5 (durable audit sink): implementer commit `69e28f8` (opus, DONE_WITH_CONCERNS; new
durable-audit.ts + 11-leg test + toValidatedAuditRecord extraction from audit.ts). Review (opus):
SPEC ✅, all 4 deviations ACCEPTED (0600 segment check; monthly dir fsync; validator export — pure
logic, npm surface unchanged; vi.mock over production seam), APPROVED, 5 probes incl. reviewer's
own O_TRUNC probe (4 legs fail → append-only genuinely pinned).
Task 5: minor (deferred): auditDir itself never validated (pre-existing 0755 accepted forever;
mkdirSync recursive is a no-op on existing) — Task 8's wiring must validate it (assertPrivate-
Directory precedent in config-backup.ts:132).
Task 5: minor (deferred): symlinked auditDir → only the FIRST record of a month throws (after the
line was written+synced); later records silent — inconsistent detection; ancestor walk (T10) and
dir validation (T8) are the real fixes.
Task 5: TASK-8 CARRY (must not inherit blind): effectiveResourceScopes is unbounded in the shared
validator while the durable sink refuses lines >4096 bytes — a long-scope capability would refuse
EVERY mutation once wired (fail-closed loud, not silent). Decide at Task 8/final review whether to
bound upstream (would change the ring's accepted shape — plan says ring stays behavior-preserved).
Task 5: minor (deferred): no test pins that an embedded newline in outcome/scope can't forge a
second JSONL line (reviewer probed it safe — JSON.stringify escapes — but unpinned).
Task 5: complete (commit 69e28f8).

Task 6 (kernel-backed inter-process lock): implementer commit `73810eb` (opus, DONE_WITH_CONCERNS;
kernel-lock.ts + lock-waiter.mjs + 6-leg test, all legs on the REAL /usr/bin/lockf, cross-process
serialization proven with two real Node processes). Review (opus): SPEC ✅, APPROVED; -t 4-inside-
5s refinement UPHELD (measured: contended lockf -t 5 returns at 5011ms, 11ms past a 5000ms
watchdog — do NOT "fix" back to -t 5); Linux flock argv corrected to `-x -w 4 /dev/fd/3` (brief's
literal synopsis took no command). Mechanism note worth keeping: lockf FORKS and closes the lock
descriptor before exec — only lockf holds it; waiter's fd 3 is a kqueue; killing lockf frees the
lock while the waiter reparents to pid 1 and release() reaps it via pipe EOF. Fix round 1 in
flight for two Importants: argv/env secrecy untested; trust validation not injectable/testable.
Task 6: TASK-8 HARD REQUIREMENT (ship-gap, reviewer-CONFIRMED): tsconfig.build.json includes only
src/**/*.ts → lock-waiter.mjs absent from dist AND npm pack (0 matches in 215 files); compiled
module fails CLOSED (null in 0ms) → installed package would refuse EVERY mutation while in-repo
tests pass. Task 8 must make the build ship src/**/*.mjs + add an installed-package assertion.
Task 6: TASK-7 CARRY + docs: no mid-hold liveness channel — helper death mid-envelope silently
drops the kernel lock while the envelope keeps mutating (reviewer reproduced: B acquires 42ms
after A's helper dies). LockHandle has no channel for it; Task 7 must RECORD it (docs/ledger), not
implement it.
Task 6: LINUX NOTE: flock branch unverified on this host (no /usr/bin/flock on darwin); the
landing push's ubuntu CI will be its first real execution — watch that job; /dev/fd/N re-opens on
Linux (vs dup on darwin), inverting the descriptor-ownership nuance behind leg (c).
Task 6: minor (deferred): 5s timer arms after two stats+open+spawn → bounds silence-after-spawn,
not acquire (measured 5004ms); comment says "hard bound on acquisition".
Task 6: minor (deferred): abandon() doesn't await exit — immediate retry can be refused by a
helper milliseconds from death.
Task 6: minor (deferred): exitOf leaves the losing once-listener; timed-out release leaves two
listeners on the child forever (bounded).
Task 6: fix round 1 closed — commit `c361006` (12 legs, secrecy leg with triple-planted canary
token, trust seams injectable with defaults unchanged + unsupported-platform gate FIRST so the
seam is not a bypass; 7 implementer probes + 6 reviewer mutations all one-to-one). Re-review:
FINDINGS CLOSED, no new Critical/Important. Platform facts verified end-to-end: SIP-copied binary
exec → SIGKILL (wrapper control proven against real lockf on the same lock file); writeFileSync
mode umask-masked → chmodSync required to plant permission bits (any permission test planting bits
via writeFileSync is silently testing nothing).
Task 6: TASK-8 NOTE: KernelLockDependencies is exported → helperPath/waiterPath are public API;
never wire them to configuration (doc comment says "seams for the trust checks, not an escape from
them"); Task 8 passes NOTHING so defaults apply.
Task 6: complete (commits 73810eb + c361006).

Task 7 (lock contract — release(signal) + retain-hook): implementer commit `6015655` (opus, DONE;
7 files +213/-34; runBounded gained optional 4th param retain read only on aborted branch; kernel-
lock abort short-circuits to 'unconfirmed' WITHOUT SIGKILL but pipe.destroy() precedes the signal
check — polarity verified by reviewer probe, lock freed in 80ms; no-liveness limitation recorded
in LockHandle contract text; extra deaf-waiter leg = only coverage of the kernel handle's signal).
Review (opus): SPEC ✅, all 4 adjudications favorable (double-release structurally impossible,
proven — retain fired exactly once across 153 tests), APPROVED. Canary byte-identical at c361006,
6015655 and work tree.
Task 7: minor (deferred): the pipe.destroy()-before-abort-check ordering is declared load-bearing
by its own comment but unpinned — swapping the lines keeps 13/13 green; reviewer's Probe C is a
ready-made pin (acquire real lock, release with pre-aborted signal → 'unconfirmed', second manager
reacquires <100ms; RED if check hoisted). Final review triages.
Task 7: SLICE-3 NOTE: aborted release reports 'unconfirmed' even if helper exited — conservative,
unreachable today (kernel hands a fresh unfired signal, 0 hits instrumented); matters when Slice 3
gives 'unconfirmed' teeth.
Task 7: complete (commit 6015655).

Task 8 (durable-root wiring): implementer commit `9e725ed` (opus, DONE_WITH_CONCERNS; 9 files
+269/-60). Review (opus): SPEC ✅ end-to-end (R8 seam closed with canonicalizeOrigin; ship-gap
closed two-directionally — dist waiter byte-identical, npm pack 1 entry, without-waiter =
fail-closed 0ms; 0755 backups/ or audit/ → writes sealed 6→4 tools; dispose removed outright —
CORRECT, MutationLockManager has no closer; env narrowed to {XDG_STATE_HOME}). All 4 adjudications
favorable: homedir guard (HOME='' → relative default → state under CWD) = faithful hardening,
placement right, T10's walk would NOT subsume it; default-HTTPS-port pin = uniquely load-bearing;
state-dir stub census complete for vitest (real ~/Library never created); read-only-creates-state
= plan-faithful, Task 13 docs note. Fix round 1 in flight for two Importants: homedir guard
unpinned (removable, 0 failures — leak reproduced under CWD) and the two ensurePrivateDirectory
calls unpinned (removable, 0 failures — 0755 silently adopted).
Task 8: minor (deferred) + LANDING NOTE: scripts/run-opencode-smoke.mjs and the VM lifecycle
environments spawn configured servers with no OPNSENSE_MCP_STATE_DIR and no HOME → the landing
reseal/VM runs will write real durable state into the workstation's ~/Library/Application Support/
opnsense-mcp. Either stub a scratch state dir before the reseal or clean up after; decide at
landing (final review may also demand the stub).
Task 8: minor (deferred): default-application.test.ts:182 (read-only test) silently lost its
envelope (now degrades where parent's mkdtemp succeeded) — harmless but shape unasserted.
Task 8: docs note for Task 13: a read-only server with a configured target now PERSISTS identity
key + empty target tree at startup (eagerness pre-existing; persistence is new).
Task 8: fix round 1 closed — commit `5967ea4` (test-only +106/-1; homedir-guard leg asserts degrade
+ ENOENT on BOTH <cwd>/Library and <cwd>/.local — each vacuous on the other platform by design;
subdir legs use two-start shape with chmodSync-planted bits). Re-review: FINDINGS CLOSED, per-call
isolation table verified exactly (guard/both/backups-only/audit-only → 1/2/1/1 red legs). New nit
below bar: it.each first try/finally closes only `first` — cleanup loss on already-failing runs.
Task 8: complete (commits 9e725ed + 5967ea4).

Task 9 (retention): implementer commit `b823b12` (opus, DONE_WITH_CONCERNS; retention.ts +
17-leg test + call-site pin leg in config-backup.test.ts; placement per adjudicated ruling —
first statement of create(), kernel untouched). Review (opus): SPEC ✅; deletion predicate/index
math/unresolved protection APPROVED after 16 boundary legs (exactly-100 → 0 deleted; 30d edge
strict > = conservative side; ties deterministic; foreign-cased txids don't resolve; strand
direction = retain). Adjudications: ENOSPC-no-precheck ACCEPTED (ENOSPC in publication →
BACKUP_FAILED anyway; statfs would be racy); stray names safe at store level; >365d strand →
Task 13 docs note (permanent one-snapshot leak, no operator-visible cause); extra leg justified.
Fix round 1 in flight for two Importants: (1) ENOTEMPTY brick — stray file in purgeable dir →
half-destroyed dir → STATE_CORRUPT forever, every mutation bricked (reproduced live); (2) 365-day
segment boundary unpinned (month-shift mutant survives 31/31).
Task 9: minor (deferred): fsyncDirectory(auditDir) unpinned (deletable, 31/31 green; backup-side
fsync kills 3 legs).
Task 9: minor (deferred): 30-day strict > unpinned (>= mutant survives).
Task 9: minor (deferred): tie-break comparator unpinned (return 0 mutant survives; unreachable in
practice — lock + download makes same-ms createdAt impossible; comment claims what nothing tests).
Task 9: minor (deferred): retention never assertPrivateDirectory's the per-backup dir — symlinked
32-hex entry followed (asymmetry with config-backup.ts:365; owner-only planting).
Task 9: docs note for Task 13: the >365d-segment strand (resolved-then-unresolvable backup
retained forever, safe direction, no operator-visible cause).
Task 9: fix round 1 closed — commit `71dba36` (retention.ts + its test only, feature commit
untouched). Re-review: FINDINGS CLOSED — reviewer re-ran its own mutants: brick restored (filter
conjunct dropped) → 1 failed = new stray-file leg exactly; metadata-less refuse restored → 1
failed = new stranger-skip leg; month-shift → 1 failed = new segment-edge leg (cutoff-derived,
straddles the boundary on any run date). Independent 21-leg harness 21/21; ranking verified
UNCHANGED (102-seed probe: strayed #100 still spends its count slot — minimum blast radius);
residual scan→rmdir TOCTOU now lands in the skip branch (benign). Six round-1 probes re-run: all
still kill, two kill more (AND→OR 5 legs, slice(99) 4). No mtime source (grep clean); static
messages + fsync-before-return intact. 1303 passed / 1 documented staleness; canary intact.
Task 9: docs note for Task 13 (from re-review): a backup dir holding {metadata.json, stray}
without config.xml is retained forever — same safe-direction class as the >365d strand; fold both
into one sentence.
Task 9: complete (commits b823b12 + 71dba36).

Task 10 (ancestor walk): implementer commit `bd48247` (opus — in flight before the model-policy
revision; DONE_WITH_CONCERNS; state-root.ts + its test only). Design: walk BOTH spellings —
spelled path pre-create (same-uid symlink visible, refusal leaves nothing behind) + canonical
path (far side of tolerated root symlinks, e.g. /private/tmp). TOCTOU explicitly NOT closed
(needs configure.ts-style fd-held dev/ino revalidation — out of brief), bounded by leaf
O_NOFOLLOW+uid+0700. Controller adjudication of the disclosed DEVIATION: root-owned sticky dir
tolerated despite world-writable (uid===0 && sticky) — PROVISIONALLY ACCEPTED: ubuntu CI
os.tmpdir()=/tmp is 1777, brief-literal predicate reddens tests/state + 3 T8 legs + 2 integration
suites at landing; sticky+root is the standard trusted-tmpdir predicate; every component still
ownership-checked. Handed to the reviewer for independent scrutiny (soundness + is it load-bearing
+ drawn narrowly). Implementer discloses: canonical walk UNPINNED (M3 deletion mutant survives —
unprivileged tests cannot plant a root-owned symlink; disclosed in code comment) — reviewer to
assess. Carries: project-status.md:577 "decide it" now stale → Task 13; operator-visible behavior
(unsafe ancestor → read-only degrade with static message, cause invisible) → Task 13 release-note
bullet. Review (opus): SPEC ✅ all rows (both-walks design PROVEN required — canonical-only fails
the brief's own RED #1 per reviewer's M2 run); sticky exemption VERIFIED load-bearing (TMPDIR=/tmp
proxy: 13 failures/3 files without it, incl. 2 of T8's pinned legs; report's file list corrected —
opnsense-read-product does NOT redden, alias-mutation contributes 8) and SOUND (sticky = outsiders
can't rename/delete; ownership still per-component; caveat noted: exemption not scoped to OS-layout
dirs — any root-owned sticky 1777 passes, judged right vs. an allowlist). Canonical walk UNDERSOLD:
also refuses TOCTOU-planted redirect into attacker-owned dir. Verdict APPROVED WITH FINDINGS.
Fix round 1 in flight (resumed implementer) for I1 exemption narrowness unpinned (M5 survives),
I2 exemption named by no test (M8 survives locally), I3 ownership check unpinned (M4) AND
undisclosed — remedy: exported pure predicate + synthetic-Stats legs, fallback disclosure.
Adjudicated NOT a fix item: I4 symlinked-$HOME silently costs every write tool (degrade shape is
pinned T8/R7 behavior; reviewer's own framing = release note + diagnostic argument) → Task 13
release-note MUST name the symlinked-$HOME case; Slice-3 carry: diagnostic at the composition
seam (default-application.ts:155 swallow) to make degrade causes distinguishable.
Task 10: minor (deferred): walk depth unpinned (M10 last-two-components survives).
Task 10: minor (deferred): directoryComponents now a third verbatim copy (configure.ts:147,
private-fixture-root.ts:9, state-root.ts:96) — extraction candidate at final review.
Task 10: minor (deferred): predicate drift vs configure.ts undocumented (weaker deliberately —
root-symlink tolerance + sticky exemption + no per-component realpath equality); optional
one-liner folded into fix round 1's comment edit.
Task 10: minor (deferred): comment cites project-status.md "Unsafe-ancestor validation" whose text
still says "decide it" — Task 13 MUST rewrite that section or the comment self-contradicts.
Task 10: minor (deferred): stickyPublicDirectory computed unconditionally (trivial).
Task 10: carry to landing: Linux CI is the FIRST real run of the walk under a real /tmp (no
root-symlink hop — spelled walk checks /tmp directly); joins the T6/T8 landing watch list.
Task 10: fix round 1 closed — commit `d74a3d0` (same two files; +4 legs, 20→24). Scoped re-review
(sonnet, first under the revised model policy): FINDINGS CLOSED — M5/M8/M4/M12 each killed by
exactly the new leg named for it (1 failure each, no cross-kills); requireSafeComponent +
ComponentStats exported from state-root.ts but NOT re-exported from src/state/index.ts; both
disclosures (canonical walk + ownership-check unreachability) coexist; full gates + canary clean.
Task 10: note: canonical walk remains unpinned by design (M3 — root-only divergence), disclosed.
Task 10: complete (commits bd48247 + d74a3d0).

===== CUT LINE crossed 2026-08-19: slice 2b.1 (Tasks 0-10) complete, all reviewed, gates green
(1310 passed + the 1 documented sealed-evidence staleness). 2b.2 begins: Tasks 11-13, no src/**
product code, live proof at landing. =====

Task 11 (restore round-trip scenario): implementer commit `08b5ab6` (SONNET — first implementer
under the revised policy; DONE_WITH_CONCERNS; exactly 2 new files, RED confirmed module-absent
first, 18/18 new legs, 1328+1 total, both required mutation spot-checks verified then reverted).
Controller adjudication of concern 1: bespoke REST session instead of runInstalledAliasLifecycle
ACCEPTED — the helper REST-deletes the alias at end of cycle, making stateReverted vacuous
(cannot distinguish restore-reverted from lifecycle-deleted), and its private environment cannot
inject OPNSENSE_MCP_STATE_DIR (scenario-owned backup store; same hazard class as T8's LANDING
NOTE). The brief's "reuses runInstalledAliasLifecycle" line is affordance inventory subordinate
to the normative round-trip gate. Handed to the reviewer for independent scrutiny (duplication
cost + whether the bespoke session's shape drifts from the alias lifecycle).
Task 11 carry to Task 12 dispatch: the script emits schemaVersion 3 + 14 checks through the
injected writer; the REAL writeVmAttestationAtomic will throw VM_ATTESTATION_INVALID until
attestation.mjs learns the restore shape — Task 12 must make both ends meet (its brief governs;
verify against the script's constants at dispatch). Review (opus): deviation ENDORSED (both
claims verified against product3-alias.mjs: the helper always REST-deletes on all-true paths;
environment truly uninjectable; 269 duplicated lines judged fail-loud, price of the file
boundary). SPEC ✅ except row 11; verdict NOT APPROVED: C-1 live console restore can NEVER
succeed (frame markers typed cleartext, tty echo matched before the real frame → decode fail;
reproduced offline with an echo-modeling fake; bootstrap only ever wires markers base64) and
C-2 qmp.sock in instanceRoot defeats residueFree forever (shared cleanup is an allow-list,
rmdir swallows ENOTEMPTY; certain on SIGKILL path). I-1 schemaVersion 3 vs brief-pinned 2
(attestation.mjs:122 hard-rejects; live would fail even after T12); I-2 attestation payload
unpinned (M8 leak survived 18/18); I-3 QMP transform unwired-from-launch unpinned (M12
survived); I-4 the one genuinely new live driver has zero coverage while the echo-modeling
harness exists at product1b-bootstrap.test.mjs:108-142 (reviewer's 90-line adaptation found C-1
in one run). Fix round 1 in flight (resumed sonnet implementer): C-1, C-2, I-1 (schemaVersion→2
only), I-2, I-3, I-4 + three minors ADJUDICATED UP as landing-risk removals folded into the same
rewrite area (keep -monitor none + -qmp beside; digest via proven /usr/bin/openssl not unproven
/sbin/sha256; restore proven umask 077) + qmpPath derived once.
Task 11 ADJUDICATION (controller, plan amendment recorded): Task 12's file list GAINS
scripts/vm/product3-restore.mjs for exactly ONE wiring edit — default the live writer through
the new serializeVmRestoreAttestation (writeVmAttestationAtomic hard-codes the alias serializer
at product3-alias.mjs:174 with no seam; neither file is otherwise in T12's list). T12's RED legs
must pin the wiring.
Task 11: minor (deferred): backup-XML bound 2MiB vs transcript budget 512KiB (~300-350KB real
ceiling, misdiagnosed as console fault above it; realistic configs fit).
Task 11: minor (deferred): QMP sub-stages collapsed — qmp-connect/greeting/capabilities all
report as qmp-reset; RESTORE_CONSOLE_SAFE_STAGES lists four unreachable names.
Task 11: minor (deferred, RULED tolerated): interruption.signal not propagated into
restoreOverConsole (brief pinned {consolePath, backupXml}); Ctrl-C waits overallTimeoutMs 600s
on a disposable VM — acceptable, revisit only if the landing runs chafe.
Task 11: minor (deferred): send('exit') then destroy() same tick (bootstrap keeps socket open
past RESUME_COMMAND).
Task 11: minor (deferred): dead seams + five never-referenced exports; CLI stderr/exit-1 path
untested; cross-script extraction follow-up once the CREATE-only boundary lifts.
Task 11: carry to landing (⚠️ unverifiable offline): QEMU qmp-sock unlink behavior on SIGTERM;
-display none with default monitor; QMP system_reset re-entering the loader on the pinned image
(the adjudicated probe); real config.xml size vs transcript budget.
Task 11: fix round 1 — commit `83c96af` (same two files, 18→25 legs). Re-review (resumed opus
reviewer): 5 of 6 CLOSED with strong verification (C-1 confirmed three ways incl. a stricter
harness executing the real apply command in a sandbox shell — restored file byte-identical,
umask on the wire, revert-split reproduces REJECTED stage=decode; I-1 payload fed to the REAL
builder and accepted, only the 14-key set remains for T12; I-3 seam judged stronger than
suggested shape). FINDINGS REMAIN on three missing PINS only (mechanisms all correct): MC2
failure-path unlink unpinned (code right: unconditional in finally before stop; MC2b/MC2c die),
MC3 umask typed-sequence unpinned, MC6 openssl digest guarded only by a trivially-true
toContain. Fix round 2 (test-only) in flight: ['start','qmp','stop','remove'] ordering on the
failure path; sent contains umask between remount and heredoc; applyCommand has `openssl dgst
-sha256` and NOT `/sbin/sha256`.
Task 11: minor (deferred, from re-review): residual C-2 window — startDisposableVm throwing
after spawnVm but before bootstrapConsole leaves ownedVm false → unlink skipped; narrow,
already-failed run, self-healing (next run unlinks the same path first).
Task 11: minor (deferred): ported readUntil truncates per-chunk instead of rejecting overflow
(bootstrap original rejects) and carries no timeout; console-leg socket paths ~95 bytes vs
macOS 104-byte sun_path ceiling.
Task 11: note (out of scope, never a finding): attestation leg pins key set + schemaVersion +
checks but not clientVersion/scenario-flag VALUES (MC4b/MC4c unconstrained) — final review may
triage.
Task 11: fix round 2 closed — commit `0daf693` (test file ONLY, production byte-untouched,
verified). Re-review (sonnet): FINDINGS CLOSED — MC2 6 failures all genuinely failure/interrupt
legs (most direct: the explicit removeQmpSocket assertion; success-path leg correctly stays
green, proving the guard discriminates), MC3 and MC6 exactly 1 each; assertion provenance
verified to real fixture records (bytes off a real unix socket, vi.fn called by real production
paths). Harness artifact explained, no action: the re-reviewer's mutant-edit→git-checkout cycles
triggered the standard file-modified system reminders; it verified the tree clean each time and
correctly disregarded them.
Task 11: complete (commits 08b5ab6 + 83c96af + 0daf693).

Task 12 (evidence plumbing): implementer commit `f77d605` (sonnet, DONE_WITH_CONCERNS; 1347+1
documented; sealed product3-vm.json byte-identical — controller ALSO verified docs/evidence/
contains only the sealed file, no fabricated restore evidence; three mandated mutation checks
reported clean). Unplanned addition: scripts/verify-vm-attestation.d.mts (tsc rejects untyped
.mjs imports from package-contract.test.ts; mirrors scripts/testing/*.d.mts pattern) — reviewer
to judge. Concerns adjudicated as LANDING/Task-13 carries, not defects:
LANDING NOTE (blocker-in-waiting): extend .prettierignore for docs/evidence/
product3-restore-vm.json BEFORE the live producer runs at landing, or `prettier --check` fails
the landing gates (file outside T12's allow-list; T13 owns it if its file list permits, else
landing sequence step).
Task 12 note: no npm script for the restore producer (package.json outside every 2b.2 file
list); README documents the raw `node scripts/vm/product3-restore.mjs --attestation-out ...`
invocation — landing runs that form. Acceptable; revisit only if T13's brief mandates a script.
Task 12 note: `scripts/verify-vm-attestation.mjs` against the repo now fails EXPECTEDLY (restore
evidence absent until landing) — same documented-on-branch class as the sealed-evidence
staleness; must flip to 0 at landing after the live run writes the file. Review (opus): SPEC ✅
COMPLIANT all 18 rows (alias path byte-identical round-trip probed; builder body diff vs BASE
exactly 3 identity lines; M16/M17 two-builder wiring pinned by 8 legs each; M18 ENOENT vs
malformed discriminated; .d.mts legitimate — tsc TS7016 without it, never published; brief's
:259/:284/:366 line refs stale w.r.t. its own ruling, :259 correctly left un-widened). QUALITY
APPROVED WITH FINDINGS — no Critical. Fix round 1 in flight (resumed sonnet implementer,
test-only): I1 stale-restore half of the two-file verdict unpinned (ternary mutant survives 215;
missing-half is pinned) → leg: coherent alias + older-commit restore → exit 2; I2 the duplicated
atomic writer's failure paths unpinned (temp-cleanup deletion survives; identical mutant on the
ORIGINAL is killed) → port cleanup-on-rename-failure + missing-parent legs.
Task 12 CORRECTED FACT (reviewer, verified in BASE worktree): the ALIAS attestation is itself
already stale on-branch (attests d6336a3, src/** moved since) — its git-coherence leg exits 2,
pre-existing since before T12, silent because exit 1 (missing) dominates. LANDING consequence:
running ONLY the restore producer moves 1→2, not 1→0 — BOTH producers must renew at the landing
commit, order stated in T13's sequence.
Task 12 LANDING FACT (reviewer, verified empirically): a producer-canonical restore evidence
file FAILS `prettier --check` (exit 1) and format:check is inside `npm run verify` — confirms
the .prettierignore LANDING NOTE is a hard blocker, must land before/with the live producer run.
Task 12: minor (deferred): report says writeVmRestoreAttestationAtomic "module-private" but it
is exported (test imports it).
Task 12: minor (deferred): O_EXCL|O_NOFOLLOW drop survives on BOTH writer copies (pre-existing
gap on the original, now doubled) — final review triages.
Task 12: minor (deferred): test-name drift "sole-evidence commit" no longer describes the
rewritten commitVmEvidence behavior.
Task 12: minor (deferred): restore builder's shared pins (clientVersion) not independently
pinned — structural sharing + alias suite judged sufficient, low priority.
Task 12: minor (deferred → Task 13 decision): README restore paragraph carries no "does not
prove" sentence, sits ambiguously under the product3 one; adding it requires extending the
product3Claims exact-array pin (documentation.test.ts:386-391) — Task 13's call.
Task 12: minor (deferred): either-order fixture pins both attestations to the SAME base commit;
real landing sequence has the second producer at a commit containing the first evidence file.
Task 12: fix round 1 closed — commit `4a38744` (tests-only: documentation.test.ts +
product3-restore.test.mjs; only removed line = an import swap). Re-review (sonnet): FINDINGS
CLOSED — I1 mutant → exactly 1 failure at the new stale-restore leg (real git fixture traced by
hand: alias coherent 0, restore stale 2, asserts code 2 exactly); I2 mutant → exactly 1 failure
at the cleanup leg (readdir catches the leaked .pending file); both new writer legs line-for-line
mirrors of the alias suite's; missing-file discrimination leg untouched; gates + canary + sealed
evidence all verified.
Task 12: complete (commits f77d605 + 4a38744).
Task 12: controller ruling (README "does not prove" minor): current text KEPT this slice — the
existing sentence targets the alias attestation, which still does not prove restore; recorded as
a follow-up nicety in project-status, no scope extension.

Task 13 (docs, ledger, gates): implementer commit `d29bfd5` (sonnet, DONE_WITH_CONCERNS; 3 files:
project-status rewrite, one .prettierignore line, ledger force-added). Concern upheld by
controller + reviewer: the dispatch's "(a)-(l) work-list" instruction was a STALE MEMORY — no
such lettering exists in the file or its history; the implementer extended the real bold-lead-in
list in its real style (memory corrected). Review (opus): SPEC ✅ all 11 coverage items verified
independently (unsafe-ancestor text matches state-root.ts exactly and the code comment
cross-reference resolves; canary re-measured; verifier exit 1 reproduced; drift-test note
byte-preserved + carried clause; every quoted number checked incl. 22 commits, 14 keys,
retention constants; diff deletions all superseded 2a content; no secrets). APPROVED WITH
FINDINGS. Fix round 1 in flight: I-1 eight kernel.ts line refs in the Slice-3 caller-abort
bullet stale (shifted by THIS slice's T1/T7; doc's own rule = code wins; implementer re-derives
all eight) + folded M-1 (landing step 6 gains the transcript-budget misdiagnosis clause).
Task 13: minor (deferred): exemption wording marginally narrower than code (says "world-writable"
where predicate is mode & 0o022; examples all 1777, harmless).
FINAL-REVIEW AGENDA (reviewer observation, ledger's one unresolved carry): TASK-8 CARRY
effectiveResourceScopes unbounded in the shared validator vs durable sink's 4096-byte line cap —
a long-scope capability would refuse EVERY mutation once wired (fail-closed loud). Decision
still open; routed to final review.
Task 13: fix round 1 closed — commit `ee85fc1`. Re-review (sonnet): FINDINGS CLOSED — all 10
post-fix kernel.ts citation-tokens verified line-by-line at HEAD (BACKUP_FAILED grew 2→4 sites,
grep confirms exactly four in the whole file, no fifth); types.ts:128 correctly untouched; M-1
clause traced to MAX_BACKUP_XML_BYTES/RESTORE_MAX_TRANSCRIPT_BYTES source constants; gates +
canary green. Scope caveat accepted: the commit also carries the force-added ledger's own
fix-round entry (process journal, not content drift).
Task 13: complete (commits d29bfd5 + ee85fc1).

===== ALL 14 PLAN TASKS COMPLETE 2026-08-19 (Tasks 0-13, commits 959de45..ee85fc1, 24 commits
on p0c/slice2b-durable-state off main 1d4f049). Suite 1350 passed + 1 documented sealed-evidence
staleness; verifier exit 1 (restore evidence absent by design); canary byte-identical throughout.
Next: final whole-branch review (fable), ONE fix wave, then the landing sequence. =====

FINAL WHOLE-BRANCH REVIEW (fable, 1d4f049..ee85fc1): READY TO MERGE WITH FIXES. Zero Critical,
zero production-code defects. Independent adversarial verification PASSED: two-process
restart-survival against real dist/; live lockf serialization probe (contended → null in bound,
release → 'released', argv no path + empty env); O_NOFOLLOW / env-leak / exists-fail-open
mutants all caught 1-to-1; 517KB-diff secrets sweep clean; sealed artifacts byte-identical;
src/ unchanged across 2b.2 (reseal-once premise holds). Fix wave (4 Importants + 2 authorized
riders): I-1 backup write-path fsync unpinned (fsyncSync :185 + fsyncDirectory(stagingDir) :304
deletable 14/14 green; port durable-audit's vi.mock fsync-spy harness); I-2 landing state-dir
warning ordered AFTER the reseal step it guards (move between steps 2 and 3; also state that
step 6 runs only after step 5's attestation commit — restore producer refuses dirty worktree);
I-3 document the scopes/4096 interplay (one bullet, reviewer-supplied wording); I-4 promoted
T7 minor: pin pipe.destroy()-before-abort ordering in kernel-lock release (Probe C recipe,
~15 lines). Riders at zero canary risk: kernel.ts:296-297 stale listAll doc comment (T2 minor);
landing step 1 reworded to "verify the plan file is committed (it is, at 959de45)".
RULING (effectiveResourceScopes): ACCEPT AND DOCUMENT this slice — scopes not
attacker-lengthenable (subset of visibleResourceScopes, 256-char isMetadataString elements,
today exactly ['firewall.alias']); overflow shape is the slice's preferred loud fail-closed
(sink throws pre-write → EXECUTION_FAILED at intent); bounding the validator would tighten the
sealed ring for zero present payoff; right future fix = COUNT bound at authorization time in
Slice 3. Triage: 1 promoted (=I-4), 29 accepted (5 resolved by later tasks/rulings, 12
same-class test gaps, 12 bounded documented behaviors). Landing-readiness: executable with the
I-2 ordering fix; .prettierignore blocker confirmed closed on-branch; both-producers renewal +
transcript caveat + Linux watch items all carried; landing recommendation recorded: prefer the
scratch OPNSENSE_MCP_STATE_DIR stub over cleanup-after (cleanup leaves a reusable identity key).
Slice-3 note: composition-seam diagnostic = highest-leverage item; first Linux flock failure
would present as writes-sealed in the installed-package CI job.

FIX WAVE CLOSED — commit `9e25ae0` (4 files; F-1 fsync-spy harness with per-site kills 1/1/2,
fault leg static-message + empty store; F-4 Probe-C leg, swap mutant kills reacquire; F-2+R-2
warning now precedes the reseal step + dirty-worktree sentence + step-1 verify form; F-3 4096
bullet at project-status:889-893; R-1 comment-only, both callers real). Scoped re-review
(sonnet): FINDINGS CLOSED — all mutants re-applied with exact counts, docs read top-to-bottom,
gates + canary green, 1353+1 documented. Residual ACCEPTED (controller): the "Copy/paste prompt
for a new session" block (~project-status:1007) restates the pre-fix landing order — non-normative
bootstrap prose, moot once this landing completes; not worth a commit.
BRANCH CLEAN FOR LANDING: 959de45..9e25ae0 (26 commits), READY TO MERGE verdict satisfied after
the one fix wave. Landing sequence begins (per the user-approved plan + F-2 amended order):
ledger commit → merge ff to main → scratch state-dir stub → smoke:opencode reseal + fixture
commit → vm:product3 alias attestation + evidence commit → live restore proof + evidence commit
→ evidence:verify/check 0 → push → 4 CI jobs → workspace cleanup. ONE VM at a time, health-gated
(TCG flapping = dominant failure mode per ground-truth ops memory).

LANDING EXECUTED 2026-08-19: ledger commit d40b0f8 → merge ff (origin/main was exactly 1d4f049)
→ smoke reseal PASSED, fixture commit 774ffae, FULL suite 1354/1354 (first all-green run of the
lineage; state dir cleaned+confirmed absent) → vm:product3 PASSED 12/12, evidence commit d33a6dc
→ restore producer: TWO failures at failureStage 'package' (see finding below), then PASSED
14/14 — backupRestored:true, stateReverted:true, THE LIVE RESTORE ROUND-TRIP IS PROVEN — evidence
commit 5911080 → evidence:verify 0 + evidence:check 0 (two-file verifier's first real pair,
subset rule worked on the real alias-then-restore shape) → pushed 1d4f049..5911080.
LANDING FINDING 1 (npm_execpath): the documented raw invocation `node scripts/vm/
product3-restore.mjs ...` fails DETERMINISTICALLY at the package stage — prepare-installed-
package.mjs:126 requiredNpmCli reads process.env.npm_execpath, which only `npm run` sets; the
alias producer always runs via `npm run vm:product3`, the restore producer has no npm script
(T12 accepted concern — its hidden cost, invisible offline). Workaround used for the landing:
export npm_execpath=/opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js. ERRAND: add
`vm:product3-restore` to package.json at the next candidate (package.json change = digest move)
or a fallback in requiredNpmCli; update the landing-doc invocation then.
LANDING FINDING 2 (Linux flock, the predicted watch item): CI verify job RED on the landing
push — exactly one failure, kernel-lock "frees the lock when the helper process is killed":
util-linux flock(1) FORKS by default, parent holds the locked descriptor, and the exec'd waiter
inherits a DUP of the LOCKED description — killing the helper pid freed nothing while the waiter
lived. Reproduced in Docker (node:22, flock 2.38.1) with a pure-shell probe (no-o: reacquire
exit 1; with-o: exit 0). FIX be48094: add `-o` (--close) to the Linux argv — util-linux's
spelling of what BSD lockf does by default (verified by lsof: lockf's child has no fd 3).
Kernel-lock suite: Linux 13+1skip (was 1 failed), darwin 14/14. Review (sonnet): APPROVED,
mechanism independently re-proven both platforms; flagged trade-off ACCEPTED: nothing statically
pins the `-o` token on darwin — the net is the Linux CI behavioral leg; follow-up candidate.
Reseal commit 6f795cd (src moved the digest again). CI-red window on main: 5911080..be48094.
LANDING FINDING 3 (controller error, corrected): the claim "CI runs evidence:check only" was
WRONG — the CI verify job ALSO runs `npm run evidence:verify` on every main push (the
evidence-freshness job runs evidence:check). The fix push (be48094..f930a09) therefore went RED
on evidence:verify exit 2: both attestations attested 5911080-era commits with non-evidence
commits after them. REAL INVARIANT: every push to main must carry attestations renewed at (or
covered by the subset rule up to) its tip. Remedy executed: renew BOTH producers at the tip as
the final two evidence-only commits, verify 0, push. Rule for every future push to main: end
the push with the two attestation renewals (or push only evidence-suffixed histories).
