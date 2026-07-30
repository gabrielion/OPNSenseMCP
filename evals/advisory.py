# SPDX-License-Identifier: AGPL-3.0-or-later
"""Judged metrics that report but never gate.

Some questions about an answer cannot be settled by comparison. Whether it hedges, whether it
invented a justification for a number it did read correctly, whether it answered a different
question than the one asked — a regular expression can only approximate these, and approximating
them is how a metric ends up failing true statements. A reader is the right instrument.

A reader is also the wrong instrument for a gate. There is no temperature control on the `claude`
CLI, no seed and no logprobs, so the same answer scored twice can come back differently. A release
gate that flickers teaches people to re-run until it passes, which is worse than not having it.

So the split is structural rather than a label: these metrics are measured directly here, never
handed to `evaluate()`, and their scores never reach the pass/fail count. `metrics.py` holds
everything that decides an exit code, and every one of those is deterministic.

Off by default. `EVAL_JUDGE=1` turns it on, and every call spends the operator's own Claude quota.
"""

from __future__ import annotations

import os

from deepeval.metrics import BaseMetric, GEval
from deepeval.test_case import LLMTestCase, SingleTurnParams

from claude_judge import ClaudeCodeJudge


def judge_enabled() -> bool:
    return os.environ.get("EVAL_JUDGE") == "1"


def advisory_metrics(judge: ClaudeCodeJudge) -> list[BaseMetric]:
    """Judged metrics, in `evaluation_steps` form to keep the judge on rails.

    `criteria` and `evaluation_steps` are mutually exclusive; steps score more consistently because
    the judge is told what to look at rather than asked to invent a rubric. Note the scores are
    coarse: GEval's continuous score comes from `top_logprobs`, which the CLI cannot produce, so it
    falls back to whatever integer the judge names.
    """
    return [
        GEval(
            name="Answers The Question Asked",
            model=judge,
            async_mode=False,
            threshold=0.7,
            evaluation_steps=[
                "Read the question and identify exactly what was asked for.",
                "Check whether the answer supplies that, rather than a related fact.",
                "An answer that adds correct extra detail is still a full answer.",
                "An answer that describes how it would find out, without saying, is not.",
            ],
            evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
        ),
        GEval(
            name="No Unsupported Certainty",
            model=judge,
            async_mode=False,
            threshold=0.7,
            evaluation_steps=[
                "Identify every factual claim the answer makes about the firewall.",
                "Check each claim against the recorded tool results in the context.",
                "Penalise a confident claim that no tool result supports.",
                "Do not penalise an answer for saying plainly that a tool call failed.",
            ],
            evaluation_params=[
                SingleTurnParams.INPUT,
                SingleTurnParams.ACTUAL_OUTPUT,
                SingleTurnParams.CONTEXT,
            ],
        ),
    ]


def measure_advisory(
    metrics: list[BaseMetric], test_case: LLMTestCase
) -> list[dict[str, object]]:
    """Score a case with the judged metrics, tolerating a judge that fails.

    A judge outage is not a finding about the server. It is recorded as an error on the row and the
    run continues, because the gate never depended on it in the first place.
    """
    rows: list[dict[str, object]] = []
    for metric in metrics:
        try:
            score = metric.measure(test_case)
            rows.append(
                {
                    "metric": metric.__name__,
                    "score": score,
                    "passed": bool(metric.is_successful()),
                    "reason": metric.reason,
                    "advisory": True,
                }
            )
        except Exception as error:  # noqa: BLE001 - the judge must never break the run
            rows.append(
                {
                    "metric": getattr(metric, "__name__", type(metric).__name__),
                    "score": None,
                    "passed": None,
                    "reason": f"the judge could not score this: {error}",
                    "advisory": True,
                }
            )
    return rows
