# OPNSenseMCP Project Status and Session Handoff

- **Snapshot date:** 2026-08-18
- **Working branch:** `p0c/slice2a-envelope-prep`, not yet landed. P0-C Slice 1, its 1.1 hardening
  and the identity-key retry margin are merged to `main` (`98c33f5`); this branch carries P0-C
  Slice 2a, the envelope prep refactors, which reshape interfaces and change no observable behavior.
- **Base at snapshot:** `98c33f5` (`docs: renew Product 3 VM attestation`), which is also `main`'s
  head.
- **Remote:** `https://github.com/gabrielion/OPNSenseMCP.git`
- **npm:** `@gabrielion/opnsense-mcp@0.1.1` was published on 2026-08-18. A GitHub Release `v0.1.1`
  triggered `release.yml`, which published over OIDC with no stored credential once the operator
  approved the `npm-publish` environment, and the registry state was checked the same day with
  `npx -y @gabrielion/opnsense-mcp@0.1.1 --version` run **outside** this repository — inside it, npx
  resolves the local package and never queries the registry. The release tag lives on GitHub; a local
  clone carries only `v0.1.0`. 0.1.0, on the registry since 2026-07-29, predates the `b848501`
  services-listing fix and the `--help`/`--version` CLI flags, so 0.1.1 is the version to install.
- **VM evidence state:** `main`'s head `98c33f5` is itself the Product 3 attestation commit, produced
  by the documented landing sequence. On this branch `npm run evidence:verify` is stale by design,
  because the slice's own commits follow the attested one; that staleness is cleared only by a real
  `npm run vm:product3` in the landing sequence.
- **OpenCode evidence state:** the seal in `tests/fixtures/opencode.product1a.json` is produced only
  by the real `npm run smoke:opencode` (OpenCode 1.18.16 standalone at `~/.opencode/bin/opencode`,
  the path the script expects); it was last renewed at `808646f` for the retry-margin tarball and
  records version 0.1.1. The smoke model was repinned from `opencode/north-mini-code-free`, which had
  become unavailable upstream (401, then silent hangs, while `opencode models` still listed it), to
  `opencode/deepseek-v4-flash-free`. The seal is stale on this branch, because Slice 2a changed
  `src/**`. What moves the tarball digest is exactly `src/**` (through
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

Slice 2a reshaped the envelope's interfaces so those implementations can be swapped for durable ones
without touching the kernel — the lock handle reports its release, the backup service is handed a
`BackupRequest`, every service call is bounded by the capability's timeout, and the composition root
builds the services lazily and fail-closed — but the services behind those interfaces are still the
process-lifetime ones listed above.

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

**State:** in progress. Slice 1 (durable private state root and target identity), Slice 1.1 (hardening
of that module plus the 0.1.1 bump) and the identity-key retry margin are merged to `main` at
`98c33f5`. Slice 2a (envelope prep refactors — R1–R5, R7–R8 and four carry-overs, with zero
observable behavior change) is complete on `p0c/slice2a-envelope-prep` and waits for its landing
sequence. Slice 2b — the durable backup root, the durable backup/audit/lock implementations and the
inter-process lock — has no plan yet; its required carry-overs, including the prerequisites Slice 2a's
reviews raised, are listed under "Immediate next-session objective / Task 3".

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
  could remove the candidate. The bound is now 10 attempts with a jittered backoff between them; on a
  2-vCPU Ubuntu 24.04 emulation that is 0 failures in 724 starters with the deepest chain 4 of 10 at
  both 12-way and 20-way. Diagnose a future flake by retry depth, not by the classifier: the persistent
  bucket was hit zero times in 280 pre-fix Linux starters.
- Slice 2a then hoisted that sweep out of the retry loop: it runs once per `ensureIdentityKey` call,
  before the first attempt, so a retry can no longer remove a live peer's in-flight candidate. On
  darwin that halves the targeted transient under staggered arrival, but darwin numbers characterize
  the mechanism and are not fix verification — the 2-vCPU Linux procedure above is what settles it.
  The trade is named in the module: a peer that dies between its own link and its own unlink while we
  are retrying leaves residue this call will not sweep, and the next start collects it.
- `canonicalizeOrigin` now rejects underscored hostnames (`https://a_b.example`), a common internal
  spelling, and every rejection returns the same opaque static sentence that never says which rule fired.
  Expect that report from users of underscored internal names.

## Immediate next-session objective

P0-B is closed. The 2026-08-10 session verified the published 0.1.0 end to end in a real Claude Code
session — registered with `claude mcp add` exactly as the README instructs, live reads of
`system.status` and `core.services` against the disposable VM — then added `--help`/`--version` to
the CLI and refreshed the public documentation. P0-C Slice 1 landed on `main` the same day.

The 2026-08-17/18 Slice 1.1 hardened that module; it and the retry-margin fix below are now on
`main`:

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

P0-C Slice 2a (2026-08-18) is this branch. It reshaped the mutation envelope's interfaces and its
composition root so Slice 2b can drop in durable services as pure swaps — R1–R5, R7 and R8 from the
2026-08-17 review, plus the sweep-once fix, the version-drift test and the two stale comments — under
a hard zero-behavior-change rule. The envelope's step-order event list (`lock.acquire`, `preflight`,
`audit.intent`, `backup.create`, `preflight`, `handler`, `verify`, `audit.result`, `lock.release`) is
the canary for that rule and is byte-identical to the one on `main`. What each refactor delivered,
and what it deliberately left to 2b, is in Task 3 below.

