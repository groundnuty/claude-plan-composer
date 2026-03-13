# Regression Testing Design

## Problem

All 312 existing tests use property assertions (`toContain`, `toMatch`). They verify that prompts include specific ingredients but not the exact output. A refactoring that reorders sections, changes whitespace, or subtly rewords instructions passes every test but could degrade LLM output quality.

This project is a **prompt compiler**: config in, prompts out. The prompts are machine code for LLMs. Regression testing should treat prompt output the way compiler projects treat IR/assembly — snapshot it, diff it, review every change.

## Approach

Dedicated `test/regression/` suite with 4 test files, supported by shared helpers in `test/helpers/`. Uses Vitest `toMatchSnapshot()` for deterministic output and `fast-check` for structural invariants.

## File Structure

```
test/
  helpers/
    factories.ts          — shared mock factories (extracted from existing tests)
    arbitraries.ts        — fast-check arbitraries for property testing
  regression/
    prompt-snapshots.test.ts        — all 6 prompt builders
    config-snapshots.test.ts        — resolved config objects
    integration-snapshots.test.ts   — YAML fixture -> prompt end-to-end
    structural-invariants.test.ts   — fast-check property tests
    __snapshots__/                  — auto-managed by vitest
```

No changes to `vitest.config.ts` needed — `test/**/*.test.ts` already covers `test/regression/`.

## Dependencies

- `fast-check` `^3.0.0` added as devDependency

## 1. Shared Helpers

### `test/helpers/factories.ts`

Extracts mock factories currently duplicated across test files:

- `makePlan(overrides?)` — creates a `Plan` with stub metadata. Uses `Partial<Plan>` signature (the more flexible form). Call sites using positional `(name, content)` form (in `evaluate/prompt-builder.test.ts`, `evaluate/evaluate.test.ts`) rewritten as `makePlan({ variant: { name, guidance: "" }, content })`.
- `makePlanSet(plans)` — wraps plans with timestamp and runDir
- `makeDefaultMergeConfig(overrides?)` — parses through `MergeConfigSchema.parse(overrides)`. Replaces hand-built `makeConfig` factories in evaluate tests that were missing schema-defaulted fields (`workDir`, `strictMcp`, `settingSources`, etc.). Existing evaluate test assertions only use `dimensions` and `evalScoring` from config — none assert on the newly-defaulted fields, so migration is safe without assertion changes.
- `makeBinaryEvalResult()` — binary scoring eval result
- `makeLikertEvalResult()` — likert scoring eval result

Existing test files refactored to import from here:
- `test/merge/merge-prompt-builder.test.ts` — drop local `makePlan`, `makePlanSet`, `makeDefaultMergeConfig`
- `test/evaluate/prompt-builder.test.ts` — drop local `makePlan`, `makeConfig`; rewrite positional calls
- `test/evaluate/evaluate.test.ts` — drop local `makePlan`, `makeConfig`; rewrite positional calls
- `test/verify/verify.test.ts` — drop local factories
- `test/verify/pre-mortem.test.ts` — drop local factories

### `test/helpers/arbitraries.ts`

Fast-check arbitraries composed from `fc.record()`:

- `arbVariant()` — alphanumeric name (1-20 chars), guidance (0-200 chars), optional model
- `arbPlan()` — `fc.record({ variant: arbVariant(), content: fc.string({ minLength: 10, maxLength: 500 }) }).map(({ variant, content }) => makePlan({ variant, content }))`. Uses `makePlan()` for metadata stub so metadata field additions only need updating in one place.
- `arbPlanSet()` — 2-5 random plans
- `arbGenerateConfig()` — valid config: 1-6 variants, random model string, reasonable numeric ranges
- `arbMergeConfig()` — valid config: random dimensions (string or weighted), random constitution rules, random scoring mode, `comparisonMethod: fc.constantFrom("holistic", "pairwise")` to exercise both merge dispatch paths

## 2. Prompt Snapshot Tests

**File:** `test/regression/prompt-snapshots.test.ts`

Fixed `runDir = "/tmp/test-run"` and `mergePlanPath = "/tmp/test-run/merged.md"` for snapshot stability.

### `buildPrompts` (generate) — 4 snapshots

1. Base prompt only, no context, no guidance (minimal)
2. Base prompt + context + variants with guidance (full)
3. Per-variant `promptFile` content overriding base prompt
4. Mixed: 3 variants — 1 with per-variant content from map, 2 falling through to base prompt, all with shared context

### `buildEvalPrompt` (evaluate) — 3 snapshots

1. Binary scoring, string dimensions, 2 plans
2. Likert scoring, weighted dimensions, 3 plans
3. Mixed dimensions (string + weighted), single plan

### `buildHolisticMergePrompt` (merge) — 3 snapshots

1. Default config, 2 plans, no eval result
2. Weighted dimensions, 3 plans, with binary eval result
3. With likert eval result

### `buildPairwiseMergePrompt` (merge) — 2 snapshots

1. 3 plans, unweighted — verifies C(3,2)=3 pairs
2. 4 plans, weighted dimensions, with eval result

### `buildVerifyPrompt` (verify) — 2 snapshots

1. Merged plan + 2 source plans
2. Merged plan + 4 source plans

### `buildPreMortemPrompt` (pre-mortem) — 1 snapshot

1. Representative merged plan content

**Total: ~15 snapshots**

Note: `buildOutputInstruction` and `buildMergeOutputInstruction` are covered transitively — they are called by `buildPrompts` and `buildHolisticMergePrompt`/`buildPairwiseMergePrompt` respectively, so any change to their wording appears in the parent snapshots.

## 3. Config Resolution Snapshots

**File:** `test/regression/config-snapshots.test.ts`

### `resolveGenerateConfig` — 4 snapshots

