# Feature 0: Eval Harness Grounded Metrics — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Branch:** `feat/eval-grounded-metrics`
**Risk:** None — adds metrics to eval harness, no pipeline behavior change
**Principle:** Measure first, change second.

## Goal

Add two scientifically grounded metrics to the eval harness — Shannon entropy and content retention — so that behavioral changes in subsequent features (I1 lenses, I11 merge restructuring, etc.) can be measured with richer before/after comparison than word-level Jaccard alone.

Both metrics are tracked and stored in baselines but NOT used as assertions yet. They become assertion-ready when the features that depend on them land (I2 for entropy thresholds, I12 for retention gates).

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Entropy scope | Across all variants (single score) | Matches MIMIC methodology; entropy naturally measures distribution spread |
| Retention approach | Term-level (deterministic) | Free, fast, consistent with existing `extractSignificantWords`; LLM-judged retention belongs in I12 |
| Baseline compatibility | Optional fields | Old baselines without new metrics still load; comparison table shows "N/A" |

---

## Component 1: Shannon Entropy

**Scientific basis:** MIMIC (Chen et al., ASE 2025 RT) §4.3 — Shannon Entropy on n-gram frequency distributions, n=1,2,3.

### Interface

```typescript
interface EntropyResult {
  readonly perNgram: ReadonlyMap<number, number>;  // n → entropy value
  readonly mean: number;                            // average across n-gram sizes
}
```

### Function

```
computeShannonEntropy(texts: string[], ngramSizes?: number[]): EntropyResult
```

- Default `ngramSizes`: `[1, 2, 3]`
- Tokenization: lowercase, split on whitespace/punctuation, filter words ≥4 chars (reuses `extractSignificantWords` logic for unigrams; bigrams/trigrams built from the filtered word sequence)
- For each n-gram size: build frequency distribution across ALL texts combined, compute H = -Σ p(x) log₂ p(x)
- Returns per-n-gram entropy + mean across all sizes

### Location

`test/eval/helpers/metrics.ts` — alongside existing word-level Jaccard functions.

### Integration

`test/eval/diversity.test.ts`:
- Compute entropy for both diverse and homogeneous plan sets
- Log both values
- Store in baseline (when saving)
- Display in comparison table (when comparing)
- No assertion on entropy yet

---

## Component 2: Content Retention Score

**Purpose:** Measure what fraction of source plan vocabulary survives the merge. Detects silent content loss.

### Interface

```typescript
interface RetentionResult {
  readonly overall: number;                          // |merged ∩ allSources| / |allSources|
  readonly perVariant: ReadonlyMap<string, number>;  // per-variant retention
  readonly retained: ReadonlySet<string>;             // words that survived
  readonly lost: ReadonlySet<string>;                 // words that didn't
}
```

### Function

```
computeRetentionScore(
  sources: readonly { readonly name: string; readonly content: string }[],
  mergedContent: string,
): RetentionResult
```

- Extract significant words from each source plan using `extractSignificantWords`
- Extract significant words from merged plan
- Overall retention: `|mergedWords ∩ allSourceWords| / |allSourceWords|`
- Per-variant retention: `|mergedWords ∩ variantWords| / |variantWords|` for each variant
- `retained` = `mergedWords ∩ allSourceWords`
- `lost` = `allSourceWords \ mergedWords`

### Location

`test/eval/helpers/metrics.ts` — same file, reuses `extractSignificantWords`.

### Integration

`test/eval/coverage.test.ts`:
- Compute retention after pipeline run
- Log overall + per-variant scores
- Store in baseline
- Display in comparison table
- No assertion on retention yet

---

## Component 3: Baseline & Comparison Table Changes

### Baseline interface changes

Add two optional fields to `test/eval/helpers/baseline.ts`:

```typescript
readonly shannonEntropy?: EntropyResult;
readonly retentionScore?: RetentionResult;
```

Optional so existing saved baselines still deserialize without error.

### ComparisonMetrics changes

Add to `test/eval/helpers/metrics.ts`:

```typescript
readonly shannonEntropy?: number;     // mean entropy
readonly retentionScore?: number;     // overall retention
```

### formatComparisonTable changes

Add two rows after Jaccard distance:

- **Shannon entropy**: baseline vs current, delta with ↑/↓/= arrow
- **Retention score**: baseline vs current, delta with ↑/↓/= arrow (↓ = potential regression)

Show "N/A" when baseline lacks these metrics (backward compatibility).

---

## Files Changed

| File | Change |
|---|---|
| `test/eval/helpers/metrics.ts` | Add `EntropyResult`, `RetentionResult`, `computeShannonEntropy`, `computeRetentionScore`; extend `ComparisonMetrics`; update `formatComparisonTable` |
| `test/eval/helpers/metrics.test.ts` | Unit tests for both new functions |
| `test/eval/helpers/baseline.ts` | Extend `Baseline` interface with optional fields |
| `test/eval/diversity.test.ts` | Compute + log Shannon entropy for both runs; store in baseline |
| `test/eval/coverage.test.ts` | Compute + log retention score after merge; store in baseline |

## What This Does NOT Change

- No pipeline code (`src/`) is modified
- No new dependencies
- No assertions added (metrics are logged + stored only)
- No existing test behavior changes
- Old baselines remain loadable

## Success Criteria

- [ ] `computeShannonEntropy` returns correct entropy for known distributions
- [ ] `computeRetentionScore` returns correct retention for known inputs
- [ ] Both metrics appear in diversity/coverage test logs when eval runs
- [ ] Both metrics stored in baseline.json when saving
- [ ] Comparison table shows new metrics with delta when comparing
- [ ] Old baselines without new metrics still load and compare (show "N/A")
- [ ] `make -f dev.mk check` passes (no existing tests broken)
