# Task 7 implementation report

Status: DONE_WITH_CONCERNS

## Scope

Implemented Task 7 only on `codex/mcp-v2-rebuild` from base `3188923`:

- replaceable owned Foundation application runtime;
- owned dual-era stdio entrypoint and protocol-clean executable;
- closed bearer-auth projection with exact Host and serialized-Origin guards;
- bounded plain Express + beta.4 `createMcpHandler`/`toNodeHandler` Streamable HTTP runtime;
- stateless 2025 compatibility, exact body/concurrency/subscription/deadline/socket limits;
- idempotent aggregate cleanup, partial-start cleanup, and awaited signal shutdown;
- safe root exports and start scripts.

Task 7b, legacy SSE routes/session storage, product capabilities, SDK dependency changes, and a conformance runner were not added.

## TDD evidence

RED was captured before production changes with the focused Vitest command. It failed because the planned entrypoints/runtime/security modules and architecture helper did not exist.

Final focused gate:

```text
npm run build
npx vitest run tests/app/default-application.test.ts tests/mcp/stdio.test.ts \
  tests/http/runtime.test.ts tests/integration/process-lifecycle.test.ts \
  tests/architecture/execution-boundary.test.ts

5 files passed; 43 tests passed
```

The focused tests cover raw stdio JSON-RPC lines, both eras, post-initialize SIGINT/SIGTERM, recorded beta close failures, startup cleanup, exact middleware order with boundary counters, duplicate Origin lines, bearer AuthInfo, incomplete/oversized/invalid bodies, 32/33 concurrency and release, ordinary/absolute-stream deadlines, beta stateless/subscription options, 100-request socket enforcement, and aggregate cleanup failures.

## Final verification

```text
npm run verify
15 files passed; 238 tests passed

npm audit --omit=dev
found 0 vulnerabilities

git diff --check
exit 0

npm pack --dry-run --json
exit 0
```

`npm run verify` includes format check, lint, typecheck, license check, build, and the complete test suite.

## Concern

`npm run test:conformance` could not start because the base branch has no `scripts/run-conformance.mjs`. The task explicitly prohibited adding a conformance runner, so no runner was created and neither conformance era was executed. The in-repository dual-era transport tests pass.

## Safety review

- HTTP remains disabled by default and binds only to `127.0.0.1` or `localhost`.
- Host matching is strict and port-agnostic; Origin matching retains exact scheme/host/port.
- The bearer exists only in the closed authentication middleware/AuthInfo and is absent from public settings, errors, results, and diagnostics.
- Only `src/app/default-application.ts` calls `createApplicationContext(loadRuntimeConfig())`.
- Primary 2025 HTTP uses `legacy: 'stateless'`; no primary session store or Task 7b route exists.
- No production stdout writes, free-text credential arguments, direct SDK dependency, or `createMcpExpressApp` use was added.

## Review-fix cycle (2026-07-18)

Status: DONE_WITH_CONCERNS

Base implementation: `478530b5adf6c319dd1ff951665a16a4127c7349`.

### RED evidence

Tests were added before production changes. The first combined focused run reproduced every reviewed defect class:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/http/task-7-review-fixes.test.ts \
  tests/integration/process-lifecycle.test.ts \
  tests/mcp/stdio.test.ts

3 files failed; 18 tests failed; 16 tests passed
```

After correcting an SSE test-consumption mistake without changing production code, the canonical HTTP RED was:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/http/task-7-review-fixes.test.ts

1 file failed; 13 tests failed; 2 tests passed
```

The failures specifically showed: all five timer overrides accepted `2_147_483_648`; PATCH text and duplicate Authorization reached the adapter; the partial-header socket remained open; Authorization survived in all header views; the injected digest comparison and deadline clock were unused; and synchronous cleanup throws escaped aggregation or skipped later cleanup.

### GREEN evidence

Focused review regressions:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/http/task-7-review-fixes.test.ts \
  tests/integration/process-lifecycle.test.ts \
  tests/mcp/stdio.test.ts

3 files passed; 34 tests passed
```

Complete Task 7 focused gate:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run build
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/app/default-application.test.ts \
  tests/mcp/stdio.test.ts \
  tests/http/runtime.test.ts \
  tests/http/task-7-review-fixes.test.ts \
  tests/integration/process-lifecycle.test.ts \
  tests/architecture/execution-boundary.test.ts

build: exit 0
6 files passed; 59 tests passed
```

### Implemented review findings

- Timer-backed overrides accept `2_147_483_647` and reject larger values without capping non-timer integer limits.
- Every body-carrying method receives declared-size, media-type, streamed-size, and receipt-time bounds before auth/adapter; GET/HEAD bodies are rejected, bodyless legacy GET/DELETE remain reachable, and early body/concurrency rejections close unread requests.
- Node HTTP construction now receives bounded `connectionsCheckingInterval`, exact 5,000 ms production `headersTimeout`, keep-alive, and compatible request-timeout options; a real partial-header socket proves bounded closure.
- Authentication requires one raw Authorization line, always performs fixed-size SHA-256 digest comparison, rejects duplicate/comma ambiguity, removes normalized/raw/distinct wire header views, and forwards only exact local AuthInfo.
- HTTP, stdio, startup, and owned-entrypoint cleanup operations are independently scheduled before `Promise.allSettled`; synchronous and asynchronous failures remain ordered in one `AggregateError`.
- Real beta.4 HTTP tests prove 16 subscription streams, pre-ack rejection of stream 17, replacement admission, ordinary abort, one-time SSE absolute promotion, keepalive non-extension, and completed JSON deadline clearing through `toNodeHandler` and local sockets.
- The configured stdio `serve`/`onerror` seam proves that SDK-reported failures are recorded,
  diagnosed without details, and included in aggregate close results. This unit test injects the
  callback directly; it does not behaviorally execute the SDK's internal discovery-probe close path.

### Full verification

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify

exit 0
16 files passed; 254 tests passed
format, lint, typecheck, license check, build, and full test suite passed
```

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm audit --omit=dev

exit 0
found 0 vulnerabilities
```

```text
git diff --check

exit 0
```

### Commit

The review fixes, tests, and this report are one atomic `fix: harden HTTP transport boundaries` commit. Its exact SHA is reported in the handoff because a Git commit cannot contain its own object ID.

### Remaining concern

The repository-required conformance command was attempted and still cannot start:

```text
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:conformance

exit 1
Error: Cannot find module 'scripts/run-conformance.mjs'
```

The runner is absent on this branch. Adding it belongs to the explicitly excluded later conformance
task, so neither protocol era was run here.

One Minor evidence limitation remains for the final whole-branch review: the stdio test drives the
configured `serve`/`onerror` callback seam, but does not force a real SDK discovery probe to fail
during its close cycle. Production error capture and aggregation are covered; that particular SDK
internal path is not.
