import { describe, it, expect } from "vitest";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import {
  parseEvalResponse,
  buildEvalResult,
} from "../../src/evaluate/scorer.js";
import { DEFAULT_EVAL_MODEL } from "../../src/evaluate/index.js";
import type { EvaluateOptions } from "../../src/evaluate/index.js";
import type { Plan } from "../../src/types/plan.js";
import type { MergeConfig } from "../../src/types/config.js";
import type { EvalResult } from "../../src/types/evaluation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePlan = (name: string, content: string): Plan => ({
  variant: { name, guidance: "" },
  content,
  metadata: {
    model: "haiku",
    turns: 1,
    durationMs: 500,
    durationApiMs: 400,
    tokenUsage: {
      inputTokens: 50,
      outputTokens: 100,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0.001,
    },
    costUsd: 0.001,
    stopReason: "end_turn",
    sessionId: "test-session",
  },
});

const makeConfig = (overrides?: Partial<MergeConfig>): MergeConfig => ({
  model: "sonnet",
  strategy: "simple",
  comparisonMethod: "holistic",
  dimensions: ["Approach", "Technical depth"],
  constitution: [],
  role: "",
  maxTurns: 30,
  timeoutMs: 600_000,
  evalScoring: "binary",
  evalPasses: 1,
  evalConsensus: "median",
  projectDescription: "",
  advocateInstructions: "",
  outputGoal: "",
  outputTitle: "Merged Plan",
  ...overrides,
});

// ---------------------------------------------------------------------------
// DEFAULT_EVAL_MODEL constant
// ---------------------------------------------------------------------------

describe("DEFAULT_EVAL_MODEL", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_EVAL_MODEL).toBe("string");
    expect(DEFAULT_EVAL_MODEL.length).toBeGreaterThan(0);
  });

  it("defaults to a haiku model (cheap eval model)", () => {
    expect(DEFAULT_EVAL_MODEL).toMatch(/haiku/i);
  });
});

// ---------------------------------------------------------------------------
// EvaluateOptions type shape
// ---------------------------------------------------------------------------

describe("EvaluateOptions interface shape", () => {
  it("accepts an object with optional model string", () => {
    const opts: EvaluateOptions = { model: "claude-haiku-4-5-20251001" };
    expect(opts.model).toBe("claude-haiku-4-5-20251001");
  });

  it("accepts an object with optional AbortSignal", () => {
    const controller = new AbortController();
    const opts: EvaluateOptions = { signal: controller.signal };
    expect(opts.signal).toBe(controller.signal);
  });

  it("accepts an empty object (all options are optional)", () => {
    const opts: EvaluateOptions = {};
    expect(opts.model).toBeUndefined();
    expect(opts.signal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: buildEvalPrompt → parseEvalResponse → buildEvalResult
// ---------------------------------------------------------------------------

describe("evaluate pipeline integration — binary scoring", () => {
  const planA = makePlan("alpha", "Alpha plan content here");
  const planB = makePlan("beta", "Beta plan content here");
  const config = makeConfig({
    evalScoring: "binary",
    evalConsensus: "majority",
  });

  const mockResponseJson = {
    planScores: [
      {
        variantName: "alpha",
        dimensions: [
          { dimension: "Approach", pass: true, critique: "Good approach" },
          {
            dimension: "Technical depth",
            pass: false,
            critique: "Too shallow",
          },
        ],
      },
      {
        variantName: "beta",
        dimensions: [
          { dimension: "Approach", pass: true, critique: "Solid strategy" },
          {
            dimension: "Technical depth",
            pass: true,
            critique: "Well detailed",
          },
        ],
      },
    ],
    gaps: [
      { dimension: "Risk", description: "Neither plan covers failure modes" },
    ],
    convergence: 0.7,
    summary: "Plans are broadly aligned with differences in technical depth.",
  };

  it("buildEvalPrompt produces a non-empty prompt containing plan content", () => {
    const prompt = buildEvalPrompt([planA, planB], config);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("Alpha plan content here");
    expect(prompt).toContain("Beta plan content here");
  });

  it("parseEvalResponse + buildEvalResult returns correct EvalResult shape", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockResponseJson));
    const result: EvalResult = buildEvalResult(parsed, config.evalConsensus);

    expect(result.planScores).toHaveLength(2);
    expect(result.gaps).toHaveLength(1);
    expect(result.convergence).toBe(0.7);
    expect(result.summary).toContain("broadly aligned");
    // scores: aggregated per-dimension
    expect(result.scores).toHaveLength(2);
  });

  it("majority consensus passes Approach (2 of 2 pass)", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockResponseJson));
    const result = buildEvalResult(parsed, "majority");
    const approach = result.scores.find((s) => s.dimension === "Approach");
    expect(approach?.pass).toBe(true);
  });

  it("majority consensus fails Technical depth (1 of 2 pass = 50%, not >50%)", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockResponseJson));
    const result = buildEvalResult(parsed, "majority");
    const depth = result.scores.find((s) => s.dimension === "Technical depth");
    // 1 out of 2 = 50%, not strictly > 50% → fail
    expect(depth?.pass).toBe(false);
  });

  it("min consensus fails Technical depth (alpha fails)", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockResponseJson));
    const result = buildEvalResult(parsed, "min");
    const depth = result.scores.find((s) => s.dimension === "Technical depth");
    expect(depth?.pass).toBe(false);
  });
});

