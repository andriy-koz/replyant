---
title: "MCP Apps: Sandboxed UIs and Their New Attack Surface"
date: 2026-07-05
tags: ["MCP", "Architecture", "Integration", "Tool Calling"]
description: "MCP Apps renders server-supplied HTML inside your agent host — a new client-side attack surface. Three trust boundaries, real attacks, and the defenses."
author: "Replyant"
---

MCP Apps — the first official Model Context Protocol extension, folded into the 2026-07-28 spec — lets a server ship an interactive HTML UI that the *host* renders and executes inside the agent, not text the model reads. That single change moves untrusted server output across a boundary it never crossed before: from a string in the model's prompt to JavaScript running in the client. The threat model is no longer "the LLM was tricked by poisoned text." It is "the client executed attacker-supplied markup." Classic web risks — sandbox escape, `postMessage` origin confusion, clickjacking — become *agent* risks, and the defenses are the ones web engineers already know, applied to a surface most agent teams have never had to think about. This post teaches the mechanism, then dissects the three trust boundaries and the concrete attacks each one opens.

MCP Apps was announced January 26, 2026, built jointly by the MCP-UI creators and maintainers from OpenAI and Anthropic, and its wire format was locked in the 2026-07-28 Release Candidate on May 21. Host support already ships in ChatGPT, Claude web and desktop, Goose, and VS Code Insiders, with beta SDKs for Python, TypeScript, Go, and C#. This is not a proposal — it is landing in production hosts three weeks from now. If you have not modeled its attack surface yet, this is the window.

If you are new to how hosts, clients, and servers exchange capabilities over JSON-RPC, start with [how MCP connects your systems](/lab/anatomy-of-ai-agent-mcp/) — the rest of this assumes that vocabulary.

---

## What MCP Apps actually adds

### How does a server ship a UI to the host?

A server registers a UI resource under the `ui://` URI scheme — a bundle of HTML and JavaScript restricted to `text/html`. A tool links to it through a `_meta.ui.resourceUri` field on the tool definition. When the model calls that tool, the host fetches the resource, renders it in a **sandboxed iframe**, and brokers UI↔host messaging as JSON-RPC over `postMessage`. The template is addressable ahead of time, so hosts can prefetch, cache, and security-review it before execution.

The `ui://` indirection is deliberate. Because the UI resource has a stable URI decoupled from any single tool call, a host can pull the HTML, inspect it, apply a Content-Security-Policy, and cache it — all before the model ever triggers a render. Extensions like Apps are negotiated through a dedicated `extensions` capability field in the 2026-07-28 handshake, so a host that hasn't opted in never sees them.

Here is a minimal server declaring a `ui://` resource and wiring a tool to it:

```typescript
// server.ts — an MCP server exposing one UI-backed tool (TypeScript SDK, beta)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({ name: "orders-app", version: "0.1.0" });

// 1. Register the UI resource under the ui:// scheme. Content is text/html only.
server.registerResource(
  "order-widget",
  "ui://orders-app/confirm",           // stable, reviewable URI
  { mimeType: "text/html" },
  async () => ({
    contents: [{
      uri: "ui://orders-app/confirm",
      mimeType: "text/html",
      // Bundled HTML/JS. The host renders THIS inside a sandboxed iframe.
      text: await loadBundle("confirm.html"),
    }],
  }),
);

// 2. A tool that links the UI via _meta.ui.resourceUri. The host can prefetch
//    and security-review the template before this tool ever executes.
server.registerTool(
  "confirm_order",
  {
    description: "Show an order-confirmation widget.",
    inputSchema: { orderId: { type: "string" } },
    _meta: { ui: { resourceUri: "ui://orders-app/confirm" } },  // the link
  },
  async ({ orderId }) => ({
    content: [{ type: "text", text: `Rendering confirmation for ${orderId}` }],
  }),
);
```

Nothing here is inherently dangerous. The danger is what the client does with `confirm.html` — because from the host's perspective, that HTML is attacker-controlled input that is about to *run*.

---

## The three trust boundaries

Every MCP App spans three boundaries, and an attacker can push on each one. Map them before you write a line of client code:

