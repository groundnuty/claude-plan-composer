# I9 — Formalized Merge Operations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TypeScript types mirroring formal Definitions 1-6 from EditFusion/BSM papers, providing foundation types for I11, I15, and I7.

**Architecture:** Single new file `src/types/merge-formal.ts` containing Zod schemas with `z.infer<>` derived types (project convention). JSDoc documents the scientific definitions each type mirrors. Types exported through existing barrel files. No existing code modified.

**Tech Stack:** TypeScript, Zod v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-I9-formalized-merge-ops-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/types/merge-formal.ts` | Create | All formal Zod schemas + inferred types + JSDoc for Definitions 1, 3, 6 |
| `src/types/index.ts` | Modify | Re-export new types from `merge-formal.ts` |
| `src/index.ts` | Modify | Add new types + schemas to public API barrel |
| `test/types/merge-formal.test.ts` | Create | Zod schema validation tests (accept valid, reject invalid, edge cases) |

---

## Chunk 1: Schemas, Types, Tests, and Exports

### Task 1: DisagreementType and Recommendation — Tests and Implementation

**Files:**
- Create: `test/types/merge-formal.test.ts`
- Create: `src/types/merge-formal.ts`

- [ ] **Step 1: Write failing tests for DisagreementTypeSchema and RecommendationSchema**

Create `test/types/merge-formal.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  DisagreementTypeSchema,
  RecommendationSchema,
} from "../../src/types/merge-formal.js";

describe("DisagreementTypeSchema", () => {
  it("accepts all four valid values", () => {
    for (const value of ["complementary", "trade-off", "arbitrary", "uncontested"]) {
      expect(DisagreementTypeSchema.parse(value)).toBe(value);
    }
  });

  it("rejects invalid values", () => {
    expect(() => DisagreementTypeSchema.parse("unknown")).toThrow();
    expect(() => DisagreementTypeSchema.parse("")).toThrow();
    expect(() => DisagreementTypeSchema.parse(42)).toThrow();
  });
});

