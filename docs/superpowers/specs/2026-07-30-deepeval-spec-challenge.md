# Challenge to the DeepEval evaluation design

**Date:** 2026-07-30

**Status:** Review note, revised the same day. Challenges
[the 2026-07-28 evaluation design](2026-07-28-deepeval-opnsense-agent-evaluation-design.md) against
the current DeepEval documentation and against `deepeval==4.1.4` as actually installed. Nothing here
is approved; it is the evidence an owner would need to decide.

Every claim below is marked **measured** (executed against the installed release), **source** (read
in the 4.1.4 source), **docs** (read on deepeval.com) or **UNVERIFIED**.

**Corrections in this revision**, each because the first version generalised from one measurement:
C1 (the metric *is* constructible offline — give it a model object), C2 (a judge *is* available —
the CLI behind `DeepEvalBaseLLM`), C6 (`log_hyperparameters` is discarded by `evaluate()`; GEval's
no-logprob fallback resolved from UNVERIFIED to working), C7 (`deepeval inspect` exists). Two new
sections: [C8](#c8--the-claude-cli-as-the-judge) on the CLI judge and
[C9](#c9--what-the-archived-ground-truth-harness-already-knew) on the archived harness.

## Summary

Three load-bearing claims in the spec do not survive contact with the release. Its refusal of an
independent oracle is right about scope and wrong about blind spots, and exactly one of the two
defects this product has shipped proves it. Its status line is stale: a working Level C exists under
[`evals/`](../../../evals/README.md), and a Level A offline contract now exists beside it.

The recurring lesson of this revision is narrower than any single finding: **a capability that is
absent by default is not a capability that is absent.** Three of the four corrections above are the
same mistake — measuring the default path, then reporting the default as the limit.

## C1 — `ToolCorrectnessMetric` needs a model *object*, not a key — corrected 2026-07-30

The spec makes it the blocking tool-choice metric on the basis that "DeepEval documents that its
core comparison is then deterministic" when `available_tools` is omitted.

**Measured:** `ToolCorrectnessMetric.__init__` calls `initialize_model(model)` unconditionally, and
with the default `model=None` that ends at `GPTModel()`, which raises `DeepEvalError: OpenAI API key
is not configured`.

**Correction to the first version of this note.** It concluded "the metric cannot be constructed
offline at all". That was measured with the default constructor and is wrong in general.
`initialize_model()` returns any `DeepEvalBaseLLM` instance untouched, with
`using_native_model=False` and no provider client built. So:

```python
ToolCorrectnessMetric(model=ClaudeCodeJudge(), async_mode=False)   # no key, no network
```

constructs, and with `available_tools` left unset it scores through a hard-coded
`ToolSelectionScore(score=1, …)` and a `_generate_reason()` that is pure string formatting — **zero
judge calls**, verified by asserting the judge's call counter stayed at 0 across a `measure()`.

This also supersedes the workaround in this repository's own earlier ground-truth harness, which set
`OPENAI_API_KEY=sk-deepeval-noop-deterministic-offline` to get past the constructor. That works, but
it leaves a live OpenAI client inside an offline gate; handing the metric a model object removes the
client instead of feeding it a fake key.

**Change:** keep the metric out of the blocking row, but for the right reason. It is now known to be
constructible and deterministic offline; what disqualifies it is that its recall semantics are not
the ones this vertical wants (`ToolSelectionMetric` does not penalise the exploratory `opn_describe`
call the server's own instructions ask for). The spec's *stated basis* is still wrong and must be
rewritten: the metric is not deterministic "because `available_tools` is omitted", it is
deterministic because nothing on that path reaches a model. S3's ordered tool sequence needs an
ordered-subsequence variant — about twenty more lines, still no provider.

## C2 — A judge is now available, and still must not be a blocking gate

The spec has the MCP metrics "score-only until calibrated", implying they graduate.

**Source:** `MCPUseMetric`, `MultiTurnMCPUseMetric` and `MCPTaskCompletionMetric` all instantiate a
judge in `__init__` and every scoring path goes through the judge. There is no non-LLM branch and no
flag that makes one. `threshold=None` is honoured (score-only) but must never be combined with
`strict_mode=True`, which forces `threshold=1`.

**Superseded:** the first version of this note said no judge was available at all, since neither
`ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set and the `claude` CLI authenticates by OAuth. The
missing key is real; the conclusion was too strong. `DeepEvalBaseLLM` is a documented extension
point and the CLI can sit behind it — see [C8](#c8--the-claude-cli-as-the-judge). Judged metrics
therefore *can* run on this workstation, on the operator's own subscription.

**Unchanged, and now for a better reason:** they still must not gate. Availability was never the
argument — reproducibility is. The CLI exposes no temperature, no seed and no logprobs, so the same
answer scored twice may differ. A release gate that flickers trains people to re-run it until it
passes, which is worse than not having one.

**Change:** state that no LLM-judged metric is blocking for an attested run, because a judged score
is not reproducible — not because no judge exists. Judged metrics are advisory, reported with their
judge identity and their cost, and excluded from pass/fail. In `evals/` that exclusion is
structural rather than a label: advisory metrics are measured in `advisory.py` and never handed to
`evaluate()`, so no code path carries a judge's opinion into the exit code. Add the trap that a
two-turn conversation scores a hard `0.0` rather than erroring, so Level E scenarios will look like
agent failures for structural reasons unless each interaction has at least three turns.

## C3 — Invert the Node/Python split

The spec puts Node in charge of the loop and reduces Python to a data-only worker.

Two ideas are fused there and only one is good. The **data boundary** — no importing Node capability
code, no executable schemas, no callbacks — is right and should stay non-negotiable. **Owning the
loop** is not: `evals_iterator`, tracing and per-span metrics all require the process that invokes
the agent to be the one holding the test-run context. Reuse of the hardened primitives does not need
Node to own the loop; Python can call `product1b.mjs`, `prepare-installed-package.mjs` and
`hardened-stdio-lifecycle.mjs` as bounded subprocesses.

**Change:** Python owns the eval loop, Node keeps owning VM lifecycle, pack/install and bounded
stdio, invoked as tools. Keep the versioned JSON boundary for everything Node produces.

The cost of getting this wrong was real and is worth recording: the first Python-drives-everything
implementation used `subprocess.run(capture_output=True)`, so a runaway agent decided this process's
memory — against a spec that explicitly requires bounded stdout, stderr and wall time. Fixed in
`evals/harness.py`, which now reads under a byte cap and a deadline and refuses to score a truncated
trace.

## C4 — Tracing cannot cross the `claude -p` boundary

The spec never mentions tracing, and defers in-production tracing for the right conclusion with the
wrong reason.

**Measured:** DeepEval's tracing context lives in `contextvars` and does not survive `fork`/`exec` —
an instrumented child opens its own disconnected root trace. There is no `traceparent` receiver in
`deepeval/tracing/`; the only OTLP code is an exporter to Confident AI. So span-level visibility
*inside* the agent is unavailable at any price while the agent is a subprocess.

**Measured, and useful:** component-level evals do run fully locally — no Confident AI, no key. The
CLI invocation can be wrapped as a single `@observe(type="tool")` span with metrics attached.

**Change:** add a Tracing subsection saying no design may promise span-level visibility inside
`claude -p`; the maximum fidelity is one tool span per invocation; defer adoption to Level D/E where
per-step scoring pays for it. Note that `metric_collection`, `evaluate_span`, `evaluate_trace` and
`evaluate_thread` are cloud-only and banned while Confident AI is disabled. One blocker to check
first (**UNVERIFIED**): span→test-case reconstruction destructures a fixed field list that does not
include `additional_metadata`, which every current metric reads.

## C5 — Keep the independent oracle, and re-scope it

The spec forbids a parallel REST reading as an oracle.

**For the spec.** The MCP readback *is* the customer-visible contract. A second implementation can be
wrong on its own and manufacture false failures; it duplicates pagination and parsing that will
drift; a disagreement is ambiguous by construction. And concretely: the least-privilege bootstrap
account gets HTTP 403 on `firewall.alias`, so a REST oracle at Level D would need a *more*
privileged credential than the thing being evaluated.

**Against it.** Be precise, because only one of this product's two defects actually argues for it.
The clamped pagination echo surfaced as `EXECUTION_FAILED` on the wire and was caught with no oracle
involved — it proves nothing here. The **polymorphic status enum** is the real shape: a wrong status
*word*, read back consistently through MCP, agrees with itself forever. Every check goes green. Only
a reading that does not share the parser catches it. MCP-only readback catches call-level failure
and misses value-level mistranslation.

**Change — keep both, and separate their jobs.** The agent's answer is judged against the MCP
readback; the spec keeps that. An independent REST reading is compared **to the MCP reading, not to
the agent**, and a disagreement is its own finding class. `ServerFaithfulToVmMetric` implements
exactly that. The REST reader is read-scope only, walks small pages so it keeps working against a
defective server, and shares no parsing code with the server — in particular it re-derives the
status enum, since an oracle that imports the mapping cannot notice the mapping being wrong. For
Level D the spec must choose explicitly: provision a read-scoped credential that can see
`firewall.alias`, or record in the attestation that the alias vertical has no independent fidelity
check.

## C6 — Current features the spec should use

- **`SingleTurnParams`** — `LLMTestCaseParams` now survives only behind a deprecation shim (source).
- **`metadata`, and a trap on the way there** — `LLMTestCase.additional_metadata` is deprecated in
  favour of `metadata` and warns on every read. `Golden` has **not** followed: it still exposes only
  `additional_metadata`, and being a pydantic model that ignores unknown keyword arguments, it
  accepts `metadata={...}` **silently and discards it** (measured). The obvious migration therefore
  empties every golden with no error and no warning.
- **`hyperparameters=` on `evaluate()`, not the decorator** — correcting the first version of this
  note, which recommended `@deepeval.log_hyperparameters`. Measured: applied before `evaluate()`,
  the decorator's values are lost — the run prints "⚠ WARNING: No hyperparameters logged" and the
  saved document has `"hyperparameters": null`, because `evaluate()` installs a fresh test run over
  the decorated one. The decorator belongs to the `deepeval test run` pytest idiom. With
  `evaluate()`, pass `hyperparameters={...}`; values are coerced to strings.
- **`DEEPEVAL_RESULTS_FOLDER`** — there is no `--json` flag (source). `save_test_run_locally()` always
  writes `.deepeval/.latest_run_full.json`; this variable adds a timestamped full `TestRun` document,
  which is the artefact an attestation should digest. Measured: the file lands `0644`, so a suite
  that keeps tool results at `0600` must chmod it after the run.
- **`Rubric` on GEval** — exists in the current release and reduces judge variance. Note `criteria`
  and `evaluation_steps` are mutually exclusive and `include_reason` is *not* a GEval parameter.
  **Resolved (was UNVERIFIED): GEval does degrade gracefully without logprobs.** `no_log_prob_support()`
  only inspects the built-in provider classes, so with a custom model GEval attempts
  `a_generate_raw_response(top_logprobs=…)`, gets `AttributeError`, and the handler at
  `metrics/g_eval/g_eval.py:335` falls back to `a_generate_with_schema_and_extract`. Confirmed by
  source *and* by execution against the CLI judge. The cost is resolution, not failure: without
  `calculate_weighted_summed_score` the result is whatever integer the judge names, so treat GEval
  output here as coarse.
- **`assert_test` + `deepeval test run`** — the documented CI idiom, giving `-r` repeats from fresh
  state and exit-code propagation. `-r` needs `pytest-repeat`, `-n` needs `pytest-xdist`, and
  `-c/--use-cache` is silently disabled whenever `-r` is present (source), which happens to satisfy
  the no-cached-grades rule by accident — so say it on purpose.
- **`DAGMetric` — name it and reject it.** Its task and judgement nodes still call an LLM. A DAG fixes
  topology, not determinism. Put the rejection in "Considered alternatives" so it is not re-proposed.

## C7 — Smaller corrections before sign-off

- **`mcp` is a mandatory dependency** the spec omits: `LLMTestCase` validates
  `mcp_tools_called[].result` as a real `mcp.types.CallToolResult` (measured). Note the asymmetry —
  `available_tools` accepts plain dicts. And the constructor kwarg is `isError` while the field read
  back is `is_error`; getting that wrong makes metrics silently see `False`.
- **`MCPServer.server_name` is required**, not optional as the docs say.
- **`deepeval inspect` exists** — correcting the first version of this note, which said it was not
  found in the 4.1.4 source. It is at `deepeval/cli/inspect.py`, and it resolves its input from
  `--folder`, then `DEEPEVAL_RESULTS_FOLDER`, then the rolling `.deepeval/.latest_run_full.json`.
  `deepeval view` is the separate command that points at Confident AI.
- **Privacy gap:** DeepEval creates `.deepeval/` in the working directory with default permissions,
  holding the same tool results the spec requires be kept at `0600`. The runner now pre-creates it
  `0700`.
- **A known limit of the agent path:** the harness reads the *client's* `tool_result` rendering, so
  the server's `structuredContent` and its own `isError` never reach the scored test case. The oracle
  path does read `structuredContent`. Closing that gap needs a client that surfaces the raw result.
- **The status line is stale** — it says implementation has not started.

## C8 — The `claude` CLI as the judge

No API key is coming. The alternatives were a local open-weights judge (available, and worse than
the thing it would be grading), an OpenAI-compatible proxy in front of `claude -p`, or DeepEval's
own extension point. The third is correct and the second is a trap.

**Why not the proxy.** It has to convince DeepEval's `GPTModel` path that it is OpenAI, and that
path asks for `top_logprobs` — GEval reads `res.choices[0].logprobs` to compute its weighted score.
The CLI cannot produce token logprobs, so the proxy would have to fabricate a distribution, and a
fabricated distribution silently changes every GEval score into a number nothing produced.
Subclassing makes the same missing capability *visible*: `supports_log_probs()` returns False and
GEval takes its documented fallback. A proxy is right only for a consumer that speaks nothing but
OpenAI HTTP; DeepEval is not that consumer.

**Measured, working:** `evals/claude_judge.py` implements `DeepEvalBaseLLM` over `claude -p`.
`GEval(model=judge)` scores live cases through it; `ToolCorrectnessMetric(model=judge)` constructs
and scores with zero judge calls. Details that turned out to matter:

- **The prompt goes in on stdin, never as an argument.** Judge prompts carry the agent's answer and
  its tool results — material read off a firewall — and an argument is visible to every process on
  the machine through `ps`. It also sidesteps `ARG_MAX` on a long trace.
- **`--tools ""` empties the built-in tool set.** It halves the prompt (measured: 5,370 → 2,552
  input tokens) and makes the judge structurally unable to act on the text it is grading rather
  than merely forbidden to. A judge that can read files is a judge that can be talked into it.
- **The child must not inherit `ANTHROPIC_BASE_URL` or `CLAUDE_CODE_*`.** Inside a Claude Code
  session those point at a gateway the child holds no credential for, and every call 401s.
- **Cost is real and worth reporting.** About $0.04–0.05 per judged metric after the prompt cache
  warms, against roughly $0.15 cold. The run records `judge_calls` and `judge_cost_usd`.

**Change:** add a Judging subsection saying the judge is the operator's own CLI behind
`DeepEvalBaseLLM`, that it is opt-in (`EVAL_JUDGE=1`) and advisory-only per C2, and that no design
may reach for an OpenAI-shaped proxy to obtain logprobs it cannot honestly produce.

## C9 — What the archived ground-truth harness already knew

`tests/agentic/deepeval/` (on `main`, superseded) drove `claude -p` against a VM for the mutation
vertical. Reading it before rebuilding would have saved two defects, and it is worth naming what it
had that the current suite did not:

- **`_agent_env()`**, the gateway-variable strip above. Now in `harness.py`.
- **stderr to a file, plus a `threading.Timer` hard kill.** This is the important one. The rewritten
  `harness.py` had stderr on an undrained pipe while reading stdout line by line, which deadlocks
  forever once the child fills the ~64 KiB pipe buffer — and the deadline, checked inside the read
  loop, could never fire during precisely that hang. Regression test in `test_offline.py`.
- **`--model`, `--max-turns`, `--max-budget-usd`, `--no-session-persistence`.** An unpinned model
  means two runs are two experiments; the budget bound means a looping agent cannot spend the
  operator's quota unattended.
- **`capture_tool_trace_event` kept as a pure function "for deterministic regression tests"** — the
  Level A idea the spec asks for, already implemented once in this repository.
- **Unresolved tool calls attested explicitly.** A call whose result never arrived was recorded, not
  dropped; dropping it makes a run that died mid-tool look *cleaner* than a healthy one.
- **VM health gating and an INFRA-ERROR class** excluded from pass/fail — not yet ported, and the
  right answer for the TCG-emulated lab's flapping. Worth doing before any long live run.