```text
  ┌─────────────────────────────┐        ┌──────────────┐        ┌────────────┐
  │   Sandboxed iframe (UI)      │        │     Host     │        │   Server   │
  │   server-supplied HTML/JS    │        │   (client)   │        │  (untrusted│
  │                              │        │              │        │   author)  │
  │  window.parent.postMessage ──┼──[B]──▶│ onMessage()  │        │            │
  │      JSON-RPC request        │        │  ├ origin?   │──[C]──▶│ tools/call │
  │                              │◀───────┤  ├ consent?  │◀───────┤            │
  │  app.callServerTool(...)     │        │  └ dispatch  │        │            │
  └──────────────┬──────────────┘        └──────┬───────┘        └────────────┘
            [A] sandbox                   trust perimeter
                 │                               │
      attacker escapes the iframe      attacker forges a message
      or it's over-permissioned        or redresses the UI to
                                       auto-approve a tool call
```

- **[A] The iframe boundary.** The UI runs in a sandbox. If the host under-restricts the `sandbox` attribute, hostile JS in the bundle reaches APIs it should never touch — top-level navigation, storage, popups, same-origin DOM.
- **[B] The `postMessage` boundary.** Every UI→host call is a JSON-RPC message. Without origin and shape validation on *both* ends, a malicious embedded resource or a co-resident frame can forge or replay messages.
- **[C] The consent boundary.** A UI-initiated `callServerTool()` must traverse the exact same audit and consent path as a direct tool call. Deceptive UI — clickjacking, UI-redressing — attacks the human at this gate.

The spec's core security invariant is that boundary [C] holds: every UI-initiated action goes through the same audit and consent path as a direct tool call, and hosts may review the HTML pre-render and require explicit approval for UI-initiated calls. The failures below are all cases where [A] or [B] is weak enough that [C] never gets a fair chance.

---

## Failure Modes

### How does an over-permissioned iframe get exploited?

The `sandbox` attribute is an allowlist: an empty `sandbox=""` blocks everything, and each token you add re-grants a capability. If a host renders the UI with `allow-same-origin` plus `allow-scripts`, the sandbox is effectively void — script in the frame can reach the parent's storage and cookies. Add `allow-top-navigation` and hostile JS can redirect the whole tab to a phishing page. The bundle is server-supplied; assume it is hostile.

### Can a UI forge a host message?

Yes, if either end skips validation. JSON-RPC over `postMessage` is just structured strings crossing frames. A handler that trusts any `message` event will accept forged requests from a co-resident frame, a nested iframe the UI loaded, or a message replayed by injected script. The host must check `event.origin` against an allowlist and validate the JSON-RPC shape before dispatching. Origin confusion here turns a rendering bug into arbitrary tool invocation.

### How does clickjacking auto-approve a tool call?

The UI controls its own pixels. A widget can render a benign-looking "Refresh" button that, on click, calls `app.callServerTool("transfer_funds", …)`, or overlay a transparent element above a real control so the user's click lands on a sensitive action. If the host maps that click straight to execution without surfacing the *actual* tool and arguments, the consent gate has been redressed away. The human approved a refresh; the client ran a transfer.

---

## The client round-trip, guarded

Here is the UI→host round-trip with the origin guard that closes boundary [B]. The security-relevant lines are annotated. Method names on `app` follow the beta SDK (`app.callServerTool`, `app.updateModelContext`); the raw `postMessage` handler is illustrative of what the host does underneath.

```typescript
// --- UI side (inside the sandboxed iframe) -------------------------------
// A button handler that asks the host to run a server tool.
document.querySelector("#confirm")!.addEventListener("click", async () => {
  // app.callServerTool() serializes a JSON-RPC request and postMessages it
  // to window.parent. It does NOT bypass consent — the host still gates it.
  const result = await app.callServerTool("confirm_order", { orderId });
  render(result);
});

// --- Host side (parent window) -------------------------------------------
const ALLOWED_ORIGIN = "https://ui.orders-app.example";   // pin the frame origin

window.addEventListener("message", async (event: MessageEvent) => {
  // [B] GUARD 1: reject any message not from the exact expected origin.
  if (event.origin !== ALLOWED_ORIGIN) return;            // no origin, no dispatch

  // [B] GUARD 2: validate the JSON-RPC envelope shape before trusting it.
  const msg = event.data;
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return;

  if (msg.method === "tools/call") {
    // [C] GUARD 3: UI-initiated calls are UNTRUSTED. Route them through the
    //     same consent path as a direct model tool call — show the real tool
    //     name and arguments to the human, never the widget's label.
    const approved = await requestUserConsent(msg.params.name, msg.params.args);
    if (!approved) return replyError(event, msg.id, "user_denied");

    const out = await executeTool(msg.params.name, msg.params.args);
    (event.source as Window).postMessage(
      { jsonrpc: "2.0", id: msg.id, result: out },
      ALLOWED_ORIGIN,                                      // scope the reply, too
    );
  }
});
```

