---
title: "Claude Fable 5 Agent Loops: effort and task-budgets"
date: 2026-06-11
tags: ["AI Agents", "Architecture", "LLMs", "Developer Tools"]
description: "Claude Fable 5 ships effort and task_budget — two API primitives that govern cost, latency, and reliability in agent loops. A production wiring guide."
author: "Replyant"
---

<aside class="quick-answer">
  <p>Claude Fable 5 (GA June 9, 2026) ships two production primitives that reshape agent-loop engineering: <code>output_config.effort</code> (low→max, controls reasoning depth and total token spend per response) and <code>output_config.task_budget</code> (beta, an advisory token countdown across a full multi-turn loop). Run cheap sub-agents at <code>low</code>, the orchestrator at <code>xhigh</code>, cap the loop with <code>task_budget</code>, and keep <code>max_tokens</code> as the hard ceiling. Refusals return HTTP 200 — handle them or the loop breaks silently.</p>
</aside>

Claude Fable 5 (`claude-fable-5`) is Anthropic's most capable widely released model, generally available since June 9, 2026 on the Claude API, Claude Platform on AWS, Amazon Bedrock, Google Vertex AI, and Microsoft Foundry. It carries a 1M-token context window by default and up to 128K output tokens per request, at $10/$50 per million input/output tokens (Anthropic). The headline for agent engineers is not the raw capability — it is that two API primitives now let you steer the cost/latency/reliability triangle of an agent loop directly from the request body, with a single model: the **`effort`** parameter and **`task_budget`** (beta).

This is a production wiring guide. The model is the easy part; the loop around it is where cost overruns, latency cliffs, and silent failures live. Below: an effort-level selection matrix with worked cost math, a streaming multi-turn loop driven by `task_budget` including the `remaining` carry-forward after compaction, an orchestrator-and-sub-agents architecture, defensive refusal handling with server-side `fallbacks`, and an interaction matrix of the edge cases that bite. All code is grounded in the documented parameter shapes.

This is the within-request and across-request cost lever; for the context-window lever see [context folding for long-horizon agents](/lab/context-folding/), and for the latency lever see [speculative tool execution for cutting agent latency](/lab/speculative-tool-execution/). The business framing — why any of this matters to a budget line — is in [the business case for token-cost governance](/blog/agentic-ai-token-costs/).

---

## The two primitives, precisely

Both live inside `output_config` on the Messages API. They control different axes and compose.

| Primitive | Scope | Mechanism | Enforced? | Beta header |
|---|---|---|---|---|
| `effort` | One response (all tokens: thinking + tool calls + text) | Behavioral signal — `low`/`medium`/`high`/`xhigh`/`max` | No (signal, not a cap) | None (GA) |
| `task_budget` | A full agentic loop (potentially many requests) | Server-injected token countdown the model self-paces against | No (advisory soft hint) | `task-budgets-2026-03-13` |
| `max_tokens` | One request | Hard per-request output ceiling | **Yes** (truncates with `stop_reason: "max_tokens"`) | None |

The mental model: **`effort` tunes depth, `task_budget` tunes breadth, `max_tokens` is the wall.** `effort` decides how hard Claude thinks and how many tool calls it makes on a single turn. `task_budget` gives Claude a running countdown so it paces itself and wraps up gracefully across the whole loop. `max_tokens` is the only one of the three that actually stops generation — the other two are advisory. Forget that distinction and you will ship a loop that either burns money (no `max_tokens` floor) or truncates mid-action (no `task_budget` to make it wind down first).

One Fable-5-specific fact that shapes everything below: **adaptive thinking is always on.** You do not pass a `thinking` block to enable it — it applies whenever `thinking` is unset. `thinking: {type: "disabled"}` returns a 400. So `effort` is the *only* lever for reasoning depth on this model; there is no `budget_tokens` to fall back to (it is fully removed). The raw chain of thought is never returned — `thinking.display` is `"summarized"` (readable summary) or `"omitted"` (empty `thinking` field, the default).

---

## The effort selection matrix

`effort` defaults to `high` (omitting it is identical to `"high"`). The five levels, per Anthropic's documentation:

| Level | What it does | Use it for |
|---|---|---|
| `low` | Fewest tokens, skips preamble, consolidates tool calls, terse confirmations | Sub-agents, classification, lookups, latency-sensitive paths |
| `medium` | Balanced; moderate token savings | Cost-sensitive agentic work |
| `high` | Default; thinks deeply on hard problems | General complex reasoning |
| `xhigh` | Extended exploration; meaningfully more tokens than `high` | Long-horizon coding/agentic work — the recommended starting point |
| `max` | Maximum capability, no token constraints | Frontier problems where correctness dominates cost |

The non-obvious property: **`effort` affects all token spend, including tool calls.** Lower effort does not just shorten the prose — it makes Claude issue *fewer tool calls* and combine operations. That is what makes it the right knob for sub-agents. A sub-agent at `low` will read three files in one consolidated pass and return a terse answer; the same sub-agent at `xhigh` will explore, re-read, and write you an essay. For a fan-out worker you are calling fifty times, that difference is the whole cost structure.

### The orchestrator/sub-agent split

The canonical pattern: a single orchestrator at `xhigh` that delegates well-scoped sub-tasks to cheap workers at `low`. The orchestrator does the hard reasoning — planning, synthesis, deciding what to delegate. The workers do bounded, mechanical work where extra deliberation is wasted spend.

```python
# agent_effort/levels.py
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Effort(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


@dataclass(frozen=True)
class Role:
    """Maps an agent role to the effort level it should run at."""
    name: str
    effort: Effort
    # max_tokens must scale with effort: xhigh/max need room to think AND act.
    max_tokens: int


# The production policy: orchestrator deliberates, workers execute.
ORCHESTRATOR = Role("orchestrator", Effort.XHIGH, max_tokens=64_000)
RESEARCH_SUBAGENT = Role("research", Effort.LOW, max_tokens=8_000)
EXTRACT_SUBAGENT = Role("extract", Effort.LOW, max_tokens=4_000)
VERIFY_SUBAGENT = Role("verify", Effort.MEDIUM, max_tokens=8_000)
```

The `max_tokens` pairing matters and is easy to get wrong. Anthropic's guidance is explicit: at `xhigh` or `max`, set `max_tokens` to at least 64K so the model has room to think *and* act across tool calls. An orchestrator at `xhigh` with `max_tokens=4096` will truncate mid-plan and you will blame the model. The token ceiling has to scale with the effort level, not the other way around.

### Cost/quality tradeoff, worked

The economics are the point of the split. Fable 5 bills $50/MTok output. Suppose an orchestrator-led research task fans out to 20 sub-agent calls, each consuming roughly 6K output tokens of work.

```
                    ALL-XHIGH vs ORCHESTRATOR/LOW-WORKERS

  Naive (everything at xhigh):
    orchestrator:  1 call  × ~40K out  = 40K
    20 sub-agents: 20 calls × ~18K out  = 360K   ← xhigh explores, re-reads
    ─────────────────────────────────────────────
    total output ≈ 400K tok × $50/MTok  = $20.00 / task

  Split (orchestrator xhigh, workers low):
    orchestrator:  1 call  × ~40K out  = 40K
    20 sub-agents: 20 calls × ~6K  out  = 120K   ← low consolidates, terse
    ─────────────────────────────────────────────
    total output ≈ 160K tok × $50/MTok  =  $8.00 / task

  Savings: 60% of output spend, with quality held on the hard
  reasoning (orchestrator stays at xhigh) and surrendered only on
  the bounded worker tasks where it does not move the needle.
```

The numbers are illustrative — your fan-out ratio and per-task token shape are what you actually measure — but the *shape* is robust. The expensive part of an agent loop is rarely the planning; it is the volume of worker calls, each of which inherits whatever effort you set globally. Pushing workers to `low` is the single highest-leverage cost change available, and it costs you nothing on the reasoning that matters because that reasoning lives in the orchestrator.

### Dynamic effort: route by task class, not by hardcoded role

Static per-role effort is the floor. The next refinement is routing effort by the *shape* of the task at dispatch time — a cheap classification before the expensive call. A research worker fetching a single known URL is a `low` job; the same worker asked to reconcile conflicting sources is a `medium` job. Encode that as a policy and the orchestrator picks the level when it delegates.

