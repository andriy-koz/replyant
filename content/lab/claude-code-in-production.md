---
title: "Claude Code in Production: Hooks, MCP & Custom Skills"
date: 2026-03-08
tags: ["AI Agents", "Claude Code", "MCP", "Developer Tools"]
description: "Hooks, plugins, MCP servers, skills, and CLAUDE.md turn Claude Code into your production dev workflow. Here's how each extension point works."
---

In previous posts, we've covered [how the tool-calling loop works](/lab/anatomy-of-ai-agent-tool-calling/), [what a production-grade system prompt looks like](/lab/anatomy-of-an-ai-agent-system-prompt/), and [how MCP connects agents to business systems](/lab/anatomy-of-ai-agent-mcp/). Those posts describe the architecture of any AI agent. This one narrows the focus to a specific one: Claude Code.

Out of the box, Claude Code is a capable general-purpose coding agent. It reads your files, edits your code, runs your tests, and commits your changes. But it doesn't know your team's conventions. It doesn't know that `src/api/` files need input validation, or that every PR needs a changelog entry, or that it should never touch `package-lock.json`. It doesn't have access to your Postgres staging database or your Sentry error feed.

The gap between "capable coding agent" and "productive member of your team" is configuration. Claude Code ships five extension points to close that gap: **hooks**, **custom skills**, **MCP servers**, **plugins**, and **CLAUDE.md instruction files**. Each solves a different problem. Together, they turn a generic agent into one that understands your codebase, respects your rules, and connects to your infrastructure.

Here's how each one works, when to use it, and where they break.

---

## The Five Extension Points

Before diving into each mechanism, it helps to see how they relate:

```
CLAUDE.md          → What the agent knows (context, rules, conventions)
Skills             → What the agent can be asked to do (custom commands)
MCP Servers        → What systems the agent can talk to (external tools)
Hooks              → What happens automatically around agent actions (event triggers)
Plugins            → How you package and share all of the above
```

**CLAUDE.md** is passive — it shapes behavior through instructions. **Skills** are user-triggered — you invoke them explicitly. **MCP servers** extend the agent's toolset with external capabilities. **Hooks** are event-driven — they fire automatically when the agent does something. **Plugins** are the distribution format — a way to bundle any combination of the other four into an installable package.

Each one can be used independently. The real power is in composing them.

---

## Hooks: Intercepting the Agent Loop

Hooks are shell commands that fire automatically at specific points in Claude Code's execution cycle. If you've worked with Git hooks or CI/CD pipelines, the mental model is the same: define a trigger event, attach a handler, and it runs without anyone asking.

The difference from Git hooks is the breadth of events available. Claude Code exposes hooks for nearly every meaningful moment in its lifecycle:

| Event | When It Fires |
|---|---|
| `PreToolUse` | Before a tool executes — can block it |
| `PostToolUse` | After a tool succeeds |
| `UserPromptSubmit` | When you press Enter, before Claude processes |
| `Notification` | When Claude sends a notification |
| `SubagentStart` / `SubagentStop` | When parallel agents spin up or finish |
| `Stop` | When Claude finishes responding |
| `PreCompact` | Before context window compaction |

Hooks are configured in your settings files — either per-project in `.claude/settings.json` or globally in `~/.claude/settings.json`. Each hook receives a JSON payload on stdin with context about the event: session ID, working directory, tool name, tool input, and more. The hook's exit code determines what happens next.

Three exit codes matter:

- **Exit 0** — success, continue normally. Any JSON on stdout gets passed back to the agent.
- **Exit 2** — block the action. Stderr is fed back to Claude as an error message.
- **Any other code** — non-blocking error, execution continues.

### Example: Auto-Format After Every Edit

The most immediately useful hook is post-edit formatting. Every time Claude writes or modifies a file, Prettier (or your formatter of choice) runs automatically:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write 2>/dev/null; exit 0"
          }
        ]
      }
    ]
  }
}
```

The `matcher` field is a regex against the tool name. `"Edit|Write"` means this hook only fires when Claude uses the Edit or Write tools — not when it runs Bash commands or reads files.

### Example: Blocking Dangerous Operations

This is where hooks become a governance mechanism. A `PreToolUse` hook on the Bash tool can inspect every command before it executes:

```bash
#!/bin/bash
# .claude/hooks/guard-bash.sh
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

