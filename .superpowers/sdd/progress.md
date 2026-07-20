# Product 2 Mutation Envelope — progress ledger

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
