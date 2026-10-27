---
title: "GPT-4o API Retirement: An 11-Week Plan Before January 14"
date: 2026-10-26
tags: ["AI Strategy", "Business Strategy", "Architecture", "ROI"]
description: "OpenAI retires GPT-4o and GPT-4.1 from the API on January 14, 2027, with three months' notice. An 11-week plan to inventory, test, and cut over in time."
faq:
  - q: "When does GPT-4o leave the OpenAI API?"
    a: "January 14, 2027. OpenAI announced on October 14, 2026 that GPT-4o, GPT-4o mini, GPT-4.1 and GPT-4.1 mini will be removed from the API on that date, including the snapshots gpt-4o-2024-08-06, gpt-4o-2024-11-20, gpt-4o-mini-2024-07-18, gpt-4.1-2025-04-14 and gpt-4.1-mini-2025-04-14. Fine-tuned versions of these models follow the same shutdown schedule as their base models, so custom models retire on the same day."
  - q: "What does OpenAI recommend replacing GPT-4o with?"
    a: "OpenAI lists gpt-6-luna as the recommended replacement for all four retiring models. Luna is a reasoning model priced at $0.10 per million input tokens and $0.50 per million output tokens, with a 1.05 million token context window. It does not support fine-tuning, and it behaves differently from GPT-4o, so a straight model-ID swap needs testing before it reaches production traffic."
  - q: "Why is three months' notice a problem for businesses?"
    a: "OpenAI's own deprecation policy promises at least six months' notice for generally available models, and its April 2026 retirement of older snapshots gave exactly that. Three months leaves roughly eleven working weeks, two of them over the holidays, to find every hard-coded model ID, rebuild test sets, re-baseline costs and cut over — including inside SaaS tools whose vendors have to migrate first."
  - q: "What happens to my fine-tuned GPT-4o or GPT-4.1 models?"
    a: "They stop working on January 14, 2027, with their base models. They cannot be recreated on the replacement: gpt-6-luna does not support fine-tuning, and OpenAI is winding down its fine-tuning platform, with existing customers unable to create new fine-tuning jobs after January 6, 2027. The practical options are prompting with retrieval, long few-shot prompts, or fine-tuning with another provider."
  - q: "Will migrating to gpt-6-luna lower my AI costs?"
    a: "For most GPT-4o workloads, yes — Luna's list prices are 25 times lower on input and 20 times lower on output. For GPT-4o mini workloads, not automatically. Luna is a reasoning model, and OpenAI bills reasoning tokens as output tokens, so a few hundred hidden reasoning tokens per request can make Luna cost more than the model it replaces. Measure on real traffic before budgeting the savings."
---

