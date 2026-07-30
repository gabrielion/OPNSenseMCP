# SPDX-License-Identifier: AGPL-3.0-or-later
"""A DeepEval judge backed by the `claude` CLI, so judged metrics can run with no API key.

This workstation has no `ANTHROPIC_API_KEY` and no `OPENAI_API_KEY`, and it is not going to get
one: the `claude` CLI authenticates by OAuth. Every LLM-judged metric in DeepEval builds a provider
client and would raise here. That is the whole reason the read-surface suite is deterministic — and
determinism is a virtue, not a workaround, for anything that gates a release. But some questions
genuinely need a reader: whether an answer *hedges*, whether it invents a justification, whether it
answered the question that was asked. Those cannot be regexed.

`DeepEvalBaseLLM` is DeepEval's documented extension point, and `initialize_model()` returns any
instance of it untouched with `using_native_model=False` — no provider client is constructed, no key
is read. So the CLI you already log into becomes the judge.

**Why not an OpenAI-compatible proxy.** It was the obvious idea and it is the wrong one here. A
proxy would have to impersonate `/v1/chat/completions` well enough that DeepEval's `GPTModel` path
believes it, and that path asks for `top_logprobs` — GEval's `generate_raw_response` reads
`res.choices[0].logprobs` to compute its weighted score. The CLI cannot produce token logprobs at
any price, so the proxy would have to fake them, and a faked logprob distribution silently changes
every GEval score. Subclassing instead makes the missing capability *visible*: `supports_log_probs`
returns False, GEval raises `AttributeError` on the raw-response path, and falls back to plain
schema generation (verified in 4.1.4, `metrics/g_eval/g_eval.py:308` and `:335`). A proxy is the
right shape only for a consumer that speaks nothing but OpenAI HTTP. DeepEval is not that consumer.

**A judge scored by this class is advisory, never a gate.** There is no temperature control on the
CLI, no seed, and no logprobs, so two runs of the same metric on the same text may differ. Anything
that decides pass/fail in this repository stays deterministic; see `metrics.py`.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from deepeval.models import DeepEvalBaseLLM

DEFAULT_MODEL = "sonnet"
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_BUDGET_USD = "0.50"
MAX_ATTEMPTS = 3
TRANSIENT_MARKERS = ("Overloaded", "API Error: 429", "API Error: 500", "API Error: 503", "API Error: 529")
# One CLI process is a whole Claude Code session: it loads a system prompt, negotiates auth and
# holds a model context. Letting DeepEval's async fan-out start a dozen at once turns a scoring
# pass into a fork bomb against the user's own rate limit.
MAX_CONCURRENT = int(os.environ.get("EVAL_JUDGE_CONCURRENCY", "2"))


class JudgeError(RuntimeError):
    pass


@dataclass
class JudgeUsage:
    """What the judge cost, so a run can report it instead of guessing."""

    calls: int = 0
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    invalid_json_retries: int = 0

    def as_hyperparameters(self) -> dict[str, float | int]:
        return {
            "judge_calls": self.calls,
            "judge_cost_usd": round(self.cost_usd, 4),
            "judge_input_tokens": self.input_tokens,
            "judge_output_tokens": self.output_tokens,
            "judge_invalid_json_retries": self.invalid_json_retries,
        }


def judge_env() -> dict[str, str]:
    """Child environment for the CLI.

    A Claude Code session exports `ANTHROPIC_BASE_URL` and a family of `CLAUDE_CODE_*` variables
    that point the child at a gateway it holds no credential for; inheriting them turns every judge
    call into a 401. In a plain shell these are simply absent, so stripping them costs nothing.
    Learned the hard way by this repository's earlier ground-truth harness.
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


_SCHEMA_INSTRUCTION = (
    "\n\n---\n"
    "Answer with a single JSON object and nothing else: no prose before it, no prose after it, no "
    "markdown fence. It must validate against this JSON Schema:\n\n{schema}\n"
)


