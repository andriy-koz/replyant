---
title: "AP2 Agent Payments Protocol: Mandates, SD-JWT, Verification"
date: 2026-07-22
tags: ["AI Agents", "Architecture", "Integration", "Tool Calling"]
description: "Google's AP2 gives AI agents cryptographic authority to spend. A technical breakdown of Checkout and Payment Mandates, SD-JWT chains, and verification."
author: "Replyant"
---

<aside class="quick-answer">
  <p>AP2 v0.2 defines <strong>two</strong> mandate types — Checkout Mandate (<code>mandate.checkout.1</code>) and Payment Mandate (<code>mandate.payment.1</code>) — each with an <em>open</em> variant for autonomous flows. Mandates are SD-JWT verifiable credentials. Verifiers MUST match the <code>vct</code> string exactly including its version suffix, and MUST treat any unknown constraint as a failed evaluation. Secondary write-ups describing a three-mandate Intent/Cart/Payment model are describing v0.1, which v0.2 replaced.</p>
</aside>

**AP2 is the protocol that turns "my agent bought this" into a cryptographically provable claim.** Google's [Agent Payments Protocol](https://ap2-protocol.org/) solves one problem: when an autonomous agent presents a payment, the merchant, the credential provider, and the payment processor have no way to know whether the human actually authorized *this* purchase, at *this* price, from *this* merchant. AP2 fixes that with two signed verifiable credentials — a **Checkout Mandate** proving the agent was authorized to buy what it assembled, and a **Payment Mandate** proving the agent was authorized to pay for that specific checkout — cryptographically bound to each other by a hash of the merchant's own signed checkout.

The protocol's foundational design assumption is unusually blunt, and it is the reason the rest of the spec looks the way it does. From the [security considerations](https://ap2-protocol.org/ap2/security_and_privacy_considerations/): *"AP2 assumes that preventing prompt injection attacks is infeasible. Therefore, all LLMs and Agents MUST be considered potential attackers and are explicitly included in the threat model."* AP2 is not built to make agents trustworthy. It is built so that an untrustworthy agent cannot spend more than a human explicitly permitted.

AP2 launched September 16 2025 with, in Google's words, [*"more than 60 organizations"*](https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol) — Mastercard, PayPal, American Express, Coinbase, Adyen, Worldpay, Salesforce, and ServiceNow among them. Version **0.2.0 shipped April 28 2026** — the release that introduced Human-Not-Present autonomous payments — and on the same day Google [donated the protocol to the FIDO Alliance](https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/), where core specification work now continues.

---

## What problem does AP2 actually solve?

Card networks authenticate a *cardholder*. AP2 authenticates a *delegation*. When an agent checks out, the merchant needs proof that a human approved these specific line items, and the processor needs proof that the same human approved this specific amount to this specific payee. AP2 supplies both as signed credentials that survive to dispute time, so liability can be assigned from evidence rather than from argument.

That last point is why this protocol matters commercially and not just cryptographically. AP2's [executive summary](https://ap2-protocol.org/overview/) names accountability as a primary objective: in a dispute, the network adjudicator compares the user-signed Checkout Mandate against the disputed transaction. We cover the business and procurement side of that shift — who eats the loss when an agent buys the wrong thing — in [who is liable when an AI agent spends your money](/blog/agentic-commerce-liability/). This post is the wire format.

### The five roles

AP2 defines five roles with distinct verification duties. A single company can play several of them; it then inherits every one of those duties.

| Role | Responsibility | Verifies |
|---|---|---|
| **Shopping Agent (SA)** | Product discovery, cart assembly, executing the purchase | Nothing — it is the assumed attacker |
| **Merchant (M)** | Owns catalog, signs the Checkout JWT, fulfills the order | Checkout Mandate |
| **Credential Provider (CP)** | Source of payment credentials; issues the scoped payment token | Payment Mandate |
| **Merchant Payment Processor (MPP)** | Processes the payment | Payment Mandate inside the token, and its binding to the checkout |
| **Trusted Surface (TS)** | UI that obtains informed user consent and signs mandates | — |

