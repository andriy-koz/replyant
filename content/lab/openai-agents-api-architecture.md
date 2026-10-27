---
title: "OpenAI Agents API: Architecture for Long-Running Agents"
date: 2026-09-21
tags: ["AI Agents", "Architecture", "Developer Tools", "Governance"]
description: "OpenAI's new Agents API separates sessions, sandboxes, tools, and credentials. Build durable agents without turning their workspace into a trust boundary."
faq:
  - q: "What does the OpenAI Agents API provide?"
    a: "It provides a managed agent harness plus sessions, tools, and a choice of hosted, partner, or self-hosted compute environments."
  - q: "Why should a session be distinct from a sandbox?"
    a: "The session preserves the logical work; a sandbox is disposable execution space that can be rebuilt or restored without inheriting authority."
  - q: "What does a vault placeholder mean?"
    a: "It is not the secret: in an OpenAI-hosted sandbox, a proxy substitutes the real credential only for an approved HTTPS destination."
  - q: "What makes resume safe?"
    a: "Resume from authenticated, data-only workflow state, recreate current permissions, and reauthorize any side effect before it runs again."
---

Treat an OpenAI Agents API deployment as four independently governed planes: a durable logical session, a disposable sandbox workspace, a tool and egress boundary, and a credential broker. Persist the first plane and small, authenticated workflow records. Recreate the other three from current policy. That division is how an agent can survive a crash or a multi-hour pause without making an injected workspace durable, or letting a recovered container retain authority it no longer deserves.

