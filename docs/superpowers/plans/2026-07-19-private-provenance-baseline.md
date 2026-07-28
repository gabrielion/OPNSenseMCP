# Private Provenance Pure Baseline Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Implement Task 2A1: the immutable public migration groups and one pure, canonical, fail-closed parser
for the private provenance baseline, using synthetic values only.

**Architecture:** `private-baseline.mjs` is the only public facade and has exactly three exports. Focused
internal modules own sanitized failures, copied/strict JSON bytes, structural projection, scalar metadata, and
asset state matrices; none can observe external state. Test fixtures independently repeat the public
destination-to-group mapping and expected digest projections.

**Tech Stack:** Node.js `>=22.19 <23`, JavaScript ESM (`.mjs`), built-in `node:crypto` and `TextDecoder`, Vitest
4, Prettier, ESLint, AGPL-3.0-or-later.

## Global Constraints

- Work only in the assigned isolated workspace and branch; preserve unrelated changes.
- Do not read the owner bundle, old repository, owner worktree, baseline, environment file, VM, firewall,
  credential, or any other working copy.
- Use only synthetic identities, paths, digests, byte counts, and contents generated in tests.
- Task 2A1 performs no filesystem, environment, Git, subprocess, platform, clock, network, preparation,
  activation, copying, scanning, sealing, or release operation.
- Add no dependency. All new provenance tests and fixtures use `.mjs`; Vitest already includes
  `tests/**/*.test.{ts,mjs}`.
- Every new source/test file begins with `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Canonical input is a copied `Buffer` or `Uint8Array`: strict UTF-8 JSON, no BOM, two-space indentation,
  prescribed positional key order, public inventory row order, and exactly one terminal LF; maximum
  `2 * 1024 * 1024` bytes.
- Every failure is a sanitized `PrivateProvenanceFailure` whose `name`, `code`, and `message` are
  `PrivateProvenanceFailure`, `PRIVATE_BASELINE_INVALID`, and `PRIVATE_BASELINE_INVALID`; it has no `cause` and
  never includes a rejected value.
- `scripts/provenance/private-baseline.mjs` exports exactly `parsePrivateBaseline`,
  `canonicalPrivateBaseline`, and `privateCompositionProjection`.
- The public manifest stays exactly 105 approved, 3 rewrite, and 8 discard rows, with no new public field.
- The six immutable group counts are exactly `11/16/25/28/10/15`; private data cannot reassign membership.
- Every task follows RED, focused GREEN, license and diff checks, then a local task commit. Only the final
  combined reviewed HEAD runs and claims `verify` plus both conformance profiles.
- Do not push, publish, tag, open real private inputs, or start Product/Guided implementation in this plan.

## File Map

The exact complete RED test files that are too large to repeat inline live in
`docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md`. That companion is part of
this executable plan, not optional background. Copy only the appendix named by each step and do not replace
it with a prose approximation.

- Create `scripts/provenance/groups.mjs`: public group names, member arrays, lookup, and load-time inventory
  proof.
- Create `scripts/provenance/private-error.mjs`: sole sanitized typed failure.
- Create `scripts/provenance/private-json.mjs`: copied/strict input, canonical bytes, positional keys, scalar
  predicates, and deep freeze.
- Create `scripts/provenance/private-baseline-shape.mjs`: fresh normative-order full-baseline and composition
  projections.
- Create `scripts/provenance/private-baseline-values.mjs`: live public-contract, evidence, policy, review,
  mapping, path, and scalar validation.
- Create `scripts/provenance/private-baseline-assets.mjs`: approved/rewrite/discard matrices, aggregate bound,
  exact groups, and reviewer independence.
- Create `scripts/provenance/private-baseline.mjs`: exact three-export facade and both digest bindings.
- Create `tests/provenance/fixtures/expected-migration-groups.mjs`: test-owned exact 105-pair oracle.
- Create `tests/provenance/fixtures/private-baseline-fixture.mjs`: independent synthetic baseline and digest
  projections.
- Create `tests/provenance/private-groups.test.mjs`, `private-baseline-bytes.test.mjs`,
  `private-baseline-metadata.test.mjs`, `private-baseline-assets.test.mjs`, and
  `private-baseline.test.mjs`.
- Verify `tests/foundation/documentation.test.ts`: preserve the committed bounded-provenance and product-routing
  regression lock.

---

### Task 1: Lock Routing and Exact Public Group Membership

**Files:**

- Tracked prerequisite: `docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md`
- Tracked superseded input: `docs/superpowers/plans/2026-07-17-opnsense-product-parity.md`
- Tracked mandatory companion: `docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md`
- Create: `scripts/provenance/groups.mjs`
- Create: `tests/provenance/fixtures/expected-migration-groups.mjs`
- Create: `tests/provenance/private-groups.test.mjs`
- Verify: `tests/foundation/documentation.test.ts`

**Interfaces:**

- Consumes `MIGRATION_INVENTORY` from `scripts/provenance/inventory.mjs`.
- Produces deeply frozen `MIGRATION_GROUP_NAMES`, `MIGRATION_GROUPS`,
  `MIGRATION_GROUP_BY_DESTINATION`, and `migrationGroupFor(destination)`. The lookup has exactly the 105
  approved destinations; unknown/rewrite/discard values make `migrationGroupFor` throw `Invalid migration
  group destination`.

- [ ] **Step 1: Verify the committed routing regression test**

Before editing the test, prove that both plan inputs are present in the clean checkout:

```bash
git ls-files --error-unmatch \
  docs/superpowers/plans/2026-07-17-opnsense-product-parity.md \
  docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md
```

Expected: both exact paths are printed and the command exits zero.

The current repository already contains the exact test below inside the foundation documentation `describe`.
Confirm it is present once and unchanged; do not add a duplicate. If it is missing, stop because the reviewed
plan prerequisite has drifted:

```ts
it('routes bounded provenance independently from vertical product delivery', async () => {
  const [index, task2Index, baselinePlan, historical, productRouting] = await Promise.all([
    readFile('docs/superpowers/plans/2026-07-17-rebuild-plan-index.md', 'utf8'),
    readFile('docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md', 'utf8'),
    readFile('docs/superpowers/plans/2026-07-19-private-provenance-baseline.md', 'utf8'),
    readFile(
      'docs/superpowers/plans/2026-07-17-provenance-test-infrastructure-migration.md',
      'utf8'
    ),
    readFile('docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md', 'utf8')
  ]);
  expect(task2Index).toContain('**Status:** Routing document; not directly executable');
  expect(task2Index).toContain('Task 2A1 — pure baseline contract');
  expect(task2Index).toContain('Task 2A2 — accepted-context preflight');
  expect(task2Index).toContain('2026-07-19-private-provenance-baseline.md');
  expect(baselinePlan).toContain('Task 2A1');
  expect(historical).toContain('must not execute as written');
  expect(historical).toContain('Historical Task 11');
  expect(productRouting).toContain('**Status:** Routing document; not directly executable');
  expect(productRouting).toContain('Product 1A — First useful read-only vertical');
  expect(productRouting).toContain('Product 1B — Disposable-VM read and contributor path');
  expect(productRouting).toContain('GET /api/core/system/status');
  expect(productRouting).toContain('POST /api/core/service/search');
  expect(index).toContain('2026-07-19-opnsense-product-verticals.md');
  for (const milestone of [
    'Useful read-only server',
    'Central mutation envelope',
    'One verified mutation',
    'Independent use-case verticals',
    'Clients and pedagogy',
    'Pre-publication proof'
  ])
    expect(index).toContain(milestone);
  for (const focusRule of [
    'one user-visible demonstration',
    'New clean-room product code and new tests do not wait for private provenance',
    'one public MCP capability per immutable policy/effect'
  ])
    expect(index).toContain(focusRule);
  expect(index).toContain('clean-room product');
  expect(index).toContain('without legacy inputs');
});
```

- [ ] **Step 2: Run the routing test**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run tests/foundation/documentation.test.ts
```

Expected: PASS because this plan versions the already owner-approved routing. Record it as a regression lock;
do not manufacture RED by undoing approved documentation.

- [ ] **Step 3: Add the independent group oracle and failing group tests**

Create the fixture with the complete code from Appendix A, then create:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_GROUP_BY_DESTINATION,
  MIGRATION_GROUP_NAMES,
  MIGRATION_GROUPS,
  migrationGroupFor
} from '../../scripts/provenance/groups.mjs';
import { MIGRATION_INVENTORY } from '../../scripts/provenance/inventory.mjs';
import { EXPECTED_MIGRATION_GROUP_PAIRS } from './fixtures/expected-migration-groups.mjs';

describe('public migration groups', () => {
  it('locks all 105 exact destination-to-group assignments', () => {
    expect(Object.entries(MIGRATION_GROUP_BY_DESTINATION)).toEqual(EXPECTED_MIGRATION_GROUP_PAIRS);
    expect(MIGRATION_GROUP_NAMES).toEqual([
      'installer-plugin',
      'recent-docs',
      'vm-onboarding',
      'agentic',
      'security-backup',
      'other-tests'
    ]);
    expect(MIGRATION_GROUP_NAMES.map((name) => MIGRATION_GROUPS[name].length)).toEqual([
      11, 16, 25, 28, 10, 15
    ]);
    const approved = MIGRATION_INVENTORY.filter((row) => row.class === 'approved').map(
      (row) => row.destination
    );
    expect(EXPECTED_MIGRATION_GROUP_PAIRS.map(([destination]) => destination)).toEqual(approved);
    expect(
      createHash('sha256')
        .update(
          `${JSON.stringify(
            EXPECTED_MIGRATION_GROUP_PAIRS.map(([destination, group]) => ({
              group,
              destination
            })),
            null,
            2
          )}\n`
        )
        .digest('hex')
    ).toBe('3aa17892ab9aba539766b3b86ed2de0511a0699fe595c5145be5814629cd1994');
    for (const [destination, group] of EXPECTED_MIGRATION_GROUP_PAIRS)
      expect(migrationGroupFor(destination)).toBe(group);
    for (const row of MIGRATION_INVENTORY.filter((asset) => asset.class !== 'approved')) {
      expect(Object.hasOwn(MIGRATION_GROUP_BY_DESTINATION, row.destination)).toBe(false);
      expect(() => migrationGroupFor(row.destination)).toThrow(
        'Invalid migration group destination'
      );
    }
  });

  it('deep-freezes every group container and member array', () => {
    expect(Object.isFrozen(MIGRATION_GROUP_NAMES)).toBe(true);
    expect(Object.isFrozen(MIGRATION_GROUPS)).toBe(true);
    expect(Object.isFrozen(MIGRATION_GROUP_BY_DESTINATION)).toBe(true);
    for (const group of MIGRATION_GROUP_NAMES)
      expect(Object.isFrozen(MIGRATION_GROUPS[group])).toBe(true);
    expect(() => MIGRATION_GROUPS.agentic.push('README.md')).toThrow(TypeError);
    expect(() => {
      MIGRATION_GROUP_BY_DESTINATION['README.md'] = 'agentic';
    }).toThrow(TypeError);
  });
});
```

- [ ] **Step 4: Run the group test to verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run tests/provenance/private-groups.test.mjs
```

