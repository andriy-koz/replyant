---
title: "Anatomy of an AI Agent: How Tool Calling Actually Works"
date: 2026-02-17
description: "A technical breakdown of the tool-calling loop that powers modern AI agents — from prompt design to execution sandboxing."
tags: ["AI Agents", "LLMs", "Architecture", "Tool Calling"]
---

Most explanations of AI agents stop at "the LLM decides which tool to use." That's the easy part. The hard part is everything around it: how you define tools so the model actually picks the right one, how you handle failures mid-chain, and how you keep a stateless model acting like it has memory.

This post breaks down the core loop that powers every agent we build at Replyant.

## The Agent Loop

Every AI agent, regardless of framework, runs the same fundamental cycle:

```
User Input → LLM Reasoning → Tool Selection → Execution → Result Injection → LLM Reasoning → ...
```

The loop continues until the model decides it has enough information to respond, or a hard limit is hit. Simple in theory. The details are where agents succeed or fail.

## Defining Tools the Model Can Actually Use

Tool definitions are the contract between your code and the LLM. A sloppy definition leads to hallucinated parameters and wrong tool picks.

Here's what a well-structured tool definition looks like:

```json
{
  "name": "search_orders",
  "description": "Search customer orders by order ID, email, or date range. Use this when the user asks about a specific order or wants to look up their purchase history.",
  "parameters": {
    "type": "object",
    "properties": {
      "order_id": {
        "type": "string",
        "description": "Exact order ID (e.g. ORD-48291)"
      },
      "email": {
        "type": "string",
        "description": "Customer email address"
      },
      "date_from": {
        "type": "string",
        "description": "Start date in YYYY-MM-DD format"
      },
      "date_to": {
        "type": "string",
        "description": "End date in YYYY-MM-DD format"
      }
    }
  }
}
```

The key details most tutorials skip:

- **The `description` field does the heavy lifting.** The model uses it to decide _when_ to call the tool, not just _what_ it does. "Search customer orders" is worse than "Search customer orders by order ID, email, or date range. Use this when the user asks about a specific order."
- **Parameter descriptions prevent hallucination.** Without `"Exact order ID (e.g. ORD-48291)"`, the model may invent formats.
- **Fewer tools is better.** 5 well-defined tools outperform 20 overlapping ones. The model's accuracy drops as the toolset grows.

## The Execution Layer

The LLM outputs a structured tool call. Your code has to actually run it. This is where sandboxing, validation, and error handling live.

```python
async def execute_tool(call: ToolCall) -> ToolResult:
    handler = TOOL_REGISTRY.get(call.name)
    if not handler:
        return ToolResult(error=f"Unknown tool: {call.name}")

    try:
        validated = handler.schema.parse(call.parameters)
        result = await handler.fn(validated)
        return ToolResult(content=serialize(result))
    except ValidationError as e:
        return ToolResult(error=f"Invalid parameters: {e}")
    except ToolExecutionError as e:
        return ToolResult(error=f"Execution failed: {e}")
```

Critical decisions here:

- **Always validate parameters** before execution. The LLM will occasionally pass malformed data.
- **Return errors to the model, don't crash.** When the agent sees `"Execution failed: order not found"`, it can self-correct and try a different query. If your code throws an unhandled exception, the conversation is dead.
- **Set timeouts.** An agent calling an external API that hangs for 30 seconds creates a terrible user experience.

## Context Window Management

Agents that chain multiple tool calls face a fundamental constraint: every tool result consumes context window. A 10-step agent chain can easily blow past token limits.

Strategies that work in production:

1. **Summarize tool results** before injecting them back. Don't feed 200 rows of JSON into the context — extract what matters.
2. **Sliding window over conversation history.** Keep the system prompt and last N turns, summarize everything older.
3. **Separate retrieval from reasoning.** Use a retrieval step to pull relevant context, then pass only that context to the reasoning step.

## Where Most Agent Architectures Break

After deploying 50+ agents across different use cases, the failure patterns are consistent:

- **Tool sprawl.** Adding tools is easy. The model picking the right one from 30 options is not.
- **No error recovery.** The agent calls a tool, it fails, and the agent either retries the same thing forever or gives up.
- **Treating the LLM as deterministic.** The same input can produce different tool calls. Your execution layer needs to handle this gracefully.
- **Ignoring latency.** Each tool call is a round trip. An agent that chains 8 calls with 2-second API calls each takes 16+ seconds to respond.

## What's Next

In upcoming posts, we'll go deeper on specific components:

- **[MCP integration](/lab/anatomy-of-ai-agent-mcp/)** — how the Model Context Protocol connects agents to your business systems
- **[Claude Code in production](/lab/claude-code-in-production/)** — how hooks, plugins, MCP servers, and skills turn a generic coding agent into a governed development workflow
- **RAG pipelines** — how to build retrieval that actually improves agent accuracy
- **Multi-agent orchestration** — when one agent isn't enough
- **Evaluation and testing** — how to measure whether your agent is getting better or worse

---

*We build production AI agents for businesses dealing with these exact challenges. If you're evaluating whether a custom agent makes sense for your team, [start with the ROI framework](/blog/ai-roi-calculator/) — the technical architecture only matters if the business case is solid.*
