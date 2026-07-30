# SPDX-License-Identifier: AGPL-3.0-or-later
"""Drives a real MCP client against the OPNsense MCP server and records what happened.

The client is the `claude` CLI in print mode, configured with this server and nothing else
(`--strict-mcp-config`). That choice is deliberate: an in-process Python MCP client would prove
the server answers, but the thing worth measuring is whether an agent that has only the server's
own tool descriptions to go on can get a real answer out of it. Tool descriptions, schema bounds
and error text are all part of the product, and only a real client exercises them.

Two traps are encoded here rather than left for the next reader to rediscover:

1. The working directory must not be the server's own repository. `npx -y @gabrielion/opnsense-mcp`
   run from inside that repo matches the local `package.json` name, so npx looks for the bin in
   `node_modules/.bin`, never queries the registry, and dies with `sh: opnsense-mcp: command not
   found`. Every subprocess here runs from a scratch directory.
2. Only MCP tool calls are recorded. The client may also call its own harness tools (tool search,
   for instance) and counting those would score the client, not the server.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

TOOL_PREFIX = "mcp__opnsense__"
SERVER_KEY = "opnsense"
TRANSIENT_MARKERS = ("Overloaded", "API Error: 529", "API Error: 500", "API Error: 503")
# A complete stream-json trace for these questions runs well under a megabyte; the cap exists so a
# runaway agent cannot decide how much memory this process holds.
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
AGENT_TIMEOUT_SECONDS = 600
DENIED_TOOLS = (
    "Bash",
    "Read",
    "Write",
    "Edit",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "Task",
)


@dataclass(frozen=True)
class ToolOutcome:
    name: str
    args: dict
    result: str
    is_error: bool


@dataclass
class AgentRun:
    question: str
    answer: str = ""
    tools: list[ToolOutcome] = field(default_factory=list)
    exposed_tools: list[str] = field(default_factory=list)
    turns: int = 0
    model: str = ""
    transport_error: str | None = None

    @property
    def ok(self) -> bool:
        return self.transport_error is None


class HarnessError(RuntimeError):
    pass


def server_command() -> list[str]:
    """The server under test.

    Defaults to this working tree's build, because the eval belongs to the repository and should
    fail when the tree regresses. Set OPNSENSE_MCP_COMMAND to a shell-free JSON array to point it
    somewhere else — e.g. `["npx","-y","@gabrielion/opnsense-mcp@0.1.0"]` to score exactly what is
    published on npm.
    """
    override = os.environ.get("OPNSENSE_MCP_COMMAND")
    if override:
        parsed = json.loads(override)
        if not isinstance(parsed, list) or not all(isinstance(part, str) for part in parsed):
            raise HarnessError("OPNSENSE_MCP_COMMAND must be a JSON array of strings")
        return parsed
    repository_root = Path(__file__).resolve().parent.parent
    built = repository_root / "dist" / "main.js"
    if not built.is_file():
        raise HarnessError(f"{built} is missing; run `npm run build` first")
    return ["node", str(built)]


def write_client_config(directory: Path) -> Path:
    """An MCP client config naming only this server.

    The firewall credentials are never written here: the server reads them from the private
    connection file whose *path* is passed through, so no secret reaches a config file, a process
    argument or this eval's output.
    """
    config_path = os.environ.get("OPNSENSE_CONFIG_FILE")
    if not config_path:
        raise HarnessError("OPNSENSE_CONFIG_FILE must point at a private connection file")
    if not Path(config_path).is_file():
        raise HarnessError(f"OPNSENSE_CONFIG_FILE does not exist: {config_path}")

    command, *arguments = server_command()
    document = {
        "mcpServers": {
            SERVER_KEY: {
                "command": command,
                "args": arguments,
                "env": {"READ_ONLY": "true", "OPNSENSE_CONFIG_FILE": config_path},
            }
        }
    }
    target = directory / "mcp.json"
    target.write_text(json.dumps(document, indent=2), encoding="utf-8")
    return target


def _parse_events(stream: str) -> AgentRun:
    run = AgentRun(question="")
    pending: dict[str, tuple[str, dict]] = {}
    for line in stream.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        kind = event.get("type")
        if kind == "system" and event.get("subtype") == "init":
            run.model = event.get("model") or ""
            run.exposed_tools = sorted(
                name.removeprefix(TOOL_PREFIX)
                for name in (event.get("tools") or [])
                if name.startswith(TOOL_PREFIX)
            )
        elif kind == "assistant":
            for block in event.get("message", {}).get("content") or []:
                if block.get("type") == "tool_use" and str(block.get("name", "")).startswith(
                    TOOL_PREFIX
                ):
                    pending[block["id"]] = (
                        block["name"].removeprefix(TOOL_PREFIX),
                        block.get("input") or {},
                    )
        elif kind == "user":
            for block in event.get("message", {}).get("content") or []:
                if block.get("type") != "tool_result":
                    continue
                match = pending.pop(block.get("tool_use_id"), None)
                if match is None:
                    continue  # a non-MCP tool; scoring it would measure the client
                name, arguments = match
                content = block.get("content")
                run.tools.append(
                    ToolOutcome(
                        name=name,
                        args=arguments,
                        result=content if isinstance(content, str) else json.dumps(content),
                        is_error=block.get("is_error") is True,
                    )
                )
        elif kind == "result":
            run.answer = event.get("result") or ""
            run.turns = event.get("num_turns") or 0
            if event.get("is_error"):
                run.transport_error = run.answer or "the client reported an error"
    return run


@dataclass(frozen=True)
class _Completed:
    stdout: str
    stderr: str
    returncode: int
    truncated: bool


def _run_bounded(
    argv: list[str],
    *,
    cwd: Path,
    max_bytes: int = MAX_OUTPUT_BYTES,
    timeout: int = AGENT_TIMEOUT_SECONDS,
) -> _Completed:
    """Run a child with a hard cap on how much it can make us hold.

    `subprocess.run(capture_output=True)` reads until EOF, so a runaway agent decides this
    process's memory. The evaluation design spec requires stdout, stderr and wall time to be
    bounded; this is that bound. Output beyond the cap is dropped and flagged rather than silently
    kept, because a truncated trace must not be scored as if it were complete.
    """
    process = subprocess.Popen(  # noqa: S603 - argv is built here, never shell-interpolated
        argv,
        cwd=cwd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    chunks: list[str] = []
    size = 0
    truncated = False
    assert process.stdout is not None
    deadline = time.monotonic() + timeout
    for line in process.stdout:
        if time.monotonic() > deadline:
            truncated = True
            break
        size += len(line)
        if size > max_bytes:
            truncated = True
            break
        chunks.append(line)
    if truncated:
        process.kill()
    try:
        stderr = process.communicate(timeout=30)[1] or ""
    except subprocess.TimeoutExpired:
        process.kill()
        stderr = ""
    return _Completed(
        stdout="".join(chunks),
        stderr=stderr[:MAX_OUTPUT_BYTES],
        returncode=process.returncode if process.returncode is not None else -1,
        truncated=truncated,
    )


def ask(question: str, *, config: Path, workdir: Path, attempts: int = 6) -> AgentRun:
    """Put one question to the agent, retrying only on upstream capacity errors.

    Anything else ends the attempt immediately: retrying a genuine failure until it looks
    intermittent is how a broken server gets recorded as a flaky one.
    """
    if shutil.which("claude") is None:
        raise HarnessError("the `claude` CLI is not on PATH")

    last: AgentRun | None = None
    for attempt in range(1, attempts + 1):
        completed = _run_bounded(
            [
                "claude",
                "-p",
                question,
                "--mcp-config",
                str(config),
                "--strict-mcp-config",
                "--allowedTools",
                f"mcp__{SERVER_KEY}",
                # The allow-list governs prompting, not existence, so the agent could still reach
                # for a shell, the web or the filesystem and answer from somewhere other than the
                # firewall. Denying them keeps the MCP server the only possible source of an answer.
                "--disallowedTools",
                *DENIED_TOOLS,
                "--output-format",
                "stream-json",
                "--verbose",
            ],
            cwd=workdir,
        )
        run = _parse_events(completed.stdout)
        run.question = question
        last = run

        if completed.truncated:
            run.transport_error = (
                'the agent trace exceeded the output or time bound and was cut short; '
                'scoring a partial trace would understate the tool calls'
            )
            return run

        transient = any(marker in completed.stdout for marker in TRANSIENT_MARKERS)
        if transient and attempt < attempts:
            time.sleep(min(30 * attempt, 150))
            continue
        if run.answer or run.transport_error:
            return run
        run.transport_error = (
            f"no result event (exit {completed.returncode}): "
            f"{(completed.stderr or completed.stdout)[:300]}"
        )
        return run

    assert last is not None
    return last


def scratch_directory() -> tempfile.TemporaryDirectory:
    """A directory outside the server's repository — see trap 1 in the module docstring."""
    return tempfile.TemporaryDirectory(prefix="opnsense-eval-")
