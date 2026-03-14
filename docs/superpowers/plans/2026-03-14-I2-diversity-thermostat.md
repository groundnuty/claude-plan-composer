# I2 — Diversity Thermostat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Shannon entropy + Jaccard distance into the pipeline as a runtime diversity measurement with configurable low-diversity warning.

**Architecture:** Pure `measureDiversity()` function computes a composite score from heading-level Jaccard distance and normalized Shannon entropy. Pipeline orchestrator calls it after `writePlanSet()`, logs results to NDJSON, fires `onStatusMessage` callback, and writes `diversity.json` artifact. Measurement-only — no behavioral change to generation, evaluation, or merge.

**Tech Stack:** TypeScript (ESM-only, `.js` import extensions), Zod 4 schemas, Vitest

**Spec:** `docs/superpowers/specs/2026-03-14-I2-diversity-thermostat-design.md`

---

## Chunk 1: Entropy Extraction + Diversity Types

### Task 1: Extract Entropy Functions to `src/evaluate/entropy.ts`

**Files:**
- Create: `src/evaluate/entropy.ts`
- Create: `test/evaluate/entropy.test.ts`

This task extracts `computeShannonEntropy()` and `extractOrderedWords()` from the test helper at `test/eval/helpers/metrics.ts` into production source code, and adds a new `computeNormalizedEntropy()` function.

- [ ] **Step 1: Write the failing test for `computeShannonEntropy` extraction**

Create `test/evaluate/entropy.test.ts` with tests that import from `src/evaluate/entropy.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  computeShannonEntropy,
  extractOrderedWords,
  computeNormalizedEntropy,
} from "../../src/evaluate/entropy.js";
import type { EntropyResult } from "../../src/evaluate/entropy.js";

describe("extractOrderedWords", () => {
  it("extracts lowercased words ≥4 chars preserving order and duplicates", () => {
    const words = extractOrderedWords("The quick Brown Fox quick Fox");
    expect(words).toEqual(["quick", "brown", "quick"]);
  });

  it("returns empty array for text with no significant words", () => {
    expect(extractOrderedWords("a b c")).toEqual([]);
  });
});

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

  it("computes entropy for uniform distribution", () => {
    // 4 unique unigrams, each appearing once → H = log2(4) = 2.0
    const result = computeShannonEntropy(["alpha beta gamma delta"], [1]);
    expect(result.perNgram["1"]).toBeCloseTo(2.0, 5);
    expect(result.mean).toBeCloseTo(2.0, 5);
  });

  it("uses string keys for JSON compatibility", () => {
    const result = computeShannonEntropy(["alpha beta gamma delta"], [1, 2]);
    expect(Object.keys(result.perNgram)).toEqual(["1", "2"]);
  });

  it("computes lower entropy for skewed distribution", () => {
    const result = computeShannonEntropy(
      ["alpha alpha alpha alpha beta"],
      [1],
    );
    expect(result.perNgram["1"]).toBeLessThan(1.0);
    expect(result.perNgram["1"]).toBeGreaterThan(0);
  });

  it("defaults to n-gram sizes [1, 2, 3]", () => {
    const result = computeShannonEntropy(["alpha beta gamma delta epsilon"]);
    expect(Object.keys(result.perNgram).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("computeNormalizedEntropy", () => {
  it("returns zero for empty input", () => {
    const result = computeNormalizedEntropy([]);
    expect(result.mean).toBe(0);
    expect(result.perNgram).toEqual({});
  });

  it("returns 1 for perfectly uniform distribution", () => {
    // 4 unique unigrams, each appearing once → H = log2(4) / log2(4) = 1.0
    const result = computeNormalizedEntropy(["alpha beta gamma delta"], [1]);
    expect(result.perNgram["1"]).toBeCloseTo(1.0, 5);
  });

  it("returns value < 1 for skewed distribution", () => {
    const result = computeNormalizedEntropy(
      ["alpha alpha alpha alpha beta"],
      [1],
    );
    expect(result.perNgram["1"]).toBeLessThan(1.0);
    expect(result.perNgram["1"]).toBeGreaterThan(0);
  });

  it("returns 0 when V <= 1 (single unique n-gram)", () => {
    const result = computeNormalizedEntropy(["alpha alpha alpha alpha"], [1]);
    expect(result.perNgram["1"]).toBe(0);
  });

  it("computes mean across n-gram sizes", () => {
    const result = computeNormalizedEntropy(
      ["alpha beta gamma delta epsilon"],
      [1, 2, 3],
    );
    const values = Object.values(result.perNgram);
    const expectedMean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(result.mean).toBeCloseTo(expectedMean, 10);
  });

  it("all values are in [0, 1]", () => {
    const result = computeNormalizedEntropy(
      ["alpha beta gamma delta epsilon zeta eta theta"],
      [1, 2, 3],
    );
    for (const v of Object.values(result.perNgram)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(result.mean).toBeGreaterThanOrEqual(0);
    expect(result.mean).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -f dev.mk test -- --reporter=verbose test/evaluate/entropy.test.ts`