Expected: FAIL because `scripts/provenance/groups.mjs` does not exist.

- [ ] **Step 5: Implement the group module from the second independent literal**

Create `scripts/provenance/groups.mjs` with the complete code in Appendix B. Production must not import the
test oracle or infer groups from path prefixes.

- [ ] **Step 6: Run focused GREEN and local gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/foundation/documentation.test.ts tests/provenance/private-groups.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
git diff --check
```

Expected: both suites pass; license passes; diff check is silent.

- [ ] **Step 7: Commit the routing/group boundary**

```bash
git add docs/superpowers/plans/2026-07-17-provenance-test-infrastructure-migration.md \
  docs/superpowers/plans/2026-07-17-opnsense-product-parity.md \
  docs/superpowers/plans/2026-07-17-rebuild-plan-index.md \
  docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md \
  docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline.md \
  docs/superpowers/specs/2026-07-19-private-provenance-contract-design.md \
  tests/foundation/documentation.test.ts \
  scripts/provenance/groups.mjs tests/provenance/fixtures/expected-migration-groups.mjs \
  tests/provenance/private-groups.test.mjs
git commit -m "feat: lock private provenance groups"
```

---

### Task 2: Build the Copied, Bounded, Sanitized JSON Boundary

**Files:**

- Create: `scripts/provenance/private-error.mjs`
- Create: `scripts/provenance/private-json.mjs`
- Create: `tests/provenance/private-baseline-bytes.test.mjs`

**Interfaces:**

- Produces `PrivateProvenanceFailure`, `failPrivateBaseline()`,
  `copyAndParsePrivateJson(bytes) -> { raw, text, value }`, `canonicalJsonBytes(value)`,
  `requireExactKeys(value, keys)`, `requireDigest(value)`, `requireIdentity(value)`,
  `requireBoundedInteger(value, minimum, maximum)`, and `deepFreeze(value)`.
- `raw` is a new `Buffer`; no returned value aliases the caller's byte container.

- [ ] **Step 1: Write failing primitive tests**

Create:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  canonicalJsonBytes,
  copyAndParsePrivateJson,
  deepFreeze,
  requireBoundedInteger,
  requireDigest,
  requireExactKeys,
  requireIdentity
} from '../../scripts/provenance/private-json.mjs';

function expectPrivateFailure(callback, sentinels = []) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({
    name: 'PrivateProvenanceFailure',
    code: 'PRIVATE_BASELINE_INVALID',
    message: 'PRIVATE_BASELINE_INVALID'
  });
  expect(Object.hasOwn(caught, 'cause')).toBe(false);
  expect(Object.keys(caught).sort()).toEqual(['code', 'name']);
  const rendered = `${String(caught)} ${JSON.stringify(caught)}`;
  for (const sentinel of sentinels) expect(rendered).not.toContain(sentinel);
}

describe('private JSON primitives', () => {
  it('copies Buffer and Uint8Array input and parses strict UTF-8', () => {
    for (const input of [Buffer.from('{"a":1}'), new Uint8Array(Buffer.from('{"a":1}'))]) {
      const result = copyAndParsePrivateJson(input);
      expect(result.value).toEqual({ a: 1 });
      expect(result.text).toBe('{"a":1}');
      expect(result.raw).toEqual(Buffer.from('{"a":1}'));
      expect(result.raw).not.toBe(input);
      input[0] = 0x20;
      expect(result.raw[0]).toBe(0x7b);
    }
  });

  it('accepts exactly 2 MiB before semantic validation and rejects one byte more', () => {
    const exact = Buffer.concat([
      Buffer.from('"'),
      Buffer.alloc(2 * 1024 * 1024 - 2, 0x61),
      Buffer.from('"')
    ]);
    expect(copyAndParsePrivateJson(exact).raw.length).toBe(2 * 1024 * 1024);
    expectPrivateFailure(() => copyAndParsePrivateJson(Buffer.concat([exact, Buffer.from(' ')])));
  });

  it('rejects BOM, malformed UTF-8, malformed JSON, and non-byte values', () => {
    for (const value of [
      Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
      Buffer.from([0x22, 0xc3, 0x28, 0x22]),
      Buffer.from('{'),
      '{}',
      null
    ])
      expectPrivateFailure(() => copyAndParsePrivateJson(value));
  });

  it('requires exact positional keys and exact scalar formats', () => {
    expect(() => requireExactKeys({ a: 1, b: 2 }, ['a', 'b'])).not.toThrow();
    for (const value of [{ b: 2, a: 1 }, { a: 1 }, { a: 1, b: 2, c: 3 }, [], null])
      expectPrivateFailure(() => requireExactKeys(value, ['a', 'b']));
    expect(requireDigest('a'.repeat(64))).toBe('a'.repeat(64));
    for (const value of ['A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 4, null])
      expectPrivateFailure(() => requireDigest(value));
    expect(requireIdentity('reviewer_1@example.invalid')).toBe('reviewer_1@example.invalid');
    for (const value of ['', '-bad', 'space bad', 'a'.repeat(129), null])
      expectPrivateFailure(() => requireIdentity(value));
    expect(requireBoundedInteger(0, 0, 3)).toBe(0);
    expect(requireBoundedInteger(3, 0, 3)).toBe(3);
    for (const value of [-1, 4, 1.5, Number.NaN, '1'])
      expectPrivateFailure(() => requireBoundedInteger(value, 0, 3));
  });

  it('writes two spaces plus one LF and recursively freezes', () => {
    expect(canonicalJsonBytes({ a: [1] })).toEqual(Buffer.from('{\n  "a": [\n    1\n  ]\n}\n'));
    expectPrivateFailure(() => canonicalJsonBytes({ value: 1n }));
    const frozen = deepFreeze({ a: [{ b: 1 }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a[0])).toBe(true);
    expect(() => {
      frozen.a[0].b = 2;
    }).toThrow(TypeError);
  });

  it('does not include a rejected sentinel in its fixed error', () => {
    const sentinel = 'PRIVATE SENTINEL NEVER RENDER';
    expectPrivateFailure(() => requireIdentity(sentinel), [sentinel]);
  });
});
```

- [ ] **Step 2: Run RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-bytes.test.mjs
```

Expected: FAIL because `scripts/provenance/private-json.mjs` does not exist.

- [ ] **Step 3: Implement the fixed error**

Create:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
export class PrivateProvenanceFailure extends Error {
  constructor() {
    super('PRIVATE_BASELINE_INVALID');
    this.name = 'PrivateProvenanceFailure';
    this.code = 'PRIVATE_BASELINE_INVALID';
  }
}

export function failPrivateBaseline() {
  throw new PrivateProvenanceFailure();
}
```

- [ ] **Step 4: Implement copied strict JSON and shared primitives**

Create:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { failPrivateBaseline } from './private-error.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/u;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

export function copyAndParsePrivateJson(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) failPrivateBaseline();
  const raw = Buffer.from(bytes);
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)
    failPrivateBaseline();
  let text;
  let value;
  try {
    text = UTF8.decode(raw);
    value = JSON.parse(text);
  } catch {
    failPrivateBaseline();
  }
  return { raw, text, value };
}

export function requireExactKeys(value, expected) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((key, index) => key !== expected[index])
  )
    failPrivateBaseline();
  return value;
}

export function canonicalJsonBytes(value) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === undefined) failPrivateBaseline();
    return Buffer.from(`${serialized}\n`, 'utf8');
  } catch {
    failPrivateBaseline();
  }
}

export function requireDigest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) failPrivateBaseline();
  return value;
}

export function requireIdentity(value) {
  if (typeof value !== 'string' || !IDENTITY.test(value)) failPrivateBaseline();
  return value;
}

export function requireBoundedInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) failPrivateBaseline();
  return value;
}

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
```

- [ ] **Step 5: Run GREEN, license, and diff gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-bytes.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
git diff --check
```

Expected: six tests pass and both local gates pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/provenance/private-error.mjs scripts/provenance/private-json.mjs \
  tests/provenance/private-baseline-bytes.test.mjs
git commit -m "feat: add bounded private json primitives"
```

---

### Task 3: Reconstruct the Exact Canonical Structure

**Files:**

- Create: `scripts/provenance/private-baseline-shape.mjs`
- Create: `tests/provenance/fixtures/private-baseline-fixture.mjs`
- Extend: `tests/provenance/private-baseline-bytes.test.mjs`

**Interfaces:**

- Produces `projectCanonicalBaselineShape(value)` and `projectCompositionShape(value)`. Both reconstruct fresh
  objects; missing/unknown/wrong-container members fail. They deliberately do not validate scalar semantics.
- The test fixture produces `PUBLIC_CONTRACT`, `makePrivateBaseline()`, `canonicalFixtureBytes(value)`,
  `fixtureInventorySha256()`, `fixtureCompositionShape(value)`, `fixtureCompositionSha256(value)`, `digest()`,
  `cloneFixture()`, and `expectPrivateFailure()` without calling production projections for expected evidence.

- [ ] **Step 1: Create the independent complete synthetic fixture**

Use the exact fixture implementation in Appendix C. It constructs 116 rows in public order, pending source and
review states, one canonical `legacy-reference`, and independently calculates inventory/composition digests.

- [ ] **Step 2: Add failing structural tests at every nesting level**

Replace the Task 2 version of `tests/provenance/private-baseline-bytes.test.mjs` with the complete first file
in Appendix F. It retains every primitive test and adds the exact structural suite below.

For each object returned by the fixture—top, source evidence, scan policy, first forbidden reference, baseline
review, one asset, source authorization, scan reference, integration review, destination review, and discard
review—run three cases: remove its first key, add `unexpected: true`, and move its first key to the end.

`projectCanonicalBaselineShape` must reject missing/unknown, but must normalize the reordered object to the same
canonical bytes as the original. Later parser raw-byte comparison will reject reordered input. Also assert
`projectCompositionShape` equals the independent fixture projection and contains only destination/class plus
reduced source/scan fields. Swap two complete asset rows and assert both projectors restore public-inventory
order; reject a missing row, duplicate destination, unknown destination, or class mismatch.

- [ ] **Step 3: Run RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-bytes.test.mjs
```

Expected: FAIL because the shape module does not exist.

- [ ] **Step 4: Implement the structural projector**

Create `scripts/provenance/private-baseline-shape.mjs` using this complete projection kernel and exact key maps:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIGRATION_INVENTORY } from './inventory.mjs';
import { failPrivateBaseline } from './private-error.mjs';

