# OPNSenseMCP Project Status and Session Handoff

- **Snapshot date:** 2026-08-19
- **Working branch:** `p0c/slice2b-durable-state`, not yet landed. P0-C Slice 1, its 1.1 hardening,
  the identity-key retry margin **and Slice 2a** (the envelope prep refactors) are merged to `main`
  (`1d4f049`); this branch carries P0-C Slice 2b, durable mutation state. It replaces the
  process-lifetime backup/audit/lock behind Slice 2a's interfaces with durable ones — a
  content-verified backup store, an append-only monthly audit log and a kernel-backed inter-process
  lock, all under a new durable layout `targets/<targetId>/{backups,audit,lock}` — adds retention and
  an ancestor-ownership walk for the state root, and proves a full backup-restore round-trip on the
  disposable VM over its console (not the API). Slice 2b.1 (Tasks 0–10, deterministic, no VM) and
  2b.2 (Tasks 11–13, the restore scenario and this document) are both implemented and reviewed; what
  remains is the landing sequence in "Immediate next-session objective / Task 1".
- **Base at snapshot:** `1d4f049` (`docs: renew Product 3 VM attestation`), which is also `main`'s
  head; this branch adds 22 implementation and review commits on top of it, plus this document's own.
- **Remote:** `https://github.com/gabrielion/OPNSenseMCP.git`
- **npm:** `@gabrielion/opnsense-mcp@0.1.1` was published on 2026-08-18. A GitHub Release `v0.1.1`
  triggered `release.yml`, which published over OIDC with no stored credential once the operator
  approved the `npm-publish` environment, and the registry state was checked the same day with
  `npx -y @gabrielion/opnsense-mcp@0.1.1 --version` run **outside** this repository — inside it, npx
  resolves the local package and never queries the registry. The release tag lives on GitHub; a local
  clone carries only `v0.1.0`. 0.1.0, on the registry since 2026-07-29, predates the `b848501`
  services-listing fix and the `--help`/`--version` CLI flags, so 0.1.1 is the version to install.
  Slice 2b lands no version bump, so 0.1.1 stays the version to install after it lands too.
- **VM evidence state:** `main`'s head `1d4f049` is the Product 3 alias-lifecycle attestation commit,
  attesting tested commit `d6336a3`. `npm run evidence:verify` now checks **two** independent
  evidence files — the existing alias round-trip and a new restore round-trip — and returns non-zero
  if either is missing, malformed or incoherent with the current commit. On this branch it returns
  `1`: the new file, `docs/evidence/product3-restore-vm.json`, does not exist yet (by design — Slice
  2b.2 wired the producer, the attestation builder and the two-file verifier, but the live VM run is
  a landing-sequence step, not a branch-commit step), and the existing alias evidence is
  independently stale too — this branch's 22 commits since `1d4f049` are all non-evidence commits,
  which the verifier's git-coherence check treats as staleness regardless of which paths they touch.
  Both producers must run again at the landing commit, alias first then restore, per the order in
  "Immediate next-session objective / Task 1"; running only the restore producer would move the
  combined exit code from `1` to `2`, not to `0`.
- **OpenCode evidence state:** the seal in `tests/fixtures/opencode.product1a.json` is produced only
  by the real `npm run smoke:opencode` (OpenCode 1.18.16 standalone at `~/.opencode/bin/opencode`,
  the path the script expects); it was last renewed at `d6336a3` for the Slice 2a tarball and records
  version 0.1.1. The smoke model was repinned from `opencode/north-mini-code-free`, which had become
  unavailable upstream (401, then silent hangs, while `opencode models` still listed it), to
  `opencode/deepseek-v4-flash-free`. The seal is stale on this branch, because Slice 2b.1 changed
  `src/**` again (the durable backup, audit and lock modules, retention, the ancestor walk and the
  composition-root wiring). What moves the tarball digest is exactly `src/**` (through
  `dist/`), `README.md`, `LICENSE`, `package.json` and the two tsconfigs; `scripts/**`, `docs/**`,
  `tests/**`, `.github/**` and `evals/**` do not move it, and a `package-lock.json` bump matters only
  when it moves the toolchain that produces `dist/`. Slice 2b.2 (Tasks 11–13) touches none of that,
  so it does not re-move the digest a second time. CI runs `evidence:check` in its own
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
7. The chronological implementation ledgers, including failures and traps:
   [`.superpowers/sdd/progress.md`](../.superpowers/sdd/progress.md) through Slice 2a, and
   [`.superpowers/sdd/2026-08-18-p0c-slice2b-durable-mutation-state/progress.md`](../.superpowers/sdd/2026-08-18-p0c-slice2b-durable-mutation-state/progress.md)
   for Slice 2b — each plan now keeps its own ledger in a directory named after itself rather than
   appending to the one flat file.

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

The centralized mutation envelope exists and covers authorization, confirmation, a lock, pre-change
backup, audit, revalidation, write and outcome verification. Slice 2b made the state behind that
envelope durable:

- backup storage survives process shutdown, under a persisted, content-verified store
  (`targets/<targetId>/backups/<backupId>/{config.xml,metadata.json}`) with retention, not a process
  purge, bounding it;
- audit is an append-only monthly log on disk (`targets/<targetId>/audit/YYYY-MM.jsonl`); the
  in-memory bounded ring from earlier slices still exists but now backs only tests and fixtures;
