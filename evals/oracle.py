# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reads what the firewall actually holds, so the agent's answer can be checked against it.

Two independent readings are taken of the same disposable OPNsense:

* **through the MCP server** — the product boundary. This is what the evaluation design spec asks
  for, and it is what an agent can actually see.
* **straight from the OPNsense REST API** — a second opinion that shares no code with the server.

The spec explicitly refuses the second one: "does not substitute a parallel raw REST implementation
as an 'oracle'". Taking both anyway is a deliberate disagreement, and the reason is empirical. If
the answer and the check both flow through the same server, a server-side misrepresentation is
invisible to the check — every claim agrees because every claim came from the same wrong place.
Two defects of exactly that shape have already been found in this product: a 26.7 status enum
returned as an integer and mis-parsed, and a clamped pagination echo that failed whole classes of
listing. The REST reading cannot catch a firewall that is itself lying, but it does catch the
server layer inventing, dropping or mistranslating rows, and that layer is the thing under test.

The two readings are compared with each other before either is used to judge the agent. A
disagreement is reported as its own finding rather than silently resolved in favour of one side.
"""

from __future__ import annotations

import base64
import http.client
import json
import socket
import ssl
import subprocess
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path

# The Bootgrid page size used when walking the collection. Small on purpose: this must keep working
# against a *defective* server, and a page larger than the collection is precisely the shape a
# defective one fails. Walking pages is slower and correct; asking for everything at once would
# make the oracle depend on the behaviour it exists to check.
PAGE_SIZE = 5
MAX_PAGES = 40

SYSTEM_STATUS_NAMES = {-1: "ERROR", 0: "WARNING", 1: "NOTICE", 2: "OK"}


class OracleError(RuntimeError):
    pass


@dataclass(frozen=True)
class VmTruth:
    """What the firewall holds, according to one reading of it."""

    source: str
    system_status: str
    services: tuple[tuple[str, str], ...]  # ordered (name, running|stopped)
    services_total: int
    catalog_resource_keys: tuple[str, ...] = field(default=())
    exposed_tools: tuple[str, ...] = field(default=())

    @property
    def service_names(self) -> tuple[str, ...]:
        return tuple(name for name, _ in self.services)

    def status_of(self, name: str) -> str | None:
        for service, status in self.services:
            if service == name:
                return status
        return None

    def last_page_names(self, page_size: int = PAGE_SIZE) -> tuple[str, ...]:
        if not self.services:
            return ()
        whole, remainder = divmod(len(self.services), page_size)
        take = remainder or page_size
        return self.service_names[-take:]


# --------------------------------------------------------------------------------------- via MCP


class _StdioClient:
    def __init__(self, command: list[str], config_path: str, cwd: Path) -> None:
        import os

        self._next_id = 0
        self._process = subprocess.Popen(  # noqa: S603 - command is repo-controlled
            command,
            cwd=cwd,
            env={
                "PATH": os.environ.get("PATH", ""),
                "READ_ONLY": "true",
                "OPNSENSE_CONFIG_FILE": config_path,
            },
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

    def call(self, method: str, params: dict) -> dict:
        assert self._process.stdin and self._process.stdout
        self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": self._next_id, "method": method, "params": params}
        self._process.stdin.write(json.dumps(payload) + "\n")
        self._process.stdin.flush()
        while True:
            line = self._process.stdout.readline()
            if not line:
                stderr = (self._process.stderr.read() if self._process.stderr else "") or ""
                raise OracleError(f"the server closed stdout during {method}: {stderr[:300]}")
            line = line.strip()
            if line:
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


def _structured(message: dict, label: str) -> dict:
    result = message.get("result")
    if result is None or result.get("isError"):
        raise OracleError(f"{label} failed: {json.dumps(message)[:300]}")
    structured = result.get("structuredContent")
    if not isinstance(structured, dict):
        raise OracleError(f"{label} returned no structuredContent")
    return structured


def read_via_mcp(command: list[str], config_path: str, cwd: Path) -> VmTruth:
    client = _StdioClient(command, config_path, cwd)
    try:
        client.call(
            "initialize",
            {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "opnsense-eval-oracle", "version": "1.0.0"},
            },
        )
        client.notify("notifications/initialized")

        # The real surface, not a hard-coded list: the evaluation design spec requires the live
        # tools/list to be what DeepEval is told about.
        listed = client.call("tools/list", {})
        exposed = tuple(sorted(tool["name"] for tool in listed["result"]["tools"]))

        status = _structured(
            client.call(
                "tools/call", {"name": "opn_get", "arguments": {"resource": "system.status"}}
            ),
            "opn_get system.status",
        )

        services: list[tuple[str, str]] = []
        total = 0
        for page in range(1, MAX_PAGES + 1):
            body = _structured(
                client.call(
                    "tools/call",
                    {
                        "name": "opn_list",
                        "arguments": {
                            "resource": "core.services",
                            "page": page,
                            "pageSize": PAGE_SIZE,
                            "query": "",
                        },
                    },
                ),
                f"opn_list core.services page {page}",
            )
            total = int(body["total"])
            items = body.get("items") or []
            if not items:
                break
            services.extend((item["name"], item["status"]) for item in items)
            if len(services) >= total:
                break
        else:
            raise OracleError(f"core.services did not terminate within {MAX_PAGES} pages")

        catalog = _structured(
            client.call("tools/call", {"name": "opn_describe", "arguments": {"query": ""}}),
            "opn_describe",
        )
        keys = tuple(sorted(entry["key"] for entry in (catalog.get("resources") or [])))

        return VmTruth(
            source="mcp",
            system_status=str(status["item"]["status"]),
            services=tuple(services),
            services_total=total,
            catalog_resource_keys=keys,
            exposed_tools=exposed,
        )
    finally:
        client.close()


# -------------------------------------------------------------------------------------- via REST


class _PinnedConnection(http.client.HTTPSConnection):
    """Connects to the loopback address but verifies the certificate against its real name.

    The disposable firewall is reached at 127.0.0.1 while its certificate is issued for the name in
    `tlsServerName`, so plain hostname verification fails on an IP mismatch. The MCP server solves
    this with SNI; this does the same rather than the tempting alternative of switching verification
    off, which would turn the second reading into an unauthenticated one.
    """

    def __init__(self, address: str, port: int, *, context: ssl.SSLContext, server_name: str) -> None:
        super().__init__(address, port, context=context, timeout=30)
        self._server_name = server_name

    def connect(self) -> None:  # noqa: D102 - stdlib override
        sock = socket.create_connection((self.host, self.port), self.timeout)
        assert self._context is not None
        self.sock = self._context.wrap_socket(sock, server_hostname=self._server_name)


def _rest_call(config: dict, ca_path: str, path: str, body: dict | None) -> dict:
    context = ssl.create_default_context(cafile=ca_path)
    target = urllib.parse.urlsplit(config["url"])
    server_name = config.get("tlsServerName") or target.hostname
    token = base64.b64encode(
        f"{config['apiKey']}:{config['apiSecret']}".encode("utf-8")
    ).decode("ascii")
    payload = json.dumps(body).encode("utf-8") if body is not None else None

    connection = _PinnedConnection(
        target.hostname,
        target.port or 443,
        context=context,
        server_name=server_name,
    )
    headers = {"host": server_name, "authorization": f"Basic {token}"}
    if payload is not None:
        # Only on a request that has one: OPNsense answers 400 to a bodyless GET that still
        # declares a JSON content type.
        headers["content-type"] = "application/json"
    try:
        connection.request(
            "POST" if payload is not None else "GET",
            path,
            body=payload,
            headers=headers,
        )
        response = connection.getresponse()
        raw = response.read().decode("utf-8")
        if response.status != 200:
            raise OracleError(f"{path} returned HTTP {response.status}")
        return json.loads(raw)
    finally:
        connection.close()


def read_via_rest(config_path: str) -> VmTruth:
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    ca_path = config["caFile"]

    status_body = _rest_call(config, ca_path, "/api/core/system/status", None)
    raw = status_body["metadata"]["system"]["status"]
    # Deliberately re-derived here rather than imported from the server: an oracle that shares the
    # mapping cannot notice the mapping being wrong, which is how the 26.7 enum defect survived.
    status = raw if isinstance(raw, str) else SYSTEM_STATUS_NAMES.get(int(raw))
    if not status:
        raise OracleError(f"unmapped system status {raw!r}")

    services: list[tuple[str, str]] = []
    total = 0
    for page in range(1, MAX_PAGES + 1):
        body = _rest_call(
            config,
            ca_path,
            "/api/core/service/search",
            {"current": page, "rowCount": PAGE_SIZE, "sort": {}, "searchPhrase": ""},
        )
        total = int(body["total"])
        rows = body.get("rows") or []
        if not rows:
            break
        services.extend(
            (row["name"], "running" if int(row["running"]) == 1 else "stopped") for row in rows
        )
        if len(services) >= total:
            break
    else:
        raise OracleError(f"core/service/search did not terminate within {MAX_PAGES} pages")

    return VmTruth(
        source="rest", system_status=status, services=tuple(services), services_total=total
    )


# ------------------------------------------------------------------------------------ comparison


def disagreements(mcp: VmTruth, rest: VmTruth) -> list[str]:
    """What the two readings do not agree on. Empty means the server faithfully relayed the VM."""
    found: list[str] = []
    if mcp.system_status != rest.system_status:
        found.append(f"system status: MCP says {mcp.system_status!r}, REST says {rest.system_status!r}")
    if mcp.services_total != rest.services_total:
        found.append(f"service total: MCP says {mcp.services_total}, REST says {rest.services_total}")
    mcp_map, rest_map = dict(mcp.services), dict(rest.services)
    for name in sorted(set(mcp_map) | set(rest_map)):
        if name not in rest_map:
            found.append(f"{name}: present through MCP, absent from REST")
        elif name not in mcp_map:
            found.append(f"{name}: present in REST, absent through MCP")
        elif mcp_map[name] != rest_map[name]:
            found.append(f"{name}: MCP says {mcp_map[name]}, REST says {rest_map[name]}")
    return found
