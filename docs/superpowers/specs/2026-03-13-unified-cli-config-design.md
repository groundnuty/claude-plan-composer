# Unified CLI Config Design

## Problem

The `generate` and `run` commands currently have two distinct modes with different
code paths, CLI flags, and mental models:

- **Single-file mode**: one prompt file (positional arg) + N config-defined variants
  with `guidance` steering. Uses `buildVariantPrompts()`.
- **Multi-file mode**: N prompt files (positional args + `--multi` flag) + optional
  `--context` file. Uses `buildMultiFilePrompts()`. Each file IS the variant.

This creates friction:
- Users must choose a mode upfront and use different flags for each.
- Mixed scenarios (some variants share a prompt, others use their own) are impossible.
- `--multi`, `--context`, and the positional `<prompt-file>` arg create a confusing
  three-way interaction.

## Solution

Merge both modes into a single config-driven model. Eliminate positional arguments
and mode-specific flags. Each variant optionally specifies its own `prompt_file`,
falling back to a base `prompt`.

## Config Schema Changes

### `GenerateConfig` additions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | `string?` | — | Path to base prompt file. Required unless every variant has `prompt_file`. |
| `context` | `string?` | — | Path to shared context file. Appended to all prompts when present. Replaces `--context` CLI flag. |

### `Variant` schema addition

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt_file` | `string?` | — | Path to variant-specific prompt file. Overrides base `prompt` for this variant only. |

### YAML example (camelCase shown as snake_case per convention)

```yaml
# Base prompt — used by variants without prompt_file
prompt: prompts/main.md

# Optional shared context
context: prompts/context.md

model: opus
max_turns: 10
timeout_ms: 120000
min_output_bytes: 200

variants:
  - name: concise
    guidance: "Focus on key decisions only"

  - name: thorough
    guidance: "Include implementation details"

  - name: alternative
    prompt_file: prompts/alt-approach.md
    guidance: "Emphasize security trade-offs"

  - name: raw-alt
    prompt_file: prompts/alt-approach.md
