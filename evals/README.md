# Read-surface eval

A DeepEval suite that asks whether a competent agent, given nothing but this server's own tool
descriptions, can get real answers out of a real OPNsense — and notices when it cannot.

This is deliberately not another unit test. `npm run verify` already proves the server's own
contract against synthetic fixtures, and `npm run test:product1b` proves the packaged server works
against a disposable VM. Neither can see the failure this suite is built to catch: a tool whose
schema advertises something the firewall will not deliver, where the agent's answer still reads
fluently. The suite's first run found exactly that — see [What it caught](#what-it-caught).

## Running it

Never point this at a production firewall. Stand up the disposable lab first:

```bash
npm run vm:bootstrap
```

That boots a throwaway OPNsense, mints its own least-privilege account with no credential of yours,
and writes a private connection file. Then:

```bash
uv venv --python 3.13 evals/.venv && VIRTUAL_ENV=evals/.venv uv pip install -r evals/requirements.txt
npm run build
OPNSENSE_CONFIG_FILE="$HOME/Library/Caches/opnsense-mcp/product1b/instance/connection.json" \
  evals/.venv/bin/python evals/run_eval.py
```

Stop the lab when you are done: `npm run vm:stop`.

Exit codes: `0` every metric passed, `1` a metric failed, `2` a precondition failed, `3` the client
never reached the server (an outage, which is not a result).

`OPNSENSE_MCP_COMMAND` chooses what is scored. It defaults to this tree's `dist/main.js`; set it to
a JSON array to score something else — `'["npx","-y","@gabrielion/opnsense-mcp@0.1.0"]'` scores
exactly what is published on npm.

## How it is put together

| File                             | Role                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `groundtruth/read-surface.jsonl` | one golden per line: question, required tools, the _kind_ of fact required, and _why_ the case exists |
| `groundtruth/environment.json`   | what the lab is, for the reader — the goldens no longer depend on it for values                       |
| `oracle.py`                      | reads the firewall twice, through MCP and through its own REST API, and compares them                 |
| `harness.py`                     | drives the `claude` CLI as the agent under test, under a byte cap and a deadline                      |
| `metrics.py`                     | six deterministic metrics                                                                             |
| `run_eval.py`                    | read the firewall → ask → score against that reading → report                                         |

The agent is the `claude` CLI in print mode, configured with this server and nothing else
(`--strict-mcp-config`). Only MCP tool calls are recorded; the client's own harness tools are
ignored, because counting them would score the client rather than the server.

**Every metric is deterministic and offline.** No judge model, no API key, no network:

| Metric                   | Fails when                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool Selection           | a tool the question requires was never called (recall over `expected_tools`; extra exploration is not penalised)                                |
| No Tool Error            | any MCP call came back as an error, beyond those the golden tolerates                                                                           |
| No Forbidden Tool        | a tool the golden marks off-limits was called — the read-only posture tested from outside rather than asserted                                  |
| Answer Supported By VM   | a value the firewall reports right now is missing from the answer                                                                               |
| No Contradiction With VM | the answer asserts something the firewall contradicts — a wrong total, a wrong status, a wrong per-service state, a service that does not exist |
| Server Faithful To VM    | the MCP reading and the firewall's own REST reading disagree, or the second reading was not taken at all                                        |

DeepEval's own `ToolCorrectnessMetric` is documented as deterministic without `available_tools`, but
in 4.1.4 its constructor builds an OpenAI client unconditionally and raises without an
`OPENAI_API_KEY`. `ToolSelectionMetric` reimplements the same recall semantics with no model at all;
the semantics were verified against 4.1.4 and the numbers are recorded in `metrics.py`.

### The answer is checked against the firewall, not against a note

Earlier versions wrote the expected values into the goldens — twelve service names, a total, a
status word. That is precise and it rots: on a different lab the goldens fail for reasons that have
nothing to do with the server. Now a golden declares only the _kind_ of fact it needs
(`services_total`, `all_service_names`, `last_page_service_names`, …) and the runner resolves it
against the firewall at run time, immediately before asking. A passing run means the answer matched
what the firewall held, not what someone wrote down last Tuesday.

The firewall is read **twice**: once through the MCP server, and once straight from its own REST
API with no shared code — the REST reader even re-derives the status enum, because an oracle that
imports the mapping cannot notice the mapping being wrong. The two readings are compared with each
other before either is used to judge the agent, and a disagreement is its own finding rather than
being silently resolved in favour of one side.

That second reading is a deliberate disagreement with the design spec, which forbids a "parallel raw
REST implementation as an oracle". The reasoning is in
[the challenge note](../docs/superpowers/specs/2026-07-30-deepeval-spec-challenge.md): when the
answer and the check both flow through the same server, a server-side _mistranslation_ agrees with
itself forever and every check goes green. The clamped-pagination defect below does not prove this —
it failed loudly on the wire. The 26.7 status-enum defect does.

Both readers walk small pages on purpose. They must keep working against a **defective** server: a
check that a broken server fails would report a product defect as lab drift and stop the goldens
from ever running. An earlier precondition read `pageSize: 100` and did exactly that.

## What it caught

The first run, against published `0.1.0`, failed `services-full-listing` and `services-last-page`.
Asked for "all the services at once", the agent did the obvious thing and requested the schema's
advertised maximum of `pageSize: 100`. Every such call returned `EXECUTION_FAILED`.

OPNsense clamps the Bootgrid `rowCount` it echoes down to the number of rows it actually returned.
Confirmed on the wire against the 26.7 lab, which serves twelve services:

