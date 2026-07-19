# SDD progress

Plan: `docs/superpowers/plans/2026-07-17-mcp-v2-foundation.md`
Branch base: `e9f8803`

Task 1: complete (commits `e9f8803..b0e41ab`, review clean)
Task 2: complete (commit `433828f`, review clean)
Task 3: complete (commits `d839dd1`, `c6dfc83`, re-review clean)
Task 4: complete (commits `b7e9c35`, `41bc7be`, `3ad1dd3`, `e86cc44`; 149 tests; spec re-review clean; runtime policy and Proxy bypasses fixed; executable Zod/callback trust boundary investigated and documented)
Task 5: complete (commit `5d226e7`; 154 tests; spec compliance pass; code quality approved)
Task 6: complete (commits `f0b6d2e`, `5d2fc0e`; 203 tests; cross-tool continuation bypass fixed; spec compliance pass; code quality approved; security re-review pass)
Task 7: complete (commits `478530b`, `193829c`, `56e269c`, `5438f21`, `351db09`; 263 tests; functional, defensive-security, and official-SDK re-reviews pass; all-method body bounds, effective Node header deadline, closed bearer projection, unread Host/Origin rejection, terminal SSE timers, sync-safe aggregate cleanup, 16/17 subscription proof, and stdin-EOF ownership fixed; conformance runner intentionally deferred to Task 8)
Task 7b: complete (commits `e018ad4`, `f4ec4a3`; 292 deterministic tests; spec/quality re-review approved; security re-review PASS; detached v1 dispatch, write shutdown ownership, idle-close ownership, body reflection and import/lifecycle proof gaps fixed; P3 UUID-collision hardening and one unused internal parameter recorded for final triage)
Task 8 preflight: complete in plan commit `a4e1f1d` (fresh architecture PASS after review loops); real authenticated product runtime, network-free `server_status` preflight, body/socket/request-bounded private proxy, strict raw URL/header/report validation, exact alpha.9 six-scenario matrix, fully referenced startup/child/cleanup bounds, transactional environment restore, real child/CLI/parent watchdog proofs; implementation brief regeneration next
Task 8: complete (commits `504cd4d`, `55ca49b`, `20cd5fe`; official 2025/2026 conformance runner, private loopback proxy, fail-closed report evidence, empty expected stderr, bounded cleanup; final security/spec/quality re-reviews PASS)
Post-Task-8 confirmation hardening: complete (commit `382fc68`; canonical base64url request state, deterministic same-byte alias and true-MAC-tamper proofs; independent review PASS)
Task 9 preflight: complete in plan commit `af18709` (guarded `npm ci --ignore-scripts`, Node 22.19 floor / 22.23.1 primary, immutable current action pins, six public/twelve combined invocation accounting, exact five-path staging contract, later mutation-documentation handoff; cross-plan review PASS)
Current clean gate before Task 9 implementation: Node 22.23.1, `npm run verify` PASS, 18 files / 466 tests; `git diff --check` PASS.
Task 9: complete (commit `b3e478b`; independently authored temporary Foundation README/CONTRIBUTING, fail-fast copyable commands, direct protocol-clean stdio command, shared secret-manager HTTP token, immutable least-privilege CI, Node 22.19 stdio runtime smoke, exhaustive action-use contract; spec and quality re-reviews PASS)
Task 9 plan remediation: complete (commit `a2bb282`; executable snippets synchronized, strict TypeScript capture, reusable-workflow detection, runtime smoke, and fail-fast local gates; plan re-review PASS)
Final clean Foundation gate: Node 22.23.1; `npm ci --ignore-scripts`, 20 files / 470 tests, six public conformance scenarios, `npm audit --omit=dev` with 0 vulnerabilities, `git diff --check`, no `results`, and clean worktree all PASS.
Foundation review remediation: complete through `65120e7`; deterministic owned-tree readiness and POSIX settlement proof, stale Windows-parent refusal, validated fallback cleanup, and reset-aware raw-socket close proof; Node 22.23.1 `npm run verify` PASS at 22 files / 491 tests, six official targeted conformance scenarios PASS, audit/scans PASS; three final independent re-reviews pending before Provenance Task 1.
Foundation durable-owner remediation: implemented in `5de28fb`; structured-IPC supervisor, active-state-only numeric termination, absolute Windows system tools, complete POSIX group disappearance, bounded command/inspector output, creation-time socket error tracking; 25/25 harness stress, 10/10 proxy stress, Node 22.23.1 verify PASS at 22 files / 494 tests, conformance/audit/scans PASS; independent re-review pending.
Foundation cleanup review remediation: commits `fca659e` and `177702c`; POSIX cleanup now finalizes stdio-ignored descendants before returning results, all raw-socket trackers are consumed, spawn failures are normalized, and the pre-ready kill/close race is independently approved; fresh focused gate 16/16 with no residue.

