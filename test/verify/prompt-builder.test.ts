import { buildVerifyPrompt } from "../../src/verify/prompt-builder.js";
import type { SourcePlanRef } from "../../src/verify/prompt-builder.js";

// ---------------------------------------------------------------------------
// Helpers: mock factories
// ---------------------------------------------------------------------------

const makeSourcePlan = (name: string, content: string): SourcePlanRef => ({
  name,
  content,
});

// ---------------------------------------------------------------------------
// buildVerifyPrompt — merged plan embedding
// ---------------------------------------------------------------------------

describe("buildVerifyPrompt — merged plan embedding", () => {
  const sourcePlans = [makeSourcePlan("alpha", "Alpha plan content")];

  it("includes merged plan content wrapped in XML tags", () => {
    const result = buildVerifyPrompt("The merged plan content", sourcePlans);
    expect(result).toContain("The merged plan content");
    expect(result).toContain("<merged_plan>");
    expect(result).toContain("</merged_plan>");
  });

  it("merged plan appears inside the XML tags", () => {
    const result = buildVerifyPrompt("Merged content here", sourcePlans);
    const start = result.indexOf("<merged_plan>");
    const end = result.indexOf("</merged_plan>");
    const inside = result.slice(start, end);
    expect(inside).toContain("Merged content here");
  });
});

// ---------------------------------------------------------------------------
// buildVerifyPrompt — source plan embedding
// ---------------------------------------------------------------------------

describe("buildVerifyPrompt — source plan embedding", () => {
  it("includes all source plan contents for completeness checking", () => {
    const sourcePlans = [
      makeSourcePlan("alpha", "Alpha unique insight"),
      makeSourcePlan("beta", "Beta unique approach"),
    ];
    const result = buildVerifyPrompt("Merged plan", sourcePlans);
    expect(result).toContain("Alpha unique insight");
    expect(result).toContain("Beta unique approach");
  });

  it("wraps each source plan in XML tags with name attribute", () => {
    const sourcePlans = [
      makeSourcePlan("plan-one", "Content one"),
      makeSourcePlan("plan-two", "Content two"),
    ];
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain('<source_plan name="plan-one">');
    expect(result).toContain('</source_plan>');
    expect(result).toContain('<source_plan name="plan-two">');
  });

  it("includes all source plan names", () => {
    const sourcePlans = [
      makeSourcePlan("conservative", "Conservative approach"),
      makeSourcePlan("aggressive", "Aggressive approach"),
      makeSourcePlan("balanced", "Balanced approach"),
    ];
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain('name="conservative"');
    expect(result).toContain('name="aggressive"');
    expect(result).toContain('name="balanced"');
  });

  it("handles a single source plan", () => {
    const sourcePlans = [makeSourcePlan("solo", "Solo plan content")];
    const result = buildVerifyPrompt("Merged plan", sourcePlans);
    expect(result).toContain('<source_plan name="solo">');
    expect(result).toContain("Solo plan content");
  });
});

// ---------------------------------------------------------------------------
// buildVerifyPrompt — quality gates definition
// ---------------------------------------------------------------------------

describe("buildVerifyPrompt — quality gates", () => {
  const sourcePlans = [makeSourcePlan("alpha", "Alpha content")];

  it("defines the CONSISTENCY gate", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("CONSISTENCY");
  });

  it("defines the COMPLETENESS gate", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("COMPLETENESS");
  });

  it("defines the ACTIONABILITY gate", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("ACTIONABILITY");
  });

  it("defines all 3 quality gates", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("CONSISTENCY");
    expect(result).toContain("COMPLETENESS");
    expect(result).toContain("ACTIONABILITY");
  });

  it("explains CONSISTENCY checks internal contradictions", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    // Should mention contradictions, conflicts, or conflicting recommendations
    expect(result).toMatch(/contradict|conflict|inconsisten/i);
  });

  it("explains COMPLETENESS checks content from source plans", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    // Should mention lost, missing, or omitted content from source plans
    expect(result).toMatch(/lost|missing|omit|source plan/i);
  });

  it("explains ACTIONABILITY checks executable sections", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    // Should mention concrete steps, executable, or next steps
    expect(result).toMatch(/concrete|executable|actionable|next step/i);
  });
});

// ---------------------------------------------------------------------------
// buildVerifyPrompt — JSON output format
// ---------------------------------------------------------------------------

describe("buildVerifyPrompt — JSON output format", () => {
  const sourcePlans = [
    makeSourcePlan("alpha", "Alpha content"),
    makeSourcePlan("beta", "Beta content"),
  ];

  it("requests JSON output", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toMatch(/json/i);
  });

  it("requests gates field in JSON output", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("gates");
  });

  it("requests pass field in JSON output", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("pass");
  });

  it("requests findings field in JSON output", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("findings");
  });

  it("requests report field in JSON output", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    expect(result).toContain("report");
  });

  it("requests gate field (gate name) in JSON output", () => {
    const result = buildVerifyPrompt("Merged", sourcePlans);
    // 'gate' field identifies which gate the entry is for
    expect(result).toContain('"gate"');
  });
});