**Every automation, chatbot and agent pinned to GPT-4o, GPT-4o mini, GPT-4.1 or GPT-4.1 mini stops working on January 14, 2027, and the fix is a business-continuity project, not a config change.** On October 14, 2026, OpenAI [notified developers on its deprecations page](https://developers.openai.com/api/docs/deprecations) that those four models — snapshots `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, `gpt-4o-mini-2024-07-18`, `gpt-4.1-2025-04-14` and `gpt-4.1-mini-2025-04-14` — will be removed from the API in three months. Fine-tuned models built on them go with them. The recommended replacement for all four is `gpt-6-luna`, a reasoning model that does not support fine-tuning. As of today, October 26, there are 80 days left, and two of the remaining weeks fall over the holidays.

The model swap itself takes an engineer an afternoon. The work that decides whether January 14 is a non-event or an outage is everything around it: knowing where the models are used, proving the replacement does the job, re-baselining the bill, and getting answers from vendors who embed these models in tools you pay for.

## Why is this deprecation different from the usual model upgrade?

**Because the notice is half what OpenAI's own policy promises, and the replacement is a different kind of model.** OpenAI's deprecation policy commits to "at least 6 months" of notice for generally available models, unless safety or compliance concerns require a faster timeline. This announcement gave three.

The contrast is visible on the same page. On April 22, 2026, OpenAI announced the retirement of older snapshots, including `gpt-4o-2024-05-13` and `gpt-4.1-nano`, with a shutdown date of October 23, 2026 — six months. On October 1, 2026, it announced the retirement of `gpt-5.1` and `gpt-5.4-nano` for April 1, 2027 — six months again. Thirteen days later, the most widely deployed GPT-4-era models got three.

| Announcement | Models | Shutdown | Notice |
|---|---|---|---|
| April 22, 2026 | `gpt-4o-2024-05-13`, `gpt-4.1-nano` | October 23, 2026 | 6 months |
| October 1, 2026 | `gpt-5.1`, `gpt-5.4-nano`, `gpt-5.3-codex` | April 1, 2027 | 6 months |
| October 14, 2026 | GPT-4o, GPT-4o mini, GPT-4.1, GPT-4.1 mini | January 14, 2027 | 3 months |

The second difference is behavioural. GPT-4o is not a reasoning model. [`gpt-6-luna` is](https://developers.openai.com/api/docs/models/gpt-6-luna): it thinks before it answers, with reasoning effort settings from `none` to `max`. OpenAI's [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) recommends prompting these models with clear objectives and explicit constraints rather than prescriptive step-by-step instructions — the opposite of how many GPT-4o prompts were written. A prompt tuned for two years against one model will not produce identical output on the other.

## What actually breaks on January 14?

**Any call that names a retiring model returns an error, and the systems most exposed are the ones nobody remembers building.** The customer-service bot your team launched in 2024 is obvious. The less obvious ones are a Zapier step a marketing analyst wired up, a document-extraction script running on a finance team's server, an internal Slack bot, and the AI features inside SaaS products you license.

This is an inventory problem first. Most companies cannot produce a list of every place a model ID is hard-coded, because model IDs live in source code, environment variables, no-code workflow builders, prompt-management tools and vendor configurations — and nobody owns that list. We described the same blind spot in [agent sprawl as the new tech debt](/blog/agent-sprawl-tech-debt/): an agent fleet without a registry fails in exactly this way, all at once, on someone else's date.

Vendor exposure is the hardest part to see. [The New Stack notes](https://thenewstack.io/openai-gpt4o-api-shutdown) these were common defaults in chatbot builders, automation platforms and customer-service integrations sold to smaller businesses. If a vendor built on them, their migration deadline is your deadline, and their testing standards are now your quality risk.

## What does an 11-week migration plan look like?

**Inventory and ownership in the first two weeks, testing through early December, staged cutover before the holidays, and a buffer in January.** Treat December 19 as the real deadline for anything customer-facing. Change freezes, vacations and year-end close make the last three weeks the worst time to discover a regression.

| Week | Dates | Workstream | Owner | Exit criteria |
|---|---|---|---|---|
| 1 | Oct 26 – Nov 1 | Inventory every model call: code, env vars, no-code tools, prompt stores, vendor products | Engineering lead + IT | Signed-off list of every system calling a retiring model ID |
| 2 | Nov 2 – Nov 8 | Assign a business owner per system; rank by blast radius; send vendor questions | COO / ops lead | Every system has a named owner and a tier (customer-facing, financial, internal) |
| 3–4 | Nov 9 – Nov 22 | Build eval sets from real production traffic; export fine-tune outputs | System owners + engineering | 200+ real cases per critical system, with approved "correct" answers |
| 5–6 | Nov 23 – Dec 6 | Side-by-side testing; prompt rewrites; reasoning-effort tuning | Engineering | Replacement matches or beats incumbent on the eval set for each tier |
| 7 | Dec 7 – Dec 13 | Cost re-baseline on real traffic | Finance + engineering | Per-workflow cost forecast signed off by finance |
| 8–9 | Dec 14 – Dec 27 | Staged cutover: 5%, 25%, 100% of traffic | System owners | Customer-facing systems fully migrated by Dec 19 |
| 10–11 | Dec 28 – Jan 10 | Internal systems, stragglers, vendor confirmations; Jan 6 fine-tune cutoff | Engineering lead | Zero calls to retiring IDs in API logs |
| — | Jan 11 – Jan 14 | Buffer only | — | Nothing new ships |

Three steps carry most of the risk.

**Build the eval set from production, not from imagination.** Pull a few hundred real inputs per critical workflow from your logs, including the ugly ones — malformed emails, edge-case invoices, angry customers. Have the business owner mark what a correct output looks like. That set is how you prove the replacement works, and it is reusable for every future model change. Our technical walkthrough of [agent evals as CI/CD deployment gates](/lab/agent-evals-cicd/) shows how to turn it into an automated pass/fail check.

**Re-baseline the cost before you promise savings.** Luna's list prices are dramatically lower than GPT-4o's. But OpenAI's reasoning guide states that reasoning tokens "are billed as output tokens," and they are invisible in the response. Cost depends on how much the model thinks, not just how much it writes. Run the eval set, read the reasoning-token counts in the usage data, and forecast from that.

**Plan the rollback before you need it.** Until January 14, rollback means switching traffic back to GPT-4o. After January 14, GPT-4o does not exist. Your post-deadline rollback target must be a second supported model, tested and ready.

## Will moving to gpt-6-luna save money?

**For GPT-4o workloads, almost certainly; for GPT-4o mini workloads, only if you control reasoning effort.** On OpenAI's [pricing page](https://developers.openai.com/api/docs/pricing), the gap between the retiring models and their replacement is large:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|---|---|---|
| GPT-4o | $2.50 | $10.00 |
| GPT-4.1 | $2.00 | $8.00 |
| GPT-4.1 mini | $0.40 | $1.60 |
| GPT-4o mini | $0.15 | $0.60 |
| **gpt-6-luna** | **$0.10** | **$0.50** |

Against GPT-4o, Luna is 25 times cheaper on input and 20 times cheaper on output. Reasoning tokens will not erase that gap. Against GPT-4o mini, the picture flips quickly. Take an illustrative request with 2,000 input tokens and 500 output tokens: on GPT-4o mini it costs $0.0006. On Luna, the input costs $0.0002, which leaves room for only 800 billed output tokens before Luna becomes more expensive. Once the 500 visible tokens are subtracted, that leaves just 300 reasoning tokens.

A high-volume classification or extraction workflow running at medium reasoning effort can exceed that easily. Luna's `none` and `low` effort settings exist for exactly these workloads. Test them. The [AI FinOps discipline for agentic token costs](/blog/agentic-ai-token-costs/) applies directly: price per completed task, not per million tokens.

## What do you do about fine-tuned models?

**Capture what they do now, because they cannot be rebuilt on OpenAI.** Fine-tuned GPT-4o and GPT-4.1 models shut down with their base models on January 14. Luna does not support fine-tuning. OpenAI's [fine-tuning guide](https://developers.openai.com/api/docs/guides/fine-tuning) states the company "is winding down the fine-tuning platform," and its deprecations page sets January 6, 2027 as the date after which active existing customers can no longer create new fine-tuning jobs. There is no OpenAI fine-tuning path forward.

The most urgent action is the same whichever option you choose: **before January 14, run your fine-tuned model against a large sample of real inputs and save the outputs.** That dataset records the behaviour you paid to train. It becomes your eval set, your few-shot example library and, if needed, the training data for a model elsewhere.

| Option | How it works | Best for | Trade-off |
|---|---|---|---|
| Prompting + retrieval | Move the knowledge the fine-tune encoded into retrieved documents and explicit instructions | Domain knowledge, policies, product facts | Requires a maintained knowledge base |
| Long few-shot prompts | Put dozens or hundreds of saved examples directly in the prompt | Tone, format, house style | Higher input tokens, offset by Luna's $0.01 cached-input price |
| Another provider's fine-tuning | Retrain on a model from a provider that still offers it, using your saved data | Highly specialised behaviour no prompt reproduces | A second vendor relationship, new evals, new contracts |
| Distillation | Use the saved fine-tune outputs as training data for a smaller model you control | Very high volume, stable tasks | Requires ML capability and hosting |

For most business workloads — support replies in a brand voice, structured extraction from standard documents — prompting plus few-shot examples on a strong reasoning model gets close enough. Measure it against the saved outputs rather than assuming it does.

## Which questions should you send your vendors this week?

**Any SaaS product with an AI feature built on these models has the same deadline you do, and you need their answers in writing.** Send these before November 8:

1. Which of your features call GPT-4o, GPT-4o mini, GPT-4.1 or GPT-4.1 mini, directly or through a reseller?
2. What is your migration date, and will it be complete before December 19?
3. Which model are you moving to, and how did you test that output quality did not change?
4. Do any of our configurations rely on a fine-tuned model? How will that behaviour be preserved?
5. Will the change affect pricing, usage limits or credit consumption?
6. Can we test the new model on our own data before you switch production?
7. What is your rollback plan if quality drops after January 14?
8. What is your contractual notice commitment for future model changes?

A vendor who cannot answer question 1 has not started. That is a [build-versus-buy risk](/blog/build-vs-buy-ai-agents/) you are carrying whether or not it appears in the contract.

## What is the lasting lesson from the GPT-4o retirement?

**Model retirement is now a recurring operating cost, and the companies that budget for it stop treating every deprecation as an emergency.** OpenAI's deprecations page already lists further retirements for April 2027. Model churn will not slow down. The models in production today will be retired on someone else's schedule, and the notice may again be shorter than promised.

Treat the model like any other dependency with an end-of-life policy:

- **An abstraction layer.** Model IDs live in one configuration place, not scattered through code and no-code tools. Changing models becomes a one-line, logged decision.
- **A standing eval suite.** The production-derived test set you build this month is rerun at every model change. It is the asset that turns the next migration from eleven weeks into two.
- **A model-change budget.** Assume at least one forced migration per production AI system per year. Price the engineering, testing and owner time into the [ROI model for each agent](/blog/measuring-ai-agent-roi/), not into an unplanned overtime bill.
- **A second qualified model.** Every critical workflow should have a tested fallback, ideally from a different provider. That is your rollback target and your negotiating leverage.

This is the same operational maturity that separates [pilots that reach production from those that stall](/blog/ai-pilot-to-production/): systems built to be maintained, not just launched.

## The bottom line

January 14 is fixed, and the work that matters is not the model swap. It is knowing every place the retiring models run, proving the replacement on real traffic, re-pricing the workload honestly and getting vendors on the record. Companies that finish customer-facing cutovers by December 19 will barely notice the deadline. Companies that start in January will be migrating during an outage.

*If you do not have a complete list of where GPT-4o and GPT-4.1 run in your business today — including inside the tools you license — that inventory is the first thing worth building. [It is exactly the kind of migration review we run](/#contact).*