const KEYS = Object.freeze({
  top: [
    'schemaVersion',
    'inventorySha256',
    'sourceEvidence',
    'scanPolicy',
    'baselineReview',
    'assets'
  ],
  sourceEvidence: [
    'bundleSha256',
    'selectedRevision',
    'compositionSha256',
    'corpusRefCount',
    'corpusRefFingerprintSha256',
    'corpusObjectCount',
    'corpusFingerprintSha256',
    'similarityIndexBlobCount',
    'similarityIndexSha256'
  ],
  scanPolicy: [
    'forbiddenBlobSha256',
    'forbiddenReferences',
    'similarityAlgorithm',
    'similarityThresholdPermille'
  ],
  forbiddenReference: ['category', 'utf8Base64'],
  baselineReview: ['reviewerId', 'verdict'],
  asset: [
    'destination',
    'class',
    'sourceAuthorization',
    'scanReference',
    'integrationReview',
    'destinationReview',
    'discardReview'
  ],
  sourceAuthorization: [
    'origin',
    'relativePath',
    'mappingRelationship',
    'mappingRationaleSha256',
    'contentSha256',
    'sizeBytes',
    'mode',
    'authorId',
    'reviewerId',
    'reviewVerdict',
    'bundleRelationship',
    'supersessionRationaleSha256'
  ],
  scanReference: [
    'relativePath',
    'mappingRelationship',
    'mappingRationaleSha256',
    'contentSha256',
    'sizeBytes'
  ],
  integrationReview: ['group', 'verdict', 'integratorId', 'reviewerId'],
  destinationReview: ['expectedContentSha256', 'authorId', 'reviewerId', 'verdict'],
  discardReview: ['verdict']
});

function object(value, keys, projectors = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) failPrivateBaseline();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    failPrivateBaseline();
  return Object.fromEntries(keys.map((key) => [key, projectors[key]?.(value[key]) ?? value[key]]));
}

function array(value, projector = (item) => item) {
  if (!Array.isArray(value)) failPrivateBaseline();
  return value.map(projector);
}

function nullable(value, projector) {
  return value === null ? null : projector(value);
}

const forbiddenReference = (value) => object(value, KEYS.forbiddenReference);
const sourceAuthorization = (value) => object(value, KEYS.sourceAuthorization);
const scanReference = (value) => object(value, KEYS.scanReference);
const integrationReview = (value) => object(value, KEYS.integrationReview);
const destinationReview = (value) => object(value, KEYS.destinationReview);
const discardReview = (value) => object(value, KEYS.discardReview);

function asset(value) {
  return object(value, KEYS.asset, {
    sourceAuthorization: (item) => nullable(item, sourceAuthorization),
    scanReference: (item) => nullable(item, scanReference),
    integrationReview: (item) => nullable(item, integrationReview),
    destinationReview: (item) => nullable(item, destinationReview),
    discardReview: (item) => nullable(item, discardReview)
  });
}

function orderedAssets(value) {
  const projected = array(value, asset);
  if (projected.length !== MIGRATION_INVENTORY.length) failPrivateBaseline();
  const byDestination = new Map();
  for (const row of projected) {
    if (typeof row.destination !== 'string' || byDestination.has(row.destination))
      failPrivateBaseline();
    byDestination.set(row.destination, row);
  }
  return MIGRATION_INVENTORY.map((expected) => {
    const row = byDestination.get(expected.destination);
    if (row === undefined || row.class !== expected.class) failPrivateBaseline();
    return row;
  });
}

export function projectCanonicalBaselineShape(value) {
  return object(value, KEYS.top, {
    sourceEvidence: (item) => object(item, KEYS.sourceEvidence),
    scanPolicy: (item) =>
      object(item, KEYS.scanPolicy, {
        forbiddenBlobSha256: (items) => array(items),
        forbiddenReferences: (items) => array(items, forbiddenReference)
      }),
    baselineReview: (item) => object(item, KEYS.baselineReview),
    assets: orderedAssets
  });
}

export function projectCompositionShape(value) {
  const canonical = projectCanonicalBaselineShape(value);
  return canonical.assets.map((row) => ({
    destination: row.destination,
    class: row.class,
    sourceAuthorization:
      row.sourceAuthorization === null
        ? null
        : {
            origin: row.sourceAuthorization.origin,
            relativePath: row.sourceAuthorization.relativePath,
            mappingRelationship: row.sourceAuthorization.mappingRelationship,
            contentSha256: row.sourceAuthorization.contentSha256,
            sizeBytes: row.sourceAuthorization.sizeBytes,
            mode: row.sourceAuthorization.mode,
            bundleRelationship: row.sourceAuthorization.bundleRelationship
          },
    scanReference:
      row.scanReference === null
        ? null
        : {
            relativePath: row.scanReference.relativePath,
            mappingRelationship: row.scanReference.mappingRelationship,
            contentSha256: row.scanReference.contentSha256,
            sizeBytes: row.scanReference.sizeBytes
          }
  }));
}
```

- [ ] **Step 5: Run GREEN and local gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-bytes.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
git diff --check
```

Expected: byte and structural projection tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/provenance/private-baseline-shape.mjs \
  tests/provenance/fixtures/private-baseline-fixture.mjs \
  tests/provenance/private-baseline-bytes.test.mjs
git commit -m "feat: define canonical private baseline shape"
```

---

### Task 4: Validate Public Contract, Evidence, Policy, and Snapshot Metadata

**Files:**

- Create: `scripts/provenance/private-baseline-values.mjs`
- Create: `tests/provenance/private-baseline-metadata.test.mjs`

**Interfaces:**

- Produces `validatePublicContract(contract)`, `validateBaselineMetadata(value, contract)`,
  `validateMapping(reference, destination, terminal)`, and `validateScanReference(reference, destination,
  terminal)`.
- `validatePublicContract` accepts only a plain non-Proxy wrapper with five ordered enumerable own data
  properties whose values are the exact authoritative exports from `inventory.mjs`. It rejects accessors,
  symbol/non-enumerable extras, alternate prototypes, and replacement arrays, maps, or callbacks before any
  caller code can run, then returns a frozen internal wrapper built from the authoritative imports. The
  116-row, 105/3/8, portable-order, and collision guarantees are load-time invariants of those exports.

- [ ] **Step 1: Copy the exact complete RED metadata suite**

Create `tests/provenance/private-baseline-metadata.test.mjs` from the complete executable file in Appendix D of
the test-appendices companion. This is one mechanical file-copy action. The tables and cases below are a
review-only coverage index, not later edit steps or replacement code.

The complete test imports the synthetic fixture and future validators and includes this helper:

```js
function validate(value, contract = PUBLIC_CONTRACT) {
  const acceptedContract = validatePublicContract(contract);
  validateBaselineMetadata(value, acceptedContract);
}

function mutation(name, change) {
  return { name, change };
}
```

Run one independent failure test for every row in this exact table:

```js
const INVALID_METADATA = [
  mutation('schema version', (v) => {
    v.schemaVersion = 2;
  }),
  mutation('inventory digest case', (v) => {
    v.inventorySha256 = 'A'.repeat(64);
  }),
  mutation('bundle digest', (v) => {
    v.sourceEvidence.bundleSha256 = 'g'.repeat(64);
  }),
  mutation('composition digest', (v) => {
    v.sourceEvidence.compositionSha256 = 'a'.repeat(63);
  }),
  mutation('40-character revision case', (v) => {
    v.sourceEvidence.selectedRevision = 'A'.repeat(40);
  }),
  mutation('revision length', (v) => {
    v.sourceEvidence.selectedRevision = 'a'.repeat(41);
  }),
  mutation('ref count low', (v) => {
    v.sourceEvidence.corpusRefCount = 0;
  }),
  mutation('ref count high', (v) => {
    v.sourceEvidence.corpusRefCount = 10_001;
  }),
  mutation('object count low', (v) => {
    v.sourceEvidence.corpusObjectCount = 0;
  }),
  mutation('object count high', (v) => {
    v.sourceEvidence.corpusObjectCount = 100_001;
  }),
  mutation('negative index count', (v) => {
    v.sourceEvidence.similarityIndexBlobCount = -1;
  }),
  mutation('index count above objects', (v) => {
    v.sourceEvidence.similarityIndexBlobCount = 2;
  }),
  mutation('duplicate forbidden digest', (v) => {
    v.scanPolicy.forbiddenBlobSha256 = ['1'.repeat(64), '1'.repeat(64)];
  }),
  mutation('unsorted forbidden digests', (v) => {
    v.scanPolicy.forbiddenBlobSha256 = ['2'.repeat(64), '1'.repeat(64)];
  }),
  mutation('513 forbidden digests', (v) => {
    v.scanPolicy.forbiddenBlobSha256 = Array.from({ length: 513 }, (_, index) =>
      index.toString(16).padStart(64, '0')
    );
  }),
  mutation('missing legacy reference', (v) => {
    v.scanPolicy.forbiddenReferences = [
      {
        category: 'private-path',
        utf8Base64: Buffer.from('path').toString('base64')
      }
    ];
  }),
  mutation('duplicate forbidden reference', (v) => {
    v.scanPolicy.forbiddenReferences.push(structuredClone(v.scanPolicy.forbiddenReferences[0]));
  }),
  mutation('unsorted forbidden references', (v) => {
    v.scanPolicy.forbiddenReferences = [
      {
        category: 'private-path',
        utf8Base64: Buffer.from('z').toString('base64')
      },
      {
        category: 'legacy-reference',
        utf8Base64: Buffer.from('a').toString('base64')
      }
    ];
  }),
  mutation('invalid reference category', (v) => {
    v.scanPolicy.forbiddenReferences[0].category = 'secret';
  }),
  mutation('noncanonical base64', (v) => {
    v.scanPolicy.forbiddenReferences[0].utf8Base64 = 'YQ';
  }),
  mutation('empty reference', (v) => {
    v.scanPolicy.forbiddenReferences[0].utf8Base64 = '';
  }),
  mutation('malformed UTF-8 reference', (v) => {
    v.scanPolicy.forbiddenReferences[0].utf8Base64 = Buffer.from([0xc3, 0x28]).toString('base64');
  }),
  mutation('4097-byte reference', (v) => {
    v.scanPolicy.forbiddenReferences[0].utf8Base64 = Buffer.alloc(4097, 0x61).toString('base64');
  }),
  mutation('algorithm override', (v) => {
    v.scanPolicy.similarityAlgorithm = 'other';
  }),
  mutation('threshold override', (v) => {
    v.scanPolicy.similarityThresholdPermille = 749;
  }),
  mutation('partial snapshot review', (v) => {
    v.baselineReview.reviewerId = 'snapshot-reviewer';
  })
];
```

For each case, call `change(makePrivateBaseline())`, then expect the fixed private failure. Add passing boundary
tests for revisions of 40 and 64 lowercase hex characters; ref counts 1 and 10,000; object counts 1 and
100,000; index counts 0 and exactly object count; 512 unique sorted digests; 256 unique sorted references with
one legacy entry; decoded reference lengths 1 and 4096; pending snapshot; reviewed snapshot with a valid
identity.

**Public-contract coverage already present in the copied Appendix D file:**

Starting from a fresh object with the exact keys `inventory`, `counts`, `collisionKey`, `compare`, `isPortable`,
test missing/extra/reordered keys and replace each authoritative export in turn: copied inventory; 115 rows;
count-preserving class swap; row reorder; copied count object; non-function callback; and a callback that would
throw `PUBLIC_CALLBACK_SENTINEL`. Every failure must be the fixed private error, the sentinel callback's call
counter must remain zero, and no sentinel may appear in the error. Replace each of the five own data properties
with an enumerable getter returning the correct export and prove every accessor is refused without invocation.
For a valid data-property wrapper, assert the returned contract is a distinct frozen internal object whose five
values remain the exact authoritative exports after the caller wrapper is mutated. Wrap a valid contract in a
Proxy whose reflection traps throw a sentinel and prove proxy detection rejects it before any trap runs. Also
reject an alternate prototype, a non-enumerable extra, and a symbol extra.

- [ ] **Step 2: Run the complete metadata suite to verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-metadata.test.mjs
```

