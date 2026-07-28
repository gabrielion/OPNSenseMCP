# DeepEval and OPNsense Agent Evaluation Design

**Date:** 2026-07-28

**Status:** Architecture approved by the owner; written specification awaiting owner review

## Outcome

Build a canonical agentic evaluation suite that exercises the installed OPNSenseMCP server against the
disposable OPNsense VM, evaluates the agent with DeepEval, and proves the real OPNsense state transitions
observed through MCP. A successful tool response is not sufficient: every state-changing scenario must read
the target state back and fail if the requested change did not occur.

The first implementation is a clean-room vertical based on the current public DeepEval documentation. It
does not copy the provenance-controlled legacy `tests/agentic/**` assets. Once the vertical is trustworthy,
the historical corpus can be admitted through the repository's separate provenance workflow.

## Why this exists

OPNSenseMCP is both:

1. an MCP server whose transport, schemas, policy, confirmation and result contracts must work; and
2. a controller for an external stateful system whose real outcome matters more than a success-shaped
   response.

An agentic test therefore answers four different questions:

1. Did the agent select the appropriate MCP primitive and arguments?
2. Did the installed MCP server execute successfully?
3. Did the disposable OPNsense VM actually reach the expected state, without an unexpected adjacent change?
4. Did the agent react and report truthfully given the tool results?

No single LLM-as-a-judge score may substitute for question 3.

## Current official DeepEval model

This design follows the current DeepEval documentation, whose pages still carry a “DeepEval 4.0” banner,
and pins the first implementation to `deepeval==4.1.4`, the current PyPI release checked on 2026-07-28.
The exact pin matters because the versionless documentation and the package release can advance
independently.

The relevant official documentation is:

- [DeepEval introduction](https://deepeval.com/docs/introduction)
- [DeepEval package and release history on PyPI](https://pypi.org/project/deepeval/)
- [MCP evaluation model](https://deepeval.com/docs/evaluation-mcp)
- [MCP evaluation quickstart](https://deepeval.com/docs/getting-started-mcp)
- [Single-turn test cases](https://deepeval.com/docs/evaluation-test-cases)
- [Multi-turn test cases](https://deepeval.com/docs/evaluation-multiturn-test-cases)
- [Datasets and goldens](https://deepeval.com/docs/evaluation-datasets)
- [End-to-end evaluations](https://deepeval.com/docs/evaluation-end-to-end-llm-evals)
- [Agent evaluation and tracing](https://deepeval.com/docs/getting-started-agents)
- [Tool Correctness](https://deepeval.com/docs/metrics-tool-correctness)
- [MCP Use](https://deepeval.com/docs/metrics-mcp-use)
- [Multi-Turn MCP Use](https://deepeval.com/docs/metrics-multi-turn-mcp-use)
- [MCP Task Completion](https://deepeval.com/docs/metrics-mcp-task-completion)
- [G-Eval](https://deepeval.com/docs/metrics-llm-evals)
- [Custom deterministic metrics](https://deepeval.com/docs/metrics-custom)
- [Unit testing in CI/CD](https://deepeval.com/docs/evaluation-unit-testing-in-ci-cd)
- [CLI settings](https://deepeval.com/docs/command-line-interface)
- [Flags, repeats, caching and results](https://deepeval.com/docs/evaluation-flags-and-configs)
- [Data privacy](https://deepeval.com/docs/data-privacy)
- [Environment variables](https://deepeval.com/docs/environment-variables)
- [Claude Code MCP and elicitation](https://code.claude.com/docs/en/mcp)

DeepEval's documented MCP flow is:

1. connect the application to the real MCP server;
2. collect the server's live `tools/list`, `resources/list` and `prompts/list` data as applicable;
3. capture every runtime primitive call and its real result;
4. construct the DeepEval test case after application execution; and
5. run the selected metrics over that populated test case.

For this project, Claude Code is the MCP host, the installed OPNSenseMCP package is the MCP server, and the
disposable OPNsense VM is the server's external target.

## Terms used in this design

### Tool result

The `CallToolResult` returned by OPNSenseMCP. It proves what the server reported to its caller. It does not,
by itself, prove that a mutation changed OPNsense.

### Readback

A subsequent MCP read of the same OPNsense resource during the same owned VM scenario. The readback must
observe the expected postcondition. This is the initial authoritative outcome check because the product
being evaluated is the MCP server itself.

### State-transition assertion

A deterministic comparison between pre-state, mutation result and post-state. It is not an LLM judgment.
It must fail when a tool reports success but the readback remains unchanged.

### Agentic score

A DeepEval metric result describing tool choice, arguments, task completion, trajectory or response quality.
It is reported separately from state-transition assertions.

## Selected architecture

```text
versioned Golden
      |
      v
Claude Code host (`claude -p --output-format stream-json`)
      |
      | tools/list, tools/call, CallToolResult
      v
installed OPNSenseMCP server
      |
      v
owned disposable OPNsense VM
      |
      +--> MCP readback in the same scenario

captured Claude/MCP trace
      |
      +--> deterministic state-transition and policy checks
      |
      +--> DeepEval LLMTestCase / ConversationalTestCase
              |
              +--> MCP Use / Tool Correctness / task and response metrics
```

The implementation has five isolated components.

### 1. Versioned scenario catalogue

The catalogue stores DeepEval `Golden` or `ConversationalGolden`-equivalent data:

- stable scenario id and category;
- user input or multi-turn scenario;
- expected MCP tools and forbidden tools;
- exact or predicate-based argument expectations;
- expected OPNsense precondition and postcondition;
- cleanup requirements;
- response-quality criteria;
- execution profile, such as `read-only`, `operator-preauthorized` or later
  `interactive-pedagogy`;
- required server scopes, feature flags and transport;
- whether the scenario is offline, installed-mock or disposable-VM only.

The catalogue does not store runtime `actual_output`, runtime calls, credentials, raw configuration XML or
other generated values. DeepEval calls these static templates goldens; runtime data turns them into test
cases.

### 2. Hardened Node orchestrator

The Node side owns process and VM lifecycle because the repository already has hardened, tested primitives
for:

- installing the current package into an isolated consumer;
- bounded child-process output and timeouts;
- strict MCP lifecycle and shutdown;
- private temporary roots;
- disposable VM ownership, bootstrap, stop and residue verification; and
- redaction and fixed exit classifications.

It launches Claude Code without a shell, supplies a private MCP configuration, consumes
`--output-format stream-json`, and normalizes:

- assistant `tool_use` blocks;
- user `tool_result` blocks;
- tool-use ids;
- MCP tool names;
- validated argument objects;
- bounded result objects;
- `is_error`;
- final model output;
- process exit, timeout and capacity/quota classification.

Credentials remain in a private file or inherited environment. They never appear in process arguments,
test ids, logs, traces or DeepEval inputs.

Read-only scenarios need no elicitation. For the fixed preauthorized alias scenario, a private Claude Code
`Elicitation` hook accepts only the exact expected server, form schema and sealed change summary. It refuses
every URL-mode, unexpected field, different resource or different value. Needing that hook is part of the
test profile, not a bypass of the server's confirmation gate.

### 3. Data-only Python DeepEval worker

The Python worker receives a versioned, strictly validated JSON or JSONL document. It does not import the
Node capability implementation, executable Zod schemas or callbacks.

After the agent run it constructs:

- `MCPServer(server_name=..., transport=..., available_tools=...)` from the observed server surface;
- `MCPToolCall(name=..., args=..., result=...)` for each captured MCP call;
- a single-turn `LLMTestCase` for one user request and final response; or
- a `ConversationalTestCase` containing `Turn` objects and their per-turn MCP calls.

The adapter also constructs generic `ToolCall` objects when a metric such as `ToolCorrectnessMetric`
requires `tools_called` and `expected_tools`.

The initial worker uses the documented Python API, not the newer TypeScript port. DeepEval documentation,
examples and the historical project harness are all Python-first, while the TypeScript port is still a
young 0.1.x package.

### 4. Deterministic OPNsense state metric

A project-specific `BaseMetric` or an equivalent pre-`assert_test` assertion consumes the captured MCP
results. It never asks an LLM whether the VM changed.

For the first alias lifecycle it proves:

1. the initial paginated `opn_list firewall.alias` response contains no target alias;
2. `opn_create` returns one bounded host-alias item with the requested canonical fields and a valid UUID;
3. the next `opn_list` response contains exactly that UUID and canonical content;
4. `opn_delete` targets that same UUID;
5. the final `opn_list` response no longer contains that UUID;
6. all five MCP results have `isError !== true`;
7. totals and neighboring entries match the declared fixture expectations; and
8. VM stop and residue cleanup succeed.

The metric fails if either write is a no-op, if a different alias changed, if the server reports success
without the corresponding readback, or if cleanup cannot be proven.

The initial fixture is deliberately bounded to the already proven Product 3 empty-alias lifecycle. Broader
no-collateral-change claims require a canonical complete-page snapshot and are not inferred from the
current single-page API behavior.

### 5. Report and attestation boundary

Private local reports may include sanitized inputs, bounded tool results, DeepEval scores and judge reasons.
Public evidence contains only allow-listed metadata, fixed booleans, counts and cryptographic digests. It
never contains raw OPNsense responses, credentials, configuration XML, private paths or judge-provider
secrets.

## Evaluation levels

### Level A — deterministic offline adapter

Synthetic stream-json fixtures prove parsing, correlation, redaction and fail-closed handling of malformed,
missing, duplicate and unresolved results. No model, server or VM runs.

This level becomes part of the regular deterministic test suite once stable.

### Level B — installed MCP server against a synthetic target

The installed package is exercised through MCP rather than by importing internal dispatch functions.
Fixtures prove schema mapping and DeepEval test-case construction without model or VM cost.

### Level C — real read-only VM scenario

The disposable VM is bootstrapped with the existing read-only account. Claude Code must use the installed
server to answer a request that requires `opn_get system.status` or `opn_list core.services`. The captured
result is checked deterministically and then evaluated with DeepEval.

This is the first live vertical because it validates the complete host → MCP server → OPNsense path without
introducing mutation cleanup as a confounder.

### Level D — real alias state-transition scenario

The existing Product 3 VM policy is reused:

- `READ_ONLY=false`;
- feature flag `experimental-alias-write`;
- scopes `server.status,system.status,core.services,firewall.alias`;
- stdio transport with `elicitation.form`;
- disposable OPNsense only.

The scenario observes absent → create → present → delete → absent through the installed server. It fails on
any missing transition, regardless of the agent's prose or LLM judge score.

### Level E — multi-turn reaction scenarios

After the first live state-transition vertical is stable, add:

- ambiguous write request: ask for the missing information, perform no mutation;
- confirmation denied: stop without mutation;
- tool error or timeout: do not claim success;
- user changes their mind: cancel safely;
- successful write: describe only the readback-confirmed state;
- repeated request: avoid an unintended duplicate;
- failed readback after success-shaped mutation result: report uncertainty or failure, never success.

Use `ConversationalTestCase`, `MultiTurnMCPUseMetric` and `MCPTaskCompletionMetric` for these cases.

## Metric policy

| Question | Mechanism | Initial verdict role |
| --- | --- | --- |
| Did the expected tool run? | `ToolCorrectnessMetric` with expected tools | Blocking when the golden defines one required path |
| Were the MCP primitive and arguments reasonable? | `MCPUseMetric` or `MultiTurnMCPUseMetric` | Score-only until calibrated |
| Did the VM actually transition? | Deterministic OPNsense state metric | Always blocking |
| Did setup, process shutdown and cleanup succeed? | Deterministic lifecycle assertions | Always blocking |
| Did the agent complete the conversational task? | `MCPTaskCompletionMetric` | Score-only until calibrated |
| Was the final response truthful and operationally useful? | Explicit-step `GEval` | Score-only until calibrated |
| Did the agent call a forbidden or additional mutating tool? | Deterministic allow/deny and effect-policy check | Always blocking |

LLM-judged metrics begin with `threshold=None` where the current DeepEval API permits score-only mode.
They become blocking only after comparison with a small, versioned, human-labeled calibration set. The judge
model, DeepEval version, metric parameters and evaluation steps are pinned in every attested run.

The blocking `ToolCorrectnessMetric` omits `available_tools`, uses the golden's expected calls and enables
the required exact/order/input matching. DeepEval documents that its core comparison is then deterministic;
the separate MCP-use metric receives the available surface for qualitative optimality scoring.

A failed blocking metric is never averaged away by a high qualitative score.

## First sentinel scenarios

The first implementation plan must cover these scenarios in order.

### S1 — Real service read

- Input: ask for the bounded current core-service status.
- Expected tool: `opn_list`.
- Expected resource: `core.services`.
- State check: the real result is a valid bounded page from the disposable VM.
- Response check: every concrete service claim is supported by the returned page.
- Cleanup: stop the VM and prove no owned residue.

### S2 — Real singleton status read

- Input: ask for current OPNsense system status.
- Expected tool: `opn_get`.
- Expected resource: `system.status`.
- State check: the returned bounded status satisfies the current product schema.
- Response check: no field absent from the result is invented.

### S3 — Real reversible alias mutation

- Input: in the preauthorized lab profile, create the fixed Product 3 host alias, verify it, remove it and
  verify absence.
- Expected ordered tools: `opn_list`, `opn_create`, `opn_list`, `opn_delete`, `opn_list`.
- State check: absent → created UUID → same UUID present → same UUID deleted → absent.
- Response check: claim success only when every transition is observed.
- Cleanup: VM stop and residue proof are mandatory even if the agent or judge fails.

### S4 — Success-shaped no-op regression

Feed the evaluator a controlled trace in which `opn_create` reports success but the following `opn_list`
remains unchanged.

Expected result:

- DeepEval semantic metrics may still return any score;
- the deterministic OPNsense state metric returns failure;
- the complete scenario fails.

This is the explicit test that gives the state-verification requirement teeth.

## Pass, failure and infrastructure classifications

A scenario passes only when:

- agent execution completed without timeout, overflow or unresolved tool call;
- every required deterministic tool-policy check passed;
- every required state transition was observed;
- cleanup and residue checks passed; and
- every currently blocking DeepEval metric passed.

The following are test failures, not infrastructure excuses:

- wrong tool or wrong resource;
- malformed or unsafe arguments;
- success-shaped mutation with failed readback;
- false success claim;
- unexpected additional mutation;
- cleanup failure caused by the scenario.

The following may be classified separately as infrastructure only when proven by fixed evidence:

- judge-provider quota or capacity error;
- Claude CLI authentication unavailable before the scenario begins;
- verified disposable-image or host prerequisite unavailable;
- owned VM start failure before the agent runs.

Infrastructure classification is fail-closed and cannot be inferred from arbitrary stderr text supplied by
the model or server.

## Repeat and reliability policy

DeepEval's `deepeval test run -r N` repeats the test function. A repeat counts as an independent agent trial
only when the test invokes Claude and provisions fresh state inside that function.

- Offline adapter tests may run in parallel.
- Live tests run sequentially.
- Every live mutation repetition receives a fresh disposable overlay.
- The initial acceptance run uses at least three independent repetitions for each sentinel scenario.
- Mutation reliability reports both first-attempt success and all-trials success; it does not report only
  pass-at-least-once.
- Cached LLM grades are not used for attested live reliability runs.

## Security and privacy

- Never target a production firewall.
- Never pass a credential in a process argument.
- Do not commit `.env`, DeepEval key files, raw test runs, MCP configs, OPNsense connection files or VM
  responses.
- Set `DEEPEVAL_TELEMETRY_OPT_OUT=1`.
- Set `DEEPEVAL_DISABLE_DOTENV=1` so imports cannot silently load repository dotenv files.
- Set `DEEPEVAL_DISABLE_LEGACY_KEYFILE=1`, explicitly remove `CONFIDENT_API_KEY` from the worker environment
  and leave error reporting disabled; Confident AI upload is out of scope for the first vertical.
- Configure the LLM judge only through inherited environment or another approved private provider
  mechanism.
- Sanitize every tool result before sending it to an external judge.
- Bound stdout, stderr, trace length, individual result size, wall time, model turns and model budget.
- Disable unrelated Claude tools such as shell, web and file editing during the benchmark.
- Use a private temporary MCP configuration and delete it in `finally`.

The user-provided development password does not relax these rules. The runner still treats every
credential-shaped value as secret material.

## Dependency and command boundary

The implementation plan must:

- keep Node.js at `>=22.19.0 <23` and use the workstation's Homebrew Node 22 path;
- use `npm ci --ignore-scripts`;
- create a reproducible Python environment outside committed source;
- pin `deepeval==4.1.4` and every direct Python dependency selected by the plan;
- record and test the actual interpreter used; PyPI declares Python `>=3.9,<4`, but that metadata does not
  replace a clean bootstrap test of the pinned environment;
- expose one setup command, one offline validation command and one live agentic command;
- keep the live VM/model run outside `npm run verify`;
- make the offline portion eligible for regular CI only after it is deterministic and hermetic.

Proposed public commands, subject to the implementation plan:

```text
npm run eval:setup
npm run eval:validate
npm run test:agentic:vm
```

The commands are not implemented by this specification and must not be documented as working until their
tests pass.

## Local results and public evidence

DeepEval can persist local JSON results and provides `deepeval inspect` for trace-oriented runs. For the
first vertical:

- results live under a private ignored directory with mode `0700`;
- individual files use mode `0600`;
- CI output shows scenario ids, fixed status, metric scores and sanitized reasons only;
- public evidence records the tested Git commit/tree, installed package digest, DeepEval version, resolved
  agent model identity, judge model identity, scenario-catalogue digest, transport/protocol version, fixed
  lifecycle booleans and result digests;
- quota/capacity exits remain distinct from test failures;
- no public score is called canonical until the run is complete, state-verified, cleanup-verified and
  attested.

## Provenance boundary

The public migration manifest lists 28 `tests/agentic/**` destinations as
`approved-pending-migration` with no public source digest. The superseded historical plan must not be
executed, and an unreachable historical Git object is not the private authorization baseline.

Therefore:

- the first implementation uses new clean-room paths under `tests/evals/**` and `scripts/evals/**`;
- no historical file is copied, restored with `git show`, or presented as migrated;
- the old corpus and DSL may be admitted later only through private preflight, operator checkpoint,
  destination review and public digest sealing;
- useful historical behaviors may inform requirements, but their implementation expressions are not
  reused outside the authorized workflow.

## Considered alternatives

### Migrate the complete legacy harness first

This would immediately recover 108 historical conversations, but the files are still behind the provenance
checkpoint and the old harness targets APIs and paths that no longer exist. It would delay the first
current-product signal and risk importing obsolete assumptions. Deferred.

### Add DeepEval tracing inside production TypeScript

This would provide span-level component views but would couple evaluation code to the production server,
while the current Claude Code CLI path is externally hosted and the documented DeepEval tracing SDK is
Python-first. It is unnecessary for the first black-box MCP proof. Deferred until the canonical end-to-end
trace is stable.

### Selected: clean-room host-level evaluation

This follows DeepEval's MCP quickstart: collect the real runtime primitives, construct test cases after the
application runs, and evaluate them. It reaches current-product value fastest while preserving provenance
and the production/runtime boundary.

## Implementation sequence

After the owner approves this written specification:

1. write a TDD implementation plan;
2. implement the offline trace schema and adversarial parser tests;
3. implement the Python DeepEval adapter and deterministic no-op regression;
4. run one installed synthetic-target test;
5. run S1 and S2 against a fresh disposable VM;
6. run S3 against a fresh disposable VM and prove all state transitions;
7. calibrate qualitative metrics against human labels;
8. repeat the live sentinel set at least three times from fresh state;
9. review, attest and publish only the bounded evidence;
10. plan the separately authorized historical-corpus migration.

## Definition of done for the first vertical

- DeepEval 4.1.4 is installed reproducibly and its effective version is reported.
- A versioned golden becomes a runtime test case only after a real agent/server execution.
- Claude Code calls the installed OPNSenseMCP package, not an internal handler.
- The live `tools/list` surface is supplied to DeepEval.
- Every MCP tool call is correlated with its real result.
- S1 through S4 pass their intended positive or negative expectations.
- S3 fails under a controlled success-shaped no-op.
- VM cleanup and residue checks run even when Claude or a metric fails.
- No secret or raw firewall configuration appears in tracked files or bounded output.
- Offline tests pass in the regular deterministic environment.
- Live tests remain explicit and cannot accidentally target a production firewall.
- The report distinguishes deterministic outcome failures, semantic metric failures and infrastructure
  blockage.
- An independent review finds no unaddressed Critical or Important issue.

## Explicitly unresolved

The initial judge provider is not yet selected. DeepEval supports OpenAI, Anthropic, Azure OpenAI, Bedrock,
Ollama and custom models. Before implementation, the runner will detect only the presence—not the value—of
approved provider configuration and fail with a fixed preflight code when no judge is available. It will
not invent an API key or silently substitute a provider.

Confident AI remains disabled for the initial vertical. Enabling cloud result storage later requires a
separate privacy and data-retention decision.
