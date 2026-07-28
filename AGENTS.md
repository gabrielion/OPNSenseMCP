# Repository agent rules

These instructions apply to the whole repository. They are deliberately concise; durable project state,
proof boundaries and the next-session prompt live in [`docs/project-status.md`](docs/project-status.md).
When prose conflicts with reachable code or a fresh executable gate, treat the code and gate as evidence,
then correct the prose.

## Start every task here

1. Read this file, [`docs/project-status.md`](docs/project-status.md) and the relevant specification or
   implementation plan in `docs/superpowers/`.
2. Inspect the branch, `HEAD`, upstream, worktree and `npm run evidence:verify` status before editing.
3. Read [`.superpowers/sdd/progress.md`](.superpowers/sdd/progress.md) for chronological context and known
   traps. Do not execute a plan marked `SUPERSEDED`, `BLOCKED` or `DO NOT EXECUTE`.
4. Check `docs/provenance/migration-manifest.json` before creating or restoring any listed destination.
5. State the narrow product claim or failing test the change is intended to establish.

Preserve unrelated user changes. Keep changes and commits local, atomic and reviewable. Do not silently
broaden the product surface, evidence claim or task scope.

## Environment and dependencies

- Use Node.js 22.19.0 or newer within major 22. On the current workstation prepend
  `/opt/homebrew/opt/node@22/bin` to `PATH`; never validate with the default Node 26.
- Install with `npm ci --ignore-scripts`.
- Do not add, update or execute dependency lifecycle scripts without an explicit reviewed need.
- Use repository scripts rather than inventing parallel build or test paths.

## Product truth and architecture

- OPNSenseMCP is read-only by default. The current default tools are `server_status`, `opn_describe`,
  `opn_get` and `opn_list`.
- The only current experimental mutations are `opn_create` and `opn_delete` for host entries of
  `firewall.alias`, behind the documented read-only, feature-flag, scope, transport, target and elicitation
  gates.
- Follow the reachable path from `src/main.ts` through application assembly, capability catalogue, MCP
  registration, dispatch and the OPNsense adapter. An internal handler call is not an end-to-end MCP proof.
- Keep authorization, confirmation, backup, audit intent, write, readback, cleanup and attestation as
  distinct claims. A success-shaped tool result is not proof that OPNsense changed.
- Capability modules, handlers, Zod schemas, refinements, transforms, and their captured callback state are
  trusted static startup code. Do not mutate a schema after `defineCapability()` and do not load third-party
  capability code in-process. A future untrusted extension boundary must use a validated declarative schema
  and process isolation; it must not accept executable Zod objects or callbacks.

## Firewall and credential safety

- Never develop or test against a production firewall. The only live development target is the owned,
  disposable local OPNsense VM.
- Never log, commit or pass credentials in process arguments. A low-value development password is still
  handled through hidden stdin/TTY input or a private mode-`0600` file.
- Keep TLS verification enabled. Keep raw firewall responses, configuration XML, private paths and private
  evaluation traces out of tracked artifacts.
- Live runners must own cleanup in `finally`, stop the VM and prove that owned residue is absent. Never
  synthesize, hand-edit or bypass live evidence.

## Testing and evidence

- Write the focused failing test before production implementation or bug-fix code, then make it pass.
- Match proof to claim: use unit tests for local contracts, installed-package/MCP tests for the public
  boundary, a synthetic target for deterministic HTTP behavior, and the disposable VM for real OPNsense
  configuration effects.
- For every mutation scenario, observe pre-state, call the installed MCP server, read post-state back
  through MCP, check the exact transition and clean up. A no-op response that looks successful must fail.
- DeepEval judges agent tool selection, trajectory, task completion and response quality. It never replaces
  deterministic OPNsense state-transition, policy, lifecycle or cleanup gates. Follow
  [`docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md`](docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md).
- Do not copy or restore provenance-controlled `tests/agentic/**` assets. Until the private provenance
  workflow authorizes them, new evaluation work is clean-room under `tests/evals/**` and `scripts/evals/**`.
- Keep live VM/model evaluations explicit and outside `npm run verify`; deterministic offline coverage may
  join the regular suite only when it is hermetic.

Before a final code or documentation commit, run with Node 22:

```text
npm run license:check
npm run verify
npm run test:conformance
git diff --check
```

Also run `npm run provenance:verify` when provenance or listed destinations are involved, and
`npm run evidence:check` plus `npm run evidence:verify` before publication.

The Product 3 VM attestation is commit-bound. Any non-evidence commit makes it stale. Publication therefore
uses this exact sequence:

1. commit a clean candidate;
2. run `npm run vm:product3 -- --attestation-out "$PWD/docs/evidence/product3-vm.json"` against that clean
   commit, supplying the password only through the hidden prompt;
3. inspect and commit only `docs/evidence/product3-vm.json`;
4. require `npm run evidence:verify` to return `0`;
5. push.

## Review and handoff

- Review every changed public claim against the code or producer that proves it.
- Before declaring completion, inspect the final diff, run the required gates from a fresh state and report
  exact outcomes. Do not use an earlier run as evidence for a later tree.
- Update [`docs/project-status.md`](docs/project-status.md) and the chronological ledger when milestone,
  branch, evidence, blocker or next-step truth changes.
- Leave enough context for a new agent with no conversation history: current state, decisions, non-claims,
  exact next gate, commands, files and unresolved choices. Do not rely on chat history as project memory.
