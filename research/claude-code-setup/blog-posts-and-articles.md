# Blog Posts and Articles: Claude Code TypeScript Configuration

**Date:** 2026-03-10
**Sources:** Web search across dev.to, Medium, personal blogs, official docs

## LSP Integration

### [Medium: LSP for 200-file TypeScript Codebase](https://alirezarezvani.medium.com)
- Navigation: **50ms** with LSP vs **45 seconds** via text search (900x faster)
- After every edit, language server analyzes changes — if Claude introduces an error, it notices and fixes in the same turn
- Known stability issues: multiple GitHub issues (#14803, #15168, #16291) report "No LSP server available"

## Hooks Deep Dives

### [DEV.to: Complete Guide with 20+ Examples (2026)](https://dev.to/lukaszfryc)
- Config locations: `~/.claude/settings.json` (global), `.claude/settings.json` (project, shareable), `.claude/settings.local.json` (local overrides)
- **Avoid `npx` in hooks** — 20s cold start. Use direct `./node_modules/.bin/` or `bunx` (~3s)

### [Pixelmojo: 12 Lifecycle Events Explained](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns)
- Three-tier system: Command hooks (deterministic), Prompt hooks (semantic LLM evaluation), Agent hooks (multi-turn with tool access)

### [Trail of Bits](https://github.com/trailofbits/claude-code-config)
- "Hooks are structured prompt injection at opportune times — guardrails, not walls"
- They are NOT a security boundary — prompt injection can work around them

### [letanure.dev: Part 8 Hooks](https://www.letanure.dev/blog/2025-08-06--claude-code-part-8-hooks-automated-quality-checks)
- Matcher `"Edit:*.ts|Edit:*.tsx"` targets TypeScript edits specifically
- When type errors found, `systemMessage` gets shown to Claude which then auto-fixes

### [Gunnar Grosch: Automating Workflow](https://dev.to/gunnargrosch)
- Three hook types: command, prompt, agent — with practical examples for each

### [chatprd.ai: Stop Hooks with tsgo](https://www.chatprd.ai/how-i-ai/workflows/automate-code-quality-and-fixes-with-ai-stop-hooks)
- `tsgo` catches type errors in <1 second as a Stop hook, preventing completion with broken types

## Productivity Measurements

### [BSWEN: 3x Productivity Case Study (Feb 2026)](https://docs.bswen.com/blog/2026-02-09-claude-code-speed-comparison/)
- 4-person 6-month project completed by 1 person in 2 months (3x overall)
- CRUD apps/dashboards/APIs: ~10x speedup
- Novel problems: minimal speedup
- "The speedup isn't from typing faster — it's from never writing boilerplate again"
- Built two data visualization variants in 20 minutes, compared, chose better one

### [DEV.to: 40% Productivity Increase in Production](https://dev.to/dzianiskarviha)
- Since Aug 2025, 80%+ of all code changes fully written by Claude Code
- Generated, then corrected by Claude Code after review, minimal manual refactoring

### [Medium: 10+ Hours Saved Per Week](https://dimitri-derthe.medium.com)
- Before: ~10 hrs/week on tests, versions, debugging, deployments
- After: 10 specialized automation commands handle these tasks

### [f22labs: 10 Productivity Workflows](https://www.f22labs.com/blogs/10-claude-code-productivity-tips-for-every-developer/)
- Teams with 5+ documented custom workflows reduce onboarding time by 25%
- Session resume (`claude --resume`) boosts workflow continuity by ~30%

## Best Practices

### [SFEIR Institute](https://institute.sfeir.com/en/claude-code/)
- Three most impactful: (1) CLAUDE.md, (2) structured prompts, (3) plan mode before complex tasks
- **Verification criteria** is the "single highest-leverage practice"

### [builder.io: How I Use Claude Code](https://www.builder.io/blog/claude-code)
- `/init` analyzes codebase and creates CLAUDE.md automatically
- `/hooks` provides interactive menu for configuring hooks
- TypeScript hook example: `npx tsc --noEmit --skipLibCheck` on specific files

### [DEV.to: Must-Haves January 2026](https://dev.to/valgard)
- "Less is more" — 4 well-chosen plugins beat 20 "interesting" plugins

### [builder.io: TypeScript vs JavaScript for AI Tools](https://www.builder.io/blog/typescript-vs-javascript)
- Types provide explicit context JavaScript lacks
- More accurate code generation, fewer errors, less time fixing AI mistakes

## Autonomous Pipelines

### [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- `settingSources`: `"user" | "project" | "local"`. When omitted, defaults to `[]` (no filesystem settings)
- `systemPrompt: { type: 'preset', preset: 'claude_code' }` for headless sessions
- `forkSession` option for conversation branching
- Inline `agents` option for dynamic subagent creation without filesystem

## Related Tools

### [ryanlewis/claude-format-hook](https://github.com/ryanlewis/claude-format-hook)
- Tries Biome first for JS/TS, falls back to Prettier
- Supports JS/TS, Python (ruff), Go, Kotlin, Markdown

### [vitest-mcp](https://github.com/djankies/vitest-mcp)
- AI-optimized Vitest runner with structured output, log capturing, coverage analysis

### [tdd-guard](https://github.com/nizos/tdd-guard)
- Automated TDD enforcement for Claude Code

### [severity1/claude-code-prompt-improver](https://github.com/severity1/claude-code-prompt-improver)
- UserPromptSubmit hook that evaluates prompt clarity
- Vague prompts → research plan + clarifying questions
- Clear prompts → pass through with zero overhead
- v0.4.0: 31% token reduction through skill-based architecture
