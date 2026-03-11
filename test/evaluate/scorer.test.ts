import { describe, it, expect } from "vitest";
import {
  parseEvalResponse,
  aggregateScores,
  buildEvalResult,
} from "../../src/evaluate/scorer.js";
import type { PlanScore } from "../../src/types/evaluation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const binaryPlanScores: readonly PlanScore[] = [
  {
    variantName: "alpha",
    dimensions: [
      { dimension: "Approach", pass: true, critique: "Good approach" },
      { dimension: "Security", pass: false, critique: "Missing auth" },
    ],
  },
  {
    variantName: "beta",
    dimensions: [
      { dimension: "Approach", pass: true, critique: "Solid" },
      { dimension: "Security", pass: true, critique: "Well covered" },
    ],
  },
  {
    variantName: "gamma",
    dimensions: [
      { dimension: "Approach", pass: false, critique: "Weak" },
      { dimension: "Security", pass: true, critique: "OK" },
    ],
  },
];

const likertPlanScores: readonly PlanScore[] = [
  {
    variantName: "alpha",
    dimensions: [{ dimension: "Depth", score: 1, critique: "Shallow" }],
  },
  {
    variantName: "beta",
    dimensions: [{ dimension: "Depth", score: 3, critique: "Adequate" }],
  },
  {
    variantName: "gamma",
    dimensions: [{ dimension: "Depth", score: 5, critique: "Excellent" }],
  },
];

const validBinaryJson = {
  planScores: binaryPlanScores,
  gaps: [{ dimension: "Testing", description: "No plan covers testing" }],
  convergence: 0.6,
  summary: "Plans differ on security approach.",
};

const validLikertJson = {
  planScores: likertPlanScores,
  gaps: [],
  convergence: 0.4,
  summary: "Wide spread in depth scores.",
};

// ---------------------------------------------------------------------------
// parseEvalResponse
// ---------------------------------------------------------------------------

describe("parseEvalResponse — valid binary JSON", () => {
  it("parses a plain JSON string", () => {
    const text = JSON.stringify(validBinaryJson);
    const result = parseEvalResponse(text);
    expect(result.planScores).toHaveLength(3);
    expect(result.gaps).toHaveLength(1);
    expect(result.convergence).toBe(0.6);
    expect(result.summary).toBe("Plans differ on security approach.");
  });

  it("returns correct planScores structure", () => {
    const text = JSON.stringify(validBinaryJson);
    const result = parseEvalResponse(text);
    expect(result.planScores[0].variantName).toBe("alpha");
    expect(result.planScores[0].dimensions[0].pass).toBe(true);
  });
});

describe("parseEvalResponse — valid likert JSON", () => {
  it("parses likert scores with score field", () => {
    const text = JSON.stringify(validLikertJson);
    const result = parseEvalResponse(text);
    expect(result.planScores[0].dimensions[0].score).toBe(1);
    expect(result.planScores[2].dimensions[0].score).toBe(5);
  });
});

describe("parseEvalResponse — markdown code fences", () => {
  it("extracts JSON from ```json ... ``` fences", () => {
    const text = `Here is my evaluation:\n\`\`\`json\n${JSON.stringify(validBinaryJson)}\n\`\`\`\nDone.`;
    const result = parseEvalResponse(text);
    expect(result.convergence).toBe(0.6);
    expect(result.planScores).toHaveLength(3);
  });

  it("extracts JSON from plain ``` fences", () => {
    const text = `\`\`\`\n${JSON.stringify(validBinaryJson)}\n\`\`\``;
    const result = parseEvalResponse(text);
    expect(result.summary).toBe("Plans differ on security approach.");
  });

  it("falls back to raw brace extraction when no fences", () => {
    const json = JSON.stringify(validBinaryJson);
    const text = `Some preamble text. ${json} Some trailing text.`;
    const result = parseEvalResponse(text);
    expect(result.convergence).toBe(0.6);
  });
});

