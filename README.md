<div align="center">

# OPNsense MCP

**Ask your firewall questions in plain language.**<br>
An MCP server for OPNsense — read-only by default, and honest about what it proves.

[![CI](https://github.com/gabrielion/OPNSenseMCP/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/gabrielion/OPNSenseMCP/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19%20%3C23-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-6f42c1)](https://modelcontextprotocol.io)
[![Proven on OPNsense 26.7](https://img.shields.io/badge/proven%20on-OPNsense%2026.7-d94f00)](docs/evidence/product3-vm.json)

[Quickstart](#quickstart) · [Setup guide](docs/setup-your-opnsense.md) ·
[What it does](#what-works-now) · [What it proves](#how-this-preview-is-tested) ·
[Status](docs/project-status.md)

</div>

---

> **Preview:** a small MCP server that lets an AI assistant inspect an OPNsense system, and — only
> when explicitly enabled — create or delete one kind of firewall alias behind a confirmation,
> backup and audit envelope. It is read-only by default. The packaged server is exercised against
> both a synthetic HTTPS target and a disposable OPNsense 26 VM.

Ask in everyday language. The server tells the agent to start with facts, explain networking terms, ask one
useful clarification at a time, and clearly separate observations from hypotheses.

## Quickstart

Read-only, about 15 minutes. Requires Node.js 22.19 or newer within major 22, on macOS or Linux.

**1. Store your firewall credentials**

```bash
npx -y @gabrielion/opnsense-mcp configure
```

It asks for the HTTPS origin, an API key and secret, and an optional CA file. Nothing is echoed and
nothing is passed as a process argument. Need to create that key first? The
[setup guide](docs/setup-your-opnsense.md) walks the OPNsense side with screenshots.

**2. Connect your assistant**

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add --env READ_ONLY=true --transport stdio opnsense -- npx -y @gabrielion/opnsense-mcp
```

</details>

<details>
<summary><b>Codex</b> — <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.opnsense]
command = "npx"
args = ["-y", "@gabrielion/opnsense-mcp"]

[mcp_servers.opnsense.env]
READ_ONLY = "true"
```

</details>

<details>
<summary><b>OpenCode</b> — <code>opencode.json</code></summary>

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "opnsense": {
      "type": "local",
      "command": ["npx", "-y", "@gabrielion/opnsense-mcp"],
      "environment": { "READ_ONLY": "true" }
    }
  }
}
```

</details>

**3. Ask something**

> _What is my OPNsense system status?_
>
> _Which services are running on my firewall?_

Run `/mcp` first: the server should read `connected`. Adding it does not validate credentials, so
`connected` is the real signal.

> [!TIP]
> **No firewall handy, or not ready to point this at yours?** `npm run test:product1b` boots a
> disposable OPNsense VM, creates its own least-privilege account with no credential of yours,
> proves the whole read surface against it, and cleans up.

## What works now

By default the installed server exposes four read-only tools:

- `server_status` checks the MCP process and its read-only state.
- `opn_describe` explains a visible resource before the agent uses it.
- `opn_get` reads the singleton resource `system.status`.
- `opn_list` pages the collection resources `core.services` and `firewall.alias`. For aliases it lists the
  **host entries only**, and the reported total counts those; other alias types are not shown.

Three MCP prompts are also always registered — `diagnose_network_problem`, `publish_internal_service` and
`block_domain_for_device`. They only produce a read-only preparation plan; they execute nothing.

`READ_ONLY=true` is the default, and under it no write tool is listed or dispatchable.

Two experimental write tools exist, `opn_create` and `opn_delete`, and they operate on host entries of
`firewall.alias` only. Three conditions plus a supported transport decide whether they are **listed** at
all:

- `READ_ONLY=false`;
- `ENABLED_FEATURE_FLAGS` contains `experimental-alias-write`;
- `ALLOWED_RESOURCES` explicitly names `firewall.alias`. An absent or empty allow-list authorizes every
  read and **no** write. The allow-list filters reads too, so name every scope you still want, for
  example `ALLOWED_RESOURCES=server.status,system.status,core.services,firewall.alias`;
- the transport is stdio or Streamable HTTP. Legacy SSE never lists or dispatches them.

A fourth condition governs the **call** rather than the listing: the client must have negotiated form
elicitation. A client without it still sees the tools and is refused with `CONFIRMATION_UNAVAILABLE` on
every attempt, before any challenge or write.

Every write runs this fixed envelope, in this order: authorization, a human confirmation naming the
change, an exclusive lock on the target, a side-effect-free preflight, a redacted audit intent, a verified
pre-change backup, a re-check that the observed state has not moved, the write, an outcome verification, a
final audit record, and the lock release. Every failure after the backup preserves it and never
blind-restores.

**These writes are experimental for a reason.** The pre-change backup is written to a per-process
temporary directory that is **deleted when the server shuts down**, so it cannot be consulted afterwards.
The audit is an in-memory ring holding only the most recent 1024 records (two per write), with no
persisted form and no tool that reads it. The lock is process-local, so two servers pointed at the same
firewall do not exclude each other.

What the envelope does guarantee is narrow but real: a write is refused unless a verified backup and an
audit intent were recorded first. There is **no restore and no rollback** — if a failure occurs after the
change was applied, the change stays applied and recovery is manual through OPNsense's own configuration
history. Making this state durable is the next milestone.

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

The supported way to supply credentials is the interactive command, which writes the private file for you
with the right ownership and modes. From a clone it is a subcommand of the built entry point:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
node dist/main.js configure
```

Installed from the registry, the same subcommand is `npx -y @gabrielion/opnsense-mcp configure`.

It prompts for the HTTPS origin, API key, API secret, and the optional CA file and TLS server name; the
secrets are never echoed and never appear in a process argument. It refuses to run on Windows and refuses
any argument.

It always writes to the platform path and **ignores `OPNSENSE_CONFIG_FILE`**, which is a server-side
variable:

- macOS: `~/Library/Application Support/opnsense-mcp/config.json`;
- Linux: `$XDG_CONFIG_HOME/opnsense-mcp/config.json`, else `~/.config/opnsense-mcp/config.json`.

The server discovers those same paths, so the variable is only needed to read a file kept elsewhere. Each
directory it owns is created with mode `0700` and the file with mode `0600`; symlinks, foreign owners and
unsafe ancestors are refused.

Two practical limits: it **never overwrites** an existing configuration, so rotate a key by deleting the
file first; and it requires a real terminal on both streams, so it cannot be piped or run in CI. Every
failure prints the single word `Error` on purpose — diagnostics are deliberately opaque so nothing about
the private path or the credentials leaks.

Alternatively, create the JSON file yourself outside the repository and protect it with mode `0600`:

```json
{
  "url": "https://192.0.2.1",
  "apiKey": "your-dedicated-read-only-api-key",
  "apiSecret": "your-api-secret",
  "caFile": "/absolute/path/to/your-ca.pem",
  "tlsServerName": "firewall.example.internal"
}
```

The file must be a regular, non-symlink file owned by the current user, at an absolute path, with exactly
mode `0600`, exactly one hard link, and at most 16 KiB. `0400` is refused too. `url` must be one exact
HTTPS origin. `caFile` is optional when the firewall certificate already chains to a trusted CA.
`tlsServerName` is optional when the URL uses an IP address but the verified certificate uses a DNS name.
TLS verification always remains enabled. Use a dedicated least-privilege OPNsense key; do not paste
credentials into chat or command arguments.

**Transports.** stdio is the default and the only transport exercised end to end by the packaged proofs;
`dist/main.js` always starts stdio. A Streamable HTTP transport exists as a separate entry point
(`npm run start:http`) behind `MCP_HTTP_ENABLED`, bound to loopback with a Host/Origin allow-list and a
bearer `MCP_HTTP_TOKEN` of at least 32 characters; it is not covered by a client smoke, so no
client-support claim is made for it. A legacy SSE compatibility surface exists behind
`MCP_LEGACY_SSE_ENABLED`, which additionally requires `MCP_HTTP_ENABLED=true` — setting it alone is a
startup error — and never exposes the confirmation-backed write tools.

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
whole live test: it verifies and caches the pinned official OPNsense 26.7 nano image, starts one local VM,
creates a disposable least-privilege API user over the serial console without any operator credential,
packs and installs this npm package, calls `server_status`, `opn_describe system.status`,
`opn_get system.status` and `opn_list core.services` through one MCP session, then stops the VM and removes
the overlay, API credentials, certificate, and temporary package. The first run downloads an approximately
557 MB archive and creates a 3 GiB read-only base image in the user cache.

The historical Product 1B evidence remains the proof for only two remote calls:
`GET /api/core/system/status` and `POST /api/core/service/search`. Its sanitized
[machine-readable evidence](tests/fixtures/product1b.live.json) also records its exact host, QEMU, firmware,
transport and cleanup checks without retaining firewall data or credentials.

The alias-write implementation targets `GET /api/core/backup/download/this` for the pre-change backup, then
`POST /api/firewall/alias/searchItem`, `addItem` or `delItem/{uuid}`, then the `reconfigure` apply. Those
endpoint details have deterministic synthetic-target coverage. Product 3 proves on a disposable VM the
following only: the writable surface and this exact `firewall.alias` lifecycle: absent, create, present,
delete, absent, followed by VM cleanup and a residue-free check. The
[commit-bound Product 3 VM attestation](docs/evidence/product3-vm.json) records the tested commit and tree,
pinned firmware image, policy inputs and fixed lifecycle checks without retaining firewall data or
credentials. The Product 3 attestation does not prove production use, durable state, durable backups, a
durable audit trail, restore, or automatic rollback.

**Disposable-account privileges.** The accounts are created with exactly these stock ACLs, and nothing
else. Both ACL profiles now have live evidence only in their exact scenarios: the read-only profile in
Product 1B and the alias-write profile in Product 3.

- read-only account: `page-system-status`, `page-status-services`, `user-config-readonly`;
- alias-write account: `page-system-status`, `page-status-services`,
  `page-diagnostics-configurationhistory`, `page-firewall-alias-edit`.

`user-config-readonly` is deliberately **absent** from the alias-write account: we observed that it makes
the OPNsense mutable-model controller reject alias saves. `page-diagnostics-configurationhistory` is
granted for the pre-change configuration-backup request. Both statements come from our own bootstrap
experience, not from a cited upstream mapping.

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
- Historical clean npm pack/install against a disposable OPNsense 26.1.6 VM for the two Product 1B remote
  calls, including VM ownership, pinned image integrity, isolated credentials, TLS pinning and reverse
  cleanup.
- A commit-bound Product 3 run against a disposable OPNsense 26.7 VM for the writable surface and exact
  host-alias lifecycle: absent, create, present, delete, absent, followed by VM cleanup and a residue-free
  check.
- A hermetic package install for the synthetic-target proof **and both VM runners**: the consumer resolves
  every dependency from a lock-derived loopback-only npm registry, with an empty cache and unreachable
  proxies, so no Internet access is involved and no upstream release can change what is installed.
- Targeted MCP interoperability checks for protocol versions `2025-11-25` and draft `2026-07-28`.
- One real OpenCode 1.18.3 routing smoke using `opencode/north-mini-code-free`.

The complete development state and machine-to-machine handoff are recorded in
[`docs/project-status.md`](docs/project-status.md). The planned canonical agent evaluation is specified in
the [DeepEval and OPNsense evaluation design](docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md):
it will evaluate Claude Code's MCP tool use and final response while separately requiring deterministic
MCP readback of the disposable VM state. Those tests and any benchmark score are not implemented or claimed
yet.

Together, these checks cover the package, synthetic read path, the two stated historical Product 1B remote
calls, and no more than the bounded lifecycle stated above. They do **not** prove:

- public DNS, ACME, or HAProxy exposure on the Internet;
- behavior against a production firewall;
- durable backups or a durable audit trail: both exist, but only for the lifetime of the process;
- restore, or any automatic rollback of an applied change;
- writes to anything other than host entries of `firewall.alias`;
- any guarantee beyond the first 100 host aliases: the pre-change state digest and the read-back both read
  a single page of 100, so past that a create can report an unverified outcome and a delete can only prove
  that the entry was not on the page it read;
- native Windows installation or client operation;
- a full agentic benchmark or a benchmark score.

Raw API dispatch, free-form shell/SSH, bulk IaC, a dashboard, and broad legacy parity are absent.

## Product roadmap and example requests

The mutation safety envelope — scoped authorization, human confirmation, verified backup, redacted audit,
outcome verification, fail-closed cleanup — is implemented and proven against a synthetic HTTPS target. The
next
milestone is to make its state durable: a persistent state root, an inter-process lock, an append-only
audit, and a local `reconcile` command, so the guarantees survive a restart. Only then can the
`experimental` label on alias writes be reconsidered.

Later guided workflows are deliberately user-level goals, for example:

- “My laptop loses Internet every evening. Can you investigate and explain what you find?”
- “Block TikTok only for my child's tablet, without affecting the other devices.”
- “Publish this service internally with a friendly DNS name, an internal certificate, and a reverse proxy.”

Those three workflows are roadmap examples, not Product 1A claims. Internet-facing publication with public
DNS, Let's Encrypt, and HAProxy is a longer-term lab milestone after safe writes and private-VM coverage.

**Distribution status:** this package is prepared for npm as `@gabrielion/opnsense-mcp`, with public
access, registry metadata, and a `prepare` script so that a git-URL install builds its own `dist/`.
Publication is a maintainer action and is **not published** until `npm publish` has run; until then,
install from a clone. The packaged proofs install a locally built tarball served by a lock-derived
loopback registry either way, so what they exercise is this tree rather than any registry copy. No
versioning or upgrade guarantee is offered yet.

**Platform status:** macOS and Linux are the currently verified development hosts. Native Windows remains a required product target, but package and client support are not claimed until the later `windows-2025` gate passes.

## License and trademark

Licensed under AGPL-3.0-or-later; see [LICENSE](LICENSE). The AGPL permits commercial use while requiring
covered source availability, including for network use. OPNsense is a trademark of Deciso B.V. This
independent project is not affiliated with, sponsored by, or endorsed by Deciso B.V. or the OPNsense project.
