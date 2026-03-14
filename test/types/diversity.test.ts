import { describe, it, expect } from "vitest";
import { DiversityResultSchema } from "../../src/types/diversity.js";
import type { DiversityResult } from "../../src/types/diversity.js";

describe("DiversityResultSchema", () => {
  const validBase: DiversityResult = {
    jaccardDistance: 0.45,
    shannonEntropy: {
      perNgram: { "1": 3.2, "2": 2.8, "3": 2.1 },
      mean: 2.7,
    },
    normalizedEntropy: 0.72,
    compositeScore: 0.585,
  };

  it("accepts a valid DiversityResult without warning", () => {
    const result = DiversityResultSchema.parse(validBase);
    expect(result.compositeScore).toBe(0.585);
    expect(result.warning).toBeUndefined();
  });

  it("accepts a valid DiversityResult with warning", () => {
    const result = DiversityResultSchema.parse({
      ...validBase,
      compositeScore: 0.15,
      warning: "Low diversity detected",
    });
    expect(result.warning).toBe("Low diversity detected");
  });

  it("rejects jaccardDistance < 0", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, jaccardDistance: -0.1 }),
    ).toThrow();
  });

  it("rejects jaccardDistance > 1", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, jaccardDistance: 1.1 }),
    ).toThrow();
  });

  it("rejects normalizedEntropy < 0", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, normalizedEntropy: -0.1 }),
    ).toThrow();
  });

  it("rejects normalizedEntropy > 1", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, normalizedEntropy: 1.1 }),
    ).toThrow();
  });

  it("rejects compositeScore < 0", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, compositeScore: -0.1 }),
    ).toThrow();
  });

  it("rejects compositeScore > 1", () => {
    expect(() =>
      DiversityResultSchema.parse({ ...validBase, compositeScore: 1.1 }),
    ).toThrow();
  });

  it("accepts boundary values (0 and 1)", () => {
    const result = DiversityResultSchema.parse({
      ...validBase,
      jaccardDistance: 0,
      normalizedEntropy: 1,
      compositeScore: 0.5,
    });
    expect(result.jaccardDistance).toBe(0);
    expect(result.normalizedEntropy).toBe(1);
  });

  it("accepts empty perNgram record", () => {
    const result = DiversityResultSchema.parse({
      ...validBase,
      shannonEntropy: { perNgram: {}, mean: 0 },
    });
    expect(result.shannonEntropy.perNgram).toEqual({});
  });
});