describe("parseEvalResponse — error cases", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseEvalResponse("not json at all")).toThrow();
  });

  it("throws on missing planScores field", () => {
    const bad = JSON.stringify({ gaps: [], convergence: 0.5, summary: "ok" });
    expect(() => parseEvalResponse(bad)).toThrow();
  });

  it("throws on missing gaps field", () => {
    const bad = JSON.stringify({
      planScores: [],
      convergence: 0.5,
      summary: "ok",
    });
    expect(() => parseEvalResponse(bad)).toThrow();
  });

  it("throws on missing convergence field", () => {
    const bad = JSON.stringify({ planScores: [], gaps: [], summary: "ok" });
    expect(() => parseEvalResponse(bad)).toThrow();
  });

  it("throws on missing summary field", () => {
    const bad = JSON.stringify({ planScores: [], gaps: [], convergence: 0.5 });
    expect(() => parseEvalResponse(bad)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// aggregateScores
// ---------------------------------------------------------------------------

describe("aggregateScores — binary majority", () => {
  it("returns pass when majority (2 of 3) pass", () => {
    // Approach: alpha=pass, beta=pass, gamma=fail → 2/3 pass → majority pass
    const result = aggregateScores(binaryPlanScores, "majority");
    const approach = result.find((d) => d.dimension === "Approach");
    expect(approach?.pass).toBe(true);
  });

  it("returns fail when majority (1 of 3) fail", () => {
    // Security: alpha=fail, beta=pass, gamma=pass → 2/3 pass → majority pass
    // Let's build a case where majority fail
    const scores: readonly PlanScore[] = [
      {
        variantName: "a",
        dimensions: [{ dimension: "X", pass: false, critique: "bad" }],
      },
      {
        variantName: "b",
        dimensions: [{ dimension: "X", pass: false, critique: "bad" }],
      },
      {
        variantName: "c",
        dimensions: [{ dimension: "X", pass: true, critique: "ok" }],
      },
    ];
    const result = aggregateScores(scores, "majority");
    const x = result.find((d) => d.dimension === "X");
    expect(x?.pass).toBe(false);
  });

  it("returns one DimensionScore per dimension", () => {
    const result = aggregateScores(binaryPlanScores, "majority");
    expect(result).toHaveLength(2); // Approach + Security
    const dims = result.map((d) => d.dimension);
    expect(dims).toContain("Approach");
    expect(dims).toContain("Security");
  });
});

describe("aggregateScores — binary min", () => {
  it("returns fail if any plan fails", () => {
    // Security: alpha=fail → min should fail
    const result = aggregateScores(binaryPlanScores, "min");
    const security = result.find((d) => d.dimension === "Security");
    expect(security?.pass).toBe(false);
  });

  it("returns pass only when all plans pass", () => {
    const allPass: readonly PlanScore[] = [
      {
        variantName: "a",
        dimensions: [{ dimension: "Y", pass: true, critique: "ok" }],
      },
      {
        variantName: "b",
        dimensions: [{ dimension: "Y", pass: true, critique: "ok" }],
      },
    ];
    const result = aggregateScores(allPass, "min");
    const y = result.find((d) => d.dimension === "Y");
    expect(y?.pass).toBe(true);
  });
});

describe("aggregateScores — likert median", () => {
  it("returns median of [1, 3, 5] → 3", () => {
    const result = aggregateScores(likertPlanScores, "median");
    const depth = result.find((d) => d.dimension === "Depth");
    expect(depth?.score).toBe(3);
  });

  it("returns median of [3, 5] → 4 (average for even count)", () => {
    const two: readonly PlanScore[] = [
      {
        variantName: "a",
        dimensions: [{ dimension: "D", score: 3, critique: "" }],
      },
      {
        variantName: "b",
        dimensions: [{ dimension: "D", score: 5, critique: "" }],
      },
    ];
    const result = aggregateScores(two, "median");
    const d = result.find((r) => r.dimension === "D");
    expect(d?.score).toBe(4);
  });
});

describe("aggregateScores — likert min", () => {
  it("returns minimum of [1, 3, 5] → 1", () => {
    const result = aggregateScores(likertPlanScores, "min");
    const depth = result.find((d) => d.dimension === "Depth");
    expect(depth?.score).toBe(1);
  });

  it("returns minimum of [3, 5] → 3", () => {
    const two: readonly PlanScore[] = [
      {
        variantName: "a",
        dimensions: [{ dimension: "D", score: 3, critique: "" }],
      },
      {
        variantName: "b",
        dimensions: [{ dimension: "D", score: 5, critique: "" }],
      },
    ];
    const result = aggregateScores(two, "min");
    const d = result.find((r) => r.dimension === "D");
    expect(d?.score).toBe(3);
  });
});

describe("aggregateScores — likert majority (mean rounded)", () => {
  it("returns mean rounded of [1, 3, 5] → 3", () => {
    const result = aggregateScores(likertPlanScores, "majority");
    const depth = result.find((d) => d.dimension === "Depth");
    expect(depth?.score).toBe(3);
  });

  it("returns mean rounded of [2, 3] → 3 (round half up)", () => {
    const two: readonly PlanScore[] = [
      {
        variantName: "a",
        dimensions: [{ dimension: "D", score: 2, critique: "" }],
      },
      {
        variantName: "b",
        dimensions: [{ dimension: "D", score: 3, critique: "" }],
      },
    ];
    const result = aggregateScores(two, "majority");
    const d = result.find((r) => r.dimension === "D");
    // mean = 2.5, Math.round(2.5) = 3 in JS
    expect(d?.score).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// buildEvalResult
// ---------------------------------------------------------------------------

describe("buildEvalResult", () => {
  it("combines raw response with aggregated scores", () => {
    const text = JSON.stringify(validBinaryJson);
    const raw = parseEvalResponse(text);
    const result = buildEvalResult(raw, "majority");
    expect(result.planScores).toEqual(raw.planScores);
    expect(result.gaps).toEqual(raw.gaps);
    expect(result.convergence).toBe(0.6);
    expect(result.summary).toBe("Plans differ on security approach.");
    expect(result.scores).toHaveLength(2); // Approach + Security
  });

  it("correctly aggregates scores into EvalResult.scores", () => {
    const text = JSON.stringify(validBinaryJson);
    const raw = parseEvalResponse(text);
    const result = buildEvalResult(raw, "majority");
    const approach = result.scores.find((d) => d.dimension === "Approach");
    // alpha=pass, beta=pass, gamma=fail → 2/3 pass
    expect(approach?.pass).toBe(true);
  });

  it("passes through summary, gaps, planScores, convergence", () => {
    const text = JSON.stringify(validLikertJson);
    const raw = parseEvalResponse(text);
    const result = buildEvalResult(raw, "median");
    expect(result.summary).toBe("Wide spread in depth scores.");
    expect(result.gaps).toHaveLength(0);
    expect(result.convergence).toBe(0.4);
    expect(result.planScores).toHaveLength(3);
  });
});