OpenAI announced the Agents API in public beta on September 10, 2026. The release turns the harness and infrastructure used behind Codex into a managed API for agents that can work over long sessions, use tools, run code, and save intermediate artifacts. OpenAI says its experience scaling Codex and ChatGPT for Work informed the service; developers choose the environment, tools, knowledge, and workflow around the managed harness. [The announcement](https://openai.com/index/introducing-the-agents-api/) is significant because it makes agent runtime infrastructure a product surface, rather than leaving every team to assemble a loop, context manager, executor, and recovery system from scratch.

The API does not remove the architectural work. A session is not a container; a filesystem is not a database; an egress rule is not authorization; and a visible variable is not automatically a safe place for a secret. Those distinctions decide whether a long-running agent is recoverable or merely a privileged process with a chat history.

## What OpenAI launched and why the harness is infrastructure

The OpenAI Agents API supplies an evolving Codex harness and infrastructure, not just a model endpoint with a tool list. For work that lasts hours or days, it must keep context usable, select tools without stuffing every schema into the prompt, execute work in an environment, and continue a task across interruptions.

OpenAI documents automatic context compaction as a session approaches its context limit. It also documents tool search, which loads relevant definitions as needed to reduce token use and preserve the model cache. Programmatic tool calling can run calls in parallel, chain operations, and filter or combine results in code before returning them to context. The API supports MCP, custom functions, and built-in tools including web search. These are product capabilities, not a guarantee that a workflow is safe or resumable. [OpenAI's launch post](https://openai.com/index/introducing-the-agents-api/) describes the harness capabilities and environment choices.

This makes the harness infrastructure. Context compaction changes what the model can carry; tool search changes its effective interface; programmatic calling moves loops and data into execution; and the environment determines accessible files, packages, and network paths. Each creates a distinct failure and security boundary.

For that reason, do not make a sandbox directory your system of record simply because it is convenient. A task that saves `plan.md`, a Python virtual environment, and a partial export to `/workspace` has useful *artifacts*, but it has not created durable business state. The durable record should say what work was requested, the authenticated principal and policy version, the checkpointed plan or decision facts, the idempotency keys already consumed, and the artifact references that were verified. It should not say “resume container `abc123` and trust whatever it contains.”

The difference becomes acute after prompt injection. An agent may be induced to write a misleading instruction into its workspace or a malicious file into a snapshot. If the next run treats that directory as the source of task identity, tool grants, or pending approval, the injection crosses a restart boundary as authority. That is the persistence failure described in [our analysis of agent state persistence and RCE](/lab/agent-state-persistence-rce/): durable workflow state must be authenticated and data-only. The same rule applies even when no deserialization flaw is present.

## The four-plane model: session, environment, tools, and vault

Model these planes independently, each with an owner, lifecycle, audit record, and restore rule. The table is an architectural recommendation rather than an assumption that a prior resource remains valid.

| Plane | What it represents | What may be durable | What must be rebuilt or rechecked | Primary failure to prevent |
|---|---|---|---|---|
| Logical session | The task's conversation, progress, and outcome | Session identifier, task specification, decision-critical summary, event log, artifact hashes | Caller identity, tenant policy, approval status, model and tool configuration | Losing work or resuming under the wrong user or policy |
| Sandbox environment | Compute, packages, filesystem, and temporary workspace | Signed artifact references or a content snapshot when justified | Fresh environment, image, manifest, path grants, resource limits | Turning a stale or injected workspace into durable authority |
| Tools and egress | The actions and destinations available to the agent | Tool version, allowlist version, call journal, idempotency keys | Tool schemas, function authorization, MCP connection policy, network host rules | Replaying writes or contacting an unapproved service |
| Credential broker | Secrets and the policy that may apply them | Credential reference, scope, expiry, rotation and consent metadata | Current grant, destination match, proxy or application-side authorization | Exposing an application or third-party secret to agent-authored code |

The logical session is the plane that normally spans a long task. Record the task, tenant and principal, progress events, decisions, pending approvals, and immutable artifact pointers. Context compaction can help the model continue reasoning, but cannot replace this business event record. Preserve decision-critical context, as explained in [our guide to context folding](/lab/context-folding/), instead of relying on a transcript or mutable scratchpad.

The environment is where the agent acts, not where it gains identity. It may be OpenAI-hosted, self-hosted, or supplied through an ecosystem integration. OpenAI’s security guidance starts with the relevant premise: agent-generated code can access the files, credentials, and network available to its environment. It recommends isolated compute and separate environments for users or workloads that must not share data. Read that as a direct design constraint: never mount a shared tenant volume, inject a production application key, or provide broad cloud identity just because an agent needs one small external operation. [The sandbox security guide](https://developers.openai.com/api/docs/guides/agents-api/environments/security) is explicit about this exposure model.

The tools plane is broader than the model’s tool declaration. It includes custom functions, MCP servers, built-in tools, programmatic calling, and direct network paths. A function definition only describes a possible call. Production policy must also bind it to a tenant, purpose, approval state, rate limit, data classification, and idempotency key for external mutations. This matters when code chains calls faster than a human can inspect them. See [our field guide to programmatic tool calling](/lab/programmatic-tool-calling/).

The vault plane holds credential material outside prompts and agent configuration. It should be a broker, not a convenience cache for secrets. The broker decides which current credential can be used for which destination and operation. Its durable data is metadata and references; the secret itself should remain inaccessible to agent-authored code whenever the capability can be mediated elsewhere.

## Build a long-running agent without a long-lived container

Build the workflow as a state machine whose execution environments are replaceable. Checkpoint after a meaningful, observable boundary: a research result has been normalized, an artifact has been stored and hashed, a planned mutation has obtained approval, or an external write has returned a receipt. On restart, load the authenticated checkpoint, create a fresh sandbox from the current manifest, attach only the current allowed tools and credentials, then continue from the next unfinished step.

Keep outputs in controlled storage and carry forward only facts needed to reconstruct the task. A document-analysis agent might persist a source object reference and SHA-256 digest, extracted findings, a query plan, and a pending “publish report” approval. It can regenerate indexes and package caches in a new sandbox.

Use a durable task record with explicit phases. The following is illustrative application data, not an OpenAI API request or SDK call:

```yaml
# Illustrative durable workflow record: authenticated, data-only, no container ID.
task_id: task_01H...
principal: tenant/acme:user/42
policy_version: 2026-09-21.3
phase: awaiting_publish_approval
inputs:
  - object: s3://controlled-inputs/case-918.pdf
    sha256: "..."
decisions:
  - source_set_verified
  - report_draft_created
artifacts:
  - object: s3://controlled-artifacts/task_01H/report.md
    sha256: "..."
side_effects:
  publish_report:
    idempotency_key: task_01H:publish:v1
    status: not_started
approval: required
```

Notice what is missing: a container handle, shell state, a credential value, and a blanket assertion that prior tool grants are still good. A container ID is an implementation pointer, not durable authority. A shell history is untrusted input. A credential must be resolved under current policy. An approval is a decision about a particular action under a particular principal and input set; it should expire or become invalid when those change.

Make every external write idempotent. Use an application-generated idempotency key that ties together the task, logical operation, and version of the intended payload. Store the request digest and the accepted receipt. On resume, query or replay with the same key rather than blindly issuing another write. This is an architectural practice, not a documented Agents API guarantee. It protects against the ordinary cases a long run creates: a worker crashes after a provider accepted a request, a webhook is delivered twice, or an operator retries after a timeout.

Reauthorization belongs beside idempotency. Before a deferred action runs, re-evaluate the current principal, tenant membership, data classification, spending limit, destination, and policy version. A task may be logically continuous while its authority is not: the user can be removed, consent can expire, an MCP server can be reconfigured, or a document can be reclassified. A resumed agent should be able to repeat a safe read from authenticated data, but it should never inherit a prior decision to send email, open a ticket, deploy code, or transfer data without checking whether that decision still applies.

The OpenAI Agents SDK has a useful, narrower example of this principle. Its sandbox-client documentation distinguishes conversation state from sandbox state. For its documented Docker integration, reusing a live container from the same in-memory `RunState` requires identity verification and revalidation of the current manifest, environment, and path grants. A serialized and reconstructed `RunState` instead restores from a snapshot rather than attaching to a serialized container ID; without a restorable snapshot, resume fails rather than attaching to an unverified container. That behavior is specific to the SDK integration, but its design lesson is general: persist contents when needed, not unverified live-container authority. See the [SDK's resume and snapshots guidance](https://openai.github.io/openai-agents-js/guides/sandbox-agents/clients/).

## Credential brokering: a placeholder is not a secret

For an OpenAI-hosted sandbox, a vault can supply an `environment_variable` credential for outbound API requests. The sandbox receives a placeholder in the named variable. A network proxy replaces that placeholder with the real secret only for approved hosts. Printing the variable in the sandbox shows the placeholder, not the token. The placeholder cannot furnish a secret for local computation such as request signing. In that case, keep the credential in your application and expose the narrow operation through a function tool. These are documented Vaults behaviors, not merely recommended patterns. [OpenAI's Vaults guide](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults) gives the details.

The sandbox can still make an approved request, so an injected agent may ask the target API to act within the credential’s scope. But it cannot read the underlying token from the placeholder and carry it elsewhere. Scope, destination restrictions, and the target API’s authorization still matter. A broad read/write repository token gives the agent far more power than a short-lived, read-only token, even when it never appears in cleartext.

Two host lists must be configured consistently for a hosted session with a restricted network. The environment’s `allowed_domains` controls whether the sandbox can connect to a host. The credential’s `allowed_hosts` controls whether the proxy may supply that credential to the host. Every credential host needs to be in `allowed_domains`; network access must not be `disabled` when an environment credential is required. For `allowed_hosts`, OpenAI requires exact host names with no scheme, path, port, or wildcard, and proxies credentials only to HTTPS on port 443 or 8443.

Here is a deliberately small configuration review artifact. It represents the documented values to compare during deployment; it is not a complete session-creation request:

```yaml
# Illustrative policy inventory, derived from documented hosted-session fields.
network:
  access: restricted
  allowed_domains:
    - api.github.com
vault_credential:
  type: environment_variable
  secret_name: GITHUB_TOKEN
  networking:
    type: limited
    allowed_hosts:
      - api.github.com
```

Treat a mismatch as a deployment error, not a troubleshooting detail. If `allowed_hosts` includes a hostname that the environment cannot reach, the agent will fail in confusing ways. If `allowed_domains` has destinations that credentials are not authorized for, the sandbox may reach them without receiving that secret. Neither list replaces a tool authorization policy. Review their intersection with the credential scope and the actual API operation the agent is allowed to perform.

For self-hosted environments, do not attempt to recreate this safety property by putting a real secret in a process environment variable. OpenAI’s security guidance says generated code can read the environment key and says to keep the application API key outside the environment. It recommends a trusted proxy or server that supplies secrets outside the environment; function tools should keep credentials in the application handling the call and return only the result. Store long-lived credentials in a secrets manager, but remember that injecting one into an environment still exposes it to agent-generated code. [The security guide](https://developers.openai.com/api/docs/guides/agents-api/environments/security) states this plainly.

## Sandbox isolation, egress, and state restoration

Start every sandbox with the smallest useful workspace: selected inputs, a writable output directory, a fixed base image, package policy, bounded resources, a deadline, and restricted outbound hosts. Isolate tenants and workloads that must not share data. Export artifacts explicitly, so the application can hash, scan, classify, and attribute them rather than letting a home directory become durable storage.

This is not an argument against snapshots. A snapshot is useful when recreating dependencies or work products would be costly, and the SDK guidance distinguishes a fresh session seeded from saved workspace contents from reconnecting to a live backend session. The recommendation is to treat a snapshot as untrusted material to be restored into a fresh, current policy envelope. Validate its provenance and scope, reapply the current manifest, and do not take shell configuration, mounted credentials, or cached instructions as a grant of authority.

Mounts deserve the same caution. The Agents SDK documentation warns that credential-bearing mounts using helpers inside the sandbox are rejected by default because model-controlled code may access the helper’s process credentials. It describes exact-path acknowledgements for particular mount setups, and also says those acknowledgements do not confine credentials to the mount path: other model-controlled code in the same sandbox might recover them. That is integration-specific guidance, but the conclusion transfers cleanly: prefer credentialless artifact access or a provider-side mount whose credentials remain outside the agent-controlled environment. [The sandbox client guide](https://openai.github.io/openai-agents-js/guides/sandbox-agents/clients/) documents the caveats and restore behavior.

Your runtime should also make egress auditable. Record the requested host, resolved policy version, tool or credential reference, action class, and outcome. Do not log secrets, placeholders, or sensitive payloads. Correlate those records to the logical task ID, not merely a short-lived container ID. When an incident occurs, you need to answer which durable task requested a connection, which policy admitted it, and whether the action is safe to retry—not just which temporary machine ran a process.

## Production deployment checklist

Use this checklist to turn the four-plane model into a release gate. The items below are architectural recommendations. They complement, rather than replace, OpenAI's documented environment and Vaults configuration requirements.

- **Session:** Store task identity, tenant and principal, decision-critical summary, policy version, artifact hashes, approval state, and idempotency records in authenticated data-only storage. Define retention and deletion rules.
- **Environment:** Create separate sandboxes for isolated tenants or workloads. Pin the base image and manifest. Export artifacts explicitly. Recreate an environment on resume unless a documented integration can verify live identity and revalidate current grants.
- **Tools:** Inventory every MCP, custom function, and built-in tool. Separate read operations from mutations. Make writes idempotent, journal receipts, set budgets and timeouts, and require a fresh authorization decision for deferred external actions.
- **Egress:** Default to restricted networking. Review hostnames as exact dependencies. Map each allowed destination to a task purpose, a tool route, and a credential policy. Alert on denied requests and unexpected destination drift.
- **Credentials:** Keep application keys outside agent environments. Use a broker or function tool for operations that require local signing or narrow server-side logic. For hosted vault environment credentials, verify that `allowed_domains` and `allowed_hosts` describe the same intended hosts.
- **Restore:** Verify input and snapshot provenance. Rebuild from the current manifest and policy. Reauthenticate the principal, re-evaluate consent and authorization, and revalidate output targets before side effects resume.
- **Observability:** Correlate session events, sandbox lifecycle, tool calls, egress decisions, approvals, and idempotency keys under a durable task ID. Redact secrets and classify sensitive artifacts before retention, including stored reasoning blocks, which [can be decoded and mined for secrets](/lab/stealing-reasoning-traces/).
- **Testing:** Kill a run at every state transition. Simulate a duplicated webhook, expired credential, changed tool definition, revoked user, altered snapshot, and denied destination. The correct result is a safe resume, a safe replay, or a visible stop—not an implicit reuse of authority.

The Agents API lowers the cost of adopting a capable harness; it does not change the fact that the agent, workspace, tool surface, and credential path have different risk profiles. Make the logical session durable. Make the sandbox disposable. Make tools and egress explicit policy boundaries. Make credentials brokered capabilities. Then a long-running agent can restart as a continuation of verified work instead of a resurrection of an old, privileged machine.

## Sources

- [Introducing the Agents API — OpenAI](https://openai.com/index/introducing-the-agents-api/)
- [Sandbox security — OpenAI API documentation](https://developers.openai.com/api/docs/guides/agents-api/environments/security)
- [Vaults — OpenAI API documentation](https://developers.openai.com/api/docs/guides/agents-api/tools/vaults)
- [Sandbox clients: resume, snapshots, and mounts — OpenAI Agents SDK](https://openai.github.io/openai-agents-js/guides/sandbox-agents/clients/)