Expected: FAIL because `private-baseline-values.mjs` does not exist.

- [ ] **Step 3: Copy the exact complete metadata-validator implementation**

Create:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  MIGRATION_CLASS_COUNTS,
  MIGRATION_INVENTORY,
  compareDestinations,
  isPortableDestination,
  portableCollisionKey
} from './inventory.mjs';
import { types as nodeTypes } from 'node:util';
import { requireBoundedInteger, requireDigest, requireIdentity } from './private-json.mjs';
import { failPrivateBaseline } from './private-error.mjs';

const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const PUBLIC_KEYS = Object.freeze(['inventory', 'counts', 'collisionKey', 'compare', 'isPortable']);
const CATEGORIES = new Set(['legacy-reference', 'private-path', 'private-identifier']);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const ACCEPTED_PUBLIC_CONTRACT = Object.freeze({
  inventory: MIGRATION_INVENTORY,
  counts: MIGRATION_CLASS_COUNTS,
  collisionKey: portableCollisionKey,
  compare: compareDestinations,
  isPortable: isPortableDestination
});

function compareBytes(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function decodeReference(reference) {
  if (typeof reference !== 'string' || reference.length === 0) failPrivateBaseline();
  const bytes = Buffer.from(reference, 'base64');
  if (bytes.length === 0 || bytes.length > 4096 || bytes.toString('base64') !== reference)
    failPrivateBaseline();
  try {
    UTF8.decode(bytes);
  } catch {
    failPrivateBaseline();
  }
  return bytes;
}

function publicContractDescriptors(contract) {
  if (
    contract === null ||
    typeof contract !== 'object' ||
    nodeTypes.isProxy(contract) ||
    Array.isArray(contract) ||
    Object.getPrototypeOf(contract) !== Object.prototype
  )
    failPrivateBaseline();
  const keys = Reflect.ownKeys(contract);
  if (keys.length !== PUBLIC_KEYS.length || keys.some((key, index) => key !== PUBLIC_KEYS[index]))
    failPrivateBaseline();
  return Object.getOwnPropertyDescriptors(contract);
}

export function validatePublicContract(contract) {
  try {
    const descriptors = publicContractDescriptors(contract);
    for (const key of PUBLIC_KEYS) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.value !== ACCEPTED_PUBLIC_CONTRACT[key]
      )
        failPrivateBaseline();
    }
    return ACCEPTED_PUBLIC_CONTRACT;
  } catch {
    failPrivateBaseline();
  }
}

function validateSourceEvidence(evidence) {
  requireDigest(evidence.bundleSha256);
  if (typeof evidence.selectedRevision !== 'string' || !REVISION.test(evidence.selectedRevision))
    failPrivateBaseline();
  requireDigest(evidence.compositionSha256);
  requireBoundedInteger(evidence.corpusRefCount, 1, 10_000);
  requireDigest(evidence.corpusRefFingerprintSha256);
  requireBoundedInteger(evidence.corpusObjectCount, 1, 100_000);
  requireDigest(evidence.corpusFingerprintSha256);
  requireBoundedInteger(evidence.similarityIndexBlobCount, 0, evidence.corpusObjectCount);
  requireDigest(evidence.similarityIndexSha256);
}

function validateScanPolicy(policy) {
  if (!Array.isArray(policy.forbiddenBlobSha256) || policy.forbiddenBlobSha256.length > 512)
    failPrivateBaseline();
  let previousDigest;
  for (const digest of policy.forbiddenBlobSha256) {
    requireDigest(digest);
    if (previousDigest !== undefined && compareBytes(previousDigest, digest) >= 0)
      failPrivateBaseline();
    previousDigest = digest;
  }
  if (!Array.isArray(policy.forbiddenReferences) || policy.forbiddenReferences.length > 256)
    failPrivateBaseline();
  let previousReference;
  let hasLegacy = false;
  for (const reference of policy.forbiddenReferences) {
    if (!CATEGORIES.has(reference.category)) failPrivateBaseline();
    const bytes = decodeReference(reference.utf8Base64);
    const framed = [Buffer.from(reference.category, 'utf8'), bytes];
    if (previousReference !== undefined) {
      const categoryOrder = Buffer.compare(previousReference[0], framed[0]);
      if (
        categoryOrder > 0 ||
        (categoryOrder === 0 && Buffer.compare(previousReference[1], framed[1]) >= 0)
      )
        failPrivateBaseline();
    }
    previousReference = framed;
    hasLegacy ||= reference.category === 'legacy-reference';
  }
  if (
    !hasLegacy ||
    policy.similarityAlgorithm !== 'token-5-jaccard-v1' ||
    policy.similarityThresholdPermille !== 750
  )
    failPrivateBaseline();
}

function validateBaselineReview(review) {
  if (review.verdict === 'pending' && review.reviewerId === null) return;
  if (review.verdict === 'reviewed-snapshot') {
    requireIdentity(review.reviewerId);
    return;
  }
  failPrivateBaseline();
}

export function validateBaselineMetadata(value, contract) {
  if (value.schemaVersion !== 1) failPrivateBaseline();
  requireDigest(value.inventorySha256);
  validateSourceEvidence(value.sourceEvidence);
  validateScanPolicy(value.scanPolicy);
  validateBaselineReview(value.baselineReview);
  if (!Array.isArray(value.assets) || value.assets.length !== contract.inventory.length)
    failPrivateBaseline();
}

export function requireUnicodeScalarString(value) {
  if (typeof value !== 'string') failPrivateBaseline();
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) failPrivateBaseline();
  }
  return value;
}

export function validateMapping(reference, destination, terminal) {
  requireUnicodeScalarString(reference.relativePath);
  if (reference.mappingRelationship === 'same-path') {
    if (reference.relativePath !== destination || reference.mappingRationaleSha256 !== null)
      failPrivateBaseline();
  } else if (reference.mappingRelationship === 'renamed') {
    if (reference.relativePath === destination) failPrivateBaseline();
    if (terminal) requireDigest(reference.mappingRationaleSha256);
    else if (reference.mappingRationaleSha256 !== null)
      requireDigest(reference.mappingRationaleSha256);
  } else failPrivateBaseline();
}

export function validateScanReference(reference, destination, terminal) {
  validateMapping(reference, destination, terminal);
  requireDigest(reference.contentSha256);
  requireBoundedInteger(reference.sizeBytes, 0, 67_108_864);
}
```

The shape projector already guarantees all nested exact key sets before these functions run. The asset task
will additionally call the identity-bound authoritative `isPortableDestination` for private relative paths;
arbitrary replacement callbacks have already been rejected without invocation.

- [ ] **Step 4: Run GREEN and local gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-metadata.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
git diff --check
```

Expected: every invalid row fails with the fixed error and every stated boundary passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/provenance/private-baseline-values.mjs \
  tests/provenance/private-baseline-metadata.test.mjs
git commit -m "feat: validate private baseline metadata"
```

---

### Task 5: Enforce Complete Asset Authorization and Review Matrices

**Files:**

- Create: `scripts/provenance/private-baseline-assets.mjs`
- Create: `tests/provenance/private-baseline-assets.test.mjs`

**Interfaces:**

- Consumes `validateMapping`, `validateScanReference`, the identity-bound authoritative public contract, and
  immutable group lookup.
- Produces `validatePrivateAssets(assets, { publicContract, baselineReview })`. It returns the original assets
  after exact row/state/group/path/aggregate/reviewer checks and never modifies them.

- [ ] **Step 1: Copy the exact complete RED asset-state suite**

Create `tests/provenance/private-baseline-assets.test.mjs` from the complete executable file in Appendix E of
the test-appendices companion. This is one mechanical file-copy action. The coverage sections below are
review-only indexes, not later edit steps; do not reconstruct or incrementally diverge the test from the exact
appendix file.

**Structural, path, size, and group coverage already present in Appendix E:**

Using a fresh `makePrivateBaseline()` per test, reject: missing/extra/reordered row; destination or class mismatch;
wrong asset slot nullability; private `.git`, Windows device, backslash, non-NFC, absolute, dot-segment, case, or
normalization-colliding relative path; escaped lone high surrogate `\ud800` and lone low surrogate `\udc00`;
wrong group in both pending and integrated state; size `-1` or
`67_108_865`; mode other than `100644|100755`; aggregate `536_870_913`; and duplicate private source/scan path.
Accept size `0`, size `67_108_864`, both modes, and aggregate exactly `536_870_912` distributed across eight
bounded rows so the aggregate check—not the per-row check—is exercised.

**Approved source-authorization coverage already present in Appendix E:**

Generate the product of:

- origin: `bundle`, `overlay`;
- bundle relationship: `selected`, `absent`, `supersedes`;
- source verdict: `pending-source-review`, `approved-for-migration`;
- reviewer: `null`, `source-reviewer`, same value as author;
- supersession rationale: `null`, lowercase digest;
- top snapshot: `pending`, `reviewed-snapshot`.

Mark valid exactly when all these predicates are true:

```js
const relationshipValid =
  (origin === 'bundle' && bundleRelationship === 'selected') ||
  (origin === 'overlay' && ['absent', 'supersedes'].includes(bundleRelationship));
const reviewerValid =
  (sourceVerdict === 'pending-source-review' && reviewerId === null) ||
  (sourceVerdict === 'approved-for-migration' &&
    reviewerId === 'source-reviewer' &&
    reviewerId !== authorId);
const supersessionValid =
  bundleRelationship !== 'supersedes'
    ? supersessionRationaleSha256 === null
    : sourceVerdict === 'approved-for-migration' || snapshotReviewed
      ? supersessionRationaleSha256 === LOWERCASE_DIGEST
      : supersessionRationaleSha256 === null;
