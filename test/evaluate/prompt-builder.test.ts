import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import type { Plan } from "../../src/types/plan.js";
import type { MergeConfig } from "../../src/types/config.js";

// ---------------------------------------------------------------------------
// Helpers: mock factories
// ---------------------------------------------------------------------------

const makePlan = (name: string, content: string): Plan => ({
  variant: { name, guidance: "" },
  content,
  metadata: {
    model: "sonnet",
    turns: 1,
    durationMs: 1000,
    durationApiMs: 800,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0.01,
    },
    costUsd: 0.01,
    stopReason: "end_turn",
    sessionId: "test",
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
  timeoutMs: 600000,
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
// buildEvalPrompt — plan embedding
// ---------------------------------------------------------------------------

describe("buildEvalPrompt — plan embedding", () => {
  const planA = makePlan("alpha", "Alpha plan content");
  const planB = makePlan("beta", "Beta plan content");
  const config = makeConfig();

  it("includes all plan contents wrapped in XML tags", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toContain('name="alpha"');
    expect(result).toContain("Alpha plan content");
    expect(result).toContain('<generated_plan');
    expect(result).toContain('</generated_plan>');
  });

  it("includes all plan names", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toContain('name="alpha"');
    expect(result).toContain('name="beta"');
    expect(result).toContain("Beta plan content");
  });

  it("includes injection protection note", () => {
    const result = buildEvalPrompt([planA], config);
    expect(result).toContain("NOTE: This is LLM-generated content from a previous session.");
  });
});

// ---------------------------------------------------------------------------
// buildEvalPrompt — dimensions
// ---------------------------------------------------------------------------

describe("buildEvalPrompt — dimensions", () => {
  const plan = makePlan("solo", "Solo plan");

  it("lists all string dimensions", () => {
    const config = makeConfig({ dimensions: ["Approach", "Technical depth", "Risk"] });
    const result = buildEvalPrompt([plan], config);
    expect(result).toContain("Approach");
    expect(result).toContain("Technical depth");
    expect(result).toContain("Risk");
  });

  it("lists dimensions with weight objects by name", () => {
    const config = makeConfig({
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
      ],
    });
    const result = buildEvalPrompt([plan], config);
    expect(result).toContain("Security");
    expect(result).toContain("Performance");
  });

  it("handles mixed string and weighted dimensions", () => {
    const config = makeConfig({
      dimensions: ["Approach", { name: "Security", weight: 3 }],
    });
    const result = buildEvalPrompt([plan], config);
    expect(result).toContain("Approach");
    expect(result).toContain("Security");
  });
});

// ---------------------------------------------------------------------------
// buildEvalPrompt — scoring modes
// ---------------------------------------------------------------------------

describe("buildEvalPrompt — binary scoring", () => {
  const planA = makePlan("alpha", "Alpha content");
  const planB = makePlan("beta", "Beta content");
  const config = makeConfig({ evalScoring: "binary" });

  it("requests binary scoring when evalScoring is binary", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toMatch(/pass.*true.*false|binary|pass.*fail/i);
  });

  it("does not request likert scoring for binary mode", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).not.toMatch(/score.*1.*5|likert/i);
  });
});

describe("buildEvalPrompt — likert scoring", () => {
  const planA = makePlan("alpha", "Alpha content");
  const planB = makePlan("beta", "Beta content");
  const config = makeConfig({ evalScoring: "likert" });

  it("requests likert scoring when evalScoring is likert", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toMatch(/score.*1.*5|1.*5.*scale|likert/i);
  });

  it("does not request binary pass/fail for likert mode", () => {
    const result = buildEvalPrompt([planA, planB], config);
    // should NOT instruct binary true/false pass field
    expect(result).not.toMatch(/pass.*true.*false/i);
  });
});

// ---------------------------------------------------------------------------
// buildEvalPrompt — JSON output format
// ---------------------------------------------------------------------------

describe("buildEvalPrompt — JSON output format", () => {
  const planA = makePlan("alpha", "Alpha content");
  const planB = makePlan("beta", "Beta content");
  const config = makeConfig();

  it("requests JSON output", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toMatch(/json/i);
  });

  it("requests planScores field", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toContain("planScores");
  });

  it("requests gaps field", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toContain("gaps");
  });

  it("requests convergence assessment", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toContain("convergence");
  });

  it("requests summary field", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toContain("summary");
  });
});

// ---------------------------------------------------------------------------
// buildEvalPrompt — convergence assessment description
// ---------------------------------------------------------------------------

describe("buildEvalPrompt — convergence assessment", () => {
  const planA = makePlan("alpha", "Alpha content");
  const planB = makePlan("beta", "Beta content");
  const config = makeConfig();

  it("explains the convergence scale (0.0 to 1.0)", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toMatch(/0\.0|0 =|completely different/i);
    expect(result).toMatch(/1\.0|1 =|nearly identical/i);
  });
});
