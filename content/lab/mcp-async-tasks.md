---
title: "MCP Tasks: Async, Resumable Tool Calls Before the July 28 Spec"
date: 2026-05-24
tags: ["MCP", "Architecture", "Developer Tools", "Tool Calling"]
description: "MCP's 2026-07-28 release candidate locked on May 21. Tasks graduated to a first-class extension. Here is what every server author has 10 weeks to refactor."
author: "Replyant"
---

On May 21 2026 the MCP working group [locked the 2026-07-28 release candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) — the largest revision of the protocol since launch. Two things in that RC matter to every server author shipping into production today. First, the `initialize` / `initialized` handshake and the `Mcp-Session-Id` header are gone — the core is stateless, and any request can land on any server instance. Second, async work has graduated from the `2025-11-25` experimental Tasks API into a first-class extension at `io.modelcontextprotocol/tasks`, with `tasks/get`, `tasks/update`, and `tasks/cancel` as normative methods. You have until July 28 to validate against real workloads.

If you ignore the RC and ship a synchronous-only MCP server in August, your long-running tools will time out behind any modern host that imposes a request budget. If you keep using the experimental Tasks API as built against `2025-11-25`, your server will silently break against `2026-07-28` clients because the lifecycle changed. If your deployment depends on session affinity, your horizontal-scaling story stops working the day a host adopts the stateless core. None of these are theoretical — they are what happens when the RC becomes the spec on July 28.

This post is the working guide for that refactor. We will read the actual RC text, walk the Task lifecycle end to end, migrate a 30-minute ETL tool from synchronous `tools/call` to an async Task with code on both sides, and cover the production gotchas — idempotency, TTL, cancellation, partial results, observability — that bite teams in the first week after the cutover. Then we will draw the decision boundary between Tasks, plain `tools/call`, and [A2A delegation](/lab/a2a-protocol-v1-production/), which carries its own normative task lifecycle and overlaps with Tasks in non-obvious ways.

If you are new to MCP, start with the foundational write-up of how hosts, clients, servers, and JSON-RPC fit together: [Anatomy of an AI Agent: How MCP Connects Your Systems](/lab/anatomy-of-ai-agent-mcp/). The rest of this post assumes that vocabulary.

---

## What actually changed in the 2026-07-28 RC?

The RC reorganises the protocol along three axes: a stateless core, a formal extensions framework, and the graduation of Tasks. Each axis is independently breaking, and all three land together.

**Stateless core.** The `initialize` / `initialized` handshake is removed. The `Mcp-Session-Id` header is removed. Client info and per-request client capabilities now travel in a `_meta` envelope on every request. The motivation is operational: "any MCP request can land on any server instance," which eliminates sticky sessions and shared session stores. Servers no longer remember who you are between calls — every call brings its own context.

**Extensions framework.** Optional features now live outside the core spec under reverse-DNS extension IDs, negotiated through an `extensions` map on client and server capabilities. The RC's deprecation policy commits to at least twelve months between deprecation and the earliest possible removal of any feature, including extensions. This is what makes it safe to depend on Tasks in production code today — even if the extension iterates, you get a year of warning before a method goes away.

**Tasks graduated.** Tasks were experimental in `2025-11-25` and are an extension in `2026-07-28`. The official rationale: "production use surfaced enough redesign that the right home for it is an extension rather than the specification." Translation — the working group learned that async lifecycle decisions are best made independently of the core protocol's release train, so Tasks now version on their own and ship their own implementation guides at [modelcontextprotocol.io/extensions/tasks/overview](https://modelcontextprotocol.io/extensions/tasks/overview).

Three methods are normative for clients that opt in:

| Method          | Direction       | Purpose                                                                |
| --------------- | --------------- | ---------------------------------------------------------------------- |
| `tasks/get`     | client → server | Poll for the current Task state. Returns the full Task object.         |
| `tasks/update`  | client → server | Submit responses to `inputRequests` while the task is `input_required`. |
| `tasks/cancel`  | client → server | Request cooperative cancellation. The server acknowledges but may not stop. |

A separate `notifications/tasks/status` push channel exists for servers that support it and clients that opt into `subscriptions/listen`. Polling is the default; subscription is an optimisation.

