---
title: "Agent Washing: A Buyer's Field Guide to Fake AI Agents"
date: 2026-06-22
tags: ["AI Agents", "AI Strategy", "Business Strategy", "Automation"]
description: "Vendors call everything 'agentic.' Gartner says ~130 of thousands actually are. A buyer's rubric to spot agent washing before you sign."
faq:
  - q: "What is agent washing?"
    a: "Agent washing is the practice of rebranding existing technology — chatbots, robotic process automation, rules engines, or AI-assisted tools — as 'AI agents' to ride the agentic wave. The product hasn't changed; the marketing has. Gartner found that among thousands of self-described agentic vendors, only roughly 130 are genuinely agentic. Because the term has no enforced definition, the burden of proving the claim falls on you, the buyer."
  - q: "How can you tell a real AI agent from a fake one?"
    a: "A genuine AI agent pursues a goal, reasons about how to achieve it, selects and uses tools dynamically, and adapts when reality doesn't match the plan. A chatbot only responds within a fixed script. The difference is autonomy over a multi-step task, not how natural the conversation sounds — the same line we draw in [AI agents versus RPA](/blog/ai-agents-vs-rpa/), where RPA executes predefined steps deterministically and an agent decides the steps itself."
  - q: "Why does Gartner expect over 40% of agentic AI projects to fail?"
    a: "Gartner predicts over 40% of agentic AI projects will be canceled by the end of 2027, citing escalating costs, unclear business value, and inadequate risk controls. The root cause is that current models cannot autonomously achieve complex goals over extended time, and many vendors overstate what their systems do. When the technology can't sustain the promised autonomy, costs climb, value stays vague, and the buyer absorbs the loss."
  - q: "How should you evaluate an AI agent vendor without getting spun?"
    a: "Run a structured pilot with a pre-defined success metric set before the vendor touches your data. Define one outcome number that means the project worked, pick one real workflow with messy inputs, run a time-boxed pilot against the metric, audit the off-script behavior, and model the all-in cost at your volume. Walk every vendor through the nine rubric questions, because a demo is exactly the artifact a washed product produces best."
author: "Replyant"
---