The remaining ordered work:

### Task 1 — land this branch

0.1.1 is published (see the npm note at the top), so nothing here waits on a release and no `Release`
workflow needs dispatching. What remains is to land `p0c/slice2a-envelope-prep` with the Task 2
evidence sequence. The clamped-`rowCount` failure on large service pages, which a user still on 0.1.0
can hit (observed live in the 2026-08-10 session), is fixed for anyone on 0.1.1. Three things about
that landing:

- **`npm run verify` is expected green on this branch.** Unlike the Slice 1.1 landing there is no
  expected-RED assertion: the sealed fixture already records 0.1.1, and nothing in this slice touches
  the version claim.
- **The tarball digest moved.** This slice changed `src/**`, so the real `npm run smoke:opencode`
  must reseal before the candidate commit. `evidence:check` and `evidence:verify` are stale on the
  branch by design and are cleared only by their real producers, in the Task 2 order; hand-editing
  either document would fabricate evidence and is forbidden.
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

### Task 3 — write the P0-C Slice 2b plan

The next vertical is P0-C Slice 2b: the durable backup root, the durable backup, audit and lock
implementations behind the interfaces Slice 2a reshaped, and the inter-process kernel-backed lock.
Write the plan with `superpowers:writing-plans` from the approved design in
[`2026-07-25-post-cutover-p0-hardening-design.md`](superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md),
then implement it TDD-first.

Slice 2a already delivered, so the plan starts from these rather than repeating them:

- R1 — the lock release left the `finally`. Every path assigns one `result` and breaks a single
  labeled block, so the release runs once, sequentially, after the terminal audit; a release that
  throws is still swallowed exactly as before.
- R2 — `LockHandle.release()` returns `'released' | 'unconfirmed'`. The in-process handle always
  reports `'released'`; the envelope captures the report and deliberately does not act on it.
- R3 — one `finishWith(outcome, backupId?)` helper carries all eleven terminal audit sites, so a new
  branch cannot silently skip the result record. It was nine when the helper landed; R5's bounding
  added the two runner-non-value `BACKUP_FAILED` refusals. The preflight and intent exits legitimately
  bypass the helper — they never reach step 8 — so a recount must count terminal sites, not exits.
- R4 — `BackupService.create(request, signal)` takes a `BackupRequest`: locked target, capability id,
  MCP name, arguments digest, effective scopes, observed-state digest and effect-plan digest, all
  kernel-supplied, instead of one positional scope string.
- R5 — no unbounded service call is left. `acquire`, `create`, `exists` and both release sites run
  under `runBounded` with the capability's timeout, and `create` and `exists` each take their own
  runner's signal rather than sharing one budget.
- R7 — the mutation services are built by one lazy fail-closed helper: if construction throws, the
  runtime serves a read-only catalogue instead of failing to start.
- R8 — the composition root holds the parsed connection config and hands the builder the real origin,
  which is returned and ignored this slice.
- The identity-key sweep runs once per `ensureIdentityKey` call instead of once per retry; the
  version-drift test (`tests/foundation/version-drift.test.ts`) exists; both stale comments are true.

The plan must carry these forward — they are requirements, not suggestions:

- **Unsafe-ancestor validation: decide it.** `ensurePrivateDirectory` validates the canonical path
  and the leaf's owner and mode, but never walks ancestor ownership or writability. Slice 1.1 raised
  the stakes rather than lowering them: at the new `openResolvedStateRoot` entry a symlinked
  **ancestor** converts from fail-closed to fail-open — the path now resolves and the code proceeds,
  so `identity.key` can land wherever a same-uid ancestor redirect points. Slice 2 must either
  implement the ancestor walk or record an explicit scope ruling that weighs exactly that delta.
- **R6 — the durable backup root** replacing the tmpdir store, together with the durable backup,
  append-only audit and kernel-backed lock behind the interfaces above.
- **Backup content is never verified — a prerequisite of R6, not a nicety.** `create` computes a
  sha256 of the bytes it just wrote and discards it; nothing persists the digest or the length. So
  `exists` proves presence and privacy only — id pattern, `O_RDONLY | O_NOFOLLOW` open, `fstat`,
  `nlink === 1` — and never reads a byte, while the kernel treats `exists === true` as "backup
  verified" (`kernel.ts:1751`; its false branch at `:1760-1764` is the `BACKUP_FAILED` refusal).
  2b must persist the create-time digest and make the check read it, and must close the mode gap
  too: `exists` skips the 0600 check, so a post-write `chmod` is invisible. Two red-if-fixed pins in
  `tests/capabilities/envelope/config-backup.test.ts` record today's behavior and fail the moment it
  improves.
