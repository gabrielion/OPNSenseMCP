# P0-B Truthful Public Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every statement this product makes about itself true — in its refusal messages, in its confirmation prompt, in its exposed surface, and in its documentation — and keep alias writes explicitly experimental until P0-C proves them durable.

**Architecture:** Eight independently reviewable slices, ordered so that the statements that are false *today* are corrected before any new gating is added. First the two lies (a refusal that promises a preserved backup that is deleted at shutdown, and a confirmation prompt that describes nothing), then the write containment the spec mandates (`experimental-alias-write` + non-empty allow-list), then the boundary's own integrity (validated scope tokens, a catalogued `server.status`, and `TARGET_UNAVAILABLE` instead of `UNKNOWN_CAPABILITY`), then truthful documentation, a real VM attestation, and finally the CI-gate scoping that keeps P0-C's commits from reddening public CI.

**Tech Stack:** Node.js 22 (>=22.19 <23), TypeScript 5.9 strict (`verbatimModuleSyntax`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Zod 4 (`zod/v4`), Vitest 4, MCP protocol eras `2025-11-25` and `2026-07-28`.

## Global Constraints

Copied verbatim from `AGENTS.md`, `CLAUDE.md` and `docs/superpowers/specs/2026-07-25-post-cutover-p0-hardening-design.md`:

- Node.js 22.19.0 or newer within major 22; prepend `/opt/homebrew/opt/node@22/bin` to PATH. Every command below assumes `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
- Install with `npm ci --ignore-scripts`.
- Never develop or test against a production firewall. Never log, commit, or pass credentials in process arguments.
- Before a final commit run `npm run license:check`, `npm run verify`, `npm run test:conformance`, and `git diff --check`.
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- "Capability modules, handlers, Zod schemas, refinements, transforms, and their captured callback state are trusted static startup code. Do not mutate a schema after `defineCapability()`."
- "Never weaken an assertion, ignore an exit code, reseal evidence without the real producer, or call a structural check an end-to-end proof."
- "No credential, raw backup XML, private archive path, private source mapping, or private digest enters a public file, log, MCP result, or process argument."
- "Preserve the centralized authorization, confirmation, backup, audit, revalidation, and verification order."
- "Complete P0-B without adding capabilities." (spec line 394) — no new resource or tool is introduced by this plan.
- Approved-asset reuse selection for P0-B: **none**. Every file below is a clean implementation with new tests.
- Each slice starts with a failing test, ends with focused and full gates, and is recorded in `.superpowers/sdd/progress.md` with its commit and remaining limitations.

## Established facts (measured 2026-07-25/26, not assumed)

| Fact | Location |
| --- | --- |
| `FeatureFlagSchema = z.enum(['advanced-api', 'restore', 'shell', 'ssh'])` — no `experimental-alias-write` | `src/config/feature-flags.ts:4` |
| Absent and empty `ALLOWED_RESOURCES` are indistinguishable: `CsvSchema` ends with `.filter(Boolean)`, and `length === 0 ? null` | `src/config/runtime-config.ts:9-18`, `:155-156` |
| `null` allow-list permits every scope for reads **and writes** alike; the helper has no effect parameter | `src/capabilities/exposure.ts:6` |
| Exposure order is transport → readOnly → flags → scopes | `src/capabilities/catalog.ts:19-31` |
| Write capabilities are registered **only** when `aliasAdapter.available`; no flag/readOnly test at construction | `src/capabilities/catalog.ts:79-84` |
| `opn_create` / `opn_delete` declare `requiredFeatureFlags: []` | `src/capabilities/opnsense/create.ts:57-71`, `delete.ts:45-56` |
| Authorization ladder is transport → readOnly → flags → scopes, then a post-resolution scope recheck | `src/capabilities/kernel.ts:1161-1220`, `:1299-1312` |
| The elicitation prompt is one fixed string for every write | `src/mcp/confirmation.ts:28` |
| `ConfirmationChallenge` is the only thing the MCP layer receives about the pending change | `src/capabilities/types.ts:106-111` |
| **The effect-plan digest is computed inside `executeMutationEnvelope` step 2 — i.e. AFTER confirmation** | `src/capabilities/kernel.ts:1566-1584` |
| At challenge creation the kernel already holds `mcpName`, `effectiveResourceScopes`, `transport`, `argumentsSha256` and the resolved input | `src/capabilities/kernel.ts:1933-1957` |
| `OUTCOME_INDETERMINATE` and `OUTCOME_UNVERIFIED` both assert "the pre-change backup is preserved", byte-identical in two tables | `src/capabilities/kernel.ts:145-148`, `src/mcp/results.ts:24-27` |
| The backup root is `mkdtempSync(join(tmpdir(), 'opnsense-mcp-backup-'))` and a shutdown closer `rmSync`s it recursively | `src/app/default-application.ts:94-126` |
| The audit sink is an in-memory ring with no persisted form | `src/capabilities/envelope/audit.ts:25-35`, `:64-69` |
| The `TARGET_UNAVAILABLE` branches in create/delete are unreachable when the adapter is unavailable, because the capability is never registered | `create.ts:89-95`, `delete.ts:74-80`, `catalog.ts:79-84` |
| `server.status` is declared only as a capability policy scope; it is absent from `OPERATION_DESCRIPTORS` | `src/capabilities/foundation/server-status.ts:27`, `src/operations/loader.ts:13-24` |
| The conformance gate already asserts `server.status` identity and its policy resource scope | `scripts/run-conformance.mjs:205,223` |
| `scripts/vm/product3-alias.mjs` has **no argument parsing**; it sets only `READ_ONLY='false'` and writes its JSON result to stdout | `product3-alias.mjs:116-123`, `:369-372`, `:379-383` |
| `docs/evidence/` does not exist; `docs/` contains only `provenance/` and `superpowers/` | filesystem |
| The sealed-digest pin runs inside `npm test`, hence inside `npm run verify` | `tests/integration/installed-package.test.ts:163-166`, `package.json:40-41` |
| README section map: 1 title, 10 What works now, 22 Quick local proof, 40 Connect your OPNsense instance, 72 Disposable OPNsense 26 proof, 94 OpenCode, 122 How this preview is tested, 140 Product roadmap, 156 License (161 lines total) | `README.md` |
| `package.json` carries `"private": true` | `package.json:9` |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/capabilities/kernel.ts` (modify) | Refusal message table; sealed change summary on the challenge; effect-aware scope authorization; known-but-absent capability routing. |
| `src/mcp/results.ts` (modify) | The mirrored refusal message table; render the sealed summary into MCP text. |
| `src/mcp/confirmation.ts` (modify) | Build the elicitation message from the sealed summary instead of a fixed string. |
| `src/capabilities/types.ts` (modify) | `ConfirmationChallenge.summary`, `ChangeSummary`, `summarizeChange` on the write definition. |
| `src/capabilities/exposure.ts` (modify) | Effect-aware allow-list decision: an absent allow-list authorizes reads only. |
| `src/capabilities/catalog.ts` (modify) | Register write capabilities unconditionally so their `TARGET_UNAVAILABLE` branch is reachable; keep them hidden by policy. |
| `src/config/feature-flags.ts` (modify) | Add the exact `experimental-alias-write` token. |
| `src/config/runtime-config.ts` (modify) | Validate every `ALLOWED_RESOURCES` token against a sealed scope vocabulary. |
| `src/capabilities/resource-scopes.ts` (create) | The single sealed vocabulary of legal resource scopes (descriptor keys + `server.status`). |
| `src/capabilities/opnsense/create.ts`, `delete.ts` (modify) | `requiredFeatureFlags: ['experimental-alias-write']` and a `summarizeChange` projection. |
| `scripts/vm/product3-alias.mjs` (modify) | `--attestation-out <absolute-path>`, the spec's exact policy environment, and the attestation document. |
| `scripts/vm/attestation.mjs` (create) | Attestation builder shared by producer and verifier; canonical versioned JSON. |
| `scripts/verify-vm-attestation.mjs` (create) | Public verifier: accepts the attestation for a later commit only when the diff contains nothing but that file. |
| `docs/evidence/product3-vm.json` (create, by the producer only) | The VM attestation. Never hand-written. |
| `README.md`, `CONTRIBUTING.md` (modify) | Truthful surface, configure flow, ACLs, transports, non-claims. |
| `vitest.config.ts`, `package.json` (modify) | Move the sealed-digest pin out of the per-commit gate into a release gate. |
| `.superpowers/sdd/progress.md` (modify) | Ledger entry after every atomic commit. |

---

### Task 1: Stop promising a backup that is deleted at shutdown

**Files:**
- Modify: `src/capabilities/kernel.ts:145-148`
- Modify: `src/mcp/results.ts:24-27`
- Test: `tests/capabilities/mutation-envelope.test.ts`, `tests/mcp/resource-results.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the corrected message constants, consumed verbatim by every later assertion.

- [ ] **Step 1: Write the failing test**

Add to `tests/mcp/resource-results.test.ts`:

```ts
  it('never claims a durable pre-change backup while the backup root is per-process', () => {
    const claims = Object.values(REFUSAL_MESSAGES).filter(
      (message) => /preserved|preserve/iu.test(message) || /backup/iu.test(message)
    );

    // src/app/default-application.ts creates the backup root with mkdtempSync and removes it in a
    // shutdown closer, so no message may tell an operator to consult it after the fact. P0-C makes
    // the store durable; until then the product must not claim it.
    expect(claims).toEqual([]);
  });
```

Export the table if it is not already exported: in `src/mcp/results.ts`, change `const REFUSAL_MESSAGES` to `export const REFUSAL_MESSAGES`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/mcp/resource-results.test.ts -t 'never claims a durable'`

Expected: FAIL, listing the two `OUTCOME_*` strings that mention a preserved backup.

- [ ] **Step 3: Correct both message tables**

In `src/mcp/results.ts` and `src/capabilities/kernel.ts`, replace the two byte-identical strings. The new text keeps every actionable instruction and drops only the unearned durability claim:

```ts
  OUTCOME_INDETERMINATE:
    'Capability outcome is indeterminate. Do not retry blindly: verify the current target state before any further change.',
  OUTCOME_UNVERIFIED:
    'Capability outcome could not be verified. Do not retry blindly: verify the current target state before any further change.',
```

Keep the two tables byte-identical to each other — a later step pins that.

- [ ] **Step 4: Pin the two tables against each other**

Add to `tests/mcp/resource-results.test.ts`:

```ts
  it('keeps the kernel and MCP refusal tables byte-identical', () => {
    expect(REFUSAL_MESSAGES).toEqual(KERNEL_REFUSAL_MESSAGES);
  });
```

Export the kernel table as `KERNEL_REFUSAL_MESSAGES` from `src/capabilities/kernel.ts` if it is not already exported, and import both in the test.

- [ ] **Step 5: Run the focused tests**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/mcp/resource-results.test.ts tests/capabilities/mutation-envelope.test.ts`

Expected: PASS. Any envelope test that asserted the old string must be updated to the new string — update the assertion text, never the assertion's meaning.

- [ ] **Step 6: Commit**

```bash
git add src/capabilities/kernel.ts src/mcp/results.ts tests/mcp/resource-results.test.ts tests/capabilities/mutation-envelope.test.ts
git commit -m "fix: stop promising a pre-change backup that shutdown deletes"
```

- [ ] **Step 7: Record the slice in `.superpowers/sdd/progress.md`** with the commit sha, the two corrected constants, and the note that P0-C restores a durability claim only once the state root is durable.

---

### Task 2: Make the human confirmation describe the change

**Files:**
- Modify: `src/capabilities/types.ts:106-111`
- Modify: `src/capabilities/kernel.ts:1933-1957`
- Modify: `src/mcp/confirmation.ts:28`, `:153-166`
- Modify: `src/capabilities/opnsense/create.ts`, `src/capabilities/opnsense/delete.ts`
- Test: `tests/mcp/elicitation.test.ts`, `tests/capabilities/write-resource-capability-definition.test.ts`

**Interfaces:**
- Consumes: Task 1's message table.
- Produces:

```ts
export interface ChangeSummary {
  readonly operation: string;   // 'create' | 'delete', sealed by the capability
  readonly resource: string;    // resource scope key, e.g. 'firewall.alias'
  readonly subject: string;     // bounded, sanitized identifier, e.g. the alias name
  readonly detail: string;      // bounded, sanitized qualifier, e.g. '3 entries'
}
export interface ConfirmationChallenge {
  readonly confirmationId: string;
  readonly expiresAt: string;
  readonly summary: ChangeSummary;   // NEW
}
```

Task 3 consumes neither; Task 6 documents the resulting prompt.

- [ ] **Step 1: Write the failing test**

Replace the fixed-message assertion at `tests/mcp/elicitation.test.ts:214-221` with:

```ts
  it('describes the exact pending change in the elicitation prompt', async () => {
    const { elicitations } = await runCreateConfirmation({
      resource: 'firewall.alias',
      name: 'blocked-hosts',
      content: ['192.0.2.10', '192.0.2.11'],
      description: 'lab'
    });

    expect(elicitations).toHaveLength(1);
    expect(elicitations[0]?.message).toBe(
      'Apply this exact OPNsense change? create firewall.alias "blocked-hosts" (2 entries)'
    );
  });

  it('bounds and sanitizes the described subject', async () => {
    const { elicitations } = await runCreateConfirmation({
      resource: 'firewall.alias',
      name: `evil ${'a'.repeat(200)}`,
      content: ['192.0.2.10'],
      description: ''
    });

    const message = elicitations[0]?.message ?? '';
    expect(message).not.toContain(' ');
    expect(message.length).toBeLessThanOrEqual(200);
    expect(message.startsWith('Apply this exact OPNsense change? create firewall.alias "evil')).toBe(
      true
    );
  });
```

`runCreateConfirmation` is a helper to add in the same file that drives a create call to the confirmation-required result and captures the elicitation payloads, reusing the file's existing client harness.

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/mcp/elicitation.test.ts`

Expected: FAIL — the prompt is still the fixed string `'Apply this exact OPNsense change?'`.

- [ ] **Step 3: Add the sealed summary type**

In `src/capabilities/types.ts`, add `ChangeSummary` as declared in Interfaces above, add `readonly summary: ChangeSummary` to `ConfirmationChallenge`, and add to the write-capability definition input:

```ts
  /**
   * Trusted static projection from the RESOLVED input to a bounded, human-meaningful description of
   * the pending change. It runs kernel-side before the challenge is issued; the kernel sanitizes and
   * bounds whatever it returns. It must never include a credential, a raw response, or a path.
   */
  readonly summarizeChange: (input: TInput) => Omit<ChangeSummary, 'resource'>;
```

- [ ] **Step 4: Seal the summary in the kernel**

In `src/capabilities/kernel.ts`, next to the challenge creation at `:1933-1957`, add and apply:

```ts
const SUMMARY_SUBJECT_LIMIT = 64;
const SUMMARY_DETAIL_LIMIT = 32;

/**
 * The capability supplies the words; the kernel decides what may cross the boundary. Control
 * characters are stripped and every field is length-bounded, so a hostile alias name cannot reshape
 * the prompt a human is about to approve.
 */
function sealedSummaryText(value: string, limit: number): string {
  const stripped = [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
  });
  return stripped.length <= limit
    ? stripped.join('')
    : `${stripped.slice(0, limit - 1).join('')}…`;
}

function sealedChangeSummary(
  projection: Omit<ChangeSummary, 'resource'>,
  resource: string
): ChangeSummary {
  return Object.freeze({
    operation: sealedSummaryText(projection.operation, SUMMARY_DETAIL_LIMIT),
    resource: sealedSummaryText(resource, SUMMARY_DETAIL_LIMIT),
    subject: sealedSummaryText(projection.subject, SUMMARY_SUBJECT_LIMIT),
    detail: sealedSummaryText(projection.detail, SUMMARY_DETAIL_LIMIT)
  });
}
```

Attach `summary: sealedChangeSummary(definition.summarizeChange(resolvedInput), effectiveResourceScopes[0] ?? '')` to the challenge. The resolved input and the effective scopes are already in scope at that site (`kernel.ts:1933-1957`).

- [ ] **Step 5: Render it in the elicitation message**

In `src/mcp/confirmation.ts`, replace the fixed constant at `:28` with a builder and use it at the message-build site (`:153-166`):

```ts
export function confirmationPrompt(summary: ChangeSummary): string {
  const detail = summary.detail === '' ? '' : ` (${summary.detail})`;
  return `Apply this exact OPNsense change? ${summary.operation} ${summary.resource} "${summary.subject}"${detail}`;
}
```

- [ ] **Step 6: Supply the projections**

In `src/capabilities/opnsense/create.ts`, inside the definition:

```ts
  summarizeChange: (input) => ({
    operation: 'create',
    subject: input.name,
    detail: `${String(input.content.length)} ${input.content.length === 1 ? 'entry' : 'entries'}`
  }),
```

In `src/capabilities/opnsense/delete.ts`:

```ts
  summarizeChange: (input) => ({
    operation: 'delete',
    subject: input.name,
    detail: `uuid ${input.id.slice(0, 8)}`
  }),
```

If the delete resolver's input carries only the UUID, use `subject: input.id` and `detail: ''` — do not invent a name the resolver has not read.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/mcp/elicitation.test.ts tests/capabilities/write-resource-capability-definition.test.ts tests/capabilities/mutation-envelope.test.ts`

Expected: PASS.

- [ ] **Step 8: Prove the sanitizer has teeth**

Temporarily remove the control-character filter from `sealedSummaryText`, re-run `npx vitest run tests/mcp/elicitation.test.ts -t 'bounds and sanitizes'` and confirm it FAILS, then restore the filter and confirm `git diff --stat src/capabilities/kernel.ts` shows only the intended change.

- [ ] **Step 9: Commit**

```bash
git add src/capabilities/types.ts src/capabilities/kernel.ts src/mcp/confirmation.ts \
  src/capabilities/opnsense/create.ts src/capabilities/opnsense/delete.ts tests/mcp/elicitation.test.ts
git commit -m "feat: describe the exact pending change in the write confirmation"
```

- [ ] **Step 10: Record the slice in the ledger**, noting that the effect-plan digest remains post-confirmation (`kernel.ts:1566`) and that the summary is a sealed projection, not that digest.

---

### Task 3: `experimental-alias-write` and a non-empty allow-list for every write

**Files:**
- Modify: `src/config/feature-flags.ts:4`
- Modify: `src/capabilities/exposure.ts`
- Modify: `src/capabilities/catalog.ts:19-31`
- Modify: `src/capabilities/kernel.ts:1190-1220`
- Modify: `src/capabilities/opnsense/create.ts:57-71`, `delete.ts:45-56`
- Test: `tests/config/runtime-config.test.ts`, `tests/capabilities/catalog.test.ts`, `tests/capabilities/dispatch.test.ts`, `tests/security/resource-policy-kernel.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `areResourceScopesAllowedForEffect(scopes, allowed, effect)` in `src/capabilities/exposure.ts`, consumed by both `catalog.ts` and `kernel.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/capabilities/catalog.test.ts`:

```ts
  it('authorizes every read but no write when the allow-list is absent', () => {
    const exposed = CAPABILITY_CATALOG.listExposed({
      readOnly: false,
      transport: 'stdio',
      enabledFeatureFlags: new Set(['experimental-alias-write']),
      allowedResourceScopes: null
    });

    expect(exposed.map(({ mcpName }) => mcpName)).toEqual([
      'server_status',
      'opn_describe',
      'opn_get',
      'opn_list'
    ]);
  });

  it('exposes alias writes only with the flag and an explicit firewall.alias scope', () => {
    const withoutFlag = CAPABILITY_CATALOG.listExposed({
      readOnly: false,
      transport: 'stdio',
      enabledFeatureFlags: new Set(),
      allowedResourceScopes: new Set(['firewall.alias'])
    });
    const withBoth = CAPABILITY_CATALOG.listExposed({
      readOnly: false,
      transport: 'stdio',
      enabledFeatureFlags: new Set(['experimental-alias-write']),
      allowedResourceScopes: new Set(['firewall.alias'])
    });

    expect(withoutFlag.map(({ mcpName }) => mcpName)).not.toContain('opn_create');
    expect(withBoth.map(({ mcpName }) => mcpName)).toContain('opn_create');
    expect(withBoth.map(({ mcpName }) => mcpName)).toContain('opn_delete');
  });
```

Add the dispatch mirror to `tests/capabilities/dispatch.test.ts`: a direct `opn_create` call with `allowedResourceScopes: null` and the flag enabled must refuse with `RESOURCE_NOT_ALLOWED`, proving listing and dispatch agree.

Add to `tests/config/runtime-config.test.ts`:

```ts
  it('accepts the exact experimental alias write flag token', () => {
    const config = loadRuntimeConfig({
      READ_ONLY: 'false',
      ENABLED_FEATURE_FLAGS: 'experimental-alias-write',
      ALLOWED_RESOURCES: 'firewall.alias'
    });

    expect(config.enabledFeatureFlags.has('experimental-alias-write')).toBe(true);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/capabilities/catalog.test.ts tests/config/runtime-config.test.ts tests/capabilities/dispatch.test.ts`

Expected: FAIL — the flag token is unknown, and writes are currently exposed with a `null` allow-list.

- [ ] **Step 3: Add the flag token**

`src/config/feature-flags.ts`:

```ts
export const FeatureFlagSchema = z.enum([
  'advanced-api',
  'experimental-alias-write',
  'restore',
  'shell',
  'ssh'
]);
```

- [ ] **Step 4: Make the allow-list decision effect-aware**

Replace `src/capabilities/exposure.ts` with:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export function areDeclaredResourceScopesAllowed(
  scopes: readonly string[],
  allowed: ReadonlySet<string> | null
): boolean {
  return allowed === null || (scopes.length > 0 && scopes.every((scope) => allowed.has(scope)));
}

/**
 * An absent allow-list means "every catalogued scope" for reads, and "no scope at all" for every
 * non-read effect: a write must always be authorized by an explicit, named scope.
 */
export function areResourceScopesAllowedForEffect(
  scopes: readonly string[],
  allowed: ReadonlySet<string> | null,
  effect: string
): boolean {
  if (effect !== 'read' && allowed === null) return false;
  return areDeclaredResourceScopesAllowed(scopes, allowed);
}
```

Apply the same rule to the selectable-scope branch of `hasVisibleResourceScopes` (`kernel.ts:1144-1159`): when `effect !== 'read'` and `allowedResourceScopes === null`, return `false`.

- [ ] **Step 5: Enforce it identically in dispatch**

In `authorizeRequest` (`kernel.ts:1190-1220`) and in the post-resolution recheck (`:1299-1312`), use `areResourceScopesAllowedForEffect(..., capability.policy.effect)`. The refusal code for a non-read effect with an absent allow-list is `RESOURCE_NOT_ALLOWED`, emitted in the same rung as today so the ladder order is unchanged.

- [ ] **Step 6: Require the flag on both write capabilities**

In `src/capabilities/opnsense/create.ts:57-71` and `delete.ts:45-56`, change `requiredFeatureFlags: []` to `requiredFeatureFlags: ['experimental-alias-write']`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npx vitest run tests/capabilities tests/config tests/security`

Expected: PASS. Update the Product 3 runner's environment in the same commit (`scripts/vm/product3-alias.mjs:116-123`) to set `READ_ONLY: 'false'`, `ENABLED_FEATURE_FLAGS: 'experimental-alias-write'`, and `ALLOWED_RESOURCES: 'server.status,system.status,core.services,firewall.alias'`.

> **Deviation from the spec, recorded deliberately.** Spec line 184 gives the literal value
> `system.status,core.services,firewall.alias`. That value hides `server_status`, because
> `server_status` declares the scope `server.status` (`src/capabilities/foundation/server-status.ts:27`)
> and the allow-list requires every declared scope to be present. The runner asserts a six-tool surface
> (`product3-alias.mjs:20-27`), so the literal value breaks it. Task 4 catalogues `server.status`; this
> plan therefore uses the four-token value and documents the deviation in the ledger and in the spec's
> margin.

- [ ] **Step 8: Commit**

```bash
git add src/config/feature-flags.ts src/capabilities/exposure.ts src/capabilities/catalog.ts \
  src/capabilities/kernel.ts src/capabilities/opnsense/create.ts src/capabilities/opnsense/delete.ts \
  scripts/vm/product3-alias.mjs tests/
git commit -m "feat: gate alias writes behind experimental-alias-write and an explicit scope"
```

- [ ] **Step 9: Record the slice in the ledger**, including the exact deviation from spec line 184 and why.

---

### Task 4: A validated scope vocabulary, with `server.status` in it

**Files:**
- Create: `src/capabilities/resource-scopes.ts`
- Modify: `src/config/runtime-config.ts:107-115`
- Modify: `src/operations/operation-contract.v1.json` **or** `src/capabilities/resource-scopes.ts` (see Step 3)
- Test: `tests/config/runtime-config.test.ts`, `tests/capabilities/catalog.test.ts`

**Interfaces:**
- Consumes: Task 3's flag validation pattern.
- Produces: `KNOWN_RESOURCE_SCOPES: ReadonlySet<string>` used by `runtime-config.ts`.

- [ ] **Step 1: Write the failing test**

```ts
  it('rejects an unknown resource scope instead of silently hiding a tool', () => {
    expect(() =>
      loadRuntimeConfig({ READ_ONLY: 'true', ALLOWED_RESOURCES: 'system.staus' })
    ).toThrow(/Invalid runtime configuration: ALLOWED_RESOURCES/u);
  });

  it('accepts every catalogued scope including the server health scope', () => {
    const config = loadRuntimeConfig({
      READ_ONLY: 'true',
      ALLOWED_RESOURCES: 'server.status,system.status,core.services,firewall.alias'
    });

    expect(config.allowedResourceScopes).toEqual(
      new Set(['server.status', 'system.status', 'core.services', 'firewall.alias'])
    );
  });
```

- [ ] **Step 2: Run it to verify it fails**

Expected: the typo test fails — `system.staus` is accepted today and silently removes `opn_get` from the surface.

- [ ] **Step 3: Create the sealed vocabulary**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { OPERATION_DESCRIPTORS } from '../operations/loader.js';

/**
 * `server.status` is a server-health scope, not an OPNsense resource, so it has no operation
 * descriptor; it is nonetheless a legal ALLOWED_RESOURCES token because `server_status` declares it.
 */
export const SERVER_HEALTH_SCOPE = 'server.status';

export const KNOWN_RESOURCE_SCOPES: ReadonlySet<string> = Object.freeze(
  new Set<string>([SERVER_HEALTH_SCOPE, ...OPERATION_DESCRIPTORS.map((descriptor) => descriptor.key)])
);
```

- [ ] **Step 4: Validate the tokens**

In `src/config/runtime-config.ts`, add a sibling to the existing unknown-flag loop at `:107-115`:

```ts
    for (const scope of value.ALLOWED_RESOURCES) {
      if (!KNOWN_RESOURCE_SCOPES.has(scope)) {
        context.addIssue({
          code: 'custom',
          message: 'unknown resource scope',
          path: ['ALLOWED_RESOURCES']
        });
      }
    }
```

- [ ] **Step 5: Prove listing and the vocabulary agree**

Add to `tests/capabilities/catalog.test.ts` a test asserting that every scope declared by any capability policy (`policy.resourceScopes` and every selectable scope) is a member of `KNOWN_RESOURCE_SCOPES`. This is the assertion that would have caught `server.status` being uncatalogued.

- [ ] **Step 6: Run the focused gates, then commit**

```bash
git add src/capabilities/resource-scopes.ts src/config/runtime-config.ts tests/
git commit -m "fix: validate resource-scope tokens so a typo cannot hide a tool"
```

- [ ] **Step 7: Record the slice in the ledger.**

---

### Task 5: `TARGET_UNAVAILABLE` instead of `UNKNOWN_CAPABILITY`

**Files:**
- Modify: `src/capabilities/catalog.ts:69-88`
- Modify: `src/capabilities/kernel.ts:1161-1189`, `:1774-1790`
- Test: `tests/capabilities/dispatch.test.ts`, `tests/app/default-application.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('tells a client the target is unconfigured rather than that the tool does not exist', async () => {
    const dispatcher = createDispatcherWithoutTarget();

    const result = await dispatcher.dispatch(
      { name: 'opn_create', arguments: { resource: 'firewall.alias', name: 'a', content: ['192.0.2.1'] } },
      stdioContext
    );

    expect(result).toMatchObject({ kind: 'refused', code: 'TARGET_UNAVAILABLE' });
  });

  it('still refuses a forged tool name as unknown', async () => {
    const dispatcher = createDispatcherWithoutTarget();

    const result = await dispatcher.dispatch({ name: 'opn_wipe', arguments: {} }, stdioContext);

    expect(result).toMatchObject({ kind: 'refused', code: 'UNKNOWN_CAPABILITY' });
  });
```

- [ ] **Step 2: Run to verify it fails** — today the first test yields `UNKNOWN_CAPABILITY`.

- [ ] **Step 3: Give the catalogue a sealed product vocabulary**

In `src/capabilities/catalog.ts`, export the full set of product tool names independently of registration:

```ts
export const PRODUCT_MCP_NAMES: ReadonlySet<string> = Object.freeze(
  new Set(['server_status', 'opn_describe', 'opn_get', 'opn_list', 'opn_create', 'opn_delete'])
);
```

- [ ] **Step 4: Route known-but-absent names**

In `authorizeRequest` (`kernel.ts:1171-1174`), when `catalog.getByMcpName` yields nothing:

```ts
  if (capability === undefined) {
    // A catalogued product tool that is not registered means its adapter has no configured target;
    // a name outside the product vocabulary is genuinely unknown.
    return {
      kind: 'refused',
      result: refusal(PRODUCT_MCP_NAMES.has(request.name) ? 'TARGET_UNAVAILABLE' : 'UNKNOWN_CAPABILITY')
    };
  }
```

Keep the registration gate at `catalog.ts:79-84` unchanged, so the mutation-envelope guard at `kernel.ts:1774-1790` still refuses to expose a write without envelope services.

- [ ] **Step 5: Run the tests, then the focused gates, then commit**

```bash
git add src/capabilities/catalog.ts src/capabilities/kernel.ts tests/
git commit -m "fix: distinguish an unconfigured target from an unknown tool"
```

- [ ] **Step 6: Record the slice in the ledger.**

---

### Task 6: Documentation that matches the live catalogue

**Files:**
- Modify: `README.md` (sections at lines 1-20, 40-70, 122-154)
- Modify: `CONTRIBUTING.md:28-53`
- Test: `tests/foundation/documentation.test.ts`

- [ ] **Step 1: Write the failing test**

Extend `tests/foundation/documentation.test.ts` so the README is checked against the *live* catalogue rather than against hard-coded strings:

```ts
  it('documents exactly the tools the catalogue exposes by default', async () => {
    const readme = await readFile('README.md', 'utf8');
    const defaultTools = CAPABILITY_CATALOG.listExposed({
      readOnly: true,
      transport: 'stdio',
      enabledFeatureFlags: new Set(),
      allowedResourceScopes: null
    }).map(({ mcpName }) => mcpName);

    for (const tool of defaultTools) expect(readme).toContain(`\`${tool}\``);
    expect(readme).toContain('`experimental-alias-write`');
    expect(readme).toContain('opnsense-mcp configure');
    expect(readme).not.toContain('No mutation tool is registered');
  });
