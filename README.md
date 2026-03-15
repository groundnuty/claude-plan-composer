# claude-plan-composer

[![CI](https://github.com/groundnuty/claude-plan-composer/actions/workflows/ci.yml/badge.svg)](https://github.com/groundnuty/claude-plan-composer/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

TypeScript SDK for generating, evaluating, and merging plans using the Claude Agent SDK. Generates multiple plan variants in parallel using different analytical perspectives, then merges the best elements into a single plan via structured debate.

## Quick Start

```bash
npm install
npm run build
export ANTHROPIC_API_KEY=sk-ant-...

# Generate plans
npx cpc generate prompt.md

# Multi-file mode
npx cpc generate --multi --context=shared.md arch.md security.md perf.md

# Merge plans
npx cpc merge generated-plans/plan/20260310-123456

# Full pipeline (generate + merge)
npx cpc run prompt.md
```

Requires Node.js >= 20.

## CLI Commands

### `cpc generate <prompt...>`

Generate plan variants from one or more prompt files.

| Flag | Description |
|------|-------------|
| `--multi` | Multi-file mode: each file is a separate variant |
| `--context <file>` | Shared context injected into every variant |
| `--model <model>` | Override model (default from config) |
| `--variants <n>` | Number of variants to generate |
| `--max-turns <n>` | Max API round-trips per session |

### `cpc merge <plan-dir>`

Merge a set of generated plans into a single output.

| Flag | Description |
|------|-------------|
| `--strategy <s>` | Merge strategy: `simple`, `subagent-debate`, `agent-teams` |
| `--model <model>` | Override model for merge |

### `cpc run <prompt...>`

Full pipeline: generate variants, then merge.

Accepts all flags from `generate` and `merge`.

## Library API

```typescript
import { generate, merge, runPipeline } from "claude-plan-composer";
import { GenerateConfigSchema, MergeConfigSchema } from "claude-plan-composer";

const genConfig = GenerateConfigSchema.parse({
  model: "haiku",
  variants: [{ name: "arch", system_prompt: "..." }],
});

const planSet = await generate(genConfig, { prompt: "..." });
const result = await merge(planSet, MergeConfigSchema.parse({}));
```

## Merge Strategies

| Strategy | Description |
|----------|-------------|
| `simple` | Single headless session analyzes all plans |
| `subagent-debate` | Per-plan advocate subagents debate under a lead analyst |
| `agent-teams` | Full independent sessions via Claude Code agent teams |

## Config

- `config.yaml` / `config.local.yaml` for generation
- `merge-config.yaml` / `merge-config.local.yaml` for merge
- Resolution order: CLI flags > env vars (`CPC_*`) > `*.local.yaml` > `*.yaml`
- All config validated with Zod schemas at load time

## Development

```bash
npm install
npm test          # unit tests (85 tests, no API calls)
npm run test:e2e  # E2E test (requires API key, ~$1)
npm run check     # tsc + eslint + vitest
```

## Architecture

```
src/
  types/       Zod schemas, error classes, type definitions
  generate/    prompt building, auto-lenses, session runner
  merge/       prompt building, 3 merge strategies
  pipeline/    config resolution, I/O, NDJSON logging, orchestrator
  cli/         Commander-based CLI (thin wrapper)
```

Dependencies: `@anthropic-ai/claude-agent-sdk`, `commander`, `js-yaml`, `zod`.

## License

MIT
