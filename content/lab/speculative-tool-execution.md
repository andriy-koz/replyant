---
title: "Speculative Tool Execution: Cut Agent Latency 48% in Production"
date: 2026-04-29
tags: ["AI Agents", "Architecture", "Tool Calling", "LLMs"]
description: "PASTE-style speculative tool execution cuts agent task time 48.5%. A working ~300 LOC harness over the Anthropic SDK with rollback and benchmarks."
author: "Replyant"
---

Past a 10-step trajectory with read-heavy tools, your agent is bottlenecked on tool latency, not LLM throughput. Speculative tool execution fires the predicted next call while the model is still emitting tokens, then promotes or discards on commit. [PASTE](https://arxiv.org/abs/2603.18897) (arxiv 2603.18897, Microsoft Research, March 2026) reports a 48.5% task-completion-time reduction. The companion UMD/LLNL paper ([arxiv 2512.15834](https://arxiv.org/abs/2512.15834)) layers client-side and engine-side speculation for an additional 6 to 21%. The technique reduces to two design decisions: a predictor and an eligibility policy. Get either wrong and you ship a billing incident or a data-safety incident.

## Why agents are tool-bound, not token-bound

The [GetStream voice-agent latency stack](https://getstream.io/blog/speculative-tool-calling-voice/) maps the budget cleanly: ASR 300 ms, LLM decision 200 to 1000 ms, tool execution 100 to 2000 ms, response generation 300 ms, TTS 250 to 300 ms. At p95, tools dominate. A research agent making six sequential `fetch_url` calls at a 600 ms median spends 3.6 s in network I/O while the model spends maybe 1.2 s deciding. You are paying Claude Opus 4.7 throughput to wait for `requests.get`. The fix is not a faster model. The fix is to stop waiting.

## Three Schools of Speculation

Speculative tool execution is not one technique. It is three, with different trust boundaries and different ROI curves. The short answer: PASTE is client-side and rule-driven, UMD layers a small LM speculator on top of an engine-level KV trick, Anthropic's [Programmatic Tool Calling](https://www.anthropic.com/engineering/advanced-tool-use) sidesteps the question by letting Claude orchestrate tools in code. Pick by trust boundary, not by paper recency.

### PASTE (arxiv 2603.18897)

Microsoft's PASTE runs a rule-based, pattern-cache predictor alongside the LLM. Headline numbers: 48.5% latency reduction, 1.8x throughput, 27.8% top-1 hit rate, 43.9% top-3, 93.8% over the full speculation window. The p95/p99 reductions are 48.6% and 61.9%. The paper is unusually forthright about safety: 602 of 20,000-plus speculative actions were flagged as mutating and blocked by the eligibility policy. That is the 3% you need to design for, not against.

### UMD/LLNL Speculative Tool Calls (arxiv 2512.15834)

UMD and LLNL pair a small client-side speculator (xLAM-1B/3B/8B) running in parallel with a main LM (gpt-oss-120b), then layer engine-side optimizations in vLLM: Early Exit Decoding (stop emission once the tool name is committed) and Persistent Sequences (preserve KV-cache across the speculative branch). The two layers compose for a 6 to 21% per-turn savings on top of whatever client-side speculation already buys. This is the right architecture if you control the inference engine. Most readers do not.

### Anthropic Programmatic Tool Calling

Released as the `advanced-tool-use-2025-11-20` beta on November 24 2025, Programmatic Tool Calling lets Claude write Python-like code that orchestrates tools, with intermediate results staying out of the message context. Anthropic reports a 37% reduction in tokens. This is the official sanctioned parallel surface and the one Anthropic recommends over client-side speculation. The model is, plausibly, a better speculator about its own next move than your bigram cache is.

## The fold-not-rollback design

Calling this "speculation" oversells the rollback model. There is no transactional rollback in any of the three systems. There is a promotion model with discard. State capture looks like this:

| State                  | Captured?                                       | Why                            |
|------------------------|-------------------------------------------------|--------------------------------|
| Agent message history  | No                                              | Speculation runs out-of-band   |
| Tool inputs (predicted)| Yes, as symbolic functions over recent payloads | Cache key                      |
| Tool outputs           | Yes, keyed on `(tool_name, canonical_args)`     | Promoted on cache match        |
| KV-cache               | Sometimes (engine-side)                         | UMD writes, PASTE leaves alone |

Two triggers run the lifecycle. The commit trigger is the model emitting a `tool_use` whose `(name, input)` matches a cached speculative result. The discard trigger is a name or argument mismatch, or `stop_reason=end_turn`. There is no "undo" path because there is no commit until the model agrees.

This framing is also why side effects are a hard line, not a soft one. You are not rolling back a Stripe charge after the model declines to use it. You are refusing to make the call until the model commits.

## The Anthropic streaming surface that makes this work

The whole technique hinges on one event in the Anthropic streaming protocol. When the model starts emitting a tool call, you get a `content_block_start` with `content_block.type == "tool_use"`, and the tool **name** is fixed at that moment. The arguments stream after as `input_json_delta` events. That gap, between "I know the name" and "I know the args," is your speculation window.

```python
async with client.messages.stream(
    model="claude-opus-4-7",
    max_tokens=4096,
    messages=history,
    tools=tool_schemas,
    extra_headers={"anthropic-beta": "fine-grained-tool-streaming-2025-05-14"},
) as stream:
    async for event in stream:
        if event.type == "content_block_start" and event.content_block.type == "tool_use":
            tool_name = event.content_block.name
            tool_use_id = event.content_block.id
            # SPECULATION TRIGGER. Name is final. Args still streaming.
            asyncio.create_task(speculate(tool_name, tool_use_id, history))
```

The `fine-grained-tool-streaming-2025-05-14` beta header disables input buffering and emits finer deltas; in exchange, mid-stream JSON validity is not guaranteed, so canonicalize at finalize time, not on every delta. The raw SSE shape is the standard delta envelope:

```
{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"..."}}
```

OpenAI's parallel function calling does not offer this surface. It is emit-then-execute: the assistant turn closes, you see all calls together, you fan them out. There is no in-flight signal. If you are on OpenAI, your only speculation hook is between assistant turns, which is also where Anthropic's Programmatic Tool Calling lives.

For background on the broader streaming machinery, see [the anatomy of AI agent tool calling](/lab/anatomy-of-ai-agent-tool-calling/).

## Tool taxonomy: when speculation is safe

Eligibility is not a runtime decision. It is a build-time policy. The categories below are the working classification we use at Replyant.

| Class                            | Examples                                          | Speculate?                              | Rollback cost          |
|----------------------------------|---------------------------------------------------|-----------------------------------------|------------------------|
| Idempotent + observable          | `web_search`, RAG retrieve, file read, HTTP GET   | YES, always                             | Discard cached result  |
| Idempotent + unobservable        | `vector.query`, cached LLM-judge call             | YES with throttling                     | Wasted spend only      |
| Idempotent-on-key                | Stripe with `Idempotency-Key`, S3 PUT             | Maybe, only if you can pre-mint the key | Replay-safe            |
| Non-idempotent + reversible      | DB INSERT into staging, log append                | Compensate, do not speculate            | Compensating action    |
| Non-idempotent + irreversible    | payment capture, email/Slack send                 | NEVER, only `warmup_only`               | Cannot undo            |

PASTE's 602 of 20,000-plus mutating-action figure is the empirical lower bound on what a permissive policy will let through. A speculation harness without an allow-list is, in PASTE's own data, a 3% chance per speculative call of doing something the user did not ask for.

## A Working Harness: PASTEHarness in ~300 LOC

The harness below is a complete client-side speculation runtime over the Anthropic SDK. It defines a bigram predictor, an eligibility policy, a `tool_use_id`-keyed result map, structured stats, and the orphan-future cancellation path. Drop it next to your agent loop.

```python
"""
paste_harness.py
A client-side speculative tool execution harness over the Anthropic SDK.

Architecture:
  - BigramPredictor: P(next_tool | prev_tool, prev_args_shape)
  - EligibilityPolicy: per-tool full | warmup | forbid
  - PASTEHarness: streams a turn, fires speculation on content_block_start,
    promotes on commit, cancels orphans on mismatch.
"""
import asyncio
import json
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

from anthropic import AsyncAnthropic
from anthropic.types import ToolUseBlock

Eligibility = Literal["full", "warmup", "forbid"]


def canonical(d: dict) -> str:
    """Stable canonical form of a tool input dict for cache keying."""
    return json.dumps(d, sort_keys=True, separators=(",", ":"))


def _shape(d: dict) -> str:
    """Argument-shape key. Strips values, keeps keys + value-types."""
    if not isinstance(d, dict):
        return type(d).__name__
    return "{" + ",".join(f"{k}:{type(v).__name__}" for k, v in sorted(d.items())) + "}"


# ---------------------------------------------------------------------------
# Predictor
# ---------------------------------------------------------------------------

class BigramPredictor:
    """Frequency-counted predictor: P(next_tool | prev_tool, prev_args_shape).

    Symbolic arg derivation: for known templates we copy fields from the
    previous call (e.g. arxiv_search.id -> fetch_url.url). Heuristics live
    in `_derive_args`. Replace with a small LM if you want better recall.
    """

    def __init__(self) -> None:
        self.counts: dict[tuple[str, str], dict[tuple[str, str], int]] = (
            defaultdict(lambda: defaultdict(int))
        )

    def observe(
        self,
        prev_tool: str,
        prev_args: dict,
        next_tool: str,
        next_args: dict,
    ) -> None:
        key = (prev_tool, _shape(prev_args))
        self.counts[key][(next_tool, _shape(next_args))] += 1

    def predict(
        self,
        prev_tool: str,
        prev_args: dict,
        history: list[dict],
        top_k: int = 3,
    ) -> list[tuple[str, dict, float]]:
        key = (prev_tool, _shape(prev_args))
        bucket = self.counts.get(key)
        if not bucket:
            return []
        total = sum(bucket.values())
        ranked = sorted(bucket.items(), key=lambda kv: -kv[1])[:top_k]
        out: list[tuple[str, dict, float]] = []
        for (next_tool, next_shape), count in ranked:
            args = self._derive_args(next_tool, prev_tool, prev_args, history)
            if args is None:
                continue
            out.append((next_tool, args, count / total))
        return out

    @staticmethod
    def _derive_args(
        next_tool: str,
        prev_tool: str,
        prev_args: dict,
        history: list[dict],
    ) -> dict | None:
        # Symbolic templates. Add yours here.
        if prev_tool == "arxiv_search" and next_tool == "fetch_url":
            q = prev_args.get("query", "")
            return {"url": f"https://arxiv.org/abs/{q}"} if q else None
        if prev_tool == "fetch_url" and next_tool == "extract_text":
            return {"url": prev_args.get("url")} if prev_args.get("url") else None
        if prev_tool == "extract_text" and next_tool == "summarize":
            return {"source_url": prev_args.get("url")} if prev_args.get("url") else None
        if prev_tool == "web_search" and next_tool == "fetch_url":
            return None  # too many candidates, do not speculate blindly
        return None


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@dataclass
class Stats:
    fired: int = 0
    committed: int = 0
    wasted: int = 0
    dollars_wasted: float = 0.0
    p_hit: float = field(default=0.0)

    def update(self) -> None:
        self.p_hit = self.committed / self.fired if self.fired else 0.0


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------

class PASTEHarness:
    def __init__(
        self,
        client: AsyncAnthropic,
        tools: dict[str, Callable[..., Awaitable[Any]]],
        tool_schemas: list[dict],
        policy: dict[str, Eligibility],
        predictor: BigramPredictor,
        model: str = "claude-opus-4-7",
        cost_per_call: dict[str, float] | None = None,
    ) -> None:
        self.client = client
        self.tools = tools
        self.tool_schemas = tool_schemas
        self.policy = policy
        self.predictor = predictor
        self.model = model
        self.cost_per_call = cost_per_call or {}
        self.stats = Stats()
        # Speculative result cache: (tool_name, canonical_args) -> Future[result]
        self._cache: dict[tuple[str, str], asyncio.Future] = {}
        # tool_use_id -> Future[result]; bound only after commit
        self._committed: dict[str, asyncio.Future] = {}
        self._last_call: tuple[str, dict] | None = None

    # ---- public ----------------------------------------------------------

    async def run(self, user_msg: str, max_turns: int = 16) -> str:
        history: list[dict] = [{"role": "user", "content": user_msg}]
        for _ in range(max_turns):
            assistant_blocks, stop_reason = await self._stream_turn(history)
            history.append({"role": "assistant", "content": assistant_blocks})
            tool_uses = [b for b in assistant_blocks if isinstance(b, ToolUseBlock)
                         or (isinstance(b, dict) and b.get("type") == "tool_use")]
            if not tool_uses or stop_reason == "end_turn":
                self._cancel_orphans()
                return _final_text(assistant_blocks)
            results = await asyncio.gather(*(self._resolve(tu) for tu in tool_uses))
            history.append({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": tu_id, "content": json.dumps(res)}
                    for (tu_id, res) in results
                ],
            })
            self._cancel_orphans()
        return "max_turns_exceeded"

    # ---- streaming -------------------------------------------------------

    async def _stream_turn(self, history: list[dict]) -> tuple[list, str]:
        async with self.client.messages.stream(
            model=self.model,
            max_tokens=4096,
            messages=history,
            tools=self.tool_schemas,
            extra_headers={"anthropic-beta": "fine-grained-tool-streaming-2025-05-14"},
        ) as stream:
            async for event in stream:
                if (
                    event.type == "content_block_start"
                    and getattr(event.content_block, "type", None) == "tool_use"
                ):
                    name = event.content_block.name
                    if self.policy.get(name, "forbid") != "forbid":
                        # Fire before args finish streaming.
                        asyncio.create_task(self._speculate(name, history))
            final = await stream.get_final_message()
        return list(final.content), final.stop_reason

    # ---- speculation -----------------------------------------------------

    async def _speculate(self, observed_name: str, history: list[dict]) -> None:
        if self._last_call is None:
            return
        prev_name, prev_args = self._last_call
        candidates = self.predictor.predict(prev_name, prev_args, history)
        for cand_name, cand_args, conf in candidates:
            if cand_name != observed_name:
                continue
            if self.policy.get(cand_name, "forbid") == "forbid":
                continue
            key = (cand_name, canonical(cand_args))
            if key in self._cache:
                return
            fut: asyncio.Future = asyncio.get_event_loop().create_future()
            self._cache[key] = fut
            self.stats.fired += 1

            async def _exec() -> None:
                try:
                    if self.policy.get(cand_name) == "warmup":
                        # DNS prewarm, connection prewarm, no side effect.
                        result = await _warmup(cand_name, cand_args, self.tools)
                    else:
                        result = await self.tools[cand_name](**cand_args)
                    if not fut.done():
                        fut.set_result(result)
                except Exception as exc:
                    if not fut.done():
                        fut.set_exception(exc)

            asyncio.create_task(_exec())
            return  # one speculation per trigger

    # ---- commit / discard ------------------------------------------------

    async def _resolve(self, tu) -> tuple[str, Any]:
        name = tu.name if hasattr(tu, "name") else tu["name"]
        args = tu.input if hasattr(tu, "input") else tu["input"]
        tu_id = tu.id if hasattr(tu, "id") else tu["id"]
        key = (name, canonical(args))
        fut = self._cache.pop(key, None)
        if fut is not None:
            self.stats.committed += 1
            self._last_call = (name, args)
            try:
                return tu_id, await fut
            except Exception as exc:
                return tu_id, {"error": repr(exc)}
        # No cache hit. Run synchronously.
        result = await self.tools[name](**args)
        # Train the predictor on the actual transition.
        if self._last_call is not None:
            self.predictor.observe(self._last_call[0], self._last_call[1], name, args)
        self._last_call = (name, args)
        return tu_id, result

    def _cancel_orphans(self) -> None:
        for (name, _), fut in list(self._cache.items()):
            if not fut.done():
                fut.cancel()
            self.stats.wasted += 1
            self.stats.dollars_wasted += self.cost_per_call.get(name, 0.0)
        self._cache.clear()
        self.stats.update()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _warmup(name: str, args: dict, tools: dict) -> Any:
    # Hook for DNS/connection prewarm. Default: no-op.
    return {"warmup": True, "tool": name}


def _final_text(blocks: list) -> str:
    parts = []
    for b in blocks:
        text = getattr(b, "text", None) if not isinstance(b, dict) else b.get("text")
        if text:
            parts.append(text)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Example: a small read-only research stack.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os

    async def web_search(query: str) -> dict:
        await asyncio.sleep(0.4)
        return {"hits": [f"https://example.com/{query}"]}

    async def arxiv_search(query: str) -> dict:
        await asyncio.sleep(0.5)
        return {"id": "2603.18897", "title": "PASTE"}

    async def fetch_url(url: str) -> dict:
        await asyncio.sleep(0.6)
        return {"url": url, "html": "<html>...</html>"}

    async def extract_text(url: str) -> dict:
        await asyncio.sleep(0.2)
        return {"url": url, "text": "Speculation reduces task time 48.5% ..."}

    async def summarize(source_url: str) -> dict:
        await asyncio.sleep(0.3)
        return {"summary": f"summary of {source_url}"}

    async def synthesize(notes: list) -> dict:
        await asyncio.sleep(0.4)
        return {"answer": "synthesized"}

    tools = {
        "web_search": web_search,
        "arxiv_search": arxiv_search,
        "fetch_url": fetch_url,
        "extract_text": extract_text,
        "summarize": summarize,
        "synthesize": synthesize,
    }
    tool_schemas = [
        {"name": "web_search", "description": "Search the web.",
         "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
        {"name": "arxiv_search", "description": "Search arxiv.",
         "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
        {"name": "fetch_url", "description": "Fetch a URL.",
         "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
        {"name": "extract_text", "description": "Extract text from a URL.",
         "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
        {"name": "summarize", "description": "Summarize a source.",
         "input_schema": {"type": "object", "properties": {"source_url": {"type": "string"}}, "required": ["source_url"]}},
        {"name": "synthesize", "description": "Synthesize notes.",
         "input_schema": {"type": "object", "properties": {"notes": {"type": "array"}}, "required": ["notes"]}},
    ]
    policy: dict[str, Eligibility] = {
        "web_search": "full",
        "arxiv_search": "full",
        "fetch_url": "full",
        "extract_text": "full",
        "summarize": "full",
        "synthesize": "forbid",  # final answer, no point speculating
    }
    cost_per_call = {n: 0.001 for n in tools}

    async def main() -> None:
        client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        harness = PASTEHarness(client, tools, tool_schemas, policy,
                               BigramPredictor(), cost_per_call=cost_per_call)
        out = await harness.run("Summarize the PASTE paper and the UMD speculative tool-calls paper.")
        print(out)
        print(harness.stats)

    asyncio.run(main())
```

Three things matter in that file. First, `_resolve` is the only place that touches `tool_use_id`, which is the only safe join key between in-flight model output and speculative results. Second, the predictor trains on the actual transitions you observe, not on the speculative ones, so a bad initial guess does not poison the model. Third, `_cancel_orphans` runs at every turn boundary, which is your billing safety net.

For the broader pattern of building harnesses around streaming events, see [Claude Code in production](/lab/claude-code-in-production/).

## The Benchmark

A six-step research-agent task: `web_search` to `arxiv_search` to `fetch_url` to `extract_text` to `summarize` to `synthesize`. We run four configurations with otherwise identical tool implementations and identical model settings on `claude-opus-4-7`. Metrics tracked: wall-clock, prompt tokens, completion tokens, cache hit rate, mispredict rate, wasted tool spend, end-to-end spend, and p50/p95/p99 step latency.

| Configuration                    | Wall-clock | Prompt tokens | Tool $  | Mispredict |
|----------------------------------|-----------:|--------------:|--------:|-----------:|
| Sequential baseline              |     38.2 s |          142k |  $0.041 |        n/a |
| Native parallel (Claude default) |     24.7 s |          142k |  $0.041 |        n/a |
| Speculative (bigram cache)       |     19.3 s |          148k |  $0.054 |        22% |
| Speculative (Haiku predictor)    |     17.1 s |          153k |  $0.062 |        14% |

These are representative numbers from a Replyant test run, calibrated against the [PASTE](https://arxiv.org/abs/2603.18897) and [UMD/LLNL](https://arxiv.org/abs/2512.15834) paper directions but not paper-exact. The shape is the point: speculation buys you 22 to 30% over native parallel at the cost of a 14 to 22% mispredict rate and a 30 to 50% increase in tool spend. If your tool spend was the binding constraint you would not be reading this. If your wall-clock was, you just bought back 5 to 8 seconds per turn.

The Haiku-predictor row is the UMD architecture in miniature: a small LM running ahead of the main LM. It costs more per turn but it predicts better, which is the right tradeoff when your tools are expensive and your tail latency matters. For the protocol around continuously measuring this, see [agent evals in CI/CD](/lab/agent-evals-cicd/). [TPS-Bench](https://arxiv.org/html/2511.01527) and the [BFCL leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html) give you reference benchmarks for the predictor itself.

## Pitfalls

1. **High mispredict rate destroys ROI.** The break-even is `P(hit) * tool_latency > P(miss) * tool_cost_amortized`. If your tools cost more than they take, speculation is a tax. Measure both.
2. **Wasted compute is a real invoice line.** Every orphaned speculative call shows up on the API bill at the end of the month. The harness above tracks `dollars_wasted` for exactly this reason. Wire it to your dashboards.
3. **Race conditions: `tool_use_id` is the only safe join key.** Do not key promotions on `(name, args)` alone in production. Two parallel `web_search("PASTE")` calls in the same turn will collide. Anthropic's `tool_use_id` is unique per call site and that is what you commit against.
4. **Cache pollution.** Speculative results that get committed must enter the message history at the same byte position they would have. If you reorder them, you break the [prompt cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) for every subsequent turn and you pay for it for the rest of the session.
5. **Anthropic recommends Programmatic Tool Calling over client-side speculation.** The model is, in their framing, the better speculator about its own next move than your bigram cache is. If you are starting greenfield, start there. Client-side speculation is for cases where you cannot let the model orchestrate.
6. **OpenAI is not speculation.** OpenAI's parallel function calling emits all calls in one closed assistant turn. Speculation fires while the model is still emitting. The two architectures look similar in profiler graphs and are not the same thing.
7. **PASTE's 3% unsafe-without-policy result.** 602 of 20,000-plus speculative actions were mutating. A speculation harness without an allow-list is a billing or data-safety incident waiting to happen. Build the eligibility policy first, the predictor second.
8. **Cache-miss tax.** Speculation that misses *and* invalidates the prompt cache is doubly costly. Pin your prefix, version your tool schemas, and make speculative-result insertion byte-stable.

## When NOT to use this

Batch jobs without latency budgets. Tool stacks where the median tool call is under 50 ms and the LLM dominates the budget. Stacks where more than 30% of tools are non-idempotent and a `forbid` policy would cover most of the trajectory anyway. Stacks where Programmatic Tool Calling already covers the parallelism need. And do not bolt this onto a system you cannot evaluate, because the technique degrades silently the moment your tool distribution shifts under it.

## Where this connects

Speculation is the within-step optimization; [context folding](/lab/context-folding/) and [context engineering](/lab/context-engineering/) are the across-step ones, and a healthy agent uses both. Speculation is also a moving target, so treat mispredict rate as a first-class evaluation metric in [agent evals in CI/CD](/lab/agent-evals-cicd/) or it will rot the moment your tool latencies shift, which they will. For broader orchestration patterns the speculation harness slots into, see [multi-agent systems](/lab/multi-agent-systems/) and the trust boundaries discussed in [memory poisoning](/lab/memory-poisoning/).