```

- [ ] **Step 2: Run it to verify it fails** — `README.md:19` still contains `No mutation tool is registered`.

- [ ] **Step 3: Rewrite the affected README sections**

Content requirements, each traceable to the spec's documentation list (spec lines 189-196):

1. **What works now (lines 10-20):** the four default tools; that `opn_list` pages `core.services` **and** `firewall.alias`; that `opn_create`/`opn_delete` exist but are hidden unless `READ_ONLY=false`, `ENABLED_FEATURE_FLAGS` contains `experimental-alias-write`, and `ALLOWED_RESOURCES` names `firewall.alias`; that writes are experimental and their local backup/audit are **not yet durable across restarts** (P0-C).
2. **Connect your OPNsense instance (lines 40-70):** document `opnsense-mcp configure` first, its refusal on Windows and with any argument, the private-file rules (`0700` directory, `0600` file, no symlink, no foreign owner), and the auto-discovered default config path; keep the hand-written file as the alternative.
3. **Transports:** stdio is the default; Streamable HTTP exists with its bounded status; legacy SSE never exposes elicitation-backed writes.
4. **ACLs:** the exact proven privileges, quoted from `scripts/vm/product1b-bootstrap.mjs:7-22` — read-only: `page-system-status`, `page-status-services`, `user-config-readonly`; alias-write: `page-system-status`, `page-status-services`, `page-diagnostics-configurationhistory`, `page-firewall-alias-edit`, with the note that `user-config-readonly` is deliberately absent because it rejects mutable model saves.
5. **How this preview is tested (lines 122-138):** the firmware, host, client and lifecycle scenarios actually exercised, including the Product 3 alias lifecycle.
6. **Non-claims:** raw API dispatch, free-form shell/SSH, bulk IaC, restore, dashboard and broad legacy parity are absent; and `"private": true` means the package is not published — installation today is from a local tarball.

- [ ] **Step 4: Update `CONTRIBUTING.md:28-53`** to list `npm run vm:product3` alongside the Product 1B commands, and the gates that actually exist in `package.json:27-58`.

- [ ] **Step 5: Run the tests, the full format/lint gates, then commit**

```bash
git add README.md CONTRIBUTING.md tests/foundation/documentation.test.ts
git commit -m "docs: state the exact surface, configure flow, ACLs and non-claims"
```

- [ ] **Step 6: Record the slice in the ledger.**

---

### Task 7: A real, commit-bound VM attestation

**Files:**
- Create: `scripts/vm/attestation.mjs`
- Create: `scripts/verify-vm-attestation.mjs`
- Modify: `scripts/vm/product3-alias.mjs`
- Modify: `package.json` (add `evidence:verify`)
- Test: `tests/vm/product3-alias.test.mjs`, `tests/foundation/documentation.test.ts`

**Interfaces:**

```ts
export function buildVmAttestation(input: {
  readonly schemaVersion: 2;
  readonly commit: string; readonly tree: string;
  readonly node: string; readonly host: string;
  readonly protocolVersion: string; readonly clientVersion: string;
  readonly image: { readonly release: string; readonly sha256: string };
  readonly scenario: { readonly readOnly: boolean; readonly flags: readonly string[]; readonly scopes: readonly string[] };
  readonly checks: Readonly<Record<string, boolean>>;
}): object;
```

- [ ] **Step 1: Write the failing test** in `tests/vm/product3-alias.test.mjs`: the runner must reject a dirty tree, must require `--attestation-out` to be absolute, and must write the attestation only after the lifecycle, cleanup and residue checks all pass. Assert that the produced document contains no `/Users/`, no `/home/`, no credential sentinel, and no state path.

- [ ] **Step 2: Run it to verify it fails** — `product3-alias.mjs` has no argument parsing at all (`:379-383`).

- [ ] **Step 3: Implement `scripts/vm/attestation.mjs`** as a pure builder producing canonical, key-sorted JSON with a fixed schema version, and nothing else.

- [ ] **Step 4: Wire `--attestation-out <absolute-path>` into `product3-alias.mjs`**, refusing a relative path, refusing a dirty starting tree (`git status --porcelain=v1` must be empty), capturing the tested commit and tree, and writing atomically (temporary file + rename) only after every fixed check is true.

- [ ] **Step 5: Implement `scripts/verify-vm-attestation.mjs`**: it accepts the attestation for a later commit **only** when `git diff --name-only <tested-commit>..HEAD` contains nothing except `docs/evidence/product3-vm.json`. Exit `0` when coherent, `2` when the attestation is stale, `1` when unreadable.

- [ ] **Step 6: Run the producer against the disposable VM** (`npm run vm:product3 -- --attestation-out "$PWD/docs/evidence/product3-vm.json"`). If the VM is unavailable, STOP: do not synthesize the file, record the blockage in the ledger, and leave the remaining P0-B slices committed without it.

- [ ] **Step 7: Commit the evidence separately from the tested commit**, as the spec requires (lines 205-209), then record the slice in the ledger.

---

### Task 8: Keep the sealed-digest pin out of the per-commit gate

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `tests/integration/installed-package.test.ts:163-166`
- Test: `tests/foundation/package-contract.test.ts`

- [ ] **Step 1: Write the failing test** in `tests/foundation/package-contract.test.ts`: assert that `npm run verify` does **not** include the sealed-evidence project, and that a distinct `npm run evidence:check` does.

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Split the project.** Move the sealed-digest assertion into its own vitest project (`evidence`), excluded from the default run, and add `"evidence:check": "vitest run --project evidence"` to `package.json`. Keep every other assertion of `installed-package.test.ts` in the per-commit gate: the pin is what moves, not the installation proof.

- [ ] **Step 4: Add `npm run evidence:check` to the release gate** documented in `CONTRIBUTING.md`, and state in the test's comment that the evidence is re-sealed by its real producer whenever the packaged content changes.

- [ ] **Step 5: Run the full gates, commit, and record the slice.**

---

### Task 9: P0-B exit gate

- [ ] **Step 1:** `export PATH=/opt/homebrew/opt/node@22/bin:$PATH && npm run license:check && npm run verify && npm run test:conformance && npm run evidence:check`
- [ ] **Step 2:** Prove the spec's exit-gate list (spec lines 215-224) item by item, recording the command and its output for each: docs/catalogue/`tools/list`/dispatch agree; without a target exactly four read tools are listed and `opn_get`/`opn_list` refuse with `TARGET_UNAVAILABLE` **without network I/O**; with a configured disposable target and `READ_ONLY=true` all four reads succeed with bounded results; writes stay hidden or refused unless every experimental condition holds; a missing or empty write scope fails closed; package operation requires no private asset; public files contain no private path, mapping, credential or unsupported release claim.
- [ ] **Step 3:** Remove the two real developer absolute paths from `docs/superpowers/plans/2026-07-19-private-provenance-baseline.md:20,22` (they also leak a private working-copy name and branch), and grep the whole public tree again for `/Users/`, `/home/`, `/private/`, `/var/folders/`.
- [ ] **Step 4:** Dispatch an adversarial review of `git diff <p0-b-base>..HEAD` against the spec's P0-B section, with one verifier per finding, exactly as P0-A did. Act on the findings through `superpowers:receiving-code-review`.
- [ ] **Step 5:** Push, watch the public CI run to completion, and record the observed result — green or red — in the ledger before declaring the increment closed.

## Self-Review

**Spec coverage (P0-B section, lines 161-224):**

| Spec requirement | Task |
| --- | --- |
| Exact flag token `experimental-alias-write` | 3 |
| Writes require `READ_ONLY=false` + flag + non-empty `ALLOWED_RESOURCES` containing `firewall.alias` + stdio/HTTP | 3 |
| Absent/empty allow-list = all reads, zero non-read effects | 3 |
| Listing and dispatch enforce identical conditions in the same order | 3 |
| Legacy SSE omits elicitation-backed writes; stdio/HTTP list statically; `CONFIRMATION_UNAVAILABLE` before challenge or write | already true (`legacy-sse.ts:132-135`, `confirmation.ts:141-143`) — pinned by the Task 3 dispatch mirror test |
| Product 3 runner uses the exact policy environment | 3 (with the recorded four-token deviation) |
| README/operator doc: exact tools, configure flow, ACLs, transports, tested scenarios, non-claims | 6 |
| `--attestation-out` producer, refusing a dirty tree, atomic, no secrets | 7 |
| Evidence committed separately; verifier accepts a later commit only with no other change | 7 |
| Remove stale private absolute paths | 9 Step 3 |
| Exit gate items | 9 Step 2 |

**Additions beyond the spec, each justified:** Task 1 (a message that is false today), Task 2 (the human gate is blind), Task 4 (the boundary rests on an unvalidated list), Task 5 (an unconfigured target is indistinguishable from a typo), Task 8 (otherwise P0-C reddens public CI on every commit).

**Placeholder scan:** every code step carries real code; Task 6 and Task 7 give content requirements with exact source references rather than pasted prose, because the README rewrite and the attestation document are authored against files the executor will read in the same task.

**Type consistency:** `ChangeSummary` is declared once in `types.ts` and consumed by `kernel.ts`, `confirmation.ts` and both write capabilities. `areResourceScopesAllowedForEffect` has one signature, used by `catalog.ts` and `kernel.ts`. `KNOWN_RESOURCE_SCOPES` is consumed only by `runtime-config.ts` and the catalogue agreement test. `PRODUCT_MCP_NAMES` is consumed only by `kernel.ts`.

## Out of scope

P0-C (durable state root, inter-process lock, durable backup/audit, reconciliation, indeterminate-write classification, alias syntax and pagination) gets its own plan, written after this increment is green. The ergonomics items surfaced by the assessment — `INVALID_INPUT` without field names, mandatory `page`/`pageSize`/`query`, `opn_describe` truncating at five with no `total`, and the absent `.describe()` texts — are recorded in the ledger as a post-P0 ergonomics slice, not smuggled into P0-B.
