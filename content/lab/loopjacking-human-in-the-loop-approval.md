---
title: "Loopjacking: When the Action You Approved Isn't the One That Runs"
date: 2026-10-26
tags: ["AI Agents", "Architecture", "Governance", "Tool Calling"]
description: "Loopjacking breaks human-in-the-loop approval: the tool call a reviewer sees isn't the one that runs. Bind each approval to a digest of the exact call."
---

Human-in-the-loop approval is a security control only if the operation the human sees is, byte for byte, the operation that executes. Loopjacking is the name for every way that binding breaks, and the fix is mechanical: hash a canonical form of the exact pending tool call at approval time, store the approval against that digest, and refuse to execute anything whose digest no longer matches.

The term comes from ["Loopjacking: Hijacking Human-in-the-Loop Approval"](https://arxiv.org/abs/2609.21081) by Adithyan Arun Kumar, submitted to arXiv on September 17, 2026. The paper reproduces the attack against released versions of Agno AgentOS, a conditional LangGraph Agent Server composition, and OpenClaw, and uses the OpenAI Agents SDK as a negative control that resists it. Every positive case uses the same scenario: a reviewer approves a transfer of 20 units to an approved vendor, and a transfer of 2,000 units to an attacker-controlled sink executes under the reviewer's authority.

---

## What is Loopjacking?

Loopjacking is an implementation-level failure where a human approves what they understand as operation A, and product-owned logic uses that decision to release a materially different operation B. The model is not jailbroken and the reviewer is not careless. The framework's interrupt-and-resume machinery simply fails to bind the decision to the operation, which makes it a time-of-check-to-time-of-use (TOCTOU) bug.

The paper defines two variants:

- **Representation-based.** B is already encoded in the request before the decision, but the approval view displays, canonicalizes, or checks a materially incomplete A. The reviewer approves an accurate rendering of part of the operation.
- **Post-approval state substitution.** The reviewer sees exactly A. Before the approval is consumed, an actor changes pending task, thread, session, or continuation state to B, and the framework executes whatever state it finds at resume.

The attacker model matters because it rules out the lazy objection that "the attacker could just run B." The paper requires asymmetric authority: the attacker can influence the request or the pending state but cannot authorize B, and the approver can authorize consequential execution but does not intend B. In practice the attacker is a low-privilege task initiator, a repository writer, a remote agent, or any actor with a narrow state-update capability. Every positive result also confirms that the attacker's direct attempt at B is denied. The only route to B runs through someone else's approval.

---

## Where does each variant strike in the approval loop?

Each variant strikes at a different gap between the reviewer's check and the executor's use. Representation attacks hit the render step, before the human decides. Substitution attacks hit the window between the human reading the pending call and the framework rebuilding that call at resume. Both succeed because the executor trusts current state instead of the approved descriptor.

```text
 Attacker          Framework / pending state       Approval UI        Approver        Tool
    |                         |                         |                 |              |
    |-- start run ----------->|                         |                 |              |
    |              propose call_7: transfer(20, vendor) |                 |              |
    |                         |-- persist pending ----->|                 |              |
    |                         |                         |                 |              |
    |      [1] REPRESENTATION: payload already encodes B; view renders only A            |
    |                         |                         |-- show "A" ---->|              |
    |                         |                         |                 |              |
    |-- update pending ------>|  [2] SUBSTITUTION: call_7 args := (2000, sink)           |
    |   (write, not resume)   |                         |                 |              |
    |                         |<------------- approve(call_7) ------------|              |
    |                         |                         |                 |              |
    |                resume: rebuild call_7 from CURRENT state            |              |
    |                         |-------------------------- execute B ------------------->|
    |                         |                   (runs under the approver's authority)  |
```

The arrow that matters is the last one. In every vulnerable path, the executor rebuilds the operation from mutable state or a richer object than the one rendered, and nothing compares it against what the reviewer saw.

---

## What did the paper actually test?

The paper tests four released agent products chosen purposively, not sampled. Three reproduce Loopjacking, one in each variant mechanism, and one resists. The author is explicit that the results "do not estimate ecosystem prevalence." They show that the failure exists in shipped software, that it takes mechanically distinct forms, and that a correct design blocks it without breaking legitimate execution.

| Product | Versions tested | Variant | Result | What blocked it |
|---|---|---|---|---|
| Agno AgentOS | 7 releases: 2.5.6, 2.9.0, 3.0.1, 3.0.2, 3.0.3, 3.0.6, 3.0.9 | Post-approval substitution | B executed at every tested release (5/5 trials at 3.0.9) | Research-implemented exact-action comparison; no fixed release known at the paper's cutoff |
| LangGraph Agent Server | 12 versions from 0.7.5 to 0.14.0, conditional in-memory composition | Post-approval substitution | B executed at all 12 when the auth policy allowed the update | The supported deny-update Auth policy |
| OpenClaw | 2026.2.23 and 2026.2.24 | Representation mismatch | 2026.2.23 executed B (3/3); 2026.2.24 rejected it (3/3) | Vendor fix in 2026.2.24 |
| OpenAI Agents SDK | 0.22.0 and 0.22.2 | Negative control | Mutated B rejected at resume; unchanged A executed | Built-in per-call invocation binding |

The three positive paths are worth reading individually, because each one demonstrates a different binding mistake.

**Agno AgentOS binds a run-level flag.** The maker, holding `agents:run` permission, starts A. AgentOS persists an approval for the exact tool name and arguments, and an admin resolves it. The maker then continues the same run and supplies a tool execution with the original call identity but B's arguments. The paper's description of the continuation route is precise: once the run-level pending state clears, it "deserializes caller-supplied tool executions, installs the supplied object into the run, and dispatches a confirmed tool execution." The approved record exists; nobody compares it to the arguments being dispatched.

**LangGraph Agent Server binds a call ID.** The maker creates a thread that interrupts on the 20-unit transfer, and the approver reads the interrupt. Before the approver acts, the maker uses the server's A2A `message.command.update` surface to replace the pending same-ID tool call with B. The approver submits a now-stale approval, and the server resumes from current thread state. "Conditional" is load-bearing here: the reproduction uses the in-memory runtime, pinned LangChain 1.3.18 and LangGraph 1.2.11, and a custom Auth policy that lets the maker update the shared thread but not resume it. A deny-update policy is safe, so the result does not characterize every deployment. Version 0.7.4 is a negative because it lacked the command-update path entirely.

**OpenClaw renders a lossy string.** The request carries a positional argument vector, but the approval view shows only the inline payload `$0 "$1"`. The positional arguments, prepared before the decision, already select the command that performs B. Version 2026.2.23 releases the full vector to the node host. Version 2026.2.24 reconstructs the complete argument vector and rejects the mismatch before node execution, while still running an unchanged A.

---

## Why did the OpenAI Agents SDK resist?

The OpenAI Agents SDK resisted because its ordinary per-call approval retains a canonical invocation fingerprint across serialization. When the researcher mutated the serialized pending invocation to B while keeping the same call ID, restoration succeeded, but resume raised `ModelBehaviorError` and the tool ledger stayed empty. Approved, unmodified state resumed and executed A normally.

That is the whole defense in miniature: the decision is bound to the invocation, not to an identifier that points at whatever the invocation currently is. It also fits the durable-state discipline we described in [our OpenAI Agents API architecture breakdown](/lab/openai-agents-api-architecture/), where an approval is a decision about one action under one principal and input set, and becomes invalid when those change.

Two limits apply. The negative control covers ordinary per-call approval, not an intentional `always_approve` policy. And the paper states plainly that it is "not a claim that all application-authored approval around the SDK is safe." If your application builds its own approval queue around the SDK and renders its own summary, you inherit none of this protection for the parts you wrote.

---

## Why isn't binding the call ID enough?

A call ID names a slot, not an operation. The paper puts it in two sentences: binding only a call identifier fails when a reducer can replace the arguments associated with that identifier, and binding only a run-level "approved" flag fails when a continuation can install a different tool execution. LangGraph's path is the first failure; Agno's is the second.

The same reasoning error shows up in every persistence-layer attack we have covered. In [agent state persistence RCE](/lab/agent-state-persistence-rce/), checkpoint rows were treated as internal plumbing, so nobody asked who else could write them. Loopjacking is the authorization version of that mistake: pending state is mutable, it is reachable through supported APIs, and the approval decision is looked up by reference instead of verified by content.

The correct mental model comes from payments. [AP2 mandates](/lab/ap2-agent-payments-protocol/) bind the user's authorization to a hash of the merchant's signed checkout, so a changed cart invalidates the mandate. An approval for a tool call needs exactly that property, applied to the tool name and every argument.

---

## How do you bind an approval to the exact operation?

Bind the approval to a digest of a canonical serialization of the full pending call, and verify that digest at the moment of execution. The approval record carries the digest, run ID, call ID, approver, policy version, nonce, and expiry. It is integrity-protected, single-use, and consumed atomically with dispatch. Any change to any argument forces a fresh approval.

The paper's proposed record binds the action identity and every material argument, the target and side-effect class, the initiating principal and scope, the approving principal and policy, a nonce, creation time, expiry and consumption status, and "a digest over the same complete descriptor shown to the human." Here is that pattern as a self-contained module:

```python
# approval.py: exact-operation approval binding (illustrative pattern, not a framework patch)
import copy
import hashlib
import hmac
import json
import secrets
import threading
import time
from dataclasses import dataclass


class ApprovalError(Exception):
    """Missing, expired, consumed, out-of-scope, or tampered approval."""


class ApprovalMismatch(ApprovalError):
    """The operation about to run is not the operation that was approved."""


def _reject_floats(value):
    if isinstance(value, float):
        raise ValueError("floats are not canonical; send amounts as integers or decimal strings")
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise ValueError("argument keys must be strings")
            _reject_floats(v)
    elif isinstance(value, list):
        for v in value:
            _reject_floats(v)


def canonical_call(tool: str, args: dict) -> bytes:
    """Canonical JSON for tool identity plus EVERY argument. No truncation, no normalization."""
    _reject_floats(args)
    payload = {"tool": tool, "args": args}
    return json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def digest(canonical: bytes) -> str:
    return hashlib.sha256(canonical).hexdigest()


@dataclass
class PendingCall:
    run_id: str
    call_id: str
    tool: str
    args: dict  # mutable on purpose: this is the state an attacker tries to rewrite


class ApprovalStore:
    def __init__(self, key: bytes):
        self._key = key
        self._records: dict[str, tuple[bytes, bytes]] = {}  # approval_id -> (body, tag)
        self._consumed: set[str] = set()
        self._lock = threading.Lock()

    def _tag(self, body: bytes) -> bytes:
        return hmac.new(self._key, body, hashlib.sha256).digest()

    def grant(self, pending: PendingCall, *, approver: str, shown_digest: str,
              policy_version: str, ttl_s: int = 900) -> str:
        current = digest(canonical_call(pending.tool, pending.args))
        # The reviewer's screen showed a digest. If state moved while they read, refuse.
        if not hmac.compare_digest(shown_digest, current):
            raise ApprovalMismatch("pending call changed while it was under review")
        approval_id = secrets.token_urlsafe(16)
        body = json.dumps({
            "approval_id": approval_id, "run_id": pending.run_id, "call_id": pending.call_id,
            "digest": current, "approver": approver, "policy_version": policy_version,
            "issued_at": int(time.time()), "expires_at": int(time.time()) + ttl_s,
        }, sort_keys=True, separators=(",", ":")).encode()
        with self._lock:
            self._records[approval_id] = (body, self._tag(body))
        return approval_id

    def consume(self, approval_id: str, pending: PendingCall) -> bytes:
        """Verify and consume atomically. Returns the exact canonical bytes that were approved."""
        canonical = canonical_call(pending.tool, copy.deepcopy(pending.args))
        with self._lock:
            if approval_id in self._consumed:
                raise ApprovalError("approval already consumed")
            entry = self._records.get(approval_id)
            if entry is None:
                raise ApprovalError("unknown approval")
            body, tag = entry
            if not hmac.compare_digest(tag, self._tag(body)):
                raise ApprovalError("approval record failed integrity check")
            rec = json.loads(body)
            if time.time() > rec["expires_at"]:
                raise ApprovalError("approval expired")
            if (rec["run_id"], rec["call_id"]) != (pending.run_id, pending.call_id):
                raise ApprovalError("approval is scoped to a different run or call")
            if not hmac.compare_digest(rec["digest"], digest(canonical)):
                raise ApprovalMismatch("pending call differs from the approved call")
            self._consumed.add(approval_id)
        return canonical


def execute_pending(store: ApprovalStore, approval_id: str, pending: PendingCall, tools: dict):
    canonical = store.consume(approval_id, pending)
    # Dispatch from the verified bytes, never from the live dict, which can still change.
    call = json.loads(canonical)
    return tools[call["tool"]](**call["args"])
```

Four details in this code carry the security property.

1. **The digest covers everything.** Tool name plus the full argument object, with sorted keys and fixed separators. Floats are rejected because `20`, `20.0`, and `2e1` are the same number and different bytes; money belongs in integers or decimal strings anyway.
2. **There is no Unicode normalization.** Normalizing before hashing would make two strings that execute differently produce the same digest. Hash the exact bytes the tool will receive, and deal with confusable characters in the renderer.
3. **Dispatch uses the verified bytes.** Hashing `pending.args` and then calling the tool with `pending.args` reopens a TOCTOU window between the check and the call. `execute_pending` decodes the canonical bytes it just verified and passes those.
4. **Consumption is atomic and single-use.** The lock covers check-and-consume, so two concurrent resumes cannot both spend one approval. In production, replace the lock and in-memory set with a conditional database update (for example, `UPDATE approvals SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL`) and treat zero affected rows as a refusal.

Before dispatch, also re-evaluate current policy: the principal may have lost access or the destination may have been delisted since approval. The paper's use-time procedure orders it the same way: reject a missing, expired, revoked, consumed, or out-of-scope decision; reject a material change; re-check policy; consume atomically with release; then append the approved descriptor, current descriptor, decision, and effect to the audit log.

---

## How do you render a pending call so the reviewer sees what runs?

Render the complete canonical form the digest was computed over, generated from the same descriptor the executor will use. Never render a convenience string, a template, or a summary. The OpenClaw failure, a `$0 "$1"` display in front of a full argument vector, is the general case: whenever the display and the execution read different objects, the display will eventually lie.

```python
# render.py: build the approval view FROM the canonical bytes, and flag what humans can't see
import json
import unicodedata

from approval import canonical_call, digest

INVISIBLE_CATEGORIES = {"Cc", "Cf", "Co", "Cs", "Zl", "Zp"}


def _flag_chars(value, path="args"):
    flags = []
    if isinstance(value, dict):
        for k, v in value.items():
            flags += _flag_chars(k, f"{path}.<key>") + _flag_chars(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            flags += _flag_chars(v, f"{path}[{i}]")
    elif isinstance(value, str):
        for ch in value:
            cat = unicodedata.category(ch)
            if cat in INVISIBLE_CATEGORIES or (cat == "Zs" and ch != " ") or ord(ch) > 0x7E:
                name = unicodedata.name(ch, "UNNAMED")
                flags.append(f"{path}: U+{ord(ch):04X} {name} ({cat})")
    return flags


def render_for_approval(tool: str, args: dict) -> dict:
    canonical = canonical_call(tool, args)
    call = json.loads(canonical)
    return {
        "tool": call["tool"],
        # ensure_ascii=True turns every non-ASCII character into a visible \uXXXX escape
        "full_call": json.dumps(call, sort_keys=True, indent=2, ensure_ascii=True),
        "warnings": _flag_chars(call["args"]),
        "digest": digest(canonical),  # posted back with the decision as shown_digest
    }
```

The renderer returns the digest, and the approval endpoint must post it back as `shown_digest`. That closes the LangGraph-style window: if the pending call changes between render and click, `grant()` refuses because the digest the reviewer saw is no longer the digest of current state.

The rendering pitfalls to test for:

| Pitfall | How it hides B | Countermeasure |
|---|---|---|
| Truncation | Long arguments cut off with an ellipsis; B lives past the cut | Never truncate. Scroll or collapse, but make the full value reachable and include it in the digest |
| Undisplayed fields | UI template shows `to` and `amount`, ignores `cc`, `webhook_url`, or positional args | Render from the canonical object, not a per-tool template |
| Invisible and confusable characters | Zero-width joiners, bidi overrides, non-breaking spaces, homoglyph hostnames | Escape non-ASCII, flag control and format characters, show code points |
| Whitespace and newlines | A shell argument with an embedded newline renders as one harmless line | Escape `\n`, `\t`, `\r`; render strings as JSON literals |
| Defaults applied at execution | Display omits a parameter; the tool fills a dangerous default | Materialize defaults into the pending call before hashing |
| Model-written descriptions | The agent's "this sends a routine payment" text is what the reviewer reads | Treat model prose as untrusted context; the canonical call is the authority |

The last row is our recommendation rather than a finding in the paper, and it is the one teams most often get wrong. If the model writes the summary the human approves, then any prompt injection that steers the model also writes the approval prompt. Show a model-generated summary only beside the canonical call, labeled as unverified, never instead of it. This is the same control-plane separation behind [CaMeL's capability design](/lab/camel-dual-llm-defense/): authority comes from data the model cannot rewrite.

---

## Should pending state be immutable instead?

Preventing unauthorized pending-state mutation is the paper's second valid defense, and LangGraph's supported deny-update Auth policy is an instance of it. Use it, but do not rely on it alone. The paper calls it composition-specific: it does not replace exact-action binding when legitimate updates, retries, or migrations can change operation state.

The stronger arrangement layers both. Make the pending-call record append-only, so an edit produces a new call version with a new digest that needs a new approval. Seal pending state with an HMAC under a server-held key, so a row written outside your service, or a serialized continuation edited in transit, fails verification before it is parsed. Then keep digest comparison at execution as the control that still holds when a legitimate code path changes state you did not anticipate. Bind-and-revalidate survives benign state changes by demanding a fresh decision; mutation-blocking only survives the mutations you thought to block.

---

## How do you write a regression test for Loopjacking?

Write tests that approve A, mutate pending state to B through every path your system supports, and assert execution is refused with zero side effects. Pair each attack with a control that unchanged A still executes, because a gate that refuses everything also passes the attack test. Then run the suite on every framework upgrade.

```python
# test_loopjacking.py
import secrets

import pytest

from approval import ApprovalError, ApprovalMismatch, ApprovalStore, PendingCall, execute_pending
from render import render_for_approval


@pytest.fixture
def env():
    ledger = []
    tools = {"transfer": lambda amount, to: ledger.append((amount, to)) or "ok"}
    store = ApprovalStore(key=secrets.token_bytes(32))
    pending = PendingCall("run-1", "call-7", "transfer", {"amount": 20, "to": "vendor-approved"})
    return store, pending, tools, ledger


def approve(store, pending):
    shown = render_for_approval(pending.tool, pending.args)
    return store.grant(pending, approver="alice", shown_digest=shown["digest"], policy_version="p1")


def test_unchanged_call_executes(env):
    store, pending, tools, ledger = env
    execute_pending(store, approve(store, pending), pending, tools)
    assert ledger == [(20, "vendor-approved")]


def test_post_approval_substitution_is_refused(env):
    store, pending, tools, ledger = env
    approval_id = approve(store, pending)
    pending.args.update(amount=2000, to="attacker-sink")  # B, same call ID
    with pytest.raises(ApprovalMismatch):
        execute_pending(store, approval_id, pending, tools)
    assert ledger == []


def test_mutation_during_review_is_refused(env):
    store, pending, tools, ledger = env
    shown = render_for_approval(pending.tool, pending.args)
    pending.args["amount"] = 2000  # attacker writes while the reviewer reads
    with pytest.raises(ApprovalMismatch):
        store.grant(pending, approver="alice", shown_digest=shown["digest"], policy_version="p1")


def test_added_field_is_refused(env):
    store, pending, tools, ledger = env
    approval_id = approve(store, pending)
    pending.args["memo"] = "x"  # a field the UI template might never show
    with pytest.raises(ApprovalMismatch):
        execute_pending(store, approval_id, pending, tools)


def test_approval_is_single_use(env):
    store, pending, tools, ledger = env
    approval_id = approve(store, pending)
    execute_pending(store, approval_id, pending, tools)
    with pytest.raises(ApprovalError):
        execute_pending(store, approval_id, pending, tools)
    assert ledger == [(20, "vendor-approved")]


def test_approval_does_not_transfer_to_another_call(env):
    store, pending, tools, ledger = env
    approval_id = approve(store, pending)
    other = PendingCall("run-1", "call-8", "transfer", dict(pending.args))
    with pytest.raises(ApprovalError):
        execute_pending(store, approval_id, other, tools)
    assert ledger == []
```

Against a real framework, the unit tests above are the floor. The integration version drives the framework's own APIs: create the interrupt, approve through the real endpoint, then attempt substitution through every supported write path (state update, command update, run continuation, direct store write, edited serialized continuation) as a principal who cannot resume. Assert the sink records nothing and the direct B attempt is denied. Put these in the pipeline as blocking checks, as described in [our guide to agent evals in CI/CD](/lab/agent-evals-cicd/), because a framework minor release can add a new write path to pending state, exactly as LangGraph's command-update surface appeared after 0.7.4.

---

## Does exact binding fix rubber-stamp approval?

No. Exact binding guarantees that the approved operation is the executed operation. It does not guarantee the reviewer read it. A reviewer clearing hundreds of items a day approves B whether it is hidden or rendered in full, and that failure lives in staffing and queue design, not in the framework.

We covered the human side in [the AI agent manager role](/blog/ai-agent-manager-role/): when review capacity is overwhelmed, approval degrades into a rubber stamp. Loopjacking and rubber-stamping fail the same control from opposite ends. Fix both. Bind approvals cryptographically so the reviewer's decision means something, then keep the approval volume low enough, with risk-tiered gates and full canonical diffs, that the decision is an actual decision.

---

## The audit checklist

1. **Find every approval gate** in your agent stack, including the ones your application wraps around a framework.
2. **For each gate, identify what the decision binds to:** a run flag, a call ID, or a digest of the full operation. Only the last one is acceptable.
3. **Confirm the approval view renders from the executor's descriptor,** with no truncation, no per-tool template, and no model-written summary standing in for the call.
4. **Enumerate every write path to pending state** and every principal who can reach it. Deny updates from non-approvers where the framework supports it.
5. **Recompute and compare the digest at execution,** dispatch from the verified bytes, and consume the approval atomically.
6. **Seal pending state and approval records** with a server-held HMAC key.
7. **Add the substitution tests to CI** and re-run them on every framework upgrade.

## Sources

- [Loopjacking: Hijacking Human-in-the-Loop Approval (arXiv abstract)](https://arxiv.org/abs/2609.21081)
- [Loopjacking full paper, HTML version](https://arxiv.org/html/2609.21081)
