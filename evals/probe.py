# SPDX-License-Identifier: AGPL-3.0-or-later
"""A minimal, model-free MCP stdio client used to fingerprint the lab before scoring.

The goldens pin values the firewall actually returned, so they only mean anything against the lab
`evals/groundtruth/environment.json` describes. This reads the fingerprint straight from the
server — no agent, no model, no judgement — so that a drifted lab fails as a precondition instead
of being scored as a weak server.

It speaks the 2025-11-25 `initialize` handshake on purpose. The server also serves 2026-07-28, but
that revision is settled through `server/discover` rather than `initialize`, and none of it matters
for reading two resources.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


class ProbeError(RuntimeError):
    pass


@dataclass(frozen=True)
class Fingerprint:
    system_status: str
    services_total: int
    exposed_tools: tuple[str, ...]


class _StdioClient:
    def __init__(self, command: list[str], config_path: str, cwd: Path) -> None:
        self._next_id = 0
        self._process = subprocess.Popen(  # noqa: S603 - command is repo-controlled
            command,
            cwd=cwd,
            env={"PATH": _path(), "READ_ONLY": "true", "OPNSENSE_CONFIG_FILE": config_path},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def call(self, method: str, params: dict) -> dict:
        assert self._process.stdin and self._process.stdout
        self._next_id += 1
        request = {"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}
        self._process.stdin.write(json.dumps(request) + "\n")
        self._process.stdin.flush()
        while True:
            line = self._process.stdout.readline()
            if not line:
                stderr = (self._process.stderr.read() if self._process.stderr else "") or ""
                raise ProbeError(f"the server closed stdout during {method}: {stderr[:300]}")
            line = line.strip()
            if not line:
                continue
            message = json.loads(line)
            if message.get("id") == self._next_id:
                return message

    def notify(self, method: str) -> None:
        assert self._process.stdin
        self._process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method}) + "\n")
        self._process.stdin.flush()

    def close(self) -> None:
        if self._process.stdin:
            self._process.stdin.close()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()


def _path() -> str:
    import os

    return os.environ.get("PATH", "")


def _structured(message: dict, label: str) -> dict:
    result = message.get("result")
    if result is None or result.get("isError"):
        raise ProbeError(f"{label} failed: {json.dumps(message)[:300]}")
    structured = result.get("structuredContent")
    if not isinstance(structured, dict):
        raise ProbeError(f"{label} returned no structuredContent")
    return structured


def read_fingerprint(command: list[str], config_path: str, cwd: Path) -> Fingerprint:
    client = _StdioClient(command, config_path, cwd)
    try:
        client.call(
            "initialize",
            {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "opnsense-eval-probe", "version": "1.0.0"},
            },
        )
        client.notify("notifications/initialized")

        listed = client.call("tools/list", {})
        tools = tuple(sorted(tool["name"] for tool in listed["result"]["tools"]))

        status = _structured(
            client.call("tools/call", {"name": "opn_get", "arguments": {"resource": "system.status"}}),
            "opn_get system.status",
        )
        # pageSize 1 deliberately. This call must answer "is this the lab the goldens assume", and
        # nothing else: it has to succeed on a *defective* server too, or a server defect gets
        # reported as lab drift and the goldens never run. `pageSize: 100` was the original choice
        # and it was wrong for exactly that reason — it is the shape that fails on published 0.1.0,
        # so the precondition tripped and swallowed the finding the goldens exist to make.
        # `total` is the whole collection's size regardless of page size, which is all this needs.
        services = _structured(
            client.call(
                "tools/call",
                {
                    "name": "opn_list",
                    "arguments": {
                        "resource": "core.services",
                        "page": 1,
                        "pageSize": 1,
                        "query": "",
                    },
                },
            ),
            "opn_list core.services",
        )
        return Fingerprint(
            system_status=str(status["item"]["status"]),
            services_total=int(services["total"]),
            exposed_tools=tools,
        )
    finally:
        client.close()
