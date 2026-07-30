# SPDX-License-Identifier: AGPL-3.0-or-later
"""Level A: everything the eval can be wrong about without a firewall or a model.

The evaluation design spec asks for an offline contract level before any live run, and it is right
to. The live suite needs a disposable VM, a logged-in CLI and several minutes; a parsing regression
discovered there arrives disguised as a mysterious agent failure. Everything below runs in about a
second with no VM, no network and no model, so a broken parser, a mis-tuned metric or a
resurrected subprocess deadlock fails here instead.

    evals/.venv/bin/python -m pytest evals/test_offline.py -q
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest
from deepeval.test_case import LLMTestCase, MCPToolCall, ToolCall
from mcp.types import CallToolResult, TextContent

import harness
import metrics
import oracle
from claude_judge import _coerce

# --------------------------------------------------------------------------------- stream parsing


def _stream(*events: dict) -> str:
    return "".join(json.dumps(event) + "\n" for event in events)


def _init(*tools: str) -> dict:
    return {
        "type": "system",
        "subtype": "init",
        "model": "claude-sonnet-5",
        "tools": ["Glob", *(harness.TOOL_PREFIX + name for name in tools)],
    }


def _use(call_id: str, name: str, arguments: dict | None = None) -> dict:
    return {
        "type": "assistant",
        "message": {
            "content": [
                {
                    "type": "tool_use",
                    "id": call_id,
                    "name": harness.TOOL_PREFIX + name,
                    "input": arguments or {},
                }
            ]
        },
    }


def _result_block(call_id: str, text: str, is_error: bool = False) -> dict:
    return {
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": text,
                    "is_error": is_error,
                }
            ]
        },
    }


def _final(answer: str, is_error: bool = False, turns: int = 3, cost: float = 0.25) -> dict:
    return {
        "type": "result",
        "result": answer,
        "num_turns": turns,
        "total_cost_usd": cost,
        "is_error": is_error,
    }


def test_parses_a_well_formed_trace() -> None:
    run = harness._parse_events(
        _stream(
            _init("opn_list", "opn_get"),
            _use("a", "opn_list", {"resource": "core.services"}),
            _result_block("a", '{"total": 12}'),
            _final("Twelve services."),
        )
    )
    assert run.ok
    assert run.answer == "Twelve services."
    assert run.model == "claude-sonnet-5"
    assert run.exposed_tools == ["opn_get", "opn_list"]  # the client's own Glob is not the server's
    assert run.cost_usd == 0.25
    assert [(tool.name, tool.is_error) for tool in run.tools] == [("opn_list", False)]
    assert run.tools[0].args == {"resource": "core.services"}


def test_malformed_lines_are_skipped_not_fatal() -> None:
    """A partial line at the tail is normal when a stream is cut; it must not lose the rest."""
    stream = (
        _stream(_init("opn_get"), _use("a", "opn_get"))
        + "not json at all\n"
        + "\n"
        + _stream(_result_block("a", "ok"), _final("done"))
    )
    run = harness._parse_events(stream)
    assert run.answer == "done"
    assert len(run.tools) == 1


def test_a_tool_error_is_recorded_as_one() -> None:
    run = harness._parse_events(
        _stream(
            _init("opn_list"),
            _use("a", "opn_list"),
            _result_block("a", "EXECUTION_FAILED", is_error=True),
            _final("I could not read the services."),
        )
    )
    assert run.tools[0].is_error is True


def test_an_unresolved_call_counts_as_an_error() -> None:
    """A call whose result never came back must not read as a call that went fine.

    Dropping it would make a run that died mid-tool look *cleaner* than a healthy one — fewer
    calls, none failed — which is the wrong direction for a metric that exists to catch breakage.
    """
    run = harness._parse_events(
        _stream(_init("opn_list"), _use("a", "opn_list"), _final("partial"))
    )
    assert [(tool.name, tool.is_error) for tool in run.tools] == [("opn_list", True)]


def test_non_mcp_tools_are_ignored() -> None:
    """Counting the client's own tools would score the client, not the server under test."""
    stream = _stream(
        _init("opn_get"),
        {
            "type": "assistant",
            "message": {
                "content": [{"type": "tool_use", "id": "g1", "name": "Glob", "input": {}}]
            },
        },
        _result_block("g1", "some files"),
        _final("done"),
    )
    run = harness._parse_events(stream)
    assert run.tools == []


def test_a_client_error_is_a_transport_error_not_a_bad_answer() -> None:
    run = harness._parse_events(_stream(_init(), _final("Credit balance too low", is_error=True)))
    assert not run.ok
    assert "Credit balance" in (run.transport_error or "")


# ------------------------------------------------------------------------------ bounded subprocess


def _fake_cli(tmp_path: Path, body: str) -> list[str]:
    script = tmp_path / "fake_cli.py"
    script.write_text(textwrap.dedent(body), encoding="utf-8")
    return [sys.executable, str(script)]


