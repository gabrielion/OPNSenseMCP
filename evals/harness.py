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
3. The child must not inherit a Claude Code session's `ANTHROPIC_BASE_URL` / `CLAUDE_CODE_*`
   variables — see `agent_env()`. Running the eval from inside a Claude Code session otherwise
   fails with a 401 that reads like an agent failure.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import threading
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
# The agent under test is pinned, because "whatever `claude` resolves today" is not a comparable
# instrument: a run scored against one model and a run scored against another are two experiments,
# and the difference would show up as a change in the server's score.
DEFAULT_AGENT_MODEL = "sonnet"
MAX_AGENT_TURNS = "30"
MAX_AGENT_BUDGET_USD = "2.00"
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


def agent_model() -> str:
    return os.environ.get("EVAL_AGENT_MODEL") or DEFAULT_AGENT_MODEL


def agent_env() -> dict[str, str]:
    """Child environment for the `claude` CLI.

    A Claude Code session exports `ANTHROPIC_BASE_URL` and a family of `CLAUDE_CODE_*` variables
    pointing at a gateway the spawned CLI holds no credential for; inheriting them makes every run
    fail with a 401 that looks like an agent problem. In a plain shell they are absent, so stripping
    them changes nothing there. This repository's earlier ground-truth harness learned it the hard
    way and the lesson is worth keeping.
    """
    dropped = {
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDECODE",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_EXECPATH",
    }
    return {
        key: value
        for key, value in os.environ.items()
        if key not in dropped and not key.startswith("CLAUDE_CODE_OAUTH")
    }


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
    cost_usd: float = 0.0
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
            run.cost_usd = float(event.get("total_cost_usd") or 0.0)
            if event.get("is_error"):
                run.transport_error = run.answer or "the client reported an error"

    # A tool call whose result never arrived is not a successful call. Leaving it out entirely
    # would let a run that died mid-tool score as if it had made fewer, cleaner calls; recording it
    # as an error keeps the trace honest about what the agent actually got back.
    for call_id, (name, arguments) in pending.items():
        run.tools.append(
            ToolOutcome(
                name=name,
                args=arguments,
                result=f"no tool_result was ever recorded for {call_id}",
                is_error=True,
            )
        )
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
    env: dict[str, str] | None = None,
    max_bytes: int = MAX_OUTPUT_BYTES,
    timeout: int = AGENT_TIMEOUT_SECONDS,
) -> _Completed:
    """Run a child under a hard cap on memory and a hard cap on wall time.

    Two traps, both of which an earlier version of this function walked into.

    **stderr must not be a pipe nobody reads.** Reading stdout line by line while stderr stays an
    undrained pipe deadlocks the moment the child writes more than the pipe buffer — roughly 64 KiB
    on macOS. The child blocks writing stderr, so it emits no more stdout, so the reader blocks
    forever. It survived testing only because the CLI is normally quiet on stderr. A file has no
    such limit.

    **A deadline checked inside the read loop is not a deadline.** The check only ran when a new
    line arrived, so precisely the hang it existed to break would never trigger it. The wall clock
    is now enforced by a timer thread that kills the child, which works whether or not the child
    ever speaks again.
    """
    stderr_file = tempfile.NamedTemporaryFile("w+", suffix=".stderr", delete=False)
    process = subprocess.Popen(  # noqa: S603 - argv is built here, never shell-interpolated
        argv,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=stderr_file,
        text=True,
    )
    expired = threading.Event()

    def _expire() -> None:
        expired.set()
        process.kill()

    killer = threading.Timer(timeout, _expire)
    killer.start()

    chunks: list[str] = []
    size = 0
    over_cap = False
    assert process.stdout is not None
    try:
        for line in process.stdout:
            size += len(line)
            if size > max_bytes:
                over_cap = True
                process.kill()
                break
            chunks.append(line)
    finally:
        killer.cancel()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        try:
            stderr_file.seek(0)
            stderr = stderr_file.read() or ""
        except OSError:
            stderr = ""
        stderr_file.close()
        try:
            os.unlink(stderr_file.name)
        except OSError:
            pass

    return _Completed(
        stdout="".join(chunks),
        stderr=stderr[-MAX_OUTPUT_BYTES:],
        returncode=process.returncode if process.returncode is not None else -1,
        truncated=over_cap or expired.is_set(),
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
                "--model",
                agent_model(),
                "--allowedTools",
                f"mcp__{SERVER_KEY}",
                # The allow-list governs prompting, not existence, so the agent could still reach
                # for a shell, the web or the filesystem and answer from somewhere other than the
                # firewall. Denying them keeps the MCP server the only possible source of an answer.
                "--disallowedTools",
                *DENIED_TOOLS,
                # Bounds that belong to the experiment rather than to the agent's discretion: a
                # question that needs thirty turns or two dollars has already told us what we
                # wanted to know, and an unbounded run can spend the operator's quota on a loop.
                "--max-turns",
                MAX_AGENT_TURNS,
                "--max-budget-usd",
                MAX_AGENT_BUDGET_USD,
                # No transcript on disk: these traces carry firewall readings, and the private
                # report under `results/` is the one place they are meant to live.
                "--no-session-persistence",
                "--output-format",
                "stream-json",
                "--verbose",
            ],
            cwd=workdir,
            env=agent_env(),
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
