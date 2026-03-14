# Feature 2: I2 — Diversity Thermostat — Design Spec

**Date:** 2026-03-14
**Status:** Approved
**Branch:** `feat/I2-diversity-thermostat`
**Risk:** Low — measurement only, no behavioral change
**Depends on:** Feature 0 (Shannon entropy in eval harness)
**Scientific basis:** MIMIC (Chen et al., ASE 2025 RT) §4.3 Shannon Entropy; Shannon (1948) normalized entropy

## Goal

Add a `measureDiversity()` function to the pipeline that computes Jaccard distance + Shannon entropy on generated plan variants, produces a normalized composite score, and warns when diversity is below a configurable threshold. Results are stored as pipeline artifacts. No behavioral changes to generation, evaluation, or merge.

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Metrics scope | Jaccard distance + Shannon entropy (2 metrics) | Both are local/cheap (no API calls). Embedding cosine distance + decision-space coverage deferred to I4 where those capabilities are needed for dynamic lens selection |
| Integration point | Standalone function between generate and evaluate | Runs even with `skipEval: true`. Logically distinct from LLM-driven evaluation. Warning emitted before expensive eval/merge steps |
| Warning mechanism | NDJSON log + `onStatusMessage` callback | NDJSON gives post-hoc analysis (monitor tool reads these). Callback gives real-time feedback. Matches existing phase patterns |
| Threshold type | Single composite threshold (0-1) | Keeps config simple. Per-metric thresholds can be added later if needed |
| Default threshold | 0.30 | Catches pathological near-duplicates without false positives. Based on expected composite ranges: ~0.15-0.30 for near-duplicates, ~0.50-0.65 moderate, ~0.65-0.80 good diversity |
| Entropy normalization | `H / log2(V)` per n-gram level, mean across levels | Standard "efficiency" metric from information theory. MIMIC uses raw bits but that's unsuitable for a 0-1 composite. `V` = unique n-grams observed at that level |
| Composite formula | `(jaccardDistance + normalizedEntropy) / 2` | Jaccard captures set-level vocabulary diversity, entropy captures frequency-level distributional diversity — complementary signals. Equal weighting avoids tuning hyperparameter |
| Entropy code location | Extract to `src/evaluate/entropy.ts` | Currently in `test/eval/helpers/metrics.ts` (test-only). Moving to src enables pipeline use. Test helper re-exports from src. No duplication |
| Config placement | `diversityThreshold` in `GenerateConfigSchema` | Diversity measurement happens post-generate, so belongs in generate config |

---

## Component 1: DiversityResult Type

**New file: `src/types/diversity.ts`**

```typescript
const DiversityResultSchema = z.object({
  jaccardDistance: z.number().min(0).max(1),
  shannonEntropy: z.object({
    perNgram: z.record(z.string(), z.number()),
    mean: z.number(),
  }),
  normalizedEntropy: z.number().min(0).max(1),
  compositeScore: z.number().min(0).max(1),
  warning: z.string().optional(),
});

type DiversityResult = z.infer<typeof DiversityResultSchema>;
```

**Fields:**
- `jaccardDistance` — mean pairwise Jaccard distance on headings (1 - similarity). 0 = identical, 1 = completely different.
- `shannonEntropy` — raw bits from `computeShannonEntropy()` (backward compat with eval baselines). `perNgram` keyed by n-gram size, `mean` across sizes.
- `normalizedEntropy` — mean of `H_n / log2(V_n)` across n-gram sizes [1,2,3]. Always 0-1.
- `compositeScore` — `(jaccardDistance + normalizedEntropy) / 2`. Always 0-1.
- `warning` — present only when `compositeScore < threshold`. Human-readable message.

---

## Component 2: Entropy Extraction

**New file: `src/evaluate/entropy.ts`**

Extracts `computeShannonEntropy()` and `extractOrderedWords()` from `test/eval/helpers/metrics.ts` into source code so the pipeline can use them.

```typescript
export interface EntropyResult {
  readonly perNgram: Readonly<Record<number, number>>;
  readonly mean: number;
}

export function extractOrderedWords(text: string): readonly string[];

export function computeShannonEntropy(
  texts: readonly string[],
  ngramSizes?: readonly number[],
): EntropyResult;
```

**Additionally**, a new normalization helper:

```typescript
export function computeNormalizedEntropy(
  texts: readonly string[],
  ngramSizes?: readonly number[],
): { readonly perNgram: Readonly<Record<number, number>>; readonly mean: number };
```

Returns `H_n / log2(V_n)` for each n-gram size, and mean across sizes. When `V_n <= 1` (zero or one unique n-gram), normalized value is 0 (no diversity).

**Test helper change:** `test/eval/helpers/metrics.ts` replaces its implementations of `computeShannonEntropy` and `extractOrderedWords` with re-exports from `src/evaluate/entropy.ts`. All existing eval tests continue to work unchanged.

---

## Component 3: measureDiversity Function

