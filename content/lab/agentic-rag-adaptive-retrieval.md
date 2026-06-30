---
title: "Agentic RAG: Adaptive Retrieval Patterns That Scale"
date: 2026-06-29
tags: ["RAG", "AI Agents", "LLMs", "Architecture"]
description: "How agentic RAG beats naive pipelines: agent-controlled retrieval, query routing, verify-then-retrieve loops, and guardrails that prevent infinite loops."
author: "Replyant"
---

Naive RAG is a fixed pipeline: embed the query, run a vector search, stuff the top-K chunks into the prompt, and ask the model to answer. It works in demos and fails in production — because it retrieves blindly regardless of whether retrieval is needed, picks one tool regardless of query type, and never checks whether the results are any good. Agentic RAG replaces the fixed pipeline with agent-controlled retrieval: the agent decides *when* to retrieve, *which* tool to use, and *whether* the results are sufficient before generating an answer. That loop is the difference between a retrieval system that scales and one that compounds errors.

---

## What Naive RAG Gets Wrong

The canonical naive RAG pipeline looks like this:

```
query → embed → vector_search(top_k=5) → stuff_into_context → LLM.generate()
```

Three structural problems make this brittle at production scale:

**No retrieval decision.** The pipeline always retrieves, even when the answer is already in the conversation context or the model knows it from training. Unnecessary retrieval burns latency and injects irrelevant documents that degrade answer quality — a problem covered in depth in our [context engineering analysis](/lab/context-engineering/).

**Single retrieval strategy.** Vector search is good at conceptual similarity. It is poor at exact keyword matching, live data lookups, and relationship traversal. A query for "error code ERR_4029" needs BM25 sparse retrieval, not cosine similarity. A query for "current inventory count" needs an API call, not a vector store. A query for "which services depend on module X" needs a graph traversal. Forcing everything through one vector index is the wrong tool for most queries.

**No quality gate.** The pipeline retrieves, inserts, and answers — in that order, with no evaluation step. When retrieved documents are irrelevant, the model either ignores them and answers from training data (hallucination risk) or cites them and produces a confidently wrong answer (worse).

---

## What Agentic RAG Actually Means

### What makes RAG "agentic"?

Agentic RAG gives the language model control over the retrieval process itself. Instead of retrieval being a preprocessing step that always fires with fixed parameters, the agent decides whether to retrieve, selects a retrieval tool based on query type, evaluates the results, and either accepts them or refines the query and re-retrieves. The agent is the driver; the retrieval tools are instruments it operates. This turns retrieval from a fixed pipeline into an adaptive decision loop where each step informs the next.

The 2026 shift toward "context architecture" — treating everything the model sees as engineered information, not passively assembled data — positions agentic RAG as the standard retrieval pattern for production systems. Naive RAG is a retrieval sub-pattern; agentic RAG is a retrieval strategy.

---

## The Query Router: Choosing the Right Retrieval Tool

Before retrieving anything, a well-designed agentic system classifies the query and selects the appropriate retrieval strategy. Four strategies cover the vast majority of production cases:

| Strategy | Best for | Example query |
|---|---|---|
| **Semantic** (dense vector) | Conceptual questions, fuzzy matching | "What is our cancellation policy?" |
| **Keyword** (BM25/sparse) | Exact terms, IDs, product names | "ERR_4029 error in payment module" |
| **API** (live data) | Real-time state, dynamic values | "Current pricing for Enterprise tier" |
| **Graph** (traversal) | Relationship queries, dependency chains | "Which services depend on auth-service?" |

The classifier can be a lightweight LLM call, a fine-tuned embedding model, or a rule-based system for high-confidence patterns. Here is a minimal illustrative router:

```python
import json
from enum import Enum
from dataclasses import dataclass

class RetrievalStrategy(Enum):
    SEMANTIC = "semantic"   # Dense vector — conceptual, fuzzy
    KEYWORD  = "keyword"    # BM25/sparse — exact terms, codes, IDs
    API      = "api"        # Live fetch — prices, inventory, status
    GRAPH    = "graph"      # Traversal — relationships, dependencies

@dataclass
class RetrievalPlan:
    strategy: RetrievalStrategy
    query: str
    filters: dict
    confidence: float

ROUTER_SYSTEM = """Classify this retrieval query. Return JSON with keys:
  strategy: one of semantic|keyword|api|graph
  confidence: float 0.0-1.0
  filters: dict of any filter constraints (date_range, doc_type, etc.)

Rules:
- Use "keyword" for exact product codes, error codes, or named entities
- Use "api" when the answer depends on real-time or mutable data
- Use "graph" for "depends on", "connected to", or "impacts what" queries
- Default to "semantic" for everything else"""

def route_query(query: str, llm) -> RetrievalPlan:
    raw = llm.complete(
        system=ROUTER_SYSTEM,
        user=query,
        response_format={"type": "json_object"},
    )
    parsed = json.loads(raw)
    return RetrievalPlan(
        strategy=RetrievalStrategy(parsed["strategy"]),
        query=query,
        filters=parsed.get("filters", {}),
        confidence=parsed["confidence"],
    )
```

The router feeds the rest of the loop — the selected strategy determines which retrieval tool fires next. Tool definitions for each strategy are what the agent actually calls when retrieval is tool-driven; for the mechanics of how tool descriptions drive selection decisions, see [how tool calling actually works](/lab/anatomy-of-ai-agent-tool-calling/).

---

## The Retrieve → Grade → Re-Retrieve Loop

The core of agentic RAG is a verification loop that runs between retrieval and answer generation. Retrieved documents are graded for relevance; if they fall below the threshold, the agent refines the query and retrieves again.

```python
@dataclass
class RetrievalGrade:
    sufficient: bool
    score: float        # 0.0–1.0 relevance confidence
    feedback: str       # What is missing, to guide re-query

GRADER_SYSTEM = """You are a document relevance grader.
Given a user question and retrieved documents, assess whether the
documents contain enough information to fully answer the question.

Return JSON:
  sufficient: true/false
  score: float 0.0-1.0
  feedback: if not sufficient, what is missing or how to refine the query"""

def grade_retrieval(query: str, docs: list[str], llm) -> RetrievalGrade:
    context = "\n---\n".join(docs[:5])
    raw = llm.complete(
        system=GRADER_SYSTEM,
        user=f"Question: {query}\n\nDocuments:\n{context}",
        response_format={"type": "json_object"},
    )
    return RetrievalGrade(**json.loads(raw))

def agentic_retrieve(
    query: str,
    llm,
    retriever,
    max_iterations: int = 3,
    confidence_threshold: float = 0.75,
) -> list[str]:
    """
    Retrieve → grade → re-retrieve loop with a hard iteration cap.
    Returns best available documents even if the threshold is never met.
    """
    best_docs: list[str] = []
    best_score: float = 0.0
    current_query = query

    for iteration in range(max_iterations):
        plan = route_query(current_query, llm)
        docs = retriever.fetch(plan)

        grade = grade_retrieval(query, docs, llm)

        if grade.score > best_score:
            best_docs, best_score = docs, grade.score

        if grade.sufficient or grade.score >= confidence_threshold:
            return docs   # Good enough — stop here

        # Refine using grader feedback; avoid blind retry
        current_query = (
            f"{query}\n\n"
            f"Previous retrieval was insufficient: {grade.feedback}"
        )

    return best_docs  # Return best attempt after max iterations
```

Several design decisions are load-bearing. The `max_iterations` cap is non-negotiable — without it, a pathological query can loop until the context window fills or the API budget runs out. The `best_docs` fallback ensures the agent always has *something* to work with even when the ideal documents are never found. And passing the grader's `feedback` into the refined query gives the next iteration concrete direction instead of repeating the same search.

---

## Single-Agent vs. Multi-Agent for Multi-Hop Questions

### When does one agent's retrieval loop stop being enough?

