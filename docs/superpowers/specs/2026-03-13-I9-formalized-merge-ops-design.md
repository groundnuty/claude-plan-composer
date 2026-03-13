# Feature 1: I9 — Formalized Merge Operations — Design Spec

**Date:** 2026-03-13
**Status:** Approved
**Branch:** `feat/I9-formalized-merge-ops`
**Risk:** None — types/interfaces only, no behavioral change
**Depends on:** Nothing
**Scientific basis:** EditFusion (Wang et al., ASE 2025 RT) §3 Definitions 1-4; BSM (Saha et al., NAACL 2024) §2

## Goal

Add TypeScript types mirroring formal Definitions 1-6 from the scientific spec, providing the foundation types consumed by I11 (two-stage merge), I15 (per-type strategies), and I7 (atomic decomposition). These types live alongside existing merge types — no existing code is modified.

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Type placement | New parallel file `src/types/merge-formal.ts` | Existing types (`ConflictClass`, `ComparisonEntry`) are consumed by working code; changing them would be a behavioral change violating I9's "types only" constraint |
| Definition scope | Definitions 1, 2, 4, 5 as interfaces; 3, 6 as documentation | Definitions 3 (QualityDimension) and 6 (DimensionDecomposedMerge) describe algorithms, not data shapes — better expressed as JSDoc |
| Confidence field | `number` (0-1 normalized) | I15 needs `argmax_confidence` for arbitrary resolutions; numeric enables comparison and sorting |
| DisagreementType values | 4 values including `uncontested` | EditFusion §5.1 Table 3 includes uncontested (only one variant addresses topic); existing `ConflictClass` has 3 values but misses this |
| Validation | Zod schemas alongside interfaces | Runtime validation needed when I11/I15 parse LLM output into these structures |

---

## Component 1: DisagreementType Union

**Scientific basis:** EditFusion §4.1 Table 2 — 4 disagreement categories.

```typescript
type DisagreementType = "complementary" | "trade-off" | "arbitrary" | "uncontested";
```

Maps to the resolution strategies from Definition 5:
- `complementary` → union (include both recommendations)
- `trade-off` → argumentative synthesis (analyze trade-offs, synthesize)
- `arbitrary` → selection (pick better-argued by confidence)
- `uncontested` → adopt (only one variant addresses the topic)

**Relationship to existing `ConflictClass`:** The existing type uses `"genuine-tradeoff" | "complementary" | "arbitrary-divergence"`. Mapping functions between old and new will be added when I11/I15 land — not in this feature.

---

## Component 2: Recommendation Interface

**Scientific basis:** Definition 2 — atomic design decision within a plan section.

```typescript
interface Recommendation {
  readonly topic: string;       // what design decision this addresses
  readonly position: string;    // the specific stance/choice taken
  readonly evidence: string;    // supporting reasoning or references
  readonly confidence: number;  // 0-1 normalized confidence score
}
```

**Zod schema:**

```typescript
const RecommendationSchema = z.object({
  topic: z.string().min(1),
  position: z.string().min(1),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
});
```

**Consumed by:** I7 (recommendation extraction from plans), I15 (confidence-based selection for arbitrary type).

---

## Component 3: Disagreement Interface

**Scientific basis:** Definition 4 — two recommendations addressing the same topic with incompatible positions.

```typescript
interface Disagreement {
  readonly recommendationA: Recommendation;
  readonly recommendationB: Recommendation;
  readonly type: DisagreementType;
  readonly dimension: string;   // quality dimension context
}
```

**Zod schema:**

```typescript
const DisagreementSchema = z.object({
  recommendationA: RecommendationSchema,
  recommendationB: RecommendationSchema,
  type: DisagreementTypeSchema,
  dimension: z.string().min(1),
});
```

**Consumed by:** I11 (analysis stage identifies disagreements), I15 (routes to per-type strategies), I7 (recommendation-level matching).

---

## Component 4: TypedResolution Interface

**Scientific basis:** Definition 5 — resolved disagreement with strategy and rationale.

```typescript
interface TypedResolution {
  readonly disagreement: Disagreement;
  readonly resolved: Recommendation;
  readonly strategy: DisagreementType;
  readonly rationale: string;
}
```

**Zod schema:**

```typescript
const TypedResolutionSchema = z.object({
  disagreement: DisagreementSchema,
  resolved: RecommendationSchema,
  strategy: DisagreementTypeSchema,
  rationale: z.string().min(1),
});
```

**Design note:** `strategy` matches `disagreement.type` in the normal case, but they are separate fields because a resolution may use a different strategy than the initial classification suggests (e.g., a `trade-off` disagreement may be resolved via `arbitrary` selection if synthesis fails).

**Consumed by:** I15 (applies per-type resolution strategies), I12 (audits resolution quality).

---

## Component 5: DimensionAnalysis and MergeFormalResult

**Scientific basis:** Definition 6 concepts — per-dimension processing and composition.

```typescript
interface DimensionAnalysis {
  readonly dimension: string;
  readonly recommendations: readonly Recommendation[];
  readonly disagreements: readonly Disagreement[];
  readonly resolutions: readonly TypedResolution[];
}

interface MergeFormalResult {
  readonly dimensions: readonly DimensionAnalysis[];
  readonly unresolved: readonly Disagreement[];
}
```

**Zod schemas:**

```typescript
const DimensionAnalysisSchema = z.object({
  dimension: z.string().min(1),
  recommendations: z.array(RecommendationSchema),
  disagreements: z.array(DisagreementSchema),
  resolutions: z.array(TypedResolutionSchema),
});

const MergeFormalResultSchema = z.object({
  dimensions: z.array(DimensionAnalysisSchema),
  unresolved: z.array(DisagreementSchema),
});
```

**Consumed by:** I11 (produces `DimensionAnalysis` in analysis stage), I12 (consumes `MergeFormalResult` for retention verification).

---

## Files Changed

| File | Change |
|---|---|
| `src/types/merge-formal.ts` | Create: all formal types + Zod schemas + JSDoc documenting Definitions 3 and 6 |
| `src/index.ts` | Extend barrel export with new types |
| `test/types/merge-formal.test.ts` | Create: Zod schema validation tests (valid data accepted, invalid rejected, edge cases) |

## What This Does NOT Change

- No modifications to `src/types/merge-result.ts` (`ConflictClass`, `ComparisonEntry`, `MergeResult`)
- No modifications to `src/types/config.ts` (`MergeConfig`, `DimensionSchema`)
- No modifications to `src/merge/` (strategies, prompt builder)
- No pipeline behavioral change
- No new dependencies (uses existing Zod v4)

## Success Criteria

- [ ] All 6 interfaces/types are defined with proper `readonly` modifiers
- [ ] All Zod schemas validate correctly (accept valid, reject invalid)
- [ ] JSDoc on each type references the formal definition it mirrors
- [ ] Definitions 3 and 6 documented as JSDoc (algorithm descriptions, not data types)
- [ ] Types exported through `src/index.ts` barrel
- [ ] `make -f dev.mk check` passes (no existing tests broken)
- [ ] Eval gate: `make -f dev.mk eval-compare` shows no regression (types-only change)
