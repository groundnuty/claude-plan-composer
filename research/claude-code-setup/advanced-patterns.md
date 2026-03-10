# Advanced Claude Code Patterns

**Date:** 2026-03-10
**Sources:** Official docs, GitHub repos, blog posts

## 1. Git Worktree Isolation

Built-in git worktree support for parallel agents:

```bash
claude --worktree my-feature
```

Subagent frontmatter:
```yaml
---
name: refactor-agent
isolation: worktree
---
```

True parallel execution: Agent A rewrites `src/auth.ts` while Agent B rewrites the same file. No merge conflicts until you choose to merge. Worktree auto-cleans if agent makes no changes.

Sources: [Common Workflows](https://code.claude.com/docs/en/common-workflows), [ccswarm](https://github.com/nwiizo/ccswarm)

## 2. Agent Teams (Experimental)

Multiple Claude Code instances with shared tasks, inter-agent messaging, self-coordination.

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

Display modes: `"auto"`, `"in-process"`, `"tmux"`.

Patterns:
- **Competing hypotheses debugging**: 5 teammates investigating different theories, debate and disprove each other
- **Cross-layer coordination**: frontend, backend, test agents each own their domain
- **Plan approval gates**: teammates work in read-only plan mode until lead approves

Quality gate hooks:
- `TeammateIdle`: exit code 2 sends feedback and keeps them working
- `TaskCompleted`: exit code 2 prevents completion

Sources: [Agent Teams Docs](https://code.claude.com/docs/en/agent-teams), [paddo.dev](https://paddo.dev/blog/claude-code-hidden-swarm/)

## 3. Complete Subagent Frontmatter Fields

| Field | Description |
|---|---|
| `name` | Unique identifier (lowercase + hyphens) |
| `description` | When Claude should delegate (critical for auto-delegation) |
| `tools` | Allowlist; inherits all if omitted |
| `disallowedTools` | Denylist removed from inherited list |
| `model` | `sonnet`, `opus`, `haiku`, or `inherit` |
| `permissionMode` | `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan` |
| `maxTurns` | Maximum agentic turns |
| `skills` | Skills to preload |
| `mcpServers` | MCP servers available to subagent |
| `hooks` | Lifecycle hooks scoped to this subagent |
| `memory` | `user`, `project`, or `local` for persistent cross-session learning |
| `background` | `true` to always run as background task |
| `isolation` | `worktree` for git worktree isolation |

**Persistent memory for cross-session learning:**
```yaml
---
name: code-reviewer
memory: user
---
```
Stores at `~/.claude/agent-memory/<name>/MEMORY.md` (first 200 lines injected into context).

**Restricting subagent spawning:**
```yaml
tools: Agent(worker, researcher), Read, Bash
```

Sources: [Custom subagents](https://code.claude.com/docs/en/sub-agents)

## 4. Full Hook System: 18 Events × 4 Handler Types

### Handler Types

```json
{ "type": "command", "command": "..." }           // Shell script, stdin JSON
{ "type": "http", "url": "...", "headers": {} }    // POST to endpoint
{ "type": "prompt", "prompt": "...", "model": "haiku" }  // Single-turn LLM
{ "type": "agent", "prompt": "...", "timeout": 120 }     // Multi-turn subagent
```

### All 18 Events

SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Notification, SubagentStart, SubagentStop, Stop, TeammateIdle, TaskCompleted, InstructionsLoaded, ConfigChange, WorktreeCreate, WorktreeRemove, PreCompact, SessionEnd

### Blocking Events

Can block (exit 2): PreToolUse, PostToolUse, SubagentStop, Stop, TeammateIdle, TaskCompleted, ConfigChange

## 5. PreToolUse Creative Patterns

**Semantic evaluation with prompt hook:**
```json
{
  "matcher": "Edit|Write",
  "hooks": [{
    "type": "prompt",
    "prompt": "Check if this edit follows coding standards. Look for: error handling, no secrets, consistent naming."
  }]
}
```

**Three-level permission control (allow/deny/ask):**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Use rg instead of grep"
  }
}
```

**PreToolUse can modify tool inputs** (since v2.0.10).

**MCP tool monitoring:**
```json
{ "matcher": "mcp__github__.*" }
{ "matcher": "mcp__.*__write.*" }
```

## 6. PreCompact: Context Preservation

**Compaction-to-Memory Bridge** (most advanced pattern):
Before compaction, parse transcript → summarize → store in memory backend. On post-compaction SessionStart, retrieve and inject most relevant archived context. Creates effectively infinite context.

**Implementation approaches:**
1. Shell script: extract user requests, file modifications, tasks, key responses → structured markdown
2. MCP-based: auto-save to MCP memory server, SessionStart injects recovery
3. Tiered backends: JsonFile (simple), AgentDB (structured), PostgreSQL (embedding-based)

PreCompact hooks reduce critical information loss by **30%** (Anthropic changelog, Jan 2026).

`custom_instructions` field contains what user passes to `/compact` for manual compactions.

Sources: [gist/ruvnet](https://gist.github.com/ruvnet/29f8fa68582fdc1ca2da30136f538dba)

## 7. SessionStart: Context Injection

**Compact rematcher:**
```json
{
  "SessionStart": [{
    "matcher": "compact",
    "hooks": [{
      "type": "command",
      "command": "echo 'Reminder: ESM-only. Use devbox. Run make -f dev.mk check.'"
    }]
  }]
}
```

**Environment variable persistence via `CLAUDE_ENV_FILE`:**
Write `export VAR=value` lines to `$CLAUDE_ENV_FILE` — available in all subsequent Bash commands.

**LaunchDarkly integration:** Dynamic rule injection based on repo context attributes.

Matcher values: `startup`, `resume`, `clear`, `compact`.

## 8. StatusLine

```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/statusline-script.sh"
  }
}
```

Script receives JSON on stdin: model, workspace, session cost, context stats. Outputs one formatted line.

Generate via: `/statusline show me model, git branch, session cost, and context usage percentage`

## 9. UserPromptSubmit: Prompt Preprocessing

**Prompt improver** (severity1): Evaluates clarity, asks clarifying questions for vague prompts, 31% token reduction.

**Anti-sycophancy hook** (ljw1004): Injects "evaluate requests independently" context.

**Skill auto-activation** (diet103): Reads `skill-rules.json`, matches user prompts against trigger patterns, injects skill suggestions.

## 10. Devbox/Nix Integration

**devenv.nix with automatic formatting:**
```nix
{
  claude.code.enable = true;
  git-hooks.hooks = {
    prettier.enable = true;
    nixfmt.enable = true;
  };
}
```

Runs `pre-commit run --files <edited-file>` after Claude edits any file.

**Nix Flake packaging** (sadjow/claude-code-nix): Bundles Claude Code with own Node 22 LTS, hourly auto-updates, solves Node version switching problems.

## 11. Monorepo Configuration

**Hierarchical CLAUDE.md:**
- Root for shared context (routing logic, quality standards)
- Package-level for specifics
- `.claude/rules/*.md` with `paths:` for conditional loading

Key: CLAUDE.md for what applies everywhere (lean). Rules for area-specific guidance with path targeting.

## 12. Background Task Orchestration

- **Ctrl+B** moves blocking subagent to background
- Background agents run concurrently while you continue
- Tasks have dependency graphs: pending tasks with unresolved deps can't be claimed
- Disable: `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`
