# OPNSenseMCP Project Status and Session Handoff

- **Snapshot date:** 2026-08-18
- **Working branch:** `p0c/slice1.1-hardening`, not yet landed. P0-C Slice 1 is merged to `main`
  (`fc3b100`); this branch carries the Slice 1.1 hardening of that module and the 0.1.1 version bump.
- **Base at snapshot:** `5d772b0` (`feat: version 0.1.1`); `main` is at `fc3b100`
  (`docs: renew Product 3 VM attestation`).
- **Remote:** `https://github.com/gabrielion/OPNSenseMCP.git`
- **npm:** `@gabrielion/opnsense-mcp@0.1.0` has been on the public registry since 2026-07-29
  (OIDC `release.yml`, no stored credential). 0.1.0 predates the `b848501` services-listing fix and
  the `--help`/`--version` CLI flags; the tree is bumped to 0.1.1 on this branch and publishing it
  is the standing distribution task.
- **VM evidence state:** coherent on `main` — `npm run evidence:verify` returns 0 at `fc3b100`
  (measured 2026-08-18 in a detached worktree). On this branch it returns 2, because eleven
  non-evidence commits followed the attested commit. That staleness is by design and is cleared only
  by a real `npm run vm:product3` in the landing sequence.
- **OpenCode evidence state:** the seal in `tests/fixtures/opencode.product1a.json` was renewed on
  2026-08-10 by the real `npm run smoke:opencode` (OpenCode 1.18.16 standalone at
  `~/.opencode/bin/opencode`, the path the script expects) for the Slice 1 tarball at `0910b32`. The
  smoke model was repinned from `opencode/north-mini-code-free`, which had become unavailable
  upstream (401, then silent hangs, while `opencode models` still listed it), to
  `opencode/deepseek-v4-flash-free`. The seal is stale on this branch: Slice 1.1 changed `src/**`,
  and it still records version 0.1.0. What moves the tarball digest is exactly `src/**` (through
  `dist/`), `README.md`, `LICENSE`, `package.json` and the two tsconfigs; `scripts/**`, `docs/**`,
  `tests/**`, `.github/**` and `evals/**` do not move it, and a `package-lock.json` bump matters only
  when it moves the toolchain that produces `dist/`. CI now runs `evidence:check` in its own
  `evidence-freshness` job, so a stale seal is visible instead of silent; only the real producer can
  clear it.

This document is the starting point for a new human or coding-agent session. It describes what is actually
implemented, what has been proved, what remains incomplete, and the exact next design gate. When a statement
here conflicts with executable code or a fresh gate, the code and gate win and this document must be
corrected.

## Read these files first

Read them in this order before changing code:

1. [`AGENTS.md`](../AGENTS.md) — repository-wide operating and safety rules.
2. This file — current project and handoff state.
3. [`README.md`](../README.md) — bounded public product claims.
4. [Post-cutover P0 hardening design](superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md)
   — approved P0-A/P0-B/P0-C architecture.
5. [DeepEval and OPNsense agent evaluation design](superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md)
   — the next agentic-evaluation vertical.
6. [`docs/provenance/migration-manifest.json`](provenance/migration-manifest.json) and the
   [provenance preflight plan](superpowers/plans/2026-07-19-private-provenance-contract-preflight.md)
   before touching a provenance-listed destination.
7. [`.superpowers/sdd/progress.md`](../.superpowers/sdd/progress.md) — chronological implementation
   ledger, including failures and traps.

Do not execute a plan whose header says `SUPERSEDED`, `BLOCKED` or `DO NOT EXECUTE`.

