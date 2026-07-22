---
title: "Your AI Agent Can Now Spend Money. Who Eats the Loss?"
date: 2026-07-22
tags: ["AI Agents", "Business Strategy", "Compliance", "Automation"]
description: "Visa put its rails inside ChatGPT in June. No rulebook says who pays when an agent overspends. The seven controls finance needs before the first dispute."
faq:
  - q: "Who is liable when an AI agent makes a bad purchase?"
    a: "Nobody has settled it. Darwinium surveyed 500 senior fraud, risk, and security professionals across the US and UK in February 2026 and found no consensus: 39% put liability on the AI provider, 20% on the customer, 14% on the merchant or platform, 11% on the bank, and 15% favored a shared model. Card network rules currently treat agent purchases as ordinary card-not-present transactions, so the delegating party usually absorbs the loss by default."
  - q: "What payment infrastructure for AI agents went live in 2026?"
    a: "Visa integrated its Intelligent Commerce network into ChatGPT on June 10, 2026, giving agents direct checkout across Visa's acceptance network. Mastercard agreed in March 2026 to acquire stablecoin platform BVNK for up to $1.8 billion. Google's Agent Payments Protocol shipped v0.2.0 in April 2026 and moved to the FIDO Alliance. Coinbase's x402 machine-payment protocol reports 169 million payments in its first year."
  - q: "Why do chargebacks break for agent-initiated transactions?"
    a: "Chargeback frameworks were built to answer one question: did the cardholder authorize this? When a cardholder delegates authority to an agent that then buys ten units instead of one, the transaction is technically authorized, so it fails the unauthorized-use test while still being wrong. Merchants and issuers also lack the evidence layer — the signed record of what the user actually asked for — needed to adjudicate the dispute."
  - q: "What controls should finance teams put on agent spending?"
    a: "Seven: write an explicit spend mandate before issuing any credential, issue per-agent virtual cards with hard caps and instant revocation, enforce merchant allowlists and category blocks, set human-approval thresholds tiered by amount and reversibility, capture a signed mandate-to-settlement audit trail, move agent reconciliation to a daily cycle with its own GL treatment, and negotiate liability allocation into every agent platform contract."
author: "Replyant"
---

Agentic payment rails went live faster than any control framework around them, and the gap is now measured in quarters, not years. On June 10, 2026, Visa plugged its Intelligent Commerce network directly into ChatGPT, letting an AI agent shop and pay across Visa's acceptance network on a consumer's behalf. Six weeks later, when Darwinium asked 500 senior fraud, risk, and security professionals in the US and UK who should pay when an agent-driven transaction goes wrong, the answers split five ways: 39% said the AI provider, 20% the customer, 14% the merchant or platform, 11% the bank, and 15% wanted a shared model. That is not a debate. That is an absence of law. Your first disputed agent transaction will be adjudicated by whoever has the better contract, and right now that is not you.

This post covers what actually shipped in the last ninety days, why chargeback and audit frameworks built around a human pressing "buy" fail on contact with delegated purchasing, what regulators have and have not said, and the seven-control framework finance and procurement leaders should install before the first disputed transaction — not after.

---

## What actually shipped in the last ninety days?

Agentic payment infrastructure moved from pilot to production across all four major rails between March and July 2026. Card networks, stablecoin settlement, and protocol standards all crossed the line in the same window. The controls, dispute rules, and accounting treatment did not move at all. That asymmetry is the entire risk.

The card networks moved first and hardest. Visa's June 10 integration with ChatGPT — announced at Visa's Payments Forum — connects agent checkout to Visa's full acceptance network, which the company puts at roughly 175 million merchant locations and 4.8 billion payment credentials. Mastercard's Agent Pay framework, built on Agentic Tokens that bind a tokenized credential to a specific agent, merchant scope, and consent policy, has been in market since April 2025 and is now the reference architecture for issuer-side agent enablement.

The settlement layer moved in parallel. Mastercard agreed in March 2026 to acquire stablecoin platform BVNK for up to $1.8 billion. Visa reports its stablecoin settlement reached a $7 billion annualized run rate by April 2026 across more than 130 card programs in 50-plus countries, growing roughly 50% quarter over quarter — Visa's own figures, not independently audited. Coinbase's x402 protocol, which revives the dormant HTTP 402 status code to let machines pay machines in USDC without card rails at all, reports 169 million payments in its first year across roughly 590,000 buyers and 100,000 sellers. Those are company-reported numbers too, and they describe a payment channel that has no chargeback mechanism whatsoever.

