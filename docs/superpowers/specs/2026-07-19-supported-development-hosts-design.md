# Supported Development Hosts Design

**Date:** 2026-07-19

**Status:** Approved direction; written specification awaiting owner review

## Context

Supporting MCP clients such as Claude, Codex, OpenCode, and Kimi is independent from supporting every host
operating system. The project currently has deterministic CI evidence on Linux and local development evidence
on macOS. It has no native Windows execution environment or native Windows process-containment evidence.

The installed-package test harness nevertheless contains Windows-specific `cmd.exe`, junction, `SystemRoot`,
and `taskkill /T` paths. Review established that `taskkill /T` cannot prove cleanup of a descendant whose direct
parent has already exited. Adding a native Job Object helper, a Windows VM, or Windows CI would be substantial
work that does not advance the current OPNsense product, VM, client, or agentic-evaluation milestones.

## Decision

The supported development and test hosts are macOS and Linux.

Native Windows is not a supported or tested development host in the current release scope. The project must
not imply otherwise through dormant platform branches, unit-only path projections, documentation, or release
claims. Native Windows support may be reconsidered only when there is a demonstrated user need and a real
Windows execution gate.

This decision does not claim that the platform-neutral MCP runtime cannot run on Windows. It means the project
does not currently verify, document, or support that configuration.

## Implementation boundary

The installed-package harness will use only the POSIX process-group cleanup contract exercised on macOS and
Linux. Native Windows execution will fail before starting a supervisor or command, with one fixed actionable
diagnostic naming macOS and Linux as the supported development hosts.

Remove the unused or misleading native Windows harness surface:

- `taskkill` termination plans and execution;
- `SystemRoot` validation and propagation;
- `cmd.exe` shim execution;
- junction-only dependency projection;
- Windows-only unit tests that prove path construction without proving runtime behavior.

Keep platform-neutral package metadata and runtime code unchanged. Do not add a Job Object helper, PowerShell,
Wine, a Windows VM, a Windows CI runner, or WSL claims.

## Documentation

README and CONTRIBUTING material must separate two concepts:

- supported MCP clients;
- supported development/test host operating systems.

The host statement stays high-level: macOS and Linux are tested; native Windows is not currently tested or
supported. Windows belongs in a future roadmap item, not in the installation quick start. WSL must not be
recommended until its complete local build, client, QEMU, and VM workflow is exercised.

Existing future plans that assume native Windows are aspirational and must not be presented as current product
scope or evidence. They can be revised when their implementation phase begins.

## Testing and failure behavior

Use TDD for the harness change:

1. Add a failing test proving a simulated native Windows invocation is refused before any supervisor or tree
   terminator starts.
2. Require the exact fixed diagnostic and prove caller-provided Windows paths are not reflected.
3. Remove Windows-only path and termination tests with the code they uniquely exercised; do not retain dead
   tests or weaken POSIX assertions.
4. Re-run the real macOS/Linux installed-package test, process cleanup stress, the full deterministic suite,
   conformance, licensing, and publication scans.

The Windows refusal is a truthful unsupported-platform boundary, not a skipped test. CI remains Linux-based;
local macOS evidence remains an additional independently reported gate.

## Out of scope

- Native Windows runtime support or installation instructions.
- Windows Job Objects or descendant-containment helpers.
- Windows VM provisioning or temporary GitHub CI branches.
- Claims about WSL compatibility.
- Changes to MCP client support, the OPNsense VM, product capabilities, or the provenance migration.

## Success criteria

- No current code or documentation implies tested native Windows development support.
- Native Windows test-harness use fails before any child process starts.
- macOS/Linux behavior and cleanup guarantees remain unchanged and verified.
- The roadmap can add Windows later without blocking the current product milestones.
