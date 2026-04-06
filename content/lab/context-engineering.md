---
title: "Context Engineering: Why It Matters More Than Your Model"
date: 2026-04-06
tags: ["AI Agents", "LLMs", "Architecture", "Prompt Engineering"]
description: "Context engineering is the top challenge for 57% of orgs running agents in production. The full stack, from system prompts to MCP, with code."
---

The most important skill in production AI in 2026 is not prompt engineering, model selection, or fine-tuning. It is context engineering — the discipline of designing everything the model sees at inference time. A weaker model with well-engineered context consistently outperforms a stronger model with bad context. Anthropic's own evaluation showed that Claude Code with proper context engineering via MCP achieved an 80% quality improvement over the same model without it. LangChain's 2026 State of Agent Engineering report confirms the pattern: context engineering is the top difficulty for 57% of organizations running agents in production.

Language models don't learn between calls. Every response is generated from scratch, using only what's in the context window at that moment. If the right information isn't there — or the wrong information is — the model fails regardless of its capabilities. Context engineering is the practice of making sure the right information is always there.

---

## What Context Engineering Actually Is

### How is context engineering different from prompt engineering?

Prompt engineering is one component of context engineering — the system prompt layer. Context engineering encompasses everything the model receives at inference time: the system prompt, conversation history, tool definitions, retrieved documents, agent memory, MCP resources, and any dynamically injected state. It is the full information architecture of an AI interaction, not just the initial instruction set.

The shift from static instructions to dynamic information design is what separates agents that work in demos from agents that work in production. The components break down into six layers:

1. **System prompt** — role definition, behavioral constraints, output format
2. **Tool definitions** — the function signatures and descriptions the model uses to decide what to call
3. **Dynamic context via MCP** — real-time data from external systems injected at inference
4. **Conversation history** — the sliding window of prior turns the model can reference
5. **Agent memory** — persisted state across sessions (summaries, user preferences, learned patterns)
6. **Retrieved documents** — RAG results, knowledge base articles, code snippets pulled by semantic search

Each layer interacts with the others. A well-designed system prompt reduces the burden on tool descriptions. Good tool definitions reduce the need for explicit instructions in the system prompt. Strong retrieval makes conversation history less critical because the agent can look up what it needs instead of relying on what was said earlier.

---

## The Context Engineering Stack

### System Prompt Design

The system prompt is the foundation layer — the persistent instruction set that survives every turn. We covered [how to structure production system prompts](/lab/anatomy-of-an-ai-agent-system-prompt/) previously. The context engineering insight: every token of system prompt competes with every other token in the context window. A 3,000-token system prompt seems cheap — until you add tool definitions, conversation history, and retrieval results that push total context to 150,000 tokens.

ETH Zurich's 2026 study found that AGENTS.md and CLAUDE.md files can actually hurt agent performance when poorly designed. Overly long instruction files with contradictory or vague directives caused models to perform worse than with no instructions at all. The mechanism is attention dilution — the model spreads focus across too many constraints and follows none reliably.

The fix is ruthless editing. Every line should answer: would removing this cause the agent to make a specific, observable mistake?

### Tool Definitions as Context

Tool definitions are the most underrated layer of context engineering. When you define a tool's name, description, and parameter schema, you are writing context that the model reads on every single turn. As we covered in [how tool calling actually works](/lab/anatomy-of-ai-agent-tool-calling/), the description field does the heavy lifting — the model uses it to decide *when* to call the tool, not just *what* it does.

Poorly written tool descriptions create context pollution that degrades performance across the entire agent, not just for that one tool.

### Dynamic Context via MCP

The Model Context Protocol is the retrieval layer of context engineering. [MCP connects your agents to business systems](/lab/anatomy-of-ai-agent-mcp/) — databases, APIs, knowledge bases, file systems — and injects their data into the context window at inference time. The context engineering challenge with MCP is volume control. Every MCP tool result consumes tokens. A database query returning 50 rows of JSON burns thousands. As we noted in the [Claude Code production configuration](/lab/claude-code-in-production/), when MCP tool descriptions exceed 10% of the context window, Claude Code switches to a two-step search-then-call process — adding latency in exchange for context efficiency.

The engineering discipline: include only what the model needs to make the next decision, and structure it so the relevant information is easy to find.

### Conversation History Management