def test_a_child_flooding_stderr_then_hanging_is_killed(tmp_path: Path) -> None:
    """The regression that matters most, because its failure mode is a silent forever-hang.

    Reading stdout line by line while stderr is an undrained pipe deadlocks once the child fills
    the pipe buffer (~64 KiB on macOS): it blocks on stderr, so it emits no more stdout, so the
    reader blocks too — and a deadline checked inside the read loop never gets a turn. stderr now
    goes to a file and the wall clock is enforced by a timer thread.
    """
    argv = _fake_cli(
        tmp_path,
        """
        import sys, time
        sys.stdout.write('{"type":"system","subtype":"init","model":"m","tools":[]}\\n')
        sys.stdout.flush()
        sys.stderr.write("x" * 200_000)
        sys.stderr.flush()
        time.sleep(600)
        """,
    )
    started = time.monotonic()
    completed = harness._run_bounded(argv, cwd=tmp_path, timeout=3)
    elapsed = time.monotonic() - started
    assert elapsed < 30, f"the bound did not hold: took {elapsed:.1f}s"
    assert completed.truncated is True
    assert len(completed.stderr) == 200_000
    assert '"type":"system"' in completed.stdout


def test_the_byte_cap_stops_a_runaway_child(tmp_path: Path) -> None:
    argv = _fake_cli(
        tmp_path,
        """
        import sys
        while True:
            sys.stdout.write("y" * 4096 + "\\n")
        """,
    )
    completed = harness._run_bounded(argv, cwd=tmp_path, max_bytes=200_000, timeout=30)
    assert completed.truncated is True
    assert len(completed.stdout) <= 210_000


def test_a_quiet_child_is_not_flagged_as_truncated(tmp_path: Path) -> None:
    argv = _fake_cli(tmp_path, """
        import sys
        sys.stdout.write('{"type":"result","result":"fine","is_error":false}\\n')
        """)
    completed = harness._run_bounded(argv, cwd=tmp_path, timeout=30)
    assert completed.truncated is False
    assert completed.returncode == 0


def test_the_gateway_variables_never_reach_the_child(monkeypatch: pytest.MonkeyPatch) -> None:
    """Inheriting a Claude Code session's gateway settings turns every run into a 401."""
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://gateway.invalid")
    monkeypatch.setenv("CLAUDE_CODE_SESSION_ID", "abc")
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "secret")
    monkeypatch.setenv("PATH", os.environ.get("PATH", ""))
    env = harness.agent_env()
    assert "ANTHROPIC_BASE_URL" not in env
    assert "CLAUDE_CODE_SESSION_ID" not in env
    assert not any(key.startswith("CLAUDE_CODE_OAUTH") for key in env)
    assert env.get("PATH")


# ------------------------------------------------------------------------------------- the metrics


def _case(
    answer: str = "",
    *,
    called: list[tuple[str, bool]] | None = None,
    expected: list[str] | None = None,
    metadata: dict | None = None,
) -> LLMTestCase:
    return LLMTestCase(
        input="q",
        actual_output=answer,
        expected_tools=[ToolCall(name=name) for name in (expected or [])],
        mcp_tools_called=[
            MCPToolCall(
                name=name,
                args={},
                result=CallToolResult(
                    content=[TextContent(type="text", text="x")], isError=is_error
                ),
            )
            for name, is_error in (called or [])
        ],
        metadata=metadata or {},
    )


TRUTH = {
    "system_status": "OK",
    "services_total": 12,
    "services": [
        ["configd", "running"],
        ["cron", "running"],
        ["dhcpd", "running"],
        ["hostwatch", "stopped"],
        ["pf", "running"],
        ["unbound", "running"],
    ],
}


@pytest.mark.parametrize(
    ("answer", "why"),
    [
        ("Le pare-feu compte 12 services configurés, dont 11 en fonctionnement.", "true total"),
        ("11 services en fonctionnement.", "a subset count is not a total claim"),
        ("La dernière page contient 2 services.", "a page count is not a total claim"),
        ("hostwatch est arrêté.", "true per-service state"),
        ("unbound tourne.", "'tourne' is running vocabulary"),
        ("Statut système : OK.", "matches the firewall"),
        ("11 services tournent ; hostwatch est arrêté.", "a summary naming both states"),
        ("Le service pfSense-like nommé pf est actif.", "word-boundary match on a short name"),
    ],
)
def test_the_contradiction_metric_stays_silent_on_true_answers(answer: str, why: str) -> None:
    """A contradiction metric that fires on true statements is worse than no metric at all.

    Its first version failed two of these — "11 services en fonctionnement" and "la dernière page
    contient 2 services" — both perfectly true. These cases are here so that never recurs silently.
    """
    metric = metrics.NoContradictionWithVmMetric()
    metric.measure(_case(answer, metadata={"vm_truth": TRUTH, "require": ["system_status"]}))
    assert metric.success is True, f"{why}: {metric.reason}"