The new lifecycle states are five: `working`, `input_required`, `completed`, `failed`, `cancelled`. The last three are terminal — once reached, the task's status never changes again. This is the contract a client can rely on for cleanup, retry, and idempotency logic.

---

## Why does this matter in the next 10 weeks?

The 10-week window between RC lock (May 21) and final release (July 28) is a validation pass, not a draft period. The breaking changes are baked. Anyone who shipped against the `2025-11-25` experimental Tasks API needs to migrate to the new method shapes. Anyone who built their deployment on session-affine MCP servers needs to refactor for statelessness or accept that the next generation of hosts will not route to them reliably.

The fail modes are stark:

- **Synchronous-only servers on long-running tools.** A 30-minute ETL exposed as a single `tools/call` returns a result that no production host will wait for. Most hosts cap request budgets at 30–60 seconds. Without Tasks, the client sees a timeout, retries, and you run the ETL three times.
- **Stateful sessions behind a load balancer.** A multi-replica MCP server that relies on `Mcp-Session-Id` for routing breaks the moment a stateless client load-balances `tasks/get` to a different replica than the one that created the task. Tasks have to be durable across replicas — which is fundamentally easier when the protocol forbids per-connection state in the first place.
- **Old experimental Tasks API.** Servers built against the `2025-11-25` experimental schema will respond with results clients no longer understand. The migration is small but mandatory.

The boring news inside the urgency: most teams' Tasks migration is a one-day refactor. We will walk through it.

---

## How does the Tasks lifecycle differ from plain `tools/call`?

A plain `tools/call` is request-response — the client sends a JSON-RPC request, the server does work, the server returns a result. The client blocks on a single round-trip. This is fine for sub-second tool calls (database queries, API lookups, file reads) and terrible for everything else.

A task-augmented `tools/call` returns a Task handle instead of a final result. The client now drives the lifecycle through `tasks/get` polls until a terminal state is reached, and then either reads `result` (on `completed`) or `error` (on `failed`). The handle is durable — if the client process dies and restarts, it can resume polling with the same `taskId`. The connection is not.

Here is the wire-level shape. The client opts in to Tasks once via per-request capabilities in `_meta`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "run_etl",
    "arguments": { "source": "s3://acme/q2-orders/", "target": "warehouse.orders_q2" },
    "_meta": {
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": {
          "io.modelcontextprotocol/tasks": {}
        }
      }
    }
  }
}
```

The server inspects the per-request capabilities and decides — per call — whether to answer with a normal result or a `CreateTaskResult`. Task creation is server-directed. Clients do not flag individual tool calls as async; they declare they can *handle* an async response, and the server chooses when to use that affordance.

A `CreateTaskResult` looks like this (the canonical example from the spec):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "task",
    "task": {
      "taskId": "786512e2-9e0d-44bd-8f29-789f320fe840",
      "status": "working",
      "statusMessage": "Loading source manifest...",
      "createdAt": "2026-05-24T10:30:00Z",
      "lastUpdatedAt": "2026-05-24T10:30:00Z",
      "ttlMs": 3600000,
      "pollIntervalMs": 5000
    }
  }
}
```

The `resultType: "task"` discriminator is how a client tells a normal result from a Task handle. Any client supporting the extension must branch on this field. The `ttlMs` is the lifetime the server promises to retain the task and its result after creation; the `pollIntervalMs` is the server's recommended poll cadence — clients should respect it to avoid hammering.

Polling looks like:

