import { describe, it, expect } from "vitest";
import {
  DisagreementTypeSchema,
  RecommendationSchema,
} from "../../src/types/merge-formal.js";

describe("DisagreementTypeSchema", () => {
  it("accepts all four valid values", () => {
    for (const value of ["complementary", "trade-off", "arbitrary", "uncontested"]) {
      expect(DisagreementTypeSchema.parse(value)).toBe(value);
    }
  });

  it("rejects invalid values", () => {
    expect(() => DisagreementTypeSchema.parse("unknown")).toThrow();
    expect(() => DisagreementTypeSchema.parse("")).toThrow();
    expect(() => DisagreementTypeSchema.parse(42)).toThrow();
  });
});

describe("RecommendationSchema", () => {
  const valid = {
    topic: "caching strategy",
    position: "use Redis",
    evidence: "proven in high-throughput systems",
    confidence: 0.85,
  };

  it("accepts a valid recommendation", () => {
    const result = RecommendationSchema.parse(valid);
    expect(result.topic).toBe("caching strategy");
    expect(result.position).toBe("use Redis");
    expect(result.evidence).toBe("proven in high-throughput systems");
    expect(result.confidence).toBe(0.85);
  });

  it("accepts zero confidence", () => {
    expect(RecommendationSchema.parse({ ...valid, confidence: 0 }).confidence).toBe(0);
  });

  it("accepts max confidence of 1", () => {
    expect(RecommendationSchema.parse({ ...valid, confidence: 1 }).confidence).toBe(1);
  });

  it("accepts empty evidence string", () => {
    expect(RecommendationSchema.parse({ ...valid, evidence: "" }).evidence).toBe("");
  });

  it("rejects empty topic", () => {
    expect(() => RecommendationSchema.parse({ ...valid, topic: "" })).toThrow();
  });

  it("rejects empty position", () => {
    expect(() => RecommendationSchema.parse({ ...valid, position: "" })).toThrow();
  });

  it("rejects confidence below 0", () => {
    expect(() => RecommendationSchema.parse({ ...valid, confidence: -0.1 })).toThrow();
  });

  it("rejects confidence above 1", () => {
    expect(() => RecommendationSchema.parse({ ...valid, confidence: 1.1 })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => RecommendationSchema.parse({ topic: "x" })).toThrow();
  });
});
