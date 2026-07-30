# Challenge to the DeepEval evaluation design

**Date:** 2026-07-30

**Status:** Review note. Challenges
[the 2026-07-28 evaluation design](2026-07-28-deepeval-opnsense-agent-evaluation-design.md) against
the current DeepEval documentation and against `deepeval==4.1.4` as actually installed. Nothing here
is approved; it is the evidence an owner would need to decide.

Every claim below is marked **measured** (executed against the installed release), **source** (read
in the 4.1.4 source), **docs** (read on deepeval.com) or **UNVERIFIED**.

## Summary

Three load-bearing claims in the spec do not survive contact with the release. Its refusal of an
independent oracle is right about scope and wrong about blind spots, and exactly one of the two
defects this product has shipped proves it. Its status line is stale: a working Level C exists under
[`evals/`](../../../evals/README.md).

## C1 — `ToolCorrectnessMetric` is not usable as an offline blocking gate

The spec makes it the blocking tool-choice metric on the basis that "DeepEval documents that its
core comparison is then deterministic" when `available_tools` is omitted.

**Measured:** `ToolCorrectnessMetric.__init__` calls `initialize_model(None)` unconditionally and
raises `DeepEvalError: OpenAI API key is not configured` with no key, whether or not
`available_tools` is passed. The metric cannot be constructed offline at all. With a throwaway
`OPENAI_API_KEY` the scoring path is genuinely local — but the object then holds a live OpenAI
client inside a gate that is supposed to be offline and evidence-grade.

**Change:** drop the determinism sentence and the metric from the blocking row. The blocking tool
gate is a project-owned `BaseMetric`; `ToolSelectionMetric` in `evals/metrics.py` implements the
same recall semantics with no model, and its numbers were verified against 4.1.4. S3's ordered tool
sequence needs an ordered-subsequence variant — about twenty more lines, still no provider.

## C2 — No LLM-judged metric can become a blocking gate here

The spec has the MCP metrics "score-only until calibrated", implying they graduate.

**Source:** `MCPUseMetric`, `MultiTurnMCPUseMetric` and `MCPTaskCompletionMetric` all instantiate a
judge in `__init__` and every scoring path goes through the judge. There is no non-LLM branch and no
flag that makes one. `threshold=None` is honoured (score-only) but must never be combined with
`strict_mode=True`, which forces `threshold=1`.

**Measured, and decisive for this workstation:** there is no judge available at all. Neither
`ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set; the `claude` CLI authenticates by OAuth, which
DeepEval cannot use. Any design whose gates need a judge cannot run here today.

**Change:** state that no LLM-judged metric is blocking for an attested run. Judged metrics are
advisory, reported with their judge identity, and excluded from pass/fail. Add the trap that a
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
- **`@deepeval.log_hyperparameters`** — the mechanism the spec asks for without naming, pinning judge
  model, version and metric parameters into the results artefact. Values must be `str | int | float`.
- **`DEEPEVAL_RESULTS_FOLDER`** — there is no `--json` flag (source). `save_test_run_locally()` always
  writes `.deepeval/.latest_run_full.json`; this variable adds a timestamped full `TestRun` document,
  which is the artefact an attestation should digest.
- **`Rubric` on GEval** — exists in the current release and reduces judge variance. Note `criteria`
  and `evaluation_steps` are mutually exclusive and `include_reason` is *not* a GEval parameter.
  GEval scores via `top_logprobs`; whether it degrades gracefully on a judge without logprobs is
  **UNVERIFIED**.
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
- **`deepeval inspect` is UNVERIFIED** — not found in the 4.1.4 source. `deepeval view` exists and
  points at Confident AI.
- **Privacy gap:** DeepEval creates `.deepeval/` in the working directory with default permissions,
  holding the same tool results the spec requires be kept at `0600`. The runner now pre-creates it
  `0700`.
- **A known limit of the agent path:** the harness reads the *client's* `tool_result` rendering, so
  the server's `structuredContent` and its own `isError` never reach the scored test case. The oracle
  path does read `structuredContent`. Closing that gap needs a client that surfaces the raw result.
- **The status line is stale** — it says implementation has not started.