describe("RecommendationSchema", () => {
  const valid = {
    topic: "caching strategy",
    position: "use Redis",
    evidence: "proven in high-throughput systems",
    confidence: 0.85,
  };

  it("accepts a valid recommendation", () => {
    const result = RecommendationSchema.parse(valid);
    expect(result.topic).toBe("caching strategy");
    expect(result.position).toBe("use Redis");
    expect(result.evidence).toBe("proven in high-throughput systems");
    expect(result.confidence).toBe(0.85);
  });

  it("accepts zero confidence", () => {
    expect(RecommendationSchema.parse({ ...valid, confidence: 0 }).confidence).toBe(0);
  });

  it("accepts max confidence of 1", () => {
    expect(RecommendationSchema.parse({ ...valid, confidence: 1 }).confidence).toBe(1);
  });

  it("accepts empty evidence string", () => {
    expect(RecommendationSchema.parse({ ...valid, evidence: "" }).evidence).toBe("");
  });

  it("rejects empty topic", () => {
    expect(() => RecommendationSchema.parse({ ...valid, topic: "" })).toThrow();
  });

  it("rejects empty position", () => {
    expect(() => RecommendationSchema.parse({ ...valid, position: "" })).toThrow();
  });

  it("rejects confidence below 0", () => {
    expect(() => RecommendationSchema.parse({ ...valid, confidence: -0.1 })).toThrow();
  });

  it("rejects confidence above 1", () => {
    expect(() => RecommendationSchema.parse({ ...valid, confidence: 1.1 })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => RecommendationSchema.parse({ topic: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/types/merge-formal.test.ts`
Expected: FAIL — cannot find module `../../src/types/merge-formal.js`

- [ ] **Step 3: Implement DisagreementTypeSchema and RecommendationSchema**

Create `src/types/merge-formal.ts`:

```typescript
/**
 * Formal merge operation types — EditFusion (Wang et al., ASE 2025 RT) §3
 * and BSM (Saha et al., NAACL 2024) §2.
 *
 * These types mirror Definitions 1-6 from the scientific specification.
 * They live alongside existing merge types (ConflictClass, ComparisonEntry)
 * and will be consumed by I11 (two-stage merge), I15 (per-type strategies),
 * and I7 (atomic decomposition).
 *
 * @module merge-formal
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Definition 1 — Plan
// ---------------------------------------------------------------------------
/**
 * Definition 1 (Plan): An ordered set of sections S = {s₁, s₂, …, sₙ}.
 *
 * The existing `Plan` interface in `plan.ts` represents plans as
 * `content: string` (raw markdown). Section decomposition into an ordered
 * set will be performed at runtime by LLM extraction in I7/I11.
 * No additional `Section` type is needed here.
 */

// ---------------------------------------------------------------------------
// Definition 2 — Recommendation
// ---------------------------------------------------------------------------
/**
 * Definition 2: An atomic design decision within a plan section.
 *
 * A recommendation captures a specific stance on a topic, with supporting
 * evidence and a normalized confidence score. Consumed by I7 (extraction)
 * and I15 (confidence-based selection for arbitrary disagreements).
 */
export const RecommendationSchema = z.object({
  topic: z.string().min(1),
  position: z.string().min(1),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

// ---------------------------------------------------------------------------
// Definition 3 — Quality Dimension
// ---------------------------------------------------------------------------
/**
 * Definition 3 (Quality Dimension): A named evaluation axis Q = {q₁, q₂, …, qₘ}
 * along which plans are compared.
 *
 * Quality dimensions are an algorithmic concept — the merge process iterates
 * over configured dimensions (from `MergeConfig.dimensions`) and analyzes
 * recommendations within each. No dedicated type is needed; the existing
 * `DimensionSchema` in `config.ts` already captures dimension configuration.
 */

// ---------------------------------------------------------------------------
// Definition 4 — Disagreement
// ---------------------------------------------------------------------------
/**
 * EditFusion §4.1 Table 2 — four categories of disagreement between
 * recommendations addressing the same topic.
 *
 * Maps to resolution strategies from Definition 5:
 * - `complementary` → union (include both recommendations)
 * - `trade-off` → argumentative synthesis (analyze trade-offs, synthesize)
 * - `arbitrary` → selection (pick better-argued by confidence)
 * - `uncontested` → adopt (only one variant addresses the topic)
 */
export const DisagreementTypeSchema = z.enum([
  "complementary",
  "trade-off",
  "arbitrary",
  "uncontested",
]);

export type DisagreementType = z.infer<typeof DisagreementTypeSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/types/merge-formal.test.ts`
Expected: PASS — all DisagreementType and Recommendation tests green

- [ ] **Step 5: Commit**

```bash
git add src/types/merge-formal.ts test/types/merge-formal.test.ts
git commit -m "feat(types): add DisagreementType and Recommendation formal schemas

Definition 2 (Recommendation) and Definition 4 category enum from
EditFusion §3-4. Foundation for I11/I15/I7 merge operations."
```

---

### Task 2: Disagreement and TypedResolution — Tests and Implementation

**Files:**
- Modify: `test/types/merge-formal.test.ts`
- Modify: `src/types/merge-formal.ts`

- [ ] **Step 1: Write failing tests for DisagreementSchema and TypedResolutionSchema**

Modify the existing import in `test/types/merge-formal.test.ts` to add `DisagreementSchema` and `TypedResolutionSchema`:

```typescript
import {
  DisagreementTypeSchema,
  RecommendationSchema,
  DisagreementSchema,
  TypedResolutionSchema,
} from "../../src/types/merge-formal.js";
```

Then append the following test blocks after the existing `RecommendationSchema` describe block:

```typescript
describe("DisagreementSchema", () => {
  const recA = {
    topic: "caching",
    position: "use Redis",
    evidence: "high throughput",
    confidence: 0.9,
  };
  const recB = {
    topic: "caching",
    position: "use Memcached",
    evidence: "simpler ops",
    confidence: 0.7,
  };
  const valid = {
    recommendationA: recA,
    recommendationB: recB,
    type: "trade-off" as const,
    dimension: "performance",
  };

  it("accepts a valid disagreement", () => {
    const result = DisagreementSchema.parse(valid);
    expect(result.recommendationA.position).toBe("use Redis");
    expect(result.recommendationB.position).toBe("use Memcached");
    expect(result.type).toBe("trade-off");
    expect(result.dimension).toBe("performance");
  });

  it("rejects invalid disagreement type", () => {
    expect(() => DisagreementSchema.parse({ ...valid, type: "invalid" })).toThrow();
  });

  it("rejects empty dimension", () => {
    expect(() => DisagreementSchema.parse({ ...valid, dimension: "" })).toThrow();
  });

  it("rejects invalid nested recommendation", () => {
    expect(() =>
      DisagreementSchema.parse({ ...valid, recommendationA: { topic: "" } }),
    ).toThrow();
  });
});

describe("TypedResolutionSchema", () => {
  const recA = {
    topic: "caching",
    position: "use Redis",
    evidence: "high throughput",
    confidence: 0.9,
  };
  const recB = {
    topic: "caching",
    position: "use Memcached",
    evidence: "simpler ops",
    confidence: 0.7,
  };
  const disagreement = {
    recommendationA: recA,
    recommendationB: recB,
    type: "trade-off" as const,
    dimension: "performance",
  };
  const valid = {
    disagreement,
    resolved: {
      topic: "caching",
      position: "use Redis with connection pooling",
      evidence: "combines throughput with simpler management",
      confidence: 0.85,
    },
    strategy: "trade-off" as const,
    rationale: "Redis wins on throughput; connection pooling addresses ops concern",
  };

  it("accepts a valid resolution", () => {
    const result = TypedResolutionSchema.parse(valid);
    expect(result.resolved.position).toBe("use Redis with connection pooling");
    expect(result.strategy).toBe("trade-off");
    expect(result.rationale).toContain("Redis wins");
  });

  it("allows strategy to differ from disagreement type", () => {
    const fallback = { ...valid, strategy: "arbitrary" as const };
    const result = TypedResolutionSchema.parse(fallback);
    expect(result.disagreement.type).toBe("trade-off");
    expect(result.strategy).toBe("arbitrary");
  });

  it("rejects empty rationale", () => {
    expect(() => TypedResolutionSchema.parse({ ...valid, rationale: "" })).toThrow();
  });

  it("rejects missing disagreement", () => {
    const { disagreement: _d, ...noDisagreement } = valid;
    expect(() => TypedResolutionSchema.parse(noDisagreement)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run test/types/merge-formal.test.ts`
Expected: FAIL — `DisagreementSchema` and `TypedResolutionSchema` not exported

- [ ] **Step 3: Implement DisagreementSchema and TypedResolutionSchema**

Append to `src/types/merge-formal.ts`:

```typescript
/**
 * Definition 4: Two recommendations addressing the same topic with
 * incompatible positions.
 *
 * Consumed by I11 (analysis stage identifies disagreements), I15 (routes
 * to per-type strategies), and I7 (recommendation-level matching).
 */
export const DisagreementSchema = z.object({
  recommendationA: RecommendationSchema,
  recommendationB: RecommendationSchema,
  type: DisagreementTypeSchema,
  dimension: z.string().min(1),
});

export type Disagreement = z.infer<typeof DisagreementSchema>;

/**
 * Definition 5: A resolved disagreement with strategy and rationale.
 *
 * The `strategy` field matches `disagreement.type` in the normal case,
 * but they are separate because a resolution may use a different strategy
 * than the initial classification suggests (e.g., a `trade-off`
 * disagreement resolved via `arbitrary` selection if synthesis fails).
 *
 * Consumed by I15 (per-type resolution strategies) and I12 (resolution
 * quality auditing).
 */
export const TypedResolutionSchema = z.object({
  disagreement: DisagreementSchema,
  resolved: RecommendationSchema,
  strategy: DisagreementTypeSchema,
  rationale: z.string().min(1),
});

export type TypedResolution = z.infer<typeof TypedResolutionSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/types/merge-formal.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/types/merge-formal.ts test/types/merge-formal.test.ts
git commit -m "feat(types): add Disagreement and TypedResolution formal schemas

Definition 4 (Disagreement) and Definition 5 (TypedResolution) from
EditFusion §3. Strategy field intentionally separate from disagreement
type to allow fallback resolution strategies."
```

---

### Task 3: DimensionAnalysis, MergeFormalResult, and JSDoc — Tests and Implementation

**Files:**
- Modify: `test/types/merge-formal.test.ts`
- Modify: `src/types/merge-formal.ts`

- [ ] **Step 1: Write failing tests for DimensionAnalysisSchema and MergeFormalResultSchema**

Modify the existing import in `test/types/merge-formal.test.ts` to add `DimensionAnalysisSchema` and `MergeFormalResultSchema`:

```typescript
import {
  DisagreementTypeSchema,
  RecommendationSchema,
  DisagreementSchema,
  TypedResolutionSchema,
  DimensionAnalysisSchema,
  MergeFormalResultSchema,
} from "../../src/types/merge-formal.js";
```

Then append the following test blocks after the existing `TypedResolutionSchema` describe block:

```typescript
describe("DimensionAnalysisSchema", () => {
  const rec = {
    topic: "caching",
    position: "use Redis",
    evidence: "fast",
    confidence: 0.9,
  };

  it("accepts a valid dimension analysis with all arrays populated", () => {
    const valid = {
      dimension: "performance",
      recommendations: [rec],
      disagreements: [
        {
          recommendationA: rec,
          recommendationB: { ...rec, position: "use Memcached", confidence: 0.7 },
          type: "trade-off",
          dimension: "performance",
        },
      ],
      resolutions: [
        {
          disagreement: {
            recommendationA: rec,
            recommendationB: { ...rec, position: "use Memcached", confidence: 0.7 },
            type: "trade-off",
            dimension: "performance",
          },
          resolved: { ...rec, position: "Redis with pooling", confidence: 0.85 },
          strategy: "trade-off",
          rationale: "Redis wins on throughput",
        },
      ],
    };
    const result = DimensionAnalysisSchema.parse(valid);
    expect(result.dimension).toBe("performance");
    expect(result.recommendations).toHaveLength(1);
    expect(result.disagreements).toHaveLength(1);
    expect(result.resolutions).toHaveLength(1);
  });

  it("accepts empty arrays (dimension with no disagreements)", () => {
    const result = DimensionAnalysisSchema.parse({
      dimension: "security",
      recommendations: [],
      disagreements: [],
      resolutions: [],
    });
    expect(result.recommendations).toHaveLength(0);
    expect(result.disagreements).toHaveLength(0);
    expect(result.resolutions).toHaveLength(0);
  });

  it("rejects empty dimension name", () => {
    expect(() =>
      DimensionAnalysisSchema.parse({
        dimension: "",
        recommendations: [],
        disagreements: [],
        resolutions: [],
      }),
    ).toThrow();
  });
});

describe("MergeFormalResultSchema", () => {
  it("accepts a result with dimensions and unresolved disagreements", () => {
    const rec = {
      topic: "auth",
      position: "use OAuth",
      evidence: "standard",
      confidence: 0.8,
    };
    const disagreement = {
      recommendationA: rec,
      recommendationB: { ...rec, position: "use API keys", confidence: 0.6 },
      type: "arbitrary",
      dimension: "security",
    };
    const valid = {
      dimensions: [
        {
          dimension: "security",
          recommendations: [rec],
          disagreements: [disagreement],
          resolutions: [],
        },
      ],
      unresolved: [disagreement],
    };
    const result = MergeFormalResultSchema.parse(valid);
    expect(result.dimensions).toHaveLength(1);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].type).toBe("arbitrary");
  });

  it("accepts empty dimensions and unresolved arrays", () => {
    const result = MergeFormalResultSchema.parse({
      dimensions: [],
      unresolved: [],
    });
    expect(result.dimensions).toHaveLength(0);
    expect(result.unresolved).toHaveLength(0);
  });

  it("rejects missing dimensions field", () => {
    expect(() => MergeFormalResultSchema.parse({ unresolved: [] })).toThrow();
  });

  it("rejects missing unresolved field", () => {
    expect(() => MergeFormalResultSchema.parse({ dimensions: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run test/types/merge-formal.test.ts`
Expected: FAIL — `DimensionAnalysisSchema` and `MergeFormalResultSchema` not exported

- [ ] **Step 3: Implement DimensionAnalysisSchema and MergeFormalResultSchema**

Append to `src/types/merge-formal.ts`:

```typescript
// ---------------------------------------------------------------------------
// Definition 6 — Dimension-Decomposed Merge (structural types)
// ---------------------------------------------------------------------------
/**
 * Definition 6 (Dimension-Decomposed Merge): The merge algorithm iterates
 * over quality dimensions, identifying and resolving disagreements within
 * each, then composing the final merged plan.
 *
 * `DimensionAnalysis` captures the per-dimension intermediate state:
 * recommendations extracted, disagreements identified, and resolutions
 * produced. `MergeFormalResult` aggregates across all dimensions plus
 * any disagreements that could not be resolved.
 *
 * The merge algorithm itself is implemented in I11 (two-stage merge).
 * These types capture the data shapes it produces and consumes.
 *
 * Consumed by I11 (produces DimensionAnalysis in analysis stage) and
 * I12 (consumes MergeFormalResult for retention verification).
 */
export const DimensionAnalysisSchema = z.object({
  dimension: z.string().min(1),
  recommendations: z.array(RecommendationSchema),
  disagreements: z.array(DisagreementSchema),
  resolutions: z.array(TypedResolutionSchema),
});

export type DimensionAnalysis = z.infer<typeof DimensionAnalysisSchema>;

export const MergeFormalResultSchema = z.object({
  dimensions: z.array(DimensionAnalysisSchema),
  unresolved: z.array(DisagreementSchema),
});

export type MergeFormalResult = z.infer<typeof MergeFormalResultSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/types/merge-formal.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/types/merge-formal.ts test/types/merge-formal.test.ts
git commit -m "feat(types): add DimensionAnalysis and MergeFormalResult formal schemas

Definition 6 structural types from EditFusion §3. Per-dimension
analysis state and aggregate merge result with unresolved tracking."
```

---

### Task 4: Barrel Exports and CI Verification

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add types to `src/types/index.ts` barrel**

Add after the existing `merge-result.js` export block:

```typescript
export type {
  Recommendation,
  DisagreementType,
  Disagreement,
  TypedResolution,
  DimensionAnalysis,
  MergeFormalResult,
} from "./merge-formal.js";
```

- [ ] **Step 2: Add types and schemas to `src/index.ts` public API barrel**

Add a new section after the config type exports (`export type { GenerateConfig, MergeConfig }` on line 42):

```typescript
// Formal merge types (EditFusion/BSM)
export {
  RecommendationSchema,
  DisagreementTypeSchema,
  DisagreementSchema,
  TypedResolutionSchema,
  DimensionAnalysisSchema,
  MergeFormalResultSchema,
} from "./types/merge-formal.js";
export type {
  Recommendation,
  DisagreementType,
  Disagreement,
  TypedResolution,
  DimensionAnalysis,
  MergeFormalResult,
} from "./types/merge-formal.js";
```

- [ ] **Step 3: Run full CI check**

Run: `make -f dev.mk check`
Expected: PASS — build succeeds, lint clean, all tests pass (existing + new)

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/index.ts
git commit -m "feat(types): export formal merge types through barrel files

Wire DisagreementType, Recommendation, Disagreement, TypedResolution,
DimensionAnalysis, MergeFormalResult + Zod schemas through public API."
```

---

## Success Criteria Checklist

From the spec — all must be verified before marking complete:

- [ ] 5 interfaces + 1 union type: `Recommendation`, `Disagreement`, `TypedResolution`, `DimensionAnalysis`, `MergeFormalResult`, `DisagreementType`
- [ ] All types derived from Zod schemas via `z.infer<>` (project convention)
- [ ] All Zod schemas validate correctly (accept valid, reject invalid)
- [ ] JSDoc on each type references the formal definition it mirrors
- [ ] Definitions 1, 3, and 6 documented as JSDoc
- [ ] Types exported through `src/index.ts` barrel
- [ ] `make -f dev.mk check` passes
- [ ] Eval gate: `make -f dev.mk eval-compare` shows no regression (types-only change — expected clean)
- [ ] No existing code modified (only new file + barrel additions)