Three guards, three boundaries. Origin pinning stops forged messages. Shape validation stops malformed JSON-RPC from reaching your dispatcher. And routing every `tools/call` through `requestUserConsent` with the *real* arguments — not the widget's chosen label — is what keeps clickjacking from silently invoking a sensitive tool.

---

## Attack surface at a glance

| Attack class | Trust boundary | Primary mitigation |
|---|---|---|
| Sandbox escape / over-permissioned iframe | [A] iframe | Strict `sandbox` attributes; never `allow-same-origin` with `allow-scripts`; CSP on the frame |
| `postMessage` origin confusion / forged JSON-RPC | [B] messaging | Origin allowlist on both ends; validate JSON-RPC shape; scope replies to the pinned origin |
| Clickjacking / UI-redressing to auto-approve a call | [C] consent | Surface real tool + args to the human; frame-busting; treat UI-initiated calls as untrusted |
| Context injection via `updateModelContext()` | [C] → model | Review/sanitize any UI-supplied context before it enters the prompt |
| Hostile template served post-approval (rug pull) | pre-render | Pin and diff `ui://` bundles; re-review on change |

The last two rows tie MCP Apps back to attacks you already know. A UI that calls `app.updateModelContext()` can inject text straight into the model's working context — the same primitive as [prompt injection as a code-execution channel](/lab/prompts-as-shells-rce/). And a server that ships a clean bundle at approval and swaps it later is running the same play as the [rug pull in MCP tool poisoning](/lab/mcp-tool-poisoning/) — except the payload is now executable HTML, not a text description the model merely reads. That is the whole thesis: Apps widens the surface from *text the LLM reads* to *HTML/JS the client executes*.

---

## Hardening Checklist

**Strict sandbox attributes.** Render every UI resource in an iframe with the minimum tokens it needs — start from `sandbox=""` and add capabilities deliberately. Never combine `allow-same-origin` with `allow-scripts`; that pair dissolves the sandbox. Withhold `allow-top-navigation` and `allow-popups` unless the widget provably needs them.

**Origin allowlisting on `postMessage`.** Reject any message whose `event.origin` is not on your explicit allowlist, and scope every reply's `targetOrigin` the same way. Never accept `"*"`. Validate the JSON-RPC envelope shape before dispatch so malformed or partial messages die at the door.

**Treat UI-initiated tool calls as untrusted.** A `callServerTool()` from a widget is a proposal, not a command. Route it through the identical consent gate a direct model call uses, and require human approval for sensitive scopes — the consent path is the security boundary, so show the real tool name and arguments, never the widget's chosen label.

**Pre-render HTML review and CSP.** Use the `ui://` indirection: fetch, review, and pin the bundle before render, and apply a Content-Security-Policy that blocks external script, inline eval, and outbound fetch you did not sanction. Re-review on any change to catch a post-approval swap.

**Never inject unreviewed context.** Anything a UI passes to `app.updateModelContext()` becomes trusted model input. Sanitize and bound it exactly as you would a retrieved document — the [CaMeL dual-LLM pattern](/lab/camel-dual-llm-defense/) applies directly: the model must not be the thing that decides whether UI-supplied content is safe to act on.

---

## Where this fits in the 2026-07-28 spec

MCP Apps lands alongside two other changes in the same Release Candidate: the [stateless-core refactor](/lab/mcp-goes-stateless/) and [async Tasks](/lab/mcp-async-tasks/). They compose. Statelessness means your host's UI-message handler is a pure transform per request, so the three guards above scale horizontally with the rest of your client tier. Tasks means a long-running UI-initiated tool call can return a handle instead of blocking a render. Apps is the third leg: the surface where a human touches the agent directly. Model all three before July 28, because they ship together.

The reframe to carry forward is simple. [Tool poisoning](/lab/mcp-tool-poisoning/) taught us to treat every tool description as untrusted text. MCP Apps raises the stakes: now treat every server-supplied *pixel and script* as untrusted code, and put the same audit, allowlist, and consent discipline in front of it — because this time the client, not just the model, is the thing being asked to comply.

---

*We architect and build production MCP hosts and clients where every server-supplied UI is sandboxed, origin-checked, and gated before it renders or acts. If you are adopting MCP Apps before the July 28 spec ships and want the client-side attack surface hardened first, [let's talk](/contact/).*