The standards layer moved last and matters most. Google's Agent Payments Protocol (AP2), announced in September 2025 with 60-plus partners including Mastercard, PayPal, Coinbase, American Express, and Salesforce, shipped v0.2.0 in April 2026 and added "Human Not Present" flows — pre-authorized purchases an agent executes with no interactive consent prompt at the moment of sale. Google and Mastercard subsequently contributed AP2 and the related Verifiable Intent work to the FIDO Alliance. AP2's core idea is sound: represent every agent purchase as signed, tamper-evident mandates recording what the user authorized and what payment they authorized, so there is a durable record of consent. Our companion piece dissects [how AP2 structures mandates, signing, and delegation at the protocol level](/lab/ap2-agent-payments-protocol/) for readers who need the technical detail.

Here is the problem. AP2 is a protocol, not a rule. It can produce the evidence, but no network rulebook currently requires that evidence to be captured, no clearing message carries it, and no dispute process asks for it. Visa's own Trusted Agent Protocol proposes adding agent identity and intent data to the transaction, but as of July 2026 that data does not appear in clearing records or dispute evidence. The plumbing to prove what an agent was told to do exists. The obligation to keep it does not.

---

## Who eats the loss when the agent buys the wrong thing?

Whoever delegated the authority — by default, and in most cases, that is you. Card network rules currently treat agent-initiated purchases as ordinary card-not-present e-commerce transactions. If the cardholder validly authenticated the agent, the transaction is authorized, and "authorized but wrong" is not a chargeback reason code. An agent that orders ten washing machines instead of one has not committed fraud. It has executed a delegation badly, and there is no rail for that.

This is the failure mode we mapped in [the agent privilege crisis](/blog/agent-privilege-crisis/), extended from data access into money. The pattern is identical: an agent is granted authority nobody scoped tightly, the authority is exercised faster than any human review cycle, and the blast radius is the full extent of what the credential permitted. The difference is that an over-permissioned data agent leaks information you then have to disclose. An over-permissioned payment agent moves cash you then have to recover — and recovery has a legal path only if someone wrote one into a contract.

The table below is the comparison every CFO should put in front of their treasury and procurement leads.

| Question | Human-initiated purchase | Agent-initiated purchase |
|---|---|---|
| Who authorizes the transaction? | The cardholder, at the moment of sale | The cardholder, in advance, via a mandate of unclear scope |
| What proves intent? | Checkout session, IP, device, 3-D Secure | A mandate that no clearing message currently carries |
| Who verifies the item is correct? | The buyer, before clicking | Nobody — the agent verifies its own cart |
| Is "wrong purchase" a chargeback? | Sometimes — item not as described, not received | Rarely — the transaction was technically authorized |
| Who eats a fraud loss? | Issuer, under network liability rules | Issuer if authentication held; otherwise contested |
| Who eats a mandate failure? | Not applicable | Unallocated — settled by contract, if a contract exists |
| Audit trail | Receipt, order confirmation, expense report | Model logs, if anyone retained them |
| Spend ceiling | Card limit plus human judgment | Card limit only |
| Speed of exposure | One transaction at a time | Hundreds per minute |

The bottom four rows are where finance teams get hurt. Human judgment is a real control, and it is the one you removed. Every agent deployment silently converts a soft limit — a person who would have noticed the order was for ten units — into a hard limit that only exists if someone configured it.

---

## Three exposures finance has not budgeted for

### The dispute evidence gap

Merchants and issuers now own disputes they cannot defend, because the evidence that would settle them was never captured. Adyen's 2026 fraud report — based on roughly $1.6 trillion in 2025 platform volume plus a survey of 1,000 US enterprise decision makers conducted in early March 2026 — found first-party fraud is now the most common fraud type, cited by 44% of enterprises, while the cost of handling a single dispute rose to $82 from $74 in 2024. Traditional chargeback fraud losses on Adyen's platform actually fell 20% in 2025. The losses are migrating from stolen cards to disputed-but-authorized transactions, which is precisely the category agent purchases land in.

Now add volume. Adyen projects AI agents will influence between 5% and 20% of payment volume within five years, and 30% of merchants already name AI-platform trust scoring as the most critical new signal they need. A disputed-transaction category that costs $82 per case to handle, is growing fastest, and has no standardized evidence format is a budget line nobody has opened yet.

### Agents are now a payments attack surface

Mid-transaction manipulation is the exposure nobody models. An agent that reads a merchant page, a product description, or a support chat is reading attacker-controllable text, and prompt injection against a purchasing agent is not a data-leak scenario — it is a funds-transfer scenario. Visa's own threat research reports a 25% increase in malicious bot-initiated transactions over a six-month period, rising to 40% in the US, and Visa's Payment Ecosystem Risk and Control team documented a greater-than-450% increase in dark-web posts referencing "AI agents" over a comparable window. Criminal interest is running ahead of enterprise controls.