- **R9 — extend the audit `ALLOWED_KEYS`,** deliberately deferred to 2b alongside its durable
  consumer, because widening the allow-list without one adds dead surface. The type extension point
  is prepared by `BackupRequest`.
- **`transactionId` is missing from both `BackupRequest` and `AuditRecord`** — the one spec field a
  service cannot synthesize. 2b adds it to both, symmetrically.
- **Separate target-reachability from write-availability in the catalogue.** `catalog.ts`, which
  exposes the writes, and `opnsense/list.ts`, which reads, both key off the single
  `aliasAdapter.available` flag, so R7's fail-closed degrade takes alias _reads_ down with the
  writes. On win32 `openResolvedStateRoot` throws unconditionally, so in 2b that degrade becomes the
  ordinary win32 path: shipping it unsplit hands every Windows operator a read regression — the exact
  opposite of what R7 exists to buy. A red-if-fixed pin sits in the degrade test in
  `tests/app/default-application.test.ts`.
- **Canonicalize the origin seam.** R8 passes `parsed.url` verbatim; 2b must canonicalize it before
  deriving a target id from it.
- **Make `catalog.listAll` required.** Its optionality weakens two guards that fall back to an empty
  list when it is absent: the holdings evidence at `kernel.ts:1989` and the
  `sealUnavailableCapabilities` dedup.
- **Require signal honouring in the service contracts.** `runBounded` bounds the wait, not the
  operation, so a durable service that ignores its signal is still unbounded. `release()` takes no
  signal at all and cannot be truly bounded. An `acquire` aborted after the manager granted the
  handle leaks it, since the runner discards the value; use `runOperation`'s retain-hook precedent in
  the 2b lock contract.
- **Verify sweep-once on Linux.** The darwin stress characterizes the mechanism — targeted transients
  roughly halved under staggered arrival — but darwin cannot reproduce this failure class at all, so
  it is not fix verification. Re-running the 2-vCPU Linux retry-margin procedure against the
  sweep-once tree is what settles it, and is a candidate for the 2b exit gate; the retry budget was
  deliberately not shrunk before that evidence exists. Recorded and unimplemented: an inode-scoped
  retry sweep, restricted to candidates that share the published key's inode, would recover
  peer-crash-mid-publication residue without ever touching a live candidate.
- **Drift-test scope.** It covers 6 files and 7 literals. The 0.1.1 bump touched 13 sites; the rest
  are sealed evidence and client-identity pins, excluded on purpose, since re-pinning them would
  erase the difference they exist to expose. The assertion is substring containment, so a site that
  read `0.1.11` would satisfy version `0.1.1`.

Deferred to Slice 3, where the refusal vocabulary is opened:

- **`AUDIT_RESULT_FAILED` and `LOCK_RELEASE_FAILED` semantics.** Both hooks already exist as captured
  and discarded locals at the exact points Slice 3 will read them: the release report, and
  `terminalAuditRecorded` beside the envelope's verdict.
- **The success audit sits inside the parse `try`.** Once a failed audit is consequential, a throwing
  success-audit re-enters `finishWith('INVALID_OUTPUT')` — a double record under the wrong code — so
  it must be hoisted. `terminalAuditRecorded = false` also conflates "the audit failed" with "step 8
  was never reached"; gate it on verified success. The `services === undefined` runtime guard at
  `kernel.ts:1870` is untested.
- **`EXECUTION_FAILED` is indistinguishable from an upstream 403** to the operator (UX backlog from
  the 0.1.1 end-to-end run). It is a candidate for the Slice 3 vocabulary work.
- **A cancel mid-envelope never reports `CANCELLED`.** A caller that cancels after the envelope
  starts gets whichever refusal the abort happens to produce on the step it lands in; there is no
  cancellation vocabulary at all. It belongs with the refusal-vocabulary work, not before it.
- **R3's single-helper invariant is pinned by a one-shot grep, not by a test.** "Every terminal path
  leaves through `finishWith`" was checked by hand once, when the helper landed. Slice 3 must encode
  it as an execution-boundary source-text test, or the invariant decays the first time someone adds
  a branch — and the eleven-versus-nine drift above is what that decay looks like.

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
Resume OPNSenseMCP. main is the published branch and carries P0-C Slice 1, its 1.1 hardening, the
identity-key retry margin and the 0.1.1 version bump; p0c/slice2a-envelope-prep carries the P0-C
Slice 2a envelope prep refactors and has not landed yet.

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

0.1.1 is already published to npm (2026-08-18, GitHub Release v0.1.1 -> release.yml -> OIDC publish);
do not dispatch a release for it. The open task is landing p0c/slice2a-envelope-prep. Follow
"Immediate next-session objective / Task 1", using the Task 2 evidence renewal sequence for the
candidate: gates, real smoke:opencode, evidence:check 0, commit the candidate, real vm:product3,
commit only docs/evidence/product3-vm.json, evidence:verify 0, push. On p0c/slice2a-envelope-prep
npm run verify is expected green; the two evidence gates are stale by design until their real
producers run, and neither sealed document may be hand-edited.

After that, write the P0-C Slice 2b plan with its required carry-overs, or take the DeepEval write
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
