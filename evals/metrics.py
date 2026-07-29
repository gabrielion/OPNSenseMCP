# SPDX-License-Identifier: AGPL-3.0-or-later
"""Deterministic DeepEval metrics for the OPNsense MCP read surface.

Every metric here scores by comparing recorded facts, never by asking a model. That is a
deliberate constraint: an eval whose verdict depends on a judge cannot distinguish "the server
regressed" from "the judge was in a different mood", and this repository's whole posture is
evidence over claims.

DeepEval ships `ToolCorrectnessMetric`, whose documentation describes it as deterministic unless
`available_tools` is passed. In 4.1.4 that is not true of the constructor: it calls
`initialize_model(None)` unconditionally and raises `DeepEvalError: OpenAI API key is not
configured`. It can be coaxed into working with a throwaway `OPENAI_API_KEY`, and the scoring is
then genuinely local — but a metric that silently holds a live OpenAI client is one refactor away
from billing a network call mid-eval, so `ToolSelectionMetric` below reimplements the same recall
semantics with no model at all. Verified against 4.1.4:

    expected {get}      called {get}             -> 1.0
    expected {get}      called {describe, get}   -> 1.0   (extra calls are not penalised)
    expected {get}      called {describe}        -> 0.0
    expected {get,list} called {get}             -> 0.5   (recall over expected)
"""

from __future__ import annotations

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase


class _DeterministicMetric(BaseMetric):
    """Shared plumbing: no model, no async, no reason invented after the fact."""

    label = "Deterministic Metric"

    def __init__(self, threshold: float = 1.0) -> None:
        self.threshold = threshold
        self.score = 0.0
        self.success = False
        self.reason: str | None = None
        self.error: str | None = None
        self.evaluation_cost = 0.0
        # Scoring is pure comparison, so there is nothing to gain from a thread pool.
        self.async_mode = False
        self.include_reason = True
        self.strict_mode = False
        self.verbose_mode = False

    async def a_measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        return self.measure(test_case, *args, **kwargs)

    def is_successful(self) -> bool:
        return self.success if self.error is None else False

    # DeepEval reads the report label off `__name__`; without it every row prints "Base Metric"
    # and a failing run tells you nothing about which check failed.
    @property
    def __name__(self) -> str:
        return self.label

    def _settle(self, score: float, reason: str) -> float:
        self.score = score
        self.reason = reason
        self.success = score >= self.threshold
        return self.score


def _called_names(test_case: LLMTestCase) -> list[str]:
    return [call.name for call in (test_case.mcp_tools_called or [])]


def _expected_names(test_case: LLMTestCase) -> list[str]:
    return [call.name for call in (test_case.expected_tools or [])]


class ToolSelectionMetric(_DeterministicMetric):
    """Recall over the tools the question genuinely requires.

    Extra calls are not penalised: exploring `opn_describe` before reading a resource is exactly
    what the server's own instructions ask an agent to do, and punishing it would score obedience
    as error. What this cannot see is an agent that reaches the right tool for the wrong reason.
    """

    label = "Tool Selection"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        expected = _expected_names(test_case)
        if not expected:
            return self._settle(1.0, "no tool was required for this question")
        called = set(_called_names(test_case))
        hit = [name for name in expected if name in called]
        missing = [name for name in expected if name not in called]
        reason = (
            f"called {sorted(called) or '[]'}; required {expected}"
            + (f"; missing {missing}" if missing else "")
        )
        return self._settle(len(hit) / len(expected), reason)


class NoForbiddenToolMetric(_DeterministicMetric):
    """Fails if a tool the golden marks off-limits was called at all.

    This is how the read-only posture gets tested from the outside rather than asserted: ask the
    agent to change something and check that no write tool was reachable.
    """

    label = "No Forbidden Tool"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        forbidden = set((test_case.additional_metadata or {}).get("forbidden_tools") or [])
        if not forbidden:
            return self._settle(1.0, "no tool was forbidden for this question")
        breached = sorted(forbidden.intersection(_called_names(test_case)))
        if breached:
            return self._settle(0.0, f"forbidden tools were called: {breached}")
        return self._settle(1.0, f"none of {sorted(forbidden)} was called")


class NoToolErrorMetric(_DeterministicMetric):
    """Fails if any MCP tool call came back as an error.

    The metric that matters most for a *server*: an agent can phrase its way around a broken tool
    and still produce a confident-looking answer, so the prose is not where a regression shows up.
    A refusal the golden expects is declared in `tolerated_error_tools` and does not count — the
    least-privilege lab account genuinely cannot read `firewall.alias`, and pretending otherwise
    would make the eval lie in the other direction.
    """

    label = "No Tool Error"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        tolerated = set((test_case.additional_metadata or {}).get("tolerated_error_tools") or [])
        calls = test_case.mcp_tools_called or []
        if not calls:
            # Silence is only a failure when the question actually needed the firewall. A golden
            # that expects no tool (asking for a write the server must not offer) is answerable
            # from the tool list alone.
            if _expected_names(test_case):
                return self._settle(0.0, "no MCP tool call was recorded at all")
            return self._settle(1.0, "no MCP tool call was needed")
        # `result` is an mcp.types.CallToolResult, so the error flag is read from the same object
        # DeepEval validated rather than from a parallel bookkeeping dict that could drift from it.
        failed = [
            call.name
            for call in calls
            if getattr(call.result, "is_error", False) and call.name not in tolerated
        ]
        if failed:
            return self._settle(0.0, f"{len(failed)} of {len(calls)} calls failed: {failed}")
        return self._settle(1.0, f"all {len(calls)} calls succeeded")


class FactContainmentMetric(_DeterministicMetric):
    """Fraction of the ground-truth facts that appear verbatim in the answer.

    Substring matching, case-insensitive. It is blunt on purpose — a judge would be kinder about
    paraphrase but would also forgive a fabricated number, which is the one thing this must catch.
    Because it is blunt, facts in the goldens are values the firewall actually returned (service
    names, a total, a status word), never a turn of phrase the answer might legitimately vary.
    """

    label = "Fact Containment"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        facts = (test_case.additional_metadata or {}).get("expected_facts") or []
        if not facts:
            return self._settle(1.0, "no fact was pinned for this question")
        haystack = (test_case.actual_output or "").lower()
        missing = [fact for fact in facts if fact.lower() not in haystack]
        found = len(facts) - len(missing)
        reason = f"{found}/{len(facts)} facts present" + (f"; missing {missing}" if missing else "")
        return self._settle(found / len(facts), reason)


def read_surface_metrics() -> list[BaseMetric]:
    """The metric set the read-surface eval runs. All deterministic, all offline."""
    return [
        ToolSelectionMetric(),
        NoToolErrorMetric(),
        NoForbiddenToolMetric(),
        FactContainmentMetric(),
    ]