The spec draws one hard line through that table. Merchant, MPP, and Credential Provider **MAY** be agentic — driven by an LLM. The Shopping Agent is *expected* to be agentic. The Trusted Surface **MUST** be non-agentic. And regardless of role, *"when this document refers to validation or processing for a particular role, it MUST happen in deterministic code."* No verification step in AP2 may be delegated to a model.

---

## What are the two mandates?

AP2 v0.2 defines exactly two mandate types, each in two states. A **closed** mandate is bound to one specific transaction. An **open** mandate carries constraints instead of concrete values, is bound to an agent's public key via `cnf`, and lets the agent close it later without the human present. Verifiers always receive a closed mandate; in autonomous flows they receive the open one chained behind it.

| Mandate | `vct` (closed) | `vct` (open) | Created by | Verified by |
|---|---|---|---|---|
| Checkout Mandate | `mandate.checkout.1` | `mandate.checkout.open.1` | Shopping Agent, signed by Trusted Surface or Agent key | Merchant |
| Payment Mandate | `mandate.payment.1` | `mandate.payment.open.1` | Shopping Agent, signed by Trusted Surface or Agent key | Credential Provider, Network, MPP |

Those four strings are the protocol's version handshake, and the spec is emphatic about it:

> Each AP2 Mandate type identifies its schema using the `vct` claim. The `vct` value includes a numeric suffix that acts as a schema version number (e.g. `mandate.payment.1`, `mandate.checkout.open.1`). **Implementations MUST match the exact `vct` string, including the version suffix.**

Do not write `startswith("mandate.payment")`. A future `mandate.payment.2` will carry an incompatible schema, and a prefix match is how you silently accept it.

### The closed Checkout Mandate

Three required fields. That is the whole credential.

```json
{
  "vct": "mandate.checkout.1",
  "checkout_jwt": "eyJhbGciOiAiRVMyNTYiLCAidHlwIjogIkpXVCJ9.eyJvcmRlcl9pZCI6...",
  "checkout_hash": "NivWhuqfzcvZNapvIEJ2-3tsdQLkiuIcye2g46WVgX8",
  "iat": 1777342376,
  "exp": 1777345957
}
```