Expected: FAIL — module `../../src/evaluate/entropy.js` does not exist

- [ ] **Step 3: Implement `src/evaluate/entropy.ts`**

Create `src/evaluate/entropy.ts` by extracting from `test/eval/helpers/metrics.ts:65-130`:

```typescript
export interface EntropyResult {
  readonly perNgram: Readonly<Record<string, number>>;
  readonly mean: number;
}

/**
 * Extract ordered array of significant words from text.
 *
 * Words are lowercased, alphanumeric only, ≥4 chars. Order and duplicates
 * preserved (needed for n-gram construction).
 */
export function extractOrderedWords(text: string): readonly string[] {
  return Array.from(
    text.toLowerCase().matchAll(/[a-z][a-z0-9]{3,}/g),
    (m) => m[0],
  );
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
 * Keys in `perNgram` are strings (not numbers) for JSON serialization.
 */
export function computeShannonEntropy(
  texts: readonly string[],
  ngramSizes: readonly number[] = [1, 2, 3],
): EntropyResult {
  const allWords = texts.flatMap(extractOrderedWords);
  if (allWords.length === 0 || ngramSizes.length === 0) {
    return { perNgram: {}, mean: 0 };
  }

  const perNgram: Record<string, number> = {};

  for (const n of ngramSizes) {
    const freq = new Map<string, number>();
    let total = 0;

    for (let i = 0; i <= allWords.length - n; i++) {
      const ngram = allWords.slice(i, i + n).join(" ");
      freq.set(ngram, (freq.get(ngram) ?? 0) + 1);
      total++;
    }

    if (total === 0) {
      perNgram[String(n)] = 0;
      continue;
    }

    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    perNgram[String(n)] = entropy;
  }

  const values = Object.values(perNgram);
  const mean =
    values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  return { perNgram, mean };
}

/**
 * Compute normalized Shannon entropy: H_n / log2(V_n) per n-gram size.
 *
 * Produces values in [0, 1] where 1 = perfectly uniform distribution.
 * When V_n <= 1 (zero or one unique n-gram), normalized value is 0 (no diversity).
 *
 * Scientific basis: Shannon (1948) normalized entropy ("efficiency").
 */
export function computeNormalizedEntropy(
  texts: readonly string[],
  ngramSizes: readonly number[] = [1, 2, 3],
): { readonly perNgram: Readonly<Record<string, number>>; readonly mean: number } {
  const allWords = texts.flatMap(extractOrderedWords);
  if (allWords.length === 0 || ngramSizes.length === 0) {
    return { perNgram: {}, mean: 0 };
  }

  const perNgram: Record<string, number> = {};

  for (const n of ngramSizes) {
    const freq = new Map<string, number>();
    let total = 0;

    for (let i = 0; i <= allWords.length - n; i++) {
      const ngram = allWords.slice(i, i + n).join(" ");
      freq.set(ngram, (freq.get(ngram) ?? 0) + 1);
      total++;
    }

    const V = freq.size;
    if (total === 0 || V <= 1) {
      perNgram[String(n)] = 0;
      continue;
    }

    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    perNgram[String(n)] = entropy / Math.log2(V);
  }

  const values = Object.values(perNgram);
  const mean =
    values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  return { perNgram, mean };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make -f dev.mk test -- --reporter=verbose test/evaluate/entropy.test.ts`
Expected: PASS — all 12 tests green

- [ ] **Step 5: Commit**

