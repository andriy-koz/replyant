---
title: "Context Folding: 200-Step Agents in 10x Less Context"
date: 2026-04-18
tags: ["AI Agents", "Architecture", "LLMs", "Prompt Engineering"]
description: "Tool accuracy collapses ~40% past 80K tokens. Context folding runs 200-step agents in 10x less context. Working harness and Anthropic compaction inside."
author: "Replyant"
---

The "long context" number in your model card is marketing. Past roughly 80K tokens, your agent's tool-calling accuracy falls off a cliff---and padding the window with more tokens is the most expensive way to get worse results. The engineering answer is not a bigger window. It is a structured compaction operation, borrowed from research published in late 2025 and early 2026 under names like FoldGRPO, AgentFold, and ACON, and now shipping as a first-class API primitive in Anthropic's `context-management-2026-01-12` beta. The common label for the technique is *context folding*: replace a settled segment of the trajectory with a learned summary, evict the raw tokens, and keep executing against the compressed artifact.

Context folding is the upstream discipline of [context engineering](/lab/context-engineering/) applied to time rather than breadth. Context engineering decides what belongs in the window at step N; folding decides what gets to *stay* in the window by step N+100. It is adjacent to---but distinct from---the memory subsystem described in [memory poisoning](/lab/memory-poisoning/). Folding compresses *within* a run. Memory persists *across* runs. Mix them up and your agent either forgets facts it needed three steps ago or writes every intermediate tool chatter into a permanent store that an attacker will eventually poison.

This post maps the three schools of compaction, formalizes the fold operation, ships ~300 LOC of a working `FoldHarness` in Python, wires Anthropic's compaction beta for comparison, and closes with an eval loop and a pitfalls list.

---

## Why "Long Context" Is a Trap

The industry anchored on context length as a headline capability: 128K, 200K, 1M, 2M tokens. Evaluations that actually exercise those windows---not needle-in-a-haystack probes, but agentic tool-calling over long trajectories---tell a different story.

Three empirical findings converge:

1. **Effective attention degrades well before the nominal limit.** Google DeepMind's long-context evaluations of Gemini models, and independent evaluations of frontier models by Chroma and by Anthropic's own harness team, report that retrieval fidelity on tool-call-heavy trajectories begins to decay in the 32K–80K range. The decay is non-linear: a 2x increase in context often produces a 3–5x increase in hallucinated tool arguments.

2. **Tool-calling accuracy specifically collapses.** In the agent setting, the relevant metric is not "does the model remember this fact" but "does the model invoke the correct tool with the correct arguments given the full prior trajectory." Production observations reported in Anthropic's engineering notes on long-running harnesses describe tool-call accuracy dropping by approximately 40% once trajectories push past the 80K effective-context threshold. That is not a gentle curve. That is a cliff.

3. **The cost curve is strictly convex.** Every additional token is paid for at input price on every subsequent turn. A 200-step agent that accumulates 400K tokens of trajectory pays to re-read its own history on every step. On frontier model pricing, this is the dominant cost of a long-horizon agent---not the reasoning, not the output, the *re-reading of its own past*.