BLOCKED_PATTERNS=("rm -rf" "drop table" "DROP TABLE" "truncate" "--force" "sudo")
for pattern in "${BLOCKED_PATTERNS[@]}"; do
  if [[ "$COMMAND" == *"$pattern"* ]]; then
    echo "Blocked: command contains '$pattern'" >&2
    exit 2
  fi
done
exit 0
```

When this hook returns exit code 2, Claude doesn't execute the command — and it receives the stderr message explaining why. It can then adjust its approach, which is the same self-correction loop we described in the [tool-calling breakdown](/lab/anatomy-of-ai-agent-tool-calling/). The agent sees an error, reasons about it, and tries something different.

The corresponding settings entry:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/guard-bash.sh"
          }
        ]
      }
    ]
  }
}
```

### Example: Protecting Critical Files

Some files should never be edited by an AI agent — environment configs, lock files, CI workflows. A file-protection hook catches these before the edit happens:

```bash
#!/bin/bash
# .claude/hooks/protect-files.sh
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED=(".env" "package-lock.json" ".github/workflows" "secrets")
for pattern in "${PROTECTED[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH is a protected file" >&2
    exit 2
  fi
done
exit 0
```

This is the "principle of least privilege" from our [system prompt analysis](/lab/anatomy-of-an-ai-agent-system-prompt/) — except instead of relying on the agent to follow instructions, you're enforcing it at the infrastructure level. Instructions can be forgotten or overridden during long sessions. Hooks can't.

### Beyond Shell Commands

Hooks aren't limited to shell scripts. Claude Code supports four handler types:

