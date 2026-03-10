# Claude Code TypeScript Setup: Research Synthesis

**Date:** 2026-03-10
**Rounds:** 2 (Anthropic-focused + wide community)
**Files:** 8 research documents in this directory

## How Anthropic Does It vs. Community Best Practice

| Area | Anthropic (claude-code-action) | Community Best Practice | Our Current Setup |
|---|---|---|---|
| PostToolUse | Prettier only (`bun run format`) | Prettier + ESLint + tsc | ESLint only (via `npx` — 20s cold start) |
| PostToolUse matcher | `Edit\|Write\|MultiEdit` | Same | `Edit\|Write` (missing MultiEdit) |
| Stop hook | None | Full CI gate (claudekit) | Full CI: tsc + eslint + vitest |
| LSP | No MCP servers in any repo | Native plugin or lsmcp | None |
| .claude/rules/ | Not used | Path-scoped rules (affaan-m) | Not used |
| CLAUDE.md length | ~40 lines | 60-80 lines recommended | 147 lines (AGENTS.md) |
| tsconfig strictness | noUnusedLocals, noUnusedParameters | + verbatimModuleSyntax, noImplicitOverride | Missing 2 options |
| Formatter | Prettier (via Bun) | Biome (20x faster) or Prettier | None in hooks |
| Hook runner | `bun run format` (fast) | `./node_modules/.bin/` (fast) | `npx eslint` (20s cold start) |
| Subagents | 5 read-only reviewers, model: inherit | Similar + memory, worktree isolation | Via plugins only |
| Compaction handling | Not configured | PreCompact + SessionStart compact | Not configured |

## Confirmed Findings (Both Rounds Agree)

1. **`npx` adds ~200-400ms overhead** for local packages (npm CLI module loading, NOT 20s — that's for uninstalled packages). Use `./node_modules/.bin/` for zero wrapper overhead
2. **`MultiEdit` must be in PostToolUse matcher** — all sources include it
3. **CLAUDE.md under 200 lines** — adherence degrades beyond ~150 lines; 4K tokens per 100 lines
4. **SessionStart compact reminder** re-injects critical context after compaction
5. **Native LSP plugin**: 50ms/15 tokens vs grep's 45s/2,100 tokens for navigation
6. **Anthropic keeps PostToolUse minimal** (format only) — heavy checks in Stop/commit hooks
7. **`verbatimModuleSyntax`** enforces `import type` at compiler level (Trail of Bits + Svenja-dev)

## Key Contradictions Resolved

| Topic | Anthropic | Community | Resolution |
|---|---|---|---|
| tsc in PostToolUse | Don't use it | bartolli/Svenja-dev use it | Keep tsc in Stop hook. Add to PostToolUse only if fast (<2s for our project). |
| ESLint vs Biome | N/A (use Prettier only) | Biome 20x faster | Keep ESLint for now (small project, already configured). Consider Biome later. |
| LSP stability | Don't use MCP LSP servers | Multiple options, some stability issues | Start with native plugin, low risk. |

## Implementation Plan (Ordered by Impact/Effort)

### Tier 1: Trivial fixes, outsized impact

| # | Change | File | Impact |
|---|---|---|---|
| 1 | Fix `npx` → `./node_modules/.bin/eslint` in PostToolUse | `.claude/settings.json` | Save ~200-300ms per hook (npx loads npm CLI modules) |
| 2 | Add `MultiEdit` to PostToolUse matcher | `.claude/settings.json` | Catch all edit tools |
| 3 | Add `verbatimModuleSyntax: true` to tsconfig | `tsconfig.json` | Enforce `import type` |
| 4 | Add `noImplicitOverride: true` to tsconfig | `tsconfig.json` | Catch override bugs |

### Tier 2: Low effort, meaningful impact

| # | Change | File(s) | Impact |
|---|---|---|---|
| 5 | Add tsc --noEmit to PostToolUse (non-blocking) | `.claude/settings.json` | Catch type errors on every edit |
| 6 | Add SessionStart compact reminder | `.claude/settings.json` | Preserve critical context |
| 7 | Add PreCompact hook for state preservation | `.claude/settings.json` | 30% less info loss |
| 8 | Enable native LSP plugin | `.claude/settings.json` | Semantic TS understanding |

### Tier 3: Low effort, good practice

| # | Change | File(s) | Impact |
|---|---|---|---|
| 9 | Create `.claude/rules/` with path-scoped rules | New files | Context efficiency |
| 10 | Trim AGENTS.md to <100 lines | `AGENTS.md` | Better instruction adherence |

### Deferred (medium effort or waiting for stability)

| # | Change | Reason |
|---|---|---|
| 11 | Switch to Biome | Migration cost, ESLint works fine for small project |
| 12 | Adopt tsgo for type checking | Wait for stable release |
| ~~13~~ | ~~Add Bun to devbox for hook scripts~~ | Not worth it — only ~100ms over direct `./node_modules/.bin/`. Anthropic uses Bun because they own it and Claude Code is built with it, not for hook performance. |

## Research File Index

```
research/claude-code-setup/
  SUMMARY.md                   ← this file (synthesis + implementation plan)
  anthropic-projects.md        — How Anthropic configures their own TS repos
  lsp-mcp-servers.md           — LSP MCP server comparison matrix
  hooks-best-practices.md      — PostToolUse, rules, compaction, hook types
  community-configs.md         — Trail of Bits, shinpr, Svenja-dev configs
  blog-posts-and-articles.md   — Practitioner blog posts, productivity data
  github-community-configs.md  — Real projects: giselle, repomix, claudekit
  advanced-patterns.md         — Worktrees, agent teams, PreCompact, subagents
  performance-optimization.md  — Token costs, hook speed, Biome benchmarks
```
