---
title: "Claude Code Routines: Scheduled, Event-Driven Workflows Beyond Hooks"
date: 2026-08-23
tags: ["AI Agents", "Claude Code", "Developer Tools", "Architecture"]
description: "Claude Code Routines adds scheduled, API, and event triggers beyond Hooks, Skills, and MCP — wiring and hardening for overlap, idempotency, and secrets."
---

<aside class="quick-answer">
  <p>Claude Code Routines (announced May 15, 2026) adds time and event as first-class triggers — schedule, API call, and external event — as the sixth extension point beyond CLAUDE.md, Skills, MCP, Hooks, and Plugins. A routine is a declarative, versioned workflow that runs unattended with bounded timeouts, singleton concurrency, and audit trails. Teams replacing cron+webhook hacks cut unattended-task failures 60% and reclaim 4-6 hours per week of manual triage.</p>
</aside>

Claude Code shipped five extension points that turned a general agent into a team member: `CLAUDE.md`, Skills, MCP Servers, Hooks, and Plugins. We mapped them in [Claude Code in production](/lab/claude-code-in-production/). The missing primitive was time. Every nightly triage, every on-merge cleanup, every "when Sentry fires, open a branch" lived outside Claude Code as a cron job shelling out to `claude -p` or a webhook pasting JSON into a prompt. Routines collapses that glue into the runtime: declarative, scheduled, and event-driven execution with the same tool and permission model your interactive sessions use.

If Hooks answer "what happens automatically *while* the agent is running," Routines answers "what happens when no human started it at all."

---

## What Routines Are: The Three Invocation Surfaces

Routines is a workflow primitive with three trigger surfaces, one sandbox, and one permission boundary. Per Anthropic's May 15 announcement via [InfoQ](https://www.infoq.com/news/2026/05/claude-code-routines/), the same routine definition can be invoked on a cron schedule, through an API call, or in response to an external event — all sharing concurrency, retry, and observability semantics.

```
                    ROUTINE LIFECYCLE
  ┌──────────────────────────────────────────────────────────┐
  │  TRIGGER SURFACE             ROUTINE DEFINITION          │
  │  • schedule  ─┐              routines.json / .claude/    │
  │    cron + TZ   │────────────▶  name, trigger, run,       │
  │  • api-call  ──┤              concurrency, timeout,       │
  │    POST /routines/run        retry, onError, env         │
  │  • external-event ─┘                │                    │
  │    webhook / MCP event              ▼                    │
  │                          ┌──────────────────┐            │
  │                          │  SANDBOXED RUN   │            │
  │                          │  CLAUDE.md +     │            │
  │                          │  Skills + MCP +  │            │
  │                          │  Hooks (scoped)  │            │
  │                          └────────┬─────────┘            │
  │                          logs / traces / cost / audit    │
  └──────────────────────────────────────────────────────────┘
```

The three surfaces replace three hacks:

*   **Schedule** — `cron: "0 2 * * *"` with IANA timezone. Nightly triage, hourly drift checks, weekly audits. Pre-Routines this was GitHub Actions cron invoking `claude --print`, with no concurrency guard and no structured audit. Routines enforces `concurrency: singleton` and emits a trace per run.
*   **API trigger** — `POST /routines/{name}/run` with JSON mapped to `$ROUTINE_INPUT`. Pre-Routines the API was "pipe JSON on stdin" with no auth scoping. Routines adds typed `inputSchema` validation and a service-account identity with a narrower allowlist than your interactive session.
*   **External event** — webhook or MCP event (`github.push`, `sentry.issue.created`). The event body is the trigger payload; the routine does not poll. This is the vertical/horizontal split from the [MCP + A2A convergence](/lab/mcp-goes-stateless/): MCP connects vertically to systems, Routines listens horizontally for their events.

All three converge on one `run` block — a Skill, slash command, or prompt with bounded tool access — executed in an ephemeral sandbox that loads `.claude/` config under a distinct trust tier.

## How do Routines compose with the five existing extension points?

Routines do not replace Hooks, Skills, MCP, Plugins, or CLAUDE.md — they orchestrate them on a timer or event. A routine loads CLAUDE.md for conventions, invokes a Skill as its entrypoint, reaches systems via MCP, is constrained by PreToolUse Hooks, and can ship as a Plugin. One declarative file wires the five primitives you already maintain into unattended workflows with concurrency and audit you previously built by hand.

This is the fact to internalize before writing `routines.json`: a routine adds no new capability of its own. If your `PreToolUse` hook blocks `rm -rf` interactively, it blocks it at 02:00 too — unless you explicitly scope hooks per routine.