```bash
git add src/evaluate/entropy.ts test/evaluate/entropy.test.ts
git commit -m "feat(evaluate): extract entropy functions to src/evaluate/entropy.ts

Extract computeShannonEntropy and extractOrderedWords from test helpers
into production code. Add computeNormalizedEntropy (H/log2(V)) for
diversity composite scoring. Use string keys in perNgram for JSON compat."
```

---

### Task 2: Wire Test Helper Re-exports

**Files:**
- Modify: `test/eval/helpers/metrics.ts:65-130`
- Test: `test/eval/helpers/metrics.test.ts` (existing — must continue passing)

Replace the `computeShannonEntropy` and `EntropyResult` implementations in the test helper with re-exports from `src/evaluate/entropy.ts`.

- [ ] **Step 1: Modify test helper to re-export from src**

In `test/eval/helpers/metrics.ts`, replace lines 65-130 (the `EntropyResult` interface, `extractOrderedWords` function, and `computeShannonEntropy` function) with re-exports:

```typescript
// Re-export entropy functions from src (extracted in I2)
export type { EntropyResult } from "../../../src/evaluate/entropy.js";
export { computeShannonEntropy } from "../../../src/evaluate/entropy.js";
```

Keep the `extractOrderedWords` removal — it was never exported from the test helper, so nothing depends on it.

The test helper retains its own functions: `extractAllHeadings`, `extractDimensionNames`, `checkDimensionCoverage`, `extractSignificantWords`, `computeRetentionScore`, `computeWordPairwiseJaccard`, `formatComparisonTable`.

**Important:** The existing test helper uses `Record<number, number>` for `EntropyResult.perNgram`. The new type uses `Record<string, number>`. JavaScript coerces numeric keys to strings automatically, so all existing tests in `test/eval/helpers/metrics.test.ts` continue to pass. However, tests that access `result.perNgram[1]` (numeric key) will still work because JavaScript property access with numbers coerces to string.

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `make -f dev.mk test -- --reporter=verbose test/eval/helpers/metrics.test.ts`
Expected: PASS — all 34 existing tests green (no changes to test file)

- [ ] **Step 3: Commit**

```bash
git add test/eval/helpers/metrics.ts
git commit -m "refactor(test): re-export entropy from src/evaluate/entropy.ts

Replace test helper implementation of computeShannonEntropy and
EntropyResult with re-exports from src. All 34 existing tests pass
unchanged (JS coerces numeric keys to strings)."
```

---

### Task 3: Create `DiversityResultSchema` in `src/types/diversity.ts`

**Files:**
- Create: `src/types/diversity.ts`
- Create: `test/types/diversity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/types/diversity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DiversityResultSchema } from "../../src/types/diversity.js";
import type { DiversityResult } from "../../src/types/diversity.js";

describe("DiversityResultSchema", () => {
  const validBase: DiversityResult = {
    jaccardDistance: 0.45,
    shannonEntropy: {
      perNgram: { "1": 3.2, "2": 2.8, "3": 2.1 },
      mean: 2.7,
    },
    normalizedEntropy: 0.72,
    compositeScore: 0.585,
  };

  it("accepts a valid DiversityResult without warning", () => {
    const result = DiversityResultSchema.parse(validBase);
    expect(result.compositeScore).toBe(0.585);
    expect(result.warning).toBeUndefined();
  });

  it("accepts a valid DiversityResult with warning", () => {
    const result = DiversityResultSchema.parse({
      ...validBase,
      compositeScore: 0.15,
      warning: "Low diversity detected",
    });
    expect(result.warning).toBe("Low diversity detected");
  });

  it("rejects jaccardDistance < 0", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, jaccardDistance: -0.1 }),
    ).toThrow();
  });

  it("rejects jaccardDistance > 1", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, jaccardDistance: 1.1 }),
    ).toThrow();
  });

  it("rejects normalizedEntropy < 0", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, normalizedEntropy: -0.1 }),
    ).toThrow();
  });

  it("rejects normalizedEntropy > 1", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, normalizedEntropy: 1.1 }),
    ).toThrow();
  });

  it("rejects compositeScore < 0", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, compositeScore: -0.1 }),
    ).toThrow();
  });

  it("rejects compositeScore > 1", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, compositeScore: 1.1 }),
    ).toThrow();
  });

  it("accepts boundary values (0 and 1)", () => {
    const result = DiversityResultSchema.parse({
      ...validBase,
      jaccardDistance: 0,
      normalizedEntropy: 1,
      compositeScore: 0.5,
    });
    expect(result.jaccardDistance).toBe(0);
    expect(result.normalizedEntropy).toBe(1);
  });

  it("accepts empty perNgram record", () => {
    const result = DiversityResultSchema.parse({
      ...validBase,
      shannonEntropy: { perNgram: {}, mean: 0 },
    });
    expect(result.shannonEntropy.perNgram).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -f dev.mk test -- --reporter=verbose test/types/diversity.test.ts`
