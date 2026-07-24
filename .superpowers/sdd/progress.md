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