| Primitive | Role inside a Routine | Reuse? |
|---|---|---|
| `CLAUDE.md` | Project conventions, test commands, commit format | Reused verbatim |
| Skills | The `run` entrypoint — `/triage`, `/fix-issue` | Reused; gets `args` + `$ROUTINE_INPUT` |
| MCP Servers | Data plane — Sentry, GitHub, staging DB | Reused; inherits `.mcp.json` |
| Hooks | Guardrails — block destructive Bash, protect `.env` | Reused; scoped via `hooks.allow` |
| Plugins | Distribution — bundle routine + skill + hooks | Reused; plugin ships `routines/` |

Scoping matters. By default a routine inherits global and project hooks. Drop the expensive LLM-judge `prompt` hook for read-only audits — it adds 800–1,200 ms per tool call and $0.015 per invocation (12–18 calls per triage = $0.18–0.27 per run, $65–98 per year wasted). Keep the destructive-command guard for any routine that writes code. See the [realistic setup in Claude Code in production](/lab/claude-code-in-production/) — that setup lifted into a schedule is a routine.

## Wiring a Production Routine: A Working routines.json

Canonical location is `.claude/routines.json` (project) or `~/.claude/routines.json` (user). Schema below reflects the announced shape — schedule, API, and event triggers, concurrency, timeouts, retries. Treat field names as RC-final and validate with `claude routines validate` before deploying.

```json
// .claude/routines.json — three routines, one per trigger surface
{
  "version": 1,
  "routines": [
    {
      "name": "nightly-triage",
      "description": "Collect Sentry issues and GitHub PRs, draft triage report",
      "trigger": { "type": "schedule", "cron": "0 2 * * *", "timezone": "UTC" },
      "run": { "skill": "triage", "args": "--repo myorg/app --since 24h --write reports/triage.md" },
      "concurrency": "singleton",
      "timeout": "15m",
      "retry": { "attempts": 2, "backoff": "exponential", "initialDelay": "30s" },
      "onError": { "notify": "slack://#eng-ops" },
      "hooks": { "allow": ["protect-files", "guard-bash"] }
    },
    {
      "name": "on-demand-fix",
      "description": "API-triggered fix for a GitHub issue",
      "trigger": {
        "type": "api",
        "inputSchema": {
          "type": "object",
          "properties": {
            "issue": { "type": "integer" },
            "branchPrefix": { "type": "string", "default": "fix" }
          },
          "required": ["issue"]
        }
      },
      "run": {
        "skill": "fix-issue",
        "args": "$ROUTINE_INPUT.issue",
        "prompt": "Fix issue #$ROUTINE_INPUT.issue on branch $ROUTINE_INPUT.branchPrefix/$ROUTINE_INPUT.issue. Use Bun, run bun test, open a PR."
      },
      "concurrency": "queue",
      "timeout": "20m"
    },
    {
      "name": "sentry-to-branch",
      "description": "On high-priority Sentry issue, open a repro branch",
      "trigger": {
        "type": "event",
        "source": "mcp://sentry/issue.created",
        "filter": "event.level in ['error','fatal'] && event.project == 'app-backend'"
      },
      "run": { "skill": "reproduce", "args": "--sentry-id $EVENT.id --write repros/$EVENT.id.md" },
      "concurrency": "parallel",
      "timeout": "10m"
    }
  ]
}
```

Three callouts:

**Concurrency prevents cron pileup.** `singleton` means a second tick while the first run is live is skipped or queued (`onConflict: skip|queue`). Pre-Routines cron had no guard — two `claude -p` invocations raced on the same branch. Use `singleton` for anything writing to git, `parallel` only for read-only handlers on disjoint keys like `repros/$EVENT.id.md`.

**inputSchema makes API triggers typed.** JSON Schema validates `$ROUTINE_INPUT` before the run starts — a malformed caller gets 400, not a prompt-injected branch name, the same discipline we enforce inside [tool calling handlers](/lab/anatomy-of-ai-agent-tool-calling/).

**hooks.allow narrows guardrails.** Nightly triage keeps cheap shell guards and drops the `prompt` LLM judge, saving ~$0.22 per run. Write paths must keep `protect-files` even at cost.

Wire the Skill the routine calls in `.claude/skills/triage/SKILL.md`:

```markdown
<!-- .claude/skills/triage/SKILL.md -->
---
name: triage
description: Draft a triage report from Sentry + GitHub
allowed-tools: Read, Grep, Bash, mcp__sentry__list_issues, mcp__github__search_issues
---

You are running as a scheduled routine. Input: $ARGUMENTS
Trigger context: $ROUTINE_INPUT / $EVENT

1. List Sentry issues for myorg/app created in last 24h.
2. List GitHub PRs needing review.
3. Draft reports/triage.md with Summary, Top 3 risks, Suggested owners.
4. Do not push or merge — write the report and exit.
```

`allowed-tools` is the runtime allowlist — a scheduled run cannot call a tool its skill does not list, even if an MCP server exposes it. Narrowest privilege when no human watches.

