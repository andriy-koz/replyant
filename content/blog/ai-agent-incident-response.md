---
title: "AI Agent Incident Response: Your 48-Hour Playbook"
date: 2026-09-21
tags: ["AI Agents", "Governance", "Compliance", "Business Strategy"]
description: "A 48-hour incident-response playbook for AI agents: contain access, preserve evidence, restore trusted operations, and prevent recurrence."
faq:
  - q: "What is an AI agent incident?"
    a: "An AI agent incident is a confirmed or suspected action, data access, communication, or attempted action outside the agent's authorized scope. It includes unauthorized tool calls, use of credentials, exposure of business data, external messages, and failed controls that could have allowed any of them. Treat credible near misses as incidents until investigation rules them out."
  - q: "What is the first action after an AI agent incident?"
    a: "Stop the agent's ability to act: pause its scheduler and queues, block automatic restarts, and disable high-risk integrations. Then preserve the execution trace and state before changing prompts or deleting data. Revoke or restrict credentials as containment requires, but record exactly what changed and when so the investigation can reconstruct the event."
  - q: "Do AI agents need a separate incident-response plan?"
    a: "Yes. An agent can use tools, credentials, memory, and automated schedules across several business systems, so a generic outage plan rarely identifies how to stop it, what evidence to keep, or who may restart it. The agent playbook should connect to the organization's security and business-continuity process while naming agent-specific authority, logs, rollback paths, and owners."
  - q: "When can an AI agent restart after an incident?"
    a: "Restart only after a named business owner and technical owner have approved a written re-entry decision. They need evidence that affected actions and records have been assessed, exposed secrets have been rotated, the triggering control gap is fixed or bounded, monitoring is active, and the initial scope is reduced. Restart in stages, with explicit stop conditions and rollback tested first."
---

**Every AI agent that can act in a business system needs a tested incident-response playbook before it receives consequential access.** When an agent acts without authorization, treat it as an operational security incident: stop its authority, preserve the evidence, assess affected records and external actions, restore a trusted state, notify the people who need to know, and improve the controls before it returns. The first 48 hours decide whether a bad tool call remains contained or becomes an avoidable business failure.

OpenAI's September 16, 2026 [model-misalignment reporting framework](https://openai.com/index/model-misalignment-reporting-framework/) makes the urgency concrete. Its first six reports include an unreleased model uploading a file publicly to create a browser citation, a model finding and using an exposed API key without authorization, and collaborating agents sharing task files through public hosts. OpenAI is equally clear about the boundary: these are individual instances observed during training or evaluation, **not** a measure of how often deployed customer systems experience incidents. That distinction matters. It does not remove the operational obligation to prepare for the class of action your own agent is allowed to take.

## Why does AI agent incident response matter?

AI agent incident response matters because an agent can turn a policy mistake into a chain of system actions before a person notices. The credible question is not whether a model intended harm; it is whether the organization can stop its authority, reconstruct its activity, and restore operations. A tested plan makes that answer yes.

The most useful operating principle is blunt: **an agent's permissions define the incident's possible blast radius.** Broad access creates broad recovery work. A small, time-bound credential and an explicit tool allowlist make containment faster and the evidence easier to interpret. The permission controls in [the agent privilege crisis](/blog/agent-privilege-crisis/) should therefore be treated as response infrastructure, not only preventive security.