describe("evaluate pipeline integration — likert scoring", () => {
  const planA = makePlan("v1", "Version 1 plan");
  const planB = makePlan("v2", "Version 2 plan");
  const planC = makePlan("v3", "Version 3 plan");
  const config = makeConfig({ evalScoring: "likert", evalConsensus: "median" });

  const mockLikertJson = {
    planScores: [
      {
        variantName: "v1",
        dimensions: [{ dimension: "Approach", score: 2, critique: "Weak" }],
      },
      {
        variantName: "v2",
        dimensions: [{ dimension: "Approach", score: 4, critique: "Good" }],
      },
      {
        variantName: "v3",
        dimensions: [{ dimension: "Approach", score: 3, critique: "Adequate" }],
      },
    ],
    gaps: [],
    convergence: 0.3,
    summary: "Wide variation across plans.",
  };

  it("median consensus produces correct score for [2, 4, 3] sorted = [2, 3, 4] → 3", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockLikertJson));
    const result = buildEvalResult(parsed, "median");
    const approach = result.scores.find((s) => s.dimension === "Approach");
    expect(approach?.score).toBe(3);
  });

  it("buildEvalPrompt in likert mode requests 1-5 scale", () => {
    const prompt = buildEvalPrompt([planA, planB, planC], config);
    expect(prompt).toMatch(/1.*5|likert|score/i);
  });
});

describe("evaluate pipeline integration — consensus variants", () => {
  const mockJson = {
    planScores: [
      {
        variantName: "a",
        dimensions: [{ dimension: "D", score: 1, critique: "low" }],
      },
      {
        variantName: "b",
        dimensions: [{ dimension: "D", score: 5, critique: "high" }],
      },
    ],
    gaps: [],
    convergence: 0.0,
    summary: "Maximally divergent.",
  };

  it("min consensus picks the lowest likert score", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockJson));
    const result = buildEvalResult(parsed, "min");
    const d = result.scores.find((s) => s.dimension === "D");
    expect(d?.score).toBe(1);
  });

  it("majority consensus uses mean rounded for [1, 5] → 3", () => {
    const parsed = parseEvalResponse(JSON.stringify(mockJson));
    const result = buildEvalResult(parsed, "majority");
    const d = result.scores.find((s) => s.dimension === "D");
    expect(d?.score).toBe(3);
  });
});