Expected: FAIL — module `../../src/types/diversity.js` does not exist

- [ ] **Step 3: Implement `src/types/diversity.ts`**

```typescript
import { z } from "zod";

export const DiversityResultSchema = z.object({
  jaccardDistance: z.number().min(0).max(1),
  shannonEntropy: z.object({
    perNgram: z.record(z.string(), z.number()),
    mean: z.number(),
  }),
  normalizedEntropy: z.number().min(0).max(1),
  compositeScore: z.number().min(0).max(1),
  warning: z.string().optional(),
});

export type DiversityResult = z.infer<typeof DiversityResultSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make -f dev.mk test -- --reporter=verbose test/types/diversity.test.ts`
Expected: PASS — all 10 tests green

- [ ] **Step 5: Commit**

```bash
git add src/types/diversity.ts test/types/diversity.test.ts
git commit -m "feat(types): add DiversityResultSchema with Zod validation

Composite diversity score from Jaccard distance + normalized Shannon
entropy. Warning field present when score < threshold."
```

---

## Chunk 2: Core Diversity Function

### Task 4: Create `measureDiversity()` in `src/evaluate/diversity.ts`

**Files:**
- Create: `src/evaluate/diversity.ts`
- Create: `test/evaluate/diversity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/evaluate/diversity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { measureDiversity } from "../../src/evaluate/diversity.js";
import type { Plan } from "../../src/types/plan.js";
import type { DiversityResult } from "../../src/types/diversity.js";

function makePlan(name: string, content: string): Plan {
  return {
    variant: { name, guidance: "" },
    content,
    metadata: {
      model: "test",
      turns: 0,
      durationMs: 0,
      durationApiMs: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0,
      },
      costUsd: 0,
      stopReason: null,
      sessionId: "",
    },
  };
}

describe("measureDiversity", () => {
  it("returns zero scores and warning for fewer than 2 plans", () => {
    const result = measureDiversity([makePlan("a", "content")], 0.3);
    expect(result.jaccardDistance).toBe(0);
    expect(result.normalizedEntropy).toBe(0);
    expect(result.compositeScore).toBe(0);
    expect(result.warning).toBeDefined();
  });

  it("returns zero scores for empty plan list", () => {
    const result = measureDiversity([], 0.3);
    expect(result.compositeScore).toBe(0);
    expect(result.warning).toBeDefined();
  });

  it("computes composite as mean of jaccard distance and normalized entropy", () => {
    const plans = [
      makePlan("a", "## Architecture\n## Design\nalpha beta gamma delta"),
      makePlan("b", "## Testing\n## Deployment\nepsilon zeta eta theta"),
    ];
    const result = measureDiversity(plans, 0.0);
    // jaccardDistance = 1 - similarity. Different headings → similarity near 0 → distance near 1
    expect(result.jaccardDistance).toBeGreaterThan(0);
    expect(result.normalizedEntropy).toBeGreaterThan(0);
    expect(result.compositeScore).toBeCloseTo(
      (result.jaccardDistance + result.normalizedEntropy) / 2,
      10,
    );
    expect(result.warning).toBeUndefined();
  });

  it("fires warning when composite < threshold", () => {
    // Identical plans → low diversity
    const plans = [
      makePlan("a", "## Architecture\nalpha beta gamma"),
      makePlan("b", "## Architecture\nalpha beta gamma"),
    ];
    const result = measureDiversity(plans, 0.5);
    expect(result.compositeScore).toBeLessThan(0.5);
    expect(result.warning).toContain("Low diversity detected");
    expect(result.warning).toContain("threshold: 0.5");
  });

  it("does not fire warning when composite >= threshold", () => {
    const plans = [
      makePlan("a", "## Architecture\n## Design\nalpha beta gamma delta"),
      makePlan("b", "## Testing\n## Deployment\nepsilon zeta eta theta"),
    ];
    const result = measureDiversity(plans, 0.0);
    expect(result.warning).toBeUndefined();
  });

  it("stores raw Shannon entropy alongside normalized", () => {
    const plans = [
      makePlan("a", "alpha beta gamma delta epsilon"),
      makePlan("b", "zeta eta theta iota kappa"),
    ];
    const result = measureDiversity(plans, 0.0);
    expect(result.shannonEntropy.mean).toBeGreaterThan(0);
    expect(Object.keys(result.shannonEntropy.perNgram).length).toBeGreaterThan(0);
  });

  it("handles empty plan content gracefully", () => {
    const plans = [makePlan("a", ""), makePlan("b", "")];
    const result = measureDiversity(plans, 0.3);
    expect(result.jaccardDistance).toBe(0);
    expect(result.normalizedEntropy).toBe(0);
    expect(result.compositeScore).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -f dev.mk test -- --reporter=verbose test/evaluate/diversity.test.ts`
