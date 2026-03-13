# Eval Harness Design

## Problem

The project is about to undergo research-driven changes to prompts and pipeline logic. Current tests verify prompt text (snapshot regression) and structural invariants (property-based), but cannot detect whether changes improve or degrade actual LLM output quality. We need a quality baseline before changes start, and metamorphic tests that verify structural properties of LLM output despite non-determinism.

## Approach

Pure test infrastructure in `test/eval/` (no new `src/` code). Two metamorphic tests verify relational properties of pipeline output. Golden benchmark storage captures baselines for before/after comparison. Two eval modes: quick (haiku, cheap) for routine checks, full (opus, serious) for high-confidence comparison.

## File Structure

```
test/
  eval/
    diversity.test.ts              — metamorphic: diverse lenses > homogeneous
    coverage.test.ts               — metamorphic: merged plan covers all dimensions
    helpers/
      baseline.ts                  — save/load/compare golden baselines
      metrics.ts                   — dimension coverage, heading extraction, comparison table
      runner.ts                    — resolve configs, orchestrate pipeline runs for eval
  fixtures/
    eval/
      config.yaml                  — generate config: haiku, 20 turns, 3 lenses
      merge-config.yaml            — merge config: 3 dimensions, simple strategy
      prompts/
        task.md                    — small planning task for eval runs
        lens-architecture.md       — "Focus on system architecture"
        lens-risk.md               — "Focus on risks and failure modes"
        lens-testing.md            — "Focus on testing strategy"

eval/
  configs/
    full/
      config.yaml                  — generate config: opus, higher turns
      merge-config.yaml            — merge config: same dimensions, opus
      prompts/                     — task + lenses for serious runs
  baselines/
    <name>/
      baseline.json                — metrics + metadata
      plans/
        plan-<variant>.md          — each variant's full text
      merged.md                    — merged plan full text
```

## Dependencies

No new dependencies. Reuses:
- `computePairwiseJaccard()` from `src/evaluate/jaccard.ts`
- `generate()` from `src/generate/index.ts`
- `runPipeline()` from `src/pipeline/run.ts`
- `resolveGenerateConfig()`, `resolveMergeConfig()` from `src/pipeline/config-resolver.ts`

## 1. Eval Modes

Two modes control which configs are loaded:

| Mode | Model | Turns | Cost/run | Trigger |
|------|-------|-------|----------|---------|
| `quick` | haiku | 20 | ~$0.10 | `make -f dev.mk eval` |
| `full` | opus | higher | ~$1-5 | `make -f dev.mk eval-full` |

The `EVAL_MODE` environment variable (`quick` or `full`) determines which config directory to load. Quick mode loads from `test/fixtures/eval/`. Full mode loads from `eval/configs/full/`.

## 2. Eval Fixtures (Quick Mode)

Designed to be cheap while exercising the core mechanism.

**Task**: A small, concrete planning task (~3 sentences). Something like "Plan a REST API migration from v1 to v2."

**3 lenses** (short, focused prompts):
- `lens-architecture.md` — "Focus on system architecture: components, data flow, integration points"
- `lens-risk.md` — "Focus on risks: failure modes, rollback strategy, monitoring"
- `lens-testing.md` — "Focus on testing: test strategy, coverage, validation gates"

**Generate config**: haiku model, 20 turns, 300s timeout.

**Merge config**: 3 dimensions (Architecture, Risk Management, Testing Strategy), `simple` strategy, `holistic` comparison.

**Full mode configs** (`eval/configs/full/`) are not populated initially — created when the user decides the right opus setup. The directory and a README placeholder are created.

## 3. Metamorphic Test: Lens Diversity

**File**: `test/eval/diversity.test.ts`

**Mechanism**:
1. Run A: `generate()` with 3 different lenses (diverse, normal mode)
2. Run B: `generate()` with the same lens repeated 3 times (homogeneous control — reuses `lens-architecture.md` for all 3)
3. Compute `computePairwiseJaccard()` on each run's plan variants
4. Assert: Run A's mean Jaccard distance (1 - similarity) > Run B's mean Jaccard distance

**Details**:
- Uses `generate()` library function directly, not CLI
- Resolves eval fixture configs via `resolveGenerateConfig()`
- For Run B, overrides `config.variants` to repeat the first lens 3 times
- Prints both Jaccard distances and the delta for inspection
- Test timeout: 300s (5 minutes) — makes 6 LLM calls total
- Skip condition: `ANTHROPIC_API_KEY` not set (same pattern as `test/e2e/`)
- Respects `EVAL_MODE` to pick quick vs full configs

**If `EVAL_SAVE_BASELINE` is set**: after assertions pass, saves the diverse run results as a named baseline.
**If `EVAL_COMPARE_BASELINE` is set**: after assertions pass, loads the named baseline and prints a comparison table.