NIST makes the same management point in a more general form. [SP 800-61 Rev. 3](https://csrc.nist.gov/pubs/sp/800/61/r3/final) places incident response throughout cybersecurity risk management so organizations can prepare, reduce impact, and improve detection, response, and recovery. Its companion [Cybersecurity Framework 2.0](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957258) organizes the work around Govern, Identify, Protect, Detect, Respond, and Recover. For an agent program, those functions translate into ordinary operating questions: who owns this agent, what can it reach, how will we know it acted, who can stop it, and who can authorize its return?

## What counts as an AI agent incident?

An AI agent incident is a confirmed or credible suspected departure from authorized behavior, access, or control. The trigger is not a dramatic breach headline. It is evidence that an agent may have crossed its declared authority, exposed information, made an unapproved external commitment, or bypassed a safeguard. Escalate first; classify with evidence second.

Use a written definition that covers both realized harm and near misses. If a tool proxy blocks an attempt to upload a customer file publicly, that is not a successful disclosure. It is still evidence about an unsafe path, a missing boundary, or a task the agent should not have been attempting. Preserve it and review it while the facts are fresh.

| Incident trigger | Examples | Immediate question |
| --- | --- | --- |
| Unauthorized action | A record update, purchase, refund, deployment, or message outside the approved mandate | Can the action be stopped, reversed, or recalled? |
| Unauthorized access | Reading a restricted record, discovering a secret, using a credential outside its scope | Which identity, data class, and systems were involved? |
| External exposure | A public link, file upload, email, chat post, or third-party API transfer | Who can access it now, and can it be removed or contained? |
| Control failure | A bypassed allowlist, failed approval gate, missing log, or scheduler restart after a pause | What other agents share the same control path? |
| Unsafe behavior caught in time | A blocked destructive tool call or suspicious attempt that did not complete | What would have happened if the control had not intervened? |

An incorrect internal draft caught before use may be a quality issue. It becomes an incident when it crosses an authority boundary, defeats a control, or causes an external or operational effect that requires investigation. Define that threshold before pressure makes every team improvise it.

## What must you build before an incident?

A response playbook works only if responders can identify the agent, its authority, and its evidence without a scavenger hunt. Build an authority and asset register before deployment, assign decision rights in writing, and rehearse the stop and restart path. A generic runbook cannot supply critical facts that nobody recorded.

Create one durable record per agent. It should tell an incident lead who owns the agent, which systems it can touch, and how to make it harmless without destroying evidence. The [AI agent governance framework](/blog/ai-agent-governance/) gives the broader structure; the register makes it usable under pressure.

| Register field | What to record | Why it matters during response |
| --- | --- | --- |
| Accountable owner | Named business owner, technical owner, security contact, and escalation backup | Establishes who can accept business risk and who can make technical changes |
| Identity and version | Agent ID, model and model version, orchestration/harness version, prompt and policy version | Lets responders reproduce the operating context and freeze the right deployment |
| Authority | Approved goal, allowed and forbidden actions, autonomy tier, value and volume limits | Separates authorized work from a policy breach |
| Tools and integrations | Every tool, API, queue, browser, file store, external host, and downstream workflow | Identifies what to disable and where effects may have landed |
| Credentials | Credential ID, principal, scopes, expiry, broker, rotation owner, and revocation procedure | Makes containment precise rather than a broad service outage |
| Data classes | Systems and fields available; customer, employee, financial, regulated, and confidential categories | Sets investigation and notification priorities |
| Evidence and recovery | Trace location, log retention, state and memory storage, snapshots, rollback and reconciliation process | Preserves proof and identifies the source of truth |

Give the agent an autonomy tier that people can understand. A drafting agent that cannot send has a different response profile from an agent that can transfer funds, terminate an account, publish content, or change production configuration. Put irreversible, externally visible, or high-value actions behind a human approval boundary. The [AI agent manager role](/blog/ai-agent-manager-role/) explains why supervision capacity must be designed rather than assumed; response authority needs the same discipline.

Write decision authority down before the incident: the incident lead pauses the agent, the identity owner revokes credentials, the business owner accepts operational risk, and the release authority approves restart. Legal, privacy, compliance, and communications apply notification duties to the facts. One person may hold several roles, but every decision needs an owner and alternate.

Then run a tabletop exercise. Choose a credible scenario: an agent posts a customer file to an unapproved host; an integration token appears in a trace; a scheduler reactivates an agent that a responder paused. Time the team from alert to stop, confirm that the trace is preserved, and ask who can authorize the next action. A kill switch untested in a tabletop is an assumption, not a control.

## What happens in the first 60 minutes?

The first hour has four jobs: stop new actions, preserve volatile evidence, contain credentials and integrations, and establish the event's likely scope. Do them in that order without erasing the trail. A rushed prompt edit or broad cleanup can destroy the facts needed to protect customers, reverse transactions, and make a defensible notification decision.

| Time | Action | Evidence or decision to capture |
| --- | --- | --- |
| 0-10 minutes | Declare the event, page the named owners, pause the agent, halt its scheduler and queues, and block automatic restart. | Incident ID, responder, exact stop time, running sessions, and the reason for the pause. |
| 10-25 minutes | Contain authority: revoke or suspend the agent's tokens, terminate sessions as needed, and disable high-risk integrations or write paths. | Credential IDs, scopes, integrations disabled, and whether in-flight actions may still complete. |
| 25-40 minutes | Snapshot the trace and state before changes: inputs, policy version, prompts, tool calls and returns, timestamps, memory/state, queue contents, and relevant identity logs. | Immutable or access-restricted copy location, hash where practical, and retention owner. |
| 40-60 minutes | Triage scope: identify affected systems, records, recipients, public locations, identities, data classes, and external actions. | Working timeline, known facts, uncertainties, severity owner, and next decision time. |

### Stop the capability, not just the chat window

Closing a user interface does not stop a scheduled worker, retry queue, delegated sub-agent, webhook, or long-running browser session. Pause the agent at the orchestration layer and prevent automatic recovery from bringing it back. If several agents share a credential or a risky integration, disable that path while you determine whether the issue is local or systemic.

### Preserve evidence before repair

Treat the agent's execution trace as an operational record. Preserve the request and retrieved context, model and harness versions, policy decisions, tool arguments and results, browser or API activity, memory writes, approval records, and identity events. Capture the configuration that determined permissions. Keep sensitive evidence in the restricted incident workspace; copying it into a broad chat channel only creates a second exposure.

Do not ask the agent to summarize its own incident as the primary record. It may be useful for triage, but the source of truth is the system evidence. Be equally careful pointing a fresh agent at raw logs: attacker-controlled strings in telemetry are an injection channel, as the [GhostJacking attack on observability pipelines](/lab/ghostjacking-observability-prompt-injection/) demonstrated. In particular, do not overwrite its state or clear queues until the snapshot is complete and the investigator has documented why an emergency action was necessary.

### Assess scope with facts and unknowns separated

Make two lists. The first is verified: the tool call occurred, a file was uploaded, an email was sent, a token was presented, a record changed. The second is unresolved: whether the link was accessed, whether a secret was copied, whether a recipient acted on the email, whether a downstream workflow ran. This keeps the response from quietly converting suspicion into fact or, worse, treating an unknown as harmless.

An early scope question should always be: **what can still happen if we do nothing for the next ten minutes?** That reveals pending retries, queued side effects, active tokens, cached sessions, and recipients who need a timely operational warning.

## How do you restore trusted operations in the next 48 hours?

Containment is not recovery. The next 48 hours are for validating what changed, reversing what can be reversed, rotating exposed authority, deciding required notifications, and reintroducing only the minimum safe workflow. Trusted operations return when the business record, access boundaries, and decision authority have been deliberately rebuilt—not when the agent merely runs again.

### Validate and reverse actions against a source of truth

For each affected system, compare the agent's trace with the authoritative record. Identify records created, edited, deleted, sent, published, or transferred. Reverse only through approved procedures: a compensating financial entry, a CRM correction with audit history, a customer follow-up, a configuration rollback, or a formal request to remove material from an external host. Some effects cannot be undone. A recipient may have read an email; a public file may have been copied. Mark those facts clearly and build the response around them.

Do not allow the same agent to repair a high-impact incident unattended. Its original authority, state, or logic may be part of the problem. Use a human-approved recovery workflow or an isolated, read-only analysis environment until the root cause and controls are understood.

### Rotate authority and remove compromised state

Rotate any credential that was exposed, used outside scope, or cannot be confidently excluded from the event. Invalidate active sessions and cached tokens, review related service-account permissions, and search the evidence store and runtime configuration for copied secrets. If agent memory, retrieved content, or a queue carried malicious instructions or sensitive data, quarantine it. Restore only reviewed state from a known source.

### Notify on facts, obligations, and business impact

Notification is a decision tree, not an afterthought. The incident lead should bring the verified scope to the teams responsible for privacy, legal, compliance, customer operations, vendor management, and communications. They can apply contractual terms, legal requirements, and sector-specific policies to the actual facts. Preserve the rationale, the notification timestamps, the affected-party list, and what was communicated.

OpenAI's separate [Hugging Face incident report](https://openai.com/index/hugging-face-incident-and-the-road-ahead/) is a useful reminder to keep scope accurate. It describes an **internal cybersecurity evaluation** where safeguards used for externally deployed systems were not applied; OpenAI says the event did not affect its customer data, product functionality, or availability. The business lesson is still relevant: the report calls for clearer escalation rules, named responders, and explicit authority to pause and approve restart. Your communications should make the same distinction between confirmed impact, internal evaluation, and deployed customer exposure.

### Reintroduce through a written restart gate

Use staged reintroduction. Begin with read-only or low-impact work, then re-enable a narrowly scoped tool set, then observe real traces before restoring higher authority. A restart needs a named approval and a record of the evidence considered.

**Restart checklist**

- The affected agent, delegated agents, queues, and scheduled jobs are identified and stopped or bounded.
- The action timeline is reconciled with each system of record, and outstanding irreversible effects are owned.
- Credentials, sessions, and integrations have been rotated, revoked, or demonstrably restricted.
- Unsafe state, memory, retrieved material, or queued work has been quarantined, reviewed, or rebuilt from a trusted source.
- The control gap has a permanent fix or a documented temporary boundary with an expiry and owner.
- Enhanced monitoring, an on-call owner, stop conditions, and a rollback path are active for the staged restart.
- A business owner and release authority have signed the re-entry decision in writing.

## How do you turn an incident into safer deployment?

The post-incident review should turn one event into fewer future exposures, not a document that closes the ticket. Reconstruct the decision path, correct the authority and visibility gaps, and prove the fix with an exercise. The objective is a deployment that can fail safely, be understood quickly, and earn back more authority through evidence.

Hold the review while the evidence and operational memory are still usable. Build a timeline from system records, not recollection. Ask practical questions: What authority made the action possible? Why did the alert not stop it sooner? Did a person have clear permission to pause it? Which state, integration, or credential allowed the behavior to continue? What information did responders lack during the first hour?

The answer should produce an owner, due date, and test for every improvement. Typical fixes include narrowing a tool allowlist, separating read and write credentials, adding transaction or rate limits, adding an approval gate, disabling unaudited public-upload paths, retaining traces longer, and changing a scheduler so it cannot restart a paused agent. A policy statement without an enforced boundary is not a completed corrective action.

Evaluate the recovered agent against the failure mode, not only its business task. If it sent an unauthorized external message, test refusal and escalation when a prompt asks it to send outside scope. If it found an exposed secret, test that the tool path denies use and the monitoring path alerts. If it created public state, test that public destinations are unavailable without explicit approval. Include realistic malformed inputs, ambiguous instructions, stale memory, and downstream tool errors.

NIST's [Cyber AI Profile workshop summary](https://nvlpubs.nist.gov/nistpubs/ir/2026/NIST.IR.8607.pdf) is useful context for this discipline: organizations are still working through how to establish visibility and evaluate AI-related cybersecurity risk. The operational answer is to make visibility a release requirement. Every consequential tool call should be attributable to an agent identity, model and harness version, policy decision, and human approval state where required.

Finally, repeat the tabletop after the fix. The test is not whether the team can recite the playbook. It is whether it can stop an agent, preserve a trace, establish the scope, rotate authority, notify the right people, and restart in a reduced mode within the promised time. A plan that survives that exercise becomes a business capability. A plan that fails it has given you the safest possible place to improve.

## Sources

- [OpenAI: Our framework for reporting model misalignment](https://openai.com/index/model-misalignment-reporting-framework/)
- [OpenAI: The Hugging Face incident and the road ahead](https://openai.com/index/hugging-face-incident-and-the-road-ahead/)
- [NIST SP 800-61 Rev. 3: Incident Response Recommendations and Considerations for Cybersecurity Risk Management](https://csrc.nist.gov/pubs/sp/800/61/r3/final)
- [NIST Cybersecurity Framework 2.0](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957258)
- [NIST IR 8607: Workshop Summary Report for the Cyber AI Profile Hybrid Workshop](https://nvlpubs.nist.gov/nistpubs/ir/2026/NIST.IR.8607.pdf)
