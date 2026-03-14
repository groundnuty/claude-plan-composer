import { describe, it, expect } from "vitest";
import {
  DisagreementTypeSchema,
  RecommendationSchema,
  DisagreementSchema,
  TypedResolutionSchema,
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

describe("DisagreementSchema", () => {
  const recA = {
    topic: "caching",
    position: "use Redis",
    evidence: "high throughput",
    confidence: 0.9,
  };
  const recB = {
    topic: "caching",
    position: "use Memcached",
    evidence: "simpler ops",
    confidence: 0.7,
  };
  const valid = {
    recommendationA: recA,
    recommendationB: recB,
    type: "trade-off" as const,
    dimension: "performance",
  };

  it("accepts a valid disagreement", () => {
    const result = DisagreementSchema.parse(valid);
    expect(result.recommendationA.position).toBe("use Redis");
    expect(result.recommendationB.position).toBe("use Memcached");
    expect(result.type).toBe("trade-off");
    expect(result.dimension).toBe("performance");
  });

  it("rejects invalid disagreement type", () => {
    expect(() => DisagreementSchema.parse({ ...valid, type: "invalid" })).toThrow();
  });

  it("rejects empty dimension", () => {
    expect(() => DisagreementSchema.parse({ ...valid, dimension: "" })).toThrow();
  });

  it("rejects invalid nested recommendation", () => {
    expect(() =>
      DisagreementSchema.parse({ ...valid, recommendationA: { topic: "" } }),
    ).toThrow();
  });
});

describe("TypedResolutionSchema", () => {
  const recA = {
    topic: "caching",
    position: "use Redis",
    evidence: "high throughput",
    confidence: 0.9,
  };
  const recB = {
    topic: "caching",
    position: "use Memcached",
    evidence: "simpler ops",
    confidence: 0.7,
  };
  const disagreement = {
    recommendationA: recA,
    recommendationB: recB,
    type: "trade-off" as const,
    dimension: "performance",
  };
  const valid = {
    disagreement,
    resolved: {
      topic: "caching",
      position: "use Redis with connection pooling",
      evidence: "combines throughput with simpler management",
      confidence: 0.85,
    },
    strategy: "trade-off" as const,
    rationale: "Redis wins on throughput; connection pooling addresses ops concern",
  };

  it("accepts a valid resolution", () => {
    const result = TypedResolutionSchema.parse(valid);
    expect(result.resolved.position).toBe("use Redis with connection pooling");
    expect(result.strategy).toBe("trade-off");
    expect(result.rationale).toContain("Redis wins");
  });

  it("allows strategy to differ from disagreement type", () => {
    const fallback = { ...valid, strategy: "arbitrary" as const };
    const result = TypedResolutionSchema.parse(fallback);
    expect(result.disagreement.type).toBe("trade-off");
    expect(result.strategy).toBe("arbitrary");
  });

  it("rejects empty rationale", () => {
    expect(() => TypedResolutionSchema.parse({ ...valid, rationale: "" })).toThrow();
  });

  it("rejects missing disagreement", () => {
    const { disagreement: _d, ...noDisagreement } = valid;
    expect(() => TypedResolutionSchema.parse(noDisagreement)).toThrow();
  });
});