```python
# agent_effort/router.py
from __future__ import annotations

from dataclasses import dataclass

from agent_effort.levels import Effort


@dataclass(frozen=True)
class Dispatch:
    """An effort + token-ceiling decision for a single delegated subtask."""
    effort: Effort
    max_tokens: int


def route_effort(task_class: str, *, tool_dependent: bool = False) -> Dispatch:
    """
    Map a subtask class to an effort level and matching token ceiling.

    The two rules that keep this honest:
      1. Token ceiling scales WITH effort — xhigh/max need >=64K to act.
      2. Tool-dependent subtasks never drop below `medium`: `low` biases
         toward fewer tool calls and can starve a worker that must search.
    """
    base = {
        "lookup":        Dispatch(Effort.LOW, 4_000),     # single fact, no exploration
        "extract":       Dispatch(Effort.LOW, 4_000),     # pull fields from given text
        "summarize":     Dispatch(Effort.LOW, 8_000),     # condense one source
        "research":      Dispatch(Effort.MEDIUM, 8_000),  # gather + weigh sources
        "reconcile":     Dispatch(Effort.MEDIUM, 12_000), # resolve conflicts
        "plan":          Dispatch(Effort.XHIGH, 64_000),  # orchestrator-grade reasoning
        "implement":     Dispatch(Effort.XHIGH, 64_000),  # multi-step coding
    }.get(task_class, Dispatch(Effort.HIGH, 16_000))      # safe default

    # Tool-dependent low-effort work under-calls tools; floor it at medium.
    if tool_dependent and base.effort == Effort.LOW:
        return Dispatch(Effort.MEDIUM, max(base.max_tokens, 8_000))
    return base
```

This is the dial you tune from production data. Start with the table above, watch where workers under- or over-perform, and move individual task classes up or down a level. The cost of a wrong setting is asymmetric: a task class set one level too *low* shows up as quality regressions and retries; one level too *high* shows up only as a slightly larger invoice. Bias toward the cheaper setting and let your [agent eval CI](/lab/agent-evals-cicd/) catch the cases where it actually hurts quality — tool-selection accuracy below 85% on a task class is the signal to raise its effort.

Two cautions before you set every worker to `low`:

1. **`low` still thinks on genuinely hard problems** — `effort` is a behavioral signal, not a hard gate. A `low` worker handed a task that actually requires multi-step reasoning will still reason, just less than it would at `high`. If a worker's task is hard, give it `medium`, not `low`.
2. **Tool-dependent workers may under-call at `low`.** If a worker *must* search or fetch to do its job, `low`'s bias toward fewer tool calls can starve it. Either raise it to `medium` or make the tool's necessity explicit in its description.

---

## A task-budgeted, streaming agent loop

`effort` governs one turn. The harder problem is the *cumulative* cost of a loop that may span dozens of turns. That is what `task_budget` is for: you tell Claude how many tokens it has for the entire loop, and it sees a server-injected countdown it paces against, finishing gracefully — summarizing findings, reporting progress — as the budget depletes, rather than cutting off mid-action.

The shape (verified against the docs):

```python
output_config = {
    "effort": "high",
    "task_budget": {
        "type": "tokens",   # always "tokens"
        "total": 128_000,   # tokens for the whole loop: thinking + tool calls + results + output
        # "remaining": M,   # optional — carry-forward after compaction; defaults to total
    },
}
```

Three hard rules from the documentation:

- **Minimum `total` is 20,000 tokens.** Below that, 400.
- **It is advisory, not enforced.** Claude may exceed it slightly if interrupting an in-flight action would be more disruptive than finishing. `max_tokens` remains the only hard cap.
- **The countdown is visible only to the model.** There is no `task_budget` field in the response `usage` object and no SDK accessor for it. If you want to track spend client-side, you sum token usage across your loop yourself.

Here is a complete loop. It streams (mandatory for the 128K `max_tokens` we want), checks `stop_reason` correctly, executes tools, and tracks client-side spend so you have observability the API does not give you.

