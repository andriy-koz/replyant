---
title: "Programmatic Tool Calling: Code Mode for Faster, Cheaper Agents"
date: 2026-06-19
tags: ["AI Agents", "Tool Calling", "Architecture", "Developer Tools"]
description: "Code mode lets an agent orchestrate many tools in a sandbox and return only results to the model. ~80% lower inference cost and how it works in production."
author: "Replyant"
---

<aside class="quick-answer">
  <p>Programmatic tool calling — "code mode" — replaces the one-LLM-round-trip-per-tool-call loop with a single round trip: the model writes code that orchestrates many tool calls in a sandbox, and only the final result returns to context. Generating code to orchestrate tools instead of issuing N separate round-trips <a href="https://www.ikangai.com/code-as-action-the-pattern-behind-programmatic-tool-calling/">cut LLM inference cost roughly 80% and outperformed standard tool calling by up to 20%</a>. It wins on chained calls, large intermediate data, and bloated MCP schemas.</p>
</aside>

Programmatic tool calling is a tool-use pattern where the model writes a short program — usually Python or TypeScript — that calls your tools as ordinary functions inside a managed sandbox, instead of emitting one `tool_use` block, waiting for a result, and reasoning again. The program loops, filters, branches, and aggregates locally; only its final output is injected back into the model's context. The result is one model turn where the classic loop needs N, and a context window that never sees the intermediate noise. For agents that chain many calls or shuttle large payloads, this is the single highest-leverage change to the execution model — it is the difference between paying for every byte a tool returns and paying only for the answer.

## Why round-trip tool calling gets expensive

Standard [tool calling](/lab/anatomy-of-ai-agent-tool-calling/) is a serial conversation. The model emits a `tool_use` block, your harness executes it, you append the `tool_result` to the message history, and you call the model again. Every step pays two taxes:

- **A latency tax.** Each round trip is a full inference call plus network plus tool execution. Three sequential actions — read a customer profile, look up their orders, check inventory — is three model invocations stacked end to end, even though the second and third were predictable the moment the first returned.
- **A token tax.** Every intermediate `tool_result` is appended to the context and re-sent on the next turn. A tool that returns a 40 KB JSON blob costs you those tokens once to read it, then again on every subsequent turn for the rest of the conversation. Most of that data — pagination metadata, fields you never reference — is dead weight the model re-ingests at full input price.

Do the token accounting on a 6-call research trajectory where each tool returns ~8 KB (~2,000 tokens). Round-trip mode accumulates those results in the transcript: by the sixth call the model is re-reading ~10,000 tokens of prior results it has already reasoned over. Code mode runs all six calls in the sandbox, filters to the 200 tokens that matter, and returns that. The model sees the question, the code, and the answer — nothing else.

## How code mode actually works

The mechanics are a three-stage handoff:

1. **The model writes code.** Instead of a `tool_use` block, the model emits a program. Your tools are exposed to that program as callable APIs — `get_orders(customer_id)`, not a 600-token JSON schema dumped into the prompt.
2. **The sandbox executes it.** A managed container runs the code. When the code calls a tool, the runtime dispatches that call (to your handler or a server-side tool), returns the value into the running program, and lets control flow continue. Loops and conditionals run at sandbox speed, not at inference speed.
3. **Only results return to context.** When the program finishes, its stdout or return value is injected back as the tool result. The model never sees the 40 KB blob — it sees `{"in_stock": 3, "eta": "2026-06-24"}`.

Anthropic ships this as a first-class API feature. With [programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling), the model writes Python that runs in a managed container and only the results return to the model's context. Activating it is a two-line change to your request: add the code-execution tool and flag your custom tools as callable from it.

```python
# Illustrative — Anthropic programmatic tool calling (no beta header required)
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    tools=[
        {"type": "code_execution_20260120", "name": "code_execution"},
        {
            "name": "get_orders",
            "description": "Fetch all orders for a customer.",
            "input_schema": {
                "type": "object",
                "properties": {"customer_id": {"type": "string"}},
                "required": ["customer_id"],
            },
            # This is what makes the tool callable from inside the sandbox:
            "allowed_callers": ["code_execution_20260120"],
        },
    ],
    messages=[{"role": "user",
               "content": "Which of customer C-91's open orders ship this week?"}],
)
```

The contrast with the classic loop is the whole point:

```python
# Classic round-trip loop — one inference call per tool, results pile up in context
messages = [{"role": "user", "content": "..."}]
while True:
    resp = client.messages.create(model="claude-opus-4-8", max_tokens=4096,
                                  tools=tools, messages=messages)
    if resp.stop_reason != "tool_use":
        break
    messages.append({"role": "assistant", "content": resp.content})
    results = [run_tool(b) for b in resp.content if b.type == "tool_use"]
    # Every result — including the parts you never need — is appended and re-sent.
    messages.append({"role": "user", "content": results})
```

```python
# Code mode — the model writes this once; it runs in the sandbox; only the
# final line's value returns to the model's context.
orders = get_orders("C-91")
this_week = [o for o in orders
             if o["status"] == "open" and o["ship_date"] <= "2026-06-26"]
print([{"id": o["id"], "ship_date": o["ship_date"]} for o in this_week])
```

