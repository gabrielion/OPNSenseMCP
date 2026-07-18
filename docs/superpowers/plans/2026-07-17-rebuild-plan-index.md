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
3. `2026-07-17-opnsense-product-parity.md`, Tasks 1–11, interleaved with provenance Tasks 6–7
   - implements the OPNsense client, 96-resource catalog, generic operations, curated domains, backup/audit,
     fixed SSH features and explicitly gated advanced surfaces;
   - migrates each safety/integration test group only inside the product task that takes it from RED to green;
   - closes complete offline and mock parity.
4. Provenance Task 5, product-parity Task 12, then provenance Tasks 8–11
   - migrates the now-reachable agentic harness, proves live VM parity, sanitizes documentation, verifies
     replacement coverage, accounts for all 105 approved source migrations, and closes the private migration
     inventory without freezing files that guided work still changes.
5. `2026-07-17-guided-workflows-clients-release.md`
   - adds pedagogical workflows, client integrations, package/Registry metadata, user documentation, agentic
     scenarios and the final release/benchmark gates.

## Cross-plan checkpoints

- After foundation: deterministic tests and the six named applicable official 2025/2026 MCP protocol
  scenarios are green; this checkpoint makes no full-suite claim.
- After provenance Tasks 1–4: public provenance, secrets, bootstrap and VM-doctor validators are green; the
  private source and baseline remain outside Git, while unsealed rows are explicitly pending.
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