```python
# agent_loop/budgeted_loop.py
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable

import anthropic

client = anthropic.Anthropic()

TASK_BUDGET_BETA = "task-budgets-2026-03-13"
MODEL = "claude-fable-5"

ToolFn = Callable[[dict[str, Any]], str]


@dataclass
class LoopResult:
    final_text: str
    turns: int
    output_tokens_spent: int  # client-side tally; the API does not expose remaining budget
    stop_reason: str
    refused: bool = False


@dataclass
class AgentLoop:
    tools: list[dict[str, Any]]
    tool_impls: dict[str, ToolFn]
    effort: str = "high"
    task_budget_total: int = 128_000
    max_tokens: int = 128_000          # hard ceiling — independent of task_budget
    max_turns: int = 40
    messages: list[dict[str, Any]] = field(default_factory=list)

    def run(self, user_message: str) -> LoopResult:
        self.messages.append({"role": "user", "content": user_message})
        output_tokens_spent = 0

        for turn in range(self.max_turns):
            # Stream is required at 128K max_tokens to avoid SDK HTTP timeouts.
            with client.beta.messages.stream(
                model=MODEL,
                max_tokens=self.max_tokens,
                messages=self.messages,
                tools=self.tools,
                output_config={
                    "effort": self.effort,
                    "task_budget": {"type": "tokens", "total": self.task_budget_total},
                },
                betas=[TASK_BUDGET_BETA],
            ) as stream:
                response = stream.get_final_message()

            # Tally output tokens ourselves — the budget countdown is model-only.
            output_tokens_spent += response.usage.output_tokens

            # CRITICAL: branch on stop_reason BEFORE reading content.
            # A Fable 5 refusal returns HTTP 200 with stop_reason == "refusal".
            if response.stop_reason == "refusal":
                return LoopResult(
                    final_text="",
                    turns=turn + 1,
                    output_tokens_spent=output_tokens_spent,
                    stop_reason="refusal",
                    refused=True,
                )

            # Append the assistant turn verbatim — thinking blocks must round-trip
            # unchanged on the same model. Never strip or reconstruct them.
            self.messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "end_turn":
                final_text = next(
                    (b.text for b in response.content if b.type == "text"), ""
                )
                return LoopResult(
                    final_text=final_text,
                    turns=turn + 1,
                    output_tokens_spent=output_tokens_spent,
                    stop_reason="end_turn",
                )

            # stop_reason == "tool_use": execute every requested tool, return results.
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    impl = self.tool_impls.get(block.name)
                    if impl is None:
                        result, is_error = f"Unknown tool: {block.name}", True
                    else:
                        try:
                            result, is_error = impl(block.input), False
                        except Exception as exc:  # noqa: BLE001
                            result, is_error = f"Tool error: {exc!r}", True
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                        "is_error": is_error,
                    })
            self.messages.append({"role": "user", "content": tool_results})

        return LoopResult(
            final_text="",
            turns=self.max_turns,
            output_tokens_spent=output_tokens_spent,
            stop_reason="max_turns_exceeded",
        )
```

Three things this loop gets right that most hand-rolled loops get wrong:

1. **`stop_reason` is checked before `content` is read.** On Fable 5 this is not optional — a refused request is a successful HTTP 200, and `response.content[0]` may be empty. Reading content first throws an `IndexError` on exactly the requests you most need to handle. (More on refusals below.)
2. **The assistant turn is appended verbatim** — full `response.content`, not just the extracted text. Thinking blocks must round-trip unchanged when you continue on the same model; reconstructing or stripping them breaks the turn.
3. **Token spend is tallied client-side.** The budget countdown is invisible to you by design, so if you want a dashboard number, you build it from `usage.output_tokens` per turn. This is your only client-side window into how the budget is being consumed.

The same loop in TypeScript, for teams on the Node SDK — the wire shape is identical, only the bindings differ:

```typescript
// agentLoop/budgetedLoop.ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const TASK_BUDGET_BETA = "task-budgets-2026-03-13";
const MODEL = "claude-fable-5";

type ToolFn = (input: unknown) => Promise<string>;

interface LoopResult {
  finalText: string;
  turns: number;
  outputTokensSpent: number;
  stopReason: string;
  refused: boolean;
}

export async function runBudgetedLoop(
  userMessage: string,
  tools: Anthropic.Tool[],
  toolImpls: Record<string, ToolFn>,
  opts: { effort?: string; taskBudgetTotal?: number; maxTokens?: number; maxTurns?: number } = {},
): Promise<LoopResult> {
  const effort = opts.effort ?? "high";
  const taskBudgetTotal = opts.taskBudgetTotal ?? 128_000;
  const maxTokens = opts.maxTokens ?? 128_000;
  const maxTurns = opts.maxTurns ?? 40;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: userMessage },
  ];
  let outputTokensSpent = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    // Stream is required at 128K max_tokens; finalMessage() collects the result.
    const response = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: maxTokens,
        messages,
        tools: tools as Anthropic.Beta.BetaTool[],
        output_config: {
          effort,
          task_budget: { type: "tokens", total: taskBudgetTotal },
        },
        betas: [TASK_BUDGET_BETA],
      })
      .finalMessage();

    outputTokensSpent += response.usage.output_tokens;

    // Branch on stop_reason BEFORE touching content — refusals are HTTP 200.
    if (response.stop_reason === "refusal") {
      return { finalText: "", turns: turn + 1, outputTokensSpent, stopReason: "refusal", refused: true };
    }

    // Append the assistant turn verbatim — thinking blocks must round-trip unchanged.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find(
        (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text",
      );
      return {
        finalText: textBlock?.text ?? "",
        turns: turn + 1,
        outputTokensSpent,
        stopReason: "end_turn",
        refused: false,
      };
    }

    // stop_reason === "tool_use": run every tool, return all results in one user turn.
    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const impl = toolImpls[block.name];
        let content: string;
        let isError = false;
        if (!impl) {
          content = `Unknown tool: ${block.name}`;
          isError = true;
        } else {
          try {
            content = await impl(block.input);
          } catch (err) {
            content = `Tool error: ${String(err)}`;
            isError = true;
          }
        }
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content, is_error: isError });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { finalText: "", turns: maxTurns, outputTokensSpent, stopReason: "max_turns_exceeded", refused: false };
}
```