```
requested rowCount=13/25/100  ->  total=12  rowCount=12  rows=12
requested current=3 rowCount=5 ->  total=12  rowCount=2   rows=2   (last partial page)
requested current=4 rowCount=5 ->  total=12  rowCount=0   rows=0   (past the end)
```

`listServices` demanded a strict echo (`response.rowCount !== input.pageSize`) and its schema
required `rowCount >= 1`, so two whole classes of legitimate request failed: any page larger than
the collection, and the last page of any multi-page listing. The sibling alias adapter had already
been written to tolerate the clamp — the services path simply never received the same treatment.

Both shapes are now regression guards in the goldens, and the offline suite covers them directly in
`tests/opnsense/read-adapter.test.ts`.

### The guards were confirmed to fire

A green suite proves nothing unless it can go red, so both guards were replayed against the
published package and the fixed tree on the same lab, same preconditions, same day:

| Golden                  | published `0.1.0`                                               | fixed tree                        |
| ----------------------- | --------------------------------------------------------------- | --------------------------------- |
| `services-full-listing` | **FAIL** — 5 of 11 `opn_list` calls errored, 0/12 facts present | **PASS** — 4/4 calls, 12/12 facts |
| `services-last-page`    | **FAIL** — 3 of 8 `opn_list` calls errored                      | **PASS** — 5/5 calls, 2/2 facts   |

Reproduce either column with `EVAL_ONLY` and `OPNSENSE_MCP_COMMAND`.

Two things in that table are worth more than the pass/fail. On `services-last-page` against the
broken package, **Fact Containment still passed**: the agent hit the error, retried with smaller
pages and eventually assembled a correct answer. Only `No Tool Error` caught the defect. Judging the
prose alone would have called that run a success. And the call counts — 11 and 8 against the broken
package versus 4 and 5 against the fixed one — show the retry storm the answer text hides.

## Where this diverges from the approved design

[`docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md`](../docs/superpowers/specs/2026-07-28-deepeval-opnsense-agent-evaluation-design.md)
defines the owner-approved architecture for this vertical. What is here is that spec's **Level C**
(“real read-only VM scenario”, sentinels S1 and S2) and it reaches a running result — but it is not
the spec's architecture. The differences are listed so nobody mistakes one for the other:

| Spec                                                                                                                                          | Here                                                                                              | Consequence                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean-room paths `tests/evals/**` and `scripts/evals/**`                                                                                      | `evals/`                                                                                          | No provenance collision — no manifest asset targets either path, and `npm run provenance:verify` stays `PROVENANCE_OK` — but the spec's chosen layout is not honoured                                           |
| Node orchestrator owns lifecycle; Python worker is data-only                                                                                  | Python drives the client and spawns the server                                                    | The repository's hardened primitives (`hardened-stdio-lifecycle.mjs`, `prepare-installed-package.mjs`, `private-fixture-root.mjs`) are re-implemented in a thinner form instead of reused                       |
| Claude Code calls the **installed** package                                                                                                   | Defaults to this tree's `dist/main.js`; `OPNSENSE_MCP_COMMAND` can point at the published package | Real bin over real stdio, never an internal handler — but not a packed-and-installed consumer                                                                                                                   |
| Level A offline contract first: synthetic stream-json fixtures proving malformed, unresolved, duplicate and secret-bearing traces fail closed | Started at Level C                                                                                | The stream-json parser in `harness.py` has no offline tests, so a parsing regression would surface as a mysterious eval failure                                                                                 |
| `ToolCorrectnessMetric` is the blocking tool-choice mechanism                                                                                 | `ToolSelectionMetric` re-implements its recall semantics                                          | The spec's stated basis — that the metric is deterministic when `available_tools` is omitted — is false in 4.1.4: the constructor builds an OpenAI client and raises without a key. Evidence is in `metrics.py` |
| S4, the success-shaped no-op regression, implemented early                                                                                    | Absent                                                                                            | S4 concerns mutation and this vertical is read-only, but the spec wants that guard in place before live runs                                                                                                    |
| `npm run eval:setup` / `eval:validate` / `test:agentic:vm`                                                                                    | `npm run eval:setup` and `npm run eval:read-surface`                                              | No offline validation command exists yet, because there is no offline level to validate                                                                                                                         |
| Deterministic offline portion eligible for CI                                                                                                 | Not in CI                                                                                         | Needs a live model and a VM                                                                                                                                                                                     |

The spec's own status line reads “implementation has not started; this written specification awaits
final owner review”, and its stated next action is owner review followed by a TDD implementation
plan. This suite was built on a direct instruction to implement, ahead of that sequence. Treat it as
a working proof of the Level C path, not as the approved vertical.

## What this eval does not prove

- **N is 8.** It is a floor to build on, not coverage.
- **It scores an agent–server pair.** A failure can be the agent's; read the recorded tool calls in
  `results/read-surface.json` before blaming the server.
- **Tool selection is not comprehension.** Reaching `opn_list` for the right question does not mean
  the agent understood the resource.
- **`firewall.alias` is out of scope.** The credential-free bootstrap's least-privilege account gets
  HTTP 403 on the alias endpoint. That is the intended privilege boundary, so scoring it would
  measure the lab account rather than the server.
- **The agent is not pinned to a model.** Whatever `claude` resolves is what answers; the run report
  records it, so compare reports rather than assuming two runs are comparable.
- **It needs a live model.** Unlike the rest of the repository's gates, this one cannot be run
  offline or in CI as it stands.