- locking is inter-process and kernel-backed (`flock`/`lockf` on `targets/<targetId>/lock`), so a
  second server process aimed at the same target serializes against the first instead of walking
  through it.

What is still a limitation, unchanged or only partly addressed by 2b:

- there is still no automatic rollback inside the mutation envelope, and restore is still not an MCP
  tool — Slice 2b proves a backup is restorable at all, over the disposable VM's console (not the
  API, not a capability a caller can invoke), which is a proof of the backup's integrity, not a
  product feature;
- the kernel-backed lock still has no mid-hold liveness channel: if the helper process holding it
  dies while the envelope keeps mutating, nothing notices — a second server aimed at the same target
  can acquire the lock while the first envelope is still running (reproduced during review: a second
  acquire succeeded 42 ms after the first helper died). `LockHandle` has no channel to report it;
  this is recorded as a known limitation in its own contract text, not fixed this slice;
- alias pagination and complete-state identity are still not closed past the first bounded page;
- Windows writes remain outside the supported claim (`openResolvedStateRoot` still throws
  unconditionally on win32) — but Slice 2b stopped that unavailability from taking alias **reads**
  down with the writes, so a win32 operator now keeps the read surface;
- reconciliation for unresolved (started-but-undecided) transactions still has no CLI;
- indeterminate-write ("may-have-started") classification still does not exist;
- exact alias syntax validation still does not exist.

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

**State:** in progress. Slice 1 (durable private state root and target identity), Slice 1.1
(hardening of that module plus the 0.1.1 bump), the identity-key retry margin and Slice 2a (envelope
prep refactors — R1–R5, R7–R8 and four carry-overs, with zero observable behavior change) are all
merged to `main` at `1d4f049`. Slice 2b — the durable backup root, the durable backup/audit/lock
implementations behind Slice 2a's interfaces, the inter-process lock, retention, the state-root
ancestor walk and the restore round-trip attestation — is complete and reviewed on
`p0c/slice2b-durable-state` and waits for its landing sequence, listed under "Immediate next-session
objective / Task 1".

P0-C covers:

- durable private state root and target identity (delivered by Slice 1, hardened by Slice 1.1);
- inter-process kernel-backed lock (delivered by Slice 2b);
- durable backup and append-only audit (delivered by Slice 2b, with retention bounding both);
- reconciliation for unresolved transactions (still open — no CLI; deferred past 2b, see the
  Slice-2b deferrals below);
- indeterminate-write classification (still open — Slice 3 territory);
- exact alias syntax (still open — Slice 3 territory);
- complete pagination (still open — Slice 3 territory);
- outcome verification (exists already, from the mutation envelope's earlier slices, unchanged by
  2b);
- renewal of the Product 3 VM attestation — both the alias round-trip and the new restore round-trip,
  at the 2b landing sequence.

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

A new sibling runner, `scripts/vm/product3-restore.mjs`, extends that lifecycle with a round-trip the
API alone cannot prove, because OPNsense config restore is not a REST operation:

```text
alias absent (observed over REST)
  -> backup taken through the product (the envelope's strict pre-write snapshot)
  -> alias created through the product (the same mutation the alias runner proves)
  -> backup restored over the VM's console, not the API (a scenario-scoped QEMU QMP `system_reset`
     back into the loader, then the proven single-user-shell overwrite of `/conf/config.xml`)
  -> alias absent again (re-observed over REST)
  -> VM stopped
  -> owned residue absent
```

Its two new checks, `backupRestored` and `stateReverted`, join the twelve the alias runner already
records; the attestation is a new sibling file,
[`docs/evidence/product3-restore-vm.json`](evidence/product3-restore-vm.json), produced by
`node scripts/vm/product3-restore.mjs --attestation-out "$PWD/docs/evidence/product3-restore-vm.json"`
and checked by the same verifier, which now reads both evidence files independently. As of this
document the scenario is implemented and its deterministic seams are tested offline (Slice 2b.2); it
has not yet been run against the real disposable VM, so this document does not count it as proved —
only a real landing-sequence run does, the same rule every other VM claim in this section follows.

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

| Command                                                                  | Meaning                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm run license:check`                                                  | License-header gate                                                                     |
| `npm run verify`                                                         | Generated operations, format, lint, typecheck, license, build and deterministic tests   |
| `npm run test:conformance`                                               | Both pinned MCP protocol profiles                                                       |
| `npm run provenance:verify`                                              | Public migration-manifest integrity                                                     |
| `npm run evidence:check`                                                 | Sealed installed-package/OpenCode evidence                                              |
| `npm run evidence:verify`                                                | Commit-bound coherence of BOTH Product 3 VM attestations (alias + restore round-trip)   |
| `npm run vm:doctor`                                                      | Read-only host/VM prerequisite report                                                   |
| `npm run vm:product3 -- --attestation-out <absolute-path>`               | Real Product 3 alias-lifecycle producer; interactive secret input                       |
| `node scripts/vm/product3-restore.mjs --attestation-out <absolute-path>` | Real Product 3 restore round-trip producer; interactive secret input; no npm script yet |

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
  renews the evidence. Since Slice 2b it checks two independent evidence files (alias round-trip and
  restore round-trip); either one being missing, malformed or incoherent is enough to fail it, and the
  combined exit code favors "missing" (`1`) over "stale" (`2`) when both are wrong at once.
- `.superpowers/sdd/progress.md` is tracked even though `.gitignore` lists its directory; use `git add -f`
  when intentionally updating it. Since Slice 2b each dated plan directory under `.superpowers/sdd/`
  keeps its own `progress.md` the same way — e.g.
  `.superpowers/sdd/2026-08-18-p0c-slice2b-durable-mutation-state/progress.md` — rather than appending
  to the one flat file; the flat file's own history stops at Slice 2a.
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
  are retrying leaves residue this call will not sweep, and the next start collects it. Slice 2b
  considered promoting the 2-vCPU Linux verification of this fix to an exit gate and deliberately did
  not: it is a separate tracked errand (user adjudication, 2026-08-18), because the sweep-once fix
  itself shipped in Slice 2a and is independent of 2b's durable-state work.
- `canonicalizeOrigin` now rejects underscored hostnames (`https://a_b.example`), a common internal
  spelling, and every rejection returns the same opaque static sentence that never says which rule fired.
  Expect that report from users of underscored internal names.
