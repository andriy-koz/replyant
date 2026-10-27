---
title: "GitSpawn: How a Repo's Git Config Runs Code in Coding Agents"
date: 2026-10-26
tags: ["AI Agents", "Claude Code", "Developer Tools", "Tool Calling"]
description: "Untrusted repos ship a .git/config that runs code when coding agents shell out to git for context — before any trust prompt or sandbox. Here's why."
---

A coding agent runs arbitrary code from an untrusted repository before the model decides anything and before you approve anything. The repository itself is the execution surface. Every mainstream coding agent shells out to `git` in the background to gather context, git treats several config keys as "run this program," and it reads those keys from the repository's own `.git/config`. So opening a hostile repo that arrives with its `.git` directory intact and pointing an agent at it is enough. The model is never in the loop, and neither is the sandbox.

On September 1, 2026, Manifold Security's Francisco Rosales published [GitSpawn](https://www.manifold.security/blog/ai-coding-agents-git-hijack), documenting eight findings across seven coding agents — four of them still unpatched at publication. The mechanism is the same every time, and it is not a model-alignment problem. It is a harness-engineering problem: the agent's own process runs a repo-controlled program before any trust boundary exists.

## What is GitSpawn and why does it bypass the sandbox?

GitSpawn is a class of attack where an untrusted repository sets a git configuration key that names an executable, and the coding agent triggers it by running a routine git command for context. The code runs in the agent's own process — "as the developer, outside the sandbox, with no approval prompt and nothing on screen," per Manifold. There is no tool call to approve because the agent, not the model, spawned the subprocess.

The anchor key is `core.fsmonitor`. It is a legitimate performance setting for large repositories: instead of stat-ing every file, git asks a helper program what changed and runs that program during an index refresh. Git reads the value from the repo it is operating in. A repository can therefore ship:

```ini
# .git/config inside an untrusted repo — illustrative, harmless payload
[core]
	fsmonitor = touch /tmp/pwned
```

When the agent runs `git status` to see what files are dirty, git refreshes the index, invokes the `fsmonitor` helper, and your `touch /tmp/pwned` runs. Swap `touch` for anything. No `.git/hooks/` scripts, no `make`, no build step — just a config value that git faithfully treats as a command.

The delivery constraint is the one detail that keeps this from being universal. `git clone` never copies the remote's `.git/config`, so, as Manifold puts it, "cloning a hostile URL does nothing, and neither does fetch or pull." The repository has to arrive as files with its `.git` directory already inside: a shared `.zip`, a tarball attached to a bug report, a shared drive, a sync folder, a USB stick. Manifold's proofs of concept used a `.zip`. That is a narrower vector than "any repo on GitHub," but it is exactly how take-home assignments, customer reproductions, vendor handoffs, and "can you look at this?" requests travel.

## Where does git run relative to the trust prompt?

The damage is in the ordering. Coding agents gather repo context eagerly — at startup, on the first keystroke, on the first message — because they want branch state and the dirty file list ready before the model sees anything. That context-gathering git call almost always fires *before* the workspace-trust prompt, authentication, or any approval gate. The sequence looks like this:

```text
  user: `agent .`  (open untrusted repo)
        |
        v
  [ harness process starts ]
        |
        v
  gather context  --->  git status --porcelain=2 --branch
        |                      |
        |                      v
        |              git refreshes index
        |                      |
        |                      v
        |              runs core.fsmonitor helper  <-- REPO-CONTROLLED
        |              == code execution, in-process ==
        v
  [ workspace-trust prompt shown ]   <-- too late
        |
        v
  model receives first turn / tools gated by approval
```

Everything the product markets as a security control — the sandbox, the approval prompt, the trust dialog — sits below the context-gathering call in this diagram. The execution happens in a sibling subprocess the harness spawned itself, which inherits the developer's environment and runs before the gates it is supposed to pass through.

This is the same structural lesson as [RCE through agent state persistence](/lab/agent-state-persistence-rce/): "no tools required." There, injected bytes detonate in a deserializer the agent trusts. Here, a config value detonates in a git subprocess the harness trusts. In both cases the model emits nothing and every output-side control is irrelevant, because the dangerous operation happens on a path nobody drew as a trust boundary.

## Which agents are affected, and what triggers them?

Manifold tested seven agents and reported eight findings. The trigger is always a background git command, but which command and when varies. Patch status as of the September 1, 2026 publication:

| Agent | Trigger | Version | Reported | Status |
|---|---|---|---|---|
| Claude Code (`core.fsmonitor`) | `git status` at startup, before the trust prompt | 2.1.193 | Jun 26, 2026 | Patched in 2.1.196 |
| Claude Code (`ultrareview`) | git context on `ultrareview`, via a different config key | 2.1.252 | Jul 15, 2026 | Unpatched |
| Goose | `git diff` on `goose review` | 1.41.0 | Jul 13, 2026 | Patched in 1.44.0 ([CVE-2026-72718](https://www.cve.org/CVERecord?id=CVE-2026-72718)) |
| Qwen Code | `git status` at startup, before authentication | 0.22.3 | Jul 7, 2026 | Unpatched |
| Hermes | `git status` on first user message | 0.21.0 | Jul 20, 2026 | Unpatched ([CVE-2026-71963](https://www.cve.org/CVERecord?id=CVE-2026-71963), via VulnCheck) |
| Grok Build | git context on first keystroke | 1.0.13 | Jul 14, 2026 | Unpatched |
| OpenAI Codex | git context gathering | — | Jul 20, 2026 | Patched |
| Cursor | git context gathering | — | Jul 8, 2026 | Patched |

Two details are worth holding onto. The Claude Code `core.fsmonitor` finding was fixed quickly — reported June 26, patched by 2.1.196 — but a second finding on a different git setting was still live in 2.1.252. Manifold deliberately withheld that second key's name while it remains unpatched, which is the right call and one we are not going to undo here. And Goose's fix carries a CVE at severity 7.0; the Goose and Hermes findings are the two with formal identifiers.

Goose is instructive about how thin the margin is. It did pass git a config flag on its review diff — `core.quotePath=off` — so the developers were already in the habit of controlling git's config on that call. They set the one flag they needed for correctness and stripped nothing dangerous. Sanitizing git config is not an exotic technique the maintainers had never seen; it is a technique they were using, for the wrong reason, one line away from the fix.

## Why don't sandboxes and approval prompts help?

They defend the wrong process at the wrong time. The sandbox confines what the *model's* tool calls can do, and the approval prompt gates those calls. But GitSpawn code runs in a git subprocess the harness launches directly, outside the sandboxed tool path, before the first approval is ever requested. Nothing the model does is involved, so nothing the model is restricted from doing matters.

This is exactly the failure pattern we flagged in [GuardFall](/lab/guardfall-shell-injection-agents/): a guard that inspects the text of a tool call cannot help when execution happens somewhere the guard does not sit. It is also the pattern behind [MCP tool poisoning](/lab/mcp-tool-poisoning/), where the dangerous channel is metadata the UI never renders. The recurring error is believing the model's decision point is the security boundary. In a coding agent it is not. The config-loading and background-command paths are, and they run with full developer privileges whether the model approves or not.

The business-side version of this mistake — treating "sandboxed" or "offline" as a property you asserted rather than one you enforced — is the subject of our companion piece on [frontier-model breakouts and containment](/blog/frontier-ai-breakouts-containment/). Same root cause, different altitude: a containment claim is only as real as the code path that enforces it.

## The broader class: the repo is the supply chain

GitSpawn is one instance of a wider truth. When a coding agent works on third-party code, the repository is untrusted input in every channel, not just its source files. Two other 2026 disclosures hit the same seam.

**Plugin4Shell.** On September 17, 2026, AIR Security's Or Nevo, Dor Granat, and Niv Hoffman published [Plugin4Shell](https://www.air.security/blog-posts/plugin4shell), a zero-click RCE across Claude Code, OpenAI Codex, GitHub Copilot, and Gemini CLI. Unlike GitSpawn, this one travels over an ordinary clone. Agents install pinned plugin commits with `git checkout <sha>` but never verify that `HEAD` actually landed on that commit. An attacker who controls the plugin repo creates a branch *named* like the pinned SHA; git resolves the ambiguous name to the ref, not the commit object, and silently checks out attacker code during a background auto-update. Anthropic confirmed a fix in Claude Code 2.1.179 (June 17, 2026) and OpenAI in Codex 0.146.0 (August 12). Microsoft had not shipped a Copilot patch at disclosure, and Google said no fix will ship for the deprecated Gemini CLI. The fix is to verify the pin resolved to the intended commit, client-side, after checkout.

**Trojanized lifecycle hooks.** The paper ["A Blind Trust, the Bloody Thrust"](https://arxiv.org/abs/2609.03884) (Li et al., September 2026) shows malicious lifecycle-hook configuration shipped in plugin updates compromising all seven tested harnesses — including Claude Code and Codex CLI — with a per-harness success rate up to 92.5% across ten attacker objectives. Microsoft Defender scored 0% recall against the samples, and the union of three static defenses still missed 47.5%. Hooks are code bound to runtime events; an update that rewrites them runs host commands the next time the event fires.

A fourth example rounds out the shape. Straiker's STAR Labs [showed a malicious repo steering Claude Code's own review process](https://www.straiker.ai/blog/how-a-malicious-repo-tricked-claude-code-into-running-malware) (September 22, 2026) by shipping repo-defined subagents in `.claude/agents/`, downgrading the review model, and excluding its payload directory from review. Their conclusion generalizes the whole class: "Repo-defined agents, workflow instructions, and test commands should be treated as untrusted input when an AI coding agent is working with third-party code."

`.git/config`, plugin pins, lifecycle hooks, repo-defined agents — these are four doors into the same room. The harness's configuration-loading and background-command paths are the security boundary. The model's judgment is not.

## Which git config keys can run a program?

More than `core.fsmonitor`. Per the [git-config documentation](https://git-scm.com/docs/git-config), several keys name an executable, and the question that matters for GitSpawn is whether they fire on the *read-only* context-gathering commands agents run in the background. We verified the first three rows locally against git 2.56.0; the rest follow from git's documented execution model.

| Config key | What it runs | Fires on background context gathering? |
|---|---|---|
| `core.fsmonitor` | file-system monitor helper | Yes — on `git status` and `git diff` (any index refresh). Confirmed. |
| `diff.external` | external diff program | Yes — on content diffs (`git diff`, `git log -p`); not on `--name-only`. Confirmed. |
| `diff.<driver>.textconv` | text-conversion filter, selected by a `diff=<driver>` attribute | Yes — on content diffs of matching paths. Confirmed. |
| `core.pager` | pager program | Only when stdout is a TTY; agents capturing output non-interactively usually skip it |
| `filter.<driver>.clean` / `.smudge` / `.process` | content filter driver | On checkout, `add`, and diffs of filtered paths — not plain `status` |
| `core.hooksPath` | relocates the hooks directory | Only when a hook event fires (commit, checkout, merge) — not plain `status` |
| `core.sshCommand` | ssh program | Only on network operations (clone, fetch, push) |
| `credential.helper` | credential helper program | Only on authenticated network operations |

`core.fsmonitor` is the dangerous one precisely because it fires on `git status` — the single most innocuous, most universally-run background command. `diff.external` and `textconv` drivers are a close second for any agent that gathers a content diff. The network-only keys matter for clone-time flows but not for "open this local folder."

Two defenses that sound right are worth ruling out, because we checked them and they do not work. `GIT_CONFIG_NOSYSTEM=1` only skips the system-wide `/etc/gitconfig`; it does nothing about the repository's own `.git/config`, which is where the payload lives. And `--no-optional-locks` does not suppress the fsmonitor invocation. The only thing that reliably neutralizes the key is overriding it on the command line. One override that looks right is actively harmful: `-c diff.external=` does not disable the external differ, it sets it to an empty command, and `git diff` dies with `fatal: external diff died`. Use git's dedicated flags instead.

## How should harness builders fix this?

Control git's configuration on every background call, and never run a repo-controlled program before trust is established. Manifold's one-line summary is the mitigation: "Sanitize the git config on the context-gathering calls your product makes in the background." Override the execution keys to inert values on the command line, where repo config cannot win:

```bash
# Context-gathering call, hardened. -c overrides the repo's .git/config.
git -c core.fsmonitor=false \
    -c core.hooksPath=/dev/null \
    status --porcelain=2 --branch

# For diff-based context, also disable external differs and textconv drivers:
git -c core.fsmonitor=false \
    diff --no-ext-diff --no-textconv HEAD
```

For the Plugin4Shell class, verify that a pin resolved to the commit object you intended — not a same-named ref — before you execute anything from the checkout:

```bash
# After checkout, confirm HEAD is the pinned commit object.
got="$(git rev-parse --verify "HEAD^{commit}")"
want="$(git rev-parse --verify "${PINNED_SHA}^{commit}")"
[ "$got" = "$want" ] || { echo "pin mismatch: refusing to load"; exit 1; }
```

The `^{commit}` peel forces resolution to a commit object, and comparing the resolved SHAs catches the ambiguous-ref trick. Beyond these two, the general rule holds: the trust prompt must gate *before* any repo-controlled program can run. If context-gathering must happen first for UX, it must happen with a minimal, agent-controlled git configuration and never with the repo's. For how hooks, MCP servers, and skills widen this same surface in production deployments, see our notes on [running Claude Code in production](/lab/claude-code-in-production/).

### Audit your harness

1. List every git command your product runs in the background, and the lifecycle point each fires at. Confirm whether each precedes the trust/approval gate.
2. For each, override the execution keys on the command line: at minimum `-c core.fsmonitor=false` and `-c core.hooksPath=/dev/null`, plus `--no-ext-diff --no-textconv` on every diff or log call.
3. Do not read, parse, or act on any repo-controlled config, agent definition, or hook before trust is established.
4. For plugin and dependency installs, verify the checkout resolves to the pinned *commit object*, not a ref, before loading anything from it.
5. Treat repo-defined agents, workflow instructions, and test commands as untrusted input, not configuration.
6. Pin and update aggressively: GitSpawn, Plugin4Shell, and the hooks paper are all live research with partial patch coverage.

## What teams running agents should do now

You do not control the patch timeline, so change where you point agents. Before opening any repository that arrived as a directory rather than a fresh clone — a zipped take-home, a customer's reproduction tarball, a shared drive, a synced folder — inspect its `.git/config`: "any setting that names a program can run it," as Manifold puts it. Better, open untrusted repositories only inside a disposable container or VM, so in-process execution lands somewhere you can throw away. Keep every agent on its latest release, use managed settings and deny rules to constrain what the harness may run, and treat code pulled from PRs and issues as hostile input, because to a coding agent it literally is. Automated scanning helps triage the backlog — see our take on [agentic security scanning with Mantis](/lab/mantis-agentic-security-scanning/) — but the primary control is isolation plus current versions, applied before the repo is ever opened.

The uncomfortable summary: in a coding agent, the repository runs code the moment you look at it, and the model never gets a vote. Design, deploy, and audit as if that is true, because it is.
