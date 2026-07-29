# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs the OPNsense MCP read-surface eval.

    OPNSENSE_CONFIG_FILE=~/Library/Caches/opnsense-mcp/product1b/instance/connection.json \
      evals/.venv/bin/python evals/run_eval.py

What it does, in order: fingerprint the lab model-free and refuse to continue if it drifted; put
each golden question to a real MCP client; score the recorded tool calls with deterministic
metrics; write a run report. Never point it at a production firewall — `npm run vm:bootstrap`
stands up a disposable VM with its own least-privilege account and no credential of yours.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# These must be set before `deepeval` is imported: it reads them at import time, so setting them
# lower down would be decoration rather than configuration. Required by the evaluation design
# spec's security section — no telemetry, no silent dotenv load, no legacy key file, and no
# Confident AI upload, which is out of scope for this first vertical.
os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "1")
os.environ.setdefault("DEEPEVAL_DISABLE_DOTENV", "1")
os.environ.setdefault("DEEPEVAL_DISABLE_LEGACY_KEYFILE", "1")
os.environ.pop("CONFIDENT_API_KEY", None)

from deepeval import evaluate  # noqa: E402
from deepeval.evaluate.configs import AsyncConfig, CacheConfig, DisplayConfig, ErrorConfig
from deepeval.dataset import EvaluationDataset, Golden
from deepeval.test_case import LLMTestCase, MCPServer, MCPToolCall, ToolCall
from mcp.types import CallToolResult, TextContent

from harness import HarnessError, ask, scratch_directory, server_command, write_client_config
from metrics import read_surface_metrics
from probe import ProbeError, read_fingerprint

HERE = Path(__file__).resolve().parent
GROUNDTRUTH = HERE / "groundtruth"
RESULTS = HERE / "results"


def load_goldens() -> list[Golden]:
    """Ground truth stays a committed JSONL file, one row per case, reviewable in a diff.

    `EVAL_ONLY` selects a comma-separated subset by name. It exists so a single case can be replayed
    against another build cheaply — proving a regression guard actually fires costs two agent runs
    instead of eight.
    """
    selected = {name.strip() for name in (os.environ.get("EVAL_ONLY") or "").split(",") if name.strip()}
    goldens: list[Golden] = []
    for line in (GROUNDTRUTH / "read-surface.jsonl").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        if selected and row["name"] not in selected:
            continue
        goldens.append(
            Golden(
                name=row["name"],
                input=row["input"],
                expected_tools=[ToolCall(name=name) for name in row.get("expected_tools", [])],
                additional_metadata={
                    "expected_facts": row.get("expected_facts", []),
                    "forbidden_tools": row.get("forbidden_tools", []),
                    "tolerated_error_tools": row.get("tolerated_error_tools", []),
                },
                comments=row.get("why", ""),
            )
        )
    return goldens


def check_environment(command: list[str], config_path: str, cwd: Path) -> dict:
    """Answer one question only: is this the lab the goldens assume?

    Kept deliberately narrow and version-agnostic. Anything checked here that a *defective* server
    would fail turns a finding into a precondition error and stops the goldens from ever running —
    so the twelve service names are verified by the `services-full-listing` golden instead, where a
    failure is correctly attributed to the server.
    """
    expected = json.loads((GROUNDTRUTH / "environment.json").read_text(encoding="utf-8"))
    observed = read_fingerprint(command, config_path, cwd)

    drift: list[str] = []
    if observed.system_status != expected["system_status"]:
        drift.append(f"system status {observed.system_status!r} != {expected['system_status']!r}")
    if observed.services_total != expected["services"]["total"]:
        drift.append(f"service total {observed.services_total} != {expected['services']['total']}")
    if list(observed.exposed_tools) != sorted(expected["exposed_tools"]):
        drift.append(
            f"exposed tools {list(observed.exposed_tools)} != {sorted(expected['exposed_tools'])}"
        )
    if drift:
        raise SystemExit(
            "the lab does not match evals/groundtruth/environment.json, so the goldens cannot be\n"
            "scored honestly. Either restore the documented lab or update the fingerprint on\n"
            "purpose, with the values a fresh `npm run vm:bootstrap` actually returns:\n  - "
            + "\n  - ".join(drift)
        )
    return {
        "system_status": observed.system_status,
        "services_total": observed.services_total,
        "exposed_tools": list(observed.exposed_tools),
    }


