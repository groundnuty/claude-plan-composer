# GitHub Community Configurations for Claude Code TypeScript

**Date:** 2026-03-10
**Sources:** GitHub repos (non-Anthropic)

## Real-World Production Projects

### giselles-ai/giselle (~3k★) — AI App Builder
- One of the most sophisticated CLAUDE.md files found
- Monorepo: Turborepo + pnpm, Next.js 16, React 19, Tailwind 4, Zod v4, Vitest, Biome
- **Unique: "Continuity" system** — per-branch ledgers in `.continuity/` for tracking human intent across sessions
- Branded ID types, Symbol-based error markers, exhaustive switch patterns, feature flags

### yamadashy/repomix (22k★) — Repository packer
- YAML frontmatter with `alwaysApply: true` for rule targeting
- 250-line file limit, dependency injection via `deps` object
- Conventional commits with required scope

### eggjs/egg (19k★) — Enterprise Node.js framework
- Massive CLAUDE.md (~700 lines) — demonstrates what happens when too long
- oxlint (not ESLint) for linting, tsdown for builds
- `isolatedDeclarations` for faster type checking
- Angular commit message format

### yournextstore/yournextstore (5.3k★) — E-commerce
- Uses Bun, Biome, `tsgo --noEmit` for type checking
- `safe-try` error handling pattern
- No `any` types, minimal return type annotations

### d-kimuson/claude-crew — CLI for Claude Desktop
- No `any` or non-null assertions
- `DiscriminatedError` for typed errors
- `@ts-expect-error` with description required (never `@ts-ignore`)

### vercel/next-devtools-mcp — Vercel official
- MCP tool/prompt/resource patterns with Zod schemas
- Agent SDK for E2E testing

## Comprehensive Hook/Toolkit Repos

### carlrannaberg/claudekit (3k★)
Most complete hook configuration found:
- **PreToolUse:** `file-guard` (195+ sensitive file patterns)
- **PostToolUse:** `typecheck-changed`, `lint-changed`, `check-any-changed`, `test-changed`, `check-comment-replacement`, `codebase-map-update`
- **Stop:** `create-checkpoint`, `check-todos`, `typecheck-project`, `lint-project`, `test-project`, `self-review`
- **SubagentStop:** mirrors Stop hooks for subagent quality gates
- **UserPromptSubmit:** `thinking-level`, `codebase-map`

### affaan-m/everything-claude-code (50k★, hackathon winner)
- 16+ agents, 65+ skills, 40+ commands, 997 internal tests
- Hook profiles: `minimal`, `standard`, `strict` with flag-based activation
- PreToolUse: auto-tmux, git push reminders, suggest-compact, continuous learning
- PostToolUse: PR logging, build analysis, quality gates, auto-format with Biome/Prettier detection
- Stop: console.log check, session-end persistence, cost tracking
- PreCompact: state saving
- SessionStart: context loading with root fallback

### EveryInc/compound-engineering-plugin (10.2k★)
- "Compound Engineering": Plan → Work → Review → Compound → Repeat
- 24 agents, 13 commands, 11 skills, 2 MCP servers
- Version management for both root CLI and embedded plugin metadata

### ChrisWiles/claude-code-showcase
- Full .claude/ structure: settings.json, agents/, commands/, hooks/, skills/
- UserPromptSubmit: skill evaluation
- PreToolUse: main branch protection
- PostToolUse: Prettier, npm install on package.json change, test execution, TypeScript checking

### darraghh1/my-claude-setup — Next.js/Supabase/TypeScript
- All 12 hook lifecycle events covered
- Uses Python hooks via `uv run`
- Enables `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`

### feiskyer/claude-code-settings
- Model routing with `opusplan` strategy
- `permissions.ask` for destructive operations (sudo, force push, npm publish, eval)
- Custom `statusLine` via shell script

## Typed Hook Systems

### johnlindquist/claude-hooks (314★)
- CLI generates complete TypeScript hooks environment
- Typed payloads for all 8 hook types
- Transcript parsing utilities (getInitialMessage, getAllMessages, getConversationHistory, getToolUsage)
- Requires Bun

### constellos/claude-code-plugins
- Full TypeScript type definitions for all 13 hook events
- Tool-specific discriminated union types: `PostToolUseInputTyped`, `PreToolUseInputTyped`
- Helper type `PostToolUseInputFor<'Write' | 'Edit'>` for tool-specific hooks
- Zero runtime dependencies

### hgeldenhuys/claude-hooks-sdk
- Full SDK with fluent API: `manager.onPreToolUse(...)`
- Transform utilities: ConversationLogger, FileChangeTracker, TodoTracker
- Persistent state (SQLite/file/memory), session analytics, middleware system

## Rules Directories (.claude/rules/)

### affaan-m/everything-claude-code
```
rules/common/          — language-agnostic
rules/typescript/      — TS-specific
  coding-style.md      — paths: ["**/*.ts", "**/*.tsx"]
  testing.md           — Playwright E2E patterns
  patterns.md          — ApiResponse<T>, Repository pattern
  security.md          — env var validation
  hooks.md             — TypeScript hooks docs
```

Each uses `paths:` frontmatter for file targeting.

## Key TypeScript-Specific Rules (Collected)

- Use `type` over `interface` (some projects) or vice versa — pick one, be consistent
- No `any` — use `unknown` or Zod schemas
- `@ts-expect-error` with description, never `@ts-ignore`
- Immutability via spread operator, `readonly` modifiers
- Zod for runtime validation and type inference
- Discriminated unions for variant types
- Branded types for IDs
- Dependency injection via `deps` object parameter for testability
- `verbatimModuleSyntax` for enforcing `import type`
- `isolatedDeclarations` for faster type checking (eggjs)
