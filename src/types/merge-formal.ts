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

// ---------------------------------------------------------------------------
// Definition 4 — Disagreement
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Definition 5 — TypedResolution
// ---------------------------------------------------------------------------
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
