# Claude Code Performance Optimization for TypeScript

**Date:** 2026-03-10
**Sources:** Official docs, benchmarks, community reports

## Token Usage

- Claude Code uses **99.4% input tokens** (output is negligible)
- Average: **$6/developer/day**, 90% under $12/day
- Single-file fix: **$0.50–$2**; medium refactor: **$5–$15**; large Opus session: **$20–$80+**
- `/compact` on 45K tokens → 8K tokens (**82% savings**)
- Developers report **40–55% token reduction** with targeted optimizations
- 155K+ line TS codebase: **97% input token reduction** using semantic search vs grep

## Context Window

- ~**195K token** context window (Sonnet 4.0)
- Auto-compaction at **75–92%** capacity
- Compaction achieves **60–80% reduction** (150K → 30–50K)
- Structured prompts consume **30% fewer tokens** than narrative
- 100-line CLAUDE.md ≈ **~4,000 tokens** (2% of Opus window)
- Total memory files should not exceed **~10,000 tokens**

### Strategies
- Break work into 30-minute sprints; `/compact` with explicit summary between them
- Just-in-time context loading via tools rather than pre-loading everything
- Delegate exploratory tasks to sub-agents
- Use structured note-taking (TODO lists) for persistent memory outside context

## Compaction

- PreCompact hooks reduce **critical information loss by 30%** (Anthropic, Jan 2026)
- Plans and TODO items **persist across compaction** — safe anchors
- Compact proactively at **70% context usage** rather than waiting for auto
- "Document & Clear" pattern: dump progress to `.md`, `/clear`, new session reads it

## Prompt Caching

- Real-world 100M token tracking: **84% cache hit rate**, saving **~76% on input costs**
- Without caching: long Opus session **$50–$100**; with: **$10–$19**
- Cache TTL: **1 hour** (Max plan), **5 minutes** (Pro/API)
- Keep CLAUDE.md stable to maximize cache hits on system prompt

## Hook Performance

**CORRECTION:** The "20s npx cold start" applies only when downloading uninstalled packages. For locally installed packages (our case), the real numbers are:

| Runner | Overhead (local package) |
|--------|-----------|
| `./node_modules/.bin/tool` | ~0ms wrapper (~60ms Node startup) |
| `bun run script` | ~6ms wrapper |
| `npm run script` | ~80-170ms wrapper |
| `npx tool` (local) | ~170-400ms (npm CLI module loading) |
| `npx tool@version` (cached) | 3+ seconds (registry check bug) |
| `npx tool` (not installed) | 10-20s (downloads) |
| `bunx` | ~3s |
| `pnpm dlx` | ~2.2s |
| Direct `node` / `./node_modules/.bin/` | <100ms |

- SHA256 config caching: **<5ms** validation (bartolli pattern)
- Hooks are deterministic (unlike CLAUDE.md instructions which are advisory)

## Linting/Formatting Speed

### ESLint vs alternatives

| Tool | Speed (10K files) |
|------|-------------------|
| ESLint | 45.2s |
| Biome | 0.8s (19–20x faster) |
| Oxlint | ~0.4s (50–100x faster, lint only) |

### Prettier vs alternatives

| Tool | Speed (10K files) |
|------|-------------------|
| Prettier | 12.1s |
| Biome | 0.3s (40x faster) |

- Biome: lint + format in one tool, 20x faster than ESLint + Prettier combined
- Oxlint 1.0: type-aware linting in alpha, **8–12x faster** than typescript-eslint
- Biome v2.3 (Jan 2026): 423+ lint rules with type-aware linting

## TypeScript Type Checking Speed

- `tsgo` (TypeScript 7 native Go compiler): **10.8x total**, **~30x type-checking** speedup
- `--incremental` with `.tsbuildinfo`: **30–50% faster** for localized changes
- `isolatedDeclarations` (eggjs pattern): faster type checking for declarations
- `tsc --noEmit` single file via TS API: **<2s** vs 10–30s for full project

## Runtime Performance

| Metric | Bun | Node.js |
|--------|-----|---------|
| Package install | 20–40x faster | baseline |
| Cold start | 8–15ms | 60–120ms |
| HTTP throughput | 120K req/s | 45K req/s |
| CPU-intensive | 1.7s | 3.4s |

Anthropic acquired Bun in Dec 2025. `devbox add bun` for easy integration.

## Sandbox Overhead

- Native sandbox uses OS-level primitives (Seatbelt/bubblewrap): **negligible overhead**
- OrbStack container: **75–95% of native performance**
- Cost is primarily in filesystem operations crossing sandbox boundaries

## Permission Mode Impact

- Auto-accept (`Shift+Tab`): eliminates human-in-the-loop latency
- `allowedTools` in settings.json: pre-approve specific tools while gating others
- Sandboxing reduces permission prompts by **84%** (Anthropic internal)

## Cost Optimization for Pipelines

- 10 daily headless calls (Sonnet): **~$0.50/day**
- Batch API: **50% discount** (24-hour turnaround)
- Model tiering: Haiku for sub-agents (90% Sonnet capability, 3x savings)
- `--max-turns` prevents runaway loops
- OpenRouter for routine tasks: 3–5x cost reduction

## Top Recommendations for Our Project

| Priority | Action | Impact | Effort |
|----------|--------|--------|--------|
| 1 | Use `./node_modules/.bin/` in hooks, not `npx` | Save ~200-300ms per hook call | Trivial |
| 2 | Add `--incremental` to tsconfig | 30–50% faster tsc | Trivial |
| 3 | Add PreCompact hook for state preservation | 30% less info loss | Low |
| 4 | Add SessionStart compact reminder | Preserve critical context | Trivial |
| 5 | Keep CLAUDE.md under 200 lines, use rules/ for details | Better cache hits | Low |
| 6 | Use Sonnet for sub-agents, Opus for orchestration | 3x cost savings | Low |
| ~~7~~ | ~~Add Bun to devbox for hook scripts~~ | ~~Not worth it — ~100ms savings over direct path~~ | ~~N/A~~ |
| 8 | Consider Biome when migrating linter/formatter | 20x faster lint+format | Medium |
| 9 | Adopt tsgo when stable | 10–30x faster type checks | Medium |
