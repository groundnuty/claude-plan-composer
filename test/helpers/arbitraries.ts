import fc from "fast-check";
import type { Variant, Plan, PlanSet } from "../../src/types/plan.js";
import type { GenerateConfig, MergeConfig } from "../../src/types/config.js";
import { GenerateConfigSchema, MergeConfigSchema } from "../../src/types/config.js";
import { makePlan, makePlanSet } from "./factories.js";

/** Arbitrary Variant with random name, guidance, and optional model. */
export function arbVariant(): fc.Arbitrary<Variant> {
  return fc.record({
    name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
    guidance: fc.string({ minLength: 0, maxLength: 200 }),
    model: fc.option(fc.constantFrom("opus", "sonnet", "haiku"), { nil: undefined }),
  });
}

/** Arbitrary Plan using makePlan for metadata stub. */
export function arbPlan(): fc.Arbitrary<Plan> {
  return fc
    .record({
      variant: arbVariant(),
      content: fc.string({ minLength: 10, maxLength: 500 }),
    })
    .map(({ variant, content }) => makePlan({ variant, content }));
}

/** Arbitrary PlanSet with 2-5 plans. */
export function arbPlanSet(): fc.Arbitrary<PlanSet> {
  return fc
    .array(arbPlan(), { minLength: 2, maxLength: 5 })
    .map((plans) => makePlanSet(plans));
}

/** Arbitrary GenerateConfig via schema parse. */
export function arbGenerateConfig(): fc.Arbitrary<GenerateConfig> {
  return fc
    .record({
      model: fc.constantFrom("opus", "sonnet", "haiku"),
      maxTurns: fc.integer({ min: 1, max: 200 }),
      timeoutMs: fc.integer({ min: 1000, max: 7_200_000 }),
      minOutputBytes: fc.integer({ min: 100, max: 50_000 }),
      variants: fc.array(
        fc.record({
          name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
          guidance: fc.string({ minLength: 0, maxLength: 200 }),
        }),
        { minLength: 1, maxLength: 6 },
      ),
    })
    .map((raw) => GenerateConfigSchema.parse(raw));
}

/** Arbitrary MergeConfig via schema parse. Randomizes comparisonMethod to exercise both paths. */
export function arbMergeConfig(): fc.Arbitrary<MergeConfig> {
  const arbDimension = fc.oneof(
    fc.stringMatching(/^[A-Z][a-z ]{2,30}$/),
    fc.record({
      name: fc.stringMatching(/^[A-Z][a-z ]{2,30}$/),
      weight: fc.integer({ min: 1, max: 10 }),
    }),
  );

  return fc
    .record({
      model: fc.constantFrom("opus", "sonnet", "haiku"),
      comparisonMethod: fc.constantFrom("holistic" as const, "pairwise" as const),
      dimensions: fc.array(arbDimension, { minLength: 1, maxLength: 6 }),
      constitution: fc.array(
        fc.string({ minLength: 5, maxLength: 100 }),
        { minLength: 1, maxLength: 5 },
      ),
      evalScoring: fc.constantFrom("binary" as const, "likert" as const),
    })
    .map((raw) => MergeConfigSchema.parse(raw));
}
