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

import re

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


# Real OPNsense services that this lab does not run. Naming one *with a state* is the cheapest
# deterministic signature of an invented answer: the agent cannot have read it from the firewall.
DECOY_SERVICES = (
    "openvpn",
    "ipsec",
    "wireguard",
    "haproxy",
    "suricata",
    "squid",
    "zabbix",
    "telegraf",
    "monit",
    "radvd",
)

# Checked in this order: several "stopped" phrasings embed a "running" word ("non démarré"), so the
# stopped vocabulary has to win.
_STOPPED_MARKERS = (
    "non démarré",
    "pas démarré",
    "non demarre",
    "not running",
    "arrêté",
    "arrete",
    "stopped",
    "inactif",
    "⛔",
    "❌",
    "🔴",
)
_RUNNING_MARKERS = (
    "en marche",
    "en fonctionnement",
    "démarré",
    "demarre",
    "tourne",
    "running",
    "actif",
    "✅",
    "🟢",
)


# Only a phrasing that claims the size of the whole collection. "11 services en fonctionnement" is
# a subset and must not be read as a total.
_TOTAL_CLAIM = re.compile(
    r"(?:au total|en tout|total(?:e|ement)?(?:\s+de)?|configur\w+)[^.\n]{0,30}?(?P<count>\d{1,4})\s*services?"
    r"|(?P<c2>\d{1,4})\s*services?[^.\n]{0,30}?(?:au total|en tout|configur\w+|in total)",
    flags=re.I,
)
_SUBSET_QUALIFIERS = (
    "en fonctionnement",
    "en marche",
    "démarré",
    "actif",
    "running",
    "arrêté",
    "stopped",
    "sur cette page",
    "dernière page",
    "cette page",
)


def _claimed_state(line: str) -> str | None:
    lowered = line.lower()
    if any(marker in lowered for marker in _STOPPED_MARKERS):
        return "stopped"
    if any(marker in lowered for marker in _RUNNING_MARKERS):
        return "running"
    return None


def _mentions_both_states(lowered: str) -> bool:
    return any(m in lowered for m in _STOPPED_MARKERS) and any(
        m in lowered for m in _RUNNING_MARKERS
    )


class AnswerSupportedByVmMetric(_DeterministicMetric):
    """Every fact the golden requires must appear in the answer — and the facts are read live.

    The values are not written into the goldens. A golden names the *kind* of fact it needs
    (`services_total`, `all_service_names`, …) and the runner resolves it against the firewall at
    run time. That is the difference between "the answer matches what we wrote down last Tuesday"
    and "the answer matches what the firewall holds right now".
    """

    label = "Answer Supported By VM"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        facts = (test_case.additional_metadata or {}).get("resolved_facts") or []
        if not facts:
            return self._settle(1.0, "no fact was required for this question")
        haystack = (test_case.actual_output or "").lower()
        missing = [fact for fact in facts if str(fact).lower() not in haystack]
        found = len(facts) - len(missing)
        reason = f"{found}/{len(facts)} live facts present" + (
            f"; missing {missing}" if missing else ""
        )
        return self._settle(found / len(facts), reason)