- Slice 2b's landing push is the first REAL execution, on Linux CI, of three paths this darwin
  workstation could only fake or skip in its own tests: the kernel lock's `flock` branch (no
  `/usr/bin/flock` exists here to test against, and `/dev/fd/<n>` reopens on Linux where darwin dups
  it), the ancestor walk's spelled-path check over a genuine `/tmp` (this workstation's spelled walk
  crosses a root-owned symlink hop first; Linux's does not), and the durable state root's real
  platform-default directory (`vitest` here never actually creates `~/Library` or `~/.local/state`).
  Watch those three CI legs specifically on the first post-landing push.
- Any script that starts a real server or VM against a configured target without an explicit
  `OPNSENSE_MCP_STATE_DIR` (and, on darwin, without overriding `HOME`) now touches the operator's own
  durable state directory, because Slice 2b's composition root opens the real platform default rather
  than a disposed-of tmpdir. `scripts/run-opencode-smoke.mjs` and the VM lifecycle scripts are exactly
  this shape; stub a scratch state directory before running them for landing, or plan to clean up
  `~/Library/Application Support/opnsense-mcp` (darwin) / `~/.local/state/opnsense-mcp` (Linux)
  afterward.

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

P0-C Slice 2a (2026-08-18) landed on `main` at `1d4f049`. It reshaped the mutation envelope's
interfaces and its composition root so Slice 2b could drop in durable services as pure swaps —
R1–R5, R7 and R8 from the 2026-08-17 review, plus the sweep-once fix, the version-drift test and the
two stale comments — under a zero-behavior-change rule with exactly two plan-ordered carve-outs, both
strictly fail-safe and both pinned by its own tests: R5's bounding turns a lock or backup service
that never answers into a `LOCK_UNAVAILABLE`/`BACKUP_FAILED` refusal at the capability's timeout,
where the dispatch used to hang forever (the three "never answers" tests in
`tests/capabilities/mutation-envelope.test.ts`), and R7's guard turns a mutation-service construction
failure into a read-only server, where startup used to crash (the degrade test in
`tests/app/default-application.test.ts`). Nothing else moved: the envelope's step-order event list
(`lock.acquire`, `preflight`, `audit.intent`, `backup.create`, `preflight`, `handler`, `verify`,
`audit.result`, `lock.release`) is the canary for that rule. What 2a delivered is the list right
below; what it deliberately left to Slice 2b is the AS-LANDED record under Task 3 further down —
every one of those items is now implemented, reviewed and gated on `p0c/slice2b-durable-state`.