@pytest.mark.parametrize(
    ("answer", "needle"),
    [
        ("Il y a 9 services configurés au total.", "9 services in total"),
        ("hostwatch est en fonctionnement.", "hostwatch reported running"),
        ("unbound est arrêté.", "unbound reported stopped"),
        ("Le service openvpn est actif.", "openvpn"),
        ("Statut système : WARNING.", "WARNING"),
    ],
)
def test_the_contradiction_metric_catches_false_answers(answer: str, needle: str) -> None:
    metric = metrics.NoContradictionWithVmMetric()
    metric.measure(_case(answer, metadata={"vm_truth": TRUTH, "require": ["system_status"]}))
    assert metric.success is False
    assert needle in (metric.reason or "")


def test_tool_selection_is_recall_and_forgives_exploration() -> None:
    metric = metrics.ToolSelectionMetric()
    assert metric.measure(
        _case(called=[("opn_describe", False), ("opn_get", False)], expected=["opn_get"])
    ) == 1.0
    assert metric.measure(_case(called=[("opn_get", False)], expected=["opn_get", "opn_list"])) == 0.5


def test_a_tolerated_error_does_not_fail_the_no_error_metric() -> None:
    metric = metrics.NoToolErrorMetric()
    case = _case(
        called=[("opn_list", True)],
        expected=["opn_list"],
        metadata={"tolerated_error_tools": ["opn_list"]},
    )
    assert metric.measure(case) == 1.0
    assert metric.measure(_case(called=[("opn_list", True)], expected=["opn_list"])) == 0.0


def test_an_untaken_second_reading_is_not_a_pass() -> None:
    """The bug that made this metric worthless: a missing check scored as a passed one."""
    metric = metrics.ServerFaithfulToVmMetric()
    assert metric.measure(_case(metadata={})) == 0.0
    assert metric.measure(_case(metadata={"oracle_disagreements": []})) == 1.0
    assert metric.measure(_case(metadata={"oracle_disagreements": ["pf: MCP running, REST stopped"]})) == 0.0


def test_every_metric_reports_its_own_name() -> None:
    """Without `__name__` DeepEval prints "Base Metric" for every row and a failure says nothing."""
    names = [metric.__name__ for metric in metrics.read_surface_metrics()]
    assert len(set(names)) == len(names)
    assert "Base Metric" not in names


# -------------------------------------------------------------------------------------- the oracle


def _truth(source: str, status: str = "OK", services: tuple = ()) -> oracle.VmTruth:
    return oracle.VmTruth(
        source=source, system_status=status, services=services, services_total=len(services)
    )


def test_last_page_names_matches_a_bootgrid_walk() -> None:
    services = tuple((f"s{i}", "running") for i in range(12))
    truth = _truth("mcp", services=services)
    assert truth.last_page_names(page_size=5) == ("s10", "s11")  # 12 = 5 + 5 + 2
    assert truth.last_page_names(page_size=6) == ("s6", "s7", "s8", "s9", "s10", "s11")
    assert truth.last_page_names(page_size=12) == tuple(name for name, _ in services)


def test_disagreements_name_what_differs() -> None:
    mcp = _truth("mcp", "OK", (("pf", "running"), ("cron", "running")))
    same = _truth("rest", "OK", (("pf", "running"), ("cron", "running")))
    assert oracle.disagreements(mcp, same) == []

    mistranslated = _truth("rest", "NOTICE", (("pf", "stopped"), ("cron", "running")))
    found = oracle.disagreements(mcp, mistranslated)
    assert any("system status" in line for line in found)
    assert any("pf: MCP says running" in line for line in found)

    dropped = _truth("rest", "OK", (("pf", "running"),))
    assert any("cron" in line and "absent from REST" in line for line in oracle.disagreements(mcp, dropped))


# --------------------------------------------------------------------------------------- the judge


class _Schema:
    """Stands in for the pydantic models DeepEval passes, without importing one."""

    def __init__(self, **fields: object) -> None:
        self.fields = fields

    @classmethod
    def model_validate_json(cls, raw: str) -> "_Schema":
        data = json.loads(raw)
        if "score" not in data:
            raise ValueError("score is required")
        return cls(**data)


@pytest.mark.parametrize(
    "reply",
    [
        '{"score": 8, "reason": "fine"}',
        'Here is my verdict:\n{"score": 8, "reason": "fine"}\n',
        '```json\n{"score": 8, "reason": "fine"}\n```',
    ],
)
def test_the_judge_extracts_json_from_the_shapes_a_model_actually_returns(reply: str) -> None:
    parsed = _coerce(reply, _Schema)
    assert parsed is not None and parsed.fields["score"] == 8


@pytest.mark.parametrize("reply", ["I would rather not.", "", '{"reason": "no score"}', "{oops"])
def test_the_judge_reports_unparseable_replies_rather_than_inventing_a_score(reply: str) -> None:
    assert _coerce(reply, _Schema) is None
