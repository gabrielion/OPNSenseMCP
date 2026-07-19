# OPNSenseMCP Rebuild Plan Index

**Execution mode:** Superpowers subagent-driven development with a fresh implementation agent and two-stage
review for each task.

**Repository:** The independent AGPL-3.0-or-later Git repository containing this file.

**Publication rule:** Local commits are allowed. No remote, push, package publication, Registry publication,
or release is allowed until every release gate in the approved design is green.

## Order of execution

1. `2026-07-17-mcp-v2-foundation.md`
   - establishes the Node/TypeScript project, pinned MCP v2 beta packages, server factory, capability catalog,
     closed policy kernel, dual-era stdio, hardened HTTP, instructions/prompts and protocol conformance;
   - produces the stable interfaces consumed by every other plan.
2. `2026-07-17-provenance-test-infrastructure-migration.md`, public Tasks 1–2, private checkpoint P0,
   then public Tasks 3–4
   - establishes and tests the public provenance tooling, then securely materializes the owner-supplied
     private bundle plus allow-listed owner-worktree overlay and audit baseline outside Git;
   - migrates only the installer and VM substrate whose dependencies already exist.
3. **MANDATORY HARD STOP — rewrite and independently review downstream plans**
   - after Provenance public Tasks 1–4, the existing Product and Guided plans are superseded inputs only and
     are not executable instructions;
   - rewrite both plans against
     `docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md` and
     `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md`, then have each replacement
     independently reviewed;
   - **Product Task 1 MUST NOT start** until both replacement plans pass that review checkpoint;
   - the replacement Guided plan must retain the mandatory native `windows-2025` pre-publication gate proving
     a package path containing spaces, `.cmd` launch, installer and ACL enforcement, MCP exchange, and
     mock connectivity, plus exact-process exit and cleanup evidence. Foundation and Provenance do not
     implement that Windows CI gate.
4. After the checkpoint, execute only the independently reviewed replacement Product plan, with the revised
   Provenance interleaving defined by that replacement.
5. Complete the remaining Provenance and product evidence work only in the order defined by the reviewed
   replacement plans.
6. Execute only the independently reviewed replacement Guided plan, including its mandatory pre-publication
   platform and release gates.

## Cross-plan checkpoints

- After foundation: deterministic tests and the six named applicable official 2025/2026 MCP protocol
  scenarios are green; this checkpoint makes no full-suite claim.
- After provenance Tasks 1–4: public provenance, secrets, bootstrap and VM-doctor validators are green; the
  private source and baseline remain outside Git, while unsealed rows are explicitly pending. Execution then
  stops at the mandatory downstream-plan rewrite and independent-review checkpoint; no old Product or Guided
  task may start.
- After product parity and final migration: exact normative base capability parity, all 96 resources,
  offline/mock and live VM read/write/readback/cleanup, offline agentic validators, complete private source
  inventory and zero residue are green; destination digests remain pending.
- After guided workflows: reviewed workflow-contract parity, all 105 approved plus 3 rewritten final
  destinations sealed, supported client smoke tests, targeted agentic cases, stable MCP SDK repin, complete
  canonical benchmark, evidence-linked README and final provenance/legal review are green.

## Review discipline

Each implementation task follows red-green-refactor, receives a specification-conformance review and a code-
quality review, runs the plan's focused gate, and ends in an atomic local commit. The final release task
deliberately uses a clean tested-parent commit followed by one narrowly allow-listed evidence commit. A
failing baseline or gate stops that task; assertions, safety checks and evidence requirements are never
weakened to proceed.