Every turn consumes context. A 50-turn debugging session can burn 80,000+ tokens before the agent reads the current file. Two strategies dominate:

**Sliding window with summarization.** Keep the most recent N turns verbatim. Summarize everything older into a compressed representation that preserves decisions and key facts.

**Selective retention.** Tool calls and their results carry more information density than conversational turns. Keep tool interactions longer; compress small talk aggressively.

### Agent Memory and State

Context that persists across sessions — user preferences, project conventions, prior decisions, learned failure patterns. In [Claude Code's extension model](/lab/claude-code-in-production/), CLAUDE.md files serve this function: they survive context compaction because the agent re-reads them from disk. The critical design decision is what to remember. Storing everything creates retrieval noise. Storing nothing forces the agent to rediscover context every session. The best implementations store decisions and their rationale — not raw conversation, but the conclusions drawn from it.

---

## Building the Context Assembly Pipeline

Here's the core pattern — a budget-aware context assembly function that prioritizes layers and tracks what gets dropped.

```python
def assemble_context(
    system_prompt: str,
    tool_definitions: list[dict],
    conversation_history: list[dict],
    mcp_results: dict[str, Any],
    agent_memory: dict[str, str],
    retrieved_docs: list[str],
    max_context_tokens: int = 180_000,
) -> AssembledContext:
    """
    Priority order (highest to lowest):
      1. System prompt — always included
      2. Tool definitions — always included
      3. Agent memory — persistent cross-session state
      4. MCP results — live data from connected systems
      5. Retrieved documents — RAG results
      6. Conversation history — trimmed from oldest first
    """
    budget = max_context_tokens - 4_096  # Reserve for response
    used, included, dropped = 0, [], []

    # Layers 1-2: Mandatory
    used += estimate_tokens(system_prompt)
    used += estimate_tokens(json.dumps(tool_definitions))

    # Layer 3: Agent memory — append to system prompt if it fits
    if agent_memory:
        block = "\n".join(f"- {k}: {v}" for k, v in agent_memory.items())
        tokens = estimate_tokens(block)
        if used + tokens < budget:
            system_prompt += f"\n\n## Agent Memory\n{block}"
            used += tokens
        else:
            dropped.append("agent_memory")

    # Layer 4: MCP results — live data from connected systems
    if mcp_results:
        block = "\n\n".join(f"### {s}\n{c}" for s, c in mcp_results.items())
        tokens = estimate_tokens(block)
        if used + tokens < budget:
            system_prompt += f"\n\n## Live Data\n{block}"
            used += tokens
        else:
            dropped.append("mcp_results")

    # Layer 5: Retrieved docs — include as many as fit
    for doc in retrieved_docs:
        tokens = estimate_tokens(doc)
        if used + tokens >= budget:
            dropped.append("docs_truncated")
            break
        system_prompt += f"\n\n{doc}"
        used += tokens

    # Layer 6: Conversation history — trim oldest first
    remaining = budget - used
    messages = []
    for msg, tok in reversed(list(zip(conversation_history, msg_tokens))):
        if tok <= remaining:
            messages.insert(0, msg)
            remaining -= tok
    if len(messages) < len(conversation_history):
        dropped.append(f"history({len(conversation_history) - len(messages)} turns)")

    return AssembledContext(
        system_prompt=system_prompt, messages=messages,
        tools=tool_definitions, total_tokens=budget - remaining,
        layers_included=included, layers_dropped=dropped,
    )
```

The priority ordering matters. System prompt and tool definitions are non-negotiable. Agent memory and MCP results carry session-critical state. Retrieved documents add depth but are expendable. Conversation history gets trimmed first because the agent can ask follow-up questions to recover lost context, but it can't recover missing tools or live data.

The `layers_dropped` field is critical for observability. When your agent produces worse results, the first thing to check is whether important context layers are being dropped due to budget constraints.

---

## Common Mistakes in Context Engineering

### Context Pollution: Too Much Information

The instinct to give the model everything backfires. A 50-page company handbook injected into every agent call doesn't make the agent smarter — it makes every other piece of context harder for the model to attend to. Research on retrieval-augmented generation consistently shows that including irrelevant documents degrades performance compared to no retrieval at all.

The Manus team — builders of the viral autonomous agent — published their lessons learned in early 2026. Their central finding: careful context curation matters more than sophisticated reasoning. They spent more engineering time on what *not* to include in the context window than on the agent's reasoning logic. Removing low-value context improved task completion rates by over 30%.

### Context Starvation: Too Little Information

The opposite failure. The agent lacks information it needs, so it either hallucinates or asks the user for information the system should have provided. Common in agents that rely purely on conversation history with no MCP integration or retrieval layer.

### Retrieval Failures: Wrong Information

The context window contains information, but it's the wrong information. A semantic search returns topically related but irrelevant documents. The agent confidently cites the retrieved content and produces a plausible-sounding wrong answer. This is worse than context starvation because the agent doesn't know it's wrong.

### Structural Incoherence

Information is present but poorly organized. Vague tool descriptions, MCP results dumped as raw JSON without labels, conversation history mixing multiple threads. The model can technically access the information, but the structure doesn't help it find what it needs. As noted in our [multi-agent systems analysis](/lab/multi-agent-systems/), this compounds when context flows across agent boundaries — each handoff is an opportunity for structural degradation.

---

## Measuring Context Engineering Quality

You can't improve what you don't measure. Three metrics tell you whether your context engineering is working:

**Tool selection accuracy** — the percentage of tool calls where the agent picks the correct tool on the first attempt. Low accuracy means your tool definitions are ambiguous or irrelevant context is drowning out the tool descriptions. Production agents should achieve 90%+ first-attempt accuracy. Below 85%, debug the context before blaming the model.

**Response relevance** — does the agent's response actually address what was asked? Measure with automated evaluations (a separate LLM scoring relevance on a 1-5 scale) and human spot-checks. A decline in relevance usually signals that critical context is being dropped or irrelevant context is diluting the signal.

**Token efficiency** — the ratio of useful output to total tokens consumed. An agent that uses 50,000 tokens to produce a response achievable with 10,000 tokens has a context engineering problem. Increasing token consumption without increasing output quality is the telltale sign of context bloat.

Track all three per request and aggregate weekly. The goal is the configuration where all three are above their thresholds simultaneously.

---

## The Manus Lesson: Curation Over Sophistication

The Manus team's public post-mortem is the most instructive case study in context engineering published to date. Their viral autonomous agent succeeded not because of a novel architecture but because of obsessive attention to what the agent saw at each step. Their key engineering decisions:

1. **Context was rebuilt from scratch at every step.** Instead of accumulating history, they re-assembled the context window for each action with only what was relevant to the immediate next decision.
2. **Tool definitions were versioned and A/B tested.** Small wording changes in descriptions produced 15-20% swings in tool selection accuracy.
3. **Retrieved context was filtered aggressively.** Their pipeline returned 20 candidate documents; the assembly layer selected 3-5 via a lightweight reranker. Including all 20 consistently degraded performance.
4. **Memory was structured, not narrative.** Key-value pairs (decisions made, constraints discovered, resources identified) instead of conversation summaries. Fewer tokens, higher retrieval accuracy.

The lesson generalizes: the sophistication of your model matters less than the quality of what you feed it.

---

## What This Means for Your Agents

Context engineering is not a one-time setup task. It is an ongoing discipline — closer to performance engineering than to configuration. The practical starting points:

1. **Audit your current context.** Log the full context window for 100 production requests. Read them. You will find irrelevant content, missing information, and structural problems that are invisible from the code alone.
2. **Implement priority-based assembly.** The code pattern above — budget-aware assembly with explicit priorities — prevents the most common failure mode: important context getting pushed out by less important context.
3. **Measure the three metrics.** Tool selection accuracy, response relevance, and token efficiency. If you don't have these dashboards, you are flying blind.
4. **Iterate on context, not just prompts.** When agent quality drops, resist the urge to tweak the system prompt first. Check whether the right context layers are reaching the model. The system prompt is one layer of six.

Context engineering is the discipline that separates AI agents that impress in demos from agents that perform in production. The model is the engine. The context is the fuel. No amount of horsepower compensates for the wrong octane.

---

*We design context engineering pipelines for production AI agents — the layer between your business systems and the model that determines whether your agent actually works. If you're seeing inconsistent agent performance or want to [quantify the ROI](/blog/ai-roi-calculator/) before investing in context infrastructure, [let's talk](/#contact).*
