# Contributing

Use Node.js 22.19 or newer within major 22. Never develop or test against a production firewall. Offline tests
use synthetic HTTPS fixtures; the live gate owns a disposable OPNsense 26 VM.

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

## Live disposable-VM gate

Requirements: macOS or Linux, Node.js 22, `qemu-system-x86_64`, `qemu-img`, `curl`, and `bzip2`. On macOS,
Homebrew's `qemu` package provides the QEMU commands; the operating system already provides the download and
decompression commands.

```bash
npm run vm:doctor
npm run test:product1b
npm run vm:product3 -- --attestation-out "$PWD/docs/evidence/product3-vm.json"
```

The first live run downloads the SHA-256-pinned official OPNsense 26.1.6 nano archive into the user cache.
The test needs no operator credential: it drives the disposable image's own unauthenticated single-user
console to install its bootstrap helper. It then owns start,
least-privilege API bootstrap, TLS pinning, npm pack/install, all four MCP read-tool calls (`server_status`,
`opn_describe system.status`, `opn_get system.status`, and `opn_list core.services`), the last two issuing
the two remote OPNsense API calls, stop, credential deletion, overlay deletion, and residue verification. A
setup or read failure still runs cleanup and exits nonzero.

Both live runners install through the same hermetic preparation as the installed-package suite: the consumer
is served only by a loopback registry built from the committed lock, so the proof depends on this repository
rather than on the developer's npm cache or on upstream release timing. A plain `npm install --offline`
cannot be used here — the consumer resolves the archive's ranges afresh, picks any newly published
transitive version and then fails `ENOTCACHED`.

`vm:product3` runs the bounded firewall-alias lifecycle — list, create, read back, delete, prove absence.
It boots and owns **its own** VM: it refuses to start while another managed VM is running, bootstraps its
own alias-write account without any operator credential, and stops and cleans up afterwards. It sets
`READ_ONLY=false`, `ENABLED_FEATURE_FLAGS=experimental-alias-write` and an explicit `ALLOWED_RESOURCES`
naming `server.status,system.status,core.services,firewall.alias`, because a write is refused without the
first three and `server_status` disappears without the fourth scope.

For lifecycle diagnosis only, the same pieces are available separately:

```bash
npm run vm:start
npm run vm:bootstrap
npm run vm:status
npm run vm:stop
```

Run only one managed VM at a time. These commands are for the disposable lab, never a real firewall.

`vm:bootstrap` starts and owns its own VM and refuses to run while a managed VM is already running. The
unauthenticated single-user shell only exists inside the loader window a few seconds after launch, and QEMU
discards console output while nothing is attached, so the bootstrap must be present from the launch. It is
not a step you can apply to an already running VM.

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

## Release gate

`npm run verify` is the per-commit gate. Two further checks belong to a release rather than to a commit:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run evidence:check &&
npm run evidence:verify
```

The first check compares the sealed OpenCode evidence against the package this tree builds. Anything that
is packed changes that package — `src/` through `dist/`, and also `README.md`, `LICENSE` and
`package.json` — so this check is expected to fail until the evidence is re-sealed by its real producer,
`npm run smoke:opencode`, which needs the OpenCode client and a model. The second check requires the
commit-bound Product 3 VM attestation to remain coherent with the release history. The VM verifier accepts
either the exact pre-evidence commit and tree or one later commit whose sole change is
`docs/evidence/product3-vm.json`. Never hand-edit either evidence document; renew each one only with its
real producer.

## Change discipline

1. Add a focused failing test and observe the expected failure.
2. Make the smallest implementation change that passes it.
3. Run the focused test, then the deterministic gate above.
4. Keep one coherent local commit; do not push unless asked.

Every JavaScript and TypeScript source starts with
`// SPDX-License-Identifier: AGPL-3.0-or-later`. `npm run license:check` enforces this. Keep secrets,
temporary MCP configuration, generated tarballs, and raw client output out of the repository.
