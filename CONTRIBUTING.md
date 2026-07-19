# Contributing

Use Node.js 22.19 or newer within major 22. Never develop or test against a production firewall. Product 1A
uses only synthetic HTTPS fixtures; Product 1B will own the disposable OPNsense 26 VM workflow.

**Platform status:** macOS and Linux are the currently verified development hosts. Native Windows remains a required product target, but package and client support are not claimed until the later `windows-2025` gate passes.

## One-command development gate

From the repository root:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
node --version &&
npm ci --ignore-scripts &&
npm run test:product1a &&
npm run verify &&
git diff --check
```

`test:product1a` is the fast product proof: clean pack, isolated install, synthetic TLS target, all Product
1A reads, secret redaction, EOF shutdown, and residue cleanup. `verify` runs the complete deterministic
offline suite. Both must exit `0`.

## Protocol gates

Run these after any server, schema, prompt, or transport change:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run test:conformance:2025 &&
npm run test:conformance:2026
```

These are targeted interoperability scenarios, not a claim of complete protocol conformance.

## Optional OpenCode smoke

With OpenCode installed, run:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run smoke:opencode
```

The runner uses an isolated project, installed tarball, synthetic HTTPS target, and the free
`opencode/north-mini-code-free` model. It writes sanitized evidence to
`tests/fixtures/opencode.product1a.json`: only versions, SHA-256 digests, narrow checks, and cleanup status.
External model or capacity failure exits `3` and records `blocked`; it never becomes a false success.

## Change discipline

1. Add a focused failing test and observe the expected failure.
2. Make the smallest implementation change that passes it.
3. Run the focused test, then the deterministic gate above.
4. Keep one coherent local commit; do not push unless asked.

Every JavaScript and TypeScript source starts with
`// SPDX-License-Identifier: AGPL-3.0-or-later`. `npm run license:check` enforces this. Keep secrets,
temporary MCP configuration, generated tarballs, and raw client output out of the repository.