```

Every valid tuple passes and every invalid tuple fails. Separately reject malformed author/reviewer identities,
wrong content digest, and a bundle row with a supersession rationale.

**Mapping and scan-reference coverage already present in Appendix E:**

For same-path, require `relativePath === destination` and null rationale. For renamed, require a different
portable path; allow null rationale only while the source review and top snapshot are pending; require a digest
when source review or top snapshot is terminal. For rewrite/discard scan references, require the exact five
fields, digest and bounded size; a renamed scan-reference rationale becomes mandatory when top snapshot is
reviewed. Prove scan references never authorize copying by asserting rewrite/discard rows reject non-null source
or integration slots.

**Approved lifecycle coverage already present in Appendix E:**

Generate source `pending|approved`, integration `pending|integrated`, and destination `pending|reviewed`.
Accept exactly:

```text
pending  / pending    / pending
approved / pending    / pending
approved / integrated / pending
approved / integrated / reviewed
```

For integrated state require verdict `copied-and-adapted`, non-null distinct integrator/reviewer, and exact
public group. For reviewed destination require lowercase expected digest, `authorId === integratorId`, distinct
reviewer, and verdict `approved-migrated`. Reject every partial object, self-review, wrong author, and transition
not listed above.

**Rewrite, discard, and top-reviewer coverage already present in Appendix E:**

Rewrite accepts only fully pending destination review or fully reviewed distinct author/reviewer/digest with
verdict `independently-rewritten`; source/integration/discard slots stay null. Discard accepts only null
source/integration/destination, non-null scan reference, and exactly `{ verdict: 'discarded' }`.

For reviewed top snapshot, assert its reviewer may equal any row reviewer but differs from every approved source
author, non-null integration integrator, approved destination author, and rewrite destination author. Test each
identity category independently, including an author in the final row so collection order cannot hide it.

- [ ] **Step 2: Run the complete asset-state suite to verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-assets.test.mjs
```

Expected: FAIL because `private-baseline-assets.mjs` does not exist.

- [ ] **Step 3: Copy the exact atomic row-validator implementation**

Create `scripts/provenance/private-baseline-assets.mjs`. Start with these exact helpers:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIGRATION_GROUP_BY_DESTINATION } from './groups.mjs';
import { isPortableDestination, portableCollisionKey } from './inventory.mjs';
import { failPrivateBaseline } from './private-error.mjs';
import { requireBoundedInteger, requireDigest, requireIdentity } from './private-json.mjs';
import {
  requireUnicodeScalarString,
  validateMapping,
  validateScanReference
} from './private-baseline-values.mjs';

function pendingDestination(review) {
  return (
    review.expectedContentSha256 === null &&
    review.authorId === null &&
    review.reviewerId === null &&
    review.verdict === 'pending'
  );
}

function reviewedDestination(review, verdict, requiredAuthor = undefined) {
  requireDigest(review.expectedContentSha256);
  requireIdentity(review.authorId);
  requireIdentity(review.reviewerId);
  if (
    review.authorId === review.reviewerId ||
    review.verdict !== verdict ||
    (requiredAuthor !== undefined && review.authorId !== requiredAuthor)
  )
    failPrivateBaseline();
}

function validateDestination(review, verdict, requiredAuthor = undefined) {
  if (pendingDestination(review)) return false;
  reviewedDestination(review, verdict, requiredAuthor);
  return true;
}

function validatePrivatePath(path, seen) {
  requireUnicodeScalarString(path);
  if (!isPortableDestination(path)) failPrivateBaseline();
  const key = portableCollisionKey(path);
  if (seen.has(key)) failPrivateBaseline();
  seen.add(key);
  return path;
}

function validateSource(source, destination, snapshotReviewed, seen) {
  validatePrivatePath(source.relativePath, seen);
  const sourceApproved = source.reviewVerdict === 'approved-for-migration';
  validateMapping(source, destination, sourceApproved || snapshotReviewed);
  requireDigest(source.contentSha256);
  requireBoundedInteger(source.sizeBytes, 0, 67_108_864);
  if (!['100644', '100755'].includes(source.mode)) failPrivateBaseline();
  requireIdentity(source.authorId);
  if (sourceApproved) {
    requireIdentity(source.reviewerId);
    if (source.reviewerId === source.authorId) failPrivateBaseline();
  } else if (source.reviewVerdict !== 'pending-source-review' || source.reviewerId !== null) {
    failPrivateBaseline();
  }
  if (source.origin === 'bundle') {
    if (source.bundleRelationship !== 'selected' || source.supersessionRationaleSha256 !== null)
      failPrivateBaseline();
  } else if (source.origin === 'overlay') {
    if (!['absent', 'supersedes'].includes(source.bundleRelationship)) failPrivateBaseline();
    if (source.bundleRelationship === 'absent') {
      if (source.supersessionRationaleSha256 !== null) failPrivateBaseline();
    } else if (sourceApproved || snapshotReviewed) {
      requireDigest(source.supersessionRationaleSha256);
    } else if (source.supersessionRationaleSha256 !== null) failPrivateBaseline();
  } else failPrivateBaseline();
  return sourceApproved;
}

function validateIntegration(review, destination) {
  if (review.group !== MIGRATION_GROUP_BY_DESTINATION[destination]) failPrivateBaseline();
  if (review.verdict === 'pending' && review.integratorId === null && review.reviewerId === null)
    return false;
  if (review.verdict !== 'copied-and-adapted') failPrivateBaseline();
  requireIdentity(review.integratorId);
  requireIdentity(review.reviewerId);
  if (review.integratorId === review.reviewerId) failPrivateBaseline();
  return true;
}
```

Continue the same Step 3 file with the exact class dispatch, aggregate, and independence block:

Add these complete class functions and exported loop:

```js
function approved(row, snapshotReviewed, paths, principals) {
  if (
    row.sourceAuthorization === null ||
    row.scanReference !== null ||
    row.integrationReview === null ||
    row.destinationReview === null ||
    row.discardReview !== null
  )
    failPrivateBaseline();
  const sourceApproved = validateSource(
    row.sourceAuthorization,
    row.destination,
    snapshotReviewed,
    paths
  );
  principals.authors.add(row.sourceAuthorization.authorId);
  const integrated = validateIntegration(row.integrationReview, row.destination);
  if (integrated) principals.integrators.add(row.integrationReview.integratorId);
  const destinationReviewed = integrated
    ? validateDestination(
        row.destinationReview,
        'approved-migrated',
        row.integrationReview.integratorId
      )
    : validateDestination(row.destinationReview, 'approved-migrated');
  if (destinationReviewed) principals.authors.add(row.destinationReview.authorId);
  if ((!sourceApproved && integrated) || (!integrated && destinationReviewed))
    failPrivateBaseline();
  return BigInt(row.sourceAuthorization.sizeBytes);
}

function rewrite(row, snapshotReviewed, paths, principals) {
  if (
    row.sourceAuthorization !== null ||
    row.scanReference === null ||
    row.integrationReview !== null ||
    row.destinationReview === null ||
    row.discardReview !== null
  )
    failPrivateBaseline();
  validatePrivatePath(row.scanReference.relativePath, paths);
  validateScanReference(row.scanReference, row.destination, snapshotReviewed);
  const reviewed = validateDestination(row.destinationReview, 'independently-rewritten');
  if (reviewed) principals.authors.add(row.destinationReview.authorId);
  return BigInt(row.scanReference.sizeBytes);
}

function discard(row, snapshotReviewed, paths) {
  if (
    row.sourceAuthorization !== null ||
    row.scanReference === null ||
    row.integrationReview !== null ||
    row.destinationReview !== null ||
    row.discardReview?.verdict !== 'discarded'
  )
    failPrivateBaseline();
  validatePrivatePath(row.scanReference.relativePath, paths);
  validateScanReference(row.scanReference, row.destination, snapshotReviewed);
  return BigInt(row.scanReference.sizeBytes);
}

export function validatePrivateAssets(assets, { publicContract, baselineReview }) {
  if (!Array.isArray(assets) || assets.length !== publicContract.inventory.length)
    failPrivateBaseline();
  const snapshotReviewed = baselineReview.verdict === 'reviewed-snapshot';
  const paths = new Set();
  const principals = { authors: new Set(), integrators: new Set() };
  let total = 0n;
  for (let index = 0; index < publicContract.inventory.length; index += 1) {
    const row = assets[index];
    const expected = publicContract.inventory[index];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) failPrivateBaseline();
    if (row.destination !== expected.destination || row.class !== expected.class)
      failPrivateBaseline();
    if (row.class === 'approved') total += approved(row, snapshotReviewed, paths, principals);
    else if (row.class === 'rewrite') total += rewrite(row, snapshotReviewed, paths, principals);
    else if (row.class === 'discard') total += discard(row, snapshotReviewed, paths);
    else failPrivateBaseline();
    if (total > 536_870_912n) failPrivateBaseline();
  }
  if (
    snapshotReviewed &&
    (principals.authors.has(baselineReview.reviewerId) ||
      principals.integrators.has(baselineReview.reviewerId))
  )
    failPrivateBaseline();
  return assets;
}
```

The structural projector has already rejected unknown/reordered/missing nested keys before this module runs.
The tests must additionally verify that a wrong `discardReview` extra key fails structurally, not merely by
optional chaining in `discard()`.

- [ ] **Step 4: Run GREEN and local gates**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline-assets.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
git diff --check
```

Expected: all generated matrices and boundaries pass with no skipped cases.

- [ ] **Step 5: Commit**

```bash
git add scripts/provenance/private-baseline-assets.mjs \
  tests/provenance/private-baseline-assets.test.mjs
git commit -m "feat: enforce private asset state matrices"
```

---

### Task 6: Assemble the Exact Three-Export Parser and Digest Bindings

**Files:**

- Create: `scripts/provenance/private-baseline.mjs`
- Create: `tests/provenance/private-baseline.test.mjs`

**Interfaces:**

- Produces only `parsePrivateBaseline(bytes, publicContract)`, `canonicalPrivateBaseline(value)`, and
  `privateCompositionProjection(value)`.
- Parsing copies raw bytes, reconstructs structural canonical order, rejects raw/canonical mismatch, validates
  live public contract plus all states, binds inventory and composition digests, and deeply freezes the fresh
  projected graph.

- [ ] **Step 1: Copy the exact complete RED facade suite**

Create `tests/provenance/private-baseline.test.mjs` from the complete second file in Appendix F of the
test-appendices companion. The byte/shape file is already complete from Task 3. This is one mechanical file-copy
action. The coverage sections below are review-only indexes for those exact files, not later edits.

Assert namespace exports equal exactly:

```js
['canonicalPrivateBaseline', 'parsePrivateBaseline', 'privateCompositionProjection'];
```

Assert the synthetic fixture parses and `inventorySha256` equals the test-owned golden
`aba068a7ff2219ca574f8158a485524b08021a4f2a24ca8f4119bb1f7a667fde`. Reject a changed digest, destination,
class, count-preserving class swap, and row reorder. Recompute an internally consistent inventory digest after
each private-row mutation and prove exact live inventory equality still rejects it.

**Raw canonical-byte coverage already present in Appendix F:**

Starting from `canonicalFixtureBytes(makePrivateBaseline())`, reject compact JSON, tabs, four spaces, missing
terminal LF, two LFs, CRLF, leading/trailing space, BOM, malformed UTF-8, malformed JSON, duplicate top member,
and duplicate nested member. At each of these eleven structural levels, separately duplicate the first key in
raw JSON and move the first key to the end; both raw inputs must fail even though
`canonicalPrivateBaseline(reorderedValue)` reconstructs the original bytes:

```text
top, sourceEvidence, scanPolicy, forbiddenReference, baselineReview, asset,
sourceAuthorization, scanReference, integrationReview, destinationReview, discardReview
```

Also serialize a value with two complete asset rows swapped: parsing those raw bytes must fail, while
`canonicalPrivateBaseline(swappedValue)` and `privateCompositionProjection(swappedValue)` must restore exact
authoritative public-inventory order.