Trigger the API routine from CI:

```bash
curl -s -X POST https://api.claude-code.myorg.internal/routines/on-demand-fix/run \
  -H "Authorization: Bearer $CLAUDE_ROUTINES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"issue": 142, "branchPrefix": "fix"}' | jq .

curl -s https://api.claude-code.myorg.internal/routines/on-demand-fix/runs/$RUN_ID | jq .status
```

The API returns run ID, idempotency key, and OTel trace ID correlating every tool call including MCP. Slice [tool selection accuracy and token efficiency](/lab/context-engineering/) per routine name.

## Execution Model: Ephemeral, Concurrent, and Retried

A routine does not run inside your interactive session. It runs in an ephemeral sandbox — fresh checkout snapshot, fresh context window, fresh allowlist — torn down on completion or timeout. One run's leftover `git stash` cannot poison the next.

```
   INTERACTIVE SESSION                ROUTINE RUN (ephemeral)
   persistent checkout                snapshot @ trigger ref
   persistent context window          fresh window per run
   your identity                      service-account identity
   hooks: full set                    hooks: allowlisted subset
   timeout: session-bound             timeout: per-routine (15m)
   concurrency: N/A                   concurrency: singleton|queue|parallel
   retry: manual                      retry: declarative + backoff
```

**Concurrency modes:** `singleton` (one active run, second trigger dropped or queued), `queue` (FIFO, bounded by `queueMax`), `parallel` (unbounded, correct only for read-heavy handlers on disjoint keys).

**Retries and timeout.** `retry.attempts: 2` with exponential backoff covers transient 429s from MCP servers. Do not retry deterministic hook blocks — `protect-files` will block the retry identically. `timeout: 15m` terminates the sandbox and runs `onError` notification plus artifact upload. This is the [effort/task-budget discipline](/lab/claude-fable-5-effort-task-budgets/) as a platform guarantee. A silent routine failure is worse than no routine — it fakes that triage happened.

**Overlap handling.** `singleton` stops two routine instances overlapping, but idempotency inside a single run still matters. Writing `reports/triage-2026-08-23.md` (date-stamped) instead of overwriting `reports/triage.md` eliminates intra-run races when the routine fans out. Idempotency is a Skill property, not just scheduler policy.

## How do scheduled routines stay secure and observable?

A scheduled routine runs as a service account with narrower MCP scopes, a tighter tool allowlist, and read-only defaults on sensitive paths — unlike an interactive session that inherits your full developer permissions. Every run emits structured logs, an OpenTelemetry trace, token and cost telemetry, and an audit record linking trigger, input, commit SHA, and tool calls.

That contract shapes every production decision after `routines.json` validates.

**Security boundaries versus interactive sessions:**

1.  **Identity.** Routine runs as `runAs` service account, not you. Its OAuth scopes gate what it can do — if `nightly-triage` has `repo:read` + `issues:write` while you have full `repo`, the routine cannot push even if a retrieved issue tries to inject instructions. Scope per routine like [MCP server permissions](/lab/anatomy-of-ai-agent-mcp/).
2.  **Filesystem.** Snapshot checkout, not live working tree. Writes confined to workspace and subject to file-protection hooks. No access to `~/.ssh/id_rsa` unless explicitly mounted — the [prompt-injection exfiltration](/lab/prompts-as-shells-rce/) can still steer behavior, but secret exfiltration is blocked at the mount layer.
3.  **Network egress.** Default allowlist is MCP hosts plus `api.anthropic.com`. `curl https://evil.example` hits the egress guard before the hook. Add hosts explicitly in `egress.allow` and audit the list.

**Observability — four artifacts per run:**

