import { describe, it, expect } from "vitest";
import {
  extractAllHeadings,
  extractDimensionNames,
  checkDimensionCoverage,
  extractSignificantWords,
  computeWordPairwiseJaccard,
  formatComparisonTable,
  computeShannonEntropy,
  computeRetentionScore,
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

describe("computeShannonEntropy", () => {
  it("returns zero entropy for empty input", () => {
    const result = computeShannonEntropy([]);
    expect(result.mean).toBe(0);
    expect(result.perNgram).toEqual({});
  });

  it("returns zero entropy for text with no significant words", () => {
    const result = computeShannonEntropy(["a b c"]);
    expect(result.mean).toBe(0);
    expect(result.perNgram).toEqual({});
  });

  it("computes entropy for a single text with uniform distribution", () => {
    // 4 unique unigrams, each appearing once → H = log2(4) = 2.0
    const result = computeShannonEntropy(
      ["alpha beta gamma delta"],
      [1],
    );
    expect(result.perNgram[1]).toBeCloseTo(2.0, 5);
    expect(result.mean).toBeCloseTo(2.0, 5);
  });

  it("computes lower entropy for skewed distribution", () => {
    // "alpha" appears 4x, "beta" once → skewed, lower entropy
    const result = computeShannonEntropy(
      ["alpha alpha alpha alpha beta"],
      [1],
    );
    expect(result.perNgram[1]).toBeLessThan(1.0);
    expect(result.perNgram[1]).toBeGreaterThan(0);
  });

  it("computes entropy across multiple texts combined", () => {
    const resultSame = computeShannonEntropy(
      ["alpha beta gamma", "alpha beta gamma"],
      [1],
    );
    const resultDiverse = computeShannonEntropy(
      ["alpha beta gamma", "delta epsilon zeta"],
      [1],
    );
    // More diverse vocabulary → higher entropy
    expect(resultDiverse.mean).toBeGreaterThan(resultSame.mean);
  });

  it("computes bigram entropy", () => {
    // "alpha beta gamma delta" → bigrams: "alpha beta", "beta gamma", "gamma delta"
    // 3 unique bigrams, each once → H = log2(3) ≈ 1.585
    const result = computeShannonEntropy(
      ["alpha beta gamma delta"],
      [2],
    );
    expect(result.perNgram[2]).toBeCloseTo(Math.log2(3), 4);
  });

  it("computes mean across multiple n-gram sizes", () => {
    const result = computeShannonEntropy(
      ["alpha beta gamma delta epsilon"],
      [1, 2, 3],
    );
    expect(Object.keys(result.perNgram)).toHaveLength(3);
    expect(result.perNgram[1]).toBeGreaterThan(0);
    expect(result.perNgram[2]).toBeGreaterThan(0);
    expect(result.perNgram[3]).toBeGreaterThan(0);
    // Mean should be average of the three
    const values = Object.values(result.perNgram);
    const expectedMean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(result.mean).toBeCloseTo(expectedMean, 10);
  });

  it("defaults to n-gram sizes [1, 2, 3]", () => {
    const result = computeShannonEntropy(["alpha beta gamma delta epsilon"]);
    expect(Object.keys(result.perNgram).map(Number).sort()).toEqual([1, 2, 3]);
  });
});

describe("computeRetentionScore", () => {
  it("returns perfect retention when merged contains all source words", () => {
    const result = computeRetentionScore(
      [
        { name: "a", content: "architecture components integration" },
        { name: "b", content: "rollback monitoring alerts" },
      ],
      "architecture components integration rollback monitoring alerts",
    );
    expect(result.overall).toBe(1.0);
    expect(result.lost).toEqual([]);
  });

  it("detects lost words", () => {
    const result = computeRetentionScore(
      [
        { name: "a", content: "architecture components integration" },
        { name: "b", content: "rollback monitoring alerts" },
      ],
      "architecture components monitoring",
    );
    expect(result.overall).toBeLessThan(1.0);
    expect(result.overall).toBeGreaterThan(0);
    expect(result.lost).toContain("integration");
    expect(result.lost).toContain("rollback");
    expect(result.lost).toContain("alerts");
    expect(result.retained).toContain("architecture");
    expect(result.retained).toContain("components");
    expect(result.retained).toContain("monitoring");
  });

  it("computes per-variant retention", () => {
    const result = computeRetentionScore(
      [
        { name: "a", content: "architecture components" },
        { name: "b", content: "rollback monitoring" },
      ],
      "architecture components",  // only variant a's words survive
    );
    expect(result.perVariant["a"]).toBe(1.0);
    expect(result.perVariant["b"]).toBe(0);
  });

  it("returns perfect retention for empty sources", () => {
    const result = computeRetentionScore(
      [{ name: "a", content: "a b c" }],  // no significant words
      "anything here",
    );
    expect(result.overall).toBe(1.0);
    expect(result.perVariant["a"]).toBe(1.0);
  });

  it("returns sorted retained and lost arrays", () => {
    const result = computeRetentionScore(
      [{ name: "a", content: "zeta alpha beta gamma" }],
      "alpha gamma",
    );
    expect(result.retained).toEqual(["alpha", "gamma"]);
    expect(result.lost).toEqual(["beta", "zeta"]);
  });

  it("handles zero retention", () => {
    const result = computeRetentionScore(
      [{ name: "a", content: "architecture components integration" }],
      "completely different vocabulary here",
    );
    expect(result.overall).toBe(0);
  });
});
