# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This is the **TypeScript SDK** reimplementation of `claude-plan-composer` — an LLM plan composition toolkit that orchestrates multiple parallel Claude Agent SDK sessions to generate diverse implementation plans, then merges the best elements into a single plan. It implements a research-backed "best-of-N with prompt variation" pattern.

The SDK is library-first: every component is a pure async function with typed input/output contracts. The CLI (`cpc`) is a thin wrapper using Commander.

## Pipeline

1. **Generate** (`generate()`): Launches parallel Agent SDK `query()` sessions, each with a different prompt variant.
   - **Single-file**: One prompt + variant guidance from config (default: 4 variants).
   - **Multi-file**: Each prompt file is a standalone variant. Supports shared context.
   - Flags: `autoLenses` generates task-specific variants via LLM (includes adversarial perspective). `sequentialDiversity` runs variants in two waves.
   Each session writes a plan to a file via the Write tool.

2. **Evaluate** (Phase C — types only): Pre-merge analysis. Types defined in `src/types/evaluation.ts`.

3. **Merge** (`merge()`): Takes generated plans and produces a merged plan. Three strategies:
   - `simple`: Single headless `query()` session analyzes all plans (holistic or pairwise comparison).
   - `subagent-debate`: Per-plan advocate subagents debate under a lead analyst via SDK `agents` option.
   - `agent-teams`: Full independent sessions via Agent Teams (`TeamCreate`/`SendMessage`).
   - **Eval-informed**: If `EvalResult` is provided, the merge prompt includes per-dimension summary.
   - Merge prompts use a 3-phase structure: Analysis (conflict classification), Synthesis (minority insight scanning), Constitutional Review.

4. **Verify** (Phase C — types only): Post-merge quality gates.

## Architecture

```
src/
  types/       — Zod schemas, error classes, type definitions
  generate/    — prompt building, auto-lenses, session runner
  merge/       — prompt building, 3 merge strategies
  pipeline/    — config resolution, I/O, NDJSON logging, orchestrator
  cli/         — Commander-based CLI (thin wrapper)
```

Core principle: **evaluable components**. Components work with DATA, not files. File I/O is in `pipeline/io.ts`.

```typescript
generate(config, options): Promise<PlanSet>
merge(plans, config, eval?): Promise<MergeResult>
writePlanSet(planSet, dir): Promise<void>
readPlanSet(dir): Promise<PlanSet>
```

## Configuration

Config validated with Zod schemas. Resolution chain: CLI > env (`CPC_*`) > `*.local.yaml` > `*.yaml`

```yaml
# config.yaml — generation config
model: opus
max_turns: 80
timeout_ms: 3600000
variants:
  - name: baseline
    guidance: ""
  - name: simplicity
    guidance: "Prioritize minimalism..."

# merge-config.yaml — merge config
model: opus
strategy: simple
comparison_method: holistic
dimensions:
  - "Approach and strategy"
  - "Scope and priorities"
constitution:
  - "Every trade-off must be explicitly acknowledged"
```

## Commands

```bash
# Generate plans
npx cpc generate prompt.md
npx cpc generate --multi --context=shared.md arch.md security.md

# Merge plans
npx cpc merge generated-plans/plan/20260310-123456

# Full pipeline (generate + merge)
npx cpc run prompt.md

# Debug mode (haiku, 20 turns, single variant)
npx cpc generate prompt.md --debug

# Dry run (show resolved config, no API calls)
npx cpc generate prompt.md --dry-run
```

## Development

```bash
npm install
npm test          # unit tests (85 tests, no API calls)
npm run test:e2e  # E2E test (requires API key, ~$1)
npm run check     # tsc + eslint + vitest
npm run build     # tsc → dist/
```

All unit tests are static — no API calls. E2E tests are excluded from default `vitest run`.

## Key Design Decisions

- **Agent SDK** (`@anthropic-ai/claude-agent-sdk`): `query()` for headless sessions, typed message objects, native budget control
- **Zod v4** (`^4.0.0`): Required as Agent SDK peer dep. `import { z } from "zod"` works
- **ESM + NodeNext**: All imports use `.js` extensions, `"type": "module"`
- **Immutability**: All type interfaces use `readonly` properties
- **NDJSON logging**: Backpressure-aware write stream, compatible with bash `monitor-sessions.sh`
- **`settingSources: []`**: Session isolation — no user plugins/hooks/skills
- **`permissionMode: "bypassPermissions"`**: Required for headless SDK sessions
- **Plan embedding safety**: XML tags + plaintext NOTE prefix (not HTML comments)
- **Config snake_case → camelCase**: `snakeToCamel()` transform when loading YAML
