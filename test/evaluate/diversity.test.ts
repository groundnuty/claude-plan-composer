import { describe, it, expect } from "vitest";
import { measureDiversity } from "../../src/evaluate/diversity.js";
import type { Plan } from "../../src/types/plan.js";
import type { DiversityResult } from "../../src/types/diversity.js";

function makePlan(name: string, content: string): Plan {
  return {
    variant: { name, guidance: "" },
    content,
    metadata: {
      model: "test",
      turns: 0,
      durationMs: 0,
      durationApiMs: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0,
      },
      costUsd: 0,
      stopReason: null,
      sessionId: "",
    },
  };
}

describe("measureDiversity", () => {
  it("returns zero scores and warning for fewer than 2 plans", () => {
    const result = measureDiversity([makePlan("a", "content")], 0.3);
    expect(result.jaccardDistance).toBe(0);
    expect(result.normalizedEntropy).toBe(0);
    expect(result.compositeScore).toBe(0);
    expect(result.warning).toBeDefined();
  });

  it("returns zero scores for empty plan list", () => {
    const result = measureDiversity([], 0.3);
    expect(result.compositeScore).toBe(0);
    expect(result.warning).toBeDefined();
  });

  it("computes composite as mean of jaccard distance and normalized entropy", () => {
    const plans = [
      makePlan("a", "## Architecture\n## Design\nalpha beta gamma delta"),
      makePlan("b", "## Testing\n## Deployment\nepsilon zeta eta theta"),
    ];
    const result = measureDiversity(plans, 0.0);
    // jaccardDistance = 1 - similarity. Different headings → similarity near 0 → distance near 1
    expect(result.jaccardDistance).toBeGreaterThan(0);
    expect(result.normalizedEntropy).toBeGreaterThan(0);
    expect(result.compositeScore).toBeCloseTo(
      (result.jaccardDistance + result.normalizedEntropy) / 2,
      10,
    );
    expect(result.warning).toBeUndefined();
  });

  it("fires warning when composite < threshold", () => {
    // Identical plans → low diversity
    const plans = [
      makePlan("a", "## Architecture\nalpha beta gamma"),
      makePlan("b", "## Architecture\nalpha beta gamma"),
    ];
    const result = measureDiversity(plans, 0.5);
    expect(result.compositeScore).toBeLessThan(0.5);
    expect(result.warning).toContain("Low diversity detected");
    expect(result.warning).toContain("threshold: 0.5");
  });

  it("does not fire warning when composite >= threshold", () => {
    const plans = [
      makePlan("a", "## Architecture\n## Design\nalpha beta gamma delta"),
      makePlan("b", "## Testing\n## Deployment\nepsilon zeta eta theta"),
    ];
    const result = measureDiversity(plans, 0.0);
    expect(result.warning).toBeUndefined();
  });

  it("stores raw Shannon entropy alongside normalized", () => {
    const plans = [
      makePlan("a", "alpha beta gamma delta epsilon"),
      makePlan("b", "zeta eta theta iota kappa"),
    ];
    const result = measureDiversity(plans, 0.0);
    expect(result.shannonEntropy.mean).toBeGreaterThan(0);
    expect(Object.keys(result.shannonEntropy.perNgram).length).toBeGreaterThan(0);
  });

  it("handles empty plan content gracefully", () => {
    const plans = [makePlan("a", ""), makePlan("b", "")];
    const result = measureDiversity(plans, 0.3);
    expect(result.jaccardDistance).toBe(0);
    expect(result.normalizedEntropy).toBe(0);
    expect(result.compositeScore).toBe(0);
  });
});