## 4. Metamorphic Test: Dimension Coverage

**File**: `test/eval/coverage.test.ts`

**Mechanism**:
1. Run the full pipeline via `runPipeline()` (generate → evaluate → merge)
2. Read dimension names from the merge config
3. Check that the merged plan contains a section for each dimension

**Dimension matching**: Extract all markdown headings (`#`, `##`, `###`) from the merged plan. For each configured dimension, check if any heading contains the dimension name as a case-insensitive substring. Log which dimensions were found and which were missing.

**`extractAllHeadings()`**: A helper in `test/eval/helpers/metrics.ts` that extracts headings at all levels (`#`, `##`, `###`). This differs from `extractHeadings()` in `jaccard.ts` which only extracts `##`.

**Details**:
- Uses `runPipeline()` from `src/pipeline/run.ts`
- Test timeout: 600s (10 minutes) — runs the full pipeline
- Skip condition: same as diversity test
- Respects `EVAL_MODE`
- Saves/compares baselines via same env vars

## 5. Golden Benchmark Storage

**File**: `test/eval/helpers/baseline.ts`

### Baseline Schema

```typescript
interface Baseline {
  readonly name: string;
  readonly mode: "quick" | "full";
  readonly timestamp: string;                        // ISO 8601
  readonly commitSha: string;                        // git rev-parse HEAD
  readonly model: string;                            // from generate config
  readonly jaccardMean: number;                      // mean pairwise similarity
  readonly jaccardDistance: number;                   // 1 - mean similarity
  readonly jaccardPairs: readonly JaccardPair[];
  readonly dimensionCoverage: Record<string, boolean>;  // dimension → found
  readonly configPaths: {
    readonly generate: string;
    readonly merge: string;
  };
}
```

### Storage Layout

```
eval/baselines/<name>/
  baseline.json       — the Baseline struct above
  plans/
    plan-<variant>.md — each variant's full text
  merged.md           — merged plan full text
```

All committed to git — plan files are a few KB each.

### Save/Load/Compare

- `saveBaseline(name, metrics, plans, mergedContent)` — writes the directory structure
- `loadBaseline(name)` — reads `baseline.json` and returns the struct
- `compareBaseline(baselineName, currentMetrics)` — prints markdown comparison table

### Comparison Output

```
Comparing against baseline "pre-research-changes" (2026-03-13)
⚠ Warning: baseline used opus, current run uses haiku

Metric                    Baseline    Current     Delta
─────────────────────────────────────────────────────────
Jaccard distance          0.42        0.38        ↓0.04
Dimension: Architecture   FOUND       FOUND       =
Dimension: Risk Mgmt      FOUND       MISSING     ↓REGRESSION
Dimension: Testing        FOUND       FOUND       =
```

Warns (does not fail) if baseline and current run used different models.

### Triggering

Not automatic. Opt-in via environment variables:
- `EVAL_SAVE_BASELINE=<name>` — save results as named baseline after test assertions pass
- `EVAL_COMPARE_BASELINE=<name>` — compare results against stored baseline after test assertions pass

## 6. Vitest Config & Makefile Integration

### Vitest Exclusion

`test/eval/` added to the exclude list alongside `test/e2e/`:

```typescript
// vitest.config.ts
exclude: ['test/e2e/**', 'test/eval/**']
```

### Makefile Targets (dev.mk)

```makefile
eval:                ## Quick eval (haiku, cheap fixtures)
eval-full:           ## Serious eval (opus, full configs)
eval-save:           ## Quick eval + save baseline (NAME=...)
eval-full-save:      ## Full eval + save baseline (NAME=...)
eval-compare:        ## Quick eval + compare against baseline (NAME=...)
eval-full-compare:   ## Full eval + compare against baseline (NAME=...)
```

All targets pass `EVAL_MODE` and optionally `EVAL_SAVE_BASELINE` or `EVAL_COMPARE_BASELINE` to `npx vitest run test/eval/`.

### Typical Workflow

```bash
# Before research changes — capture baseline
make -f dev.mk eval-save NAME=pre-research

# ... make changes ...

# Quick sanity check
make -f dev.mk eval-compare NAME=pre-research

# Serious comparison with opus
make -f dev.mk eval-full-save NAME=pre-research-full
# ... make changes ...
make -f dev.mk eval-full-compare NAME=pre-research-full
```

## What This Does NOT Cover

- LLM-as-judge comparison (future — Tier 2 from research spec)
- Full ablation runner (paper experiment, not a test)
- Shannon entropy or embedding distance (Jaccard on headings is sufficient for now)
- CI integration (expensive tests, on-demand only)
- Constraint responsiveness test (deferred)
- Auto-populating `eval/configs/full/` (user decides the right opus config later)