The structure is the same in both languages because the loop logic *is* the same: stream, check `stop_reason`, append the assistant turn verbatim, execute tools, repeat. The `output_config` shape — `effort` and `task_budget` side by side — is identical on the wire regardless of SDK.

### The countdown counts what Claude *sees*, not what you *send*

The single most counterintuitive property of `task_budget`: it decrements by the tokens Claude processes *this turn* (thinking + tool calls + tool results + text), not by the size of your request payload. In an agent loop your client resends the full conversation history every turn, so the payload grows turn over turn — but the budget only counts the *new* content Claude sees, plus what it generates. The turn-1 user message you resend on turn 5 is not re-counted.

This has a sharp corollary, straight from the docs: **do not try to mirror the countdown client-side by decrementing `remaining` while resending full history.** If you decrement `remaining` *and* resend the uncompacted history, the model sees an under-reported budget, the countdown drops faster than it should, and Claude wraps up earlier than the budget actually allows. The guidance is to set a generous budget once and let the model self-regulate. The one legitimate use of `remaining` is carry-forward across compaction.

### The `remaining` carry-forward after compaction

If your loop compacts or rewrites context between requests — summarizing earlier turns to stay under the context window, the discipline covered in [context folding for long-horizon agents](/lab/context-folding/) — the server loses its memory of how much budget was already spent. A fresh request would reset the countdown to `total`. You bridge the gap by passing `remaining`: the budget remainder you tracked client-side, so the countdown continues from where you left off.

```python
# agent_loop/compaction_carry.py
from __future__ import annotations

import anthropic

client = anthropic.Anthropic()
TASK_BUDGET_BETA = "task-budgets-2026-03-13"


def run_segment_after_compaction(
    messages: list[dict],
    tools: list[dict],
    budget_total: int,
    tokens_spent_so_far: int,
) -> anthropic.types.Message:
    """
    Continue a budgeted loop after the conversation was compacted.

    Because compaction rewrites history, the server can no longer derive how
    much budget was consumed. We pass `remaining` so Claude's countdown picks
    up where the pre-compaction segment left off instead of resetting to total.
    """
    remaining = max(20_000, budget_total - tokens_spent_so_far)  # never below the 20K floor

    with client.beta.messages.stream(
        model="claude-fable-5",
        max_tokens=128_000,
        messages=messages,  # the compacted/summarized history
        tools=tools,
        output_config={
            "effort": "high",
            "task_budget": {
                "type": "tokens",
                "total": budget_total,
                "remaining": remaining,
            },
        },
        betas=[TASK_BUDGET_BETA],
    ) as stream:
        return stream.get_final_message()
```

Note the floor clamp. `remaining` is still a budget value, and a budget Claude reads as clearly insufficient for the task can trigger refusal-like behavior — declining, aggressively scoping down, or stopping early with a partial result. If your tally says you have 8K left but the task is not done, you are better off raising the budget (or accepting that the loop is over) than feeding the model a number that makes it give up. The 20K floor here is a guardrail against accidentally starving a live loop.

One caching caveat that follows from this: if you decrement `remaining` on each follow-up request, the changed value invalidates any prompt-cache prefix that contains it. For loops that resend full uncompacted history, omit `remaining` entirely and let the server track the countdown — that keeps the cache intact. Only reach for `remaining` at the compaction boundary, where the cache is being rebuilt anyway.