Darwinium's February 2026 survey sharpens the operational picture: 97% of respondents report increased AI-facilitated attacks, 52% cannot explicitly track or label AI-assisted fraud at all, and respondents put average annual AI-enabled fraud impact at $4.5 million. Forty-six percent named authentication and identity binding — knowing which agent is acting for whom — as the top blocker to adopting agentic commerce. Meanwhile 48% already allow agentic traffic with monitoring and 31% block it outright, which means the market is split between two positions and neither is a control framework.

### Reconciliation breaks when the buyer is not a person

Every accounting control in your close cycle assumes a named human requester. Purchase orders route to an approver. Expense reports attach to an employee. Segregation of duties separates the person who requests from the person who approves from the person who pays. An agent transaction has no employee, produces no expense report, and collapses request and approval into a single automated step executed in milliseconds.

The practical consequence lands at month-end. Card feeds arrive with merchant descriptors and no requester, GL coding has no cost-center owner to infer from, and the reasoning that produced the purchase — what the agent was asked to do, what it considered, why it chose that SKU at that price — lives in model logs that were never designed as financial records and are frequently not retained past a debugging window. Under SOX, an unexplained material transaction with no traceable approval chain is a control deficiency regardless of how small the dollar amount is. This is the same discipline problem we described in [running finance operations on agentic AI](/blog/agentic-ai-finance-operations/), except the transaction is external, irreversible, and settled before anyone reviews it.

---

## What have regulators actually said?

Less than you need and more than you think. No jurisdiction has enacted a rule that specifically assigns liability for an autonomous agent purchase. But the UK's Competition and Markets Authority published guidance on March 9, 2026 establishing the principle that will almost certainly generalize: businesses are responsible for the conduct of their AI agents in the same way they are responsible for their employees, and that responsibility holds even when a third party designed or supplied the agent.

That last clause is the one to read twice. "The vendor's model did it" is not a defense the CMA accepts. Under the Digital Markets, Competition and Consumers Act, breaches can draw fines of up to 10% of worldwide turnover. UK-facing businesses are already inside a regime that treats an agent's misconduct as the deploying company's misconduct.

The industry is racing to write the rest. On July 20, 2026 — two days ago — the Emerging Payments Association Asia launched an AI and Agentic Payments Working Group with HSBC as a founding member, explicitly chartered to define agent identity standards and "liability and trust frameworks defining responsibility when agents exceed their mandate." EPAA CEO Camilla Bullock's framing of the problem is the honest one: every organization in the industry is trying to solve this independently, in isolation from regulators. The rulebook is being drafted right now, in working groups, by the parties who will benefit most from the outcome. Companies that wait for it will inherit terms written by their counterparties.

The operative point for executives: liability that regulation has not allocated gets allocated by contract. That is not a reason to wait. It is a reason to get to the redline first.

---

## The seven-control framework for agent spend

These controls are not exotic. They are the procurement, treasury, and audit disciplines your organization already applies to corporate cards and delegated purchasing authority, rebuilt for a principal that acts in milliseconds and never asks a colleague whether ten units seems like a lot. Install them before the first agent touches a payment credential, and plug them into [the broader agent governance framework](/blog/ai-agent-governance/) rather than running them as a payments-only silo.

**1. Write the spend mandate before you issue the credential.** Every purchasing agent gets a written mandate specifying maximum transaction value, maximum cumulative spend per day and per month, permitted merchant categories, permitted item types, and an explicit expiry date. This is a document a human signs, not a config file a developer edits. If nobody in finance can state the agent's spending authority in one sentence, the agent is not ready to hold a credential.

**2. Issue per-agent payment credentials with hard caps and instant revocation.** Never let an agent transact on a shared corporate card. Every agent gets its own virtual card — through Stripe Issuing, Lithic, your commercial issuer, or your existing spend-management platform — with a card-level limit that enforces the mandate in the authorization stream rather than in a policy document. The credential must be revocable in one action, by one named owner, without a vendor support ticket. Instant revocation is the only control that works at machine speed.

**3. Enforce merchant allowlists and category blocks.** Default-deny at the merchant level. An agent that procures software licenses has no business authorizing at a merchant category code for travel, gift cards, or money transfer. MCC blocklists and per-merchant allowlists are standard issuer functionality and cost nothing to configure. This single control converts the worst-case loss from "the card limit" to "the card limit at merchants you already approved."

