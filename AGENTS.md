# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

**TypeScript SDK** reimplementation of `claude-plan-composer` — orchestrates parallel Claude Agent SDK sessions to generate diverse implementation plans, then merges the best elements. "Best-of-N with prompt variation" pattern. Library-first: every component is a pure async function. CLI (`cpc`) is a thin Commander wrapper.

## Pipeline

1. **Generate** → parallel `query()` sessions per variant → `PlanSet`
2. **Evaluate** (Phase C — types only, not implemented)
3. **Merge** → dispatches to strategy (simple/subagent-debate/agent-teams) → `MergeResult`
4. **Verify** (Phase C — types only, not implemented)

## Architecture

```
src/
  types/       — Zod schemas, CpcError hierarchy, type definitions
  generate/    — prompt building, auto-lenses, parallel session runner
  merge/       — prompt building, MergeStrategy interface, 3 strategies
  pipeline/    — config resolution (YAML→Zod), I/O, NDJSON logger, orchestrator
  cli/         — Commander CLI (thin wrapper, excluded from coverage)
  index.ts     — public API barrel
```

Core principle: **evaluable components** — work with DATA, not files. File I/O isolated in `pipeline/io.ts`.

## Development

The **Makefile** (`dev.mk`) is the primary interface. It wraps devbox (Node.js 22 + npm) — do not install toolchain on host.

```bash
make -f dev.mk check      # full CI: build + lint + test
make -f dev.mk build       # tsc --noEmit
make -f dev.mk lint        # eslint src/
make -f dev.mk test        # unit tests (85 tests, no API calls)
make -f dev.mk test-e2e    # E2E (requires ANTHROPIC_API_KEY, ~$1)
make -f dev.mk clean       # rm -rf dist coverage
```

One-off commands: `devbox run -- npx vitest run test/generate/prompt-builder.test.ts`

## Key Conventions

- **ESM-only**: `.js` import extensions, `"type": "module"`
- **Zod v4** (`^4.0.0`): Agent SDK peer dep — not v3
- **Immutability**: All interfaces use `readonly`
- **Config**: snake_case YAML → camelCase via `snakeToCamel()`. Resolution: CLI > env (`CPC_*`) > `*.local.yaml` > `*.yaml`
- **Session isolation**: `settingSources: []` + `permissionMode: "bypassPermissions"`
- **Plan embedding**: XML tags + plaintext NOTE prefix (not HTML comments)
- **`import type`**: Enforced by `verbatimModuleSyntax` in tsconfig

## Hooks

- **PostToolUse**: ESLint + tsc on `.ts` files after Edit/Write/MultiEdit
- **Stop**: `make -f dev.mk check` (tsc + eslint + vitest) — must pass to exit cleanly
- **SessionStart (compact)**: Re-injects critical project context after compaction
- **PreCompact**: Saves git state before context compaction

## Implementation Status

- **Phase B complete**: generate + merge (all committed)
- **Phase C stubbed**: evaluate + verify (types only in `types/evaluation.ts`)
- CLI: `cpc generate|merge|run` with signal handling (SIGINT/SIGTERM → AbortController)
