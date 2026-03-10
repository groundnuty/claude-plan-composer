# Claude Code Hooks Best Practices for TypeScript

**Date:** 2026-03-10
**Sources:** bartolli/claude-code-typescript-hooks, johnlindquist/claude-hooks, Svenja-dev/claude-code-skills, official docs, Trail of Bits, community blogs

## PostToolUse: The 3-Check Pattern

Best practice is Prettier → ESLint → tsc on every Edit/Write/MultiEdit.

### Option A: Separate hooks (run in parallel by Claude Code)

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        {
          "type": "command",
          "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write 2>/dev/null; exit 0",
          "timeout": 10
        },
        {
          "type": "command",
          "command": "sh -c 'FILE=$(cat | jq -r \".tool_input.file_path // empty\"); case \"$FILE\" in *.ts|*.tsx) npx eslint --no-warn-ignored \"$FILE\" 2>&1 | head -20 || true ;; esac'",
          "timeout": 15
        },
        {
          "type": "command",
          "command": "sh -c 'FILE=$(cat | jq -r \".tool_input.file_path // empty\"); case \"$FILE\" in *.ts|*.tsx) npx tsc --noEmit 2>&1 | head -20 ;; esac; exit 0'",
          "timeout": 30
        }
      ]
    }
  ]
}
```

**Warning:** Hooks within a matcher group run in parallel. Prettier and ESLint can conflict if both auto-fix. Open issue #21533 requests sequential execution.

### Option B: Single script (bartolli pattern, controlled ordering)

```javascript
// quality-check.js — runs all checks in sequence
const checkPromises = [];
if (config.typescriptEnabled) checkPromises.push(this.checkTypeScript());
if (config.eslintEnabled)     checkPromises.push(this.checkESLint());
if (config.prettierEnabled)   checkPromises.push(this.checkPrettier());
await Promise.all(checkPromises);
```

bartolli/claude-code-typescript-hooks (169★) is a 1250-line Node.js script with:
- SHA256 caching for tsconfig discovery (<5ms subsequent runs)
- TypeScript compiler API for single-file checking (<2s vs 10-30s for full project)
- ESLint and Prettier autofix (configurable, silent by default)
- Exit 0 = pass, exit 2 = blocking errors

### Option C: Anthropic's own approach (simplest)

```json
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|MultiEdit",
      "hooks": [
        { "type": "command", "command": "bun run format" }
      ]
    }
  ]
}
```

Only Prettier. No tsc or ESLint in PostToolUse. Full checks run at commit time.

## tsc in PostToolUse: Whole Project vs. Single File

### Whole project (simple but slow)

```bash
npx tsc --noEmit 2>&1 | head -20
```

10-30 seconds for medium projects. Acceptable for small projects (<50 files).

### Single file via TS compiler API (fast)

bartolli uses:
```javascript
const program = ts.createProgram([this.filePath], parsedConfig.options);
const diagnostics = ts.getPreEmitDiagnostics(program);
```

<2 seconds. Checks only the edited file against correct tsconfig.

### Svenja-dev post-edit-tsc-check (160 lines)

- Triggers on Edit, MultiEdit, Write
- Checks only .ts/.tsx files (excludes node_modules, .d.ts, tests, dist)
- Walks up directory tree to find tsconfig.json
- Runs `npx tsc --noEmit` with 45s timeout
- Parses output into structured errors, shows max 5 per file
- **Non-blocking** (always exits 0) — warns but doesn't prevent edits
- SHA256 caching for tsconfig discovery

## Getting the File Path from Hook Input

**NOT available as environment variable.** `$CLAUDE_FILE_PATHS` is NOT official.

Parse from stdin JSON:
```bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
```

**Official environment variables:**
- `$CLAUDE_PROJECT_DIR` — project root
- `$CLAUDE_ENV_FILE` — (SessionStart only) for persisting env vars
- `$CLAUDE_CODE_REMOTE` — "true" in remote web environments

## Hook Timeouts

| Hook type | Default timeout |
|-----------|----------------|
| command | 600 seconds (10 minutes) |
| prompt | 30 seconds |
| agent | 60 seconds |

Recommended explicit timeouts:
- Prettier: 10s
- ESLint single-file: 15s
- tsc --noEmit (whole project): 30-45s
- tsc single-file API: 10s

## SessionStart Compact Reminder

When context compacts, AGENTS.md content is lost. Re-inject critical reminders:

```json
{
  "SessionStart": [
    {
      "matcher": "compact",
      "hooks": [
        {
          "type": "command",
          "command": "echo 'Reminder: ESM-only project. Use devbox. Run make -f dev.mk check before committing.'"
        }
      ]
    }
  ]
}
```

## Other Hook Patterns

### PreToolUse: Dangerous command blocking (Trail of Bits)

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "CMD=$(jq -r '.tool_input.command'); if echo \"$CMD\" | grep -qE 'git[[:space:]]+push.*(main|master)'; then echo 'BLOCKED: Use feature branches' >&2; exit 2; fi"
        }
      ]
    }
  ]
}
```