The root instruction file deliberately contains stable repository-wide setup, testing, security and review
rules, while this status document carries fast-moving context. That follows the
[AGENTS.md project guidance](https://agents.md/) and
[Codex's layered `AGENTS.md` guidance](https://developers.openai.com/codex/guides/agents-md): keep root
instructions concise, put durable operating commands close to the code they govern, and use nested files
only when a subtree truly needs different rules.

## Product vision

OPNSenseMCP is a safety-first MCP server for administering OPNsense. Its central product rule is:

> It must never promise more than the reachable code and current evidence guarantee.

That rule has practical consequences:

- public documentation follows the live entrypoint and reachable capability catalogue;
- authorization, confirmation, backup, audit, write, readback and cleanup claims are kept distinct;
- an MCP success-shaped response is not considered proof of a firewall mutation without observed state;
- a synthetic test is not called a VM test;
- a configuration readback is not called packet-filtering proof;
- a historical run is not rebound to a later commit;
- unsupported broad legacy surfaces remain absent instead of being advertised as roadmap-complete.

The intended product path is a sequence of narrow, independently proved verticals. The current vertical
supports bounded reads and one experimental reversible host-alias mutation. Durable mutation state is the
next P0 product milestone. Agentic evaluation is being added as an independent evidence layer, not as a
replacement for deterministic product tests.

## Current reachable product

The production path is:

```text
src/main.ts
  -> src/app/default-application.ts
  -> src/capabilities/catalog.ts
  -> src/mcp/register-capabilities.ts
  -> src/capabilities/dispatch.ts
  -> src/opnsense/*-adapter.ts
  -> src/opnsense/https-client.ts
  -> configured OPNsense target
```

The MCP server is assembled in [`src/server/build-server.ts`](../src/server/build-server.ts).
Operation metadata is loaded from
[`src/operations/operation-contract.v1.json`](../src/operations/operation-contract.v1.json), while the
catalogue and policy kernel decide what is actually exposed.

### Default surface

With the default read-only configuration:

- `server_status`
- `opn_describe`
- `opn_get`
- `opn_list`

The implemented OPNsense resource coverage is intentionally small:

- singleton read of `system.status`;
- paginated read of `core.services`;
- paginated host-alias read of `firewall.alias`.

### Experimental write surface

`opn_create` and `opn_delete` exist only for host entries of `firewall.alias`. They are listed only when
these exposure gates pass:

- `READ_ONLY=false`;
- `ENABLED_FEATURE_FLAGS` contains `experimental-alias-write`;
- `ALLOWED_RESOURCES` is non-empty and contains `firewall.alias`;
- transport supports the write path;
- a configured target exists;

Elicitation is a separate call-time gate: the tools may be listed without it, but every write is refused
with `CONFIRMATION_UNAVAILABLE`.

The Product 3 VM runner uses:

```text
READ_ONLY=false
ENABLED_FEATURE_FLAGS=experimental-alias-write
ALLOWED_RESOURCES=server.status,system.status,core.services,firewall.alias
```

Listing and direct/forged dispatch apply policy gates in the approved order before target availability.
Default operation remains read-only.

### Current mutation limitations

The centralized mutation envelope exists and covers authorization, confirmation, an in-process lock,
pre-change backup, audit, revalidation, write and outcome verification. It is not yet durable:

- backup storage is removed at process shutdown;
- audit is an in-memory bounded ring;
- locking is process-local;
- no restore or automatic rollback is implemented;
- alias pagination and complete-state identity are not closed past the first bounded page;
- Windows writes remain outside the supported claim.

These are P0-C requirements, not documentation defects to hide.

## Roadmap state

### P0-A — public CI recovery

**State:** complete, closed and pushed to `origin/main` at `2d39e10`.

It repaired Linux test fixtures, hermetic installed-package preparation and OpenCode output-limit evidence
without changing production source. The public CI run recorded in the ledger was green.

### P0-B — truthful public boundary

**State:** complete and merged to `origin/main`. The 2026-07-30 sessions renewed the Product 3 VM
attestation (`npm run evidence:verify` returns 0 at `de40788`), published `0.1.0` to npm through the
OIDC release workflow, moved the pinned image to OPNsense 26.7 with a credential-free serial
bootstrap, and landed the DeepEval read-surface eval, which found and fixed a real listing defect
(`b848501`, clamped `rowCount` echo). The remainder of this section is kept as the historical record
of what P0-B covered.

Completed work includes:

- truthful refusal messages;
- descriptive and sealed write confirmation;
- experimental write feature flag and fail-closed scope policy;
- validated scope vocabulary;
- correct unavailable-target routing;
- public documentation aligned with reachable code;
- commit-bound Product 3 VM evidence producer and verifier;
- installed consumer-cwd isolation;
- hardened Product 1B/Product 3 process lifecycle;
- CI enforcement of VM evidence coherence;
- final adversarial review with its Important findings corrected.

The 2026-07-29 session added, on top of the P0-B exit review at `24a0c2b`:

```text
562004b docs: record DeepEval current project position and phased sequence
7ad2684 fix: bound serial bootstrap by console progress
12bc618 docs: renew Product 3 VM attestation          (evidence-only, attests 3fcb8a3)
3fcb8a3 test: renew OpenCode Product 1A evidence
73a8c28 docs: add DeepEval evaluation design and durable project status
```

`README.md` ships inside the npm tarball, so the documentation slice changed the package digest and the
sealed OpenCode evidence had to be renewed by the real `npm run smoke:opencode`, not by editing the fixture.
Expect the same whenever packed content changes: `src/**` through `dist/`, `README.md`, `LICENSE`,
`package.json` or the two tsconfigs.

The Product 3 attestation in `12bc618` was produced by a real disposable-VM run in which every one of the
twelve lifecycle checks passed. It is nevertheless **stale as of `7ad2684`**, because the verifier is
commit-bound and two later commits are not evidence commits.

The final publication sequence must be:

1. commit the complete clean candidate;
2. run the real Product 3 producer against that clean commit and the disposable VM;
3. commit only `docs/evidence/product3-vm.json` as the next commit;
4. run `npm run evidence:verify`;
5. push the branch.

If `npm run evidence:verify` returns `2`, the evidence is stale. Never hand-edit, synthesize or bypass it.

### P0-C — durable and correct first mutation

**State:** in progress. Slice 1 (durable private state root and target identity) is merged to `main` at
`fc3b100`. Slice 1.1 (hardening of that module plus the 0.1.1 bump) is complete on
`p0c/slice1.1-hardening` and waits for its landing sequence. Slice 2 — the inter-process lock and the
durable envelope — has no plan yet; its required carry-overs are listed under "Immediate next-session
objective / Task 3".

P0-C covers:

- durable private state root and target identity (delivered by Slice 1, hardened by Slice 1.1);
- inter-process kernel-backed lock;
- durable backup and append-only audit;
- reconciliation for unresolved transactions;
- indeterminate-write classification;
- exact alias syntax;
- complete pagination and outcome verification;
- renewal of the Product 3 VM attestation.

The full design is in
[`2026-07-25-post-cutover-p0-hardening-design.md`](superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md).

### DeepEval agentic evaluation

**State:** first vertical implemented. `evals/` carries the read-surface suite — nine goldens,
offline Level A (`npm run eval:offline`, no VM, no model, no network) and live Level C
(`npm run eval:read-surface` against the disposable VM), with `claude -p` as the judge and answers
checked against the live firewall rather than pinned notes. Its first live run caught the clamped
`rowCount` listing defect. Known deviations from the written specification are recorded in
`evals/README.md`. Write scenarios (reversible alias lifecycle with deterministic readback, the
Elicitation hook) are not implemented yet. The decisions below remain the governing contract.

Decisions already made:

- DeepEval is the canonical open-source evaluation framework.
- The first implementation pins Python `deepeval==4.1.4`, the PyPI release checked on 2026-07-28.
- Claude Code is the evaluated MCP host and runs through `claude -p --output-format stream-json`.
- The original workstation currently has Claude Code 2.1.220. Every run must record its effective version.
- Unattended write scenarios use Claude Code's MCP `Elicitation` hook to accept only the exact preauthorized
  lab confirmation; any other request is refused.
- The installed OPNSenseMCP package is exercised, not an imported internal handler.
- Live scenarios use only the owned disposable OPNsense VM.
- DeepEval receives the live tool catalogue, calls, arguments, results and final response after execution.
- Real state changes are deterministic gates: a write is followed by an MCP readback in the same scenario.
- A success-shaped no-op must fail even if an LLM judge gives it a high score.
- Qualitative LLM metrics begin in score-only mode until calibrated against human labels.
- Confident AI upload is disabled for the first vertical.
- The initial implementation is clean-room under new `tests/evals/**` and `scripts/evals/**` paths.

The specification and implementation acceptance criteria are in
[`2026-07-28-deepeval-opnsense-agent-evaluation-design.md`](superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md).

The next formal step is owner review of that written specification. After approval, use
`superpowers:writing-plans` to produce a TDD implementation plan. Do not start implementation before that
review gate.

## What has been proved on the disposable VM

The existing Product 1B runner proves a bounded installed-package read lifecycle:

- owned VM start;
- account bootstrap;
- isolated package installation;
- one MCP session;
- `server_status`;
- `opn_describe system.status`;
- `opn_get system.status`;
- `opn_list core.services`;
- VM stop and residue cleanup.

The existing Product 3 runner proves a bounded installed-package host-alias lifecycle:

```text
alias absent
  -> create
  -> same alias present on readback
  -> delete same UUID
  -> alias absent on readback
  -> VM stopped
  -> owned residue absent
```

The attestation is [`docs/evidence/product3-vm.json`](evidence/product3-vm.json). Its verifier, not the
existence of the file, decides whether it is coherent with the current commit.

These tests prove OPNsense configuration behavior for their exact scenarios. They do not prove live packet
filtering, NAT forwarding, broad resource parity or production-firewall safety.

## Test and verification map

Use Node.js 22.19.0 or newer within major 22. On the original macOS workstation:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH
```

Install dependencies with:

```text
npm ci --ignore-scripts
```

Important commands:

| Command                                                    | Meaning                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run license:check`                                    | License-header gate                                                                   |
| `npm run verify`                                           | Generated operations, format, lint, typecheck, license, build and deterministic tests |
| `npm run test:conformance`                                 | Both pinned MCP protocol profiles                                                     |
| `npm run provenance:verify`                                | Public migration-manifest integrity                                                   |
| `npm run evidence:check`                                   | Sealed installed-package/OpenCode evidence                                            |
| `npm run evidence:verify`                                  | Commit-bound Product 3 VM-attestation coherence                                       |
| `npm run vm:doctor`                                        | Read-only host/VM prerequisite report                                                 |
| `npm run vm:product3 -- --attestation-out <absolute-path>` | Real Product 3 producer; interactive secret input                                     |

Before a final code or documentation commit, run the exact gates required by `AGENTS.md`. Before publication,
also ensure both evidence gates are coherent. Never infer success from a composed command's final line alone;
check the process exit and complete output.

The deterministic suite currently uses Vitest projects:

- `parallel`;
- `installed-package`;
- `opencode-runner`;
- separate `evidence`.

MCP conformance runs separately for protocol versions `2025-11-25` and draft `2026-07-28`.

## Important implementation boundaries

### Product and test code

- Never bypass `tools/list`/`tools/call` by treating `dispatch.ts` as the end-to-end server.
- Preserve the capability catalogue, policy kernel and MCP registration as the deciding boundary.
- Capability modules and Zod callbacks are trusted static startup code; do not load third-party executable
  capability objects in-process.
- New evaluation code must communicate across a validated data-only process boundary.

### Provenance

The migration manifest currently lists 28 agentic destinations as `approved-pending-migration` with
`contentSha256: null`. The historical agentic plan is superseded and must not be executed.

Do not:

- restore old files from unreachable Git objects;
- copy them into the same or renamed destinations;
- claim an old blob is the private authorized baseline;
- seal a migration without the private preflight and operator checkpoint.

The legacy harness remains useful as historical requirements:

- 108 conversations and 175 turns;
- `claude -p` stream-json capture;
- deterministic expected-tool and VM-state metrics;
- cleanup, checkpoint and attestation concepts.

Those facts guide the clean-room design; they do not authorize copying implementation text.

### Live target and credentials

- Never use a production firewall.
- The only authorized live target is the owned disposable local VM.
- Never log, commit or pass credentials in process arguments.
- Read interactive secrets from stdin/TTY and keep private configuration mode `0600`.
- A development password being low-value does not weaken the credential-handling contract.
- Stop the VM and prove residue cleanup in `finally`, including on model, metric or process failure.

## Known traps

- The workstation's default Node may be version 26. Always select Homebrew Node 22 before validation.
- `npm run evidence:verify` intentionally becomes stale after non-evidence commits until the real VM producer
  renews the evidence.
- `.superpowers/sdd/progress.md` is tracked even though `.gitignore` lists its directory; use `git add -f`
  when intentionally updating it.
- Some historical plans contain useful context but are explicitly superseded.
- A test name containing “VM” does not prove the VM ran; require the real producer and lifecycle evidence.
- The disposable VM answers on its API port well before the serial console prints `login:`; on the reference
  workstation readiness was 69 s after launch and the login prompt 112 s. The serial bootstrap deadline
  therefore bounds absence of console progress, not the length of a healthy boot. Before that fix
  `npm run vm:product3` only succeeded when an operator typed slowly enough at the hidden prompt, and it
  failed at bootstrap stage `login` for any unattended or fast input.
- The current alias readback is bounded to a page of 100. Do not claim complete-state absence beyond that
  bound before P0-C.
- The current DeepEval documentation still carries a “DeepEval 4.0” banner and contains a few naming
  inconsistencies between overview examples and the MCP quickstart, while PyPI publishes 4.1.4. Pin 4.1.4
  and test the adapter API instead of following an unpinned snippet blindly.
- `deepeval test run -r N` reruns the agent only if the test function invokes the agent; repeating a
  precomputed output merely regrades the same output.
- Claude Code authentication and a DeepEval judge provider are separate preconditions.
- Do not use a fake OpenAI key to make an import or deterministic metric appear configured.
- `tests/state/identity-key-race.test.ts` spawns real child processes that import a **compiled** build,
  passed to them as an argument. Its `beforeAll` compiles `src` into a private scratch directory — never
  `dist/`, which three sibling tests in the same `parallel` project read or execute. A hand-run that points
  the children at `dist/` instead exercises whatever was last built there, so a stale `dist/` can make a
  fixed race look broken or a broken one look fixed.
- That race test runs 12 starters across 4 fresh rounds plus a residue pass. If it ever flakes, suspect the
  retry margin in `src/state/identity-key.ts`, not the harness: measured pre-fix failure was
  19–28 % of starters per round at 12 concurrent starters and 33–43 % at 20. The 5-attempt bound that
  followed still exhausted on real CI — one starter in twelve on `ubuntu-24.04` in release run
  32084653665 — because macOS cannot reproduce the failure at all: the vulnerable window is the fsync
  inside `writeCandidate` (0.388 ms on ext4 against 0.011 ms of work), during which every peer's sweep
  can remove the candidate. The bound is now 10 attempts with a jittered backoff between them; on a
  2-vCPU Ubuntu 24.04 emulation that is 0 failures in 724 starters with the deepest chain 4 of 10 at
  both 12-way and 20-way. Diagnose a future flake by retry depth, not by the classifier: the persistent
  bucket was hit zero times in 280 pre-fix Linux starters.
- `canonicalizeOrigin` now rejects underscored hostnames (`https://a_b.example`), a common internal
  spelling, and every rejection returns the same opaque static sentence that never says which rule fired.
  Expect that report from users of underscored internal names.

## Immediate next-session objective

P0-B is closed. The 2026-08-10 session verified the published 0.1.0 end to end in a real Claude Code
session — registered with `claude mcp add` exactly as the README instructs, live reads of
`system.status` and `core.services` against the disposable VM — then added `--help`/`--version` to
the CLI and refreshed the public documentation. P0-C Slice 1 landed on `main` the same day.

The 2026-08-17/18 Slice 1.1 hardened that module on `p0c/slice1.1-hardening`:

- concurrent first starts no longer kill each other. The identity-key publication tolerates a swept
  candidate, classifies transient failures and repeats the whole attempt — that branch bounded the
  repeat at 5 attempts, which the follow-up fix below replaced; every error that escapes is one
  static sentence carrying no path. A real multi-process race test (12 starters on a shared barrier,
  fresh roots and planted residue) is the proof.
- the state root is canonicalized before it is validated, through a new `openResolvedStateRoot`
  entry point, so the macOS `/var` → `/private/var` spelling is accepted; a non-normalized override
  is rejected with its own static message.
- origin admission rejects trailing dots, empty labels, underscores and port `0`; IP literals are
  exempt.
- the dead duplicate backup module was deleted. The live `config-backup.ts` feature is byte-untouched.
- CI gained an independent `evidence-freshness` job running `evidence:check`, mirrored inline on the
  release path; both are pinned by tests.
- the tree was bumped to 0.1.1 across 13 files, with the sealed fixture deliberately untouched.

A separate follow-up fix on `p0c/identity-key-retry-margin` (2026-08-18) then closed a CI-observed
flake in that race test: the 5-attempt bound exhausted on a two-vCPU `ubuntu-24.04` runner, one
starter in twelve, in release run 32084653665. The publication now allows 10 attempts with a jittered
pause between them (0, 5, 10, 20, 40 then 50 ms, ±50 % derived from the pid and the attempt, ≤ 412 ms
in all). The backoff, not the raised bound, is what fixes it: 10 attempts without a pause still failed
29 % and 8 % of starters across two 2-vCPU Linux runs. Neither branch changed the error contract.

The remaining ordered work:

### Task 1 — land this branch, then publish 0.1.1

`0.1.0` predates the `b848501` listing fix and the CLI flags; a user on 0.1.0 can still hit the
clamped-`rowCount` failure on large service pages (observed live in the 2026-08-10 session). The
version is already bumped in the tree, so what remains is to land `p0c/slice1.1-hardening` with the
Task 2 evidence sequence and then dispatch the `Release` workflow; the operator must approve the
`npm-publish` environment. Two things about that landing:

- **`npm run verify` is expected RED on this branch, on exactly one assertion.**
  `tests/integration/installed-package.test.ts` compares the sealed fixture's `package.version`
  (`0.1.0`, which is what the smoke really exercised) with `package.json` (`0.1.1`). Hand-editing the
  sealed fixture would fabricate evidence and is forbidden; the real `npm run smoke:opencode`
  regenerates the version and the digests together, after which `npm run verify` must be fully green
  **before** `npm run vm:product3` runs.
- **Check that the first green `main` run actually executed the `evidence-freshness` job**, rather
  than reporting green because an earlier step failed and the job never ran.

### Task 2 — evidence renewal sequence for any publishable candidate

The attestation is commit-bound: any non-evidence commit makes it stale again. For every candidate,
in this order and without reordering:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH      # or any Node >=22.19 <23
npm run license:check && npm run verify && npm run test:conformance && git diff --check
npm run smoke:opencode                        # renews the sealed OpenCode evidence on the final tree
npm run evidence:check                        # MUST return 0 afterwards
git add -A && git commit                      # the complete clean candidate
npm run vm:doctor                             # expect READY
git status --porcelain=v1 --untracked-files=all   # MUST be empty, the producer refuses otherwise
npm run vm:product3 -- --attestation-out "$PWD/docs/evidence/product3-vm.json"
git add docs/evidence/product3-vm.json
git commit -m "docs: renew Product 3 VM attestation"
npm run evidence:verify                       # MUST return 0
git push origin main
```

If the producer fails, read `failureStage` in its JSON line. It stops the VM and verifies residue on
every path; never hand-edit, synthesize or bypass the evidence. CI runs both evidence gates:
`evidence:verify` inside the `verify` job, and `evidence:check` in an independent
`evidence-freshness` job that nothing gates and that gates nothing, so a stale seal reddens that job
alone and the conformance signal survives. `release.yml` runs both inline before publishing. A stale
OpenCode seal therefore no longer passes CI silently — and CI cannot clear it either, because only
the real `npm run smoke:opencode` can re-seal, so the reseal must land before the push.

### Task 3 — write the P0-C Slice 2 plan

The next vertical is P0-C Slice 2 (inter-process kernel-backed lock and the durable envelope). Write
the plan with `superpowers:writing-plans` from the approved design in
[`2026-07-25-post-cutover-p0-hardening-design.md`](superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md),
then implement it TDD-first. The plan must carry these forward — they are requirements, not
suggestions:

- **Unsafe-ancestor validation: decide it.** `ensurePrivateDirectory` validates the canonical path
  and the leaf's owner and mode, but never walks ancestor ownership or writability. Slice 1.1 raised
  the stakes rather than lowering them: at the new `openResolvedStateRoot` entry a symlinked
  **ancestor** converts from fail-closed to fail-open — the path now resolves and the code proceeds,
  so `identity.key` can land wherever a same-uid ancestor redirect points. Slice 2 must either
  implement the ancestor walk or record an explicit scope ruling that weighs exactly that delta.
- **R1–R9, the kernel and types refactors from the 2026-08-17 review:**
  - R1 — move lock release out of `finally` and give it a `LOCK_RELEASE_FAILED` outcome;
  - R2 — have `LockHandle.release` report its result instead of swallowing it;
  - R3 — enforce the terminal audit through a single helper;
  - R4 — `BackupService.create(BackupRequest)` instead of positional arguments;
  - R5 — bounded `acquire`/`exists`/`release` that accept abort signals;
  - R6 — a durable backup root replacing the tmpdir store;
  - R7 — lazy mutation-service construction so win32 stays read-only;
  - R8 — an origin seam from the composed application;
  - R9 — extend the audit `ALLOWED_KEYS`.
- **A version-drift test.** The 0.1.1 bump hand-synced the version across 13 files; the task brief
  listed 8 of them and grep plus control experiments found five more. Derive the literals from
  `package.json` or add a drift assertion.
- **`config-backup.ts` cleanup.** Its comment still refers to the module Slice 1.1 deleted, and the
  repository's now-sole backup discipline has three unguarded legs — `nlink === 1`, checksum
  mismatch and truncation — worth roughly a 15-line test addition. A second stale comment sits above
  `openResolvedStateRoot` in `src/state/state-root.ts`: it says the canonicalizing entry "widens the
  accepted spelling, not the accepted directory", which the fail-open ancestor delta falsifies. That
  file is packed, so correcting it moves the tarball digest; it rides to Slice 2 under the same rule.

The two concurrent-first-start races that Slice 1 parked are **closed** by Slice 1.1 (ENOENT-tolerant
sweep, bounded retry, and a real multi-process race test) and are no longer carried.

**DeepEval write scenarios** remain the alternative vertical: extend `evals/` with the reversible
alias lifecycle under deterministic MCP readback and the Elicitation-gated confirmation, per the
written specification. Do not start both in the same worktree — they touch lifecycle, evidence and
mutation contracts that need a clear ordering or isolated worktrees.

The serial-bootstrap fix (`7ad2684`) and the credential-free bootstrap are proved by direct
measurement and recorded in `.superpowers/sdd/progress.md`; the superseded password-path
instructions found in older handoffs must not be executed.

## Copy/paste prompt for a new session

```text
Resume OPNSenseMCP. main is the published branch; p0c/slice1.1-hardening carries the P0-C Slice 1.1
hardening and the 0.1.1 version bump and has not landed yet.

Start by reading, in full:
1. AGENTS.md
2. docs/project-status.md
3. README.md
4. docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md
5. docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md
6. docs/provenance/migration-manifest.json
7. docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md
8. .superpowers/sdd/progress.md

Use Node >=22.19 and <23. On macOS with Homebrew that is PATH=/opt/homebrew/opt/node@22/bin:$PATH;
elsewhere select an equivalent Node 22 and never validate with the default Node.
Install with npm ci --ignore-scripts. Never use a production firewall and never expose credentials.
npm run vm:doctor must report READY: it needs qemu-system-x86_64, qemu-img, curl and bzip2. If the
image cache is empty the first VM run downloads the pinned OPNsense 26.7 nano image;
npm run vm:prepare-image does that step alone.

Before changing anything, report:
- current branch, HEAD, upstream and worktree status;
- npm run evidence:verify AND npm run evidence:check exit statuses (CI runs both: evidence:verify in
  the verify job, evidence:check in its own independent evidence-freshness job);
- which P0 increment is actually complete;
- the exact provenance status of tests/agentic/**.

The standing distribution task is publishing 0.1.1: npm 0.1.0 predates the b848501 listing fix and
the --help/--version CLI flags, and the tree is already bumped on p0c/slice1.1-hardening. Follow
"Immediate next-session objective / Task 1", using the Task 2 evidence renewal sequence for the
candidate: gates, real smoke:opencode, evidence:check 0, commit the candidate, real vm:product3,
commit only docs/evidence/product3-vm.json, evidence:verify 0, push. On that branch npm run verify is
expected RED on exactly one assertion (the sealed fixture still records 0.1.0) until the real
smoke:opencode reseals; never hand-edit the fixture.

After that, write the P0-C Slice 2 plan with its required carry-overs, or take the DeepEval write
scenarios — never both in the same worktree. A successful tool result without a changed VM must fail.

Do not restore legacy tests/agentic files, execute superseded plans, start implementation before
written-spec approval, or claim a VM/agentic result without running its real producer and cleanup.
```

## Handoff verification

On the other machine, after fetching the branch:

```text
git switch main
git pull --ff-only
git status --short --branch
npm ci --ignore-scripts
npm run evidence:verify
npm run evidence:check
```

The last command is intentionally early: it distinguishes a coherent published VM attestation from a branch
that still needs a real evidence renewal. Run the full verification gates before making new changes.
If the operator has no terminal, give the copy/paste prompt above to Codex and have it perform these steps.
