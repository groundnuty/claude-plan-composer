import type { Plan, PlanSet } from "../../src/types/plan.js";
import type { MergeConfig } from "../../src/types/config.js";
import { MergeConfigSchema } from "../../src/types/config.js";
import type { EvalResult } from "../../src/types/evaluation.js";

/** Create a Plan with sensible defaults. Override any field via Partial<Plan>. */
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    variant: { name: "test-variant", guidance: "test guidance" },
    content: "# Test Plan\nSome plan content here.",
    metadata: {
      model: "opus",
      turns: 10,
      durationMs: 5000,
      durationApiMs: 4000,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 2000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0.05,
      },
      costUsd: 0.05,
      stopReason: "end_turn",
      sessionId: "sess-001",
    },
    ...overrides,
  };
}

/** Wrap plans into a PlanSet with fixed timestamp and runDir. */
export function makePlanSet(plans: Plan[]): PlanSet {
  return {
    plans,
    timestamp: "2026-03-10T12:00:00Z",
    runDir: "/tmp/test-run",
  };
}

/** Create a MergeConfig via schema parse (gets all defaults). */
export function makeDefaultMergeConfig(
  overrides: Partial<MergeConfig> = {},
): MergeConfig {
  return MergeConfigSchema.parse(overrides);
}

/** Binary scoring eval result fixture. */
export function makeBinaryEvalResult(): EvalResult {
  return {
    scores: [
      { dimension: "Approach", pass: true, critique: "Solid approach" },
      { dimension: "Risk", pass: false, critique: "Missing risk analysis" },
    ],
    summary: "Overall: plan is strong on approach but weak on risk.",
    planScores: [],
    gaps: [],
    convergence: 0,
  };
}

/** Likert scoring eval result fixture. */
export function makeLikertEvalResult(): EvalResult {
  return {
    scores: [
      { dimension: "Approach", score: 4, critique: "Good approach" },
      { dimension: "Risk", score: 2, critique: "Inadequate risk coverage" },
    ],
    summary: "Overall: moderate quality plan.",
    planScores: [],
    gaps: [],
    convergence: 0,
  };
}
