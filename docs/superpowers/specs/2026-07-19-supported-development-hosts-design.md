# Native Windows Product Support and Development Hosts Design

**Date:** 2026-07-19

**Status:** Approved design; written specification awaiting owner review

## Context

OPNsenseMCP must be usable as a local MCP server on a native Windows workstation with supported clients such
as Claude Code, Codex, OpenCode, and Kimi. Native Windows means PowerShell or `cmd.exe` without requiring WSL,
Python, QEMU, a compiler, a custom service, or another platform-compatibility layer. Node.js `>=22.19 <23` and
npm are the only OPNsenseMCP runtime prerequisites; each MCP client may retain its own documented prerequisites.

The official TypeScript MCP server examples use npm packages launched through `npx`. Their Windows examples
wrap `npx` with `cmd /c`. OPNsenseMCP will follow that established distribution shape instead of introducing a
Windows executable, MSI, Winget package, or native launcher.

Product runtime support, contributor test-host support, and the disposable OPNsense VM are separate concerns.
The current runtime is platform-neutral Node.js code, while deterministic CI evidence exists only on Linux and
local evidence exists on macOS. The current installed-package test harness also contains simulated Windows
`cmd.exe`, junction, `SystemRoot`, and `taskkill /T` paths. Those projections have never run on Windows.

Review established that `taskkill /T` cannot prove cleanup of a descendant after its direct parent exits. That
limitation affects the internal generic bounded-command harness, not the MCP server's normal runtime: the
server does not create descendant processes. Building a Job Object helper solely to preserve an unnecessarily
broad test-harness contract would add native code and installation complexity without improving the product.

## Decision

Native Windows is a product installation and runtime target. macOS and Linux remain the supported hosts for the
complete contributor suite, disposable OPNsense VM, live firewall tests, and canonical agentic benchmark.

The product uses one npm package on every supported platform. Its primary guided installation command is:

```text
npx -y @gabrielion/opnsense-mcp install
```

The installer supplies client-specific adapters. On Windows, stdio client entries follow the official command
shape with `cmd` as the executable and `["/c", "npx", "-y", "@gabrielion/opnsense-mcp"]` as arguments. The
implementation must represent command and arguments as separate array elements and must not interpolate shell
command strings.

Native client marketplace or plugin adapters may provide an even shorter installation path where the client's
official distribution model supports it. The npm installer remains the common fallback and the primary path for
OpenCode, whose plugin model is not a package format for MCP servers.

## Product installation contract

The guided installer must:

- run from native PowerShell or `cmd.exe` without WSL;
- discover or accept an explicit target client and ask before changing its configuration;
- support repeatable non-interactive client selection without accepting a credential in process arguments;
- preserve unrelated MCP servers and settings;
- write client changes atomically and restore the previous file if a later installation step fails;
- install or update only entries owned by OPNsenseMCP;
- provide an idempotent uninstall that removes only owned entries;
- print an actionable validation command for the selected client.

The project will implement adapters for Claude Code, Codex, OpenCode, and Kimi from their current official
configuration and CLI documentation. Client-specific requirements are isolated behind those adapters so one
client's format or command changes do not alter the package runtime or another client.

## Configuration and secrets

Credentials must never appear in client configuration, command arguments, logs, committed files, benchmark
artifacts, or error messages. Clients receive only the path to the private OPNsenseMCP configuration through
`OPNSENSE_CONFIG_FILE`.

The native Windows default is:

```text
%APPDATA%\OPNsenseMCP\config.json
```

The installer obtains credentials through a non-echoing interactive prompt or another input channel that does
not expose them in the process list. It writes the file atomically and fails closed unless inheritance is
disabled and the final Windows ACL can be verified by SID to grant access only to the current user, `SYSTEM`,
and the built-in Administrators group. It may use Windows facilities already present on the operating system,
but it must not require users to install a security helper. POSIX hosts retain directory mode `0700` and file
mode `0600` checks.

Neither a failed installation nor an uninstall may delete a pre-existing user configuration that the installer
does not own. Diagnostics may identify a configuration path but must not echo configuration contents, secrets,
or untrusted values in a shell command.

## Test-harness boundary

The generic bounded-command harness is an internal POSIX test facility. Its strong guarantee is that a bounded
command and its cooperative inherited process group are absent before the harness returns on macOS or Linux.
It must not claim the same guarantee from `taskkill /T`.

