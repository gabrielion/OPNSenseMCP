# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs the OPNsense MCP read-surface eval.

    OPNSENSE_CONFIG_FILE=~/Library/Caches/opnsense-mcp/product1b/instance/connection.json \
      npm run eval:read-surface

The shape of a run: read what the firewall actually holds — twice, once through the MCP server and
once from its own REST API — then put each golden question to a real MCP client, then check the
agent's answer against that live reading rather than against values written down earlier. Never
point it at a production firewall; `npm run vm:bootstrap` stands up a disposable VM with its own
least-privilege account and no credential of yours.
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
# deepeval writes .deepeval/ into the working directory unconditionally, holding the same tool
# results as the private report. Create it owner-only first so it cannot land world-readable.
_CACHE = Path.cwd() / ".deepeval"
_CACHE.mkdir(mode=0o700, exist_ok=True)
_CACHE.chmod(0o700)
# `.deepeval/.latest_run_full.json` is a rolling snapshot, overwritten every run. This adds a
# timestamped, complete `TestRun` document per run — the artefact an attestation can digest,
# because it does not change under it. There is no `--json` flag; this variable is the mechanism.
_RUNS = Path(__file__).resolve().parent / "results" / "deepeval"
_RUNS.mkdir(parents=True, mode=0o700, exist_ok=True)
_RUNS.chmod(0o700)
os.environ.setdefault("DEEPEVAL_RESULTS_FOLDER", str(_RUNS))

from deepeval import evaluate  # noqa: E402
from deepeval.evaluate.configs import AsyncConfig, CacheConfig, DisplayConfig, ErrorConfig
from deepeval.dataset import EvaluationDataset, Golden
from deepeval.test_case import LLMTestCase, MCPServer, MCPToolCall, ToolCall
from mcp.types import CallToolResult, TextContent

from importlib.metadata import version  # noqa: E402

from advisory import advisory_metrics, judge_enabled, measure_advisory
from claude_judge import ClaudeCodeJudge
from harness import (
    HarnessError,
    agent_model,
    ask,
    scratch_directory,
    server_command,
    write_client_config,
)
from metrics import read_surface_metrics
from oracle import PAGE_SIZE, OracleError, VmTruth, disagreements, read_via_mcp, read_via_rest

HERE = Path(__file__).resolve().parent
GROUNDTRUTH = HERE / "groundtruth"
RESULTS = HERE / "results"


def load_goldens() -> list[Golden]:
    """Ground truth stays a committed JSONL file, one row per case, reviewable in a diff.

    A row never carries a firewall value. It names the *kind* of fact the answer must contain and
    the runner resolves it against the live firewall — so the goldens cannot rot, and a passing run
    means the answer matched the firewall rather than matching a stale note.

    `EVAL_ONLY` selects a comma-separated subset by name, so one case can be replayed against
    another build for two agent runs instead of nine.
    """
    selected = {
        name.strip() for name in (os.environ.get("EVAL_ONLY") or "").split(",") if name.strip()
    }
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
                # `Golden` still spells this `additional_metadata` while `LLMTestCase` has
                # renamed it to `metadata`. Worse, `Golden` is a pydantic model that ignores
                # unknown keyword arguments, so passing `metadata=` here would be accepted
                # silently and every golden would arrive with no requirements at all.
                additional_metadata={
                    "require": row.get("require", []),
                    "forbidden_tools": row.get("forbidden_tools", []),
                    "tolerated_error_tools": row.get("tolerated_error_tools", []),
                },
                comments=row.get("why", ""),
            )
        )
    return goldens