```

## Prompt Assembly Semantics

The final prompt sent to the LLM for each variant is assembled as:

```
[prompt_file OR base prompt] + [context] + [guidance]
```

These three fields are independent, orthogonal concerns:

- **`prompt`** (config field) — the base question/task. Used by variants that don't
  specify their own `prompt_file`.
- **`prompt_file`** (per-variant field) — overrides the base `prompt` for that variant
  only. The file content becomes the prompt.
- **`context`** (config field) — shared supplementary material (codebase description,
  constraints, domain knowledge). Always appended when present, regardless of prompt
  source.
- **`guidance`** (per-variant field) — steering/style instruction ("be concise",
  "focus on security"). Always appended when present, regardless of prompt source.

### Assembly matrix

| Variant has | Prompt source | Context | Guidance |
|---|---|---|---|
| neither `prompt_file` nor `guidance` | base `prompt` | appended if set | — |
| `guidance` only | base `prompt` | appended if set | appended |
| `prompt_file` only | variant's `prompt_file` | appended if set | — |
| both `prompt_file` and `guidance` | variant's `prompt_file` | appended if set | appended |

This matches existing behavior: `buildVariantPrompts()` already appends guidance after
the prompt. The unified design simply allows the prompt source to vary per variant.

## CLI Changes

### New shape

```
cpc generate --config gen.yaml
cpc run      --config gen.yaml --merge-config merge.yaml
```

### Override flags

These flags override the corresponding config values:

| Flag | Overrides | Applies to |
|------|-----------|------------|
| `--model <name>` | `model` | generate, run |
| `--max-turns <n>` | `max_turns` | generate, run |
| `--timeout <ms>` | `timeout_ms` | generate, run |
| `--prompt <file>` | `prompt` | generate, run |

### Eliminated flags and args

| Removed | Replaced by |
|---------|-------------|
| positional `<prompt-file>` arg | `prompt` field in config, or `--prompt` flag |
| positional `[extra-files...]` arg | per-variant `prompt_file` in config |
| `--multi` | Automatic: presence of `prompt_file` on any variant |
| `--context <file>` | `context` field in config |

### Retained flags (unchanged)

`--config`, `--merge-config`, `--debug`, `--dry-run`, `--auto-lenses`,
`--sequential-diversity`, `--budget`, `--strategy`, `--comparison`, `--skip-eval`,
`--verify`, `--verify-model`, `--pre-mortem`

(New override flags listed in the table above.)

## Auto-Lenses Interaction

Auto-lenses dynamically generates variant guidance from the base prompt via a cheap
LLM call. It produces a complete `Variant[]` that replaces config variants entirely.

**Rule (Option A):** Auto-lenses is incompatible with per-variant `prompt_file`.
If `auto_lenses: true` and any variant has `prompt_file`, validation fails with an
error.

**Rationale:** Auto-lenses generates analytical perspectives tailored to a single
prompt. Per-variant prompt files represent fundamentally different questions, so
auto-generated perspectives don't apply. Historical data confirms this: auto-lenses
runs are exclusively single-prompt (`generated-plans/prompt/`), multi-file runs are
exclusively in `generated-plans/multi-*/`, with zero overlap.

## Validation Rules

1. If `auto_lenses: true` and any variant has `prompt_file` → `IncompatibleFlagsError`
2. If no `prompt` in resolved config and some variants lack `prompt_file` →
   `ConfigValidationError` ("base prompt required when variants lack prompt_file")
3. `--prompt` flag overrides config `prompt` (base prompt only, not per-variant files)
4. `context` is always optional
5. `sequential_diversity` is incompatible with `prompt_file` variants (same reasoning
   as auto-lenses: it builds on prior variant output, requiring a shared base prompt)
6. Debug mode is compatible with `prompt_file` variants — it selects one variant
   (by name or first) regardless of how that variant gets its prompt.

All cross-field validations (rules 1, 2, 5) are imperative checks in `generate()`
after config parsing, since they involve relationships between fields that Zod
`refine` would express less clearly.

## Internal Architecture Changes

### Type boundaries: config-time vs. runtime

`promptFile` exists only in the config schema (`VariantSchema` in `config.ts`). It is
a file path that gets resolved to content during a **materialization** step before
prompt building. The runtime `Variant` interface in `plan.ts` remains unchanged — it
represents variant identity (name, guidance, model), not config-time file references.

This means:
- `VariantSchema` (config-time): `{ name, guidance, model?, promptFile? }`
- `Variant` (runtime, `plan.ts`): `{ name, guidance, model? }` — no `promptFile`

### File I/O: materialization step

A new `materializeConfig()` function in `generate/index.ts` reads all file paths
(base `prompt`, `context`, per-variant `prompt_file`) and returns resolved content.
This runs between config resolution and prompt building, keeping both the config
resolver and `buildPrompts()` pure (no I/O).

```typescript
interface MaterializedConfig {
  readonly basePrompt: string | undefined;
  readonly context: string | undefined;
  readonly variantPromptContents: ReadonlyMap<string, string>; // variant name → content
}
```

### `prompt-builder.ts`

Replace `buildVariantPrompts()` and `buildMultiFilePrompts()` with a single
`buildPrompts()` function:

```typescript
function buildPrompts(
  basePrompt: string | undefined,
  context: string | undefined,
  variants: readonly Variant[],
  variantPromptContents: ReadonlyMap<string, string>,
  config: GenerateConfig,
  runDir: string,
): VariantPrompt[]
```

For each variant:
1. Determine prompt source: `variantPromptContents.get(variant.name)` if present,
   else `basePrompt`
2. Append `context` if present
3. Append `guidance` if present
4. Append output instruction

The function remains pure — all file I/O happens in the materialization step above.

### `GenerateOptions`

Remove `prompt`, `promptFiles`, and `context` fields. These are now in config.
Retain: `outputDir`, `debug`, `signal`, `onStatusMessage`.

### `cli/index.ts`

- Remove positional arguments from `generate` and `run` commands
- Remove `--multi` and `--context` flags
- Add `--prompt <file>` override flag
- CLI no longer reads prompt files directly — it passes paths to config, and
  `materializeConfig()` handles all file I/O

### `config.ts` (Zod schemas)

- Add `prompt: z.string().optional()` to `GenerateConfigSchema`
- Add `context: z.string().optional()` to `GenerateConfigSchema`
- Add `promptFile: z.string().optional()` to `VariantSchema`

### Output directory naming

Currently, multi-file mode uses `multi-<timestamp>` prefix and single-file uses
`plan`. In the unified model, the heuristic becomes: if any variant has
`promptFile`, use `multi-<timestamp>`; otherwise use `plan`. This preserves backward
compatibility of output directory structure.

## Migration Path

### Old single-file usage

```bash
# Before
cpc generate prompts/task.md --config gen.yaml

# After — move prompt into config
# gen.yaml: prompt: prompts/task.md
cpc generate --config gen.yaml
```

### Old multi-file usage

```bash
# Before
cpc generate prompts/a.md prompts/b.md prompts/c.md --multi --context ctx.md --config gen.yaml

# After — each file becomes a variant with prompt_file
# gen.yaml:
#   context: ctx.md
#   variants:
#     - name: a
#       prompt_file: prompts/a.md
#     - name: b
#       prompt_file: prompts/b.md
#     - name: c
#       prompt_file: prompts/c.md
cpc generate --config gen.yaml
```

### New mixed mode (previously impossible)

```yaml
prompt: prompts/main.md
variants:
  - name: concise
    guidance: "Be concise"
  - name: thorough
    guidance: "Be thorough"
  - name: alternative
    prompt_file: prompts/alt.md
    guidance: "Different approach"
```

## Breaking Changes

This is a breaking change to the CLI interface. Acceptable at pre-1.0 status — no
deprecation period. Existing YAML config files remain valid (new fields are optional).
Only CLI invocations with positional prompt arguments or `--multi`/`--context` flags
need updating.

## Non-Goals

- Changing merge, evaluate, or verify config schemas (unaffected)
- Changing the Agent SDK session interface
- Changing NDJSON log format or monitor display
- Supporting `prompt_file` on auto-lens-generated variants (explicitly excluded)
