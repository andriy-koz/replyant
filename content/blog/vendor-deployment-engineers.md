---
title: "The $9B Land Grab: Vendors Now Deploy Their Own AI Engineers"
date: 2026-07-08
tags: ["AI Strategy", "Business Strategy", "AI Agents", "ROI"]
description: "Microsoft, OpenAI, Anthropic, and AWS committed ~$9B to embed their own deployment engineers in customers. What this fourth buyer path means for you."
author: "Replyant"
---

In ten weeks, four platform vendors committed roughly $9 billion to a single idea: sending their own engineers into customer organizations to build and run AI agent deployments. OpenAI launched a [$4B "Deployment Company"](https://www.forbes.com/sites/janakirammsv/2026/05/28/ai-giants-bet-billions-on-the-most-expensive-job-in-enterprise/) on May 11. Anthropic announced a [$1.5B+ joint venture](https://fortune.com/2026/05/04/anthropic-claude-consulting-industry-joint-venture-blackstone-goldman-sachs/) on May 4. AWS followed with a $1B forward-deployed-engineering initiative on June 30. And on July 2, Microsoft capped the run with [Frontier, a $2.5B unit staffed by 6,000 experts](https://www.geekwire.com/2026/microsoft-announces-2-5b-frontier-company-to-embed-ai-engineers-inside-customers/). For buyers, this changes the map: the [build-vs-buy decision](/blog/build-vs-buy-ai-agents/) now has a fourth path — the vendor-embedded deployment team — and it comes with trade-offs no vendor pitch deck will spell out for you.

## What just happened: four announcements in ten weeks

The sequence matters because it shows this is a coordinated industry shift, not one company's experiment.

**Anthropic, May 4.** A joint venture exceeding $1.5 billion with Blackstone, Hellman & Friedman, and Goldman Sachs — described by [Fortune](https://fortune.com/2026/05/04/anthropic-claude-consulting-industry-joint-venture-blackstone-goldman-sachs/) as the model maker explicitly "taking a shot at the consulting industry."

**OpenAI, May 11.** A $4 billion Deployment Company, majority-owned by OpenAI and backed by TPG, Goldman Sachs, Bain Capital, and McKinsey. To seed it with talent, OpenAI acquired Edinburgh-based Tomoro for its roughly 150 deployment engineers, per [Forbes](https://www.forbes.com/sites/janakirammsv/2026/05/28/ai-giants-bet-billions-on-the-most-expensive-job-in-enterprise/), which called forward-deployed engineering "the most expensive job in enterprise."

**Amazon, June 30.** AWS announced a $1 billion forward-deployed-engineering initiative — engineers embedded directly with customers to ship agentic workloads on AWS.

**Microsoft, July 2.** The largest single commitment: Frontier, a [$2.5 billion unit with 6,000 industry and engineering experts](https://www.cnbc.com/2026/07/02/microsoft-commits-2point5-billion-6000-employees-ai-implementation-unit.html), led by Commercial Business CEO Judson Althoff, who called it "the largest, most capable, outcome-driven engineering org." Early customers named at launch: London Stock Exchange Group, Unilever, Land O'Lakes — and, notably, [Accenture itself](https://techcrunch.com/2026/07/02/microsoft-launches-its-own-ai-deployment-company-with-2-5-billion-commitment/), one of the systems integrators these units compete with.

Total: approximately $9 billion committed to deployment and professional-services arms in under ten weeks.

## What is a forward-deployed engineer?

A forward-deployed engineer (FDE) is a vendor employee embedded inside a customer's organization who builds, integrates, and operates production systems on that vendor's platform. The model was popularized by Palantir, where FDEs sit with the customer's teams, own delivery outcomes, and translate messy operational reality into working software. The four new vendor units apply this model specifically to enterprise AI agent deployments.

## Why are platform vendors building deployment armies?

Because AI agent software does not deploy itself — and vendors know it. Forrester reports the average enterprise AI agent deployment cost roughly $276,000 in 2026, down from $358,000 in 2025 but still a substantial services expense on top of licenses. Gartner's Agentic AI Pulse 2026 finds only about 41% of agent rollouts reach positive ROI within 12 months, and roughly 19% never reach payback. The gap between "model access" and "working agent in production" is where deployments succeed or die.

That gap is exactly what we documented in our analysis of [why most businesses fail at AI agents](/blog/why-businesses-fail-at-ai-agents/): the model is rarely the problem. Integration, data plumbing, process redesign, evaluation, and ongoing operations are. A $9 billion collective bet on human deployment engineers is the vendors' own admission that the last mile is the hard mile.

There is a second, less charitable reading. Every FDE a vendor embeds is also a consumption-growth engine. A Microsoft Frontier engineer solves your problem on Azure. An OpenAI deployment engineer solves it on OpenAI's stack. The engineering help is real — and so is the flywheel it feeds.

## The four paths to getting an agent into production

Buyers now choose between four delivery models, each with a distinct profile of speed, lock-in, and incentive alignment.

| Path | Speed to production | Platform lock-in | Incentive alignment | Best for |
|---|---|---|---|---|
| **Vendor FDE team** (Microsoft Frontier, OpenAI Deployment Co, AWS, Anthropic JV) | Fastest — deepest platform expertise on tap | Maximal — solution is architected around one vendor's stack | Paid, directly or indirectly, to grow consumption of their own platform | Organizations already committed to a single platform at scale |
| **Traditional SI** (Accenture, Capgemini, EY, KPMG, PwC) | Slow — large-program governance and staffing cycles | Moderate — "agnostic" in name, but alliance revenue shapes recommendations | Billable hours and program scale; incentive is program size | Multi-year, multi-country programs needing armies and process |
| **Independent consultancy** (Replyant and peers) | Fast for scoped deployments; smaller teams, less overhead | Low — architecture chosen for the problem, portable by design | Paid for the outcome, not the platform; must earn trust on depth | Buyers who want the agent to work and the option to switch vendors later |
| **In-house build** | Slowest to first value; fastest to iterate after | Lowest — you own everything | Perfectly aligned — it's your team | Organizations where the agent *is* the product or core IP |

On the in-house path, the honest caveat from our [build-vs-buy analysis](/blog/build-vs-buy-ai-agents/) still stands: Forrester pegs the failure rate of fully in-house enterprise agent builds at roughly 75%, and every build you finish is a system you maintain forever.

## Should you use a vendor's deployment team?

Yes — if you have already made a deep, deliberate, single-platform bet. If your organization runs on Azure end to end and Microsoft is a strategic partner, Frontier engineers will get you to production faster than anyone, with escalation paths into the product teams that no outsider can match. The same logic applies to a committed AWS or OpenAI shop. The FDE model is genuinely the right call for that buyer.

It is the wrong call if platform choice is still an open question — because the vendor's team will close that question for you, by construction. You do not hire Microsoft Frontier to evaluate whether Bedrock or Claude fits your workload better. Every architectural decision an embedded vendor engineer makes defaults toward their employer's stack, and each of those decisions compounds into switching costs.

### The incentive question nobody puts on the slide

A vendor's deployment arm is paid — directly through services fees and indirectly through consumption growth — to increase usage of that vendor's platform. That is not an accusation; it is the business model, stated plainly in how these units are structured and funded. OpenAI's Deployment Company is majority-owned by OpenAI. Frontier reports into Microsoft's commercial organization. When the entity designing your architecture profits from your consumption, "how much platform do you need?" is not a neutral question, and you should not expect a neutral answer.

Traditional SIs have their own version of this problem: alliance-partner revenue and certification pyramids mean "platform-agnostic" often decays into "whichever alliance pays best," delivered slowly and expensively. The FDE units are, in part, a direct attack on that model — Anthropic's JV was framed exactly that way.

### How should executives decide between the four paths?

Run the decision on three questions. First, is your platform bet already made? If yes, vendor FDEs are efficient; if no, keep the architecture decision with a party that doesn't profit from the answer. Second, what does success cost and return? Model it before signing — our [AI ROI calculator](/blog/ai-roi-calculator/) and Gartner's 41%-payback figure are sobering baselines. Third, who owns the system in year two? Embedded engineers leave; your team inherits whatever they built.

A practical pattern we see working: use an independent party to define the architecture, evaluation criteria, and vendor-selection logic — then, if a single-platform bet emerges from that analysis, bring in the vendor's FDE team to execute it with full platform depth. Sequencing the neutral decision before the interested execution captures the strengths of both. And whichever path you pick, instrument it: [measure agent ROI](/blog/measuring-ai-agent-roi/) from week one, because the 19% of deployments that never reach payback rarely lacked engineers. They lacked a business case anyone was accountable to.

## What the $9B signal means for buyers

Strip away the announcements and one message remains: the four companies that build the platforms just told you, with $9 billion of conviction, that buying their software is not the same as getting value from it. That is worth taking seriously regardless of which delivery path you choose.

Replyant sits in the third row of that table, so read this with that in mind: we are an independent consultancy, and independence is our product. We do not earn consumption revenue from Microsoft, OpenAI, Anthropic, or AWS, which means our recommendation of any of them costs us nothing and earns us nothing — the architecture we design is the one your problem needs, built to stay portable. We will also tell you when a vendor FDE team is the better choice for your situation, because sometimes it is. If you are deciding which of the four paths fits your organization, that decision itself is the one place where a party with no platform stake is unambiguously the right advisor. [Talk to us](/contact/) before the architecture gets decided for you.