**New file: `src/evaluate/diversity.ts`**

```typescript
export function measureDiversity(
  plans: readonly Plan[],
  threshold: number,
): DiversityResult;
```

**Algorithm:**
1. Compute heading-level Jaccard: `computePairwiseJaccard(plans)` → take `1 - result.mean` as `jaccardDistance`
2. Compute raw Shannon entropy: `computeShannonEntropy(plans.map(p => p.content))` → store as `shannonEntropy`
3. Compute normalized entropy: `computeNormalizedEntropy(plans.map(p => p.content))` → store `.mean` as `normalizedEntropy`
4. Composite: `(jaccardDistance + normalizedEntropy) / 2`
5. If `compositeScore < threshold`: set `warning` to `"Low diversity detected (score: {compositeScore.toFixed(2)}, threshold: {threshold}). Consider adjusting lenses or variant guidance."`

**Edge cases:**
- `plans.length < 2`: return `jaccardDistance: 0, normalizedEntropy: 0, compositeScore: 0, warning: "..."` (cannot measure diversity with fewer than 2 plans)
- Empty plan content: handled by existing entropy/Jaccard implementations (return 0)

---

## Component 4: Pipeline Integration

**Modified file: `src/pipeline/run.ts`**

Insert `measureDiversity()` call after `writePlanSet()`, before `evaluate()`:

```
generate() → writePlanSet() → measureDiversity() → writeDiversityResult() → evaluate() → ...
```

- Always runs (not gated by `skipEval`)
- Logs diversity metrics to NDJSON logger as `{ type: "diversity", ...result }`
- Fires `onStatusMessage({ type: "diversity_warning", message: result.warning })` if warning present
- Writes `diversity.json` to run directory via `writeDiversityResult()`

**Modified file: `src/pipeline/io.ts`**

```typescript
export async function writeDiversityResult(
  runDir: string,
  result: DiversityResult,
): Promise<void>;

export async function readDiversityResult(
  runDir: string,
): Promise<DiversityResult>;
```

---

## Component 5: Config Addition

**Modified file: `src/types/config.ts`**

Add to `GenerateConfigSchema`:

```typescript
diversityThreshold: z.number().min(0).max(1).default(0.30),
```

This threshold controls when the low-diversity warning fires. Default 0.30 catches pathological near-duplicates. Set to 0 to disable warnings.

---

## Files Changed

| File | Change |
|---|---|
| `src/types/diversity.ts` | Create: `DiversityResultSchema` + inferred type |
| `src/types/config.ts` | Modify: add `diversityThreshold` to `GenerateConfigSchema` |
| `src/types/index.ts` | Modify: re-export `DiversityResult` |
| `src/index.ts` | Modify: barrel export `measureDiversity`, `DiversityResultSchema`, `DiversityResult` |
| `src/evaluate/entropy.ts` | Create: extracted `computeShannonEntropy`, `extractOrderedWords`, new `computeNormalizedEntropy` |
| `src/evaluate/diversity.ts` | Create: `measureDiversity()` function |
| `src/evaluate/index.ts` | Modify: re-export from `entropy.ts` and `diversity.ts` |
| `src/pipeline/run.ts` | Modify: call `measureDiversity()` after `writePlanSet()` |
| `src/pipeline/io.ts` | Modify: add `writeDiversityResult()` / `readDiversityResult()` |
| `test/types/diversity.test.ts` | Create: Zod schema validation tests |
| `test/evaluate/entropy.test.ts` | Create: unit tests for extracted entropy + new normalized entropy |
| `test/evaluate/diversity.test.ts` | Create: `measureDiversity()` unit tests |
| `test/eval/helpers/metrics.ts` | Modify: replace entropy implementations with re-exports from `src/evaluate/entropy.ts` |

## What This Does NOT Change

- No modifications to merge strategies or merge prompts
- No modifications to evaluate phase logic
- No modifications to generate phase logic (plans are identical)
- No new dependencies
- No behavioral change to generated plans
- Existing eval baselines remain compatible (raw entropy stored alongside normalized)

## Success Criteria

- [ ] `measureDiversity()` returns `DiversityResult` with Jaccard distance, Shannon entropy (raw + normalized), and composite score
- [ ] Warning emitted when `compositeScore < diversityThreshold` via both NDJSON log and `onStatusMessage` callback
- [ ] Results stored as `diversity.json` pipeline artifact
- [ ] `computeShannonEntropy` extracted from test helpers to `src/evaluate/entropy.ts` — test helpers re-export, all existing tests unchanged
- [ ] `computeNormalizedEntropy` returns `H/log2(V)` per n-gram size with correct edge case handling (`V <= 1` → 0)
- [ ] `diversityThreshold` configurable in `GenerateConfig` (default 0.30)
- [ ] `make -f dev.mk check` passes (no existing tests broken)
- [ ] Eval gate: `make -f dev.mk eval-compare` shows no regression (measurement-only change)