```json
{ "jsonrpc": "2.0", "id": 7, "method": "tasks/get", "params": { "taskId": "786512e2-..." } }
```

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": {
    "taskId": "786512e2-...",
    "status": "working",
    "statusMessage": "Transformed 412,318 / ~1.2M rows",
    "lastUpdatedAt": "2026-05-24T10:42:13Z",
    "ttlMs": 3600000,
    "pollIntervalMs": 5000
  }
}
```

On completion, the Task carries the result inline:

```json
{
  "jsonrpc": "2.0",
  "id": 12,
  "result": {
    "taskId": "786512e2-...",
    "status": "completed",
    "lastUpdatedAt": "2026-05-24T10:58:02Z",
    "result": {
      "content": [
        { "type": "text", "text": "Loaded 1,204,773 rows into warehouse.orders_q2 in 1683s." }
      ]
    }
  }
}
```

The state transitions are exhaustively defined:

```
                  ┌──────────────┐
                  │   working    │◀──┐
                  └──────┬───────┘   │
                         │           │
            ┌────────────┼──────┐    │
            ▼            ▼      ▼    │
   ┌──────────────┐ ┌──────┐ ┌───────┴────────┐
   │  completed   │ │failed│ │ input_required │
   └──────────────┘ └──────┘ └────────────────┘
       (terminal)  (terminal)        │
                                     ▼ tasks/update
                                  working

   ┌──────────────┐
   │  cancelled   │   (reachable from working or input_required)
   └──────────────┘
       (terminal)
```

Three rules to internalise. First, terminal means terminal — `completed`, `failed`, and `cancelled` never transition again, so client cleanup logic is safe to fire on entry. Second, `input_required` is bidirectional with `working`; a task can pause for input, receive `tasks/update`, and resume work. Third, `cancelled` is cooperative — a `tasks/cancel` is a request, not a kill signal. The server may finish the job and return `completed` if cancellation arrives too late, and that is spec-compliant.

---

## A worked migration: synchronous ETL to async Task

Here is a representative pre-Tasks server using FastMCP, exposing a `run_etl` tool that blocks for up to 30 minutes. This is the kind of code that will silently break against any host with a 60-second request budget.

```python
# server_v1_sync.py
# DO NOT SHIP THIS AGAINST A 2026-07-28 CLIENT WITH A LONG-RUNNING TOOL.
from fastmcp import FastMCP

mcp = FastMCP("etl-server")

@mcp.tool()
async def run_etl(source: str, target: str) -> str:
    """Load source data into target table. Synchronous, blocking."""
    manifest = await load_manifest(source)
    rows_loaded = 0
    for batch in stream_batches(manifest):
        transformed = transform(batch)
        await write_batch(target, transformed)
        rows_loaded += len(transformed)
    return f"Loaded {rows_loaded} rows into {target}."

if __name__ == "__main__":
    mcp.run()
```

Three problems jump out. The tool can run for 30 minutes inside a single JSON-RPC call. The connection has to stay open the whole time — any LB, proxy, or host timeout aborts it. The client gets nothing if the connection drops at minute 28. There is no observability hook for progress, no cancellation path, no way to resume after a crash.

The Tasks rewrite preserves the business logic but inverts the control flow. The tool returns a Task handle immediately; the heavy work happens in a background coroutine that updates persisted state; the server answers `tasks/get` from that state. Here is the migration, written against the FastMCP `task=True` decorator and a small in-process store. In production you replace the store with Redis, Postgres, or whatever already backs your durable state.

```python
# server_v2_tasks.py
# 2026-07-28 RC-compliant: returns a CreateTaskResult, drives the lifecycle
# through tasks/get and tasks/cancel, survives client disconnects.
import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastmcp import FastMCP, Progress, TaskConfig

mcp = FastMCP("etl-server")


@dataclass
class TaskRecord:
    task_id: str
    status: str = "working"  # working | input_required | completed | failed | cancelled
    status_message: str = ""
    created_at: float = field(default_factory=time.time)
    last_updated_at: float = field(default_factory=time.time)
    ttl_ms: int = 3_600_000          # 1 hour result retention
    poll_interval_ms: int = 5_000
    result: dict | None = None
    error: dict | None = None
    cancel_requested: bool = False


# Replace with Redis or Postgres for multi-replica deployments.
TASKS: dict[str, TaskRecord] = {}


def _touch(record: TaskRecord, status: str | None = None, message: str | None = None) -> None:
    if status is not None:
        record.status = status
    if message is not None:
        record.status_message = message
    record.last_updated_at = time.time()


