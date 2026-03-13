# Feature 0: Eval Harness Grounded Metrics — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Shannon entropy and content retention metrics to the eval harness so subsequent features are measured with scientifically grounded before/after comparison.

**Architecture:** Two pure functions added to `test/eval/helpers/metrics.ts`, wired into existing eval tests as logged/stored metrics (no assertions). Baseline interface extended with optional fields for backward compatibility.

**Tech Stack:** TypeScript, Vitest, existing `extractSignificantWords` regex pattern.

**Spec:** `docs/superpowers/specs/2026-03-13-eval-grounded-metrics-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `test/eval/helpers/metrics.ts` | All eval metric functions | Add `EntropyResult`, `RetentionResult`, `computeShannonEntropy`, `computeRetentionScore`; extend `ComparisonMetrics`; update `formatComparisonTable` |
| `test/eval/helpers/metrics.test.ts` | Unit tests for metrics | Add tests for both new functions + updated comparison table |
| `test/eval/helpers/baseline.ts` | Baseline save/load/compare | Extend `Baseline` with optional fields; update `compareBaseline` |
| `test/eval/diversity.test.ts` | Metamorphic diversity test | Compute + log entropy; store in baseline; pass to comparison |
| `test/eval/coverage.test.ts` | Metamorphic coverage test | Compute + log retention; store in baseline; pass to comparison |

---

## Chunk 1: Shannon Entropy

### Task 1: Shannon entropy — failing tests

**Files:**
- Modify: `test/eval/helpers/metrics.test.ts`

- [ ] **Step 1: Write failing tests for `computeShannonEntropy`**

Add to the end of `test/eval/helpers/metrics.test.ts`:

```typescript
import {
  // ... existing imports ...
  computeShannonEntropy,
} from "./metrics.js";

