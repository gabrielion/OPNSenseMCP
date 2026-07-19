# Private Provenance Task 2A Plan Index

**Status:** Routing document; not directly executable

**Goal:** Complete the owner-approved private contract and accepted-context preflight through two bounded,
independently reviewed implementation plans without consulting real private inputs.

**Architecture:** Task 2A1 implements only public groups and the pure canonical baseline contract. Task 2A2
will implement the POSIX filesystem/Git/index/context/CLI boundary after 2A1 is accepted. Both consume the same
schema; neither prepares, activates, copies, scans, seals, or releases an owner asset.

## Normative Order

1. **Task 2A1 — pure baseline contract**
   - Plan: `docs/superpowers/plans/2026-07-19-private-provenance-baseline.md`
   - Public six-group map, strict canonical bytes, complete private state matrices, composition projection,
     deep freeze, and fixed sanitized parser failures.
   - Synthetic values only; no filesystem, environment, Git, subprocess, platform, or private input access.
2. **Task 2A2 — accepted-context preflight**
   - A separate implementation plan must be written and independently reviewed after 2A1 acceptance.
   - It will own absolute-path/layout checks, stable descriptors, physical Git corpus/ref/object fingerprints,
     structural similarity-index verification, purpose readiness, the sole three-variable loader, redacted CLI,
     bounded subprocesses, and private-tool Windows refusal.
3. **Task 2B — private preparation and activation**
   - Remains blocked behind complete Task 2A acceptance and its own owner-approved plan.
   - It owns bundle verification/materialization, credential scanning, similarity construction, bounded
     non-echoing operator input, baseline drafts, and exclusive environment-file creation.
4. **Task 2C — approved copy and verified rollback** and **Task 2D — scans/release projection**
   - Remain blocked behind their own specifications, plans, TDD gates, and independent reviews.

Task 2A is not complete until both 2A1 and 2A2 are implemented, independently reviewed, and green together.
No real bundle, old repository, owner worktree, baseline, environment file, VM, firewall, or user credential may
be read before that acceptance.

## Product Trajectory

Provenance is a migration boundary, not the product. In parallel with Task 2A, the replacement clean-room
Product plan may be written and reviewed. Once that Product plan is accepted, vertical OPNsense implementation
may proceed without legacy inputs; it does not wait for Task 2B, Guided/client/release planning, or migration.

The intended vertical order is:

1. useful read-only server: OPNsense connection, progressive discovery, mock proof, and one VM read;
2. centralized mutation envelope: `READ_ONLY`, scopes, audit, and fail-closed backup;
3. one backed-up mutation with VM readback and cleanup;
4. catalogue expansion and approved test migration only where the provenance gate is ready;
5. pedagogical workflows and client packaging on a stable surface;
6. native Windows evidence and the complete agentic benchmark before publication.

## Shared Non-Negotiable Boundaries

- Node.js `>=22.19 <23`; AGPL-3.0-or-later; no new dependency for Task 2A.
- The public manifest remains exactly 105 approved, 3 rewrite, and 8 discard rows and contains no private
  mapping, identity, rationale, review state, or source digest.
- One canonical private schema/parser is authoritative for every later private command.
- Accepted baseline authority is separately digest-bound before parsing and is never auto-approved or mutated.
- Private evidence never enters logs, reports, Git, packages, public manifest fields, or normal runtime.
- Private maintainer tooling is initially POSIX-only; the public verifier and shipped product remain Windows
  targets.
- All Task 2A tests use generated repositories, paths, identities, and content only.
- No push, package publication, release, benchmark claim, or real private checkpoint occurs in Task 2A.

## Task 2A Acceptance Gate

After both subplans are complete, run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run provenance:verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:conformance
git diff --check
```

Then obtain independent approval of schema/state coverage, digest-before-parse ordering, path/corpus security,
redaction, Windows wording, synthetic-only evidence, and the absence of approval manufacture. Task 2B stays
blocked until this combined review passes.