async def _run_etl_body(record: TaskRecord, source: str, target: str) -> None:
    """The actual work, driven off the persisted record so it can be observed."""
    try:
        manifest = await load_manifest(source)
        total = manifest["row_estimate"]
        rows_loaded = 0
        async for batch in stream_batches(manifest):
            if record.cancel_requested:
                _touch(record, "cancelled", f"Cancelled after {rows_loaded} rows.")
                return
            transformed = transform(batch)
            await write_batch(target, transformed)
            rows_loaded += len(transformed)
            _touch(record, message=f"Transformed {rows_loaded} / ~{total} rows")
        record.result = {
            "content": [
                {"type": "text", "text": f"Loaded {rows_loaded} rows into {target}."}
            ],
            "structuredContent": {"rows_loaded": rows_loaded, "target": target},
        }
        _touch(record, "completed", "ETL complete.")
    except Exception as exc:  # noqa: BLE001
        record.error = {"code": -32000, "message": str(exc), "data": {"target": target}}
        _touch(record, "failed", f"ETL failed: {exc}")


@mcp.tool(task=TaskConfig(mode="required", ttl_ms=3_600_000, poll_interval_ms=5_000))
async def run_etl(source: str, target: str, progress: Progress = Progress()) -> str:
    """Load source data into target table. Returns a Task handle immediately."""
    task_id = str(uuid.uuid4())
    record = TaskRecord(task_id=task_id, status_message="Loading source manifest...")
    TASKS[task_id] = record
    # Fire-and-track the body; the framework wires this into CreateTaskResult.
    asyncio.create_task(_run_etl_body(record, source, target))
    # The framework reads TASKS via the handlers below.
    return task_id


@mcp.task_get_handler()
async def get_task(task_id: str) -> dict:
    record = TASKS.get(task_id)
    if record is None:
        raise LookupError(f"Unknown task: {task_id}")
    payload: dict[str, Any] = {
        "taskId": record.task_id,
        "status": record.status,
        "statusMessage": record.status_message,
        "createdAt": record.created_at,
        "lastUpdatedAt": record.last_updated_at,
        "ttlMs": record.ttl_ms,
        "pollIntervalMs": record.poll_interval_ms,
    }
    if record.status == "completed" and record.result is not None:
        payload["result"] = record.result
    if record.status == "failed" and record.error is not None:
        payload["error"] = record.error
    return payload


@mcp.task_cancel_handler()
async def cancel_task(task_id: str) -> dict:
    record = TASKS.get(task_id)
    if record is None:
        raise LookupError(f"Unknown task: {task_id}")
    if record.status in {"completed", "failed", "cancelled"}:
        return {}  # Terminal — cancel is a no-op, not an error.
    record.cancel_requested = True
    return {}


if __name__ == "__main__":
    mcp.run()
```

A handful of decisions deserve their justification.

**The Task record is the source of truth, not the coroutine.** Status, progress text, and result all live on `TaskRecord`. The coroutine writes the record; `tasks/get` reads it. This means a different worker replica answering the poll can serve a faithful state even though it is not running the ETL — exactly the property the stateless core demands.

**`asyncio.create_task` is for clarity, not production.** A real implementation moves the body onto a durable queue (Celery, RQ, Cloud Tasks, or your platform's equivalent) so a server restart does not lose in-flight ETLs. The record store moves to Redis or Postgres for the same reason. The shape of the handlers does not change.

**Cancellation is checked at batch boundaries.** This is the cooperative-cancellation pattern the RC requires — set a flag, let the worker notice at safe checkpoints, transition to `cancelled` when work actually stops. Hard-killing a coroutine mid-write to a warehouse is how you corrupt tables.

**`ttlMs` is one hour because that matches the work.** Pick a TTL longer than the worst-case completion plus the longest reasonable time between client polls. If the task takes up to 30 minutes and a client might be offline for 20 minutes between polls, an hour is conservative. Too short and the client comes back to a 404; too long and you waste storage on stale results.

On the client side, the consumer of this server looks like this — a small driver that opts into Tasks, branches on `resultType`, and polls to terminal:

```python
# client.py
import asyncio
import json
from typing import Any

import httpx

TASKS_CAPABILITIES = {
    "_meta": {
        "io.modelcontextprotocol/clientCapabilities": {
            "extensions": {"io.modelcontextprotocol/tasks": {}}
        }
    }
}
TERMINAL = {"completed", "failed", "cancelled"}


