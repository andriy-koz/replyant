---
title: "The $2-Per-Resolution Era: AI Agent Pricing Just Flipped"
date: 2026-07-05
tags: ["Pricing", "AI Agents", "Business Strategy", "ROI"]
description: "AI agent pricing flipped from per-seat to per-outcome. That quietly moves risk to the buyer. The procurement playbook for negotiating per-resolution deals."
author: "Replyant"
---

AI agent pricing flipped this quarter, and the flip moves risk onto your side of the table. This week Salesforce began charging Help Agent customers $2 per resolution — billed only when the agent closes a case without a human escalation. HubSpot cut its Customer Agent to $0.50 per resolved conversation. Intercom and Zendesk price the same way. On paper, outcome-based pricing looks like the fairest deal in software history: you pay only when the machine works. In practice, the vendor writes the definition of "works," meters it on infrastructure you cannot audit, and hands you the bill. If your renewal is coming up, your cost model just changed from a headcount question to a unit-economics question — and the person who defines the unit is not you.

This is a procurement problem, not a technology problem. The playbook below is how ops leaders, founders, and CFOs should evaluate and negotiate per-outcome agent contracts before signing.

---

## The pricing model changed three times in eighteen months

Salesforce alone has now shipped three distinct Agentforce pricing models in roughly eighteen months: $2 per conversation at launch, Flex Credits at $0.10 per action in May 2025, $125-per-user-per-month licenses, and now $2 per resolution. To meter it, Salesforce introduced "Agentic Work Units" — a new consumption unit that counts AI-driven actions like workflow execution and case resolution. That is not a company that has settled on how to charge you. It is a company running live pricing experiments on its customer base, and every reset lands in a renewal cycle.

The direction of travel is industry-wide. HubSpot's $0.50 per resolved conversation undercuts Intercom by half and Zendesk's committed rate by two-thirds. Futurum's 1H 2026 buyer survey found 43% of buyers now prefer consumption-based pricing and 27% prefer outcome-based — a combined 70% walking away from the per-seat model they grew up on. Gartner projects that at least 40% of enterprise SaaS spend shifts to usage-, agent-, or outcome-based models by 2030, with seat-based revenue share falling from 21% to 15%. The seat is dying. The outcome is the new invoice line, and it is a line you have far less control over. We traced the licensing side of this shift in [the AELA pivot that repriced enterprise AI](/blog/aela-pricing-pivot/); this is its downstream consequence at the desk where contracts get signed.

---

## Why "pay only when it works" quietly favors the vendor

Per-seat pricing had one great virtue for the buyer: the unit was unambiguous. A seat is a person, you know how many you have, and nobody disputes the count. Outcome-based pricing replaces that clean unit with a contested one. Every question that used to be settled — what am I paying for, how is it counted, who verifies it — is now open, and the vendor answers all three by default.

### What counts as a billable resolution?

A resolution is whatever the contract says it is, and the first draft is written by the party that gets paid per resolution. Does an auto-close after 48 hours of customer silence count? A deflection to a help article? A conversation the customer abandoned in frustration? Under a permissive definition, the agent "resolves" cases it never actually solved — and you pay $2 each. The definition is the price. Negotiate it first, in writing, before anything else.

### How do you avoid paying twice for the same problem?

You cap re-bills contractually, because the vendor's default is to charge again. When a "resolved" case reopens, escalates to a human, or generates a duplicate ticket within days, a naive contract bills the second touch as a fresh resolution — you pay twice for one unsolved problem. Demand a reopen window: any case reopened within 7 to 14 days is the same resolution, billed once. Without that clause, false resolutions become a revenue feature for the vendor.

### Who verifies the meter?

Right now, the vendor does — alone. Agentic Work Units and per-resolution counts are computed inside the vendor's platform, on logs you typically cannot inspect. You receive a number and an invoice. In every other metered utility — electricity, cloud, telecom — buyers eventually won audit rights over the meter. Agent contracts have not caught up. Until you negotiate audit and export rights, you are trusting the counterparty's arithmetic on the exact figure that determines your bill.

---

## Per-seat versus per-outcome: run both models before you sign

The renewal decision is a modeling exercise. Take your actual case volume, apply a realistic resolution rate, and compare the per-outcome total against your current per-seat cost at low, expected, and high volume. Outcome pricing wins on low-volume, high-value workloads and loses badly on high-volume support queues where a per-resolution fee multiplies faster than any headcount ever could.