### Stop: Anti-rationalization check (Trail of Bits)

```json
{
  "Stop": [
    {
      "hooks": [
        {
          "type": "prompt",
          "prompt": "Review for incomplete work: pre-existing issues, out of scope claims, deferred follow-ups, unsolved lint failures. Respond with JSON only: {\"ok\": false, \"reason\": \"...\"} or {\"ok\": true}"
        }
      ]
    }
  ]
}
```

### PostToolUse: Auto-run tests on test file changes

```json
{
  "matcher": "Write|Edit",
  "hooks": [
    {
      "type": "command",
      "command": "bash -c 'FILE=$(jq -r \".tool_input.file_path\" <<< \"$(cat)\"); if [[ \"$FILE\" == *.test.* ]]; then npx vitest run \"$FILE\" 2>&1 | tail -5; fi; exit 0'",
      "timeout": 30
    }
  ]
}
```

## .claude/rules/ Directory

Rules with `paths:` frontmatter are lazily loaded when Claude touches matching files.

```markdown
---
paths:
  - "src/api/**/*.ts"
---
# API Development Rules
- All API endpoints must include input validation
```

### Organization pattern

```
.claude/rules/
  code-style.md          # Always loaded (no paths: frontmatter)
  testing.md             # Always loaded
  types/
    schemas.md           # paths: ["src/types/**/*.ts"]
  merge/
    strategies.md        # paths: ["src/merge/**/*.ts"]
```

### Guidelines

- Under 200 lines per file (adherence degrades beyond ~150 lines)
- 20 most critical rules max
- Brace expansion supported: `"src/**/*.{ts,tsx}"`
- `InstructionsLoaded` hook fires when rules load (for audit logging)

## Hook Event Types (Complete List)

| Event | When |
|---|---|
| SessionStart | Session begins or resumes |
| UserPromptSubmit | Prompt submitted, before processing |
| PreToolUse | Before tool call, can block |
| PermissionRequest | Permission dialog appears |
| PostToolUse | After tool call succeeds |
| PostToolUseFailure | After tool call fails |
| Notification | When notification sent |
| SubagentStart | Subagent spawned |
| SubagentStop | Subagent finishes |
| Stop | Claude finishes responding |
| TeammateIdle | Agent team teammate going idle |
| TaskCompleted | Task being marked completed |
| InstructionsLoaded | CLAUDE.md or rules loaded |
| ConfigChange | Config file changes during session |
| WorktreeCreate | Worktree being created |
| WorktreeRemove | Worktree being removed |
| PreCompact | Before context compaction |
| SessionEnd | Session terminates |

## Hook Types

- `command` — shell command (most common, 600s default timeout)
- `http` — POST to URL
- `prompt` — single-turn LLM evaluation (Haiku default)
- `agent` — multi-turn subagent with tool access
