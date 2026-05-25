---
title: "A2A Protocol v1.0: Production Patterns for Agents"
date: 2026-05-06
tags: ["AI Agents", "Multi-Agent Systems", "Architecture", "Integration"]
description: "A2A v1.0 ships in April 2026 under the AAIF. Agent Cards, a five-state task lifecycle, and the orchestrator code that ties them together."
author: "Replyant"
---

<aside class="quick-answer">
  <span class="eyebrow">§ Quick Answer</span>
  <p>A2A v1.0 shipped April 23 2026 under the Linux Foundation's Agentic AI Foundation, with a fixed Agent Card discovery URI at <code>/.well-known/agent-card.json</code> and a normative five-state task lifecycle: <code>submitted → working → (input-required ↔ working)* → completed / failed / canceled / rejected</code>. Use A2A for agent-to-agent peer coordination; use MCP for agent-to-tool. Treating <code>rejected</code> as retryable like <code>failed</code> breaks production.</p>
</aside>

MCP gives your agent hands. A2A gives your agents colleagues. That distinction is now load-bearing: on April 23 2026 the Linux Foundation cut [Agent2Agent Protocol v1.0](https://a2aprotocol.ai/) under the newly-formed Agentic AI Foundation (AAIF), the same governance body that took over MCP earlier this spring. The AAIF launch, [announced jointly by OpenAI, Anthropic, Google, Microsoft, AWS, and Block](https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/) with roughly 150 member orgs, settles the political question that has haunted multi-agent infrastructure since 2025: there is now one protocol stack, with one steward, that everyone has staked their roadmap on.

For engineering teams, v1.0 is the first version of A2A you can adopt without flinching. The breaking changes are done. The Agent Card discovery URI is fixed. The five-state task lifecycle is normative. IBM's Agent Communication Protocol (ACP) was [merged into the A2A working group in August 2025](https://auth0.com/blog/mcp-vs-a2a/), so the rivals-aren-protocols era is over. What replaces it is something more useful and more boring: a stable spec, a well-known URL, a typed state machine, and the obligation to actually build for it.

This post is the working code for that build. We will publish an Agent Card, write a Python orchestrator that discovers a worker, posts a task, and tracks the lifecycle through `working` → `input-required` → `completed`. We will compare A2A against [MCP](/lab/anatomy-of-ai-agent-mcp/) and raw HTTP RPC, walk the production gotchas that bite teams in week three, and close on the decision rule for when A2A is the right tool and when it is overkill.

---

## What is A2A and how does it differ from MCP?

A2A is the open protocol for agents to discover, delegate to, and coordinate with other agents over HTTP. MCP standardizes how a single agent connects to tools and data. A2A standardizes how agents work as peers. The two are complementary: an A2A worker typically uses MCP internally to call its tools, then exposes a higher-level capability surface to other agents. v1.0 makes this stack official under the AAIF.

The protocol [originated at Google in April 2025](https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/), was donated to the Linux Foundation in June 2025, absorbed IBM's ACP in August 2025, and reached v1.0 under AAIF stewardship in April 2026. The spec lives at [a2aprotocol.ai](https://a2aprotocol.ai/) and is implemented in SDKs across Python, TypeScript, Go, and Java.

Three primitives carry almost all the weight in the v1.0 spec.

**Agent Cards.** A JSON document published at `https://<host>/.well-known/agent-card.json` that declares the agent's identity, version, endpoint, capabilities, supported task types, and authentication scheme. The well-known URI is fixed by the spec — orchestrators do not need a registry to find an agent, only its hostname. This is the same architectural move as `robots.txt` or `openid-configuration`: a stable discovery contract that does not require a coordination server.

**Tasks.** A2A is task-oriented, not request-response. When an orchestrator delegates work, it creates a Task with a unique ID and a payload. The worker owns the task's state from creation to terminal state, and the orchestrator polls or streams updates. Tasks are stateful by design — they can pause for human input, resume, accumulate intermediate artifacts, and be canceled.

**The lifecycle state machine.** Every task moves through a small, normative set of states: `submitted` → `working` → (`input-required` ↔ `working`)\* → one of `completed` / `failed` / `canceled` / `rejected`. The state machine is the contract. An orchestrator does not have to invent its own — it consumes the worker's state and reacts.

Compare this to where multi-agent systems were a year ago, when [every team was rolling custom JSON over POST](/lab/multi-agent-systems/) with whatever fields they thought to add. A2A v1.0 turns coordination into infrastructure.

---

## What changed in v1.0 and why does AAIF governance matter?

v1.0 froze the discovery URI at `/.well-known/agent-card.json`, made the five-state lifecycle normative, and standardized the streaming envelope on Server-Sent Events. The AAIF, co-founded by OpenAI, Anthropic, Google, Microsoft, AWS, and Block with ~150 member orgs, replaces six competing roadmaps with one. For procurement, this is the signal that A2A is now safe to write into an RFP. For engineering, it means the SDK you adopt today will not be deprecated in six months.

The substantive deltas from v0.x are worth knowing if you have an existing implementation:

- The Agent Card schema was previously published under several non-canonical paths (`/agent.json`, `/.well-known/agent.json`). v1.0 fixes it at `/.well-known/agent-card.json` and requires HTTPS.
- `input-required` is now a first-class state. v0.x implementations sometimes modeled it as a sub-state of `working`, which made human-in-the-loop pauses ambiguous to track.
- The `rejected` terminal state is new in v1.0 and distinct from `failed`. Rejection means the worker refused the task at submission (capability mismatch, auth denial, policy block). Failure means the worker accepted, started work, and could not finish. Mixing the two breaks retry logic — you should retry on `failed`, but never on `rejected`.
- The streaming surface is now SSE-only. v0.x allowed long-polling and WebSocket variants. v1.0 picked one to keep middleware compatible. Polling is still spec-compliant; it just runs over plain `GET /tasks/{id}`.

Why AAIF matters operationally: the foundation publishes a conformance test suite, runs the WG that signs off on spec changes, and provides the legal home for the trademark and the reference SDKs. Three of the cloud hyperscalers and two of the frontier model labs are on the steering committee. If you have ever shipped against a vendor's "open protocol" only to watch it pivot when their commercial strategy changed, the AAIF structure is what prevents that. It is the same pattern that gave us OCI, OpenTelemetry, and CNCF.

---

## The Agent Card

The Agent Card is the only thing an orchestrator needs to discover and call your worker. It is fetched once, cached aggressively, and is the source of truth for what the agent can do. Here is a complete v1.0-conformant card for a worker that does deep research and PDF report generation.

```json
{
  "schema_version": "1.0",
  "name": "research-agent",
  "display_name": "Replyant Research Agent",
  "description": "Conducts deep research and produces structured PDF reports with citations.",
  "version": "2.4.1",
  "endpoint": "https://research.example.com/a2a",
  "documentation_url": "https://research.example.com/docs",
  "provider": {
    "organization": "Replyant",
    "url": "https://replyant.com"
  },
  "capabilities": [
    {
      "name": "deep_research",
      "version": "1.2",
      "description": "Multi-step research with citation tracking. Returns a structured PDF report.",
      "input_modes": ["text/plain", "application/json"],
      "output_modes": ["application/pdf", "application/json"],
      "supports_streaming": true,
      "supports_input_required": true,
      "max_input_tokens": 32000,
      "average_duration_seconds": 180
    },
    {
      "name": "summarize_url",
      "version": "1.0",
      "description": "Summarize a single URL into a one-page brief.",
      "input_modes": ["application/json"],
      "output_modes": ["text/markdown"],
      "supports_streaming": false,
      "supports_input_required": false,
      "average_duration_seconds": 12
    }
  ],
  "supported_task_types": ["research", "summarization"],
  "authentication": {
    "schemes": ["oauth2", "bearer"],
    "oauth2": {
      "authorization_url": "https://auth.example.com/oauth/authorize",
      "token_url": "https://auth.example.com/oauth/token",
      "scopes": ["a2a:research:invoke", "a2a:research:read"]
    }
  },
  "rate_limits": {
    "requests_per_minute": 60,
    "concurrent_tasks": 8
  },
  "extensions": {
    "x-replyant-region": "us-east-1",
    "x-replyant-data-residency": "us"
  }
}
```

A few details that look optional but are not.

**`schema_version`** is mandatory in v1.0. Orchestrators that find a card without it should treat the agent as v0.x and fall back to compatibility mode (or refuse to call it). Without this field, breaking changes in v2 cannot be rolled out cleanly.

**`endpoint`** is the base URL for the A2A API. Tasks are created via `POST {endpoint}/tasks`, fetched via `GET {endpoint}/tasks/{id}`, and streamed via `GET {endpoint}/tasks/{id}/events` with `Accept: text/event-stream`. The card never embeds these full paths — they are derived by the spec.

**`capabilities[].version`** is independent from the agent's overall `version`. This is deliberate: an agent at version 2.4.1 might expose `deep_research@1.2` and `summarize_url@1.0`. Orchestrators should match against capability versions, not agent versions, because that is what protects them from bumps in unrelated capabilities.

**`supports_input_required`** declares whether a capability can pause for human-in-the-loop input. Orchestrators that cannot drive a paused workflow should refuse to invoke a capability with this flag unless they have a fallback path. Marking a long-running research task without this flag is a contract that you will never need a clarifying question — make sure that is true.

**`authentication.schemes`** lists every accepted scheme in preference order. v1.0 requires HTTPS and at least one of `bearer`, `oauth2`, or `mtls`. Anonymous access is not conformant.

---

## A working orchestrator

Here is a self-contained Python orchestrator that discovers an A2A worker, validates capabilities, posts a task, polls the lifecycle, surfaces `input-required` to the caller, and cleanly handles every terminal state. It uses `httpx` and the standard library only — no SDK lock-in. About 130 lines.

```python
# a2a_orchestrator.py

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import httpx

CARD_PATH = "/.well-known/agent-card.json"
TERMINAL_STATES = {"completed", "failed", "canceled", "rejected"}


@dataclass
class TaskResult:
    task_id: str
    state: str
    output: Any | None = None
    error: str | None = None
    artifacts: list[dict] = field(default_factory=list)


class A2AClient:
    def __init__(self, host: str, bearer_token: str, timeout: float = 30.0):
        self.host = host.rstrip("/")
        self.token = bearer_token
        self._card: dict | None = None
        self._client = httpx.AsyncClient(
            timeout=timeout,
            headers={"Authorization": f"Bearer {bearer_token}"},
        )

    async def discover(self) -> dict:
        """Fetch and cache the Agent Card."""
        if self._card is not None:
            return self._card
        url = f"{self.host}{CARD_PATH}"
        r = await self._client.get(url)
        r.raise_for_status()
        card = r.json()
        if card.get("schema_version") != "1.0":
            raise RuntimeError(
                f"Unsupported A2A schema_version: {card.get('schema_version')}"
            )
        self._card = card
        return card

    def _capability(self, name: str, min_version: str) -> dict:
        if not self._card:
            raise RuntimeError("Call discover() first.")
        for cap in self._card.get("capabilities", []):
            if cap["name"] == name and cap["version"] >= min_version:
                return cap
        raise RuntimeError(
            f"Capability {name}>={min_version} not advertised by agent."
        )

    async def submit(
        self,
        capability: str,
        min_version: str,
        payload: dict,
        idempotency_key: str | None = None,
    ) -> str:
        """Create a task. Returns the task id."""
        await self.discover()
        cap = self._capability(capability, min_version)
        endpoint = self._card["endpoint"]
        body = {
            "capability": cap["name"],
            "capability_version": cap["version"],
            "input": payload,
        }
        headers = {
            "Idempotency-Key": idempotency_key or str(uuid.uuid4()),
            "Content-Type": "application/json",
        }
        r = await self._client.post(
            f"{endpoint}/tasks", json=body, headers=headers
        )
        r.raise_for_status()
        return r.json()["task_id"]

    async def get(self, task_id: str) -> dict:
        endpoint = self._card["endpoint"]
        r = await self._client.get(f"{endpoint}/tasks/{task_id}")
        r.raise_for_status()
        return r.json()

    async def respond(self, task_id: str, response: dict) -> None:
        """Resolve an input-required pause."""
        endpoint = self._card["endpoint"]
        r = await self._client.post(
            f"{endpoint}/tasks/{task_id}/messages",
            json={"role": "user", "content": response},
        )
        r.raise_for_status()

    async def cancel(self, task_id: str) -> None:
        endpoint = self._card["endpoint"]
        await self._client.delete(f"{endpoint}/tasks/{task_id}")

    async def aclose(self) -> None:
        await self._client.aclose()


async def run_task(
    client: A2AClient,
    capability: str,
    min_version: str,
    payload: dict,
    on_input_required: Callable[[dict], Awaitable[dict]],
    poll_interval: float = 2.0,
    deadline_seconds: float = 600.0,
) -> TaskResult:
    """Submit a task and drive it to a terminal state."""
    task_id = await client.submit(capability, min_version, payload)
    elapsed = 0.0
    while elapsed < deadline_seconds:
        task = await client.get(task_id)
        state = task["state"]

        if state == "input-required":
            prompt = task.get("pending_input", {})
            user_response = await on_input_required(prompt)
            await client.respond(task_id, user_response)
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            continue

        if state in TERMINAL_STATES:
            return TaskResult(
                task_id=task_id,
                state=state,
                output=task.get("output"),
                error=task.get("error"),
                artifacts=task.get("artifacts", []),
            )

        await asyncio.sleep(poll_interval)
        elapsed += poll_interval

    await client.cancel(task_id)
    return TaskResult(task_id=task_id, state="canceled", error="deadline")
```

A handful of decisions in that code are worth justifying.

**Idempotency keys are sent on every `POST /tasks`.** A2A workers are required by spec to deduplicate task creation by `Idempotency-Key` for at least 24 hours. This is how the orchestrator survives a network blip on the create call without spawning two research jobs and double-billing the user. We will say more on this in the gotchas section.

**The card is fetched once and cached for the life of the client.** v1.0 lets workers set `Cache-Control` on the card response — production code should honor it. For brevity, the example caches in memory for the process lifetime, which is appropriate for a long-running orchestrator that recycles on deploy.

**Capability matching is by `name` and `>=` version.** This is the same pattern semver gives you. If your orchestrator was written against `deep_research@1.0`, it will accept `1.2` because the spec mandates backwards-compatible minor bumps. A `2.0` will not match, which is correct — you want to opt in to breaking changes.

**`input-required` is surfaced via a callback.** The orchestrator does not assume it knows where the human lives. The `on_input_required` hook lets the caller integrate with whatever surface the user is on — a chat UI, an email follow-up, a Slack message, a paused workflow in [the upstream multi-agent system](/lab/multi-agent-systems/). The orchestrator's only job is to drive the lifecycle.

**Deadlines are wall-clock, and the cancel path is real.** A2A workers are obligated to honor `DELETE /tasks/{id}` and transition to `canceled` within 30 seconds. If you do not enforce a deadline, a wedged worker can pin orchestrator coroutines indefinitely.

---

## Streaming as a polling alternative

Polling every two seconds is fine when the worker's average task duration is in the minutes. When it is in the seconds — or when you want push semantics for UI updates — A2A v1.0 gives you Server-Sent Events.

```python
async def stream_task(
    client: A2AClient,
    task_id: str,
    on_event: Callable[[dict], Awaitable[None]],
) -> TaskResult:
    """Subscribe to task events via SSE. Returns when the task reaches a terminal state."""
    endpoint = client._card["endpoint"]
    url = f"{endpoint}/tasks/{task_id}/events"
    async with client._client.stream(
        "GET", url, headers={"Accept": "text/event-stream"}
    ) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:"):
                continue
            event = json.loads(line[5:].strip())
            await on_event(event)
            if event.get("state") in TERMINAL_STATES:
                return TaskResult(
                    task_id=task_id,
                    state=event["state"],
                    output=event.get("output"),
                    error=event.get("error"),
                    artifacts=event.get("artifacts", []),
                )
    raise RuntimeError("SSE stream closed before terminal state.")
```

The event envelope is simple — each event has a `type` (`state_change`, `artifact`, `message`, `progress`), a `state`, and a payload — and the spec requires workers to send a heartbeat every 15 seconds so dead connections fail fast. Production code should layer reconnection with the `Last-Event-ID` header on top, which lets a dropped client resume without missing events.

The HTTP shape, for completeness:

```http
GET /a2a/tasks/9f6e2a91-2c73-4a39-b9e0-6c4d8d1f5b67/events HTTP/1.1
Host: research.example.com
Accept: text/event-stream
Authorization: Bearer eyJhbGciOi...
Last-Event-ID: 42

HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-store

id: 43
event: state_change
data: {"task_id":"9f6e2a91-...","state":"working","progress":0.4}

id: 44
event: artifact
data: {"task_id":"9f6e2a91-...","artifact":{"mime":"application/pdf","ref":"a/77.pdf"}}

id: 45
event: state_change
data: {"task_id":"9f6e2a91-...","state":"completed","output":{"summary":"..."}}
```

When to choose which: poll if your average task duration is over 30 seconds and you do not need fine-grained UI updates. Stream if you do, or if you have many concurrent tasks per orchestrator and the polling overhead matters. Both are spec-compliant. Mixing them within a single client is fine.

---

## Error and rejection handling

The four terminal failure modes are not interchangeable. Treating them as one bucket is the most common design mistake we see in early A2A code.

| Terminal state | What it means | Retry? | Surface to user? |
|---|---|---|---|
| `completed` | Task finished. Read `output` and `artifacts`. | n/a | Yes, with the result. |
| `failed` | Worker started the task and could not finish. Transient or worker-side. | Yes, with backoff. | After retries exhausted. |
| `canceled` | Orchestrator or worker canceled. Often a deadline. | Optionally, with a longer deadline. | Usually yes. |
| `rejected` | Worker refused at submit. Capability mismatch, auth denial, policy block. | No. Fix the request. | Always. |

Concretely:

```python
result = await run_task(client, "deep_research", "1.0", payload, on_input_required)

if result.state == "completed":
    return result.output
if result.state == "failed":
    # Transient. Replay with the same Idempotency-Key for at-most-once.
    raise RetryableError(result.error)
if result.state == "rejected":
    # Permanent. Do not retry.
    raise PermanentError(result.error)
if result.state == "canceled":
    # Could be us (deadline) or them (admin cancel).
    raise TaskCanceled(result.error or "canceled")
```

The `error` field on a non-`completed` state is structured: it carries a `code` (one of a normative set: `capability_mismatch`, `auth_denied`, `policy_block`, `rate_limited`, `internal`, `timeout`, `deadline_exceeded`), a human-readable `message`, and optionally a `retry_after` hint in seconds for `rate_limited`. Use the code, not the message, for branching — messages are not contractual.

A `rejected` state with `code: capability_mismatch` is your signal that the Agent Card cache is stale. Invalidate it and re-discover. We cover this loop in the gotchas.

---

## How does A2A compare to MCP and raw HTTP RPC?

A2A, MCP, and raw HTTP RPC sit at three different layers of the agent stack. MCP standardizes how a single agent calls tools — it assumes a host-server model and request-response semantics. Raw HTTP RPC assumes nothing and gives nothing. A2A standardizes how agents call other agents — it assumes peers, statefulness, and a task lifecycle. Choose by what you are integrating, not by what feels modern.

| Dimension | A2A v1.0 | MCP | Raw HTTP RPC |
|---|---|---|---|
| Topology | Agent-to-agent (peer) | Agent-to-tool (host/server) | Anything-to-anything |
| Discovery | `/.well-known/agent-card.json` | Connection-time `list_tools` | None — out-of-band |
| State model | Stateful tasks with five-state lifecycle | Stateless per-call | Whatever you build |
| Pauses for human input | `input-required` is normative | Not modeled | Custom |
| Long-running ops | Native (minutes to hours) | Awkward — assumes synchronous | Custom |
| Streaming | SSE, normative | Optional, varies by SDK | Custom |
| Auth | OAuth2 / bearer / mTLS, declared in card | OAuth2 supported, often not enforced | Whatever you build |
| Idempotency | `Idempotency-Key` required | Not modeled | Custom |
| Governance | AAIF / Linux Foundation | AAIF / Linux Foundation | None |

The decision rule we use:

- If you are wiring an agent to a database, an API, a search index, or a SaaS tool — that is MCP. The [MCP architecture post](/lab/anatomy-of-ai-agent-mcp/) covers this end to end.
- If you are wiring an agent to *another agent* — one that has its own model, its own context, and does its own reasoning — that is A2A. Especially if the work is asynchronous, multi-turn, or might pause.
- If you are wiring an agent to a *single internal microservice* that you fully control and that is one HTTP call away from a deterministic answer — raw HTTP RPC is fine. Do not adopt A2A for an agent that wraps a `GET /weather`.

The most common mistake is using MCP for inter-agent work, which forces a host/server topology onto a peer relationship and bottlenecks coordination through whichever side hosts the MCP server. The second most common is using A2A for tool calls, which adds a task lifecycle to operations that complete in 50 ms.

For a deeper read on when peer coordination justifies the complexity at all, see [Multi-Agent Systems: Patterns That Work Beyond the Demo](/lab/multi-agent-systems/).

---

## Production gotchas

The four issues below are the ones that consistently bite A2A teams in week three of production — after the demo passes and the load curve catches up.

### Idempotency on task creation

`POST /tasks` is the dangerous call. Every other A2A operation is either read-only or addressed by a known task ID. Task creation is the only place where a network retry can spawn duplicate work — a duplicate research run, a duplicate billing event, a duplicate outbound email.

The spec mandates `Idempotency-Key` deduplication for at least 24 hours, but the orchestrator has to actually send the key. The pattern that works:

```python
idempotency_key = hashlib.sha256(
    f"{user_id}:{capability}:{canonical_payload}".encode()
).hexdigest()
```

Derive the key from the *intent* of the call, not from a random UUID. If the same user requests the same research with the same payload twice in five minutes, that is almost certainly a double-click, and the orchestrator should send the same key both times and let the worker dedupe. Random UUIDs do not protect against the human-double-click failure mode that produces 80% of duplicate tasks.

### Capability discovery cache invalidation

The Agent Card is cacheable and should be cached. It is also stale the moment the worker deploys a new version. The two failure modes are symmetric and both bad: never re-fetching means you call capabilities that have been removed; re-fetching on every task means a single agent burns hundreds of QPS on `/.well-known/agent-card.json` requests.

The pattern: cache the card with the worker's `Cache-Control` TTL (typical: 5 minutes), and *also* invalidate the cache on a `rejected` state with `code: capability_mismatch`. That second trigger covers the case where you are inside a TTL window but the worker has rolled forward. The orchestrator drops the cache, re-fetches, and replays the call against the new capability version. If the capability is genuinely gone — not just renamed — the second submit will reject again, and you escalate as a permanent error.

### Auth boundary between orchestrator and worker

The most underbuilt part of most A2A deployments is the trust boundary between the orchestrator agent and the worker agent. The orchestrator typically runs with elevated privileges — it can talk to many workers, often across teams. The workers should not inherit those privileges.

The right pattern is token exchange. The orchestrator authenticates as itself, then for each task obtains a *downscoped* token bound to (user, capability, task) before calling the worker. The worker only sees the downscoped token and enforces against it. If the orchestrator is compromised, the blast radius is the set of tokens it has freshly minted, not the union of every privilege it ever held.

OAuth2 token exchange (RFC 8693) is the standard mechanism. Most identity providers support it. The card's `authentication.oauth2.scopes` field is where the worker declares which scopes it expects on incoming tokens — the orchestrator should request exactly those scopes and no more. This is the same least-privilege principle from [the agent governance post](/blog/ai-agent-governance/), applied at the inter-agent layer.

### Long-running input-required pauses

A2A's `input-required` state is the protocol's most powerful feature and its most expensive one. A research task can sit in `input-required` for hours waiting for a human to respond to a clarifying question. Three things break if you do not design for that.

First, holding an open SSE stream for hours is fragile — load balancers, proxies, and corporate firewalls will close it. Switch to polling once the task enters `input-required`, and only re-subscribe when the user responds.

Second, `input-required` should have its own timeout, separate from the overall task deadline. A 24-hour `input-required` timeout is reasonable for a research workflow; a 30-second one is reasonable for an interactive chat. The worker enforces this — when the timeout elapses, the task transitions to `failed` with `code: timeout`. The orchestrator's job is to surface the question to the user before the worker times out.

Third, the user-facing surface needs a resume path that does not require the original orchestrator process to be alive. Persist the task ID and the worker host. When the user replies, any orchestrator instance can issue `POST /tasks/{id}/messages` and continue driving the lifecycle.

### Observability across the agent boundary

OpenTelemetry's [GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (stable as of OTel 1.30 in early 2026) define the trace attribute set for agent operations: `gen_ai.system`, `gen_ai.operation.name`, `gen_ai.agent.id`, `gen_ai.task.id`. A2A workers should set these attributes on every span, and the orchestrator should propagate `traceparent` on every HTTP call across the boundary.

When you trace an A2A call end to end, you should see: orchestrator span → A2A `submit` span → worker accept span → worker tool spans (the MCP layer) → state-change events → terminal state. If your dashboard shows half of that, you cannot debug `failed` tasks in production. We treat trace continuity as a launch blocker — the same posture we recommend for [agent CI/CD](/lab/agent-evals-cicd/).

The non-obvious part is propagating context across `input-required` pauses. When the worker emits `input-required`, the active span ends — work is suspended, not running. When the user responds and the orchestrator calls `POST /tasks/{id}/messages`, that resumed work needs to land in the same trace. Persist `traceparent` alongside the task ID at submit, and re-inject it on every resume. Without this, a task that pauses for 30 minutes splits into two unconnected traces and you lose the causal chain.

---

## When to reach for A2A and when not

A2A is a heavy hammer. It earns its weight when the work is asynchronous, multi-turn, or done by a peer with its own reasoning. It is overkill for synchronous tool calls, internal microservices, and most one-shot LLM invocations.

**Reach for A2A when:**

- You are integrating two or more agents that each have their own model, system prompt, and tool surface, and they need to delegate work to each other.
- The delegated work is long-running (over 10 seconds) or might pause for human input.
- The agents are owned by different teams, vendors, or organizations — A2A's standardized contract is exactly the integration boundary.
- You need a stateful task lifecycle that an orchestrator can track without rolling its own state machine.
- You want the option to swap a worker agent for a different vendor's worker agent without rewriting the orchestrator. This is the procurement angle that AAIF governance unlocks.

**Do not reach for A2A when:**

- You are wiring a single agent to its tools — that is [MCP](/lab/anatomy-of-ai-agent-mcp/), and the agent-to-tool topology fits much better.
- The "other agent" is actually a deterministic microservice with no reasoning step. Use raw HTTP and skip the lifecycle.
- The work always completes in under a second and never pauses. The lifecycle overhead does not pay for itself at that latency budget.
- You only have one agent. Adopting A2A "for future flexibility" before you have a second agent is a cost you pay now for an option you may never exercise. Build the first agent on solid foundations — [tool calling](/lab/anatomy-of-ai-agent-tool-calling/), good system prompts, MCP integration — and add A2A when the second agent forces the question.

The honest version of the buy-in case: A2A v1.0 is the right protocol for the inter-agent layer, but most teams do not have an inter-agent layer yet. Adopting it before you need it is a form of resume-driven architecture. Adopting it when you need it is what lets you build agent fleets that compose, are governable, and survive vendor churn — the same compounding posture we argue for in [the multi-agent patterns post](/lab/multi-agent-systems/) and the [defense-in-depth posture in CaMeL](/lab/camel-dual-llm-defense/).

---

## Where this is heading

The 12-month trajectory is a stack: MCP at the tool layer, A2A at the agent layer, both governed by AAIF, both with stable v1.0 specs. The interesting questions move up — how do you compose registries of A2A workers, how do you run capability marketplaces, how do you price inter-agent calls, how do you govern the cross-org trust boundary when the worker agent is operated by a vendor.

For teams building today, the practical sequence is the same one that worked for MCP: pick one inter-agent boundary that is real, model it as an A2A relationship, ship the Agent Card, run the orchestrator code from this post against it, and only then generalize. Building the protocol layer before you have a real coordination problem is how you end up with a beautifully decoupled system that solves a problem you do not have.

We build production multi-agent systems for growing businesses, and we are increasingly building them on A2A. If you are at the point where two agents need to coordinate — across teams, across vendors, or across a human-in-the-loop pause — and you want to do it on the protocol that the AAIF, OpenAI, Anthropic, Google, Microsoft, AWS, and Block have all staked their roadmaps on, [let's talk](/#contact).
