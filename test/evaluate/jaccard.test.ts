import { describe, it, expect } from "vitest";
import {
  extractHeadings,
  computeJaccard,
  computePairwiseJaccard,
} from "../../src/evaluate/jaccard.js";
import type { Plan } from "../../src/types/plan.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(name: string, content: string): Plan {
  return {
    variant: { name, guidance: "" },
    content,
    metadata: {
      model: "haiku",
      turns: 1,
      durationMs: 100,
      durationApiMs: 80,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0.001,
      },
      costUsd: 0.001,
      stopReason: "end_turn",
      sessionId: "test",
    },
  };
}

// ---------------------------------------------------------------------------
// extractHeadings
// ---------------------------------------------------------------------------

describe("extractHeadings", () => {
  it("extracts ## headings and lowercases them", () => {
    const md = "# Title\n## Architecture\n### Sub\n## Testing Strategy\ntext";
    const headings = extractHeadings(md);
    expect(headings).toEqual(new Set(["architecture", "testing strategy"]));
  });

  it("returns empty set for no headings", () => {
    expect(extractHeadings("just text")).toEqual(new Set());
  });

  it("handles headings with extra # symbols", () => {
    const md = "## ## Weird heading";
    const headings = extractHeadings(md);
    // "## Weird heading" after stripping leading "## "
    expect(headings.size).toBe(1);
  });

  it("deduplicates identical headings", () => {
    const md = "## Intro\ntext\n## Intro\nmore text";
    expect(extractHeadings(md).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeJaccard
// ---------------------------------------------------------------------------

describe("computeJaccard", () => {
  it("returns 1.0 for identical sets", () => {
    const s = new Set(["a", "b", "c"]);
    expect(computeJaccard(s, s)).toBe(1);
  });

  it("returns 0.0 for disjoint sets", () => {
    expect(computeJaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("returns 0.0 for two empty sets", () => {
    expect(computeJaccard(new Set(), new Set())).toBe(0);
  });

  it("returns correct value for partial overlap", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["y", "z", "w"]);
    // intersection = {y, z} = 2, union = {x, y, z, w} = 4
    expect(computeJaccard(a, b)).toBeCloseTo(0.5);
  });

  it("handles one empty set", () => {
    expect(computeJaccard(new Set(["a"]), new Set())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computePairwiseJaccard
// ---------------------------------------------------------------------------

describe("computePairwiseJaccard", () => {
  it("returns empty result for fewer than 2 plans", () => {
    const result = computePairwiseJaccard([
      makePlan("solo", "## Heading\ntext"),
    ]);
    expect(result.pairs).toEqual([]);
    expect(result.mean).toBe(0);
  });

  it("computes C(N,2) pairs for 3 plans", () => {
    const plans = [
      makePlan("a", "## Architecture\n## Testing"),
      makePlan("b", "## Architecture\n## Deployment"),
      makePlan("c", "## Security\n## Deployment"),
    ];
    const result = computePairwiseJaccard(plans);
    expect(result.pairs).toHaveLength(3); // C(3,2) = 3
    expect(result.pairs.map((p) => `${p.a}-${p.b}`)).toEqual([
      "a-b",
      "a-c",
      "b-c",
    ]);
  });

  it("returns similarity=1.0 for identical plans", () => {
    const plans = [
      makePlan("x", "## Same\n## Headings"),
      makePlan("y", "## Same\n## Headings"),
    ];
    const result = computePairwiseJaccard(plans);
    expect(result.pairs[0]!.similarity).toBe(1);
    expect(result.mean).toBe(1);
  });

  it("warns when mean > 0.8 (too similar)", () => {
    const plans = [
      makePlan("x", "## A\n## B\n## C\n## D\n## E"),
      makePlan("y", "## A\n## B\n## C\n## D\n## E"),
    ];
    const result = computePairwiseJaccard(plans);
    expect(result.warning).toContain("very similar");
  });

  it("warns when mean < 0.1 (too divergent)", () => {
    const plans = [
      makePlan("x", "## Alpha\n## Beta"),
      makePlan("y", "## Gamma\n## Delta"),
    ];
    const result = computePairwiseJaccard(plans);
    expect(result.mean).toBe(0);
    expect(result.warning).toContain("very divergent");
  });

  it("returns no warning for moderate similarity", () => {
    const plans = [
      makePlan("a", "## Architecture\n## Testing\n## Deployment"),
      makePlan("b", "## Architecture\n## Security\n## Monitoring"),
    ];
    const result = computePairwiseJaccard(plans);
    // intersection={architecture}=1, union=5, jaccard=0.2
    expect(result.warning).toBeUndefined();
  });
});