def resolve_facts(require: list[str], truth: VmTruth) -> list[str]:
    """Turn a golden's declared requirements into the strings the firewall says right now."""
    facts: list[str] = []
    for requirement in require:
        if requirement == "system_status":
            facts.append(truth.system_status)
        elif requirement == "services_total":
            facts.append(str(truth.services_total))
        elif requirement == "all_service_names":
            facts.extend(truth.service_names)
        elif requirement == "running_service_names":
            facts.extend(name for name, state in truth.services if state == "running")
        elif requirement == "last_page_service_names":
            facts.extend(truth.last_page_names())
        elif requirement == "catalog_resource_keys":
            facts.extend(truth.catalog_resource_keys)
        elif requirement.startswith("service_name:"):
            name = requirement.split(":", 1)[1]
            if truth.status_of(name) is None:
                raise SystemExit(
                    f"golden requires service {name!r}, which this lab does not run — the golden "
                    "and the lab disagree, so scoring it would be meaningless"
                )
            facts.append(name)
        else:
            raise SystemExit(f"unknown requirement {requirement!r} in the ground truth")
    return facts


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

        # Read the firewall before asking anything, so the answers are judged against the state the
        # agent could actually have observed.
        try:
            through_server = read_via_mcp(command, config_path, workdir)
            from_firewall = read_via_rest(config_path)
        except OracleError as error:
            print(f"the firewall could not be read: {error}", file=sys.stderr)
            return 2

        divergence = disagreements(through_server, from_firewall)
        print(
            f"firewall (MCP)    : status={through_server.system_status} "
            f"services={through_server.services_total} "
            f"running={sum(1 for _, s in through_server.services if s == 'running')}"
        )
        print(
            f"firewall (REST)   : status={from_firewall.system_status} "
            f"services={from_firewall.services_total} "
            f"running={sum(1 for _, s in from_firewall.services if s == 'running')}"
        )
        print(
            "second reading    : agrees"
            if not divergence
            else f"second reading    : DISAGREES — {'; '.join(divergence[:3])}"
        )

        client_config = write_client_config(workdir)
        server = MCPServer(
            server_name="opnsense",
            transport="stdio",
            # The live tools/list surface, read from the server a moment ago. An earlier version
            # hard-coded four names here, which quietly meant DeepEval was told about a surface
            # nobody had checked. DeepEval accepts plain dicts for this field.
            available_tools=[{"name": name} for name in through_server.exposed_tools],
        )
        truth_payload = {
            "system_status": through_server.system_status,
            "services": [list(pair) for pair in through_server.services],
            "services_total": through_server.services_total,
        }

        test_cases: list[LLMTestCase] = []
        transport_failures: list[str] = []
        answers: dict[str, str] = {}
        agent_cost = 0.0
        for index, golden in enumerate(goldens, start=1):
            metadata = dict(golden.additional_metadata or {})
            required = resolve_facts(metadata.get("require") or [], through_server)

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

            answers[golden.name] = run.answer
            agent_cost += run.cost_usd
            metadata["resolved_facts"] = required
            metadata["vm_truth"] = truth_payload
            metadata["oracle_disagreements"] = divergence
            metadata["model"] = run.model
            test_cases.append(
                LLMTestCase(
                    name=golden.name,
                    input=golden.input,
                    actual_output=run.answer,
                    expected_tools=golden.expected_tools,
                    # What the agent actually got back, so a judged metric can check the answer
                    # against its own evidence rather than against its plausibility. Bounded per
                    # call: a full listing would drown the judge in rows it does not need.
                    context=[f"{tool.name} -> {tool.result[:1500]}" for tool in run.tools],
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
                    metadata=metadata,
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

        judge = ClaudeCodeJudge() if judge_enabled() else None
        judged = advisory_metrics(judge) if judge else []

        dataset = EvaluationDataset(goldens=goldens)
        print(f"\nscoring {len(test_cases)} of {len(dataset.goldens)} goldens\n")
        result = evaluate(
            test_cases=test_cases,
            metrics=read_surface_metrics(),
            # Pass them here, not through `@deepeval.log_hyperparameters`. The decorator writes
            # onto whatever test run exists at import time and `evaluate()` then replaces it — the
            # run prints "No hyperparameters logged" and the saved document has none. Measured.
            hyperparameters={
                "server_under_test": " ".join(command),
                "agent_model": agent_model(),
                "judge": judge.get_model_name() if judge else "none (deterministic metrics only)",
                "oracle_page_size": PAGE_SIZE,
                "deepeval": version("deepeval"),
                "goldens": len(dataset.goldens),
                "scored": len(test_cases),
                "agent_cost_usd": round(agent_cost, 4),
            },
            async_config=AsyncConfig(run_async=False),
            cache_config=CacheConfig(write_cache=False),
            display_config=DisplayConfig(show_indicator=False, print_results=False),
            error_config=ErrorConfig(ignore_errors=False),
        )
        by_name = {case.name: case for case in test_cases}

        # The report carries bounded tool results read off a firewall. Even a disposable one, and
        # even under an ignored directory, that is private material: owner-only directory and file.
        RESULTS.mkdir(exist_ok=True, mode=0o700)
        RESULTS.chmod(0o700)
        report: dict = {
            "server_under_test": command,
            "firewall_through_mcp": truth_payload,
            "firewall_through_rest": {
                "system_status": from_firewall.system_status,
                "services": [list(pair) for pair in from_firewall.services],
                "services_total": from_firewall.services_total,
            },
            "second_reading_disagreements": divergence,
            "goldens": len(dataset.goldens),
            "scored": len(test_cases),
            "agent_model": agent_model(),
            "agent_cost_usd": round(agent_cost, 4),
            "judge": judge.get_model_name() if judge else None,
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
                        "advisory": False,
                    }
                )
                if not metric.success:
                    failed += 1
            # Judged rows are measured here rather than handed to `evaluate()`, so there is no
            # path by which a judge's opinion can reach `failed`. They are reported, and that is
            # all they are: no seed, no temperature, no logprobs, so they flicker by construction.
            if judged and case.name in by_name:
                entries.extend(measure_advisory(judged, by_name[case.name]))
            # The answer goes into the private report, bounded. Without it a failing metric cannot
            # be told apart from a metric that misread a perfectly good answer, and that
            # distinction is the difference between a finding and a false alarm.
            report["cases"].append(
                {
                    "name": case.name,
                    "metrics": entries,
                    "answer_excerpt": (answers.get(case.name) or "")[:4000],
                }
            )
            blocking = [entry for entry in entries if not entry["advisory"]]
            flag = "PASS" if all(entry["passed"] for entry in blocking) else "FAIL"
            print(f"{flag}  {case.name}")
            for entry in entries:
                if entry["advisory"]:
                    mark = "~   "
                else:
                    mark = "ok  " if entry["passed"] else "FAIL"
                score = "  n/a" if entry["score"] is None else f"{entry['score']:.2f}"
                print(f"      {mark} {entry['metric']:26s} {score}  {entry['reason']}")

        # DeepEval writes its own run artefact into a `.deepeval` directory in the working
        # directory, with the same tool-result content as the private report but default
        # permissions. Point it at the private root and keep the mode consistent.
        report_path = RESULTS / "read-surface.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        report_path.chmod(0o600)
        # DeepEval writes its own timestamped run document with default permissions, and it holds
        # the same tool results as the private report. The owner-only directory already shields it;
        # this makes the file itself say so.
        for artefact in _RUNS.glob("*.json"):
            artefact.chmod(0o600)
        if judge:
            report["judge_usage"] = judge.usage.as_hyperparameters()
            report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(f"\njudge (advisory)  : {judge.usage.as_hyperparameters()}")
        print(f"\nreport: {report_path}")
        print(f"agent cost: ${agent_cost:.2f}")
        print(f"metric failures: {failed}")
        if transport_failures:
            return 3
        return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