describe("computeShannonEntropy", () => {
  it("returns zero entropy for empty input", () => {
    const result = computeShannonEntropy([]);
    expect(result.mean).toBe(0);
    expect(result.perNgram).toEqual({});
  });

  it("returns zero entropy for text with no significant words", () => {
    const result = computeShannonEntropy(["a b c"]);
    expect(result.mean).toBe(0);
    expect(result.perNgram).toEqual({});
  });

  it("computes entropy for a single text with uniform distribution", () => {
    // 4 unique unigrams, each appearing once → H = log2(4) = 2.0
    const result = computeShannonEntropy(
      ["alpha beta gamma delta"],
      [1],
    );
    expect(result.perNgram[1]).toBeCloseTo(2.0, 5);
    expect(result.mean).toBeCloseTo(2.0, 5);
  });

  it("computes lower entropy for skewed distribution", () => {
    // "alpha" appears 4x, "beta" once → skewed, lower entropy
    const result = computeShannonEntropy(
      ["alpha alpha alpha alpha beta"],
      [1],
    );
    expect(result.perNgram[1]).toBeLessThan(1.0);
    expect(result.perNgram[1]).toBeGreaterThan(0);
  });

  it("computes entropy across multiple texts combined", () => {
    const resultSame = computeShannonEntropy(
      ["alpha beta gamma", "alpha beta gamma"],
      [1],
    );
    const resultDiverse = computeShannonEntropy(
      ["alpha beta gamma", "delta epsilon zeta"],
      [1],
    );
    // More diverse vocabulary → higher entropy
    expect(resultDiverse.mean).toBeGreaterThan(resultSame.mean);
  });

  it("computes bigram entropy", () => {
    // "alpha beta gamma delta" → bigrams: "alpha beta", "beta gamma", "gamma delta"
    // 3 unique bigrams, each once → H = log2(3) ≈ 1.585
    const result = computeShannonEntropy(
      ["alpha beta gamma delta"],
      [2],
    );
    expect(result.perNgram[2]).toBeCloseTo(Math.log2(3), 4);
  });

  it("computes mean across multiple n-gram sizes", () => {
    const result = computeShannonEntropy(
      ["alpha beta gamma delta epsilon"],
      [1, 2, 3],
    );
    expect(Object.keys(result.perNgram)).toHaveLength(3);
    expect(result.perNgram[1]).toBeGreaterThan(0);
    expect(result.perNgram[2]).toBeGreaterThan(0);
    expect(result.perNgram[3]).toBeGreaterThan(0);
    // Mean should be average of the three
    const values = Object.values(result.perNgram);
    const expectedMean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(result.mean).toBeCloseTo(expectedMean, 10);
  });

  it("defaults to n-gram sizes [1, 2, 3]", () => {
    const result = computeShannonEntropy(["alpha beta gamma delta epsilon"]);
    expect(Object.keys(result.perNgram).map(Number).sort()).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test`
Expected: FAIL — `computeShannonEntropy` is not exported from `./metrics.js`

---

### Task 2: Shannon entropy — implementation

**Files:**
- Modify: `test/eval/helpers/metrics.ts`

- [ ] **Step 1: Add types and implementation to `metrics.ts`**

Add after the `extractSignificantWords` function (after line 63) and before `computeWordPairwiseJaccard`:

```typescript
export interface EntropyResult {
  readonly perNgram: Readonly<Record<number, number>>;
  readonly mean: number;
}

/**
 * Extract ordered array of significant words from text.
 *
 * Same regex as extractSignificantWords but returns an array (preserving
 * order and duplicates) instead of a Set. Needed for n-gram construction.
 */
function extractOrderedWords(text: string): readonly string[] {
  return Array.from(text.toLowerCase().matchAll(/[a-z][a-z0-9]{3,}/g), (m) => m[0]);
}

/**
 * Compute Shannon entropy on n-gram frequency distributions across all texts.
 *
 * Matches MIMIC (Chen et al., ASE 2025 RT) §4.3 methodology:
 * - Tokenize all texts into ordered word arrays
 * - Build sliding-window n-grams for each n-gram size
 * - Compute H = -Σ p(x) log₂ p(x) on the frequency distribution
 *
 * Returns per-n-gram entropy and the mean across all n-gram sizes.
 */
export function computeShannonEntropy(
  texts: readonly string[],
  ngramSizes: readonly number[] = [1, 2, 3],
): EntropyResult {
  const allWords = texts.flatMap(extractOrderedWords);
  if (allWords.length === 0 || ngramSizes.length === 0) {
    return { perNgram: {}, mean: 0 };
  }

  const perNgram: Record<number, number> = {};

  for (const n of ngramSizes) {
    const freq = new Map<string, number>();
    let total = 0;

    for (let i = 0; i <= allWords.length - n; i++) {
      const ngram = allWords.slice(i, i + n).join(" ");
      freq.set(ngram, (freq.get(ngram) ?? 0) + 1);
      total++;
    }

    if (total === 0) {
      perNgram[n] = 0;
      continue;
    }

    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    perNgram[n] = entropy;
  }

  const values = Object.values(perNgram);
  const mean = values.length > 0
    ? values.reduce((s, v) => s + v, 0) / values.length
    : 0;

  return { perNgram, mean };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `make -f dev.mk test`
Expected: All tests PASS including the new `computeShannonEntropy` tests

- [ ] **Step 3: Commit**

```bash
git add test/eval/helpers/metrics.ts test/eval/helpers/metrics.test.ts
git commit -m "feat(eval): add Shannon entropy metric to eval harness"
```

---

## Chunk 2: Content Retention

### Task 3: Content retention — failing tests

**Files:**
- Modify: `test/eval/helpers/metrics.test.ts`

- [ ] **Step 1: Write failing tests for `computeRetentionScore`**

Add to the end of `test/eval/helpers/metrics.test.ts`:

```typescript
import {
  // ... existing imports ...
  computeRetentionScore,
} from "./metrics.js";

describe("computeRetentionScore", () => {
  it("returns perfect retention when merged contains all source words", () => {
    const result = computeRetentionScore(
      [
        { name: "a", content: "architecture components integration" },
        { name: "b", content: "rollback monitoring alerts" },
      ],
      "architecture components integration rollback monitoring alerts",
    );
    expect(result.overall).toBe(1.0);
    expect(result.lost).toEqual([]);
  });

  it("detects lost words", () => {
    const result = computeRetentionScore(
      [
        { name: "a", content: "architecture components integration" },
        { name: "b", content: "rollback monitoring alerts" },
      ],
      "architecture components monitoring",
    );
    expect(result.overall).toBeLessThan(1.0);
    expect(result.overall).toBeGreaterThan(0);
    expect(result.lost).toContain("integration");
    expect(result.lost).toContain("rollback");
    expect(result.lost).toContain("alerts");
    expect(result.retained).toContain("architecture");
    expect(result.retained).toContain("components");
    expect(result.retained).toContain("monitoring");
  });

  it("computes per-variant retention", () => {
    const result = computeRetentionScore(
      [
        { name: "a", content: "architecture components" },
        { name: "b", content: "rollback monitoring" },
      ],
      "architecture components",  // only variant a's words survive
    );
    expect(result.perVariant["a"]).toBe(1.0);
    expect(result.perVariant["b"]).toBe(0);
  });

  it("returns perfect retention for empty sources", () => {
    const result = computeRetentionScore(
      [{ name: "a", content: "a b c" }],  // no significant words
      "anything here",
    );
    expect(result.overall).toBe(1.0);
    expect(result.perVariant["a"]).toBe(1.0);
  });

  it("returns sorted retained and lost arrays", () => {
    const result = computeRetentionScore(
      [{ name: "a", content: "zeta alpha beta gamma" }],
      "alpha gamma",
    );
    expect(result.retained).toEqual(["alpha", "gamma"]);
    expect(result.lost).toEqual(["beta", "zeta"]);
  });

  it("handles zero retention", () => {
    const result = computeRetentionScore(
      [{ name: "a", content: "architecture components integration" }],
      "completely different vocabulary here",
    );
    expect(result.overall).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test`
Expected: FAIL — `computeRetentionScore` is not exported from `./metrics.js`

---

### Task 4: Content retention — implementation

**Files:**
- Modify: `test/eval/helpers/metrics.ts`

- [ ] **Step 1: Add types and implementation to `metrics.ts`**

Add after the `computeShannonEntropy` function and before `computeWordPairwiseJaccard`:

```typescript
export interface RetentionResult {
  readonly overall: number;
  readonly perVariant: Readonly<Record<string, number>>;
  readonly retained: readonly string[];
  readonly lost: readonly string[];
}

/**
 * Compute term-level content retention: what fraction of source plan
 * vocabulary survives in the merged plan.
 *
 * Uses extractSignificantWords (same as word-level Jaccard) to extract
 * content-bearing terms, then measures overlap between sources and merged.
 * Also computes per-variant retention to detect minority suppression.
 */
export function computeRetentionScore(
  sources: readonly { readonly name: string; readonly content: string }[],
  mergedContent: string,
): RetentionResult {
  const mergedWords = extractSignificantWords(mergedContent);
  const variantWordSets = sources.map((s) => ({
    name: s.name,
    words: extractSignificantWords(s.content),
  }));

  const allSourceWords = new Set<string>();
  for (const v of variantWordSets) {
    for (const w of v.words) {
      allSourceWords.add(w);
    }
  }

  if (allSourceWords.size === 0) {
    const perVariant: Record<string, number> = {};
    for (const v of variantWordSets) {
      perVariant[v.name] = 1.0;
    }
    return { overall: 1.0, perVariant, retained: [], lost: [] };
  }

  const retainedSet = new Set<string>();
  const lostSet = new Set<string>();
  for (const word of allSourceWords) {
    if (mergedWords.has(word)) {
      retainedSet.add(word);
    } else {
      lostSet.add(word);
    }
  }

  const overall = retainedSet.size / allSourceWords.size;

  const perVariant: Record<string, number> = {};
  for (const v of variantWordSets) {
    if (v.words.size === 0) {
      perVariant[v.name] = 1.0;
      continue;
    }
    let retained = 0;
    for (const w of v.words) {
      if (mergedWords.has(w)) retained++;
    }
    perVariant[v.name] = retained / v.words.size;
  }

  return {
    overall,
    perVariant,
    retained: [...retainedSet].sort(),
    lost: [...lostSet].sort(),
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `make -f dev.mk test`
Expected: All tests PASS including the new `computeRetentionScore` tests

- [ ] **Step 3: Commit**

```bash
git add test/eval/helpers/metrics.ts test/eval/helpers/metrics.test.ts
git commit -m "feat(eval): add content retention metric to eval harness"
```

---

## Chunk 3: Baseline & Comparison Table Integration

### Task 5: Extend ComparisonMetrics and formatComparisonTable

**Files:**
- Modify: `test/eval/helpers/metrics.ts`
- Modify: `test/eval/helpers/metrics.test.ts`

- [ ] **Step 1: Write failing tests for updated comparison table**

Add to the `formatComparisonTable` describe block in `metrics.test.ts`:

```typescript
  it("shows Shannon entropy row", () => {
    const table = formatComparisonTable(
      {
        jaccardDistance: 0.4,
        dimensionCoverage: {},
        model: "haiku",
        shannonEntropy: 3.5,
        retentionScore: 0.85,
      },
      {
        jaccardDistance: 0.42,
        dimensionCoverage: {},
        model: "haiku",
        shannonEntropy: 3.8,
        retentionScore: 0.80,
      },
    );
    expect(table).toContain("Shannon entropy");
    expect(table).toContain("3.50");
    expect(table).toContain("3.80");
    expect(table).toContain("Retention score");
    expect(table).toContain("0.85");
    expect(table).toContain("0.80");
  });

  it("shows N/A when baseline lacks new metrics", () => {
    const table = formatComparisonTable(
      {
        jaccardDistance: 0.4,
        dimensionCoverage: {},
        model: "haiku",
      },
      {
        jaccardDistance: 0.42,
        dimensionCoverage: {},
        model: "haiku",
        shannonEntropy: 3.8,
        retentionScore: 0.80,
      },
    );
    expect(table).toContain("Shannon entropy");
    expect(table).toContain("N/A");
    expect(table).toContain("Retention score");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test`
Expected: FAIL — `ComparisonMetrics` doesn't accept `shannonEntropy`/`retentionScore`

- [ ] **Step 3: Extend `ComparisonMetrics` and update `formatComparisonTable`**

In `test/eval/helpers/metrics.ts`, update the `ComparisonMetrics` interface (line 106-110):

```typescript
export interface ComparisonMetrics {
  readonly jaccardDistance: number;
  readonly dimensionCoverage: Record<string, boolean>;
  readonly model: string;
  readonly shannonEntropy?: number;
  readonly retentionScore?: number;
}
```

In `formatComparisonTable`, add after the Jaccard distance row (after line 145) and before the dimension coverage block:

```typescript
  // Shannon entropy
  if (baseline.shannonEntropy != null || current.shannonEntropy != null) {
    const bStr = baseline.shannonEntropy != null ? baseline.shannonEntropy.toFixed(2) : "N/A";
    const cStr = current.shannonEntropy != null ? current.shannonEntropy.toFixed(2) : "N/A";
    const delta = baseline.shannonEntropy != null && current.shannonEntropy != null
      ? formatDelta(current.shannonEntropy - baseline.shannonEntropy)
      : "—";
    lines.push(padRow("Shannon entropy", bStr, cStr, delta));
  }

  // Retention score
  if (baseline.retentionScore != null || current.retentionScore != null) {
    const bStr = baseline.retentionScore != null ? baseline.retentionScore.toFixed(2) : "N/A";
    const cStr = current.retentionScore != null ? current.retentionScore.toFixed(2) : "N/A";
    const delta = baseline.retentionScore != null && current.retentionScore != null
      ? formatDelta(current.retentionScore - baseline.retentionScore)
      : "—";
    lines.push(padRow("Retention score", bStr, cStr, delta));
  }
```

Also extract the delta formatting into a helper (add before `padRow`):

```typescript
function formatDelta(delta: number): string {
  if (Math.abs(delta) < 0.005) return "=";
  const arrow = delta > 0 ? "↑" : "↓";
  return `${arrow}${Math.abs(delta).toFixed(2)}`;
}
```

And refactor the existing Jaccard delta to use it — replace lines 136-144:

```typescript
  // Jaccard distance
  const jDelta = current.jaccardDistance - baseline.jaccardDistance;
  lines.push(
    padRow(
      "Jaccard distance",
      baseline.jaccardDistance.toFixed(2),
      current.jaccardDistance.toFixed(2),
      formatDelta(jDelta),
    ),
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make -f dev.mk test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add test/eval/helpers/metrics.ts test/eval/helpers/metrics.test.ts
git commit -m "feat(eval): extend comparison table with entropy and retention rows"
```

---

### Task 6: Extend Baseline interface and compareBaseline

**Files:**
- Modify: `test/eval/helpers/baseline.ts`

- [ ] **Step 1: Add optional fields to `Baseline` interface**

In `test/eval/helpers/baseline.ts`, add the import at the top:

```typescript
import type { EntropyResult, RetentionResult } from "./metrics.js";
```

Extend the `Baseline` interface (after `dimensionCoverage`, before `configPaths`):

```typescript
  readonly shannonEntropy?: EntropyResult;
  readonly retentionScore?: RetentionResult;
```

- [ ] **Step 2: Update `compareBaseline` to pass new metrics through**

In the `compareBaseline` function, update the `baselineMetrics` construction (around line 99-103):

```typescript
  const baselineMetrics: ComparisonMetrics = {
    jaccardDistance: baseline.jaccardDistance,
    dimensionCoverage: baseline.dimensionCoverage,
    model: baseline.model,
    shannonEntropy: baseline.shannonEntropy?.mean,
    retentionScore: baseline.retentionScore?.overall,
  };
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `make -f dev.mk test`
Expected: All tests PASS (no behavioral change yet — just interface extension)

- [ ] **Step 4: Commit**

```bash
git add test/eval/helpers/baseline.ts
git commit -m "feat(eval): extend Baseline with entropy and retention fields"
```

---

## Chunk 4: Wire Into Eval Tests

### Task 7: Wire Shannon entropy into diversity test

**Files:**
- Modify: `test/eval/diversity.test.ts`

- [ ] **Step 1: Add import**

Add `computeShannonEntropy` to the imports from `./helpers/metrics.js`:

```typescript
import { extractDimensionNames, computeWordPairwiseJaccard, computeShannonEntropy } from "./helpers/metrics.js";
```

- [ ] **Step 2: Compute and log entropy after word Jaccard**

Add after the word distance logging (after line 91, before the metamorphic assertion comment):

```typescript
      // Compute Shannon entropy (MIMIC-style, n=1,2,3)
      const diverseEntropy = computeShannonEntropy(
        diversePlanSet.plans.map((p) => p.content),
      );
      const homoEntropy = computeShannonEntropy(
        homoPlanSet.plans.map((p) => p.content),
      );

      console.log(
        `[diversity] Shannon entropy — diverse: ${diverseEntropy.mean.toFixed(4)}, homo: ${homoEntropy.mean.toFixed(4)}`,
      );
```

- [ ] **Step 3: Store entropy in baseline when saving**

In the `Baseline` object construction (around line 129-143), add after `dimensionCoverage: dimCoverage,`:

```typescript
            shannonEntropy: diverseEntropy,
```

- [ ] **Step 4: Pass entropy to compareBaseline**

In the `compareBaseline` call (around line 154-158), add to the metrics object:

```typescript
          const table = await compareBaseline(compareBaselineName, {
            jaccardDistance: diverseWordDistance,
            dimensionCoverage: dimCoverage,
            model: genConfig.model,
            shannonEntropy: diverseEntropy.mean,
          });
```

- [ ] **Step 5: Run static checks**

Run: `make -f dev.mk check`
Expected: PASS (build + lint + unit tests)

- [ ] **Step 6: Commit**

```bash
git add test/eval/diversity.test.ts
git commit -m "feat(eval): wire Shannon entropy into diversity test"
```

---

### Task 8: Wire retention score into coverage test

**Files:**
- Modify: `test/eval/coverage.test.ts`

- [ ] **Step 1: Add import**

Add `computeRetentionScore` to the imports from `./helpers/metrics.js`:

```typescript
import {
  extractDimensionNames,
  checkDimensionCoverage,
  computeRetentionScore,
} from "./helpers/metrics.js";
```

- [ ] **Step 2: Compute and log retention after dimension coverage**

Add after the Jaccard distance logging (after line 73, before the baseline save/compare block):

```typescript
      // Compute content retention
      const retention = computeRetentionScore(
        result.planSet.plans.map((p) => ({ name: p.variant.name, content: p.content })),
        mergedContent,
      );

      console.log(`[coverage] Retention — overall: ${retention.overall.toFixed(4)}`);
      for (const [variant, score] of Object.entries(retention.perVariant)) {
        console.log(`  ${variant}: ${score.toFixed(4)}`);
      }
      console.log(`[coverage] Lost words: ${retention.lost.length}, Retained: ${retention.retained.length}`);
```

- [ ] **Step 3: Store retention in baseline when saving**

In the `Baseline` object construction (around line 80-94), add after `dimensionCoverage: coverage,`:

```typescript
          retentionScore: retention,
```

- [ ] **Step 4: Pass retention to compareBaseline**

In the `compareBaseline` call (around line 109-113), add to the metrics object:

```typescript
        const table = await compareBaseline(compareBaselineName, {
          jaccardDistance,
          dimensionCoverage: coverage,
          model: genConfig.model,
          retentionScore: retention.overall,
        });
```

- [ ] **Step 5: Run full check**

Run: `make -f dev.mk check`
Expected: PASS (build + lint + all unit tests)

- [ ] **Step 6: Commit**

```bash
git add test/eval/coverage.test.ts
git commit -m "feat(eval): wire content retention into coverage test"
```

---

## Post-Implementation

- [ ] **Run `make -f dev.mk check`** — all 209+ unit tests pass, no lint errors, build clean
- [ ] **Save initial baseline with grounded metrics:** `make -f dev.mk eval-save NAME=baseline-with-grounded-metrics`
