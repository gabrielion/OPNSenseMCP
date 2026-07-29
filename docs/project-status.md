# OPNSenseMCP Project Status and Session Handoff

**Snapshot date:** 2026-07-28  
**Working branch:** `codex/p0b-resume-wip`  
**Documentation-slice base:** `24a0c2b` (`docs: record final P0-B exit review`)  
**Remote:** `https://github.com/gabrielion/OPNSenseMCP.git`

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

**State:** implementation complete through the pre-attestation candidate; final evidence coherence is
determined only by `npm run evidence:verify`.

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

The base before this documentation slice is eleven commits ahead of
`origin/codex/p0b-resume-wip`:

```text
24a0c2b docs: record final P0-B exit review
368c8c8 fix: close final P0-B review findings
0c42e43 test: renew OpenCode Product 1A evidence
a845953 docs: record P0-B corrective review slices
472944e fix: preserve frozen Product 1B results
5954ce7 fix: harden Product 3 installed lifecycle
f8b9800 fix: reject dirty later VM attestations
e815ebd fix: run installed binaries from consumer cwd
83f0275 fix: hide unavailable capability metadata
2ca0f83 fix: enforce policy order before target availability
5d91d5f docs: clarify preview non-claims and live reads
```

The final publication sequence must be:

1. commit the complete clean candidate;
2. run the real Product 3 producer against that clean commit and the disposable VM;
3. commit only `docs/evidence/product3-vm.json` as the next commit;
4. run `npm run evidence:verify`;
5. push the branch.

If `npm run evidence:verify` returns `2`, the evidence is stale. Never hand-edit, synthesize or bypass it.

### P0-C — durable and correct first mutation

**State:** approved design exists; implementation plan has not been written and production implementation
has not started.

P0-C covers:

- durable private state root and target identity;
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

**State:** framework and architecture selected; written specification added; no evaluation code or canonical
benchmark result exists yet.

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

## Immediate next-session objective

Review the written DeepEval specification with the owner. If approved without changes:

1. invoke `superpowers:writing-plans`;
2. plan only the first clean-room vertical;
3. begin with offline failing tests for trace parsing and the success-shaped no-op;
4. add the Python DeepEval adapter;
5. prove one installed synthetic-target run;
6. prove real VM reads;
7. prove the reversible alias lifecycle with deterministic readback;
8. review and attest before claiming any benchmark result.

Do not start P0-C and the DeepEval implementation in parallel in the same worktree. They touch lifecycle,
evidence and mutation contracts that need a clear ordering or isolated worktrees.

## Copy/paste prompt for a new session

```text
Resume OPNSenseMCP from the public branch codex/p0b-resume-wip.

Start by reading, in full:
1. AGENTS.md
2. docs/project-status.md
3. README.md
4. docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md
5. docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md
6. docs/provenance/migration-manifest.json
7. docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md
8. .superpowers/sdd/progress.md

Use Node >=22.19 and <23; on the original Mac prepend /opt/homebrew/opt/node@22/bin.
Install with npm ci --ignore-scripts. Never use a production firewall and never expose credentials.

Before changing anything, report:
- current branch, HEAD, upstream and worktree status;
- npm run evidence:verify exit status;
- which P0 increment is actually complete;
- whether the written DeepEval specification has owner approval;
- the exact provenance status of tests/agentic/**.

The intended next work is the clean-room DeepEval 4.1.4 evaluation vertical described in the spec:
Claude Code host -> installed OPNSenseMCP -> disposable OPNsense VM -> MCP readback -> deterministic
state-transition gate plus DeepEval metrics. A successful tool result without a changed VM must fail.

Do not restore legacy tests/agentic files, execute superseded plans, start implementation before written-spec
approval, or claim a VM/agentic result without running its real producer and cleanup.
```

## Handoff verification

On the other machine, after fetching the branch:

```text
git switch codex/p0b-resume-wip
git pull --ff-only
git status --short --branch
npm ci --ignore-scripts
npm run evidence:verify
```

The last command is intentionally early: it distinguishes a coherent published VM attestation from a branch
that still needs a real evidence renewal. Run the full verification gates before making new changes.
If the operator has no terminal, give the copy/paste prompt above to Codex and have it perform these steps.