Expected: FAIL — module `../../src/evaluate/diversity.js` does not exist

- [ ] **Step 3: Implement `src/evaluate/diversity.ts`**

```typescript
import type { Plan } from "../types/plan.js";
import type { DiversityResult } from "../types/diversity.js";
import { computePairwiseJaccard } from "./jaccard.js";
import {
  computeShannonEntropy,
  computeNormalizedEntropy,
} from "./entropy.js";

/**
 * Measure diversity of generated plan variants.
 *
 * Computes a composite score from heading-level Jaccard distance
 * and normalized Shannon entropy. Pure computation — no side effects.
 *
 * @param plans - Generated plan variants
 * @param threshold - Composite score below which a warning is emitted
 * @returns DiversityResult with scores and optional warning
 */
export function measureDiversity(
  plans: readonly Plan[],
  threshold: number,
): DiversityResult {
  if (plans.length < 2) {
    return {
      jaccardDistance: 0,
      shannonEntropy: { perNgram: {}, mean: 0 },
      normalizedEntropy: 0,
      compositeScore: 0,
      warning:
        "Cannot measure diversity with fewer than 2 plans",
    };
  }

  // Heading-level Jaccard: 1 - similarity = distance
  const jaccard = computePairwiseJaccard(plans);
  const jaccardDistance = 1 - jaccard.mean;

  // Raw Shannon entropy (backward compat with eval baselines)
  const contents = plans.map((p) => p.content);
  const shannonEntropy = computeShannonEntropy(contents);

  // Normalized entropy → [0, 1]
  const normalized = computeNormalizedEntropy(contents);
  const normalizedEntropy = normalized.mean;

  // Composite: equal-weight mean of two complementary signals
  const compositeScore = (jaccardDistance + normalizedEntropy) / 2;

  const warning =
    compositeScore < threshold
      ? `Low diversity detected (score: ${compositeScore.toFixed(2)}, threshold: ${threshold}). Consider adjusting lenses or variant guidance.`
      : undefined;

  return {
    jaccardDistance,
    shannonEntropy: {
      perNgram: shannonEntropy.perNgram,
      mean: shannonEntropy.mean,
    },
    normalizedEntropy,
    compositeScore,
    ...(warning !== undefined ? { warning } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make -f dev.mk test -- --reporter=verbose test/evaluate/diversity.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 5: Commit**

```bash
git add src/evaluate/diversity.ts test/evaluate/diversity.test.ts
git commit -m "feat(evaluate): add measureDiversity() pure computation function

Computes composite diversity score from heading-level Jaccard distance
and normalized Shannon entropy. Warns when score < threshold."
```

---

## Chunk 3: Pipeline Integration + Config

### Task 5: Add `diversityThreshold` to `GenerateConfigSchema`

**Files:**
- Modify: `src/types/config.ts:10-52`

- [ ] **Step 1: Add `diversityThreshold` field to `GenerateConfigSchema`**

In `src/types/config.ts`, add at the end of the `GenerateConfigSchema` fields (after `minOutputBytes` at line 51, before the closing `});` at line 52):

```typescript
  diversityThreshold: z.number().min(0).max(1).default(0.30),
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `make -f dev.mk test -- --reporter=verbose`
Expected: PASS — all existing tests green (new field has default, so no existing code breaks)