def main() -> int:
    config_path = os.environ.get("OPNSENSE_CONFIG_FILE")
    if not config_path:
        print("OPNSENSE_CONFIG_FILE is required (run `npm run vm:bootstrap` first)", file=sys.stderr)
        return 2

    try:
        command = server_command()
    except HarnessError as error:
        print(str(error), file=sys.stderr)
        return 2

    goldens = load_goldens()
    print(f"server under test : {' '.join(command)}")
    print(f"goldens           : {len(goldens)}")

    with scratch_directory() as scratch:
        workdir = Path(scratch)
        try:
            fingerprint = check_environment(command, config_path, workdir)
        except ProbeError as error:
            print(f"the lab could not be fingerprinted: {error}", file=sys.stderr)
            return 2
        print(
            f"lab fingerprint   : status={fingerprint['system_status']} "
            f"services={fingerprint['services_total']} "
            f"tools={','.join(fingerprint['exposed_tools'])}"
        )

        client_config = write_client_config(workdir)
        server = MCPServer(
            server_name="opnsense",
            transport="stdio",
            available_tools=[
                # DeepEval expects MCP SDK tool objects here; names alone are enough for the
                # deterministic metrics, and none of them read this field.
                {"name": name}
                for name in fingerprint["exposed_tools"]
            ],
        )

        test_cases: list[LLMTestCase] = []
        transport_failures: list[str] = []
        for index, golden in enumerate(goldens, start=1):
            print(f"\n[{index}/{len(goldens)}] {golden.name}")
            run = ask(golden.input, config=client_config, workdir=workdir)
            if not run.ok:
                transport_failures.append(f"{golden.name}: {run.transport_error}")
                print(f"  client failed: {run.transport_error}")
                continue
            called = ", ".join(
                f"{tool.name}{'(!)' if tool.is_error else ''}" for tool in run.tools
            )
            print(f"  calls: {called or '(none)'}")

            metadata = dict(golden.additional_metadata or {})
            metadata["model"] = run.model
            test_cases.append(
                LLMTestCase(
                    name=golden.name,
                    input=golden.input,
                    actual_output=run.answer,
                    expected_tools=golden.expected_tools,
                    tools_called=[ToolCall(name=tool.name) for tool in run.tools],
                    mcp_servers=[server],
                    mcp_tools_called=[
                        MCPToolCall(
                            name=tool.name,
                            args=tool.args,
                            result=CallToolResult(
                                content=[TextContent(type="text", text=tool.result)],
                                isError=tool.is_error,
                            ),
                        )
                        for tool in run.tools
                    ],
                    additional_metadata=metadata,
                )
            )

        if transport_failures:
            # A client that never reached the server tells us nothing about the server. Scoring the
            # remainder and reporting a percentage would quietly relabel an outage as a result.
            print("\nthe client failed to reach a result for:", file=sys.stderr)
            for failure in transport_failures:
                print(f"  - {failure}", file=sys.stderr)
            if not test_cases:
                return 3

        dataset = EvaluationDataset(goldens=goldens)
        print(f"\nscoring {len(test_cases)} of {len(dataset.goldens)} goldens\n")
        result = evaluate(
            test_cases=test_cases,
            metrics=read_surface_metrics(),
            async_config=AsyncConfig(run_async=False),
            cache_config=CacheConfig(write_cache=False),
            display_config=DisplayConfig(show_indicator=False, print_results=False),
            error_config=ErrorConfig(ignore_errors=False),
        )

        # The report carries bounded tool results read off a firewall. Even a disposable one, and
        # even under an ignored directory, that is private material: owner-only directory and file.
        RESULTS.mkdir(exist_ok=True, mode=0o700)
        RESULTS.chmod(0o700)
        report = {
            "server_under_test": command,
            "lab": fingerprint,
            "goldens": len(dataset.goldens),
            "scored": len(test_cases),
            "transport_failures": transport_failures,
            "cases": [],
        }
        failed = 0
        for case in result.test_results:
            entries = []
            for metric in case.metrics_data or []:
                entries.append(
                    {
                        "metric": metric.name,
                        "score": metric.score,
                        "passed": metric.success,
                        "reason": metric.reason,
                    }
                )
                if not metric.success:
                    failed += 1
            report["cases"].append({"name": case.name, "metrics": entries})
            flag = "PASS" if all(entry["passed"] for entry in entries) else "FAIL"
            print(f"{flag}  {case.name}")
            for entry in entries:
                mark = "ok  " if entry["passed"] else "FAIL"
                print(f"      {mark} {entry['metric']:24s} {entry['score']:.2f}  {entry['reason']}")

        report_path = RESULTS / "read-surface.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        report_path.chmod(0o600)
        print(f"\nreport: {report_path}")
        print(f"metric failures: {failed}")
        if transport_failures:
            return 3
        return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