**4. Set human-approval thresholds tiered by amount and reversibility.** Two dimensions, not one. Dollar value sets the first tier — under $100 autonomous, $100 to $2,500 asynchronous review, above $2,500 pre-approval. Reversibility sets an override — non-refundable purchases, custom orders, annual commitments, and anything with a cancellation penalty require human approval at any amount. Most agent spend incidents are not large. They are small, irreversible, and repeated.

**5. Capture the mandate-to-settlement audit trail.** For every agent transaction, retain the instruction the agent received, the constraints it operated under, the options it evaluated, the item and price it selected, the credential used, the authorization response, and the settlement record — linked by a single transaction identifier, in append-only storage, with a retention period that matches your financial records policy, not your application logging policy. AP2-style signed mandates give you the format. Retention is a decision you have to make yourself, and auditors will ask for the reasoning trace, not just the amount.

**6. Move agent reconciliation to a daily cycle with its own GL treatment.** Agent transactions get their own GL accounts or cost-center dimension so they are separable from human spend in every report. Reconcile them daily, not monthly. A monthly close is a thirty-day detection window on a system that can transact hundreds of times an hour, and detection latency is the variable that determines whether an incident is a refund conversation or a write-off. Instrument the spend the same way you would instrument [agent token and infrastructure costs](/blog/agentic-ai-token-costs/) — as a live unit-economics feed, not a retrospective line item.

**7. Negotiate liability allocation into every agent platform contract.** Since regulation has not assigned the loss, your contracts must. Get four things in writing with any platform whose agent transacts on your behalf: an explicit statement of who bears loss when the agent exceeds its mandate, a commitment that your chargeback and dispute rights are preserved and not waived by the agent flow, an obligation on the vendor to retain and hand over mandate and reasoning evidence to support a dispute, and a cap-and-indemnity structure sized to your realistic worst case rather than to the annual contract value. Model that worst case explicitly — the same discipline we apply to [measuring agent ROI](/blog/measuring-ai-agent-roi/) works here, with the downside scenario replacing the benefit case.

---

## What waiting costs

The economics are already legible. Adyen puts the cost of handling a single dispute at $82 and reports that 50% of enterprises now see rising false declines, with static fraud controls blocking as much as 10% of legitimate checkout traffic — which means the naive response to agent fraud, tightening rules, has a revenue cost of its own. Global e-commerce fraud is projected to exceed $100 billion by 2029, up from $44 billion in 2024. Seventy percent of businesses in Adyen's survey expect fraud to constrain revenue growth over the next 12 to 24 months.

Now stack the exposure. An uncontrolled purchasing agent produces an unrecoverable direct loss, a dispute process with no defensible evidence, a SOX control deficiency at close, a potential CMA exposure if the transaction touches UK consumers, and a contract negotiation you conduct from the weakest possible position — after the incident, against a vendor whose terms you already accepted. The controls above cost a few weeks of finance and engineering time. The first uncontrolled incident costs the loss plus every downstream consequence, and it arrives without warning because the agent will have done exactly what it was permitted to do.

Visa reports a 4,700% surge in AI-driven traffic to US retail sites. That is Visa's own number, not an audited one, and directionally it is the only number that matters: agent traffic is arriving at commerce endpoints far faster than any control cycle your organization runs. The question is not whether your agents will transact. It is whether the first one to transact wrongly does so inside a boundary you drew or outside one you never drew.

---

## The Bottom Line

Agentic commerce is real infrastructure now — Visa inside ChatGPT, Mastercard buying settlement rails, protocols moving to standards bodies, machine-to-machine payments in the hundreds of millions. What did not ship alongside it is any settled answer to the only question finance actually needs answered: when an agent overspends, buys the wrong thing, or is manipulated mid-transaction, who eats the loss? Regulators have not allocated it. Card network rules treat the transaction as authorized. Fraud professionals cannot agree on it five ways. In that vacuum, the loss lands on whoever failed to write the contract and configure the cap.

Executives do not need to wait for the rulebook. They need a mandate document, a per-agent credential with a hard limit, a merchant allowlist, an approval threshold tied to reversibility, an audit trail that survives to close, a daily reconciliation, and a liability clause. That is a quarter of work, and it converts an unbounded exposure into a budgeted one.

Replyant designs and installs agent spend controls for finance, procurement, and operations teams — mandate scoping, credential architecture, approval tiering, reconciliation design, and the vendor contract terms that decide who actually pays when an agent gets it wrong. If your agents are about to touch a payment credential, or already have, [let's talk](/contact/).