- [ ] **Step 3: Commit**

```bash
git add src/types/config.ts
git commit -m "feat(config): add diversityThreshold to GenerateConfigSchema

Default 0.30 catches pathological near-duplicates. Set to 0 to disable
diversity warnings."
```

---

### Task 6: Add I/O Functions and `PipelineResult.diversityResult`

**Files:**
- Modify: `src/pipeline/io.ts`
- Modify: `src/types/pipeline.ts`
- Test: existing pipeline tests

- [ ] **Step 1: Add `diversityResult` to `PipelineResult`**

In `src/types/pipeline.ts`, add the import and field. Modify the existing import line at line 4 to include `DiversityResult`:

Add import at line 1 (before the existing `PlanSet` import):
```typescript
import type { DiversityResult } from "./diversity.js";
```

Add field to `PipelineResult` interface (after `verifyResult` at line 15):
```typescript
  readonly diversityResult?: DiversityResult;
```

- [ ] **Step 2: Add `writeDiversityResult` and `readDiversityResult` to `src/pipeline/io.ts`**

Add import at the top of `src/pipeline/io.ts` (after the existing `PreMortemResult` import at line 7):
```typescript
import type { DiversityResult } from "../types/diversity.js";
```

Add at the end of the file (after `writePreMortemResult` at line 184):

```typescript
/** Write diversity measurement result to disk: diversity.json */
export async function writeDiversityResult(
  result: DiversityResult,
  dir: string,
): Promise<void> {
  await fs.writeFile(
    path.join(dir, "diversity.json"),
    JSON.stringify(result, null, 2),
  );
}

/** Read diversity measurement result from disk, returns undefined if file not found */
export async function readDiversityResult(
  dir: string,
): Promise<DiversityResult | undefined> {
  const filePath = path.join(dir, "diversity.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as DiversityResult;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 3: Write I/O tests**

Add a new `describe` block to `test/pipeline/io.test.ts`. First, add the import at the top (after the existing `writeVerifyResult` import at line 13):

```typescript
import {
  writeDiversityResult,
  readDiversityResult,
} from "../../src/pipeline/io.js";
```

Add these to the existing import block — merge with the existing imports from `../../src/pipeline/io.js` (lines 6-14).

Then add at the end of the file (after the `writeVerifyResult` describe block):

```typescript
describe("writeDiversityResult / readDiversityResult", () => {
  const makeDiversityResult = () => ({
    jaccardDistance: 0.65,
    shannonEntropy: {
      perNgram: { "1": 3.2, "2": 2.8, "3": 2.1 },
      mean: 2.7,
    },
    normalizedEntropy: 0.72,
    compositeScore: 0.685,
  });

  it("writes diversity.json to directory", async () => {
    const result = makeDiversityResult();
    await writeDiversityResult(result, tmpDir);

    const raw = JSON.parse(
      await fs.readFile(path.join(tmpDir, "diversity.json"), "utf-8"),
    );
    expect(raw.compositeScore).toBe(0.685);
    expect(raw.jaccardDistance).toBe(0.65);
    expect(raw.normalizedEntropy).toBe(0.72);
    expect(raw.shannonEntropy.mean).toBe(2.7);
    expect(raw.shannonEntropy.perNgram["1"]).toBe(3.2);
  });

  it("readDiversityResult returns undefined if file does not exist", async () => {
    const result = await readDiversityResult(tmpDir);
    expect(result).toBeUndefined();
  });

  it("readDiversityResult loads existing diversity.json", async () => {
    const diversityResult = makeDiversityResult();
    await writeDiversityResult(diversityResult, tmpDir);

    const loaded = await readDiversityResult(tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded!.compositeScore).toBe(0.685);
    expect(loaded!.jaccardDistance).toBe(0.65);
    expect(loaded!.shannonEntropy.perNgram["2"]).toBe(2.8);
  });

  it("preserves warning field through write/read cycle", async () => {
    const result = {
      ...makeDiversityResult(),
      compositeScore: 0.15,
      warning: "Low diversity detected (score: 0.15, threshold: 0.30)",
    };
    await writeDiversityResult(result, tmpDir);

    const loaded = await readDiversityResult(tmpDir);
    expect(loaded!.warning).toBe(
      "Low diversity detected (score: 0.15, threshold: 0.30)",
    );
  });
});
```

- [ ] **Step 4: Run tests to verify I/O functions work**

Run: `make -f dev.mk test -- --reporter=verbose test/pipeline/io.test.ts`
Expected: PASS — all existing tests + 4 new diversity I/O tests green

- [ ] **Step 5: Commit**

```bash
git add src/types/pipeline.ts src/pipeline/io.ts test/pipeline/io.test.ts
git commit -m "feat(pipeline): add diversity I/O and PipelineResult.diversityResult