The byte primitive owns the exact 2 MiB boundary; do not bypass the 4096-byte policy bound just to pad a
semantically valid full baseline.

**Composition inclusion and exclusion coverage already present in Appendix F:**

First assert production projection bytes equal the independent fixture projection and that every projected row
contains its exact authoritative destination/class. Do not mutate destination or class: structural projection
must reject either mismatch. For fields that can vary semantically, use these coherent included variants and
assert projection bytes plus SHA-256 change:

```text
source contentSha256 alone; source sizeBytes alone; source mode alone;
source bundle/selected -> overlay/absent as one coordinated origin+bundleRelationship transition;
source same-path -> renamed as coordinated relativePath+mappingRelationship+mappingRationaleSha256;
scan contentSha256 alone; scan sizeBytes alone;
scan same-path -> renamed as coordinated relativePath+mappingRelationship+mappingRationaleSha256
```

After each included variant, recompute the stored composition digest with the independent fixture function and
assert parsing succeeds. For excluded fields, use these coherent pairs and assert projection bytes remain
identical:

```text
two valid rationale digests on the same pending renamed mapping;
two valid supersession rationale digests on the same independently approved overlay/supersedes source;
pending -> approved source review as one reviewerId+reviewVerdict transition;
pending -> integrated as one integration verdict+integratorId+reviewerId transition after source approval;
pending -> reviewed destination as one digest+authorId+reviewerId+verdict transition after integration;
pending -> reviewed baselineReview with a reviewer who is no author/integrator;
one valid sorted scanPolicy -> a different valid sorted scanPolicy;
one valid non-composition sourceEvidence digest/count -> a different valid value
```

Prove rationale, identities, all reviews, discard review, policy, and non-composition source evidence are absent
by comparing exact parsed projection keys with the independent fixture. Reject a valid baseline whose stored
`compositionSha256` differs by one lowercase hex digit.

**Deep-freeze, purity, and redaction coverage already present in Appendix F:**

Walk every returned object/array recursively and assert `Object.isFrozen`. Mutating top, nested object, or array
must throw `TypeError`. Assert canonical and composition functions return distinct `Buffer` instances on each
call.

Lock the exact eight-node transitive 2A1 import graph rooted at `private-baseline.mjs`, including
`inventory.mjs`, and compare every module's complete static import/export specifier multiset with that graph.
Traverse every relative edge and prove the root reaches exactly those eight named modules; any new relative,
bare, or `node:` import therefore fails until the graph and review change together. The only non-relative edges
are the facade's exact `node:crypto` import and the values module's exact `node:util` import used solely for
proxy rejection. Reject every dynamic `import()`, `require`, and every token for `process`, `globalThis`,
`Date`, `performance`, `fetch`, `WebSocket`, `XMLHttpRequest`, `Deno`, or `Bun`. Snapshot `process.env` and
`process.cwd()` before calls and assert unchanged afterward. The closed graph plus runtime non-mutation checks
form the source-boundary purity proof; do not monkey-patch Node globals.

Generate unique sentinel author, reviewer, path, digest, callback error, malformed JSON fragment, and reference.
For every failure, assert only the fixed name/code/message are observable and no sentinel appears in
`String(error)` or `JSON.stringify(error)`.

- [ ] **Step 2: Run the complete facade suite to verify RED**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/provenance/private-baseline.test.mjs \
  tests/provenance/private-baseline-bytes.test.mjs
```

Expected: FAIL because the facade does not exist.

- [ ] **Step 3: Copy the exact complete facade implementation**

Create:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { validatePrivateAssets } from './private-baseline-assets.mjs';
import {
  projectCanonicalBaselineShape,
  projectCompositionShape
} from './private-baseline-shape.mjs';
import { validateBaselineMetadata, validatePublicContract } from './private-baseline-values.mjs';
import { canonicalJsonBytes, copyAndParsePrivateJson, deepFreeze } from './private-json.mjs';
import { failPrivateBaseline } from './private-error.mjs';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inventoryProjection(contract) {
  return contract.inventory.map(({ destination, class: assetClass }) => ({
    destination,
    class: assetClass
  }));
}

export function canonicalPrivateBaseline(value) {
  try {
    return canonicalJsonBytes(projectCanonicalBaselineShape(value));
  } catch {
    failPrivateBaseline();
  }
}

export function privateCompositionProjection(value) {
  try {
    return canonicalJsonBytes(projectCompositionShape(value));
  } catch {
    failPrivateBaseline();
  }
}

export function parsePrivateBaseline(bytes, publicContract) {
  try {
    const { raw, value } = copyAndParsePrivateJson(bytes);
    const projected = projectCanonicalBaselineShape(value);
    if (!canonicalJsonBytes(projected).equals(raw)) failPrivateBaseline();
    const contract = validatePublicContract(publicContract);
    validateBaselineMetadata(projected, contract);
    validatePrivateAssets(projected.assets, {
      publicContract: contract,
      baselineReview: projected.baselineReview
    });
    if (projected.inventorySha256 !== sha256(canonicalJsonBytes(inventoryProjection(contract))))
      failPrivateBaseline();
    if (
      projected.sourceEvidence.compositionSha256 !== sha256(privateCompositionProjection(projected))
    )
      failPrivateBaseline();
    return deepFreeze(projected);
  } catch {
    failPrivateBaseline();
  }
}
```

The catch boundaries intentionally normalize every internal exception. Accessors and arbitrary replacement
public-contract callbacks are rejected by descriptor/identity checks before invocation. All later work uses
the frozen internal wrapper around authoritative imports, never the caller wrapper. No original error is logged
or attached.

- [ ] **Step 4: Run the complete focused Task 2A1 suite GREEN**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run \
  tests/foundation/documentation.test.ts \
  tests/provenance/migration-manifest.test.ts \
  tests/provenance/private-groups.test.mjs \
  tests/provenance/private-baseline-bytes.test.mjs \
  tests/provenance/private-baseline-metadata.test.mjs \
  tests/provenance/private-baseline-assets.test.mjs \
  tests/provenance/private-baseline.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
git diff --check
```

Expected: all focused suites pass, license passes, and diff check is silent.

- [ ] **Step 5: Commit the facade**

```bash
git add scripts/provenance/private-baseline.mjs \
  tests/provenance/private-baseline.test.mjs
git commit -m "feat: implement pure private baseline contract"
```

---

### Task 7: Obtain Independent Acceptance and Run Final Gates

**Files:**

- Modify only Task 2A1 files named by concrete review findings.

**Interfaces:**

- Produces a reviewed Task 2A1 commit range. Task 2A2 and every real private operation remain blocked.

- [ ] **Step 1: Self-review specification coverage**

Check every owner-approved 2A1 requirement against Tasks 1–6: exact group assignment; copied bytes; 2 MiB;
strict UTF-8/BOM; all eleven positional key levels; exact 116 rows; 105/3/8; source evidence; ordered unique scan
policy; identity/digest/path/size/mode bounds; approved/rewrite/discard matrices; renamed/supersedes rationale;
aggregate size; snapshot reviewer independence; inventory/composition bindings; exactly three exports; deep
freeze; fixed errors; and no external access. Add a failing regression for any missing item before changing
implementation.

- [ ] **Step 2: Run the plan placeholder and extension scan**

```bash
PRIVATE_PLAN_INCOMPLETE_PATTERN='T''BD|TO''DO|implement ''later|add appropriate ''error|write tests ''for'
if rg -n "$PRIVATE_PLAN_INCOMPLETE_PATTERN" \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md \
  scripts/provenance tests/provenance; then
  exit 1
fi
git ls-files --error-unmatch \
  docs/superpowers/plans/2026-07-17-opnsense-product-parity.md \
  docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md
if rg --files tests/provenance | rg '\.test\.ts$' | \
  rg -v '^tests/provenance/migration-manifest\.test\.ts$'; then
  exit 1
fi
```

Expected: no incomplete implementation marker and no new TypeScript provenance test. References to the already
existing `migration-manifest.test.ts` are allowed and reviewed manually.

- [ ] **Step 3: Request specification-conformance review**

Provide the reviewer the base commit immediately before Task 1, current HEAD, this plan, and
`docs/superpowers/specs/2026-07-19-private-provenance-contract-design.md`. Require explicit findings for each
self-review item above plus synthetic-only evidence. Fix every Critical and Important finding with a failing
regression, focused GREEN, local commit, and re-review. Use a fresh review subagent that authored no Task 2A1
code, and retain its canonical task identifier and final verdict for the handoff.

- [ ] **Step 4: Request code-quality review after spec approval**

Require review of module responsibilities, duplicate authority, caller mutation, replacement-callback
rejection-before-invocation, private-value leakage, canonical projection ambiguity, test-oracle independence, accidental
stronger human-separation rules, and bounded work. Fix and re-review every Critical and Important finding.
Use a second fresh subagent that differs from both the implementer and specification reviewer; record its
canonical task identifier and final verdict in the handoff.

- [ ] **Step 5: Run all final gates fresh on reviewed HEAD**

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run provenance:verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:conformance
git diff --check
git status --short --branch
```

Expected: public provenance, license, format, lint, typecheck, build, all Vitest suites, both MCP conformance
profiles, and diff check pass. Status contains no private artifact or unrelated staged path. Record exact test
counts and exit codes; make no VM, Windows, benchmark, private-preflight, migration, or product claim.

- [ ] **Step 6: Commit only concrete post-review corrections**

If review fixes remain uncommitted, stage only named Task 2A1 files and commit:

```bash
git add scripts/provenance/groups.mjs scripts/provenance/private-error.mjs \
  scripts/provenance/private-json.mjs scripts/provenance/private-baseline-shape.mjs \
  scripts/provenance/private-baseline-values.mjs scripts/provenance/private-baseline-assets.mjs \
  scripts/provenance/private-baseline.mjs \
  tests/provenance/fixtures/expected-migration-groups.mjs \
  tests/provenance/fixtures/private-baseline-fixture.mjs \
  tests/provenance/private-groups.test.mjs tests/provenance/private-baseline-bytes.test.mjs \
  tests/provenance/private-baseline-metadata.test.mjs \
  tests/provenance/private-baseline-assets.test.mjs tests/provenance/private-baseline.test.mjs \
  tests/foundation/documentation.test.ts \
  docs/superpowers/plans/2026-07-17-provenance-test-infrastructure-migration.md \
  docs/superpowers/plans/2026-07-17-opnsense-product-parity.md \
  docs/superpowers/plans/2026-07-17-rebuild-plan-index.md \
  docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline-test-appendices.md \
  docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md \
  docs/superpowers/plans/2026-07-19-private-provenance-baseline.md \
  docs/superpowers/specs/2026-07-19-private-provenance-contract-design.md
git commit -m "fix: close private baseline review findings"
```

If no correction remains, create no empty commit. Report the accepted commit range. Task 2A is still incomplete
until a separately written, independently reviewed Task 2A2 plan is implemented and both subincrements pass the
combined gate. Clean-room Product planning and its first read-only vertical remain independent.

---

## Appendix A: Complete Test-Owned Destination-to-Group Oracle

