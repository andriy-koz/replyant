---
title: "Mantis and Agentic Security Scanning Before Merge"
date: 2026-09-29
tags: ["AI Agents", "Architecture", "Developer Tools", "Evals"]
description: "How to design pre-submit security scans with localized threat models, independent triage, isolated reproduction, and evidence-based merge gates."
---

Pre-submit agentic security scanning works when each code change gets a narrow threat model, a separate reachability check, and a human-reviewed path to remediation. Google's internal pipeline shows why: Google reports preventing **hundreds of vulnerabilities per month** from entering its infrastructure codebase, with false-positive rates as low as **3% in some cases**. Its specialized triage agent reports **over 92% precision in less than a minute**. These are Google's reported results for its own system, not benchmarks for the [open-source Mantis toolkit](https://github.com/google/mantis) or a result you can expect by cloning it.

The useful lesson is the system design. Instead of asking one agent to audit an entire repository and declare a verdict, bind a review to the changed code, supply current security context, demand structural evidence, and reserve expensive reproduction for findings that survive triage. This post turns Google's [infrastructure security account](https://cloud.google.com/blog/topics/systems/using-ai-agents-to-secure-google-infrastructure/) and [Mantis introduction](https://cloud.google.com/blog/products/identity-security/getting-started-with-the-mantis-harness-to-find-and-fix-bugs) into a rollout plan a team can measure and adapt.

## What did Google build, and what is available to download?

Google describes an **internal pre-submit system** that scans each code change across its infrastructure stack. It uses localized threat models informed by live codebase metadata and dependency call graphs. A lightweight scan sends candidates to a specialized triage agent, which checks code structure through abstract syntax trees, call graphs, and indexed safety rules. Nightly post-submit scans provide another chance to catch issues spanning multiple changes. A fix agent proposes patches for human review in the original change request. The reported 3% false-positive figure applies **in some cases**, and the over 92% precision and sub-minute time apply to the **specialized triage agent**, not every stage or repository.

The public [Mantis repository](https://github.com/google/mantis) is a modular collection of security-review skills and an Agent Development Kit (ADK) reference harness. Its documented workflow includes repository history review, semantic indexing, threat modeling, hypothesis generation, deduplication, critique, reproduction, patching, and severity calibration. The repository explicitly says it is **not an officially supported Google product** and is **for demonstration, not production use**. Google's production measurements do not validate the released harness in your environment.

That boundary matters operationally. The public toolkit is a starting point for experiments and adaptation; a production scanning service needs its own isolation, integration, rules, budgets, monitoring, and evaluation. For the same reason, do not turn an agent's confident language into an automatic merge decision.

## How should a pre-submit pipeline be structured?

A useful design has five stages. Keep their inputs, permissions, and outputs explicit:

| Stage | Input | Required output |
|---|---|---|
| Scope | Diff, changed files, reachable callers, package metadata | A bounded set of paths and entry points to inspect |
| Threat model | Service ownership, trust boundaries, security invariants, relevant history | Plausible attacker capabilities and failure modes for this change |
| Candidate scan | Changed code and scoped context | Finding with location, source-to-sink path, and violated invariant |
| Independent triage | Candidate plus code graph and deterministic rules | Reachability evidence, counterevidence, and confidence |
| Reproduction and review | Surviving finding in an isolated test environment | Minimal reproducer or reason reproduction is unavailable; human verdict |

Run the first four stages against a **pinned commit**, and record the model, prompt, rule version, tool calls, and commit hash alongside each finding. The triage stage should independently inspect code rather than simply restating the scanner's reasoning. Google's recommendation to keep development, scanning, and triage harnesses, rules, and context separate is valuable here: otherwise all three can inherit the same mistaken assumption. For an agent system's wider evaluation design, see [agent evals in CI/CD](/lab/agent-evals-cicd/).

Threat context should be local enough to change a verdict. For an authorization change, include the route, identity source, tenant boundary, and relevant call chain. For a deserialization change, include the entry point, accepted formats, and construction path. Feed reviewed security invariants and relevant past fixes into this context; let the agent suggest updates, but have service owners approve them. Google's Mantis introduction says repository history and generated documentation help, while human-curated context can materially improve results.

## Where should generated exploit code run?

Only in an isolated, restricted environment with no route to production systems, internal networks, or sensitive data. Mantis warns that its workflow may generate and execute unstable code. Treat the target repository, model output, and generated reproducer as untrusted inputs. Use disposable workers, a read-only source snapshot, minimal synthetic fixtures, network deny rules except explicitly approved dependencies, resource and time limits, and no long-lived credentials. Monitor the sandbox itself and retain logs for review.

Reproduction is evidence, not an oracle. A failed reproducer does not prove a candidate false, and a successful test may not prove exploitability under production configuration. A security reviewer must check the attacker preconditions, path reachability, affected deployment, and fix before reporting or gating. Mantis's README explicitly requires manual expert verification of findings and cautions against filing unverified AI-generated reports. The same principle applies to patch proposals: run the original reproducer and regression tests, then require code-owner review.

If an agent can read untrusted repository content and call tools, the pipeline also needs prompt-injection controls. The repository may contain instructions aimed at the reviewer. Constrain tool permissions and treat file contents as data, as described in our [analysis of agent prompt injection through tool boundaries](/lab/prompts-as-shells-rce/).

## How do you roll this out without overwhelming reviewers?

Start with one service and one vulnerability class where the team already knows the trust boundary, such as authorization bypass on externally reachable handlers. Assemble a labeled set of historical true findings, known false alarms, and newly seeded cases. Replay them against pinned revisions. Include benign changes that resemble vulnerabilities, because these reveal whether the system can suppress noise. Keep the human labels and the agent's evidence separate.

Then run on live pull requests in **observation mode**. Record candidate volume, confirmed findings, false positives, missed known cases, p50 and p95 latency, cost per change, and developer time spent reviewing each finding. Define precision as confirmed actionable findings divided by all findings sent to reviewers; define recall against the labeled set and later confirmed incidents. Measure triage latency separately from end-to-end scan time. Stratify results by service and bug class so a strong average cannot hide a weak boundary.

Promote only well-evidenced categories to a merge gate. A gated finding should identify the affected commit and code path, attacker-controlled input, violated invariant, reachability proof or reproducer, and a reviewer-approved severity. Keep an explicit override with a recorded reason and security-owner approval. Continue post-submit or nightly scans for cross-change issues, as Google does, and use their misses to update the test corpus. When the baseline shifts, remeasure before widening the gate. This follows the same principle as [CI evaluation gates for agents](/lab/agent-evals-cicd/): a gate is justified by observed behavior on your workload.

The target is a system that gives developers timely, defensible evidence at the moment they can still change the code. Mantis offers a useful reference workflow; the production result comes from the threat model, independent validation, sandbox boundary, measured thresholds, and human security review around it.

## Sources

- [Google Cloud: Changing the game: Using agentic AI to secure infrastructure code](https://cloud.google.com/blog/topics/systems/using-ai-agents-to-secure-google-infrastructure/) (September 18, 2026).
- [Google Cloud: Getting started with Mantis, our open-source bug finding-and-fixing harness](https://cloud.google.com/blog/products/identity-security/getting-started-with-the-mantis-harness-to-find-and-fix-bugs) (September 2, 2026).
- [Google Mantis repository and README](https://github.com/google/mantis), including safety guidance and project disclaimers.