The naive response is to buy more context. This fails in three directions at once: accuracy degrades, latency grows, and cost scales super-linearly with trajectory length. The FoldGRPO paper ([arXiv:2510.11967](https://arxiv.org/abs/2510.11967)) demonstrates the alternative: agents reaching 200+ steps while maintaining an *active context window* of roughly 32K tokens---inside the regime where tool accuracy holds up. The trick is not a bigger window. It is an operation that makes the window you have go further.

---

## The Three Schools of Compaction

Three distinct research traditions converged on context compression in the last six months. They differ in what they preserve, how eviction is decided, whether the compactor is learned or heuristic, and the granularity at which compaction happens. The practical choice for a production harness usually involves picking one as the default and borrowing ideas from the others.

| Approach | Origin | What's preserved | Eviction strategy | Learned or heuristic | Ideal use |
|---|---|---|---|---|---|
| Rolling summarization | Pre-2025 standard; formalized in Anthropic's harness notes and `context-management-2026-01-12` beta | Recent verbatim turns + summary of older turns | Threshold-triggered summarize-and-drop on oldest block | Heuristic (prompt-driven) | Open-ended chat, coding agents with long sessions |
| Guideline-learning compaction (ACON) | [arXiv:2510.00615](https://arxiv.org/abs/2510.00615) | Task-relevant observations, filtered by learned guidelines that specify what matters per task class | Guideline-scored pruning of observations | Learned (guidelines optimized offline) | Domain-specific agents with stable task shapes |
| Fold / branch-and-fold (FoldGRPO, AgentFold) | [arXiv:2510.11967](https://arxiv.org/abs/2510.11967), [arXiv:2510.24699](https://arxiv.org/abs/2510.24699) | Sub-trajectory outcomes + their arguments; raw intermediate tool chatter is evicted | Agent-decided fold at segment boundaries (sub-task returns, web-page reads) | Learned (via RL in FoldGRPO; structured prompting in AgentFold) | Long-horizon agents with identifiable sub-task structure |

Rolling summarization is the simplest to ship and the default for Anthropic's compaction beta. It treats the trajectory as an undifferentiated stream and compresses the oldest parts when a threshold is crossed. Its weakness: "oldest" is a poor proxy for "least relevant"---an early tool call that established a critical constraint is older than the last five re-reads of a docs page, but the constraint is what you want to keep.

ACON ([arXiv:2510.00615](https://arxiv.org/abs/2510.00615)) addresses that weakness by learning *guidelines*---rules about what matters per task class---and scoring observations against them. Fold, in the FoldGRPO and AgentFold formulations, goes further: the agent itself recognizes when a sub-trajectory has *completed*---a page has been read, a sub-task returned, a search resolved---and folds that segment into a compact artifact. AgentFold ([arXiv:2510.24699](https://arxiv.org/abs/2510.24699)) applies this to web agents, where the navigate-read-return branch structure is explicit. FoldGRPO ([arXiv:2510.11967](https://arxiv.org/abs/2510.11967)) trains the policy end-to-end so the fold decision is part of the optimized trajectory.

The rest of this post focuses on fold-class compaction, because that is the technique producing the headline result: 200-step agents in 32K of active context. Ship rolling summarization as a floor, and move to fold for sub-tasks with clear structure.

---

## The Fold Operation, Formalized

Let the agent trajectory at step `t` be a sequence `τ_t = [m_1, m_2, ..., m_t]` where each `m_i` is a message: a user turn, an assistant reasoning block, a tool call, or a tool result. Define:

```
fold : TrajectorySegment -> (summary: Message, evicted: list[Message])
```

The operation takes a contiguous segment `τ[i..j]` of the trajectory---typically the span of a completed sub-task---and returns a single synthetic message that stands in for that segment in the active context, plus the list of evicted messages (preserved in cold storage for audit and retrieval but no longer sent to the model).

The post-fold trajectory is:

```
τ' = [m_1, ..., m_{i-1}, summary, m_{j+1}, ..., m_t]
```

Two properties are required for the operation to be sound:

- **Outcome preservation.** If the downstream trajectory depends on a fact `f` produced inside `τ[i..j]`, then `f` must appear in the summary. Violating this is the primary failure mode (see Pitfalls, item 1).
- **Reference stability.** If later steps reference an entity by a name introduced inside the segment, the name must survive in the summary. Otherwise semantic retrieval post-fold drifts (see Pitfalls, item 3).

FoldGRPO's branch-and-fold extension applies this operation recursively. The agent branches into a sub-trajectory---a sub-task with its own local context---executes it, folds the entire branch into a single outcome message, and continues the parent trajectory with only the fold result. This is structurally similar to function calls in a programming language: the callee's local variables are not visible to the caller after return.

```
    BRANCH-AND-FOLD CYCLE

    parent trajectory
    ──┬────────────────────────────────────────────────────────
      │ step N: agent decides "fetch and read the docs page"
      │
      ├──▶ branch: sub-trajectory starts
      │    ├── tool_call: fetch(url)
      │    ├── tool_result: <20KB of HTML>
      │    ├── assistant: extracts relevant section
      │    ├── tool_call: fetch(linked_api_ref)
      │    ├── tool_result: <15KB of API docs>
      │    └── assistant: identifies required auth header
      │
      │   FOLD ───▶ summary message:
      │            "Read docs for endpoint X. Auth header
      │             required: X-Org-Token. Rate limit: 100/min.
      │             Source URLs preserved in cold storage."
      │
      ├──▶ step N+1: agent receives fold summary, continues
      │              parent task with 400 tokens instead of 35K
    ──┴────────────────────────────────────────────────────────
```

The agent's *active context* at any moment is the parent trajectory plus the fold summaries of completed branches, not the raw sub-trajectories themselves. This is how FoldGRPO reaches 200+ steps inside a 32K effective window: at any given moment, the agent is executing one shallow stack of active segments while everything completed is compressed.

The fold decision itself is the nontrivial part. FoldGRPO learns it end-to-end. AgentFold uses structural cues (page loads, tab switches, sub-task returns). For a production harness that cannot afford end-to-end RL, a hybrid works: structural heuristics that propose fold boundaries, plus a threshold that forces a fold when the active context exceeds some fraction of the model's effective window.

---

## Implementing a Fold Harness

The following harness is independently reasoned---it does not replicate any specific paper implementation. It illustrates the mechanics: a trajectory data structure, a fold operation driven by a compaction prompt, threshold-based triggering, and cold storage of evicted segments.

```python
# fold_harness/models.py
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class Role(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    FOLD_SUMMARY = "fold_summary"


@dataclass
class Message:
    """A single entry in the agent trajectory."""
    role: Role
    content: str
    tool_name: Optional[str] = None
    tool_args: Optional[dict[str, Any]] = None
    token_estimate: int = 0
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: float = field(default_factory=time.time)
    # If this message is a fold summary, references the evicted segment.
    folded_message_ids: list[str] = field(default_factory=list)


@dataclass
class FoldedSegment:
    """An evicted segment, preserved in cold storage for audit and retrieval."""
    segment_id: str
    start_index: int
    end_index: int
    messages: list[Message]
    summary_message_id: str
    folded_at: float = field(default_factory=time.time)


@dataclass
class Trajectory:
    """The active trajectory plus cold storage of evicted segments."""
    messages: list[Message] = field(default_factory=list)
    cold_storage: list[FoldedSegment] = field(default_factory=list)

    @property
    def active_tokens(self) -> int:
        return sum(m.token_estimate for m in self.messages)

    def append(self, message: Message) -> None:
        self.messages.append(message)
```

The `Trajectory` separates *active* messages (sent to the model) from *cold storage* (the evicted raw segments, kept for audit and optional retrieval on miss). `Message.folded_message_ids` is the back-pointer that lets you reconstruct what any fold summary replaced.

The fold operation itself is a method on the harness. It takes a segment range, builds a compaction prompt, calls the model, and replaces the range with a single summary message.

```python
# fold_harness/harness.py
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Callable, Optional

from .models import FoldedSegment, Message, Role, Trajectory

# In production, a summarizer is a model call; here it's any text->text fn.
Summarizer = Callable[[list[Message]], str]

FOLD_PROMPT_TEMPLATE = """You are compacting a completed segment of an agent trajectory.
Your output replaces the segment below in the agent's active context. The
agent will continue using only your summary; the raw segment will be evicted.

PRESERVE, IN ORDER OF IMPORTANCE:
1. Facts, identifiers, URLs, credential names, numeric results the agent may
   reference in later steps.
2. Tool-call outcomes (status, returned ids, pagination tokens, error codes).
3. Constraints discovered (rate limits, auth requirements, schema details).
4. Entity names --- keep exact spelling so semantic retrieval stays stable.

DISCARD: verbatim tool-result bodies once the outcome is extracted; reasoning
chains that produced no lasting conclusion; restatements of earlier content.

Output: one paragraph of 80-200 words beginning "Folded segment:".

SEGMENT:
{segment_text}
"""


@dataclass
class FoldConfig:
    # Fold when active context exceeds this fraction of the effective window.
    active_fraction_threshold: float = 0.6
    effective_window_tokens: int = 32_000
    # Minimum segment worth folding; below this, summary overhead ~= raw cost.
    min_segment_tokens: int = 2_000
    # Keep the N most recent messages verbatim --- folds happen behind this.
    hot_tail_size: int = 6


class FoldHarness:
    """A trajectory-aware harness that folds completed segments on threshold.

    Thread-safe: the RLock protects trajectory mutations during concurrent
    append/fold calls. Not designed for cross-process concurrency.
    """

    def __init__(self, summarizer: Summarizer, config: Optional[FoldConfig] = None) -> None:
        self.trajectory = Trajectory()
        self.summarizer = summarizer
        self.config = config or FoldConfig()
        self._lock = threading.RLock()

    def append(self, message: Message) -> None:
        """Append a message; may trigger an automatic fold."""
        with self._lock:
            self.trajectory.append(message)
            if self._should_fold():
                self._fold_oldest_eligible_segment()

    def fold_range(self, start: int, end: int) -> FoldedSegment:
        """Explicit fold of trajectory[start:end] --- call on sub-task return."""
        with self._lock:
            return self._fold_range_locked(start, end)

    def _fold_range_locked(self, start: int, end: int) -> FoldedSegment:
        if start < 0 or end > len(self.trajectory.messages) or start >= end:
            raise ValueError(f"Invalid fold range: [{start}, {end})")

        segment = self.trajectory.messages[start:end]
        summary_text = self.summarizer(segment)
        summary_msg = Message(
            role=Role.FOLD_SUMMARY,
            content=summary_text,
            token_estimate=_estimate_tokens(summary_text),
            folded_message_ids=[m.message_id for m in segment],
        )
        folded = FoldedSegment(
            segment_id=summary_msg.message_id,
            start_index=start,
            end_index=end,
            messages=segment,
            summary_message_id=summary_msg.message_id,
        )
        self.trajectory.messages[start:end] = [summary_msg]
        self.trajectory.cold_storage.append(folded)
        return folded

    def _should_fold(self) -> bool:
        threshold = int(self.config.active_fraction_threshold
                        * self.config.effective_window_tokens)
        return self.trajectory.active_tokens > threshold

    def _fold_oldest_eligible_segment(self) -> Optional[FoldedSegment]:
        """Oldest contiguous non-fold span >= min_segment_tokens, then fold it."""
        msgs = self.trajectory.messages
        tail_start = max(0, len(msgs) - self.config.hot_tail_size)
        acc = 0
        span_start: Optional[int] = None
        for i in range(tail_start):
            m = msgs[i]
            if m.role == Role.FOLD_SUMMARY:
                # Don't fold across an existing fold boundary.
                span_start, acc = None, 0
                continue
            if span_start is None:
                span_start, acc = i, m.token_estimate
            else:
                acc += m.token_estimate
            if acc >= self.config.min_segment_tokens:
                return self._fold_range_locked(span_start, i + 1)
        return None


def _estimate_tokens(text: str) -> int:
    """Cheap ~4 chars/token estimate. Swap for tiktoken in production."""
    return max(1, len(text) // 4)
```

The harness encodes a few deliberate decisions. **Hot tail is never folded**---the `hot_tail_size` (default 6) keeps the most recent messages verbatim; folding a just-produced message loses the model's own intent. **Fold boundaries respect existing summaries**---meta-folding has the same lossy-cascade risk as repeated JPEG recompression, so keep it out of v1. **Cold storage is kept indefinitely**---on a suspected fold miss (pitfall 1), a helper reconstructs the original segment from `trajectory.cold_storage`; the memory cost is bounded by the trajectory itself, which you were keeping for audit anyway.

The fold decision here is threshold-based---a floor. In production you combine it with structural triggers: call `fold_range` explicitly at sub-task return, at a page boundary, or when a tool returns a large body already summarized inline.

---

## Wiring Anthropic's Compaction Beta

Anthropic shipped automatic compaction as a first-class API feature in early 2026 under the `context-management-2026-01-12` beta header. This is the equivalent of rolling summarization integrated at the platform layer: you opt in, the API keeps track of conversation size, and compacts older turns into summaries automatically when thresholds are crossed. The difference from the harness above is that you do not control *what* gets folded or *when*---the platform does, on a general-purpose policy.

```python
# fold_harness/anthropic_compaction.py
import os
from typing import Any

from anthropic import Anthropic

# The beta header opts into automatic context compaction for the request.
# Check the Anthropic docs for the current beta identifier.
COMPACTION_BETA = "context-management-2026-01-12"

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def run_with_auto_compaction(
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str = "claude-opus-4-7",
) -> dict[str, Any]:
    """
    Run a long-horizon turn against the Messages API with automatic
    context compaction enabled.

    The API collapses older tool_use / tool_result pairs into compact
    summaries when the conversation approaches the model's context
    pressure threshold. The caller receives usage data indicating
    whether compaction occurred and how many tokens were reclaimed.
    """
    response = client.messages.create(
        model=model,
        system=system,
        messages=messages,
        tools=tools,
        max_tokens=4_096,
        betas=[COMPACTION_BETA],
        # Optional: request that specific tool_result bodies be considered
        # first-class compaction candidates. The API uses tool_use/tool_result
        # pair boundaries as natural fold points.
        extra_headers={"anthropic-context-compaction": "tool-results-first"},
    )

    # The API surfaces compaction telemetry in the response usage block.
    usage = response.usage
    telemetry = {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "compacted_tokens": getattr(usage, "compacted_input_tokens", 0),
        "compaction_triggered": getattr(usage, "compacted_input_tokens", 0) > 0,
    }

    return {
        "response": response,
        "telemetry": telemetry,
    }


def append_and_continue(
    conversation: list[dict[str, Any]],
    assistant_message: dict[str, Any],
    tool_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    The standard agent loop: the caller appends the assistant's turn and
    the tool results, then re-submits. With the compaction beta enabled,
    the platform collapses older pairs automatically --- your application
    does not mutate the message history.
    """
    conversation.append(assistant_message)
    if tool_results:
        conversation.append({"role": "user", "content": tool_results})
    return conversation
```

Two differences from `FoldHarness` matter. The compaction beta is *opaque*---you get telemetry on reclaimed tokens but do not directly observe which `tool_use` / `tool_result` pairs were folded or what the summary contains. For a general agent that is fine; for a domain agent where a specific piece of evidence must survive compression, use the explicit harness. Second, the platform compacts at natural boundaries: the Anthropic Cookbook automatic-compaction example notes that `tool_use` / `tool_result` pairs are the preferred fold unit---the same structural insight AgentFold ([arXiv:2510.24699](https://arxiv.org/abs/2510.24699)) applies. The integration pattern: use the beta as the floor for all long-running agents, overlay `FoldHarness` for sub-tasks needing outcome-preservation guarantees.

---

## Measuring What Folding Costs You

Folding is not free. Every fold is a lossy transformation; the question is whether the loss is smaller than the loss from running past the effective-context cliff. You measure it.

Four metrics matter:

1. **Task success rate.** End-to-end: did the agent accomplish the goal? Folding should hold this flat or improve it. If success drops, the fold prompt is losing information the agent needs.
2. **Recall@retrieval.** For a set of probe facts introduced at step $k$, does the agent correctly recall them at step $k+N$? This is the clean measurement of outcome preservation.
3. **Hallucinated tool-call rate.** Tool calls with arguments the trajectory does not support. This number rises when the agent is reconstructing context it should still have---a symptom of over-aggressive folding.
4. **Peak tokens per step.** The maximum active-context size across the trajectory. This is the variable folding is supposed to control. Plot it alongside success rate to verify the tradeoff.

The eval loop below runs a fixed task through two harnesses---append-only and `FoldHarness`---and logs the four metrics for comparison. Integrate this into your [agent eval CI](/lab/agent-evals-cicd/) and gate changes to fold policy on regression thresholds.

```python
# fold_harness/eval.py
from __future__ import annotations

import statistics
from dataclasses import dataclass
from typing import Callable

from .harness import FoldConfig, FoldHarness
from .models import Message, Trajectory

TaskRunner = Callable[[Trajectory], "TaskResult"]


@dataclass
class TaskResult:
    succeeded: bool
    probe_recall: float          # 0.0-1.0 of probe facts correctly recalled
    hallucinated_tool_calls: int
    trajectory: Trajectory


@dataclass
class HarnessReport:
    label: str
    success_rate: float
    avg_probe_recall: float
    avg_hallucinated_calls: float
    peak_tokens_p95: int
    folds_executed_avg: float


def _peak_tokens(t: Trajectory) -> int:
    """Approximate peak: active + raw cold-storage size."""
    return t.active_tokens + sum(
        sum(m.token_estimate for m in seg.messages) for seg in t.cold_storage
    )


def run_eval(
    label: str,
    task_runner: TaskRunner,
    build_trajectory: Callable[[], Trajectory],
    n_runs: int = 50,
) -> HarnessReport:
    successes, recalls, hallucs, peaks, folds = 0, [], [], [], []
    for _ in range(n_runs):
        r = task_runner(build_trajectory())
        successes += int(r.succeeded)
        recalls.append(r.probe_recall)
        hallucs.append(r.hallucinated_tool_calls)
        peaks.append(_peak_tokens(r.trajectory))
        folds.append(len(r.trajectory.cold_storage))

    peaks_sorted = sorted(peaks)
    return HarnessReport(
        label=label,
        success_rate=successes / n_runs,
        avg_probe_recall=statistics.mean(recalls),
        avg_hallucinated_calls=statistics.mean(hallucs),
        peak_tokens_p95=peaks_sorted[int(len(peaks_sorted) * 0.95)],
        folds_executed_avg=statistics.mean(folds),
    )


def compare(task_runner: TaskRunner,
            summarizer: Callable[[list[Message]], str],
            n_runs: int = 50) -> tuple[HarnessReport, HarnessReport]:
    """Run the same task through append-only and fold harnesses."""
    naive = run_eval("append-only", task_runner, Trajectory, n_runs)
    folded = run_eval(
        "fold",
        task_runner,
        lambda: FoldHarness(summarizer, FoldConfig()).trajectory,
        n_runs,
    )
    return naive, folded
```

The pattern to look for in the output: the fold harness should show peak tokens 5–10x lower than append-only, hallucinated calls held flat or lower, probe recall within a few percentage points, and success rate equal or higher. If probe recall drops sharply while peak tokens are only modestly reduced, your fold threshold is too aggressive. If hallucinated calls rise, the fold prompt is losing tool-outcome detail---tighten the summarizer's "preserve" list.

---

## When to Fold vs. Offload

Folding is one of three techniques for managing long-horizon agent context. The others are *offloading* (writing state to a memory system outside the context window) and *branching* (spawning a sub-agent with its own context). They are not interchangeable.

**Fold** intermediate tool chatter---web pages read and extracted, directory listings enumerated, debug logs inspected. These are information-dense moments whose outcome is typically a handful of facts. The raw content has served its purpose once the fact is extracted; the fold summary is the fact.

**Offload** cross-session state---user preferences, project conventions, decisions with long-term consequences. This is the [memory system](/lab/memory-poisoning/) domain, and the security properties are different: offloaded data persists across sessions and must be treated as a trust-boundary write. A fold summary is in-session and ephemeral; a memory write is permanent and exploitable. The two should never share a write path.

**Spawn a sub-agent** when the branch has genuinely parallel or structurally independent reasoning---the parent does not need to observe the sub-task's reasoning, only its outcome. [Multi-agent systems](/lab/multi-agent-systems/) covers the coordination patterns. A sub-agent's entire trajectory can be discarded on return, keeping only the return value in the parent---this is the extreme form of fold, where the fold is the return boundary of a new agent process.

The decision tree in practice:

- If the segment's *outcome* is a bounded set of facts relevant to the parent task: **fold**.
- If the segment produces state that should persist beyond this session: **offload to memory**.
- If the segment can be executed independently and only the return value matters: **spawn a sub-agent**.

Production harnesses use all three. The [tool-calling loop](/lab/anatomy-of-ai-agent-tool-calling/) is where these decisions land---it is the loop that produces the trajectory being folded, the state being offloaded, the return values being passed between agents.

---

## Pitfalls (a.k.a. Folds That Bite)

### 1. Folding evidence the agent still needs

The most common failure mode. A tool result gets folded into a summary that elides the specific detail a later step will reference. Symptom: the agent re-invokes the tool, often with identical arguments, because it needs the data the fold dropped. Diagnostic: track tool-call repetition rate before and after enabling folds---it should not rise.

Mitigation: the fold prompt must name the concrete preservations (identifiers, URLs, error codes, pagination tokens). Generic "summarize this conversation" prompts are not safe for tool trajectories; they optimize for readability and discard the fiddly details agents actually need.

### 2. Fold-induced hallucination

The summarizer fabricates an outcome that the segment did not actually produce---a common failure when the segment is long and the summarizer is weak. Symptom: the agent confidently references a "successful" action that never happened. Diagnostic: run probe evals where the ground-truth outcome is known, and check whether the fold summary matches it.

Mitigation: use a strong summarizer (the same model or one tier weaker, not two tiers weaker), and enforce that tool outcomes appear verbatim---include the structured outcome (e.g., `{"status": 200, "id": "..."}`) as an explicit field in the summary prompt, not as free text.

### 3. Unstable retrieval post-fold

Later steps reference an entity by a name that was introduced mid-segment. If the summarizer paraphrases that name (say, "the authentication endpoint" instead of `/v2/oauth/token`), semantic retrieval against the fold summary drifts. Symptom: the agent describes the right thing but fails to look it up. Diagnostic: compare exact-string retrieval hits on pre-fold and post-fold trajectories.

Mitigation: add "preserve exact names" to the fold prompt and validate with a cheap post-fold check: the set of named entities in the summary should be a superset of the named entities referenced in subsequent steps.

### 4. Over-aggressive decay on long-running tasks

A fold threshold tuned for typical runs over-compresses a genuinely long task. Symptom: on the long tail of trajectory length, success rate collapses while shorter runs look fine. Diagnostic: plot success rate against trajectory length---if the curve inflects downward sharply past some step count, your threshold is biased against long tasks.

Mitigation: make the fold threshold adaptive. Under low task progress (the agent is still exploring), fold less aggressively. Under high progress (the agent is converging), fold more. This is the direction AgentFold ([arXiv:2510.24699](https://arxiv.org/abs/2510.24699)) pushes with its proactive context management---folding is not a constant policy, it is a trajectory-aware one.

---

## Where to Start

Context folding is shippable incrementally. You do not need to adopt FoldGRPO-style RL training or rewrite your harness around AgentFold to get most of the benefit. The sequence:

1. **Enable the Anthropic compaction beta today.** Add the `context-management-2026-01-12` beta header to all long-running agent calls. This is a one-line change that establishes a floor of rolling-summarization compaction and gives you the `compacted_input_tokens` telemetry you need to understand your actual context pressure.

2. **Instrument peak tokens per step.** Log the active-context size on every turn. You cannot tune a fold policy you are not measuring. If peak tokens never exceed 30K, you do not have a context problem; if they routinely exceed 80K, you are in the tool-accuracy collapse zone and fold is load-bearing.

3. **Ship a threshold-triggered `FoldHarness` for your longest-running agent.** Use the code in this post as a starting point. Start with `active_fraction_threshold=0.6` and `hot_tail_size=6`. Measure task success rate before and after---it should hold flat or improve, never regress.

4. **Add structural fold points for sub-tasks you control.** Wherever your agent has an explicit sub-task---a page read, a multi-step lookup, a verification chain---call `fold_range` explicitly at the return point. Structural folds outperform threshold folds because they respect semantic boundaries.

5. **Gate fold-policy changes on the four-metric eval.** Success rate, probe recall, hallucinated tool calls, peak tokens. Regression in any of them on your production task distribution blocks the change. This is the `agent-evals-cicd` pattern applied to compaction.

The 200-step agent in 32K of active context is not a feature of the next-generation model. It is a feature of the *harness* around today's models. Bigger context windows will keep shipping; the tool-accuracy cliff past 80K will keep being a property of transformer attention, not a marketing problem solved by a bigger number. Folding is the engineering answer---and it is available to you now, with a platform beta as the floor and a one-file harness as the ceiling.

---

*We design production harnesses for long-horizon AI agents. If your agents are hitting the 100-step wall and you don't know which school of compaction to pick, [let's talk](/#contact).*
