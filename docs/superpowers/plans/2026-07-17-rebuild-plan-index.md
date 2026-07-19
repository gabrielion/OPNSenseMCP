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
2. Continue two independent post-foundation lanes; neither waits for the other:
   - **Product lane:** use the independently accepted routing in
     `docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md`, then write, review, and execute one bounded
     increment plan at a time, beginning with Product 1A. No Product implementation starts from the superseded
     parity plan; the clean-room Product 1A implementation proceeds without legacy inputs.
   - **Provenance lane:** public Task 1 in
     `2026-07-17-provenance-test-infrastructure-migration.md` is complete; continue the bounded Task 2A plans
     routed by `2026-07-19-private-provenance-contract-preflight.md`. Task 2A opens no owner input and does not
     block fresh clean-room product code or tests.
3. **GUIDED/CLIENT CHECKPOINT — rewrite and independently review before broad client work**
   - the existing Guided plan is a superseded input, not executable instructions;
   - rewrite it against `docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md`,
     `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md`, and the accepted Product 1
     contracts; Product 5 implementation starts only after that replacement passes review;
   - the replacement Guided plan must retain the mandatory native `windows-2025` pre-publication gate proving
     a package path containing spaces, `.cmd` launch, installer and ACL enforcement, MCP exchange, and
     mock connectivity, plus exact-process exit and cleanup evidence. Foundation and Provenance do not
     implement that Windows CI gate.
4. Before any approved legacy asset crosses the boundary, separately design, approve, implement, and review
   Task 2B preparation/activation, the real operator checkpoint, and Task 2C copy/rollback. Task 2D scanning
   and release projection receives its own reviewed plan before any migration or release claim relies on it.
5. Execute only independently reviewed per-increment Product plans. Prefer vertical slices that add usable
   OPNsense behavior or concrete evidence; provenance is a supporting gate, not the product.
6. Package each stable shipped surface through the independently reviewed replacement Guided plan; this may
   proceed after Product 1 while later use-case verticals continue independently.
7. On the final release candidate, run the stable MCP repin and deterministic gates, then the canonical
   benchmark, then native Windows as the final platform gate. Any subsequent fix restarts that sequence.

## Product vertical milestones

The replacement Product and Guided plans preserve these safety dependencies. Client packaging may proceed
after Product 1 in parallel with later use-case verticals, but no mutation may skip milestones 2–3:

1. **Useful read-only server:** connect to OPNsense, expose progressive discovery, prove the slice against the
   mock, and complete one read against the disposable VM.
2. **Central mutation envelope:** reuse and re-prove default-true `READ_ONLY` and resource scopes, then add
   audit, fail-closed backup, lock, and revalidation before any product mutation is considered available.
3. **One verified mutation:** perform one backed-up mutation against the disposable VM, read the result back,
   clean it up, and prove absence of residue.
4. **Independent use-case verticals:** deliver read-only investigation, per-device domain blocking, and
   internal service publication as separately shippable plans; expand only the catalogue required by each.
5. **Clients and pedagogy:** package stable workflows for Claude, Codex, OpenCode, Kimi, and other supported
   MCP clients, with progressive, non-technical clarification behavior and support claims backed by tests.
6. **Pre-publication proof:** run and attest the complete agentic benchmark on the clean candidate, then obtain
   native Windows evidence as the last gate before publishing scores, packages, or release claims.

## Product focus rules

- Every implemented milestone must end with one user-visible demonstration and the matching deterministic,
  mock, or disposable-VM evidence. A larger catalogue, generated types, or passing structural checks alone do
  not count as product progress.
- Build the smallest useful vertical before breadth: the bounded read-only pair and progressive discovery,
  then the shared safety envelope, then one reversible mutation. Do not front-load all 96 resources, every
  plugin, client packaging, Windows evidence, or the full benchmark.
- New clean-room product code and new tests do not wait for private provenance. Only reuse of an approved
  legacy asset is gated by Task 2B/2C.
- Keep one public MCP capability per immutable policy/effect. Progressive discovery carries resource-specific
  schemas; neither one tool per endpoint nor a module-level arbitrary-method dispatcher is allowed.
- Default read-only behavior, verified backup-before-write, pedagogical clarification, easy client setup, and
  evidence-backed claims are product properties, not documentation work deferred to release.

## Cross-plan checkpoints

- After foundation: deterministic tests and the six named applicable official 2025/2026 MCP protocol
  scenarios are green; this checkpoint makes no full-suite claim.
- After provenance Task 2A: the public inventory and synthetic private preflight are independently reviewed;
  no real private source has been opened. Clean-room product work may continue under its replacement plan, but
  copied installer, VM, test, or documentation assets remain blocked behind Task 2B/operator review/Task 2C.
- After each Product vertical: every operation actually exposed has its declared offline/mock/VM evidence;
  unavailable resources remain unavailable rather than becoming a parity or release blocker.
- Before release: every legacy asset actually reused has crossed its provenance gate; unsupported/unmigrated
  assets remain outside the package. Supported client smokes, stable MCP SDK repin, evidence-linked README,
  final provenance/legal review, the canonical benchmark, and finally native Windows evidence are green.

## Review discipline

Each implementation task follows red-green-refactor, receives a specification-conformance review and a code-
quality review, runs the plan's focused gate, and ends in an atomic local commit. The final release task
deliberately uses a clean tested-parent commit followed by one narrowly allow-listed evidence commit. A
failing baseline or gate stops that task; assertions, safety checks and evidence requirements are never
weakened to proceed.
