# Contributing

Use Node.js 22.19.0 or newer within major 22. Never test against a production firewall. This foundation has no firewall adapter; future live tests must use a disposable, explicitly selected local VM.

## Install and deterministic verification

From the repository root:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
node --version &&
npm ci --ignore-scripts &&
npm run verify &&
git diff --check
```

The Node version must satisfy `>=22.19 <23` and every command must exit `0`.

## Protocol verification

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run test:conformance:2025 &&
npm run test:conformance:2026
```

The first command runs targeted `server-initialize`, `ping`, and `tools-list` scenarios at `2025-11-25`.
The second runs targeted `tools-list`, `input-required-result-unsupported-methods`, and
`http-header-validation` at draft `2026-07-28`. These are six public-script invocations. If they follow
`npm run verify`, the combined gate has twelve official child invocations because Vitest already ran the
same six tuples. Both versions keep stderr empty, including expected negative header probes, and accepted
reports contain only `SUCCESS` or `INFO`. Do not introduce an expected-failure baseline or describe these
six public invocations as a full suite.

## Change discipline

1. Add a focused failing test for the behavior.
2. Make the smallest implementation change that passes it.
3. Run the focused test, then `npm run verify`.
4. Run protocol conformance for any server, schema, prompt, or transport change.
5. Commit one coherent change with no generated output, secret, or local result directory.

Every JavaScript and TypeScript source begins with `// SPDX-License-Identifier: AGPL-3.0-or-later`.

`npm run license:check` enforces those source headers. The later provenance workflow owns the broader release-tree and history scan; do not treat the source-header check as provenance evidence.