1. **`command`** — shell command (what we've seen above)
2. **`http`** — POSTs the event JSON to a URL (for webhook integrations)
3. **`prompt`** — single-turn LLM evaluation (the hook itself uses AI to make a decision)
4. **`agent`** — spins up a multi-turn subagent with tool access

The `prompt` type is particularly interesting. You can write a hook that asks an LLM "does this code change look safe?" and blocks the action if the answer is no. It's AI governing AI — expensive, but powerful for high-stakes workflows.

---

## Custom Skills: Teaching the Agent New Tricks

Skills (formerly called "custom slash commands") let you define reusable prompts that Claude Code can execute on demand. If hooks are automatic triggers, skills are manual ones — you invoke them when you need them.

A skill is a markdown file with optional YAML frontmatter. Place it in `.claude/skills/<skill-name>/SKILL.md` for project scope or `~/.claude/skills/<skill-name>/SKILL.md` for global scope. The directory name becomes the slash command.

### Basic Example: A Code Review Skill

```markdown
<!-- .claude/skills/review/SKILL.md -->
---
name: review
description: Review staged changes for quality and security
allowed-tools: Read, Grep, Glob, Bash
---

Review the currently staged git changes (`git diff --cached`).

Check for:
1. Security issues (injection, hardcoded secrets, missing input validation)
2. Error handling gaps (unhandled promises, missing catch blocks)
3. Style violations against the project's conventions
4. Logic errors or edge cases

Format your findings as a numbered list with file paths and line numbers.
If everything looks good, say so briefly.
```

Now `/review` is available as a command in any Claude Code session within this project. The `allowed-tools` frontmatter restricts which tools the skill can use — a useful guardrail when you want the skill to analyze but not modify.

### Dynamic Context With Shell Injection

Skills support a backtick syntax that runs shell commands before the prompt is sent to Claude. This lets you inject live context:

```markdown
<!-- .claude/skills/fix-issue/SKILL.md -->
---
name: fix-issue
description: Fix a GitHub issue by number
argument-hint: <issue-number>
---

Here is the GitHub issue to fix:

!`gh issue view $ARGUMENTS --json title,body,labels,comments`

Fix this issue following our coding standards. Write tests for your changes.
Run the test suite before finishing.
```

`$ARGUMENTS` captures everything after the slash command — so `/fix-issue 42` passes `42` to the `gh issue view` command. The issue data gets injected into the prompt before Claude sees it.

### Subagent Skills

For complex workflows, you can run a skill in an isolated context by forking it into a subagent:

```yaml
---
name: audit-deps
description: Audit project dependencies for vulnerabilities
context: fork
agent: Explore
---
```

The `context: fork` directive runs the skill in a separate context window, keeping the main conversation clean. The `agent` field selects the subagent type — `Explore` is optimized for read-only codebase analysis.

### Legacy Compatibility

If you have existing `.claude/commands/<name>.md` files, they still work. Claude Code treats them as skills with the same semantics. There's no need to migrate unless you want the additional frontmatter capabilities like `allowed-tools`, `context`, or `model` overrides.

---

## MCP Servers: Connecting to External Systems

We covered [how MCP works at the protocol level](/lab/anatomy-of-ai-agent-mcp/) — the client-server architecture, JSON-RPC transport, and how to build a server from scratch. Here, the focus is narrower: how to configure MCP servers inside Claude Code so the agent can talk to your infrastructure.

### Adding Servers

The fastest path is the CLI:

```bash
# Remote server over HTTP
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# Local server running as a subprocess
claude mcp add --transport stdio postgres -- \
  npx -y @bytebase/dbhub --dsn "postgresql://readonly:pass@localhost:5432/mydb"

# With environment variables for authentication
claude mcp add --transport stdio --env SLACK_TOKEN=$SLACK_TOKEN slack -- \
  npx -y @anthropic/mcp-slack
```

Each server gets registered and its tools become available to Claude Code automatically. MCP tools follow a namespacing convention — `mcp__<server>__<tool>` — so `mcp__postgres__query` or `mcp__github__search_repositories`.

### Scoping

Servers can be scoped to control visibility:

- **`--scope local`** (default) — stored in `~/.claude.json`, only you, only this project
- **`--scope project`** — stored in `.mcp.json` at project root, shared via version control
- **`--scope user`** — stored in `~/.claude.json`, available across all your projects

For team-shared servers, project scope is what you want. The `.mcp.json` file goes into your repo:

```json
{
  "mcpServers": {
    "staging-db": {
      "command": "npx",
      "args": ["-y", "@bytebase/dbhub", "--dsn", "${DATABASE_URL}"],
      "env": {}
    }
  }
}
```

The `${DATABASE_URL}` syntax pulls from environment variables at runtime — so credentials stay out of version control while the server configuration is shared.

### Claude Code as an MCP Server

An interesting capability that flips the relationship: `claude mcp serve` exposes Claude Code itself as an MCP server. This means other MCP-compatible tools — Claude Desktop, custom agents, IDE plugins — can use Claude Code's file editing and analysis capabilities through the standard protocol.

The practical use case: orchestrating Claude Code from a higher-level automation system. A CI pipeline that uses MCP to ask Claude Code to review a PR, for instance, or a monitoring agent that delegates code fixes to Claude Code when it detects a regression.

### When MCP Gets Heavy

As you add servers, the tool count grows. Claude Code handles this with automatic tool search — when MCP tool descriptions exceed 10% of the context window, it switches to a two-step process: first searching for the right tool, then calling it. This keeps context usage manageable, but it adds latency to tool selection. If you're noticing slower responses after adding multiple MCP servers, this is probably why.

The mitigation is the same advice from our [MCP deep dive](/lab/anatomy-of-ai-agent-mcp/): keep servers narrow. One server per domain, with the minimum viable set of tools. Three servers with five tools each outperform one server with fifteen.

---

## Plugins: Packaging It All Together

Hooks, skills, MCP configs, and settings are useful individually. Plugins let you bundle them into a single installable package — useful for sharing setups across projects or distributing them to a team.

A plugin is a directory with a `.claude-plugin/` manifest:

```
my-workflow-plugin/
  .claude-plugin/
    plugin.json
  commands/           # Legacy slash commands
  skills/             # Skill definitions
    review/
      SKILL.md
  hooks/
    hooks.json        # Event handlers
    scripts/
      format.sh
      guard.sh
  .mcp.json           # MCP server configurations
  settings.json       # Default settings
```

The `plugin.json` manifest is minimal:

```json
{
  "name": "my-workflow-plugin",
  "description": "Team development workflow — formatting, guards, and DB access",
  "version": "1.0.0",
  "author": {
    "name": "Your Team"
  }
}
```

### Using Plugins

For local development and testing:

```bash
claude --plugin-dir ./my-workflow-plugin
```

Multiple plugins can be loaded simultaneously:

```bash
claude --plugin-dir ./security-plugin --plugin-dir ./formatting-plugin
```

### Plugin-Scoped Isolation

Plugin skills are namespaced to avoid collisions. A skill named `review` in a plugin called `my-workflow` becomes `/my-workflow:review`. Plugin hooks run alongside project hooks — all matching hooks fire in parallel, with identical handlers deduplicated.

Plugin MCP servers auto-start when the plugin loads and stop when it unloads. The `${CLAUDE_PLUGIN_ROOT}` variable resolves to the plugin's directory, so server commands and scripts can use relative paths without hardcoding:

```json
{
  "staging-db": {
    "command": "${CLAUDE_PLUGIN_ROOT}/servers/start-db.sh",
    "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"]
  }
}
```

### When to Use Plugins vs. Direct Configuration

For a single project with a stable team, direct configuration in `.claude/settings.json`, `.claude/skills/`, and `.mcp.json` is simpler. Plugins add value when:

- You're sharing the same setup across multiple repositories
- You're distributing a workflow to people outside your team
- You want to version and release your configuration independently from your codebase
- You need to combine hooks, skills, and MCP servers that logically belong together

Don't reach for plugins if `.claude/settings.json` and a few skill files get the job done. Premature packaging is the same anti-pattern as premature abstraction.

---

## CLAUDE.md: The Governance Layer

Every extension point we've covered so far adds capability — hooks enforce rules, skills add commands, MCP servers add tools. CLAUDE.md is different. It shapes *how the agent thinks* about your project.

A CLAUDE.md file at your project root is automatically loaded into every Claude Code session. It survives context compaction (the agent re-reads it from disk when the context window is compressed), which makes it the most durable way to communicate project conventions.

### What Belongs in CLAUDE.md

The most effective CLAUDE.md files we've seen share a pattern: they're short, specific, and focused on preventing mistakes the agent has actually made.

```markdown
# Project Conventions

- Use Bun, not npm. Run `bun test` before committing.
- API handlers live in `src/api/handlers/`. Each handler is one file.
- All database queries go through `src/db/queries.ts` — never write raw SQL in handlers.
- Error responses use the `ApiError` class from `src/lib/errors.ts`.
- Do not modify files in `src/generated/` — they are auto-generated from the OpenAPI spec.

# Testing

- Unit tests live next to source files: `foo.ts` → `foo.test.ts`
- Integration tests live in `tests/integration/`
- Run `bun test` for unit tests, `bun test:integration` for integration tests

# Git

- Commit messages follow conventional commits: feat:, fix:, refactor:
- Never amend commits that have been pushed
- Always create a new branch for changes: `<type>/<short-description>`
```

Notice the pattern: every line answers the question "would removing this cause Claude to make a mistake?" This aligns with the anti-pattern-driven approach from our [system prompt analysis](/lab/anatomy-of-an-ai-agent-system-prompt/) — specific failure modes are more instructive than general advice.

### Scoping and Hierarchy

CLAUDE.md files cascade through your project structure:

| Scope | Location | Loaded |
|---|---|---|
| Organization (managed) | `/etc/claude-code/CLAUDE.md` | Always, cannot be excluded |
| Project (shared) | `./CLAUDE.md` or `./.claude/CLAUDE.md` | At session start |
| User (personal) | `~/.claude/CLAUDE.md` | At session start |
| Local (personal, one project) | `./CLAUDE.local.md` | At session start |
| Subdirectory | `src/api/CLAUDE.md` | On demand, when Claude reads files in that directory |

Subdirectory CLAUDE.md files are powerful for monorepos — different rules for different parts of the codebase, loaded only when relevant. A `src/api/CLAUDE.md` with API-specific conventions won't consume context when Claude is working on the frontend.

### The Import System

CLAUDE.md files can reference other files in your project:

```markdown
See @README.md for project overview
See @docs/api-spec.md for endpoint documentation
See @package.json for available scripts
```

The `@` syntax pulls the referenced file's content into the instruction set. This keeps CLAUDE.md lean while giving the agent access to documentation you're already maintaining.

### Rules for Fine-Grained Control

For conventions that apply only to specific file patterns, the `.claude/rules/` directory offers path-scoped rules:

```yaml
# .claude/rules/api-handlers.md
---
paths:
  - "src/api/**/*.ts"
---

# API Handler Rules
- Every handler must validate input using zod schemas
- Return types must use the `ApiResponse<T>` wrapper
- Include rate limiting middleware for all public endpoints
- Log all errors through the structured logger, never console.log
```

These rules load only when Claude accesses files matching the glob pattern. For a large codebase with distinct conventions across domains, this is far more efficient than cramming everything into a single CLAUDE.md.

---

## Composing the Pieces: A Realistic Setup

Here's how these extension points work together in a production development workflow. This is representative of what we configure for our own projects — not a theoretical ideal, but a setup that's survived daily use.

**CLAUDE.md** — project conventions, key file paths, testing commands, commit format. Under 50 lines. This is the [governance layer](/lab/anatomy-of-an-ai-agent-system-prompt/) — the equivalent of the system prompt's "task execution philosophy" section, applied to your specific project.

**Two skills:**
- `/review` — reviews staged changes against the project's standards
- `/fix-issue <number>` — pulls a GitHub issue and implements a fix

**Two hooks:**
- `PostToolUse` on `Edit|Write` — runs the project's formatter
- `PreToolUse` on `Bash` — blocks destructive commands and protected file patterns

**One MCP server:**
- Staging database (read-only) — lets Claude query real data while investigating bugs

**No plugins** — everything lives directly in `.claude/` and `.mcp.json`. It's one project with one team. Plugins would add packaging overhead with no benefit.

The configuration totals about 80 lines of JSON and 30 lines of markdown across five files. That's it. The agent handles the rest — reading code, understanding context, making decisions — using the general capabilities it already has.

---

## Where This Breaks

These extension points solve real problems, but they introduce their own failure modes.

**Hook performance degrades with scale.** Every matching hook runs on every matching event. A `PostToolUse` hook that runs Prettier on every file edit is fine. Five `PostToolUse` hooks that each run a different linter will noticeably slow down the agent. All matching hooks run in parallel, which helps, but the total latency of the slowest hook still adds up across hundreds of tool calls in a long session.

**CLAUDE.md has a soft capacity limit.** The official guidance is to keep it under 200 lines. In practice, adherence to instructions decays as the instruction count grows — and the decay is uniform across all instructions, not just the later ones. Adding a twentieth rule makes the first nineteen slightly less reliable too. This is the same context window pressure we described in the [tool-calling article](/lab/anatomy-of-ai-agent-tool-calling/): every token of instruction competes with every token of code and conversation.

**MCP servers are a trust boundary.** When you connect an MCP server, you're giving the agent access to whatever that server exposes. A read-only database connection is low-risk. A server with write access to production data is a different story. The same [prompt injection risks](/lab/anatomy-of-ai-agent-mcp/) we discussed for MCP in general apply here — tool results can contain adversarial content, and the agent will process them as context.

**Hooks run at startup as a snapshot.** If you modify hook configurations mid-session, the changes don't take effect until you restart or explicitly review them via the `/hooks` menu. This catches people who iteratively refine their hooks while testing them in a live session.

**Plugin ecosystem maturity varies.** Community plugins range from battle-tested to abandoned prototypes. Vet any third-party plugin the same way you'd vet a dependency — check the source, review the hooks and MCP configs, and understand what permissions it's requesting.

---

## The Compound Effect

None of these extension points is revolutionary on its own. A CLAUDE.md file is just a text file. A hook is just a shell script. A skill is just a markdown template. An MCP server is just a JSON-RPC endpoint.

The value is in the composition. CLAUDE.md gives the agent judgment about your project. Skills give it reusable workflows. MCP servers give it access to your infrastructure. Hooks give it guardrails. Together, they transform a general-purpose coding agent into one that operates within the specific constraints and conventions of your team — which is exactly the gap that prevents most [AI agent pilots from reaching production](/blog/ai-pilot-to-production/).

The underlying pattern is the same one that makes any agent production-ready: capability without governance is a liability. These five extension points give you both — and the ability to tune the balance between autonomy and control as your trust in the system grows.

---

*We build and configure AI agent workflows for teams that need them to work in production, not just in demos. If you're evaluating how AI coding agents fit into your development process — or trying to get more value from tools you're already using — [get in touch](/#contact).*