---

## The architecture, end to end

Putting the effort split and the budget together, here is the full topology of a production research agent built on Fable 5:

```
                         CLAUDE FABLE 5 AGENT TOPOLOGY

  ┌──────────────────────────────────────────────────────────────┐
  │  ORCHESTRATOR                                                  │
  │  model=claude-fable-5  effort=xhigh  max_tokens=64000          │
  │  task_budget={total: 250000}   ← countdown spans the WHOLE run │
  │                                                                │
  │  • plans the task, decides what to delegate                    │
  │  • synthesizes worker outputs into the final answer            │
  │  • paces against the server-injected budget countdown          │
  └───────────────┬───────────────────────────┬──────────────────┘
                  │ delegate (bounded subtask)  │
                  ▼                             ▼
  ┌────────────────────────────┐   ┌────────────────────────────┐
  │  RESEARCH WORKER (×N)       │   │  EXTRACT WORKER (×N)        │
  │  effort=low  max_tokens=8K  │   │  effort=low  max_tokens=4K  │
  │  • one consolidated pass    │   │  • pull structured fields   │
  │  • terse factual return     │   │  • no exploration           │
  │  • own short task_budget    │   │  • own short task_budget    │
  └────────────────────────────┘   └────────────────────────────┘

  COST SHAPE (per the worked example above):
    orchestrator output  ~40K  @ $50/MTok = $2.00
    20 low workers       ~120K @ $50/MTok = $6.00
    ────────────────────────────────────────────
    ≈ $8.00 / task   (vs ≈ $20.00 all-xhigh)

  RELIABILITY: every leaf call checks stop_reason for "refusal"
  and falls back to claude-opus-4-8 (see next section). The loop
  cannot silently break on a classifier decline.
```

The orchestrator carries the long `task_budget` because the countdown is meant to span the whole run — the orchestrator is the only component that lives for the entire task. Each worker gets its own short budget scoped to its bounded job. This is the same delegation discipline that makes [multi-agent systems](/lab/multi-agent-systems/) tractable, now with two API knobs that let you price each tier independently instead of running the whole tree at one global setting.

The delegation itself is a single function: take a task class and a prompt, route to an effort/ceiling decision, run a short bounded loop, and return only the worker's text to the orchestrator. The worker's full trajectory — its thinking, its tool chatter — is discarded at the return boundary; the orchestrator sees a terse fact, not a transcript.

```python
# agent_loop/dispatch.py
from __future__ import annotations

from agent_effort.router import route_effort
from agent_loop.budgeted_loop import AgentLoop
from agent_loop.refusal_fallback import create_with_fallback  # for the leaf-level fallback


def run_subagent(
    task_class: str,
    prompt: str,
    tools: list[dict],
    tool_impls: dict,
    *,
    tool_dependent: bool = False,
    subtask_budget: int = 30_000,
) -> str:
    """
    Run one bounded sub-agent and return ONLY its final text to the caller.

    The worker's trajectory is not surfaced to the orchestrator — this is the
    cheap form of context folding: the sub-agent's reasoning never enters the
    orchestrator's window, only its conclusion does.
    """
    dispatch = route_effort(task_class, tool_dependent=tool_dependent)

    worker = AgentLoop(
        tools=tools,
        tool_impls=tool_impls,
        effort=dispatch.effort.value,
        max_tokens=dispatch.max_tokens,
        task_budget_total=max(20_000, subtask_budget),  # respect the 20K floor
        max_turns=12,                                    # workers are short-horizon
    )
    result = worker.run(prompt)

    if result.refused:
        # A worker hit a classifier decline — escalate, don't silently return "".
        # In production, retry this leaf via create_with_fallback onto claude-opus-4-8.
        return "[sub-agent refused; escalate to fallback model]"
    return result.final_text
```

The `subtask_budget` clamp to 20,000 is the floor again — a worker handed less than the minimum gets a 400, and a worker handed *barely* the minimum on a non-trivial task starts exhibiting the budget-starvation behavior described below. Keep worker budgets comfortably above the floor or skip `task_budget` on the worker entirely and rely on its short `max_turns` and `max_tokens` to bound it. Discarding the worker's trajectory at the return boundary is the extreme form of [context folding for long-horizon agents](/lab/context-folding/): the fold *is* the sub-agent return.