Add writeDiversityResult/readDiversityResult to io.ts following existing
pattern. Add diversityResult field to PipelineResult interface.
4 new I/O tests."
```

---

### Task 7: Integrate `measureDiversity()` into Pipeline

**Files:**
- Modify: `src/pipeline/run.ts`

The pipeline orchestrator calls `measureDiversity()` after `writePlanSet()` and before `evaluate()`. It handles NDJSON logging, `onStatusMessage` callback, and writing the `diversity.json` artifact.

- [ ] **Step 1: Add imports to `src/pipeline/run.ts`**

Add after the existing `writeVerifyResult` import (line 13):
```typescript
import { writeDiversityResult } from "./io.js";
```

Add after the existing evaluate import (line 4):
```typescript
import { measureDiversity } from "../evaluate/diversity.js";
```

Add after the existing `PipelineResult` type import (line 15):
```typescript
import type { OnStatusMessage } from "../monitor/types.js";
```

Add after the existing io.ts imports:
```typescript
import { NdjsonLogger } from "./logger.js";
```

- [ ] **Step 2: Add `onStatusMessage` to `RunOptions`**

Add to the `RunOptions` interface (after `signal` at line 23):
```typescript
  readonly onStatusMessage?: OnStatusMessage;
```

- [ ] **Step 3: Insert diversity measurement step into `runPipeline()`**

After the `writePlanSet()` call at line 41 and before the evaluate step at line 43, insert:

```typescript
  // Step 3: Measure diversity (always runs, even with skipEval)
  const diversityResult = measureDiversity(
    planSet.plans,
    genConfig.diversityThreshold,
  );
  await writeDiversityResult(diversityResult, planSet.runDir);

  // Log diversity metrics to NDJSON (spec: { type: "diversity", ...result })
  const diversityLogger = new NdjsonLogger(
    `${planSet.runDir}/diversity.ndjson`,
  );
  await diversityLogger.write({ type: "diversity", ...diversityResult });
  await diversityLogger.close();

  if (diversityResult.warning) {
    options.onStatusMessage?.("diversity", {
      type: "diversity_warning",
      message: diversityResult.warning,
    });
  }
```

Update the step numbering comments for the subsequent steps (evaluate becomes Step 4, merge becomes Step 5, etc.).

- [ ] **Step 4: Add `diversityResult` to the return value**

Modify the return statement at line 69 to include `diversityResult`:

```typescript
  return { planSet, mergeResult, evalResult, verifyResult, diversityResult };
```

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `make -f dev.mk test -- --reporter=verbose`
Expected: PASS — all existing tests green

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/run.ts
git commit -m "feat(pipeline): integrate measureDiversity() after writePlanSet()

Measure diversity always runs (not gated by skipEval). Results written
to diversity.json artifact. Warning fires via onStatusMessage callback
when composite score < diversityThreshold."
```

---

## Chunk 4: Barrel Exports + CI Verification

### Task 8: Wire Barrel Exports

**Files:**
- Modify: `src/evaluate/index.ts`
- Modify: `src/types/index.ts`
- Modify: `src/pipeline/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add re-exports to `src/evaluate/index.ts`**

Add at the end of `src/evaluate/index.ts` (after the existing code at line 102):

```typescript
// Entropy (extracted from test helpers in I2)
export {
  computeShannonEntropy,
  extractOrderedWords,
  computeNormalizedEntropy,
} from "./entropy.js";
export type { EntropyResult } from "./entropy.js";