1. Fixture YAML only (`test/fixtures/config.yaml`)
2. Fixture YAML + CLI overrides (`{ model: "haiku", maxTurns: 5 }`)
3. Fixture YAML + env overrides (mock `CPC_MODEL=haiku`)
4. Per-variant prompt_file YAML (`test/fixtures/config-with-prompt-file.yaml`)

### `resolveMergeConfig` — 3 snapshots

1. Fixture YAML only (`test/fixtures/merge-config.yaml`)
2. With CLI override (`{ strategy: "subagent-debate" }`)
3. With env override (`CPC_STRATEGY=agent-teams`)

Environment handling: follow the same `process.env` isolation pattern as `test/pipeline/config-resolver.test.ts` — save with `savedEnv = { ...process.env }` then delete `CPC_*` keys in `beforeEach`, restore with `process.env = savedEnv` in `afterEach`.

**Total: ~7 snapshots**

## 4. Integration Snapshots

**File:** `test/regression/integration-snapshots.test.ts`

Crosses all module boundaries: YAML on disk -> `resolveGenerateConfig` -> `materializeConfig` -> `buildPrompts` -> snapshot.

Uses existing fixture YAMLs and prompt files (`test/fixtures/prompts/task.md`, `test/fixtures/prompts/alt.md`). Fixed `runDir = "/tmp/test-run"` and `mergePlanPath = "/tmp/test-run/merged.md"` for stability.

**File path handling:** `materializeConfig` reads `prompt`/`promptFile` paths via `fs.readFile` relative to CWD. The fixture YAMLs contain relative paths (e.g., `prompt: prompts/task.md`). Integration tests must resolve these to absolute fixture paths before calling `materializeConfig`. Approach: after `resolveGenerateConfig`, override `config.prompt`/`config.context`/variant `promptFile` fields to absolute paths pointing into `test/fixtures/`.

### Generate pipeline — 2 snapshots

1. `config.yaml` -> resolve -> materialize -> `buildPrompts` -> snapshot all `fullPrompt` strings
2. `config-with-prompt-file.yaml` -> same pipeline -> snapshot (per-variant prompt_file flows through)

### Evaluate pipeline — 1 snapshot

1. `merge-config.yaml` -> resolve -> `buildEvalPrompt` with fixture plans -> snapshot

### Merge pipeline — 2 snapshots

1. `merge-config.yaml` (holistic) -> resolve -> `buildHolisticMergePrompt` -> snapshot
2. Same with `{ comparisonMethod: "pairwise" }` CLI override -> snapshot

### Verify pipeline — 1 snapshot

1. `merge-config.yaml` -> resolve -> `buildVerifyPrompt` with fixture plans -> snapshot

**Total: ~6 snapshots**

## 5. Structural Invariants (fast-check)

**File:** `test/regression/structural-invariants.test.ts`

100 iterations per property (fast-check default).

### Generate prompt invariants — 4 properties

1. Every prompt contains the output instruction file path (`plan-<name>.md`)
2. Every prompt with non-empty guidance contains `## Additional guidance`
3. Every prompt with context contains `## Shared context`
4. No prompt contains `undefined`, `null`, `NaN`, or `[object Object]`

### Eval prompt invariants — 3 properties

1. All plan names appear inside `<generated_plan name="...">` tags
2. Count of `<generated_plan` tags equals number of input plans
3. Output contains `planScores`, `gaps`, `convergence`, `summary`

### Merge prompt invariants — 3 properties

All merge invariants test the raw prompt string from `buildMergePrompt` (the dispatcher). Since `arbMergeConfig` randomizes `comparisonMethod`, both holistic and pairwise paths are exercised.

1. All source plans embedded (tag count = plan count)
2. Every embedded plan has the NOTE injection protection
3. Every merge prompt contains `CONSTITUTIONAL REVIEW` phase

### Verify prompt invariants — 3 properties

All verify invariants test the raw prompt string from `buildVerifyPrompt`.

1. All 4 gate names present in the prompt text: `CONSISTENCY`, `COMPLETENESS`, `ACTIONABILITY`, `FACTUAL_ACCURACY`
2. All source plan names appear in `<source_plan name="...">` tags
3. Merged plan wrapped in `<merged_plan>` tags

### Pre-mortem invariant — 1 property

1. Prompt contains `<merged_plan>` tag and `scenarios` in JSON schema

**Total: ~14 properties**

## Snapshot Update Workflow

When a prompt change is intentional:

```bash
make -f dev.mk test              # see which snapshots changed
npx vitest run test/regression/ -u   # update snapshots
git diff test/regression/__snapshots__/   # review the diff
```

The snapshot diff in PRs serves as a prompt change review gate.

Snapshot files in `__snapshots__/` must be committed to git — they are the regression baseline.

## What This Does NOT Cover

- LLM output (non-deterministic)
- E2E tests with real API calls (already in `test/e2e/`)
- Timing, duration values, session IDs
- File paths containing timestamps

## Existing Test Refactoring

The factory extraction into `test/helpers/factories.ts` requires updating imports in:
- `test/merge/merge-prompt-builder.test.ts`
- `test/evaluate/prompt-builder.test.ts`
- `test/evaluate/evaluate.test.ts`
- `test/verify/verify.test.ts`
- `test/verify/pre-mortem.test.ts`

Migration notes:
- `makePlan` signature unifies to `(overrides?: Partial<Plan>)`. The positional `(name, content)` call sites in evaluate tests must be rewritten.
- `makeConfig` hand-built factories in evaluate tests replaced by `makeDefaultMergeConfig(overrides)` which goes through `MergeConfigSchema.parse()`, adding missing defaults and dropping non-existent fields like `sessionSettings`.
- All existing test assertions must be verified to still pass after factory migration — the factory outputs may gain additional default fields.