---

## Refusal handling: the loop killer nobody plans for

Here is the failure mode that will take down a Fable 5 agent in production and never show up in your tests: **Fable 5 ships safety classifiers that can decline a request, and a declined request returns a successful HTTP 200 with `stop_reason: "refusal"` — not an error.** (Claude Mythos 5 omits these classifiers; Fable 5 is the GA model, so this is the case you build for.)

Your `try/except` around the API call will not catch it. Your loop will sail past it, read an empty `content` array, and either crash on an index error or — worse — treat an empty response as a completed turn and return garbage. Benign adjacent work (security tooling, life-sciences tasks) can occasionally trip a false positive, so this is not a "we don't do bio/cyber, we're fine" situation.

The billing detail matters for your retry logic: a request refused **before any output** is not billed at all (no input or output tokens). A request refused **mid-stream** bills the already-streamed output — discard the partial, do not treat it as complete.

There are three ways to retry on another model. The cleanest for production is the server-side `fallbacks` parameter (beta, Claude API and Claude Platform on AWS): one round trip, the API retries onto a model you name (e.g. `claude-opus-4-8`) on the same request, and fallback credit refunds the prompt-cache cost of the switch.

```python
# agent_loop/refusal_fallback.py
from __future__ import annotations

import anthropic

client = anthropic.Anthropic()

# Server-side fallback retries the request on another model in one round trip
# when Fable 5's classifiers decline. Fallback credit refunds the cache-switch cost.
FALLBACK_BETA = "server-side-fallback-2026-06-01"


def create_with_fallback(messages: list[dict], tools: list[dict]) -> anthropic.types.Message:
    response = client.beta.messages.create(
        model="claude-fable-5",
        max_tokens=64_000,
        messages=messages,
        tools=tools,
        output_config={"effort": "xhigh"},
        fallbacks=[{"model": "claude-opus-4-8"}],
        betas=[FALLBACK_BETA],
    )

    # A `fallback` content block marks each switch point: Fable refused, Opus served it.
    for block in response.content:
        if block.type == "fallback":
            # Audit signal — log which model actually answered this turn.
            print(f"fallback: {block.from_.model} declined -> {block.to.model} continued")

    # If the WHOLE chain refused, the final response still carries stop_reason "refusal".
    if response.stop_reason == "refusal":
        # Every configured model declined. Surface to the user; do not retry blindly.
        category = response.stop_details.category if response.stop_details else None
        raise RefusalError(f"All fallback models refused (category={category})")

    return response


class RefusalError(Exception):
    """Raised when a request is refused and no fallback model could serve it."""
```

A few load-bearing details:

- **Branch on `stop_reason`, never on `stop_details`.** `stop_details` is informational and can be `null` even on a refusal; `stop_details.category` (e.g. `"cyber"`, `"bio"`, or `null`) tells you *which* class you hit, but `stop_reason == "refusal"` is the signal.
- **`fallbacks` triggers on policy declines only.** Rate limits, overloads, and 5xx on the requested model are returned as-is — they do *not* fall back. Those you handle with ordinary retry/backoff (the SDK does this automatically for 429/5xx).
- **For Bedrock/Vertex**, server-side `fallbacks` is not available — use the SDK's client-side `BetaRefusalFallbackMiddleware` instead, which splices the fallback model's output onto the stream in the same wire shape.

Wire `create_with_fallback` into every leaf call in the topology above and a classifier decline degrades to "answered by Opus 4.8" instead of "loop silently produced nothing." That is the difference between a defensive agent and one that fails an overnight run at 3 a.m. and tells no one. Treat refusal rate as a first-class metric in your [agent eval CI](/lab/agent-evals-cicd/) — it shifts as your prompt distribution shifts, exactly like tool-selection accuracy.

---

## Gotchas and the interaction matrix

The primitives compose, but the composition has edges. The ones that have actually bitten:

### effort × adaptive thinking

Adaptive thinking is **always on** and cannot be disabled — `thinking: {type: "disabled"}` is a 400 on Fable 5. So `effort` is the *sole* control for reasoning depth; there is no `budget_tokens` escape hatch (it is removed, along with `temperature`, `top_p`, and `top_k` — all 400). At `high`/`xhigh`/`max`, Claude almost always thinks deeply; at `low`/`medium`, it may skip thinking on simple problems. If you stream reasoning to a user, set `thinking: {type: "adaptive", display: "summarized"}` explicitly — the default `"omitted"` returns empty `thinking` blocks, which renders as a long silent pause before output.