Single-agent agentic RAG handles most 1-3 hop questions — questions that require one to three sequential retrievals where each result informs the next query. The retrieve-grade-re-retrieve loop resolves the majority of production use cases without multi-agent overhead. Multi-agent retrieval becomes necessary when retrieval subtasks are genuinely independent and can run in parallel, or when the reasoning between retrieval steps demands a specialist role separate from the retriever.

For multi-hop questions like "What are the compliance requirements for our EU customers based on their contract tier and jurisdiction?", the retrieval plan decomposes into independent branches: contract tier lookup (structured data), jurisdiction rules (regulatory knowledge base), and cross-reference logic. A [parallel fan-out pattern](/lab/multi-agent-systems/) assigns each branch to a dedicated retrieval agent, runs them simultaneously, and passes their combined outputs to a synthesis agent. A three-branch retrieval that takes 4 seconds per branch runs in 4 seconds total instead of 12.

The tradeoff is coordination overhead. Multi-agent retrieval adds orchestration complexity and increases token consumption roughly proportional to the number of agents. The same economics from [multi-agent systems](/lab/multi-agent-systems/) apply: start with a single agent and the retrieval loop, add a second agent only when parallelism or role specialization produces a measurable benefit.

---

## Failure Modes and How to Prevent Them

**Infinite retrieval loops.** The agent never reaches `sufficient = true` because no available document fully answers the question. Without a hard cap, the agent refines and re-retrieves indefinitely. Enforce `max_iterations` at the infrastructure level — a database or API timeout can cause the iteration counter to reset; the cap must be an inviolable guardrail, not just an application-level default.

**Retrieval thrash.** The agent oscillates between strategies — semantic fails, keyword fails, semantic again — making no progress across iterations. Fix: track which strategies have been tried for the current query. On the second failure, expand to a broader index scope or escalate to an API lookup rather than re-entering a tried path.

**Failure to stop.** The grader scores documents as insufficient, but the score creeps toward the threshold without crossing it — 0.62, 0.69, 0.73 — and the agent keeps iterating without a clear stop signal. Fix: add a minimum improvement check. If the score hasn't increased by at least 0.08 between iterations, treat the run as converged and return the best available result.

**Context window saturation.** Each retrieval iteration accumulates results. By iteration 3, the agent's context may contain 15+ documents. Fix: deduplicate across iterations and apply a cross-encoder reranker before passing documents to the answer generator. Include only the top-N by reranker score, not every document retrieved across all iterations.

---

## Evaluation: Measuring Whether It Works

Agentic RAG adds retrieval decision quality to the standard generation quality surface area. Four measurements cover the essential signals, following a RAGAS-style evaluation approach:

**Faithfulness** — does the generated answer contain only claims supported by the retrieved documents? An LLM judge compares claims in the answer against the source documents. Faithful answers cite evidence; unfaithful answers hallucinate. Target: above 0.90 in production.

**Answer relevance** — does the answer actually address the user's question? Distinct from faithfulness — an answer can be faithful to irrelevant documents and still miss the point. Score by embedding the question and answer and measuring cosine similarity between them.

**Context precision** — of the documents retrieved, what fraction were actually useful for generating the answer? Low precision means the router is retrieving too broadly or the grader threshold is set too low.

**Context recall** — did retrieval surface all the information needed to fully answer the question? Requires a ground-truth reference answer to compare against. Low recall means relevant documents exist in the knowledge base but were never found.

Wiring these metrics into your evaluation pipeline from day one is the practice we laid out in our [agent evals and CI/CD framework](/lab/agent-evals-cicd/). Retrieval quality degrades silently as knowledge bases evolve — automated regression tests that track these metrics on a fixed eval set are the mechanism that catches regressions before they reach users.

---

*We architect and build production RAG systems — from query routing and retrieval loop design to evaluation infrastructure and knowledge base management. If your current retrieval pipeline is bottlenecking agent quality or failing to scale, [let's talk](/contact/).*