Most products marketed as "AI agents" are not agents. They are chatbots, RPA scripts, and workflow assistants wearing a new label. Gartner found that of the thousands of vendors describing themselves as "agentic," only around [130 are genuinely agentic](https://cobusgreyling.medium.com/ai-agent-washing-272e3e66f319) — a phenomenon the industry now calls "agent washing." For a buyer, that means the default assumption should be skepticism, not enthusiasm. The job is to prove a vendor's claim before you sign, using a concrete rubric rather than a demo.

This matters because the cost of getting it wrong is now measurable. Gartner predicts that [over 40% of agentic AI projects will be canceled by the end of 2027](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027), citing escalating costs, unclear business value, and inadequate risk controls. Many of those failures will trace back to a single root cause: the buyer thought they were purchasing an autonomous agent and actually bought a repackaged chatbot that could never deliver the outcome promised.

## What is agent washing?

Agent washing is the practice of rebranding existing technology — chatbots, robotic process automation, rules engines, or AI-assisted tools — as "AI agents" to ride the agentic wave. The product hasn't changed; the marketing has. Gartner's data is blunt: among thousands of self-described agentic vendors, only roughly 130 are doing genuine agentic work. The rest are selling the label, not the capability.

The reason this works as a sales tactic is that "agent" has no enforced definition. A founder can call a decision tree an agent and face no penalty. So the burden of definition falls on you, the buyer.

## What actually makes an AI agent an agent?

A genuine AI agent pursues a goal, reasons about how to achieve it, selects and uses tools dynamically, and adapts when reality doesn't match the plan. A chatbot responds to prompts within a fixed script. The difference is autonomy over a multi-step task — not how natural the conversation sounds. If the system can only do what it was explicitly told to do, in the order it was told, it is automation wearing an agent costume.

The cleanest way to think about the distinction is the one we lay out in [AI agents vs. RPA](/blog/ai-agents-vs-rpa/): RPA executes predefined steps deterministically, while an agent pursues an objective and decides the steps itself. Agent washing collapses that line on purpose, because "we automated a fixed workflow" sells for far less than "we deployed an autonomous agent."

## Why does Gartner expect over 40% of these projects to fail?

Most agentic propositions lack significant value or return on investment because [current models cannot autonomously achieve complex goals over extended time](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027), and many vendors overstate what their systems can do. When the technology can't sustain the promised autonomy, costs climb, value stays vague, and risk controls lag. The project gets canceled — and the buyer absorbs the loss.

This is why a demo proves almost nothing. A scripted demo is exactly the artifact a washed product is best at producing. The hard questions are about what happens off-script.

## The agent-washing rubric: nine questions to ask before you buy

Walk every "agentic" vendor through these. A real agent vendor answers them specifically and without flinching. A washed product produces hedging, redirection, or a request to "see it in the demo."

- **Does it set its own steps, or run a fixed script?** Ask the vendor to show a task where the agent chose a different path than the obvious one. If every run follows the same sequence, it's a workflow, not an agent.
- **What does it do when it hits something unexpected?** Real agents reason about novel inputs and either solve or escalate with context. Washed products fail, loop, or hand off blindly. Ask for a recorded example of a non-standard case.
- **Which tools and systems can it actually call?** An agent selects tools dynamically to reach a goal. Ask for the live integration list and how the agent decides which to use — not which integrations are "on the roadmap."
- **Can it complete a multi-step goal without a human between every step?** If a person has to approve or trigger each step, you've bought an assistant. That can be fine — but you should pay assistant prices, not agent prices.
- **How is it evaluated, and against what baseline?** Demand outcome metrics (resolution rate, accuracy, cost per task), not activity metrics ("conversations handled"). No measurement framework is a red flag.
- **What are the guardrails, permissions, and audit logs?** Genuine agents ship with permission boundaries, logging, and a kill switch because autonomy without governance is a liability. Absence here signals immaturity.
- **What's the realistic time to first value?** Vendor-deployed agents reach first value in roughly [38 days versus about 94 days for in-house builds](https://www.digitalapplied.com/blog/ai-agent-adoption-2026-enterprise-data-points). A vendor who can't give a credible timeline is selling a prototype.
- **Can you talk to a customer running it in production — not a pilot?** Across enterprises, [78% have an agent pilot but only 14% have scaled one org-wide](https://www.digitalapplied.com/blog/ai-agent-scaling-gap-march-2026-pilot-to-production). Pilots prove nothing about durability. Ask specifically for production references.
- **What is the all-in cost per task at your volume?** For customer service, AI handling resolves tickets at roughly [$0.46 versus about $4.18 for human-handled](https://www.ampcome.com/post/enterprise-ai-agents-2026-mid-year-report) tickets — a real agent should be able to model unit economics like this for your workload. Vagueness on cost is vagueness on capability.

## Five tells that you're looking at a washed product

If you only have five minutes, these are the fastest signals.

1. **The pitch leads with the word "agentic" and never defines it.** Real capability gets described in terms of what it does autonomously. Washing gets described in adjectives.
2. **Every answer routes back to the demo.** A demo is a rehearsed best case. If hard questions can't be answered outside it, there's nothing behind it.
3. **No production references — only pilots and "design partners."** Given that 14% of enterprises have actually scaled, a vendor with zero production deployments is asking you to be their experiment.
4. **No governance story.** No audit logs, no permission model, no kill switch. Genuine autonomy forces vendors to think about control. Washed products skip it.
5. **Outcome metrics are missing or replaced with activity counts.** "We handled 50,000 conversations" tells you nothing about whether any were resolved.

## How to run the evaluation without getting spun

The most reliable defense against agent washing is a structured pilot with a pre-defined success metric — set before the vendor touches your data. Decide what "working" means in numbers (resolution rate, cost per task, exceptions escalated correctly), then make the vendor hit it on your real workflows, not their canned scenario.

This is the same discipline that separates the 14% who scale from the 78% stuck in pilots. As we cover in [moving AI agents from pilot to production](/blog/ai-pilot-to-production/), the failures rarely come from weak models — they come from skipping governance, measurement, and process design. And as we argue in [why most businesses fail at AI agents](/blog/why-businesses-fail-at-ai-agents/), the buyers who win spend the bulk of their effort designing the work and defining success, not admiring the tool.

A practical sequence:

- **Define the outcome metric first.** One number that means the project worked.
- **Pick one real workflow.** Not a sandbox — a workflow with messy, representative inputs.
- **Run a time-boxed pilot against the metric.** Demand the vendor commit to a threshold and a date.
- **Audit the off-script behavior.** Feed it the weird cases. Watch what it does when the script breaks.
- **Model the all-in cost at your volume.** Including the human time still required for exceptions.

## The bottom line for buyers

Agent washing is not a fringe problem — by Gartner's count it describes the overwhelming majority of the market. The defense is not better demos or louder vendor promises. It is a buyer who treats "agentic" as a claim to be tested, asks the nine rubric questions, watches for the five tells, and refuses to pay agent prices for assistant capabilities.

We act as the vendor-neutral advisor in exactly these evaluations — we don't have a product to push, so we have no incentive to wave anyone's "agentic" label through. If you're weighing one of these tools and want a second set of eyes that knows where the bodies are buried, [that's the kind of work we do](/#contact). Bring the pitch deck. We'll help you find out what's actually behind it.
