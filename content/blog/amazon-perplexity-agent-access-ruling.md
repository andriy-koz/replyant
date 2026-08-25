---
title: "Amazon v. Perplexity: Your Terms of Service Are Now the Perimeter"
date: 2026-08-25
tags: ["AI Agents", "Compliance", "Business Strategy", "Governance"]
description: "The Ninth Circuit freed Perplexity's agent from Amazon's hacking claims. The fight moves to contracts and architecture — where preparation decides it."
---

**The Ninth Circuit did not open your site to AI agents. It moved the fight from anti-hacking law onto contract law and technical enforcement — terrain where prepared companies win and unprepared ones have nothing.** On August 4, 2026, in *Amazon.com Services, LLC v. Perplexity AI, Inc.*, 2026 WL 2237587 (9th Cir. Aug. 4, 2026), the court vacated the preliminary injunction that had barred Perplexity's Comet browser assistant from Amazon's logged-in pages and remanded the case, holding Amazon unlikely to succeed on its Computer Fraud and Abuse Act (CFAA) and California CDAFA claims. The line that decided it: "However advanced the Assistant currently is, it is a tool, not a person for statutory purposes." This is the first federal appellate ruling on whether an AI agent "accesses" a computer system under anti-hacking law, and it produces two opposite instructions depending on which side of the traffic you sit on. If you run a consumer-facing site, your fastest legal weapon just got taken away. If you buy or build agentic browsing, your vendor's system architecture is now a litigation variable, not an engineering footnote.

## What did the Ninth Circuit actually hold?

That Perplexity never "accessed" Amazon's computers — the user did. Comet takes screenshots on the user's own machine, sends them to Perplexity's servers, and receives navigation instructions back through the user's computer. Because "Perplexity itself does not directly communicate with Amazon's servers," the panel found "it was the user who 'accessed' Amazon's computers, with the help of Perplexity's AI agent." Amazon, the plaintiff, is unlikely to prevail on that theory.

The CDAFA claim fell for the same reason: "the focus of the inquiry is still on the person accessing or causing the access." Judge Milan D. Smith Jr., writing for the panel, treated the CFAA as what it is — "an anti-hacking statute," aimed, in the court's words, "to prevent intentional intrusion onto someone else's computer—specifically, computer hacking." Stretching it to cover a consumer tool would, the panel warned, risk exposing ordinary users to criminal liability for pressing a button in their own browser.

The procedural whiplash is worth noting. On March 9, 2026, district court Judge Maxine M. Chesney had granted Amazon's preliminary injunction, finding Amazon likely to prevail, barring Perplexity from reaching Amazon's protected systems via AI agents and ordering deletion of data collected from password-protected areas. Five months later that order is gone. Amazon says it disagrees with the ruling and is "evaluating its next steps."

## Why did system architecture decide the case?

Because the court located the "access" at the point where packets meet the target server, and in Comet's design that point sits inside the user's machine. Perplexity "may receive screenshots of the user's browser and may communicate instructions to the Assistant," the panel wrote, but "those activities, by themselves" do not mean Perplexity gained entry to Amazon's servers. The defense is a property of the plumbing, not of the product category.

Read the sentence the panel added immediately after, because it is the most commercially important line in the opinion: "We do not address whether, on a different record or new facts, Perplexity may exercise control over the Assistant in such a way as to gain entry to Amazon's servers." A vendor whose cloud infrastructure hits the target site directly — server-side headless browsers, scraping fleets, API relays — is not standing where Perplexity stood. Same product promise to the buyer, materially different exposure. This is the same reason [agents are now the interface layer sitting on top of your software stack](/blog/ai-agents-vs-saas-stack/) rather than a feature inside it: the routing decision is the product.

There is an underappreciated fact about how the dispute started, too. The core conflict was Perplexity's decision not to send a user-agent string — the mechanism, in the court's description, "that would communicate that the user has activated an AI agent," and the one that "would allow Amazon to block the Assistant's access to the Amazon store." Amazon had told Perplexity's CEO before Comet launched that its AI products would not be permitted on the Amazon Store. The dispute escalated around November 4, 2025, when Amazon demanded Perplexity stop its agent from making purchases, and Amazon filed suit that month. The entire case, in other words, grew out of a one-line identification header that was not sent.

## Doesn't this contradict the gym-hack liability story?

No — different statute, different defendant, different question. Our post on [deployer liability after the agent that hacked a gym booking API](/blog/ai-agent-liability-gym-hack/) argued that whoever deploys an agent answers for the foreseeable harm it causes third parties. That is a law-of-harm question about the party who set the agent loose. *Amazon v. Perplexity* is an unauthorized-access question about a party who built the tool, not the party who ran it.

The two rulings actually point the same direction: **liability follows the human, not the software.** The gym case put the deployer in the frame because software is not a legal person. The Ninth Circuit put the *user* in the frame for exactly the same reason — the CFAA "contemplates access by a person," and a tool is not one. If anything, this ruling sharpens the gym-case lesson for buyers. The court took Perplexity out of the CFAA line of fire by finding the user did the accessing. It said nothing about whether the user is now the one standing there. And the panel was explicit that it "do[es] not address whether in other contexts, including tort claims, Perplexity can avoid liability for the Assistant's actions."

## What changed for enforcement, concretely?