P0-C Slice 2b (2026-08-18/19) is this branch. It replaces the process-lifetime backup, audit and lock
behind those same interfaces with durable ones, adds the retention and ancestor-ownership work the
2a reviews required as prerequisites, and closes with a live proof that a stored backup actually
restores. The kernel's canary stays exactly the list above through every task — only Task 1
(`transactionId` threading) and Task 7 (the lock's `release(signal)` and retain-hook) touch
`executeMutationEnvelope` at all, and both re-prove the byte-identical success order. Tasks 4–6 and 9
change modules that sit entirely behind the `BackupService`/`AuditSink`/`MutationLockManager`
interfaces 2a cut, so the kernel — and its canary — never sees them change.

The remaining ordered work:

### Task 1 — land `p0c/slice2b-durable-state`

0.1.1 is published (see the npm note at the top) and this slice bumps no version, so nothing here
waits on a release and no `Release` workflow needs dispatching. Landing is a controller step, in
this order:

1. Commit the plan file itself —
   `git add -f docs/superpowers/plans/2026-08-18-p0c-slice2b-durable-mutation-state.md` — the same
   thing 2a's own plan skipped until its final review; do not repeat that omission.
2. Use `superpowers:finishing-a-development-branch` to merge fast-forward to `main`.
3. **The tarball digest moved again.** Slice 2b.1 (Tasks 1–10) changed `src/**`, so the real
   `npm run smoke:opencode` must reseal before the candidate commit, exactly as it did for 2a; Slice
   2b.2 (Tasks 11–13) touches no `src/**`, so it does not move the digest a second time. Confirm full
   gates green on the resealed tree.
4. **Before running any script that starts a real server or VM without an explicit
   `OPNSENSE_MCP_STATE_DIR` and `HOME` override,** stub a scratch state directory or plan to clean up
   afterward: `scripts/run-opencode-smoke.mjs` and the VM lifecycle scripts now spawn a server that,
   with a configured target, opens the **durable** state root at its real platform default —
   `~/Library/Application Support/opnsense-mcp` on the workstation that lands this — and a landing
   run that skips this would write real durable state into the operator's own home directory rather
   than a disposable one.
5. Candidate fixture commit, then the real `npm run vm:product3` against it — this renews the now
   twice-stale alias attestation (see "VM evidence state" at the top) — then its own attestation
   commit.
6. **Live restore proof.** Run the real restore producer —
   `node scripts/vm/product3-restore.mjs --attestation-out "$PWD/docs/evidence/product3-restore-vm.json"` —
   then commit `docs/evidence/product3-restore-vm.json` on its own, exactly as the alias producer's
   evidence is committed alone. Then `npm run evidence:verify` **and** `npm run evidence:check` must
   both return `0`. This is the first live run of the QMP-reset-and-console-overwrite mechanism
   Task 11 could only prove through injected seams offline; if the live probe that the guest
   re-imports `/conf/config.xml` on boot does not hold, the producer's own `failureStage` says so —
   never hand-edit, synthesize or bypass the evidence.
7. Push, then confirm all four CI jobs actually executed (`parallel`, `installed-package`,
   `opencode-runner`, `evidence-freshness`) rather than reporting green because an earlier step
   failed and a later job never ran. No release this slice — 0.1.1 is already on npm.
8. Track the **sweep-once 2-vCPU Linux verification** (see the drift-test/sweep-once note under
   Task 3 below) as a separate errand once landed; record its result in the Slice 2b ledger when it
   lands, and do not shrink the identity-key retry budget before then.

Watch three jobs on the landing push specifically, because each exercises a path this darwin
workstation could only fake or skip: the kernel lock's `flock` branch (Task 6 — this host has no
`/usr/bin/flock` to test against; `/dev/fd/<n>` also reopens on Linux where darwin dups it), the
ancestor walk's spelled-path check under a **real** `/tmp` (Task 10 — this workstation's spelled walk
crosses a root-owned symlink hop first; Linux's does not), and the durable state root's real platform
default directory (Task 8 — `vitest` never truly creates `~/Library` or `~/.local/state`).

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
npm run evidence:verify                       # 0 once every evidence file this repo tracks is fresh
git push origin main
```

If the producer fails, read `failureStage` in its JSON line. It stops the VM and verifies residue on
every path; never hand-edit, synthesize or bypass the evidence. CI runs both evidence gates:
`evidence:verify` inside the `verify` job, and `evidence:check` in an independent
`evidence-freshness` job that nothing gates and that gates nothing, so a stale seal reddens that job
alone and the conformance signal survives. `release.yml` runs both inline before publishing. A stale
OpenCode seal therefore no longer passes CI silently — and CI cannot clear it either, because only
the real `npm run smoke:opencode` can re-seal, so the reseal must land before the push. Since Slice
2b, `evidence:verify` checks every evidence file this repository tracks (two, as of this slice: the
alias and restore round-trips), so a candidate that adds a scenario runs this sequence's VM-producer
half once per scenario, each with its own attestation commit, before the final `evidence:verify`.

### Task 3 — P0-C Slice 2b: what landed

Slice 2b's plan —
[`2026-08-18-p0c-slice2b-durable-mutation-state.md`](superpowers/plans/2026-08-18-p0c-slice2b-durable-mutation-state.md),
written from the approved design in
[`2026-07-25-post-cutover-p0-hardening-design.md`](superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md)
— implemented the durable backup root, the durable backup, audit and lock behind the interfaces
Slice 2a reshaped, and the inter-process kernel-backed lock, TDD-first across 12 reviewed
implementation tasks (Tasks 1–12) plus this documentation task (Task 13). It started from what
Slice 2a had already delivered:

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
- R7 — the mutation services are built by one eager, guarded fail-closed helper: construction still
  runs at startup, not at first write, but a throw inside it now yields a read-only catalogue
  instead of a failed start.
- R8 — the composition root holds the parsed connection config and hands the builder the real origin,
  which is returned and ignored this slice.
- The identity-key sweep runs once per `ensureIdentityKey` call instead of once per retry; the
  version-drift test (`tests/foundation/version-drift.test.ts`) exists; both stale comments are true.

Every one of the carry-overs Slice 2a's reviews demanded is now implemented, reviewed and gated on
this branch:

- **Unsafe-ancestor validation: implemented.** `openResolvedStateRoot` now walks every ancestor
  directory, over BOTH the spelled path (checked pre-create, so a same-uid symlinked ancestor is
  visible and a refusal there leaves nothing behind) and the canonical path (checked after
  `realpathSync`, the far side of a tolerated root-owned symlink such as macOS's `tmpdir()` through
  `/private`): each component must be a directory, not a symlink unless root-owned (the platform's
  own layout), owned by root or the current uid, and not group/other-writable — with one deliberate,
  disclosed exemption: a root-owned **sticky** world-writable directory (`/tmp`, `/var/tmp`,
  `/dev/shm`) is tolerated, because the kernel already forbids renaming or removing an entry you do
  not own there, and every component the walk visits is still ownership-checked regardless. This is
  what keeps CI's `/tmp` (mode `1777`) usable without weakening the check anywhere it matters. The
  comment above the walk in `src/state/state-root.ts` records this ruling and no longer says "decide
  it". TOCTOU between the walk and the leaf's own creation is explicitly not closed — closing it needs
  `configure.ts`-style fd-held revalidation, out of this slice's brief — and is bounded instead by the
  leaf's own `O_NOFOLLOW` open, uid check and `0700` mode.
- **R6 — the durable backup root: implemented.** The shutdown-scoped tmpdir store is gone. Durable
  state now lives at `targets/<targetId>/{backups,audit,lock}` under the state root Slice 1
  introduced — directories `0700`, files `0600` throughout — wired by the composition root's one
  eager, fail-closed helper (`buildMutationServices`) that Slice 2a's R7 guard already made degrade
  to read-only instead of crash on any construction fault. This surfaced a ship-gap the same review
  caught and closed: `tsconfig.build.json` compiles only `src/**/*.ts`, so the kernel lock's waiter
  (`lock-waiter.mjs`, already plain JavaScript) would never have reached `dist/` or the npm tarball —
  an installed package would have refused every mutation while every in-repo test, which resolves the
  waiter from `src/`, stayed green. `scripts/copy-runtime-assets.mjs` now copies `src/**/*.mjs` into
  `dist/` after the TypeScript compile closes that gap.
- **Backup content is now verified — the two red-if-fixed pins flipped.** `create` persists the
  sha256 digest and byte length it computed, in a `metadata.json` sibling to `config.xml` inside
  `<backupId>/`, published by writing and fsyncing both files into a private staging directory and
  only then renaming that directory into place — atomic, so a crash anywhere before the rename leaves
  residue, never a half-written backup. `exists` now reopens both files `O_RDONLY|O_NOFOLLOW`,
  revalidates owner, `nlink === 1` and `0600` mode on each, and answers `true` only when the stored
  bytes still hash to the stored digest — a truncated backup, a flipped byte, or a mode widened after
  the write are each now `false`, closing the mode gap the old `exists` could not see. Any fault at
  all is `false`; the configuration bytes and the backup id never cross the MCP boundary.
- **Retention: implemented**, running inside `backup.create` rather than literally "before a new
  intent" as the design spec's prose has it (a deliberate, adjudicated deviation — see below). It
  keeps the newest 100 **and** the last 30 days of _resolved_ backups (a backup is resolved once its
  transaction has a terminal `result` line anywhere in the audit trail; an unresolved one is never
  purged, because it is exactly what a reconciliation would need), and audit segments for 365 days,
  preserving any segment holding an unresolved transaction however old it is. Two retention corner
  cases both retain rather than delete, by design, with no operator-visible cause: a backup that
  resolves inside an audit segment already past the 365-day cutoff, and a backup directory holding
  its `metadata.json` plus an unrelated stray file but no `config.xml`, are both kept forever rather
  than risk destroying state retention cannot fully account for.
- **R9 — `ALLOWED_KEYS` extended: implemented,** together with its durable consumer (the append-only
  audit sink, next) — no dead surface, per the original deferral's own reasoning.
- **`transactionId` on both `BackupRequest` and `AuditRecord`: implemented.** The kernel generates
  one 128-bit (32-lowercase-hex) id per envelope run and threads the identical value into the intent
  audit, the result audit and the backup request — pinned by a test asserting the same id reaches all
  three and that two different dispatches never share one.
- **Target-reachability is now separate from write-availability in the catalogue: implemented.**
  `createProductCapabilityCatalog` takes a third parameter, `exposeAliasWrites`, defaulting to the
  alias adapter's own `available` flag so the common case is unchanged; the composition root now
  passes a **reachable** alias adapter with `exposeAliasWrites: false` whenever the target answers
  but the local mutation machinery could not be built, so alias reads survive a failed backup root
  instead of dying with the writes. On win32, where `openResolvedStateRoot` still throws
  unconditionally, this degrade is now the **ordinary** path rather than a full read regression.
- **The origin seam is now canonicalized before deriving a target id: implemented.**
  `buildMutationServices` calls `deriveTargetId(ensureIdentityKey(root), canonicalizeOrigin(origin))`
  at the seam, closing the gap where R8 had passed `parsed.url` verbatim.
- **`catalog.listAll` is now required: implemented.** Both `?? []` fallbacks (the holdings evidence
  and the `sealUnavailableCapabilities` dedup) are gone; a `CapabilityCatalogView` double without
  `listAll` fails to compile rather than silently falling back to an empty list.
- **Signal honouring in the service contracts: implemented.** `LockHandle.release(signal)` now takes
  the release runner's own signal — both the in-process and the kernel-backed manager honour it — and
  a late-granted lock (one whose `acquire` resolves just as its bound fires) is released rather than
  leaked, mirroring `runOperation`'s retain-hook precedent. The success path is unchanged, so the
  canary stayed byte-identical through this change too.
- **A read-only server now writes to disk at startup, when a target is configured.**
  `buildMutationServices` runs eagerly regardless of `READ_ONLY` — that eagerness predates 2b (R7) —
  but it now runs against the **durable** state root instead of a process-scoped tmpdir, so a
  read-only server with a configured target persists the identity key and creates the (empty) target
  directory tree on every startup, even though it never intends to write a backup. Expected behavior,
  not a defect.
- **Operator-visible consequence of the ancestor ruling.** A state root behind an unsafe ancestor now
  silently degrades the server to read-only with the same static message R7 already used for every
  other construction fault — nothing distinguishes the cause. Named explicitly: an operator whose
  **`$HOME` is itself a symlink** gets every write tool withheld with no explanation pointing at why.
  Pinned, intended behavior (R7/Task 8), not a bug; a distinguishing diagnostic is Slice-3 territory,
  below.
- **Sweep-once on Linux: still open, and deliberately not a 2b gate.** The user adjudicated this on
  2026-08-18 (Open Question 5): verifying the sweep-once identity-key fix under the 2-vCPU Linux
  procedure that originally found the retry-margin flake is a **separate tracked errand**, not a
  Slice 2b exit gate, because the sweep-once fix already landed in Slice 2a and is independent of
  2b's durable work. The retry budget (10 attempts, jittered backoff) stays exactly as Slice 2a left
  it until that Linux evidence exists; record the result in the Slice 2b implementation ledger when
  it lands. Recorded and still unimplemented: an inode-scoped retry sweep, restricted to candidates
  that share the published key's inode, would recover peer-crash-mid-publication residue without
  ever touching a live candidate.
- **Drift-test scope**, carried forward unchanged because Slice 2b ships no version bump and touches
  none of its files: it covers 6 files and 7 literals. The 0.1.1 bump touched 13 sites; the rest are
  sealed evidence and client-identity pins, excluded on purpose, since re-pinning them would erase
  the difference they exist to expose. The assertion is substring containment, so a site that read
  `0.1.11` would satisfy version `0.1.1`.

**Deviations recorded honestly** (mirroring the 2a AS-LANDED convention — disclosed, not hidden):

- **Retention runs inside `backup.create`**, not literally "before a new intent" as the design
  spec's prose has it — adjudicated by the user (Open Question 4, 2026-08-18) specifically to keep
  the mutation envelope's step-order canary byte-identical; the refusal-before-first-write guarantee
  the spec cares about is preserved regardless of which step number performs it.
- **The ancestor ruling, as implemented, includes one disclosed exemption**: a root-owned sticky
  world-writable directory is tolerated (see above) — provisionally accepted because the strict
  alternative reddens `/tmp`-based tests and CI tmpdirs on every platform that follows the POSIX
  sticky-bit convention, and every component the walk visits is still ownership-checked regardless.
- **Task 11's restore script drives its own bespoke REST session** instead of reusing
  `product3-alias.mjs`'s `runInstalledAliasLifecycle` — endorsed, because that helper REST-deletes
  the alias at the end of its cycle, which would make the restore scenario's `stateReverted` check
  vacuous (unable to distinguish a state reverted by the restore from one deleted by the lifecycle
  helper's own cleanup), and because the helper's environment cannot inject the scenario-owned
  `OPNSENSE_MCP_STATE_DIR` the restore backup store needs.
- **Task 12 widened Task 11's restore script by exactly one authorized wiring edit**: the live
  attestation writer now defaults through the new `serializeVmRestoreAttestation` rather than the
  alias serializer `writeVmAttestationAtomic` hard-codes, because no other seam exists for it. A plan
  amendment the controller recorded explicitly, not scope creep.

**Deferred, not forgotten:**

- The backup metadata's TLS-context digest — the design spec names it, but persisting it needs a
  `BackupRequest` field this slice's brief did not authorize adding; deferred until a slice that does.
- The `reconcile --json` CLI, and reconciliation for unresolved transactions generally — no CLI
  exists; the restore round-trip is this slice's exit-gate proof instead, per the plan's own
  non-goals.
- Restore as an MCP tool remains a non-goal and a future slice's architecture decision, not an
  oversight — the `restore` feature flag already exists in `src/config/feature-flags.ts`, unused;
  restore stays SSH/console-side.
- The README's restore paragraph (next to the Product 3 attestation claims) carries no "does not
  prove" sentence of its own — the controller kept the existing text this slice, because the sentence
  immediately above it already targets the alias attestation and remains equally true of the restore
  attestation. A follow-up nicety for whenever that paragraph is next touched, not a todo.
- Evidence state for both attestations is recorded at the top of this document ("VM evidence state")
  and under "What has been proved on the disposable VM" above; both files must be independently
  renewed at landing.

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
- **A caller abort is masked at every step except step 2.** The cancellation vocabulary exists and
  the envelope already uses it: `CANCELLED` is a `RefusalCode` (`types.ts:128`) with its own operator
  message, a step-2 preflight abort whose cause is the caller becomes `refusal('CANCELLED')`
  (`kernel.ts:1700-1707`), and the entry check at `kernel.ts:1674` refuses an already-aborted call
  the same way. Every other step reports its own code instead: `LOCK_UNAVAILABLE` at step 1
  (`:1683` — deliberate, its comment says timing out and being cancelled report alike),
  `BACKUP_FAILED` at step 4 (`:1741`, `:1756`), `STATE_REVALIDATION_FAILED` at step 5 (`:1782`),
  `OUTCOME_INDETERMINATE` at step 6 (`:1792` — correct by design, a write may have landed) and
  `OUTCOME_UNVERIFIED` at step 7 (`:1807`). Slice 3 decides which of those should surface as
  `CANCELLED`; the answer is not "all of them".
- **R3's single-helper invariant is pinned by a one-shot grep, not by a test.** "Every terminal path
  leaves through `finishWith`" was checked by hand once, when the helper landed. Slice 3 must encode
  it as an execution-boundary source-text test, or the invariant decays the first time someone adds
  a branch — and the eleven-versus-nine drift above is what that decay looks like.
- **`TARGET_UNAVAILABLE` is misleading once writes are sealed but the target is reachable.** With
  Slice 2b's catalogue split, a caller who still forges or dispatches `opn_create` against a
  sealed-but-reachable target is refused `TARGET_UNAVAILABLE` (`kernel.ts:1334`, hard-coded) — wrong:
  the target IS available, the local mutation envelope is not. This is what a win32 operator, or any
  operator whose backup root failed, now sees. Refusal vocabulary is Slice 3 territory; fold this in
  rather than patching the single site.
- **`'unconfirmed'` lock-release outcomes need teeth.** The kernel already records whether a release
  was `'released'` or `'unconfirmed'` but does not act on it (R2, Slice 2a) — the kernel-backed
  lock's own abort path can report `'unconfirmed'` even when the helper had, in fact, already
  exited, which is conservative and today unreachable (the kernel always hands the release a fresh,
  unfired signal). Slice 3 giving `'unconfirmed'` teeth needs this distinction to matter first.
- **A diagnostic at the composition seam.** `default-application.ts`'s `buildMutationServices`
  swallows every construction fault into one `catch { return undefined; }` (line 155), so the
  operator-visible degrade above carries no cause. Slice 3 should add a diagnostic at that seam —
  logged, never surfaced to the MCP caller — so "unsafe ancestor", "unwritable root", "no lock
  helper" and "unsupported platform" stop being indistinguishable from the outside.

**Slice 2b ledger entry, for this document's own record** (the full task-by-task history, including
every review finding, is in the Slice 2b implementation ledger linked in "Read these files first"):

What changed: the durable layout `targets/<targetId>/{backups,audit,lock}` (directories `0700`,
files `0600`) replaced the shutdown-scoped tmpdir store; backups are staged, fsynced and renamed into
place, then content-verified on every `exists` call; the audit trail is an append-only monthly JSONL
log whose corruption polarity is the _opposite_ of the backup store's — a backup that cannot be
verified is reported absent and the mutation is refused, while an audit line that is too large, or
whose segment fails its integrity checks, _throws_, because a silently-incomplete audit trail is
worse than a mutation that does not happen; the lock is now kernel-backed and inter-process
(`/usr/bin/lockf -s -t 4 /dev/fd/3` on darwin, `/usr/bin/flock -x -w 4 /dev/fd/3` on Linux) held by a
long-lived, argv-free and env-free waiter process that inherits only the validated lock descriptor,
so neither the lock path nor the target ever appears in `ps` output; retention keeps the newest 100
and last 30 days of resolved backups and 365 days of audit segments, never purging anything
unresolved; the catalogue separates target-reachability from write-availability; the origin seam is
canonicalized before a target id is derived from it; `catalog.listAll` is required; `transactionId`
(32-hex) threads from one kernel-generated value through both audits and the backup request; the
state root walks ancestor ownership both ways (spelled and canonical); and the restore round-trip
scenario (`scripts/vm/product3-restore.mjs`) plus its evidence plumbing (the two-file-aware verifier,
`buildVmRestoreAttestation`) prove a backup is actually restorable, not merely present.

The canary — the mutation envelope's fixed success-path event list, `lock.acquire`, `preflight`,
`audit.intent`, `backup.create`, `preflight`, `handler`, `verify`, `audit.result`, `lock.release` —
stayed byte-identical (`7e6d085af5111f34ceace93ef780e473`) through all thirteen tasks; only Tasks 1
and 7 touch `executeMutationEnvelope` at all, and both re-proved it.

Lock probe facts worth keeping close to the code they explain: a contended `lockf -t 5` returns at
~5011 ms, 11 ms past a 5000 ms watchdog, which is why the helper's own wait is `-t 4` — strictly
inside the manager's 5 s bound, never equal to it; macOS SIGKILLs a platform binary that is copied
instead of executed in place (System Integrity Protection), so the lock test's own trust-boundary
control is a `#!/bin/sh` wrapper that `exec`s the real `lockf`, never a copy of it; `writeFileSync`'s
mode argument is umask-masked, so a test that plants permission bits through it alone is silently
testing nothing — `chmodSync` is required after; `/dev/fd/<n>` is a `dup` of the inherited descriptor
on darwin but a fresh reopen on Linux, inverting a descriptor-ownership nuance the landing push's
Linux CI run is the first real exercise of; and `os.homedir()` answers `''` when `HOME` is set to
one, which would otherwise default the state root to a **relative** path rooted at whatever directory
the server happened to start in — guarded explicitly, refusing rather than accepting it.