async def call_with_tasks(
    http: httpx.AsyncClient,
    endpoint: str,
    tool: str,
    arguments: dict[str, Any],
    deadline_seconds: float = 7200.0,
) -> dict:
    params = {"name": tool, "arguments": arguments, **TASKS_CAPABILITIES}
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": params}
    resp = (await http.post(endpoint, json=body)).json()
    result = resp["result"]

    # Branch on the discriminator.
    if result.get("resultType") != "task":
        return result  # Synchronous result — server chose not to use Tasks.

    task = result["task"]
    task_id = task["taskId"]
    poll_ms = task.get("pollIntervalMs", 5000)
    elapsed = 0.0

    while elapsed < deadline_seconds:
        await asyncio.sleep(poll_ms / 1000.0)
        elapsed += poll_ms / 1000.0
        get_body = {"jsonrpc": "2.0", "id": 2, "method": "tasks/get",
                    "params": {"taskId": task_id, **TASKS_CAPABILITIES}}
        task = (await http.post(endpoint, json=get_body)).json()["result"]
        poll_ms = task.get("pollIntervalMs", poll_ms)
        if task["status"] in TERMINAL:
            break
    else:
        # Deadline hit — issue a cooperative cancel and return what we have.
        cancel_body = {"jsonrpc": "2.0", "id": 3, "method": "tasks/cancel",
                       "params": {"taskId": task_id}}
        await http.post(endpoint, json=cancel_body)

    if task["status"] == "completed":
        return task["result"]
    if task["status"] == "failed":
        raise RuntimeError(task["error"])
    raise RuntimeError(f"Task ended in {task['status']}")
```

The client never assumes the response shape. Every supported call is "either a normal result or a task" — the same code path handles both. That is the only correct way to consume a Tasks-capable server, because the *server* chooses whether to escalate to a task based on factors the client cannot see (current load, estimated work, configuration).

---

## Polling vs subscription, and resuming after disconnect

Polling is the default and the safest path. The server hands the client a `pollIntervalMs` it considers reasonable; the client respects it. If the work is bursty, the server can shrink the interval on subsequent `tasks/get` responses to give the client tighter status updates; if the work is steady, it can lengthen it. This back-pressure is built into the protocol — no out-of-band negotiation needed.

Subscription via `notifications/tasks/status` is the optimisation. When a client opts in through `subscriptions/listen`, the server pushes a complete Task object on every status change. The client gets sub-second responsiveness without burning CPU on poll loops, and the server saves the round-trip cost. The tradeoff is connection longevity — push channels need a live connection, and not every transport (or every corporate firewall) tolerates long-lived ones.

The pragmatic posture, which matches what we have shipped in production: poll by default with the server-suggested interval, subscribe when the host explicitly wants real-time UI updates (chat windows, dashboards), and always have the polling code path live as the resume mechanism after a subscription drops.

**Resumption after disconnect** is one of the genuinely new affordances Tasks unlock. The task ID is the durable handle. If a client process restarts, it can persist `taskId` and `endpoint` and resume polling on the next boot. If a server replica dies, a different replica reading from the shared task store can answer the poll. If the underlying job runner restarts, that is your problem to solve — but the protocol stays consistent.

The pattern we use:

```python
# resume.py
import json
from pathlib import Path

STATE = Path("/var/lib/agent/inflight_tasks.json")

def persist(task_id: str, endpoint: str, intent: dict) -> None:
    inflight = json.loads(STATE.read_text()) if STATE.exists() else {}
    inflight[task_id] = {"endpoint": endpoint, "intent": intent, "started_at": time.time()}
    STATE.write_text(json.dumps(inflight))

def clear(task_id: str) -> None:
    inflight = json.loads(STATE.read_text())
    inflight.pop(task_id, None)
    STATE.write_text(json.dumps(inflight))