class ClaudeCodeJudge(DeepEvalBaseLLM):
    """Scores DeepEval prompts by shelling out to `claude -p`.

    Every invocation is a fresh, toolless, server-less session. `--tools ""` removes the built-in
    tool definitions from the context — which both halves the prompt the judge pays for and makes
    it structurally unable to act on the text it is grading, rather than merely forbidden to. A
    judge that can read files is a judge that can be talked into reading files.
    """

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
        budget_usd: str = DEFAULT_BUDGET_USD,
        effort: str | None = "low",
    ) -> None:
        self._model = model
        self._timeout = timeout
        self._budget = budget_usd
        self._effort = effort
        self.usage = JudgeUsage()
        self._lock = threading.Lock()
        self._semaphore = threading.BoundedSemaphore(MAX_CONCURRENT)
        # A directory of its own: outside this repository so no CLAUDE.md is picked up into the
        # judge's context, and outside any package so npx-style name resolution cannot bite.
        self._home = tempfile.TemporaryDirectory(prefix="opnsense-judge-")
        self._workdir = Path(self._home.name)
        (self._workdir / "mcp.json").write_text('{"mcpServers":{}}', encoding="utf-8")
        super().__init__(model)

    # ------------------------------------------------------------------ DeepEvalBaseLLM contract

    def load_model(self) -> str:
        import shutil

        if shutil.which("claude") is None:
            raise JudgeError("the `claude` CLI is not on PATH, so there is no judge to run")
        return self._model

    def get_model_name(self) -> str:
        return f"claude-cli:{self._model}"

    def generate(self, prompt: str, schema: Any = None, **_: Any) -> Any:
        return self._invoke(prompt, schema)

    async def a_generate(self, prompt: str, schema: Any = None, **_: Any) -> Any:
        return await asyncio.to_thread(self._invoke, prompt, schema)

    # Capabilities, declared honestly. GEval reads none of these directly for a custom model, but
    # `no_log_prob_support()` only inspects the built-in provider classes, so GEval *will* try the
    # raw-response path first and fall back on AttributeError. Declaring them keeps any future
    # capability check truthful rather than accidentally right.
    def supports_log_probs(self) -> bool:
        return False

    def supports_structured_outputs(self) -> bool:
        return False

    def supports_json_mode(self) -> bool:
        return True

    def supports_temperature(self) -> bool:
        return False

    # ------------------------------------------------------------------------------- the subprocess

    def _argv(self) -> list[str]:
        argv = [
            "claude",
            "-p",
            "--output-format",
            "json",
            "--model",
            self._model,
            "--max-turns",
            "1",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--mcp-config",
            str(self._workdir / "mcp.json"),
            "--tools",
            "",
            "--max-budget-usd",
            self._budget,
        ]
        if self._effort:
            argv += ["--effort", self._effort]
        return argv

    def _run_once(self, prompt: str) -> dict:
        """One CLI call. The prompt goes in on stdin, never as an argument.

        Judge prompts carry the agent's answer and its tool results — material read off a firewall.
        An argument is visible to every process on the machine through `ps`; stdin is not. It also
        sidesteps `ARG_MAX`, which a long tool trace can reach.
        """
        with self._semaphore:
            try:
                completed = subprocess.run(  # noqa: S603 - argv built here, never shell-interpolated
                    self._argv(),
                    input=prompt,
                    capture_output=True,
                    text=True,
                    cwd=self._workdir,
                    env=judge_env(),
                    timeout=self._timeout,
                )
            except subprocess.TimeoutExpired as error:
                raise JudgeError(f"the judge did not answer within {self._timeout}s") from error

        if completed.returncode != 0 and not completed.stdout.strip():
            raise JudgeError(
                f"the judge exited {completed.returncode}: "
                f"{(completed.stderr or '').strip()[:300]}"
            )
        try:
            envelope = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise JudgeError(
                f"the judge did not return a JSON envelope: {completed.stdout[:300]}"
            ) from error
        if envelope.get("is_error"):
            raise JudgeError(f"the judge reported an error: {str(envelope.get('result'))[:300]}")
        return envelope

    def _account(self, envelope: dict) -> None:
        usage = envelope.get("usage") or {}
        with self._lock:
            self.usage.calls += 1
            self.usage.cost_usd += float(envelope.get("total_cost_usd") or 0.0)
            self.usage.input_tokens += int(usage.get("input_tokens") or 0)
            self.usage.output_tokens += int(usage.get("output_tokens") or 0)

    def _invoke(self, prompt: str, schema: Any) -> Any:
        full = prompt
        if schema is not None:
            full = prompt + _SCHEMA_INSTRUCTION.format(
                schema=json.dumps(schema.model_json_schema(), indent=2)
            )

        last: Exception | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                envelope = self._run_once(full)
            except JudgeError as error:
                last = error
                if attempt < MAX_ATTEMPTS and any(
                    marker in str(error) for marker in TRANSIENT_MARKERS
                ):
                    time.sleep(min(15 * attempt, 60))
                    continue
                raise
            self._account(envelope)
            text = envelope.get("result") or ""
            if schema is None:
                return text
            parsed = _coerce(text, schema)
            if parsed is not None:
                return parsed
            # Returning the raw text would let DeepEval's own `trimAndLoadJson` try, but its failure
            # mode is an exception three frames away from the cause. One retry with the offending
            # output quoted back is cheaper than that, and if it fails again the raw text still
            # gets its chance.
            with self._lock:
                self.usage.invalid_json_retries += 1
            if attempt == MAX_ATTEMPTS:
                return text
            full = (
                prompt
                + _SCHEMA_INSTRUCTION.format(
                    schema=json.dumps(schema.model_json_schema(), indent=2)
                )
                + "\nYour previous reply was not valid JSON for that schema:\n"
                + text[:500]
            )
        raise last or JudgeError("the judge produced no usable answer")


def _coerce(text: str, schema: Any) -> Any:
    """Best effort parse of a model's reply into the schema DeepEval asked for."""
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.split("\n", 1)[-1]
        if candidate.rstrip().endswith("```"):
            candidate = candidate.rstrip()[: -len("```")]
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return schema.model_validate_json(candidate[start : end + 1])
    except Exception:  # noqa: BLE001 - any validation failure means "retry", not "crash"
        return None