This is the complete content of `tests/provenance/fixtures/expected-migration-groups.mjs`. It deliberately
repeats all 105 assignments instead of deriving them from production:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
export const EXPECTED_MIGRATION_GROUP_PAIRS = Object.freeze([
  ['.agents/plugins/marketplace.json', 'installer-plugin'],
  ['.claude-plugin/marketplace.json', 'installer-plugin'],
  ['SECURITY.md', 'recent-docs'],
  ['docs/adding-api-modules.md', 'recent-docs'],
  ['docs/api-coverage-matrix.md', 'recent-docs'],
  ['docs/ground-truth-eval.md', 'recent-docs'],
  ['docs/production.md', 'recent-docs'],
  ['docs/release.md', 'recent-docs'],
  ['docs/ssh-features.md', 'recent-docs'],
  ['docs/superpowers/plans/2026-06-22-ssh-backed-coverage.md', 'recent-docs'],
  ['docs/superpowers/plans/2026-07-17-agentic-run1-audit.json', 'recent-docs'],
  ['docs/superpowers/plans/2026-07-17-agentic-run1-audit.md', 'recent-docs'],
  ['docs/superpowers/plans/2026-07-17-release-install-safety-benchmark.md', 'recent-docs'],
  ['docs/superpowers/specs/2026-06-21-cleanup-hardening-backlog.md', 'recent-docs'],
  ['docs/superpowers/specs/2026-06-22-ssh-backed-coverage-design.md', 'recent-docs'],
  ['docs/superpowers/specs/2026-07-17-release-install-safety-benchmark-design.md', 'recent-docs'],
  ['docs/testing.md', 'recent-docs'],
  ['docs/tool-descriptions.md', 'recent-docs'],
  ['plugins/opnsense-mcp/.claude-plugin/plugin.json', 'installer-plugin'],
  ['plugins/opnsense-mcp/.codex-plugin/plugin.json', 'installer-plugin'],
  ['plugins/opnsense-mcp/.mcp.json', 'installer-plugin'],
  ['plugins/opnsense-mcp/skills/opnsense-guide/SKILL.md', 'installer-plugin'],
  ['plugins/opnsense-mcp/skills/opnsense-guide/agents/openai.yaml', 'installer-plugin'],
  ['scripts/setup/bootstrap-dev.sh', 'vm-onboarding'],
  ['src/cli/install.ts', 'installer-plugin'],
  ['src/cli/serve.ts', 'installer-plugin'],
  ['src/http/security.ts', 'security-backup'],
  ['src/security/audit-log.ts', 'security-backup'],
  ['src/security/operation-policy.ts', 'security-backup'],
  ['tests/README.md', 'other-tests'],
  ['tests/agentic/deepeval/exposed-tools.txt', 'agentic'],
  ['tests/agentic/deepeval/gt_assurance.py', 'agentic'],
  ['tests/agentic/deepeval/gt_attestation.py', 'agentic'],
  ['tests/agentic/deepeval/gt_checkpoint.py', 'agentic'],
  ['tests/agentic/deepeval/gt_lib.py', 'agentic'],
  ['tests/agentic/deepeval/gt_metrics.py', 'agentic'],
  ['tests/agentic/deepeval/gt_tool_policy.py', 'agentic'],
  ['tests/agentic/deepeval/irreversible-exclusions.json', 'agentic'],
  ['tests/agentic/deepeval/requirements.txt', 'agentic'],
  ['tests/agentic/deepeval/run_eval.py', 'agentic'],
  ['tests/agentic/deepeval/semantic-contracts.json', 'agentic'],
  ['tests/agentic/deepeval/setup.sh', 'agentic'],
  ['tests/agentic/deepeval/test_agent_trace.py', 'agentic'],
  ['tests/agentic/deepeval/test_attestation_adversarial.py', 'agentic'],
  ['tests/agentic/deepeval/test_checkpoint.py', 'agentic'],
  ['tests/agentic/deepeval/test_config_hygiene.py', 'agentic'],
  ['tests/agentic/deepeval/test_hygiene_gate.py', 'agentic'],
  ['tests/agentic/deepeval/test_infra_classification.py', 'agentic'],
  ['tests/agentic/deepeval/test_metrics_adversarial.py', 'agentic'],
  ['tests/agentic/deepeval/test_predicate_inventory.py', 'agentic'],
  ['tests/agentic/deepeval/test_result_claims.py', 'agentic'],
  ['tests/agentic/deepeval/test_validate_adversarial.py', 'agentic'],
  ['tests/agentic/ground-truth.csv', 'agentic'],
  ['tests/agentic/model-config.json', 'agentic'],
  ['tests/agentic/run-agentic.mjs', 'agentic'],
  ['tests/agentic/temp-config-hygiene.mjs', 'agentic'],
  ['tests/agentic/verify-bridge-cleanup.test.mjs', 'agentic'],
  ['tests/agentic/verify-bridge.mjs', 'agentic'],
  ['tests/helpers/live-api-client.mjs', 'other-tests'],
  ['tests/helpers/mcp-client.mjs', 'other-tests'],
  ['tests/helpers/private-temp-json.mjs', 'other-tests'],
  ['tests/inspect.sh', 'other-tests'],
  ['tests/installer/install.test.mjs', 'installer-plugin'],
  ['tests/integration/backup-flow.mjs', 'security-backup'],
  ['tests/integration/backup-id-collision.mjs', 'security-backup'],
  ['tests/integration/guardrails.mjs', 'security-backup'],
  ['tests/integration/live-script-secret-hygiene.mjs', 'security-backup'],
  ['tests/integration/mcp-against-mock.mjs', 'other-tests'],
  ['tests/integration/mcp-against-vm.mjs', 'other-tests'],
  ['tests/integration/ssh-config-sections-vm.mjs', 'other-tests'],
  ['tests/integration/ssh-features-vm.mjs', 'other-tests'],
  ['tests/integration/ssh-restore-vm.mjs', 'other-tests'],
  ['tests/integration/ssh-system-vm.mjs', 'other-tests'],
  ['tests/integration/transport-security.mjs', 'security-backup'],
  ['tests/mock-opnsense/server.mjs', 'other-tests'],
  ['tests/plugin/package.test.mjs', 'installer-plugin'],
  ['tests/setup/bootstrap-dev.test.mjs', 'vm-onboarding'],
  ['tests/smoke/claude-doc-consistency.mjs', 'other-tests'],
  ['tests/smoke/list-tools.mjs', 'other-tests'],
  ['tests/smoke/log-file-mode.mjs', 'security-backup'],
  ['tests/smoke/redaction.mjs', 'security-backup'],
  ['tests/unit/ssh-config-editor.test.mjs', 'other-tests'],
  ['tests/vm/assign-wan.sh', 'vm-onboarding'],
  ['tests/vm/bootstrap-apikey.py', 'vm-onboarding'],
  ['tests/vm/build-registry-snapshot.test.mjs', 'vm-onboarding'],
  ['tests/vm/build-registry.mjs', 'vm-onboarding'],
  ['tests/vm/disable-pf.sh', 'vm-onboarding'],
  ['tests/vm/enable-ssh.py', 'vm-onboarding'],
  ['tests/vm/image-checksum.test.mjs', 'vm-onboarding'],
  ['tests/vm/image-sha256.txt', 'vm-onboarding'],
  ['tests/vm/install-extra-ca.sh', 'vm-onboarding'],
  ['tests/vm/install-plugins.sh', 'vm-onboarding'],
  ['tests/vm/install-plugins.test.mjs', 'vm-onboarding'],
  ['tests/vm/introspect-api.py', 'vm-onboarding'],
  ['tests/vm/provision-one-vm.test.mjs', 'vm-onboarding'],
  ['tests/vm/provision.sh', 'vm-onboarding'],
  ['tests/vm/registry-diff.mjs', 'vm-onboarding'],
  ['tests/vm/registry-diff.test.mjs', 'vm-onboarding'],
  ['tests/vm/start-vm-reproducibility.test.mjs', 'vm-onboarding'],
  ['tests/vm/start-vm.sh', 'vm-onboarding'],
  ['tests/vm/stop-vm.sh', 'vm-onboarding'],
  ['tests/vm/test_bootstrap_secret_hygiene.py', 'vm-onboarding'],
  ['tests/vm/vm-doctor.sh', 'vm-onboarding'],
  ['tests/vm/vm-doctor.test.mjs', 'vm-onboarding'],
  ['tests/vm/vm-exec.py', 'vm-onboarding']
]);
```

## Appendix B: Complete Production Group Module

This is the complete content of `scripts/provenance/groups.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIGRATION_INVENTORY } from './inventory.mjs';

export const MIGRATION_GROUP_NAMES = Object.freeze([
  'installer-plugin',
  'recent-docs',
  'vm-onboarding',
  'agentic',
  'security-backup',
  'other-tests'
]);