```

Persist before you poll; clear on terminal. On boot, walk the file and resume polling on every entry not past its `ttlMs`. The same pattern works for [agent CI/CD harnesses](/lab/agent-evals-cicd/) — durability at the harness layer turns "agent crashed mid-task" from a data-loss incident into a 200ms delay.

---

## Why does statelessness change the deployment shape so much?

The pre-RC MCP core required an `initialize` handshake and an `Mcp-Session-Id` header. Every subsequent request from a client carried that session ID, and a server was free to maintain per-session state in memory. This is the shape every web framework prefers — keep a connection-scoped object, look things up there, move on. It is also the shape that breaks the moment you put more than one replica behind a load balancer.

Either you make the load balancer sticky (every request from session X goes to replica A), or you share the session store (every replica reads session X's state from Redis), or you do not scale. Sticky routing is brittle — replica A dies, session X dies. Shared stores are operational complexity that grows with concurrent users. Neither is ergonomic.

The 2026-07-28 RC eliminates the choice by eliminating the session. Client info and per-request capabilities ride in `_meta` on every request. Any request from any client can land on any replica, and that replica has everything it needs to serve it. Routing becomes round-robin or least-loaded; replacements become hitless; auto-scaling becomes meaningful. This is the same lesson Kubernetes learned about pods — stateless is simpler, more resilient, and cheaper to operate at scale.

For Tasks, statelessness has a sharper consequence: the task store *must* be durable and shared across replicas. The replica that created the task is almost certainly not the replica answering the `tasks/get` poll three seconds later. This is why the worked example above puts the record in `TASKS` for clarity but pushes you toward Redis or Postgres for anything real. A task that exists only in one replica's memory is a task that disappears when that replica recycles — which, in any modern deployment, happens every few hours.

The 30-second version of the deployment shift:

```
Pre-RC (stateful, sticky):                  2026-07-28 (stateless, durable tasks):

    [client]                                   [client]
       │                                          │
       │ Mcp-Session-Id: abc                      │ _meta carries everything
       ▼                                          ▼
  ┌─────────┐                              ┌─────────────┐
  │  ALB    │ sticky to replica A          │  ALB        │ round-robin
  └────┬────┘                              └──┬───┬───┬──┘
       │                                      │   │   │
       ▼                                      ▼   ▼   ▼
   replica A ─ in-mem session state       replica A│B│C
                                                 │ │ │
                                                 ▼ ▼ ▼
                                          ┌─────────────────┐
                                          │  task store     │
                                          │  (redis/pg)     │
                                          └─────────────────┘
```

If you already run MCP servers behind a load balancer with shared session storage, the refactor is mostly cosmetic — your store becomes the task store, and your handlers stop reading session headers. If you run a single replica, you finally have the option to scale horizontally without rewriting your transport.

---

## Production gotchas

Five failure modes consistently bite teams in the first two weeks after a Tasks rollout. None are obvious from the spec text; all are obvious in production logs.

### 1. Idempotency on task creation

The dangerous call is the one that creates the task. Every subsequent operation is addressed by `taskId`, but the creation `tools/call` is the spot where a network blip + client retry produces *two* tasks. For a 30-minute ETL, that is two full loads into the warehouse — potentially with duplicate rows, certainly with duplicate cost.

The fix is to derive an idempotency key from the *intent* of the call and check it server-side before creating the record. The simplest version:

```python
import hashlib

