---
title: "MCP Goes Stateless: Refactoring for the 2026-07-28 Spec"
date: 2026-06-22
tags: ["MCP", "Architecture", "Integration", "Developer Tools"]
description: "The 2026-07-28 MCP spec drops the initialize handshake and Mcp-Session-Id, moves client info to _meta, and adds routing headers. What to refactor."
lastmod: 2026-10-27
---

*Updated October 2026: the 2026-07-28 spec [went final on July 28, 2026](https://blog.modelcontextprotocol.io/posts/2026-07-28/) with the stateless core described here. RC-era deadlines are now past tense, and the guide now reflects final-spec details: the required `MCP-Protocol-Version` header and `io.modelcontextprotocol/protocolVersion` in `_meta`, the mandatory `server/discover` RPC, `HeaderMismatch` validation of `Mcp-Method`/`Mcp-Name` on requests, and the removal of `logging/setLevel`.*

<aside class="quick-answer">
  <p>The 2026-07-28 MCP specification — RC-locked May 21, 2026 and final since July 28, 2026 — removes the <code>initialize</code>/<code>initialized</code> handshake and the <code>Mcp-Session-Id</code> header. Protocol version and client metadata now ride in a <code>_meta</code> envelope on every request, so any request can land on any server instance. New <code>Mcp-Method</code> and <code>Mcp-Name</code> headers let a gateway route by header instead of parsing the JSON-RPC body. The practical payoff: an MCP server runs behind a plain round-robin load balancer with no sticky sessions and no shared session store. This is the largest revision since launch, and it is breaking.</p>
</aside>

The 2026-07-28 MCP specification makes the protocol core stateless. The [working group locked the RC on May 21, 2026](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) and [published the final spec on July 28, 2026](https://blog.modelcontextprotocol.io/posts/2026-07-28/) with these changes intact: the `initialize`/`initialized` handshake is gone, the `Mcp-Session-Id` header is gone, client capabilities and identity now travel in a `_meta` envelope on every request, and two new transport headers — `Mcp-Method` and `Mcp-Name` — let a gateway route requests without ever reading the body. The motivating one-liner from the RC is blunt: any MCP request can land on any server instance.

That single design decision changes how you deploy. A `2025-11-25` MCP server was a stateful WebSocket-shaped thing: handshake, session ID, per-connection memory. The 2026-07-28 server is an ordinary stateless HTTP service you can put behind an Application Load Balancer, scale to N replicas, and recycle pods on without a second thought. If you have ever fought sticky-session routing or a shared Redis session store just to run two MCP replicas, this revision is the fix.

This post is the server author's refactor guide. We will read the actual before/after JSON-RPC traces, show where client metadata moves, wire up header-based gateway routing, and finish with a concrete checklist of what to change. If you are new to the protocol, start with [how hosts, clients, servers, and JSON-RPC fit together](/lab/anatomy-of-ai-agent-mcp/) — the rest of this assumes that vocabulary. The companion piece on [async, resumable Tasks](/lab/mcp-async-tasks/) covers the other half of the same release.

---

## What does "stateless core" actually remove?

The [final spec](https://modelcontextprotocol.io/specification/2026-07-28/changelog) deletes three things from the request path: the `initialize` request, the `initialized` notification, and the `Mcp-Session-Id` header that bound every subsequent call to one server instance. In their place, each request carries its own client info and per-request capabilities inside a `_meta` envelope. The server holds no connection-scoped state, so routing becomes round-robin and replicas become interchangeable.

### The handshake that's going away

Before 2026-07-28, every MCP conversation opened with a negotiation round-trip. The client announced its protocol version and capabilities, the server replied with its own, and the client confirmed with an `initialized` notification. Only then could real work begin — and every request after that carried the `Mcp-Session-Id` the server handed back, pinning the conversation to one instance.

Here is the `2025-11-25` opening sequence:

```json
// 1. Client → Server: initialize
{
  "jsonrpc": "2.0",
  "id": 0,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "roots": { "listChanged": true }, "sampling": {} },
    "clientInfo": { "name": "acme-host", "version": "3.2.0" }
  }
}
```

```json
// 2. Server → Client: result, plus a session header on the HTTP response
//    Mcp-Session-Id: 9f1c2b7e-...
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": true } },
    "serverInfo": { "name": "crm-server", "version": "1.4.0" }
  }
}
```

```json
// 3. Client → Server: initialized notification (no response)
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

```http
// 4. Every subsequent request had to carry the session header:
POST /mcp HTTP/1.1
Mcp-Session-Id: 9f1c2b7e-...
Content-Type: application/json

{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { ... } }
```

That `Mcp-Session-Id` is the problem. It forces either sticky routing (session `9f1c...` always goes to replica A — and dies when A dies) or a shared session store every replica reads from. Both are operational tax you pay just to run more than one instance.

### The stateless replacement

In 2026-07-28, there is no opening round-trip. The first thing a client sends is the actual call. The protocol version, client identity, and the capabilities it would have announced in `initialize` now ride in `_meta` on that request — and on every request after it, because the server remembers nothing.

```http
POST /mcp HTTP/1.1
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: lookup_order

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "lookup_order",
    "arguments": { "order_id": "ORD-48291" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "acme-host", "version": "3.2.0" },
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": { "io.modelcontextprotocol/tasks": {} }
      },
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    }
  }
}
```

No `initialize`. No `Mcp-Session-Id`. The client's name, version, and per-request capabilities live in `_meta`, so this single request is fully self-describing. Drop it on any replica and that replica has everything it needs to serve it. The `MCP-Protocol-Version` header [must match](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#protocol-version-header) the `_meta` protocol version, and clients that want up-front version and capability discovery can call the new `server/discover` RPC, which every 2026-07-28 server MUST implement. The spec also documents [W3C Trace Context](https://www.w3.org/TR/trace-context/) propagation through `_meta` — the `traceparent` key above — so distributed tracing survives the move to a multi-replica fleet.

---

## How does header routing work without parsing the body?

The spec adds two [required request headers](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http#standard-request-headers) — `Mcp-Method` and `Mcp-Name` — that mirror the JSON-RPC `method` and, for `tools/call`, `resources/read`, and `prompts/get`, the tool, prompt, or resource name in the body. A gateway reads them straight off the HTTP headers and routes accordingly: `tools/call` to the tool fleet, `resources/read` to the resource fleet, a specific tool name to a specialized backend. No body parsing, no JSON buffering, no coupling the proxy to the protocol payload.

This matters because L7 gateways are fastest and safest when they route on headers. Parsing a JSON-RPC body at the edge means buffering the whole request, decoding it, and teaching your proxy the protocol schema — fragile, slow, and a new attack surface. With `Mcp-Method` and `Mcp-Name` present, an Envoy, NGINX, or ALB rule routes on a header match the same way it routes any other HTTP traffic. The spec closes the obvious gap: a server that processes the body MUST reject a missing or mismatched header with HTTP `400` and JSON-RPC error `-32020` (`HeaderMismatch`), so a gateway can never route on one value while the server executes another.

A header-routed deployment looks like this:

```
                         client
                           │
            Mcp-Method: tools/call
            Mcp-Name:   run_report
                           │
                           ▼
                 ┌───────────────────┐
                 │   L7 gateway      │  routes on headers ONLY
                 │   (Envoy/NGINX)   │  — never parses the body
                 └───┬───────┬───────┘
        Mcp-Method:  │       │  Mcp-Name: run_report
        resources/*  │       │  (heavy/specialized)
                     ▼       ▼
            ┌────────────┐  ┌────────────────┐
            │ resource   │  │ report fleet   │
            │ fleet      │  │ (round-robin)  │
            │ (RR)       │  │  A │ B │ C      │
            └────────────┘  └────┴───┴───┴────┘
```

Because the core is stateless, the round-robin under each backend is real round-robin — no affinity, no `Mcp-Session-Id` to honor. A replica that comes up cold can serve request one; a replica that dies takes nothing with it. The gateway tier and the routing tier are now fully decoupled from MCP's internals: the proxy speaks HTTP headers, the server speaks JSON-RPC, and neither has to know the other's business.

A representative NGINX rule, routing one expensive tool to its own fleet:

```nginx
map $http_mcp_name $mcp_backend {
    default        mcp_general;
    run_report     mcp_reports;   # heavy tool → dedicated fleet
    bulk_export    mcp_reports;
}

server {
    location /mcp {
        proxy_pass http://$mcp_backend;   # header-only routing, body untouched
        proxy_set_header Mcp-Method $http_mcp_method;
        proxy_set_header Mcp-Name   $http_mcp_name;
    }
}
```

---

## What else changed in the same release?

Three deprecations and one capability addition shipped alongside the stateless core, and each affects what your server must touch.

The spec [deprecates Roots, Sampling, and Logging under SEP-2577](https://modelcontextprotocol.io/specification/2026-07-28/changelog#deprecated) with a twelve-month removal window. Deprecated does not mean gone — you have at least a year before the earliest possible removal — but it does mean you should stop building new dependencies on them and plan migrations now. If your server relied on server-initiated `sampling` to call back into the client's model, that pattern is on the clock. Two adjacent removals landed outright: `logging/setLevel` is gone (log level now travels per request as `io.modelcontextprotocol/logLevel` in `_meta`), and server-initiated requests such as `sampling/createMessage` and `roots/list` are replaced by the [Multi Round-Trip Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) pattern — the server returns `inputRequests`, and the client retries the original call with `inputResponses`. The standalone GET stream is also gone; change notifications now arrive on an opt-in `subscriptions/listen` stream.

On the additive side, the spec [loosens tool input and output schemas to accept any JSON Schema 2020-12 keyword](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (SEP-2106) — richer validation, `$ref` composition, and conditional schemas that the older subset could not express. And `tools/list` responses — along with the other list results and `resources/read` — must now carry `ttlMs` and `cacheScope` hints (SEP-2549), letting clients cache the tool list instead of re-fetching it on every cold connection. That cache matters more now precisely *because* there is no session: without a handshake to amortize discovery against, clients would otherwise re-list tools constantly. The cache hints make a stateless client cheap.

For the deeper rationale on why the working group went stateless at all, the [community write-up on dropping sessions](https://dev.to/rabinarayanpatra/why-mcp-2026-07-28-spec-drops-sessions-and-goes-stateless-1gd) is a good corroborating read: the short version is that sticky sessions and shared session stores were the single biggest blocker to running MCP servers as ordinary horizontally-scaled HTTP services.

---

## What does a server author have to refactor?

If you maintain an MCP server, the migration is mechanical but not optional. Most of it is deletion. Walk this list in order.

1. **Delete the `initialize` and `initialized` handlers** from your request path, or reduce them to no-op compatibility shims if you must accept both old and new clients during the transition. The new core does not require them. Implement `server/discover` in their place — the spec makes it mandatory.
2. **Stop reading `Mcp-Session-Id`.** Find every place your transport reads or writes that header and remove it. If your handlers branch on a session ID, that branch is now dead.
3. **Move per-connection state to per-request reads from `_meta`.** Client name, version, and the capabilities you used to learn from `initialize` now arrive in `_meta` on each call. Read them there. If you cached client capabilities keyed by session, delete the cache and read inline.
4. **Make every handler instance-independent.** No request may assume a prior request hit the same replica. Any genuinely durable state (Tasks, idempotency keys, audit logs) moves to a shared store — Redis or Postgres — not process memory.
5. **Validate `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` on every request.** Clients must send them so gateways in front of you can route on headers. If your server processes the body, reject a missing or mismatched header with `400` and `HeaderMismatch` (`-32020`); a mismatch between header and body is a routing bug — or an attack — waiting to happen.
6. **Propagate `traceparent` from `_meta`** into your spans so traces stay continuous across a fleet where consecutive requests land on different replicas. Verify the trace renders end-to-end before you scale out.
7. **Add the now-required `ttlMs`/`cacheScope` to your `tools/list` response** so stateless clients can cache discovery instead of re-listing on every cold request.
8. **Audit Roots, Sampling, and Logging usage.** The features keep working through the deprecation window, but `logging/setLevel` is already removed and server-initiated sampling and roots requests now flow through MRTR `inputRequests`. All three are SEP-2577 deprecated with a twelve-month clock. Catalog where you depend on them and schedule the migration.
9. **Adopt JSON Schema 2020-12** for tool input/output schemas if you want `$ref`, conditional, or composed validation the old subset could not express. This is optional, but it is the version the spec validates against.
10. **Test behind a round-robin LB in staging.** Stand up two or more replicas behind a plain (non-sticky) load balancer and run your full tool battery. Anything that depended on session affinity will fail here, in staging, instead of in production.

Do those ten things and your server runs as an ordinary stateless HTTP service: round-robin LB, hitless replica replacement, meaningful autoscaling. Skip them and you ship a server that assumes a handshake and a session header the 2026-07-28 clients no longer send.

---

## Where this leaves you

The 2026-07-28 spec is the moment MCP stops pretending it is a stateful, connection-oriented protocol and becomes what production infrastructure actually wants: stateless HTTP, header-routable at the edge, horizontally scalable by default. The handshake and the session header were the last things standing between an MCP server and a plain round-robin load balancer, and the spec removes both. Client identity moves to `_meta`; gateway routing moves to `Mcp-Method`/`Mcp-Name`; tracing rides W3C Trace Context end-to-end.

Two honest caveats. The RC-era warning is retired — the spec shipped July 28, 2026, and the [Tier 1 TypeScript, Python, Go, and C# SDKs support it, with Rust in beta](https://blog.modelcontextprotocol.io/posts/2026-07-28/) — but still validate against your SDK in staging, because requirements like the protocol-version header match and mandatory `server/discover` are easy to miss in code written against the RC. And statelessness pushes complexity, not away, but down: anything genuinely durable now *must* live in a shared store, because the protocol no longer lets you stash it in a connection. Pair this refactor with the [Tasks migration](/lab/mcp-async-tasks/) — the two halves of the same release — and your server runs in a strictly better operational position than it did under `2025-11-25`. We do this work for teams shipping production agents; if you want a stateless-core migration done right, [let's talk](/contact/).
