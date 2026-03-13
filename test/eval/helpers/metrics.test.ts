import { describe, it, expect } from "vitest";
import {
  extractAllHeadings,
  extractDimensionNames,
  checkDimensionCoverage,
  extractSignificantWords,
  computeWordPairwiseJaccard,
  formatComparisonTable,
} from "./metrics.js";

describe("extractAllHeadings", () => {
  it("extracts headings at all levels", () => {
    const md = "# Top\n## Section\n### Sub\nText\n## Another";
    expect(extractAllHeadings(md)).toEqual([
      "top",
      "section",
      "sub",
      "another",
    ]);
  });

  it("returns empty array for no headings", () => {
    expect(extractAllHeadings("Just text.")).toEqual([]);
  });

  it("handles headings with markdown formatting", () => {
    const md = "## **Bold heading**\n## `Code heading`";
    expect(extractAllHeadings(md)).toEqual(["**bold heading**", "`code heading`"]);
  });
});

describe("extractDimensionNames", () => {
  it("extracts from plain string dimensions", () => {
    expect(extractDimensionNames(["Architecture", "Risk"])).toEqual([
      "Architecture",
      "Risk",
    ]);
  });

  it("extracts from weighted dimensions", () => {
    expect(
      extractDimensionNames([
        { name: "Architecture", weight: 3 },
        { name: "Risk", weight: 1 },
      ]),
    ).toEqual(["Architecture", "Risk"]);
  });

  it("handles mixed dimensions", () => {
    expect(
      extractDimensionNames([
        "Architecture",
        { name: "Risk", weight: 2 },
      ]),
    ).toEqual(["Architecture", "Risk"]);
  });
});

describe("checkDimensionCoverage", () => {
  it("finds dimensions present as headings", () => {
    const md = "## Architecture\nDetails\n## Risk Management\nDetails";
    const result = checkDimensionCoverage(md, [
      "Architecture",
      "Risk Management",
    ]);
    expect(result).toEqual({
      Architecture: true,
      "Risk Management": true,
    });
  });

  it("detects missing dimensions", () => {
    const md = "## Architecture\nDetails";
    const result = checkDimensionCoverage(md, [
      "Architecture",
      "Risk Management",
    ]);
    expect(result).toEqual({
      Architecture: true,
      "Risk Management": false,
    });
  });

  it("matches case-insensitively and as substrings", () => {
    const md = "## System Architecture Overview\n## risk management plan";
    const result = checkDimensionCoverage(md, [
      "Architecture",
      "Risk Management",
    ]);
    expect(result).toEqual({
      Architecture: true,
      "Risk Management": true,
    });
  });
});

describe("extractSignificantWords", () => {
  it("extracts lowercased words ≥4 chars", () => {
    const words = extractSignificantWords("The quick Brown Fox jumps over the lazy Dog");
    expect(words).toContain("quick");
    expect(words).toContain("brown");
    expect(words).toContain("jumps");
    expect(words).toContain("over");
    expect(words).toContain("lazy");
    expect(words).not.toContain("the");
    expect(words).not.toContain("fox");
    expect(words).not.toContain("dog");
  });

  it("returns empty set for short text", () => {
    expect(extractSignificantWords("a b c").size).toBe(0);
  });

  it("handles technical content", () => {
    const words = extractSignificantWords("REST API migration with rollback strategy");
    expect(words).toContain("rest");
    expect(words).toContain("migration");
    expect(words).toContain("with");
    expect(words).toContain("rollback");
    expect(words).toContain("strategy");
  });
});

describe("computeWordPairwiseJaccard", () => {
  it("computes word-level similarity between plans", () => {
    const result = computeWordPairwiseJaccard([
      { name: "a", content: "architecture components data flow integration" },
      { name: "b", content: "architecture components system design patterns" },
    ]);
    expect(result.mean).toBeGreaterThan(0);
    expect(result.mean).toBeLessThan(1);
    expect(result.pairs).toHaveLength(1);
  });

  it("identical content yields similarity 1", () => {
    const result = computeWordPairwiseJaccard([
      { name: "a", content: "architecture components data flow" },
      { name: "b", content: "architecture components data flow" },
    ]);
    expect(result.mean).toBe(1);
  });

  it("completely different content yields low similarity", () => {
    const result = computeWordPairwiseJaccard([
      { name: "a", content: "architecture components integration services" },
      { name: "b", content: "rollback failure monitoring alerts" },
    ]);
    expect(result.mean).toBe(0);
  });
});

describe("formatComparisonTable", () => {
  it("formats a comparison table", () => {
    const table = formatComparisonTable(
      {
        jaccardDistance: 0.42,
        dimensionCoverage: { Architecture: true, Risk: true },
        model: "opus",
      },
      {
        jaccardDistance: 0.38,
        dimensionCoverage: { Architecture: true, Risk: false },
        model: "opus",
      },
    );
    expect(table).toContain("Jaccard distance");
    expect(table).toContain("0.42");
    expect(table).toContain("0.38");
    expect(table).toContain("Architecture");
    expect(table).toContain("REGRESSION");
  });

  it("warns on model mismatch", () => {
    const table = formatComparisonTable(
      {
        jaccardDistance: 0.4,
        dimensionCoverage: {},
        model: "opus",
      },
      {
        jaccardDistance: 0.4,
        dimensionCoverage: {},
        model: "haiku",
      },
    );
    expect(table).toContain("Warning");
  });
});