| Question | Per-seat model | Per-outcome model |
|---|---|---|
| What is the unit? | A named user — unambiguous | A "resolution" — vendor-defined |
| Who controls the bill? | You (you set headcount) | The agent's behavior + the definition |
| Cost at 3x volume | Flat | Scales linearly, uncapped by default |
| Failure cost | You paid regardless | You pay only for "successes" — but who scores them? |
| Budget predictability | High | Low without caps and floors |
| Biggest risk | Paying for idle seats | Paying for false resolutions you can't audit |

Model it the way we lay out in [our framework for measuring AI agent ROI](/blog/measuring-ai-agent-roi/), and pressure-test the total with [the ROI calculator](/blog/ai-roi-calculator/) at 50%, 100%, and 300% of forecast volume. If the per-outcome worst case is not survivable, you do not have a deal — you have a liability with a friendly sticker price. The consumption mechanics behind that worst case are the same ones driving [the token and FinOps cost story](/blog/agentic-ai-token-costs/).

---

## The negotiation levers that actually move risk back

Outcome pricing is negotiable, but only on terms you raise. Vendors do not volunteer these. Bring the following to the redline:

- **Resolution definition.** Get an exhaustive, written definition of what triggers a billable resolution. Exclude auto-closes, silent timeouts, pure deflections, and any case the customer reopens. If it is not in the contract, it will be defined against you.
- **Reopen and clawback window.** Any case that reopens or escalates within 7 to 14 days is not a new resolution. Add a clawback: false resolutions — ones later handled by a human — are credited back, not re-billed.
- **Caps and floors.** Negotiate a monthly spend cap so a runaway agent cannot generate an unbounded invoice. Expect the vendor to want a floor (minimum commit); trade it for a lower per-unit rate and a hard ceiling.
- **Audit and export rights.** Secure the right to export raw resolution logs and independently verify the count. Metering you cannot inspect is a number you cannot dispute.
- **Quality gate.** Tie billing to a measured resolution quality or CSAT threshold. If the agent's resolution quality drops below an agreed bar, the per-outcome rate drops or pauses. This aligns the vendor with outcomes you actually want.
- **Rate protection at renewal.** Lock the per-unit price and the definition for the full term. The definition drifting at renewal is how "shared risk" quietly becomes your risk.

---

## The gotcha: you're pricing agents that underperform their pilots

Here is the trap under the whole conversation. Only 11% of enterprises run agents in production despite 79% adoption — and buyers are signing outcome-based contracts on capabilities that routinely underperform their pilots. A demo agent resolving 70% of cases in a curated sandbox often resolves 40% against live, messy traffic. If your model assumed the pilot's resolution rate, your per-outcome math is wrong before the ink dries — and wrong in the vendor's favor when the definition is loose enough to bill the near-misses.

This is why the definition and the quality gate matter more than the rate. A generous $0.50 per resolution is a bad deal if half those "resolutions" are cases a human has to redo. Stress-test the vendor's resolution rate against your own data, not their pitch deck — the gap between pilot and production is [where most agent economics quietly break](/blog/ai-pilot-to-production/). And before you sign any per-outcome deal, ask whether the capability should be bought at all, or built and metered on your own terms, a decision we frame in [build versus buy for AI agents](/blog/build-vs-buy-ai-agents/) as the SaaS stack itself gets [rewritten by agents](/blog/ai-agents-vs-saas-stack/).

---

## The Bottom Line

Outcome-based AI agent pricing has arrived in production, and it is genuinely fairer in principle — you pay when the work gets done. But "the work" is defined, counted, and verified by the party collecting the fee, and that asymmetry is the entire negotiation. The buyers who win in the $2-per-resolution era are the ones who treat the resolution definition as the real price, cap their downside, win audit rights over the meter, and model per-outcome cost against per-seat cost at three volume scenarios before renewal. The ones who sign the friendly sticker price will discover, in quarter three, that they bought a metered utility with no meter they can read.

Replyant helps ops and finance leaders evaluate, model, and negotiate outcome-based agent contracts — from resolution definitions to clawback terms to the renewal math that decides whether the deal is a bargain or a liability. If a per-outcome renewal is on your desk, [let's talk](/contact/).