const RAW_GROUPS = {
  'installer-plugin': [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'plugins/opnsense-mcp/.claude-plugin/plugin.json',
    'plugins/opnsense-mcp/.codex-plugin/plugin.json',
    'plugins/opnsense-mcp/.mcp.json',
    'plugins/opnsense-mcp/skills/opnsense-guide/SKILL.md',
    'plugins/opnsense-mcp/skills/opnsense-guide/agents/openai.yaml',
    'tests/plugin/package.test.mjs',
    'src/cli/install.ts',
    'src/cli/serve.ts',
    'tests/installer/install.test.mjs'
  ],
  'recent-docs': [
    'docs/superpowers/plans/2026-07-17-release-install-safety-benchmark.md',
    'docs/superpowers/specs/2026-07-17-release-install-safety-benchmark-design.md',
    'SECURITY.md',
    'docs/adding-api-modules.md',
    'docs/api-coverage-matrix.md',
    'docs/ground-truth-eval.md',
    'docs/production.md',
    'docs/release.md',
    'docs/ssh-features.md',
    'docs/superpowers/plans/2026-06-22-ssh-backed-coverage.md',
    'docs/superpowers/plans/2026-07-17-agentic-run1-audit.json',
    'docs/superpowers/plans/2026-07-17-agentic-run1-audit.md',
    'docs/superpowers/specs/2026-06-21-cleanup-hardening-backlog.md',
    'docs/superpowers/specs/2026-06-22-ssh-backed-coverage-design.md',
    'docs/testing.md',
    'docs/tool-descriptions.md'
  ],
  'vm-onboarding': [
    'scripts/setup/bootstrap-dev.sh',
    'tests/setup/bootstrap-dev.test.mjs',
    'tests/vm/install-extra-ca.sh',
    'tests/vm/assign-wan.sh',
    'tests/vm/bootstrap-apikey.py',
    'tests/vm/build-registry-snapshot.test.mjs',
    'tests/vm/build-registry.mjs',
    'tests/vm/disable-pf.sh',
    'tests/vm/enable-ssh.py',
    'tests/vm/image-checksum.test.mjs',
    'tests/vm/image-sha256.txt',
    'tests/vm/install-plugins.sh',
    'tests/vm/install-plugins.test.mjs',
    'tests/vm/introspect-api.py',
    'tests/vm/provision-one-vm.test.mjs',
    'tests/vm/provision.sh',
    'tests/vm/registry-diff.mjs',
    'tests/vm/registry-diff.test.mjs',
    'tests/vm/start-vm-reproducibility.test.mjs',
    'tests/vm/start-vm.sh',
    'tests/vm/stop-vm.sh',
    'tests/vm/test_bootstrap_secret_hygiene.py',
    'tests/vm/vm-doctor.sh',
    'tests/vm/vm-doctor.test.mjs',
    'tests/vm/vm-exec.py'
  ],
  agentic: [
    'tests/agentic/deepeval/gt_tool_policy.py',
    'tests/agentic/model-config.json',
    'tests/agentic/deepeval/exposed-tools.txt',
    'tests/agentic/deepeval/gt_assurance.py',
    'tests/agentic/deepeval/gt_attestation.py',
    'tests/agentic/deepeval/gt_checkpoint.py',
    'tests/agentic/deepeval/gt_lib.py',
    'tests/agentic/deepeval/gt_metrics.py',
    'tests/agentic/deepeval/irreversible-exclusions.json',
    'tests/agentic/deepeval/requirements.txt',
    'tests/agentic/deepeval/run_eval.py',
    'tests/agentic/deepeval/semantic-contracts.json',
    'tests/agentic/deepeval/setup.sh',
    'tests/agentic/deepeval/test_agent_trace.py',
    'tests/agentic/deepeval/test_attestation_adversarial.py',
    'tests/agentic/deepeval/test_checkpoint.py',
    'tests/agentic/deepeval/test_config_hygiene.py',
    'tests/agentic/deepeval/test_hygiene_gate.py',
    'tests/agentic/deepeval/test_infra_classification.py',
    'tests/agentic/deepeval/test_metrics_adversarial.py',
    'tests/agentic/deepeval/test_predicate_inventory.py',
    'tests/agentic/deepeval/test_result_claims.py',
    'tests/agentic/deepeval/test_validate_adversarial.py',
    'tests/agentic/ground-truth.csv',
    'tests/agentic/run-agentic.mjs',
    'tests/agentic/temp-config-hygiene.mjs',
    'tests/agentic/verify-bridge-cleanup.test.mjs',
    'tests/agentic/verify-bridge.mjs'
  ],
  'security-backup': [
    'src/security/audit-log.ts',
    'src/security/operation-policy.ts',
    'src/http/security.ts',
    'tests/integration/backup-flow.mjs',
    'tests/integration/backup-id-collision.mjs',
    'tests/integration/guardrails.mjs',
    'tests/integration/live-script-secret-hygiene.mjs',
    'tests/integration/transport-security.mjs',
    'tests/smoke/log-file-mode.mjs',
    'tests/smoke/redaction.mjs'
  ],
  'other-tests': [
    'tests/README.md',
    'tests/helpers/live-api-client.mjs',
    'tests/helpers/mcp-client.mjs',
    'tests/helpers/private-temp-json.mjs',
    'tests/inspect.sh',
    'tests/integration/mcp-against-mock.mjs',
    'tests/integration/mcp-against-vm.mjs',
    'tests/integration/ssh-config-sections-vm.mjs',
    'tests/integration/ssh-features-vm.mjs',
    'tests/integration/ssh-restore-vm.mjs',
    'tests/integration/ssh-system-vm.mjs',
    'tests/mock-opnsense/server.mjs',
    'tests/smoke/claude-doc-consistency.mjs',
    'tests/smoke/list-tools.mjs',
    'tests/unit/ssh-config-editor.test.mjs'
  ]
};

const EXPECTED_COUNTS = [11, 16, 25, 28, 10, 15];

function buildGroups() {
  const approved = MIGRATION_INVENTORY.filter((row) => row.class === 'approved').map(
    (row) => row.destination
  );
  for (let index = 0; index < MIGRATION_GROUP_NAMES.length; index += 1) {
    if (RAW_GROUPS[MIGRATION_GROUP_NAMES[index]].length !== EXPECTED_COUNTS[index])
      throw new Error('Invalid migration groups');
  }
  const pairs = MIGRATION_GROUP_NAMES.flatMap((group) =>
    RAW_GROUPS[group].map((destination) => [destination, group])
  ).sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  );
  if (
    pairs.length !== approved.length ||
    new Set(pairs.map(([destination]) => destination)).size !== approved.length ||
    pairs.some(([destination], index) => destination !== approved[index])
  )
    throw new Error('Invalid migration groups');
  return {
    groups: Object.freeze(
      Object.fromEntries(
        MIGRATION_GROUP_NAMES.map((group) => [group, Object.freeze([...RAW_GROUPS[group]])])
      )
    ),
    lookup: Object.freeze(Object.fromEntries(pairs))
  };
}

const built = buildGroups();
export const MIGRATION_GROUPS = built.groups;
export const MIGRATION_GROUP_BY_DESTINATION = built.lookup;

export function migrationGroupFor(destination) {
  if (!Object.hasOwn(MIGRATION_GROUP_BY_DESTINATION, destination))
    throw new Error('Invalid migration group destination');
  return MIGRATION_GROUP_BY_DESTINATION[destination];
}
```

## Appendix C: Complete Independent Synthetic Baseline Fixture

This is the complete content of `tests/provenance/fixtures/private-baseline-fixture.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import {
  MIGRATION_CLASS_COUNTS,
  MIGRATION_INVENTORY,
  compareDestinations,
  isPortableDestination,
  portableCollisionKey
} from '../../../scripts/provenance/inventory.mjs';
import { EXPECTED_MIGRATION_GROUP_PAIRS } from './expected-migration-groups.mjs';

const EXPECTED_GROUP_BY_DESTINATION = new Map(EXPECTED_MIGRATION_GROUP_PAIRS);

export const PUBLIC_CONTRACT = Object.freeze({
  inventory: MIGRATION_INVENTORY,
  counts: MIGRATION_CLASS_COUNTS,
  collisionKey: portableCollisionKey,
  compare: compareDestinations,
  isPortable: isPortableDestination
});

export function digest(label) {
  return createHash('sha256').update(label).digest('hex');
}

export function canonicalFixtureBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function fixtureInventorySha256() {
  const projection = MIGRATION_INVENTORY.map(({ destination, class: assetClass }) => ({
    destination,
    class: assetClass
  }));
  return createHash('sha256').update(canonicalFixtureBytes(projection)).digest('hex');
}

export function fixtureCompositionShape(value) {
  return value.assets.map((row) => ({
    destination: row.destination,
    class: row.class,
    sourceAuthorization:
      row.sourceAuthorization === null
        ? null
        : {
            origin: row.sourceAuthorization.origin,
            relativePath: row.sourceAuthorization.relativePath,
            mappingRelationship: row.sourceAuthorization.mappingRelationship,
            contentSha256: row.sourceAuthorization.contentSha256,
            sizeBytes: row.sourceAuthorization.sizeBytes,
            mode: row.sourceAuthorization.mode,
            bundleRelationship: row.sourceAuthorization.bundleRelationship
          },
    scanReference:
      row.scanReference === null
        ? null
        : {
            relativePath: row.scanReference.relativePath,
            mappingRelationship: row.scanReference.mappingRelationship,
            contentSha256: row.scanReference.contentSha256,
            sizeBytes: row.scanReference.sizeBytes
          }
  }));
}

export function fixtureCompositionSha256(value) {
  return createHash('sha256')
    .update(canonicalFixtureBytes(fixtureCompositionShape(value)))
    .digest('hex');
}

function pendingDestinationReview() {
  return {
    expectedContentSha256: null,
    authorId: null,
    reviewerId: null,
    verdict: 'pending'
  };
}

function approvedAsset(destination, index) {
  return {
    destination,
    class: 'approved',
    sourceAuthorization: {
      origin: 'bundle',
      relativePath: destination,
      mappingRelationship: 'same-path',
      mappingRationaleSha256: null,
      contentSha256: digest(`approved-source-${index}`),
      sizeBytes: index,
      mode: index % 2 === 0 ? '100644' : '100755',
      authorId: `source-author-${index}`,
      reviewerId: null,
      reviewVerdict: 'pending-source-review',
      bundleRelationship: 'selected',
      supersessionRationaleSha256: null
    },
    scanReference: null,
    integrationReview: {
      group: EXPECTED_GROUP_BY_DESTINATION.get(destination),
      verdict: 'pending',
      integratorId: null,
      reviewerId: null
    },
    destinationReview: pendingDestinationReview(),
    discardReview: null
  };
}

function scanReferenceAsset(destination, assetClass, index) {
  return {
    destination,
    class: assetClass,
    sourceAuthorization: null,
    scanReference: {
      relativePath: destination,
      mappingRelationship: 'same-path',
      mappingRationaleSha256: null,
      contentSha256: digest(`${assetClass}-source-${index}`),
      sizeBytes: index
    },
    integrationReview: null,
    destinationReview: assetClass === 'rewrite' ? pendingDestinationReview() : null,
    discardReview: assetClass === 'discard' ? { verdict: 'discarded' } : null
  };
}

export function bindFixtureComposition(value) {
  value.sourceEvidence.compositionSha256 = fixtureCompositionSha256(value);
  return value;
}

export function makePrivateBaseline() {
  const value = {
    schemaVersion: 1,
    inventorySha256: fixtureInventorySha256(),
    sourceEvidence: {
      bundleSha256: digest('bundle'),
      selectedRevision: 'a'.repeat(40),
      compositionSha256: '0'.repeat(64),
      corpusRefCount: 1,
      corpusRefFingerprintSha256: digest('refs'),
      corpusObjectCount: 1,
      corpusFingerprintSha256: digest('objects'),
      similarityIndexBlobCount: 1,
      similarityIndexSha256: digest('similarity-index')
    },
    scanPolicy: {
      forbiddenBlobSha256: [],
      forbiddenReferences: [
        {
          category: 'legacy-reference',
          utf8Base64: Buffer.from('synthetic legacy sentinel').toString('base64')
        }
      ],
      similarityAlgorithm: 'token-5-jaccard-v1',
      similarityThresholdPermille: 750
    },
    baselineReview: {
      reviewerId: null,
      verdict: 'pending'
    },
    assets: MIGRATION_INVENTORY.map((row, index) =>
      row.class === 'approved'
        ? approvedAsset(row.destination, index)
        : scanReferenceAsset(row.destination, row.class, index)
    )
  };
  return bindFixtureComposition(value);
}

export function cloneFixture(value) {
  return structuredClone(value);
}

export function expectPrivateFailure(callback, sentinels = []) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect(caught).toMatchObject({
    name: 'PrivateProvenanceFailure',
    code: 'PRIVATE_BASELINE_INVALID',
    message: 'PRIVATE_BASELINE_INVALID'
  });
  expect(Object.hasOwn(caught, 'cause')).toBe(false);
  expect(Object.keys(caught).sort()).toEqual(['code', 'name']);
  const rendered = `${String(caught)} ${JSON.stringify(caught)}`;
  for (const sentinel of sentinels) expect(rendered).not.toContain(sentinel);
}
```