def intent_key(user_id: str, tool: str, args: dict) -> str:
    canonical = json.dumps({"u": user_id, "t": tool, "a": args}, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()

# In the tool body, before create_task:
key = intent_key(caller_user_id, "run_etl", {"source": source, "target": target})
existing = await TASKS_BY_KEY.get(key, since=now() - 600)  # 10-minute window
if existing:
    return existing.task_id
```

A 10-minute dedup window catches the human-double-click and the retry-after-LB-blip patterns without forcing users to wait 24 hours to re-run a genuinely new ETL. We cover the same pattern in the [A2A protocol post](/lab/a2a-protocol-v1-production/) — the lesson generalises to any task-creating endpoint.

### 2. TTL too short or too long

`ttlMs` is the promise the server makes about how long the task and its result will be retained. Get it wrong in either direction and you fail predictably.

- **Too short**: a client that polls every 5s but whose process dies for 20 minutes comes back to a 404. You destroyed evidence the client was relying on.
- **Too long**: a server with 100k tasks/day and a 7-day TTL holds 700k records in its store at any moment, most of which are completed and unread.

The rule: `ttlMs ≥ worst_case_runtime + worst_case_client_offline_window + a margin`. For interactive tasks, 1 hour. For overnight ETLs, 24 hours. For agent-driven background work where the agent might restart, at least 4 hours. Pick once, set it on the server, surface it in the response, and document it for clients.

### 3. Cancellation is cooperative — and that surprises everyone

`tasks/cancel` is a request, not a kill. The server acknowledges with an empty result and *may* transition the task to `cancelled` — or may finish the job and return `completed` if cancellation arrived too late, or may transition to `failed` if cancellation surfaced an error. All three are spec-compliant.

What this means at the client layer: never assume `tasks/cancel` succeeded just because the HTTP call returned 200. Always poll one more time after cancel to read the actual terminal state. The pattern:

```python
await http.post(endpoint, json=cancel_body)
final = (await http.post(endpoint, json=get_body)).json()["result"]
# final["status"] could be cancelled OR completed OR failed.
```

This is also the right place to fail loudly in your observability. A high rate of "cancelled-but-server-finished" tasks means your client deadlines are too tight, and you are wasting work the server has already done.

### 4. Partial results and the absent-by-default contract

A failed task can carry partial work. A 30-minute ETL that crashes at minute 27 has 90% of the data loaded. The Task object's `error` field has details, but the spec does not normatively carry "partial result alongside error." If you want clients to surface partial work on `failed`, you have to put it somewhere the spec accommodates — the standard place is `statusMessage` for human-readable summaries and `_meta` for structured data.

We use:

```python
record.error = {
    "code": -32000,
    "message": "Network timeout writing to warehouse.",
    "data": {
        "partial_rows_loaded": 1_087_421,
        "checkpoint_id": "ckpt-2026-05-24T10:55Z",
        "resumable": True,
    },
}
```

This gives the client enough to decide whether to retry-from-checkpoint or report-and-give-up, which is exactly the choice it needs to make. The alternative — silent loss of 27 minutes of work — is what your users will remember.

### 5. Observability across the async boundary

`tools/call` traces are simple — one span, one parent. Tasks are not. The natural trace shape spans three intervals: creation, the poll loop, and the body's work. The body usually runs on a queue worker that is a different process from the request handler. If you do not stitch these together, you get three orphan trace fragments and zero ability to debug `failed` tasks.

The RC bakes in the propagation primitive: `_meta` carries [W3C Trace Context](https://www.w3.org/TR/trace-context/) keys (`traceparent`, `tracestate`, `baggage`) on every request. The pattern that works:

- On `tools/call` that creates a task, read `traceparent` from `_meta`, persist it on the Task record, and continue the trace on the queue worker.
- On every `tasks/get`, start a span with the persisted `traceparent` as parent. The poll loop becomes a sequence of short sibling spans under the original `tools/call` span.
- On terminal transition, emit a span event with the final status.

This is the same trace continuity discipline we treat as a launch blocker for [agent evals CI/CD](/lab/agent-evals-cicd/) and for [A2A](/lab/a2a-protocol-v1-production/). The pattern is identical across both async protocols because the underlying problem is identical: long-running work, multiple processes, one logical trace.

---

## Tasks vs plain `tools/call` vs A2A delegation

These three look alike from a distance and serve different roles up close. Pick by what is doing the work, not by what is newest.

| Dimension                  | Plain `tools/call`        | MCP Tasks                              | A2A delegation                           |
| -------------------------- | ------------------------- | -------------------------------------- | ---------------------------------------- |
| Topology                   | Agent → tool              | Agent → tool                           | Agent → agent (peer)                     |
| Latency target             | < 1s                      | seconds to hours                       | seconds to hours                         |
| State                      | Stateless                 | Server-side, durable                   | Server-side, durable                     |
| Cancellation               | Best-effort               | Cooperative, normative                 | Cooperative, normative                   |
| Human-in-the-loop pause    | Not modeled               | `input_required` is normative          | `input-required` is normative            |
| Result retention           | None                      | `ttlMs`, server-defined                | Worker-defined                           |
| Discovery                  | `tools/list`              | `tools/list` + tasks capability        | `/.well-known/agent-card.json`           |
| Governance                 | AAIF                      | AAIF (extension track)                 | AAIF                                     |

The decision rules we use:

- **Plain `tools/call`** for any tool that completes in under a second. Reading a row, calling an API, generating a short string. The lifecycle overhead is not worth it.
- **MCP Tasks** for long-running tool work where *your server* knows how to do the job. ETLs, batch processing, document generation, long search jobs, multi-step API workflows.
- **A2A delegation** for work that should be done by *another agent* with its own model and reasoning. If the worker needs to think — not just execute — that is A2A. If the worker is owned by a different team or vendor, it is almost certainly A2A.

The common error is using Tasks for work that should be A2A. If your "long-running tool" is actually invoking another LLM to make decisions, you have an agent inside your tool — and you should expose that agent as an A2A worker so other agents can call it directly. The reverse error is using A2A for plain function calls; if your "worker agent" is just a deterministic microservice, [raw HTTP RPC is fine](/lab/multi-agent-systems/) and the lifecycle is overhead.

The relationship between MCP Tasks and A2A tasks is worth naming: their state machines were designed in coordination, and the naming overlap is intentional. Both have `working`, `input_required`/`input-required`, and a small set of terminal states. The semantic differences are real (A2A adds `rejected` for capability-mismatch rejection at submit, MCP folds that into `failed`), but a host that knows how to drive one knows how to drive the other. This is by design — the stack is converging.

---

## A migration checklist

If you maintain an MCP server today, you have a 10-week window. Work this list in order.

1. **Audit your tools by P95 latency.** Anything over 5s is a Tasks candidate. Anything over 30s is a Tasks must-have.
2. **Stand up a durable task store** — Redis or Postgres are fine. Schema: `(task_id, status, status_message, created_at, last_updated_at, ttl_ms, poll_interval_ms, result_json, error_json, idempotency_key, traceparent)`.
3. **Move the work off the request thread.** Queue it (Celery, RQ, Cloud Tasks, Sidekiq). The request handler creates the task record and queues the work; the worker updates the record.
4. **Implement the three handlers** — `tasks/get`, `tasks/update`, `tasks/cancel` — reading from the task store. Make `tasks/cancel` a flag, not a kill.
5. **Add the `io.modelcontextprotocol/tasks` extension** to your `server/discover` capabilities. Read per-request `_meta` for client opt-in; only return `CreateTaskResult` when the client declared support.
6. **Wire up idempotency keys** derived from caller + intent. 10-minute dedup window.
7. **Propagate `traceparent` from `_meta`** through the task record onto the worker spans. Verify the trace renders end-to-end in your observability tool.
8. **Remove the `initialize`/`initialized` handshake and `Mcp-Session-Id` reads** from your transport. Switch any in-memory session state to per-request reads from `_meta`.
9. **Test against the RC** — point one of your servers at the RC client SDK in staging and run your existing tool battery. Anything that timed out before should now return a task; anything that completed in milliseconds should still return synchronously.
10. **Document the TTL for each tool** and the expected polling interval. Surface them in your server's tool descriptions so client authors know what to plan for.

If you do those ten things between now and July 28, your server is RC-ready and your tooling is in a strictly better operational position than it was in April. If you do none of them, you have a working MCP server today that becomes a broken MCP server in August.

---

## Where this is heading

The 2026-07-28 RC is the moment MCP stops being a protocol that assumes synchronous work and starts being one that admits the reality of agent infrastructure: most useful tools take longer than a single request budget. Tasks formalize what teams were already hacking around with progress tokens, polling endpoints, and prayer.

The 12-month trajectory is the convergence with A2A. Both protocols now have task lifecycles, both have human-in-the-loop pause states, both are governed by the AAIF. The interesting questions move up the stack — registries, capability marketplaces, cross-agent observability, and the [defense-in-depth patterns](/lab/camel-dual-llm-defense/) that production systems need when an agent's tool surface and its peer surface are both long-lived and stateful.

For teams building today, the practical sequence is: refactor one long-running tool to Tasks against the RC, validate it against your highest-traffic client, then roll the pattern across the rest of your server. Treat the 10-week window as your one chance to break things in staging before they break in production. We do this work for teams shipping production agents — if you want a Tasks migration done before July 28, [let's talk](/#contact).
