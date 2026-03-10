# How Anthropic Configures Claude Code in Their TypeScript Projects

**Date:** 2026-03-10
**Sources:** anthropics/claude-code-action, anthropics/claude-agent-sdk-typescript, modelcontextprotocol/typescript-sdk, anthropics/claude-code, official docs

## claude-code-action (most configured project)

### .claude/settings.json

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun run format"
          }
        ],
        "matcher": "Edit|Write|MultiEdit"
      }
    ]
  }
}
```

Key: **Only Prettier auto-format** — no tsc or ESLint in PostToolUse. Matcher includes `MultiEdit`.

### CLAUDE.md (~40 lines)

```markdown
## Commands
bun test                # Run tests
bun run typecheck       # TypeScript type checking
bun run format          # Format with prettier
bun run format:check    # Check formatting

## What This Is
A GitHub Action that lets Claude respond to @claude mentions on issues/PRs.

## Things That Will Bite You
- Strict TypeScript: noUnusedLocals and noUnusedParameters are enabled
- Discriminated unions for GitHub context: Call isEntityContext(context) before accessing entity-specific fields
- Token lifecycle matters: GitHub App token revoked in separate always() step
- moduleResolution: "bundler" -- imports don't need .js extensions
```

Pattern: Commands → What → Gotchas → Conventions. Very concise.

### .claude/agents/ (5 read-only reviewers)

All share the same pattern:

```yaml
---
name: <agent-name>
description: <when to use, with examples>
tools: Glob, Grep, Read, WebFetch, TodoWrite, WebSearch, BashOutput, KillBash
model: inherit
---
```

**Deliberately excludes Edit, Write, Bash** — read-only reviewer agents:
- `code-quality-reviewer.md` — clean code, error handling, TypeScript-specific (prefer `type` over `interface`)
- `documentation-accuracy-reviewer.md` — verifies docs match implementation
- `performance-reviewer.md` — algorithmic complexity, N+1 queries, memory leaks
- `security-code-reviewer.md` — OWASP Top 10, injection, auth
- `test-coverage-reviewer.md` — coverage gaps, test quality, edge cases

### .claude/commands/

- `review-pr.md` — orchestrates all 5 reviewer agents in parallel, posts inline GitHub comments
- `commit-and-pr.md` — runs tests + typecheck + format, then commit + push + PR
- `label-issue.md` — auto-triage GitHub issues with labels

Commands use `allowed-tools` frontmatter:
```yaml
---
allowed-tools: Bash(gh pr comment:*),Bash(gh pr diff:*),Bash(gh pr view:*)
description: Review a pull request
---
```

## claude-agent-sdk-typescript

**Minimal setup.** Only has `.claude/commands/label-issue.md` for GitHub issue triage. No CLAUDE.md, no settings.json, no agents.

## modelcontextprotocol/typescript-sdk (gold-standard CLAUDE.md)

Has CLAUDE.md only — no `.claude/` directory.

### CLAUDE.md structure (~100 lines)

```markdown
## Build & Test Commands
pnpm install / build:all / lint:all / typecheck:all / test:all / check:all
Per-package: pnpm --filter @modelcontextprotocol/core test

## Breaking Changes
Document in both migration.md (human) and migration-SKILL.md (LLM-optimized mapping tables)

## Code Style Guidelines
- TypeScript: Strict type checking, ES modules, explicit return types
- Naming: PascalCase types, camelCase functions, lowercase-hyphens files
- Imports: ES module style, include .js extension, group imports logically
- Formatting: 2-space indentation, semicolons, single quotes
- Testing: Co-locate tests with source, descriptive test names
- JSDoc: @example tags pull from type-checked .examples.ts files

## Architecture Overview
- Types Layer (types.ts) - Zod v4 protocol types
- Protocol Layer (protocol.ts) - JSON-RPC routing
- High-Level APIs: Client, Server, McpServer
- Transport: Streamable HTTP, SSE, stdio
```

Notable pattern: **LLM-specific migration docs** (`migration-SKILL.md`) alongside human-readable `migration.md`.

## anthropics/claude-code

Has `.claude/commands/` only:
- `commit-push-pr.md`
- `dedupe.md` — orchestrates 5 parallel agents to find duplicate issues
- `triage-issue.md`

No CLAUDE.md, no settings.json.

### dedupe.md pattern (multi-agent orchestration)

```markdown
---
allowed-tools: Bash(./scripts/gh.sh:*), Bash(./scripts/comment-on-duplicates.sh:*)
---
1. Use an agent to check if issue needs deduping
2. Use an agent to summarize the issue
3. Launch 5 parallel agents to search for duplicates with diverse keywords
4. Feed results into another agent to filter false positives
5. Post duplicates via comment script
```

## Key Patterns Summary

1. **PostToolUse = Prettier only** — Anthropic does NOT run tsc/ESLint in PostToolUse hooks
2. **Read-only reviewer agents** with `model: inherit` and restricted toolsets
3. **Commands use `allowed-tools`** frontmatter to restrict tool access to specific scripts
4. **CLAUDE.md: Commands first, then gotchas** — no generic advice
5. **No MCP servers** configured in any Anthropic TS repo
6. **No `.claude/rules/`** in any Anthropic repo
7. **Minimal settings.json** — only claude-code-action has one, and it's just hooks