The filtering happens in the sandbox. The model never ingests the full order list.

## The numbers

The efficiency case is not theoretical. Generating code to orchestrate tools rather than issuing N separate round-trips [cut LLM inference cost by roughly 80% and outperformed standard tool calling by up to 20%](https://www.ikangai.com/code-as-action-the-pattern-behind-programmatic-tool-calling/) on agentic benchmarks. The cost reduction compounds with adjacent techniques: one support-agent deployment that stacked code mode with semantic caching and model routing reported a [roughly 72% total token-spend reduction with no quality loss](https://agentmarketcap.ai/blog/2026/04/11/prompt-cache-hit-rate-engineering-2026). The pattern is portable beyond any single vendor — an open-source TypeScript port, [`codecall`](https://github.com/zeke-john/codecall), appeared in early 2026, applying the same code-as-action model to JS-native agent stacks.

## Code mode and the MCP context-bloat problem

Code mode quietly fixes a problem that has nothing to do with execution and everything to do with context. As you connect [MCP](/lab/anatomy-of-ai-agent-mcp/) servers, every tool's full JSON schema gets loaded into the model's context window up front — and those schemas are verbose. In one production coding agent, [MCP tool definitions alone consumed 72% of a 200K context window](https://www.morphllm.com/context-rot) before a single user message arrived. That is context the model pays for on every turn and that crowds out the actual task.

Code mode changes how tools are surfaced. Instead of dumping every schema into the prompt as a wall of JSON, tools are exposed as a code API — typed functions the model can call and, critically, discover on demand. The model imports what it needs. The fixed cost of "having 80 tools available" drops from tens of thousands of always-resident tokens to a thin namespace the sandbox resolves at runtime. This is the same instinct behind [context engineering](/lab/context-engineering/) and [context folding](/lab/context-folding/): the scarcest resource in an agent is attention over a finite window, and the win comes from keeping irrelevant tokens out of it.

## When to use it — and when not to

Code mode is not a universal replacement for tool calling. Reach for it when the structure of the work rewards it:

| Situation | Classic round-trip | Code mode |
|---|---|---|
| Single tool call, answer needed verbatim | Best fit | Overkill |
| 3+ chained/sequential calls | One inference call each | One inference call total |
| Large intermediate payloads | Re-sent every turn | Filtered in sandbox |
| Many MCP tools loaded | Schemas bloat context | Tools as on-demand API |
| Loops / fan-out over a list | Painful, N×N round trips | Native `for` loop |
| Per-call human approval gate | Natural fit | Harder — calls are batched |

The classic loop still wins when you need a human-in-the-loop checkpoint on each individual action, or when the task is genuinely a single call whose raw result the model must see. Code mode shines on read-heavy, multi-step, aggregation-shaped work. It composes naturally with [orchestration patterns](/lab/multi-agent-systems/) — a coordinator can hand a sub-task to a code-mode turn and get back a compact result rather than a transcript. It is also a sibling, not a rival, to [speculative tool execution](/lab/speculative-tool-execution/): speculation cuts latency by guessing the next call early, while code mode cuts both latency and tokens by collapsing the calls into one program. Use both.

## Idempotency, safety, and the sandbox

Handing the model a programming language is more power than handing it one tool call at a time, and the safety model has to account for that. Three concerns dominate:

**Idempotency.** A program can call a tool inside a loop. If the sandbox crashes mid-execution and your harness retries the whole program, every non-idempotent call runs twice. Design mutating tools to be idempotent — accept a client-supplied idempotency key, make `create` calls upsert-by-key, and treat the program as potentially-replayed. Read-only tools are safe to compose freely; write tools need this discipline before you let generated code call them in a loop.

**Sandboxing.** The code runs somewhere. A managed container — Anthropic runs the code in its own — gives you isolation, resource limits, and no ambient access to your network or filesystem by default. If you self-host the runtime, the container is your security boundary: no host network, dropped capabilities, a CPU/memory/wall-clock budget, and an egress allowlist so generated code cannot exfiltrate data or call arbitrary endpoints. Never run model-authored code in your application process.

**Tool exposure is a privilege grant.** Marking a tool callable from the sandbox (`allowed_callers`) means generated code can invoke it without a per-call model round trip — and therefore without a per-call approval surface. Only expose tools whose entire input space is safe to call programmatically. Keep destructive or expensive operations off the code-callable list and behind an explicit, gated path. The blast radius of a bad program is exactly the set of tools you made callable from it.

## The takeaway

Programmatic tool calling reframes tool use from a conversation into a computation. The model stops being a slow dispatcher that pays inference latency and context tokens for every intermediate step, and becomes a one-shot program author whose sandbox does the chaining, filtering, and looping at machine speed. The payoff is concrete: roughly 80% lower inference cost on tool-heavy trajectories, latency that scales with the number of inference calls rather than the number of tool calls, and a context window that holds the task instead of a wall of MCP schemas. The cost of admission is real engineering discipline — idempotent write tools, a hardened sandbox, and a deliberate decision about which tools generated code is allowed to touch. For any agent doing read-heavy, multi-step work, that trade is overwhelmingly worth making.
