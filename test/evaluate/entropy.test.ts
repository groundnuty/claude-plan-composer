import { describe, it, expect } from "vitest";
import {
  computeShannonEntropy,
  extractOrderedWords,
  computeNormalizedEntropy,
} from "../../src/evaluate/entropy.js";
import type { EntropyResult } from "../../src/evaluate/entropy.js";

describe("extractOrderedWords", () => {
  it("extracts lowercased words ≥4 chars preserving order and duplicates", () => {
    const words = extractOrderedWords("The quick Brown Fox quick Fox");
    expect(words).toEqual(["quick", "brown", "quick"]);
  });

  it("returns empty array for text with no significant words", () => {
    expect(extractOrderedWords("a b c")).toEqual([]);
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

  it("computes entropy for uniform distribution", () => {
    // 4 unique unigrams, each appearing once → H = log2(4) = 2.0
    const result = computeShannonEntropy(["alpha beta gamma delta"], [1]);
    expect(result.perNgram["1"]).toBeCloseTo(2.0, 5);
    expect(result.mean).toBeCloseTo(2.0, 5);
  });

  it("uses string keys for JSON compatibility", () => {
    const result = computeShannonEntropy(["alpha beta gamma delta"], [1, 2]);
    expect(Object.keys(result.perNgram)).toEqual(["1", "2"]);
  });

  it("computes lower entropy for skewed distribution", () => {
    const result = computeShannonEntropy(
      ["alpha alpha alpha alpha beta"],
      [1],
    );
    expect(result.perNgram["1"]).toBeLessThan(1.0);
    expect(result.perNgram["1"]).toBeGreaterThan(0);
  });

  it("defaults to n-gram sizes [1, 2, 3]", () => {
    const result = computeShannonEntropy(["alpha beta gamma delta epsilon"]);
    expect(Object.keys(result.perNgram).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("computeNormalizedEntropy", () => {
  it("returns zero for empty input", () => {
    const result = computeNormalizedEntropy([]);
    expect(result.mean).toBe(0);
    expect(result.perNgram).toEqual({});
  });

  it("returns 1 for perfectly uniform distribution", () => {
    // 4 unique unigrams, each appearing once → H = log2(4) / log2(4) = 1.0
    const result = computeNormalizedEntropy(["alpha beta gamma delta"], [1]);
    expect(result.perNgram["1"]).toBeCloseTo(1.0, 5);
  });

  it("returns value < 1 for skewed distribution", () => {
    const result = computeNormalizedEntropy(
      ["alpha alpha alpha alpha beta"],
      [1],
    );
    expect(result.perNgram["1"]).toBeLessThan(1.0);
    expect(result.perNgram["1"]).toBeGreaterThan(0);
  });

  it("returns 0 when V <= 1 (single unique n-gram)", () => {
    const result = computeNormalizedEntropy(["alpha alpha alpha alpha"], [1]);
    expect(result.perNgram["1"]).toBe(0);
  });

  it("computes mean across n-gram sizes", () => {
    const result = computeNormalizedEntropy(
      ["alpha beta gamma delta epsilon"],
      [1, 2, 3],
    );
    const values = Object.values(result.perNgram);
    const expectedMean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(result.mean).toBeCloseTo(expectedMean, 10);
  });

  it("all values are in [0, 1]", () => {
    const result = computeNormalizedEntropy(
      ["alpha beta gamma delta epsilon zeta eta theta"],
      [1, 2, 3],
    );
    for (const v of Object.values(result.perNgram)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(result.mean).toBeGreaterThanOrEqual(0);
    expect(result.mean).toBeLessThanOrEqual(1);
  });
});