*   **Structured logs** — JSON Lines with `runId`, `triggerType`, `stopReason`, per-tool latency. Alert on `stopReason != "end_turn"`.
*   **OTel traces** — root span per run, child spans per tool call. `traceparent` propagates via `_meta` to MCP servers — the propagation [MCP's stateless core](/lab/mcp-goes-stateless/) standardized for header-routed fleets.
*   **Cost telemetry** — `inputTokens`, `outputTokens`, dollars. Nightly triage averaging 42K input + 9K output on Fable 5 at $10/$50 per million costs ~$0.87 per run, ~$26/month daily. Track per routine so a misconfigured `parallel` handler firing 80 times/day spikes on that routine.
*   **Audit record** — trigger payload, validation result, commit SHA, prompt/skill version, artifact. Diff this when output changes.

If you track [tool selection accuracy below 85%](/lab/context-engineering/) as a regression signal, slice the same metric per routine. No human is there to notice the drop.

## Pitfalls: Idempotency, Overlapping Runs, Secret Rotation, Sandbox Drift

**Secret rotation.** Credentials are injected at run start via `env: { GITHUB_TOKEN: "secret://github/routines-ci-bot" }`. In-flight runs hold the start value; next tick picks up rotation. A 20-minute run spanning a rotation window fails mid-run with 15-minute short-lived tokens. Use a TTL exceeding your longest `timeout`, or fetch short-lived tokens inside the run via an MCP auth server that supports refresh.

**Idempotency.** Every mutating routine must be idempotent under retry. A retry after a transient Sentry 429 re-executes branch creation — if `fix-issue` creates `fix/142` without existence check, the retry conflicts or masks the transient. Check before create, use `Idempotency-Key` on MCP tools, make report writes deterministic (`triage-2026-08-23.md` not `triage.md`).

**Overlapping runs.** `singleton` stops two routine instances overlapping, but not a routine colliding with a human editing the same file. Prefix ownership: `repros/routine/sentry-ABC.md` vs `repros/manual/`.

**Sandbox drift.** Checkout is pinned to HEAD at trigger time, but MCP data is live. Reading Sentry at 02:00:03 and GitHub at 02:00:45 gives 42 seconds of cross-system drift. For joins, snapshot external state up front in the first two tool calls and join that snapshot, not live re-reads.

## Routines vs Cron+Webhook Hacks and vs OpenAI WebSocket Execution

Before Routines, scheduled Claude Code looked like this:

```yaml
# .github/workflows/nightly-triage.yml — the pre-Routines hack
on:
  schedule: [{ cron: "0 2 * * *" }]
jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          echo "Draft a triage report from Sentry + GitHub for last 24h" \
            | claude --print --model claude-fable-5 --allowedTools "Read,Bash,mcp__*"
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

That workflow has five failure modes Routines eliminates: no concurrency guard, no input schema, no per-routine identity, no structured cost telemetry, no audit linking trigger to artifact. It also pays cold-start tax where Routines reuses a warm snapshot. Teams migrating report operational burden dropping from 1–2 hours per week of "why didn't triage run" debugging to near zero, and missed-run detection shrinking from 24 hours to minutes via `onError` notification.

The complementary comparison is [OpenAI's WebSocket-based execution for the Responses API](https://www.infoq.com/news/2026/05/openai-websocket-responses-api/) (May 7, 2026). WebSocket execution replaces HTTP request-response with a persistent bidirectional stream, cutting latency up to 40% for multi-step loops by keeping connection and model state warm. That is a within-run, per-turn play — when an agent chains six tool calls and each round trip costs 200–400 ms. Routines is a between-run play — when should the workflow run at all. The two compose: a routine can drive a model over a persistent stream for latency-sensitive subtasks while the routine owns when it triggers. Do not conflate them — WebSocket makes a fast loop faster, Routines makes an unattended loop trustworthy.

Pair Routines with [speculative tool execution](/lab/speculative-tool-execution/) — 48.5% task-time reduction by firing the predicted next tool while the model streams — and [programmatic tool calling](/lab/programmatic-tool-calling/) for tool-heavy trajectories collapsing to one code-mode turn (~80% cost reduction). Routines owns when the workflow starts; those primitives own how fast and cheap each turn is.

## Where to Start

1.  **Promote one cron hack to one scheduled routine.** Move the nightly job to `trigger: { type: schedule }` with `concurrency: singleton` and `onError.notify`. Validate with `claude routines validate`, dry-run with `claude routines run nightly-triage --dry-run`, measure failure rate and cost for two weeks before adding a second.
2.  **Add one API routine for issue-to-branch.** Wire `on-demand-fix`, call it from CI on `issue.opened` with an idempotency key from `issue.id`, gate writes behind `protect-files` and narrow `allowed-tools`.
3.  **Add one event routine only after the first two are observable.** Start read-only (`sentry-to-branch` writing a repro file). Verify OTel traces propagate and cost slices per routine before allowing side effects.
4.  **Gate routine changes on evals.** Put `routines.json` changes through [agent evals in CI/CD](/lab/agent-evals-cicd/) — tool selection accuracy, artifact correctness, cost regression. A 20% cost jump on a routine firing 30 times a day compounds faster than an interactive regression you notice immediately.

Routines closes the gap between "useful when a human drives it" and "useful when no human is there." The five extension points gave governance, capability, and distribution for interactive work — see the full taxonomy in [Claude Code in production](/lab/claude-code-in-production/) and [system prompt patterns](/lab/anatomy-of-an-ai-agent-system-prompt/). Routines adds time and events with the same governance. The model is the same for everyone. What separates a team that wakes up to a triage report from one that wakes up to a PagerDuty alert is the wiring — one file, one service account, four dashboards.

---

*We wire Claude Code for production — Hooks, Skills, MCP, Plugins, and now Routines — with eval and observability to prove it holds when no one is watching. If you are promoting cron hacks to scheduled agents and want concurrency, identity, and cost handled before it runs unattended, [let's talk](/#contact).*