### task_budget × max_tokens (orthogonal, both required)

These are independent and you want both. `task_budget` spans the whole loop (many requests); `max_tokens` caps a single request. Neither has to be ≤ the other. Use `task_budget` to give Claude a target to pace against, and `max_tokens` as the absolute ceiling that prevents runaway generation. At `xhigh`/`max`, keep `max_tokens` ≥ 64K so the model has room — a low `max_tokens` truncates with `stop_reason: "max_tokens"` regardless of how much budget remains.

### task_budget is advisory, not enforced

This is the one that surprises people who treat it like `max_tokens`. The budget is a soft hint. Claude can overshoot it slightly to finish an in-flight action. If you need a hard cost cap, `max_tokens` is the enforcement mechanism — `task_budget` only shapes pacing.

### task_budget minimum and refusal-like starvation

`total` below 20,000 is a 400. And a budget that is *technically* valid but clearly too small for the task (a 20K budget on a multi-hour coding task) can cause Claude to decline, scope down hard, or stop early — behavior that looks like a refusal but is budget starvation. If you see unexpected early stops after adding a budget, **raise the budget before debugging anything else.** Size budgets against your real per-task token distribution (start at the p99 of an unbudgeted sample), not a fixed default.

### task_budget × prompt caching

The countdown marker is injected server-side per turn, so it never matches across requests — that is fine and expected. The trap is mutating `task_budget.remaining` on each follow-up request: a changed `remaining` value invalidates the cache prefix that contains it, and you pay cold cache-writes every turn. For full-history loops, set the budget once and omit `remaining`. Only set `remaining` at a compaction boundary, where the prefix is being rebuilt anyway.

### Client can't read remaining budget

The countdown is model-only — there is no field in `usage` and no SDK accessor. If you need client-side observability (you do), tally `usage.output_tokens` across the loop yourself, as the loop above does. Do not architect anything around reading the remaining budget from the response, because you cannot.

### The new tokenizer shifts your baselines

Fable 5 uses the tokenizer introduced with Opus 4.7: the same text produces roughly 30% more tokens than pre-4.7 models. Any `max_tokens`, context budget, or cost estimate calibrated on an older model is now wrong. Re-baseline with `count_tokens` passing `model: "claude-fable-5"` before you trust a single number — and especially before you set `task_budget.total`, which is denominated in these new tokens.

### Refusals are HTTP 200

Restating it because it is the one that breaks loops: a refused request is a *success* at the HTTP layer. No exception is raised. Check `stop_reason == "refusal"` before reading `content`, on every leaf call, or your loop has a silent failure mode you will discover in production.

---

## Where to start

You do not need to adopt all of this at once. The sequence that delivers value fastest:

1. **Split effort by role today.** Set your orchestrator to `xhigh` and your sub-agents to `low`. This is a one-line change per call site and it is the highest-leverage cost reduction available — typically 50–60% of output spend on fan-out-heavy loops, with quality held on the reasoning that matters.
2. **Add refusal handling before you ship Fable 5 to production.** Wire `stop_reason == "refusal"` checks and `fallbacks` into every leaf call. This is not optional on a model with safety classifiers — it is the difference between graceful degradation and silent loop failure.
3. **Re-baseline your token budgets.** Run a representative sample through `count_tokens` with the Fable 5 tokenizer. Reset every `max_tokens` and cost estimate that was calibrated on an older model.
4. **Add `task_budget` once you have measured your loop's spend distribution.** Run unbudgeted first, record the p99 per-task token spend, then set `total` from that — generous, not tight. Let the model self-regulate against the countdown; do not try to mirror it client-side.
5. **Wire `remaining` carry-forward only if you compact.** If your loop summarizes context mid-run, pass `remaining` at the compaction boundary so the countdown survives. Otherwise omit it and protect your cache.

The model is the same for everyone. What separates an agent loop that costs $8 a task and finishes reliably from one that costs $20 and breaks on a classifier decline is the wiring around it — and on Fable 5, that wiring is now three parameters and a refusal branch.

---

*We design and operate production agent loops on Claude — effort policy, budget governance, refusal handling, and the eval infrastructure that proves they hold under real traffic. If you're moving an agent onto Fable 5 and want the cost and reliability dialed in before it ships, [let's talk](/#contact).*