class NoContradictionWithVmMetric(_DeterministicMetric):
    """The answer must not assert anything the firewall contradicts.

    Presence checks alone reward an answer that says everything; this is the other half — the
    answer must not say something *wrong*. Deterministic and necessarily narrow: it checks the
    claim shapes this domain actually produces (a service count, a system status word, a per-service
    state, a service that does not exist) rather than pretending to understand prose. Its silence is
    not proof of truthfulness, only the absence of these specific lies.
    """

    label = "No Contradiction With VM"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        metadata = test_case.additional_metadata or {}
        truth = metadata.get("vm_truth")
        answer = test_case.actual_output or ""
        if not truth or not answer:
            return self._settle(1.0, "nothing to contradict")

        services: dict[str, str] = dict(truth.get("services") or [])
        total = truth.get("services_total")
        contradictions: list[str] = []

        # A stated *total* must be the real total. Deliberately narrow: an earlier version flagged
        # every "<n> services" and cried wolf at two perfectly true sentences — "11 services en
        # fonctionnement" (11 of 12 run) and "la dernière page contient 2 services". A contradiction
        # metric that fires on true statements is worse than no metric, so only phrasings that
        # actually claim the whole collection count, and a number qualified as a subset is skipped.
        for match in _TOTAL_CLAIM.finditer(answer):
            stated = int(match.group("count") or match.group("c2"))
            window = answer[max(0, match.start() - 40) : match.end() + 40].lower()
            if any(qualifier in window for qualifier in _SUBSET_QUALIFIERS):
                continue
            if stated != int(total):
                contradictions.append(f"claims {stated} services in total, firewall has {total}")

        # A system status word, when the question was about system status.
        if "system_status" in (metadata.get("require") or []):
            named = {
                token
                for token in re.findall(r"\b(OK|NOTICE|WARNING|ERROR)\b", answer)
                if token != truth.get("system_status")
            }
            if named:
                contradictions.append(
                    f"names status {sorted(named)} but the firewall reports {truth.get('system_status')!r}"
                )

        for line in answer.splitlines():
            claimed = _claimed_state(line)
            if claimed is None:
                continue
            lowered = line.lower()
            # A line that carries BOTH vocabularies is a summary sentence ("11 run, hostwatch is
            # stopped"), not a claim about one service. Attributing its single state word to every
            # name on it manufactures contradictions.
            if _mentions_both_states(lowered):
                continue
            for name, actual in services.items():
                # Word boundaries, not substrings: `pf` and `cron` are short enough to appear
                # inside unrelated words and be blamed for a state they were never given.
                if claimed != actual and re.search(rf"\b{re.escape(name)}\b", lowered):
                    contradictions.append(f"{name} reported {claimed}, firewall says {actual}")
            for decoy in DECOY_SERVICES:
                if decoy not in services and re.search(rf"\b{re.escape(decoy)}\b", lowered):
                    contradictions.append(f"reports a state for {decoy}, which the firewall does not run")

        if contradictions:
            unique = sorted(set(contradictions))
            return self._settle(0.0, "; ".join(unique[:4]) + (" …" if len(unique) > 4 else ""))
        return self._settle(1.0, "no claim contradicts the firewall")


class ServerFaithfulToVmMetric(_DeterministicMetric):
    """The MCP server's view of the firewall must match the firewall's own API.

    This is the check the evaluation design spec argues against — it says the state verifier should
    read through the installed server and not stand up a parallel REST oracle. The objection is
    sound about scope creep and wrong about blind spots: when the answer and the check share a
    server, a server that misreports is invisible to both. Two defects of that exact shape have
    already shipped here. This does not replace the MCP readback; it sits beside it and fails when
    the two disagree.
    """

    label = "Server Faithful To VM"

    def measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        found = (test_case.additional_metadata or {}).get("oracle_disagreements")
        if found is None:
            # An absent check is not a passed check. The first version returned 1.0 here, which
            # meant a run where the second reading silently failed to happen looked identical to
            # one where the server was proven faithful.
            return self._settle(0.0, "the second reading was not taken, so fidelity is unproven")
        if found:
            return self._settle(0.0, "MCP and REST disagree: " + "; ".join(found[:4]))
        return self._settle(1.0, "MCP and the firewall's own API agree")


def read_surface_metrics() -> list[BaseMetric]:
    """The metric set the read-surface eval runs. All deterministic, all offline, no judge."""
    return [
        ToolSelectionMetric(),
        NoToolErrorMetric(),
        NoForbiddenToolMetric(),
        AnswerSupportedByVmMetric(),
        NoContradictionWithVmMetric(),
        ServerFaithfulToVmMetric(),
    ]
