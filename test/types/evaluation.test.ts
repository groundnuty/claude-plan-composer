import { describe, it, expect } from "vitest";
import type {
  DimensionScore,
  EvalResult,
  Gap,
  PlanScore,
  VerifyGateResult,
  VerifyResult,
} from "../../src/types/evaluation.js";

describe("DimensionScore", () => {
  it("holds dimension, critique, and optional pass/score fields", () => {
    const binary: DimensionScore = {
      dimension: "correctness",
      pass: true,
      critique: "All steps are logically consistent.",
    };
    expect(binary.dimension).toBe("correctness");
    expect(binary.pass).toBe(true);
    expect(binary.critique).toBe("All steps are logically consistent.");

    const likert: DimensionScore = {
      dimension: "clarity",
      score: 4,
      critique: "Mostly clear but step 3 is ambiguous.",
    };
    expect(likert.score).toBe(4);
    expect(likert.pass).toBeUndefined();
  });
});

describe("Gap", () => {
  it("holds dimension and description", () => {
    const gap: Gap = {
      dimension: "completeness",
      description: "Missing rollback procedure.",
    };
    expect(gap.dimension).toBe("completeness");
    expect(gap.description).toBe("Missing rollback procedure.");
  });
});

describe("PlanScore", () => {
  it("holds variantName and a readonly array of DimensionScore", () => {
    const score: PlanScore = {
      variantName: "optimistic",
      dimensions: [
        { dimension: "feasibility", pass: true, critique: "All steps achievable." },
        { dimension: "clarity", score: 3, critique: "Somewhat clear." },
      ],
    };
    expect(score.variantName).toBe("optimistic");
    expect(score.dimensions).toHaveLength(2);
    expect(score.dimensions[0].dimension).toBe("feasibility");
    expect(score.dimensions[1].score).toBe(3);
  });

  it("accepts an empty dimensions array", () => {
    const score: PlanScore = { variantName: "empty-variant", dimensions: [] };
    expect(score.dimensions).toHaveLength(0);
  });
});

describe("EvalResult", () => {
  it("holds all required fields: planScores, gaps, convergence, scores, summary", () => {
    const result: EvalResult = {
      scores: [{ dimension: "correctness", pass: true, critique: "OK" }],
      summary: "Overall good.",
      planScores: [
        {
          variantName: "v1",
          dimensions: [{ dimension: "correctness", pass: true, critique: "OK" }],
        },
      ],
      gaps: [{ dimension: "completeness", description: "Missing teardown." }],
      convergence: 0.85,
    };
    expect(result.planScores).toHaveLength(1);
    expect(result.planScores[0].variantName).toBe("v1");
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].dimension).toBe("completeness");
    expect(result.convergence).toBeCloseTo(0.85);
    expect(result.scores).toHaveLength(1);
    expect(result.summary).toBe("Overall good.");
  });

  it("convergence is a number between 0 and 1", () => {
    const low: EvalResult = {
      scores: [],
      summary: "Low agreement.",
      planScores: [],
      gaps: [],
      convergence: 0.1,
    };
    expect(low.convergence).toBeGreaterThanOrEqual(0);
    expect(low.convergence).toBeLessThanOrEqual(1);
  });
});

describe("VerifyGateResult", () => {
  it("holds gate name, pass flag, and findings", () => {
    const gate: VerifyGateResult = {
      gate: "consistency",
      pass: true,
      findings: ["Step 2 references step 1 correctly."],
    };
    expect(gate.gate).toBe("consistency");
    expect(gate.pass).toBe(true);
    expect(gate.findings).toHaveLength(1);
  });

  it("accepts all three gate types", () => {
    const gates: VerifyGateResult[] = [
      { gate: "consistency", pass: true, findings: [] },
      { gate: "completeness", pass: false, findings: ["Missing error handling."] },
      { gate: "actionability", pass: true, findings: [] },
    ];
    expect(gates[0].gate).toBe("consistency");
    expect(gates[1].gate).toBe("completeness");
    expect(gates[2].gate).toBe("actionability");
  });

  it("accepts an empty findings array", () => {
    const gate: VerifyGateResult = {
      gate: "actionability",
      pass: true,
      findings: [],
    };
    expect(gate.findings).toHaveLength(0);
  });
});

describe("VerifyResult", () => {
  it("holds gates array, overall pass flag, and report", () => {
    const result: VerifyResult = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: false, findings: ["No teardown step."] },
        { gate: "actionability", pass: true, findings: [] },
      ],
      pass: false,
      report: "Plan fails completeness gate.",
    };
    expect(result.gates).toHaveLength(3);
    expect(result.pass).toBe(false);
    expect(result.report).toBe("Plan fails completeness gate.");
  });

  it("overall pass is true only when all gates pass", () => {
    const allPass: VerifyResult = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: true, findings: [] },
        { gate: "actionability", pass: true, findings: [] },
      ],
      pass: true,
      report: "All gates passed.",
    };
    expect(allPass.pass).toBe(true);
    expect(allPass.gates.every((g) => g.pass)).toBe(true);
  });
});
