# OPNsense MCP

> **Product 1 preview:** a small, useful, read-only MCP server that lets an AI assistant inspect an
> OPNsense system without changing it. The packaged server is exercised against both synthetic HTTPS and a
> disposable OPNsense 26 VM.

Ask in everyday language. The server tells the agent to start with facts, explain networking terms, ask one
useful clarification at a time, and clearly separate observations from hypotheses.

## What works now

The installed server exposes exactly four read-only tools:

- `server_status` checks the MCP process and its read-only state.
- `opn_describe` explains a visible resource before the agent uses it.
- `opn_get` reads the singleton resource `system.status`.
- `opn_list` pages the collection resource `core.services`.

`READ_ONLY=true` is the default. No mutation tool is registered, so this preview cannot change firewall
configuration. Future writes will be added only behind a verified backup and audit safety envelope.

## Quick local proof

Requirements: Node.js 22.19 or newer within major 22, npm, macOS or Linux.

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm ci --ignore-scripts &&
npm run test:product1a &&
npm run build
```

`npm run test:product1a` creates a clean npm tarball, installs it in an isolated consumer project, connects
it to a separately owned synthetic HTTPS OPNsense target, calls all three OPNsense tools through raw MCP
stdio, checks that secrets never appear, closes on EOF, and removes every fixture.

## Connect your OPNsense instance

Create a JSON file outside the repository and protect it with mode `0600`:

```json
{
  "url": "https://192.0.2.1",
  "apiKey": "your-dedicated-read-only-api-key",
  "apiSecret": "your-api-secret",
  "caFile": "/absolute/path/to/your-ca.pem",
  "tlsServerName": "firewall.example.internal"
}
```

The file must be a regular, non-symlink file owned by the current user. `url` must be one exact HTTPS
origin. `caFile` is optional when the firewall certificate already chains to a trusted CA.
`tlsServerName` is optional when the URL uses an IP address but the verified certificate uses a DNS name.
TLS verification always remains enabled. Use a dedicated least-privilege OPNsense key; do not paste
credentials into chat or command arguments.

To run the protocol-clean stdio server directly:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
OPNSENSE_CONFIG_FILE="/absolute/path/to/opnsense.json" READ_ONLY=true node dist/main.js
```

Never point development or tests at a production firewall. Use the disposable-VM proof below for live work.

## Disposable OPNsense 26 proof

On macOS or Linux, install QEMU plus Node.js 22, then run:

```bash
npm run vm:doctor
npm run test:product1b
```

`vm:doctor` reports each missing host dependency without changing the machine. `test:product1b` owns the
whole live test: it verifies and caches the pinned official OPNsense 26.1.6 nano image, starts one local VM,
asks for the factory password without echoing or storing it, creates a disposable least-privilege API user,
packs and installs this npm package, calls `opn_get system.status` and `opn_list core.services`, then stops the
VM and removes the overlay, API credentials, certificate, and temporary package. The first run downloads an
approximately 557 MB archive and creates a 3 GiB read-only base image in the user cache.

The observed OPNsense 26 contract is `GET /api/core/system/status` and a bounded
`POST /api/core/service/search` Bootgrid request. This proves only these two reads on disposable local
firmware; it does not test a production firewall or an Internet-facing deployment. The sanitized
[machine-readable live evidence](tests/fixtures/product1b.live.json) records the exact host, QEMU, firmware,
transport, cleanup checks, and non-claims without retaining firewall data or credentials.

## OpenCode

Add a project-level `opencode.json` (replace both absolute paths):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opnsense": {
      "type": "local",
      "command": ["node", "/absolute/path/to/OPNSenseMCP/dist/main.js"],
      "environment": {
        "READ_ONLY": "true",
        "OPNSENSE_CONFIG_FILE": "/absolute/path/to/opnsense.json"
      }
    }
  }
}
```

Then run `opencode mcp list`; `opnsense` should be connected. The committed smoke evidence covers only
OpenCode 1.18.3 with `opencode/north-mini-code-free` against the installed tarball and synthetic HTTPS
target. It records tool/result digests, not firewall data or credentials. See the
[machine-readable evidence](tests/fixtures/opencode.product1a.json).

Other MCP clients can launch the same stdio command, but no client-specific support claim is made until its
own versioned smoke passes.

## How this preview is tested

- Strict TypeScript, formatting, lint, license headers, and deterministic unit/integration tests.
- Clean npm pack/install plus TLS, Basic authentication, response validation, secret redaction, shutdown,
  and cleanup against a synthetic target.
- Clean npm pack/install against a disposable OPNsense 26.1.6 VM for the status and service-list reads,
  including VM ownership, pinned image integrity, isolated credentials, TLS pinning, and reverse cleanup.
- Targeted MCP interoperability checks for protocol versions `2025-11-25` and draft `2026-07-28`.
- One real OpenCode 1.18.3 routing smoke using `opencode/north-mini-code-free`.

These checks prove the package, synthetic read path, and the two stated disposable-VM reads. They do **not**
yet prove:

- public DNS, ACME, or HAProxy exposure on the Internet;
- mutations, verified backups, restore, or audit behavior;
- native Windows installation or client operation;
- a full agentic benchmark or a benchmark score.

## Product roadmap and example requests

The next milestone is the central mutation safety envelope: verified backup, scoped authorization, redacted
audit, outcome verification, and fail-closed cleanup before any public write tool exists.

Later guided workflows are deliberately user-level goals, for example:

- “My laptop loses Internet every evening. Can you investigate and explain what you find?”
- “Block TikTok only for my child's tablet, without affecting the other devices.”
- “Publish this service internally with a friendly DNS name, an internal certificate, and a reverse proxy.”

Those three workflows are roadmap examples, not Product 1A claims. Internet-facing publication with public
DNS, Let's Encrypt, and HAProxy is a longer-term lab milestone after safe writes and private-VM coverage.

**Platform status:** macOS and Linux are the currently verified development hosts. Native Windows remains a required product target, but package and client support are not claimed until the later `windows-2025` gate passes.

## License and trademark

Licensed under AGPL-3.0-or-later; see [LICENSE](LICENSE). The AGPL permits commercial use while requiring
covered source availability, including for network use. OPNsense is a trademark of Deciso B.V. This
independent project is not affiliated with, sponsored by, or endorsed by Deciso B.V. or the OPNsense project.