The current foundation remediation will remove the Windows `taskkill` containment claim from that harness and
its supervisor. Windows package and runtime validation will use a separate product-specific smoke path rather
than a generic arbitrary-command tree controller. Platform projections used by client adapters may remain as
unit tests, but they are design checks and never count as native Windows execution evidence.

No production runtime path may reject Windows merely because the internal POSIX harness does. The POSIX harness
diagnostic must name the internal facility and direct maintainers to the Windows product smoke; it must not say
that OPNsenseMCP itself is unsupported on Windows.

## Validation order and evidence

Native Windows execution is the final platform gate before publication, by owner decision. Windows-aware code
and client adapters are designed and unit-tested during their normal implementation tasks, but the project must
not claim native Windows support until the final real Windows gate succeeds.

The validation order is:

1. deterministic foundation and product tests;
2. mock behavior and disposable OPNsense VM tests on Linux or macOS;
3. client workflows and canonical agentic benchmark;
4. native Windows package, installer, runtime, and mock smoke as the final platform gate.

The final native Windows gate initially uses a pinned `windows-2025` GitHub-hosted runner rather than the moving
`windows-latest` label. It uses Node.js `22.19.0` and must at least prove:

- a clean npm package can be packed and installed in a path containing spaces;
- the installed `.cmd` shim launches through native Windows command handling;
- invalid configuration fails without leaking a sentinel secret;
- MCP `initialize`, `notifications/initialized`, `tools/list`, and a read-only tool call succeed over stdio;
- the guided installer changes each supported client only inside an isolated test profile;
- the Windows private configuration path and ACL policy are applied and verified;
- a mock OPNsense connection works once the product adapter exists;
- EOF closes the exact MCP server process within a fixed deadline;
- the repository and isolated profiles contain no unexpected residue after cleanup.

This smoke proves the product process that is actually shipped. Because that process does not spawn descendants,
exact process closure is the required postcondition. If a future product feature starts descendant processes, it
must introduce an independently reviewed Windows containment design before that feature can enter the Windows
support claim.

Individual client claims require a native configuration or connection smoke for that adapter. Authentication-
or subscription-dependent model calls may use a separate owner-attested run; a public CI job must not require a
personal subscription or store its credentials.

## Documentation and claims

README and CONTRIBUTING material must distinguish:

- product installation and runtime hosts;
- MCP clients and their upstream prerequisites;
- complete contributor and VM test hosts;
- evidence already executed versus final gates still pending.

Before the native Windows gate exists, documentation may say that native Windows is a designed release target
or is awaiting validation. It must not say that Windows is tested or supported. After the gate passes, the README
may present the native PowerShell/`cmd.exe` quick start and link the machine-readable Windows evidence.

The documentation must not recommend WSL as a requirement for OPNsenseMCP. It may accurately mention an MCP
client's own upstream WSL recommendation without converting that recommendation into a server requirement.

## Out of scope

- Running the disposable OPNsense VM or canonical benchmark on Windows.
- A Windows Job Object helper for the current server, which creates no descendants.
- MSI, Winget, Chocolatey, Scoop, Docker Desktop, WSL, or a native executable distribution.
- Claiming that every MCP client feature or sandbox mode is identical across operating systems.
- Publishing the npm package or a release before all release gates are green.

## Success criteria

- The design and plans identify native Windows as a product target without expanding the VM test matrix.
- One npm package and guided installer cover Windows, macOS, and Linux without shell-string interpolation.
- Windows client configurations contain a config-file path but no credential.
- The internal POSIX harness makes no false Windows descendant-cleanup claim.
- The final real Windows gate proves package installation, secure configuration, MCP protocol behavior, exact
  server-process exit, mock connectivity, client adapter isolation, and cleanup.
- Public documentation reports only evidence that has actually run and links the final Windows result before
  claiming support.

## Primary references

- Model Context Protocol official server examples: <https://github.com/modelcontextprotocol/servers#using-mcp-servers-in-this-repository>
- Claude Code MCP configuration: <https://code.claude.com/docs/en/mcp>
- OpenCode MCP configuration: <https://opencode.ai/docs/mcp-servers>
- GitHub-hosted runner images: <https://docs.github.com/en/actions/reference/runners/github-hosted-runners>
- Windows `taskkill`: <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill>
