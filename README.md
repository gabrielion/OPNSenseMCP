# OPNsense MCP

> **Foundation development snapshot:** This is not the complete OPNsense MCP product, is not
> release-ready, and does not connect to or administer OPNsense.

A safety-first Model Context Protocol and policy foundation for future guided OPNsense administration.

## Current scope

This temporary foundation provides one local read-only `server_status` tool, pedagogical prompts, a closed capability catalog, centralized policy checks, dual-era stdio, primary opt-in Streamable HTTP, and isolated deprecated-SSE compatibility. It has no OPNsense API or SSH adapter, so it performs no firewall reads and no firewall writes. No firewall mutation capability is registered. Firewall access is added only after its independent adapters, backup rules, audit rules, VM tests, and recovery checks exist.

The default is `READ_ONLY=true`. A caller cannot enable a capability by inventing its name or by passing a confirmation boolean: exposure comes from the catalog, and confirmation state is signed and checked by the server.

## Run locally

Requirements: Node.js 22.19.0 or newer within major 22, and npm.

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm ci --ignore-scripts &&
npm run build &&
node dist/main.js
```

`node dist/main.js` is a protocol-clean stdio MCP process. Configure an MCP client to run that exact
command with this repository as its working directory. The server instructions ask the agent to explain
concepts in plain language, clarify ambiguity, investigate read-only first, and obtain exact confirmation
before any future mutation.

HTTP is an explicit local-development option:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
: "${MCP_HTTP_TOKEN:?Set MCP_HTTP_TOKEN in the server shell}" &&
MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" node -e 'process.exit(process.env.MCP_HTTP_TOKEN?.length >= 32 ? 0 : 1)' &&
MCP_HTTP_ENABLED=true \
MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" \
node dist/entrypoints/http.js
```

Set `MCP_HTTP_TOKEN` to the same random 32-or-more-character value in the server shell and the client
configuration, preferably through a local secret manager. The command refuses a missing or short value and
does not print it. HTTP binds to loopback, validates Host, applies finite body/request/stream/session limits,
and requires that bearer. Non-browser clients may omit Origin. Browser Origin access is denied by default;
`MCP_ALLOWED_ORIGINS` accepts only comma-separated exact serialized origin values including scheme, host,
and port, for example `https://console.example:8443`. A same-host value with another scheme or port is not
equivalent. This is not a remote deployment endpoint.

Deprecated SSE compatibility is disabled by default. `MCP_LEGACY_SSE_ENABLED=true` adds authenticated `GET /sse` and `POST /messages` on the same hardened loopback listener without replacing Streamable HTTP at `/mcp`. It exists only for migration and must be re-reviewed or removed before release.

## Discoverable prompts

- `diagnose_network_problem`: turn a simple symptom into a read-only investigation.
- `publish_internal_service`: clarify and prepare an internal DNS, certificate, and HAProxy plan without applying it.
- `block_domain_for_device`: clarify and prepare a device-scoped DNS block without broadening it to the whole network.

Prompts guide an MCP client; they are not authorization and they do not bypass policy.

## Tested evidence

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run verify &&
npm run test:conformance
```

`npm run verify` runs formatting, lint, strict TypeScript, the JavaScript/TypeScript AGPL header gate,
build, and deterministic Vitest tests. Its real subprocess test makes six official child invocations,
captured inside Vitest. The public `npm run test:conformance` command runs the same six scenario/version
tuples again: `server-initialize`, `ping`, and `tools-list` at `2025-11-25`, then `tools-list`,
`input-required-result-unsupported-methods`, and `http-header-validation` at draft `2026-07-28`.
Consequently the combined gate makes six public-script invocations and twelve official child invocations.
For both protocol versions stderr remains empty, including the five expected negative header probes, and
accepted `checks.json` records contain only `SUCCESS` or `INFO`. There is no expected-failure baseline.
This is targeted interoperability evidence, not full-suite conformance.

The three MCP v2 packages `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and
`@modelcontextprotocol/node` are deliberately pinned to `2.0.0-beta.4` for this foundation. Before public
package publication, all three must be repinned to one stable MCP v2 release together and every
deterministic and conformance gate must pass again. The optional `@modelcontextprotocol/express` helper
package is intentionally not installed: direct Express integration preserves the project-owned guard
order of exact Host -> exact serialized Origin -> shutdown admission gate -> bounded body receipt ->
authentication. During shutdown the gate closes synchronously, so a later request on an already-active
connection receives a fixed sanitized 503 response and cannot reach MCP dispatch.

Separately, the isolated deprecated-SSE adapter pins the legacy `@modelcontextprotocol/sdk@1.29.0`
exactly. Before release run `npm run release:check:legacy-sse` and `npm audit --omit=dev`, then decide
explicitly whether compatibility can be removed.

## License

AGPL-3.0-or-later. See `LICENSE`.