`checkout_jwt` is the *merchant-signed* JWT containing the cart — AP2 is agnostic to its contents, though under the [Universal Commerce Protocol](https://ucp.dev/) it must be the UCP Checkout object. `checkout_hash` is the base64url-encoded hash of that JWT string, computed with the same algorithm as the SD-JWT's `_sd_alg` (or `sha-256` when absent).

The asymmetry between those two fields is deliberate and easy to miss: **`checkout_jwt` is selectively disclosable; `checkout_hash` is not.** The agent can withhold the entire cart from a verifier that has no business seeing it — the payment processor does not need to know you bought sneakers — while the hash still binds the payment to that exact cart for dispute resolution.

### The closed Payment Mandate

```json
{
  "vct": "mandate.payment.1",
  "transaction_id": "NivWhuqfzcvZNapvIEJ2-3tsdQLkiuIcye2g46WVgX8",
  "payee": {
    "id": "merchant_1",
    "name": "Demo Merchant",
    "website": "https://demo-merchant.example"
  },
  "payment_amount": { "amount": 19900, "currency": "USD" },
  "payment_instrument": {
    "id": "b3f1c8a2-6d4e-4f9a-9e3d-8a7c2f1b9d34",
    "type": "card",
    "description": "Card ••••4242"
  }
}
```

Note the join key. `transaction_id` on the Payment Mandate **is** `checkout_hash` from the Checkout Mandate — the same base64url digest of the same merchant-signed JWT. That single shared value is what lets a dispute adjudicator reunite two credentials that were deliberately shown to different parties.

Note also `payment_amount.amount`: an **integer in ISO 4217 minor units**. `19900` is $199.00. Every amount in the AP2 schemas is minor units, and this is the first place a naive implementation loses two orders of magnitude.

---

## How does SD-JWT carry a mandate?

AP2 secures mandates as [SD-JWT verifiable credentials](https://datatracker.ietf.org/doc/rfc9901/), chosen for two properties the payment case needs: **key binding**, so an agent can prove possession of the key the user endorsed when the user is long gone, and **selective disclosure**, so the agent reveals only the constraint fragments a given verifier needs. Other credential formats — ISO mDocs are named — could substitute; SD-JWT is what the spec normatively uses.

An open mandate is issued as a `delegate_payload` inside an SD-JWT. Here is a real open Checkout Mandate, with the constraint contents themselves hidden behind digests:

```json
{
  "vct": "mandate.checkout.open.1",
  "constraints": [
    {
      "type": "checkout.line_items",
      "items": [
        {
          "id": "line_1",
          "acceptable_items": [
            { "...": "y3aocAD2rhYpJQOUMN016faDFGkTBGEDVl1R1TRHdbw" }
          ],
          "quantity": 1
        }
      ]
    },
    {
      "type": "checkout.allowed_merchants",
      "allowed": [
        { "...": "a5UMAdxCk_MRayyVdRhpIAZ0ZhjVLEq1g2BWyruKUwg" }
      ]
    }
  ],
  "cnf": {
    "jwk": {
      "crv": "P-256",
      "kty": "EC",
      "x": "QpSyxPQHy38xckypDr54gZ3T42zj9iLtV4koyb5U27c",
      "y": "37HLd7JJinxjJIn8J7HijssoeclbfhdW-gUL7feI9lw"
    }
  },
  "iat": 1777342357,
  "exp": 1777345957
}
```

The `{"...": "<digest>"}` placeholders are RFC 9901 undisclosed array elements. The user may have approved fifteen acceptable SKUs across four merchants; the agent reveals the one disclosure that matches the cart it actually built, and the merchant learns nothing about the other fourteen. The matching disclosure is a salted triple carried alongside the token:

```json
["4n3L_-3_Fm2GgyFAF8Ct_g",
 { "id": "supershoe_limited_edition_gold_sneaker_womens_9_0",
   "title": "SuperShoe Limited Edition Gold" }]
```

`cnf` is the RFC 7800 confirmation claim holding the **agent's** public key. In autonomous mode the spec is unambiguous: open mandates *"MUST include the agent's public key as a `cnf` claim"*, because a mandate not yet bound to a transaction must at least be bound to a principal. It also recommends setting `exp` *"to the smallest value that will allow the Shopping Agent to complete the assigned task"* — a short-lived open mandate is a small blast radius.

Closing the mandate produces a second SD-JWT with a `kb+sd-jwt` type header, signed with the key from `cnf`, carrying an `sd_hash` that binds it to the presented open mandate:

```json
{
  "header": { "alg": "ES256", "typ": "kb+sd-jwt" },
  "payload": {
    "delegate_payload": [{ "...": "7VLY-eKTFSShLoZRXY5jXcD2UHm1JvPmoANYRqqxy34" }],
    "iat": 1777342376,
    "aud": "merchant",
    "nonce": "b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4",
    "sd_hash": "FzLoxbbtgQGYZxoSM2NJYJtkFTSsdfUBoVEQ12k7JN8",
    "_sd_alg": "sha-256"
  }
}
```

On the wire the whole chain is one `~`-separated compact string — open SD-JWT, its disclosures, then the closed key-binding SD-JWT and its disclosures:

```
<open-issuer-jwt>~<disclosure-item>~<disclosure-merchant>~<disclosure-open-mandate>~
~<closed-kb-jwt>~<disclosure-closed-mandate>~<disclosure-checkout-jwt>~
```

Three claims do all the binding work, and each closes a specific attack in the spec's threat model:

| Claim | Binds | Attack it defeats |
|---|---|---|
| `cnf` | Open mandate → agent key | A different agent replaying a stolen open mandate |
| `sd_hash` | Closed mandate → the open mandate presented with it | Pairing a closed mandate with a *different* open mandate |
| `checkout_hash` / `transaction_id` | Payment ↔ Checkout ↔ merchant-signed cart | Reusing an authorized Payment Mandate on an unrelated checkout |

---

## Why does AP2 push back on Ed25519?

The specification states: *"To prevent rainbow table attacks, the Checkout JWT MUST be signed using a digital signature scheme (e.g., ECDSA) and not a deterministic signature (e.g., Ed25519)."* The reason is not signature strength. `checkout_hash` is an unsalted hash of the checkout JWT, so a verifier holding only the hash could brute-force a low-entropy cart. ECDSA's per-signature randomness supplies that entropy for free.

This is worth stating precisely, because the two primary pages do not say quite the same thing. The [specification](https://ap2-protocol.org/ap2/specification/) issues a flat `MUST NOT` on deterministic schemes for the Checkout JWT. The [security and privacy considerations](https://ap2-protocol.org/ap2/security_and_privacy_considerations/) page frames it as a conditional instead:

> The `checkout_hash` makes use of the entropy already included in the JWT signature to prevent guessing the Checkout contents. If a signing algorithm (e.g. deterministic signature scheme such as `Ed25519`) is used that does not include this then a salt of sufficient entropy MUST be present in the Checkout.

Read together: the hazard is an unsalted digest over guessable plaintext, and the spec offers two remedies — a non-deterministic signature, or an explicit salt in the checkout. The normative specification text picks the first and forbids the second path for the Checkout JWT. **Implement to the specification page: ECDSA, and treat Ed25519 as out of bounds here.** Every worked example in the repo uses `ES256` over P-256, for both the SD-JWT and the key-binding JWT.

The same salt requirement applies one level down. All SD-JWT disclosure digests *"MUST include a salt with sufficient entropy to prevent guessing the plaintext"* — visible as the 128-bit salts leading each disclosure array above. The Trusted Surface MAY additionally insert **decoy digests** (RFC 9901 §4.2.5) so a verifier cannot even count how many constraints the user approved.

---

## The constraint system

Constraints are the entire value proposition of the autonomous flow: they are what bounds a compromised agent. The spec defines two constraint types for Checkout Mandates and eight for Payment Mandates.

| Constraint type | Applies to | Bounds |
|---|---|---|
| `checkout.allowed_merchants` | Checkout | Which merchants may fill the order |
| `checkout.line_items` | Checkout | Which SKUs, in what quantities |
| `payment.allowed_payees` | Payment | Who may receive funds |
| `payment.allowed_payment_instruments` | Payment | Which card/instrument may be used |
| `payment.allowed_pisps` | Payment | Which payment initiation service providers |
| `payment.amount_range` | Payment | `min`/`max` in minor units, single currency |
| `payment.budget` | Payment | Cumulative spend cap across recurrences |
| `payment.agent_recurrence` | Payment | `frequency` enum + `max_occurrences` |
| `payment.execution_date` | Payment | `not_before` / `not_after` window |
| `payment.reference` | Payment | Ties the payment to one open Checkout Mandate |

Two of these are structurally required. The open Checkout Mandate schema requires the `constraints` array to *contain* a `checkout.line_items` entry; the open Payment Mandate schema requires it to contain a `payment.reference`. You cannot mint an open mandate that authorizes unbounded shopping or an unlinked payment — the schema refuses.

`payment.agent_recurrence.frequency` is a closed enum: `ON_DEMAND`, `DAILY`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `QUARTERLY`, `ANNUALLY`. Paired with `payment.budget`, it is how "restock my coffee monthly, never more than $400 a year" becomes machine-checkable.

---

## Writing a verifier

The [Agent Authorization Framework](https://ap2-protocol.org/ap2/agent_authorization/) gives three normative processing rules, and the third contains the sentence that should shape your whole design: *"Any unknown Constraints MUST be treated as failing evaluation."* AP2 fails closed. An agent cannot smuggle spend past you by inventing a constraint type you have never heard of.

Here is a verifier for the merchant side, implementing all three rules over an already-parsed SD-JWT chain.

```python
"""AP2 v0.2 mandate verification (merchant side).

Assumes the SD-JWT chain has already been verified and processed per
Delegate SD-JWT: signatures checked, disclosures resolved, undisclosed
array elements left in place as {"...": "<digest>"}.
"""

import base64
import hashlib
from collections import deque
from typing import Any, Callable

HASHES = {
    "sha-256": hashlib.sha256,
    "sha-384": hashlib.sha384,
    "sha-512": hashlib.sha512,
}

# Normative error codes from the Agent Authorization Framework.
INVALID_CREDENTIAL = "invalid_credential"      # terminal
UNRESOLVED_CONSTRAINT = "unresolved_constraint"  # may fall back to human-present
INVALID_MANDATE = "invalid_mandate"            # terminal

# Reserved claims live on the open mandate only; they are not copied forward.
RESERVED = {"vct", "constraints", "cnf", "iat", "exp", "_sd", "_sd_alg"}


class MandateError(Exception):
    def __init__(self, code: str, description: str):
        super().__init__(f"{code}: {description}")
        self.code = code
        self.description = description


def digest(value: str, alg: str = "sha-256") -> str:
    """SD-JWT digests, sd_hash, checkout_hash and Receipt.reference are all
    base64url(H(ascii(value))) with the padding stripped."""
    if alg not in HASHES:
        raise MandateError(INVALID_CREDENTIAL, f"unsupported _sd_alg: {alg}")
    raw = HASHES[alg](value.encode("ascii")).digest()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
```

The constraint evaluators go in a registry so that "unknown" is the default rather than an afterthought:

```python
Evaluator = Callable[[dict, dict, dict], None]
EVALUATORS: dict[str, Evaluator] = {}


def evaluator(type_id: str):
    def register(fn: Evaluator) -> Evaluator:
        EVALUATORS[type_id] = fn
        return fn
    return register


def revealed(items: list[dict]) -> list[dict]:
    """Drop undisclosed array elements: {"...": "<digest>"}."""
    return [i for i in items if "..." not in i]


@evaluator("checkout.allowed_merchants")
def _allowed_merchants(c: dict, closed: dict, checkout: dict) -> None:
    allowed = revealed(c["allowed"])
    if not allowed:
        # Spec: "if the allowed contains no revealed elements, the
        # constraint is invalid."
        raise MandateError(UNRESOLVED_CONSTRAINT, "no merchant disclosures revealed")
    if not any(m["id"] == checkout["merchant"]["id"] for m in allowed):
        raise MandateError(INVALID_MANDATE, f"merchant {checkout['merchant']['id']} not allowed")


@evaluator("payment.amount_range")
def _amount_range(c: dict, closed: dict, checkout: dict) -> None:
    amount = closed["payment_amount"]           # minor units, ISO 4217
    if amount["currency"] != c["currency"]:
        raise MandateError(INVALID_MANDATE, "currency does not match constraint")
    if amount["amount"] > c["max"] or amount["amount"] < c.get("min", 0):
        raise MandateError(INVALID_MANDATE, f"amount {amount['amount']} out of range")


@evaluator("payment.allowed_payees")
def _allowed_payees(c: dict, closed: dict, checkout: dict) -> None:
    allowed = revealed(c["allowed"])
    if not allowed:
        raise MandateError(UNRESOLVED_CONSTRAINT, "no payee disclosures revealed")
    if not any(m["id"] == closed["payee"]["id"] for m in allowed):
        raise MandateError(INVALID_MANDATE, f"payee {closed['payee']['id']} not allowed")
```

`checkout.line_items` is the interesting one. The spec does not hand-wave the matching rule — it specifies the exact graph and tells you to solve it as a maximal flow problem, because an item disclosed as acceptable for one requirement slot may also be acceptable for another, and greedy assignment gets it wrong.

```python
@evaluator("checkout.line_items")
def _line_items(c: dict, closed: dict, checkout: dict) -> None:
    # Total quantity per SKU actually present in the merchant-signed checkout.
    present: dict[str, int] = {}
    for li in checkout["line_items"]:
        sku = li["product"]["id"]
        present[sku] = present.get(sku, 0) + li["quantity"]

    requirements: list[tuple[int, set[str]]] = []
    for req in c["items"]:
        acceptable = {i["id"] for i in revealed(req["acceptable_items"])}
        if not acceptable:
            raise MandateError(
                UNRESOLVED_CONSTRAINT, f"no acceptable_items revealed for {req['id']}"
            )
        requirements.append((req["quantity"], acceptable))

    flow = _max_flow(requirements, present)
    required_total = sum(q for q, _ in requirements)
    checkout_total = sum(present.values())

    # "The constraint is met if the maximal flow equals the total constraint
    # items quantity AND the total checkout items quantity."
    if flow != required_total or flow != checkout_total:
        raise MandateError(
            INVALID_MANDATE,
            f"line items unsatisfied (flow={flow}, required={required_total}, "
            f"checkout={checkout_total})",
        )


def _max_flow(requirements: list[tuple[int, set[str]]], present: dict[str, int]) -> int:
    """Ford-Fulkerson over the graph the spec describes:
    SRC -> requirement (cap=quantity) -> sku (cap=inf) -> SINK (cap=quantity)."""
    INF = 1 << 30
    cap: dict[tuple[str, str], int] = {}
    adj: dict[str, set[str]] = {}

    def add_edge(u: str, v: str, c: int) -> None:
        cap[(u, v)] = cap.get((u, v), 0) + c
        cap.setdefault((v, u), 0)
        adj.setdefault(u, set()).add(v)
        adj.setdefault(v, set()).add(u)

    for idx, (quantity, acceptable) in enumerate(requirements):
        add_edge("SRC", f"req:{idx}", quantity)
        for sku in acceptable & present.keys():
            add_edge(f"req:{idx}", f"sku:{sku}", INF)
    for sku, quantity in present.items():
        add_edge(f"sku:{sku}", "SINK", quantity)

    total = 0
    while True:
        parent: dict[str, str | None] = {"SRC": None}
        queue = deque(["SRC"])
        while queue and "SINK" not in parent:
            u = queue.popleft()
            for v in adj.get(u, ()):
                if v not in parent and cap.get((u, v), 0) > 0:
                    parent[v] = u
                    queue.append(v)
        if "SINK" not in parent:
            return total

        path, node = [], "SINK"
        while parent[node] is not None:
            path.append((parent[node], node))
            node = parent[node]
        push = min(cap[e] for e in path)
        for u, v in path:
            cap[(u, v)] -= push
            cap[(v, u)] += push
        total += push
```

And the top-level entry point, which is where the `vct` exact match, the `sd_hash` binding, and the independently recomputed `checkout_hash` all land:

```python
def verify_checkout_mandate(
    closed: dict,
    kb_payload: dict,
    open_mandate: dict | None,
    open_sd_jwt_compact: str | None,
    merchant_checkout_jwt: str,
    checkout: dict,
) -> None:
    """Merchant-side verification. Raises MandateError on any failure.

    merchant_checkout_jwt is the compact JWT the MERCHANT issued -- never the
    copy the agent handed back. checkout is its decoded payload.
    """
    alg = kb_payload.get("_sd_alg", "sha-256")

    # 1. Exact vct match, version suffix included. No prefix matching.
    if closed.get("vct") != "mandate.checkout.1":
        raise MandateError(INVALID_CREDENTIAL, f"unexpected vct: {closed.get('vct')}")

    # 2. checkout_hash must be recomputed from the merchant's own JWT.
    expected = digest(merchant_checkout_jwt, alg)
    if closed.get("checkout_hash") != expected:
        raise MandateError(INVALID_MANDATE, "checkout_hash does not match this checkout")

    if open_mandate is None:            # Human Present: user signed the closed mandate
        return

    # 3. Autonomous: sd_hash binds this closed mandate to THIS open mandate.
    if open_mandate.get("vct") != "mandate.checkout.open.1":
        raise MandateError(INVALID_CREDENTIAL, f"unexpected open vct: {open_mandate.get('vct')}")
    if kb_payload.get("sd_hash") != digest(open_sd_jwt_compact, alg):
        raise MandateError(INVALID_MANDATE, "sd_hash does not bind to the presented open mandate")
    if "cnf" not in open_mandate:
        raise MandateError(INVALID_CREDENTIAL, "open mandate missing cnf (agent key)")

    # 4. Claims carried on the open mandate MUST survive unchanged.
    for claim, value in open_mandate.items():
        if claim in RESERVED:
            continue
        if closed.get(claim) != value:
            raise MandateError(INVALID_MANDATE, f"claim '{claim}' altered when closing")

    # 5. Every constraint evaluated. Unknown types fail closed.
    for c in open_mandate.get("constraints", []):
        fn = EVALUATORS.get(c.get("type"))
        if fn is None:
            raise MandateError(UNRESOLVED_CONSTRAINT, f"unknown constraint: {c.get('type')}")
        fn(c, closed, checkout)
```

Two details in that function are the ones teams get wrong. `merchant_checkout_jwt` must be the merchant's *own* copy of the checkout, re-read from its own store — hashing the JWT the agent handed back verifies nothing, since the agent supplied both sides of the comparison. And `UNRESOLVED_CONSTRAINT` is deliberately distinguished from `INVALID_MANDATE`: it is a *recoverable* error that signals a fallback to a human-present flow, while `INVALID_MANDATE` and `INVALID_CREDENTIAL` are terminal. Collapsing all three into one failure path throws away the protocol's graceful degradation and turns a "ask the user to confirm" into a lost sale.

Whatever the outcome, the verifier **MUST** return a signed receipt — `status` (`Success` / `Error`), `iss`, `iat`, and `reference`, the base64url hash of the final mandate in the chain. Success receipts additionally require `order_id` (checkout) or `payment_id`, `psp_confirmation_id`, and `network_confirmation_id` (payment). The agent then stores the (open mandate, closed mandate, receipt) tuple and *reduces the scope of the open mandate* — usually to nothing.

---

## Human present vs. human not present

| | Human Present (Direct) | Human Not Present (Autonomous) |
|---|---|---|
| What the user approves | The finalized closed Checkout and Payment | A set of constraints in open mandates |
| Who signs the closed mandate | Trusted Surface, with the user key | Shopping Agent, with its own key |
| `cnf` required on open mandate | n/a | Yes — the agent's public key |
| What the verifier receives | Closed mandate | Open + closed chain, plus needed disclosures |
| Verification basis | User signature, or a trust list of agent providers | Constraint evaluation against the open mandate |
| Fallback | — | Return `unresolved_constraint` to pull the user back in |

That last row is the escape hatch, and it is the single most useful operational feature in the spec. A merchant that cannot evaluate a constraint — because it does not recognize the type, or because the request is not for a specific SKU — returns `unresolved_constraint` and the flow converts back into a human-present approval. The autonomous path is optimistic; the human-present path is the guaranteed one underneath it.

Both modes reach the same terminal state. *"Verifiers of Mandates always receive a closed Payment and Checkout Mandate, regardless of the mode."*

---

## Where A2A and x402 plug in

AP2 is explicitly *"an extension for emerging agent-to-agent (A2A), model-context protocols (MCP), and Universal Commerce Protocol (UCP)"* — it is a security layer, not a transport, and it deliberately leaves catalog APIs and checkout mechanics to the commerce protocol underneath. If you have already built on the interop layer we covered in [A2A v1.0 production patterns](/lab/a2a-protocol-v1-production/), AP2 rides on top of it: the reference implementations carry mandates over A2A between the Shopping Agent, Merchant Agent, Credential Provider, and payment processor.

The crypto path is where the composition gets concrete. The [a2a-x402 extension](https://github.com/google-agentic-commerce/a2a-x402) defines two modes, and the second is the AP2 one:

- **Standalone flow** — `x402PaymentRequiredResponse` travels in `task.status.message.metadata` under `x402.payment.required`, and the signed `PaymentPayload` comes back in `message.metadata`.
- **Embedded flow** — the x402 objects are nested *inside* AP2 mandates carried in `task.artifacts` and `message.parts`. The agent card advertises both extensions.

```json
{
  "capabilities": {
    "extensions": [
      {
        "uri": "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2",
        "description": "Supports payments using the x402 protocol for on-chain settlement.",
        "required": true
      }
    ]
  }
}
```

The extension spec names the impedance mismatch precisely: AP2 was designed around **pull** payment methods, where a signed mandate authorizes a merchant to pull funds via a token, while x402 is a **push** method, where the signed payload *is* the authorization to move funds on-chain. It resolves this with three signing patterns — atomic signing (one user approval, two background signatures), delegated signing (the pre-authorized agent signs both with its own key — exactly AP2's Human-Not-Present model), and smart-contract escrow (the user's signed order acts as the credential that releases pre-deposited funds).

That plumbing is not academic. Coinbase's x402 processed **169 million payments in its first year across 590,000 buyers and 100,000 sellers**, per [Forbes](https://www.forbes.com/sites/digital-assets/2026/06/07/visa-mastercard-and-coinbase-are-fighting-over-how-ai-agents-pay/). Machine-to-machine payment volume already exists; AP2's contribution is the authorization evidence wrapped around it.

---

## Production gotchas

**Double-spend is the agent's job to prevent, and the LLM must not be able to interfere.** The spec's mitigation is blunt: *"The non-deterministic portion of the Shopping Agent MUST avoid signing multiple, overlapping closed Mandates for the same open Mandate without receiving Receipts rejecting the previously released Mandates"* — and those receipts *"MUST be integrity protected from the Shopping Agent's LLM."* In practice that means the agent key lives behind deterministic code that validates a proposed closed mandate before signing it, and receipt state lives somewhere the model cannot rewrite. This is the same trust-boundary discipline that makes [MCP tool poisoning](/lab/mcp-tool-poisoning/) survivable: the model proposes, deterministic code disposes. The [implementation considerations](https://ap2-protocol.org/ap2/implementation_considerations/) suggest doing exactly this through the tool layer — see [the anatomy of AI agent tool calling](/lab/anatomy-of-ai-agent-tool-calling/) for how a purchase call actually reaches a signing tool, and why that boundary is the right place to put a hard gate.

**Amounts are minor units in the schemas — but not in every example.** `types/amount.json` defines `amount` as an integer in ISO 4217 minor units, and `payment.amount_range` defines `min`/`max` as integers. The worked open-mandate example in the repo agrees (`"max": 20000`). The prose example under the Amount Range constraint does not: it shows `"max": 100.50, "min": 10.00`. `payment.budget` muddies it further by typing `max` as `number` rather than `integer`. Normalize to minor-unit integers at your boundary and reject decimals — this is a factor-of-100 bug waiting on a mismatched pair of implementations.

**Hash algorithm consistency is a requirement, not a convention.** `checkout_hash`, `sd_hash`, and the receipt `reference` must all use the SD-JWT's `_sd_alg`, defaulting to `sha-256`. The spec states it plainly: *"For consistency, the same hashing algorithm is required for both the SD-JWT digests and `checkout_hash`."* Store the SD-JWTs and their disclosures in compact serialization so those hashes stay recomputable at dispute time, which may be a year later.

**Secondary sources are stale, and so is some tooling.** Nearly every third-party explainer describes AP2's v0.1 model of three mandates — Intent, Cart, and Payment. That model is gone; v0.2 has Checkout and Payment, each with an open variant. The lag is not confined to blog posts: the a2a-x402 v0.2 spec and several AP2 sample READMEs still reference `ap2.mandates.CartMandate` and `CartMandate` artifacts. Read the [current specification](https://ap2-protocol.org/ap2/specification/) and the JSON schemas in `code/sdk/schemas/ap2/` as the source of truth, and expect to translate when reading integration examples.

**Nothing in AP2 obliges the agent to be honest — only to be bounded.** Constraint evaluation is what makes prompt injection survivable rather than catastrophic. As the threat model puts it: *"Even if the LLM fails to make the optimal choice, constraint enforcement during closed Mandate verification ensures that the worst-case financial and logical impacts are strictly bounded."* If you skip the constraint evaluators, you have implemented AP2's ceremony and none of its security.

---

## Should you adopt AP2 now?

Build against AP2 today if you are a merchant, PSP, or credential provider whose counterparties will be agents within the year — the verifier side is deterministic code you can write and test now, against a spec that is stable enough to have shipped a versioning mechanism. Build against it if you are shipping a shopping agent that will ever transact without a human watching, because the open-mandate machinery is the only standardized way to bound that agent's spend.

Wait if your agent's purchases are all human-present today and your payment path already runs through a conventional checkout. The spec itself notes that in the direct flow *"this can often be replaced with a traditional e-commerce journey where the Merchant and the Trusted Surface communicate directly."* AP2's value concentrates in the autonomous case and in dispute evidence. If you have neither yet, adopt the *discipline* — deterministic verification, minor-unit amounts, a signing boundary the model cannot cross — and adopt the wire format when a counterparty asks for it.

What is no longer speculative is the direction. Two mandate types, SD-JWT credentials, exact `vct` matching, fail-closed constraints, and a FIDO Alliance home: the shape of agentic payment authorization is now settled enough to build against.

We do this work with teams putting agents in front of money — designing the signing boundary between the model and the key, writing the deterministic verifiers, and adversarially testing what a compromised agent can still spend. If your agents are about to start transacting, the mandate layer is the product. Build it before the first purchase, not after the first dispute.