// Diversity measurement
export { measureDiversity } from "./diversity.js";
```

- [ ] **Step 2: Add re-export to `src/types/index.ts`**

Add after the `evaluation.js` re-exports block (after line 29):

```typescript
export type { DiversityResult } from "./diversity.js";
```

- [ ] **Step 3: Add re-exports to `src/pipeline/index.ts`**

Add `writeDiversityResult` and `readDiversityResult` to the existing io.ts export block (line 1-10). Modify the export statement to include them:

```typescript
export {
  writePlanSet,
  readPlanSet,
  writeMergeResult,
  loadMcpConfig,
  writeEvalResult,
  readEvalResult,
  writeVerifyResult,
  writePreMortemResult,
  writeDiversityResult,
  readDiversityResult,
} from "./io.js";
```

- [ ] **Step 4: Add re-exports to `src/index.ts`**

Add `DiversityResult` to the types block (after `PipelineResult` at line 19):

```typescript
  // Add to the existing type export block:
  DiversityResult,
```

Add diversity-related exports. After the `JaccardPair` type export at line 93:

```typescript
export {
  computeShannonEntropy,
  extractOrderedWords,
  computeNormalizedEntropy,
} from "./evaluate/entropy.js";
export type { EntropyResult } from "./evaluate/entropy.js";
export { measureDiversity } from "./evaluate/diversity.js";
```

Add `DiversityResultSchema` as a direct export from types (matches existing schema export pattern). After the `MergeFormalResultSchema` export block at line 52:

```typescript
// Diversity types
export { DiversityResultSchema } from "./types/diversity.js";
```

Add `writeDiversityResult` and `readDiversityResult` to the pipeline utilities block. Modify the export from `./pipeline/index.js` (lines 63-75) to include:

```typescript
  writeDiversityResult,
  readDiversityResult,
```

- [ ] **Step 5: Run build + lint to verify exports compile**

Run: `make -f dev.mk check`
Expected: PASS — build, lint, and all tests green

- [ ] **Step 6: Commit**

```bash
git add src/evaluate/index.ts src/types/index.ts src/pipeline/index.ts src/index.ts
git commit -m "feat: wire diversity thermostat barrel exports

Export DiversityResultSchema, DiversityResult, measureDiversity,
entropy functions, and diversity I/O through all barrel files."
```

---

### Task 9: Full CI + Eval Gate Verification

- [ ] **Step 1: Run full CI**

Run: `make -f dev.mk check`
Expected: PASS — build + lint + all tests (including 34 existing eval helper tests)

- [ ] **Step 2: Run eval comparison (regression gate)**

Run: `make -f dev.mk eval-compare`
Expected: No regression — measurement-only change, no behavioral difference

- [ ] **Step 3: Verify test count increased**

Run: `make -f dev.mk test -- --reporter=verbose 2>&1 | tail -5`
Expected: Test count should have increased by ~33 tests (12 entropy + 10 diversity type + 7 measureDiversity + 4 diversity I/O)

---

## Files Changed Summary

| File | Change |
|---|---|
| `src/evaluate/entropy.ts` | **Create:** `computeShannonEntropy`, `extractOrderedWords`, `computeNormalizedEntropy` |
| `src/types/diversity.ts` | **Create:** `DiversityResultSchema` + `DiversityResult` type |
| `src/evaluate/diversity.ts` | **Create:** `measureDiversity()` pure computation |
| `src/types/config.ts` | **Modify:** add `diversityThreshold` field (default 0.30) |
| `src/types/pipeline.ts` | **Modify:** add `diversityResult?: DiversityResult` to `PipelineResult` |
| `src/pipeline/io.ts` | **Modify:** add `writeDiversityResult()` / `readDiversityResult()` |
| `src/pipeline/run.ts` | **Modify:** call `measureDiversity()`, log, callback, write artifact |
| `src/evaluate/index.ts` | **Modify:** re-export entropy + diversity |
| `src/types/index.ts` | **Modify:** re-export `DiversityResult` |
| `src/pipeline/index.ts` | **Modify:** re-export diversity I/O functions |
| `src/index.ts` | **Modify:** barrel exports for all new public API |
| `test/evaluate/entropy.test.ts` | **Create:** 12 tests for extracted entropy + normalized entropy |
| `test/types/diversity.test.ts` | **Create:** 10 tests for Zod schema validation |
| `test/evaluate/diversity.test.ts` | **Create:** 7 tests for `measureDiversity()` |
| `test/pipeline/io.test.ts` | **Modify:** add 4 tests for `writeDiversityResult`/`readDiversityResult` |
| `test/eval/helpers/metrics.ts` | **Modify:** replace entropy impl with re-exports |
