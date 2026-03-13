import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import { makePlan, makeDefaultMergeConfig } from "../helpers/factories.js";

// ---------------------------------------------------------------------------
// buildEvalPrompt — plan embedding
// ---------------------------------------------------------------------------

describe("buildEvalPrompt — plan embedding", () => {
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan content" });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan content" });
  const config = makeDefaultMergeConfig();

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
  const plan = makePlan({ variant: { name: "solo", guidance: "" }, content: "Solo plan" });

  it("lists all string dimensions", () => {
    const config = makeDefaultMergeConfig({ dimensions: ["Approach", "Technical depth", "Risk"] });
    const result = buildEvalPrompt([plan], config);
    expect(result).toContain("Approach");
    expect(result).toContain("Technical depth");
    expect(result).toContain("Risk");
  });

  it("lists dimensions with weight objects by name", () => {
    const config = makeDefaultMergeConfig({
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
    const config = makeDefaultMergeConfig({
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
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha content" });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta content" });
  const config = makeDefaultMergeConfig({ evalScoring: "binary" });

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
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha content" });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta content" });
  const config = makeDefaultMergeConfig({ evalScoring: "likert" });

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
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha content" });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta content" });
  const config = makeDefaultMergeConfig();

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
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha content" });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta content" });
  const config = makeDefaultMergeConfig();

  it("explains the convergence scale (0.0 to 1.0)", () => {
    const result = buildEvalPrompt([planA, planB], config);
    expect(result).toMatch(/0\.0|0 =|completely different/i);
    expect(result).toMatch(/1\.0|1 =|nearly identical/i);
  });
});