Foundation platform-boundary remediation: complete and independently approved. The internal bounded-command
harness now refuses non-macOS/Linux platforms before supervisor spawn, proves complete cooperative POSIX group
disappearance, and contains no Windows descendant-containment path. Windows `.cmd`, junction, and absolute
`cmd.exe` projections remain unit-only design checks; native Windows evidence remains the final product-specific
release smoke, so no Job Object or extra installation prerequisite is introduced.

The earlier Foundation acceptance statement after platform-boundary remediation is superseded. Final review
identified additional tool-schema, hidden-handler ownership, conformance-child ownership/environment, plan
routing, platform-evidence, and package-phase contract findings; Foundation was not accepted at that point.
Provenance execution remains pending completion and independent review of the remediation below.

POSIX harness plan Task 1: complete (commit 7a9d6c2; review clean after TDD remediation; focused controller recheck 18/18).

Foundation final-review remediation: implemented in commits `9285bb1`, `553ec9f`, `db61267`, and `e363440`.
The v2 adapter now uses low-level tools handlers so the kernel is the sole schema parser; lifecycle ownership
retains abort-ignoring read settlement; spawned conformance children remain owned through termination errors
and receive only a frozen allow-listed environment; superseded Product/Guided plans are hard-blocked pending
rewrite/review; Windows support remains unclaimed; and the non-release package contract requires `private: true`
while forbidding `@modelcontextprotocol/express`. Node 22.23.1 evidence: combined focused suite 8 files / 362
tests PASS, `npm run license:check` PASS, `npm run verify` PASS, both official conformance profiles (six named
scenarios) PASS with zero failed checks/warnings, `git diff --check` PASS, and no repository result residue.
Independent final review of this remediation remains pending before Foundation acceptance.

Foundation re-review remediation: implemented in commits `33bcab8`, `7dc78ed`, `66707ef`, and `bb0a458`.
The low-level MCP adapter now preserves the pinned SDK's object-root JSON Schema projection for object-valued
compositions, consumes a verified one-shot confirmation redirected to an unknown name while retaining the
fixed unknown refusal, and keeps kernel-owned transforms/refinements as the only validation boundary. The
owned application runtime now closes admission synchronously on its first close call while the existing phased
aggregator continues to drain admitted work before service cleanup. Node 22.23.1 evidence: focused factory,
elicitation, application, kernel, shutdown, and architecture suites PASS at 6 files / 210 tests;
`npm run license:check` and `npm run verify` PASS at 22 files / 518 tests; both official conformance profiles
(six named scenarios) PASS with zero failed checks/warnings; and `git diff --check` PASS. Native Windows, VM,
firewall, full agentic, publication, and release evidence were not run or claimed. Another independent re-review
is required before Foundation acceptance or downstream Provenance execution.

Product 1A: owner delegated critical auto-approval and explicitly prioritized implementation over further
specification work. Active plan:
`docs/superpowers/plans/2026-07-19-product-1a-read-only-vertical.md`. Clean Node 22.23.1 baseline:
`npm ci --ignore-scripts` PASS and `npm run verify` PASS at 23 files / 631 tests. No VM, old repository,
private bundle, environment credentials, or firewall was accessed. Task 1 is next.

Product 1A Task 1: complete (commits `c4efd89..fb1c08b`; 25 files / 672 tests; initial review
found an identifier-shaped refusal-detail leak; kernel-private reviewed vocabularies and provenance-sealed
details fixed it; re-review spec compliant and quality approved with no findings).

Product 1A Task 2: complete (commits `4de635b..e8ac934`; 28 files / 710 tests; generator now
rejects nested refs and unsafe public schemas, binds exact resource tuples and Product 1B transport note;
re-review approved). Final-triage Minor: deprecated legacy-SSE duplicates object-root schema projection and
lacks a direct `opn_describe` call test; current object-only surface is not blocked.

Product 1A Task 3: complete (commits `d9d9221`, `60116f7`; 33 files / 772 tests; exact descriptor-owned
HTTPS commands, strict credential/config loading, bounded TLS reads, two-resource adapter and application
composition; re-review approved with no findings).

Product 1A Task 4: complete (commits `6cccd5e`, `a1d6bda`; 34 files / 782 tests; clean pack/install to
synthetic HTTPS reads, EOF drain-order regression fixed, OpenCode 1.18.3 smoke with final tarball SHA,
Product 1A README/CONTRIBUTING; re-review approved). Final-triage Minor: a blocked non-zero model result is
sanitized but its discarded stderr is not included in the `secretAbsent` observation; no passing evidence is
affected.

Fresh Product 1A exit gate on `a1d6bda`: `npm run license:check`, `npm run verify` (34 files / 782 tests),
both targeted conformance profiles, `npm run provenance:verify`, `git diff --check`, and clean status all
PASS under Node 22.23.1. No VM, real firewall, benchmark, release, or push was run or claimed.