The user adjudicated five open questions on 2026-08-18, all before implementation began, and the
recommended option governed in every case: (1) implement the unsafe-ancestor walk; (2) the restore
mechanism is a scenario-scoped QEMU QMP monitor plus `system_reset` and the proven single-user-console
overwrite of `/conf/config.xml`, with a live probe that the guest re-imports it on boot; (3) a sibling
`product3-restore.mjs` script with its own new evidence file, leaving the alias producer and its
evidence untouched; (4) retention runs inside `backup.create`; (5) sweep-once Linux verification is a
separate tracked errand, not a 2b exit gate. Two further adjudications arrived mid-implementation,
both recorded under Deviations above: the sticky-directory ancestor exemption (provisionally
accepted), and Task 11's bespoke REST session in place of the alias lifecycle helper (endorsed).

Gates: `npm run license:check && npm run verify && npm run test:conformance && git diff --check` all
exit `0` (1350 tests passed across 66 files at this document's own commit; `evidence:check` and
`evidence:verify` are stale on this branch by design, restored only by the landing sequence's real
producers, and live outside `verify`'s own test projects, so their staleness does not affect it).

The two concurrent-first-start races that Slice 1 parked are **closed** by Slice 1.1 (ENOENT-tolerant
sweep, bounded retry, and a real multi-process race test) and are no longer carried.

### Task 4 — the next vertical, once 2b lands

Two independent verticals remain, and only one should be started per worktree — they touch
lifecycle, evidence and mutation contracts that need a clear ordering or isolated worktrees:

- **P0-C Slice 3** — opens the refusal vocabulary the mutation envelope has kept closed since Slice
  2: `AUDIT_RESULT_FAILED`/`LOCK_RELEASE_FAILED` semantics, hoisting the success audit out of the
  parse `try`, distinguishing `EXECUTION_FAILED` from an upstream 403, deciding which steps a caller
  abort should surface as `CANCELLED`, encoding R3's single-helper invariant as a source-text test,
  and the three carries Slice 2b added — the misleading `TARGET_UNAVAILABLE` for sealed-but-reachable
  writes, giving `'unconfirmed'` release outcomes teeth, and a diagnostic at the composition seam —
  the full list is under "Deferred to Slice 3" above. It should also pick up reconciliation for
  unresolved transactions (the `reconcile --json` CLI), indeterminate-write classification and exact
  alias syntax, none of which 2b's brief authorized.
- **DeepEval write scenarios** — extend `evals/` with the reversible alias lifecycle under
  deterministic MCP readback and the Elicitation-gated confirmation, per the written specification.

The serial-bootstrap fix (`7ad2684`) and the credential-free bootstrap are proved by direct
measurement and recorded in `.superpowers/sdd/progress.md`; the superseded password-path
instructions found in older handoffs must not be executed.

## Copy/paste prompt for a new session

```text
Resume OPNSenseMCP. main is the published branch and carries P0-C Slice 1, its 1.1 hardening, the
identity-key retry margin, the 0.1.1 version bump and P0-C Slice 2a (envelope prep refactors);
p0c/slice2b-durable-state carries P0-C Slice 2b, durable mutation state, and has not landed yet.

Start by reading, in full:
1. AGENTS.md
2. docs/project-status.md
3. README.md
4. docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md
5. docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md
6. docs/provenance/migration-manifest.json
7. docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md
8. .superpowers/sdd/progress.md (through Slice 2a) and
   .superpowers/sdd/2026-08-18-p0c-slice2b-durable-mutation-state/progress.md (Slice 2b)

Use Node >=22.19 and <23. On macOS with Homebrew that is PATH=/opt/homebrew/opt/node@22/bin:$PATH;
elsewhere select an equivalent Node 22 and never validate with the default Node.
Install with npm ci --ignore-scripts. Never use a production firewall and never expose credentials.
npm run vm:doctor must report READY: it needs qemu-system-x86_64, qemu-img, curl and bzip2. If the
image cache is empty the first VM run downloads the pinned OPNsense 26.7 nano image;
npm run vm:prepare-image does that step alone.

Before changing anything, report:
- current branch, HEAD, upstream and worktree status;
- npm run evidence:verify AND npm run evidence:check exit statuses (CI runs both: evidence:verify in
  the verify job, evidence:check in its own independent evidence-freshness job); evidence:verify now
  checks TWO evidence files (alias round-trip and restore round-trip) and fails if either is wrong;
- which P0 increment is actually complete;
- the exact provenance status of tests/agentic/**.

0.1.1 is already published to npm (2026-08-18, GitHub Release v0.1.1 -> release.yml -> OIDC publish);
do not dispatch a release for it, and Slice 2b lands no version bump. The open task is landing
p0c/slice2b-durable-state. Follow "Immediate next-session objective / Task 1": commit the plan file
itself, finishing-a-development-branch merge to main, real smoke:opencode reseal (Slice 2b.1 changed
src/**) with full gates green, stub a scratch state directory before running any script that starts a
real server/VM without an explicit OPNSENSE_MCP_STATE_DIR, then run the Task 2 evidence sequence
TWICE at landing — real vm:product3 (alias) with its own attestation commit, then the real restore
producer (node scripts/vm/product3-restore.mjs --attestation-out ...) with its own attestation commit
— until both evidence:verify and evidence:check return 0, then push and confirm all four CI jobs ran.
Track the sweep-once 2-vCPU Linux verification as a separate errand, not a landing blocker.

After that, take P0-C Slice 3 (the refusal-vocabulary work listed under "Deferred to Slice 3" in this
document) or the DeepEval write scenarios — never both in the same worktree. A successful tool result
without a changed VM must fail.

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