| | Before August 4, 2026 | After |
|---|---|---|
| **Primary legal theory** | CFAA / CDAFA unauthorized access — a federal anti-hacking claim | Breach of contract (terms of service), plus unresolved tort theories |
| **Who you sue** | The agent vendor, directly | The user who agreed to your terms; the vendor only via harder theories such as tortious interference |
| **What you must have in place first** | A cease-and-desist letter and evidence of blocking costs | Enforceable, assented-to terms that name automated and agentic access; a working agent-detection layer; logs that survive discovery |
| **How fast it works** | Preliminary injunction — weeks, with statutory leverage | Contract litigation on the merits — slower, fact-bound, no criminal-statute pressure |
| **Where it fails** | Where the agent routes through the user's own browser | Where your terms are silent on agents, unassented, or you cannot prove which sessions were agentic |

The practical shift is that enforcement moved from something you can invoke *after* the traffic arrives to something you must have built *before* it does. A hacking claim needs a letter. A contract claim needs a contract that already says the right thing, plus telemetry proving it was broken.

## Does this mean you can't keep agents off your site?

You can. You just have to do it with contract terms and technical controls instead of a federal statute. The panel said so directly in a footnote: "This outcome does not impair Amazon's ability to regulate access to Amazon.com via private terms of service for its users. On the facts before us, Amazon is simply unlikely to succeed in its attempt to regulate access by invoking the CFAA and the CDAFA."

Cooley's client alert draws the operator's conclusion plainly: where agent communications route through user machines, operators "should not assume that the CFAA or similar state anti-hacking statutes will provide an effective remedy," and may have to turn to "other theories of liability, such as enforcing terms of service."

That path has precedent. In *hiQ Labs v. LinkedIn*, the same court's CFAA analysis went against LinkedIn — and LinkedIn still won on contract, with the Northern District of California holding on November 4, 2022 that hiQ breached LinkedIn's User Agreement by scraping and by creating false accounts. The statute failed; the contract held. Retailers have already started writing for this world: eBay's user agreement, effective February 20, 2026, prohibits unauthorized third-party AI-powered autonomous tools, including buy-for-me agents and LLM-driven bots that place orders without human review.

## If you operate a consumer-facing site

**Rewrite the terms before you need them.** Most terms of service prohibit any "robot, spider, scraper, or other automated means" — the phrasing in Amazon's own Conditions of Use. That vocabulary is a decade old and does not obviously reach a browser extension a customer chose to install. Name agentic tools, buy-for-me agents, and automated ordering explicitly, and require agent identification the way Amazon's terms already do.

**Fix assent.** A contract claim depends on your users having actually agreed. Browsewrap terms at the bottom of a footer are the weak link in every one of these cases. Logged-in, clickwrap-assented terms are the strong one.

**Build the detection layer as evidence, not just defense.** You cannot sue over agentic sessions you cannot identify. Amazon's whole case rested on the absence of a user-agent string. Instrument for agent signals and retain the logs — this is the same audit-trail discipline that runs through [the five-layer agent governance stack](/blog/ai-agent-governance/), pointed outward at inbound traffic instead of inward at your own agents.

**Decide whether blocking is the goal.** Amazon's evidence of harm was thin enough that the panel called it "weak" — declarations that the Assistant "may not select the best price, delivery method, or product recommendations." If you cannot articulate a concrete harm from agent traffic, the honest strategic answer may be to admit agents on your terms, with identification and rate limits, rather than to litigate.

## If you buy or build agentic tooling

**Ask the architecture question in writing.** Does the vendor's infrastructure communicate with target sites directly, or does everything route through the end user's browser? Perplexity's answer is the reason Perplexity won. Put the question in your diligence pack alongside the [rubric for separating real agents from agent-washed automation](/blog/agent-washing/), and keep the answer in the contract file, not a sales call recording.

**Read the indemnity clause against this ruling.** If the vendor is out of the CFAA frame because your users do the accessing, ask who covers the user — and you — when a site operator sues on its terms of service instead. That question belongs in the same column as the [build-versus-buy calculus for agent capability](/blog/build-vs-buy-ai-agents/).

**Scope the credentials.** An agent operating in a logged-in state holds whatever your session holds. This ruling changes nothing about that exposure, and [over-privileged agents remain the dominant incident pattern](/blog/agent-privilege-crisis/).

**Assume the money layer is separately governed.** Access law and payment liability are different systems, and [agentic payment rails still run ahead of the frameworks that assign loss](/blog/agentic-commerce-liability/).

## How far does this ruling actually reach?

Not as far as the headlines suggest. It binds the Ninth Circuit. It reviews a preliminary injunction — a likelihood-of-success standard, not a final merits judgment — and the case is remanded for further proceedings. And the panel drew its own boundary: "we do not establish a new legal regime governing agentic AI," and the holding "reflects and applies to the state of technology only as presented in the filings in this case."

Treat it as one strong data point, not a settled rule. This is business analysis, not legal advice; a decision to admit, block, or sue belongs with your counsel. The failure mode here is the same one we flagged when [a headline about delayed EU AI Act deadlines read as permission to stand down](/blog/eu-ai-act-delay-trap/): a narrow ruling gets received as a general license, and the work that was already needed quietly stops.

## The bottom line

Amazon lost its fastest lever, not its ability to control its own front door. The CFAA is no longer a reliable way to keep an agent off a consumer site in the Ninth Circuit when that agent runs inside the user's browser — but terms of service, agent identification requirements, and detection telemetry all survive intact, and they now carry the full weight. On the other side, "we route through the user's device" has become a defensible legal position with real commercial value, which means it will also be claimed by vendors who do not actually do it.

Both takeaways reduce to the same instruction. The enforceable perimeter is the one you built before the traffic arrived.

If you are deciding whether to admit agents to your platform, or diligencing a vendor whose architecture you have never actually seen documented, [drawing that line clearly is exactly the kind of assessment we run](/#contact).
