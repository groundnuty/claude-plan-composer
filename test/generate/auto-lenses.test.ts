import { describe, it, expect } from "vitest";
import {
  buildLensPrompt,
  sanitizeLensName,
  parseLensResponse,
} from "../../src/generate/auto-lenses.js";
import { LensGenerationError } from "../../src/types/errors.js";

describe("buildLensPrompt", () => {
  const basePrompt = "Design a caching layer for the API.";

  it("includes the lens count in the prompt", () => {
    const result = buildLensPrompt(basePrompt, 5);
    expect(result).toContain("exactly 5 maximally different");
  });

  it("includes adversarial perspective instruction", () => {
    const result = buildLensPrompt(basePrompt, 3);
    expect(result).toContain("adversarial");
    expect(result).toContain("weaknesses");
  });

  it("includes the base prompt at the end", () => {
    const result = buildLensPrompt(basePrompt, 3);
    expect(result).toMatch(/The task:\n.*Design a caching layer/s);
    expect(result.trimEnd().endsWith(basePrompt)).toBe(true);
  });

  it("includes YAML format instructions", () => {
    const result = buildLensPrompt(basePrompt, 3);
    expect(result).toContain("Output ONLY valid YAML");
    expect(result).toContain("perspectives:");
    expect(result).toContain("name:");
    expect(result).toContain("guidance:");
  });
});

describe("sanitizeLensName", () => {
  it("converts to lowercase", () => {
    expect(sanitizeLensName("Risk-First")).toBe("risk-first");
  });

  it("replaces non-alphanumeric characters with dashes", () => {
    expect(sanitizeLensName("user centric")).toBe("user-centric");
    expect(sanitizeLensName("cost/benefit")).toBe("cost-benefit");
    expect(sanitizeLensName("data_driven")).toBe("data-driven");
  });

  it("collapses consecutive dashes", () => {
    expect(sanitizeLensName("a---b")).toBe("a-b");
    expect(sanitizeLensName("too   many   spaces")).toBe("too-many-spaces");
  });

  it("strips leading and trailing dashes", () => {
    expect(sanitizeLensName("-leading")).toBe("leading");
    expect(sanitizeLensName("trailing-")).toBe("trailing");
    expect(sanitizeLensName("--both--")).toBe("both");
    expect(sanitizeLensName("  spaced  ")).toBe("spaced");
  });

  it("preserves valid kebab-case names", () => {
    expect(sanitizeLensName("risk-first")).toBe("risk-first");
    expect(sanitizeLensName("user-centric")).toBe("user-centric");
    expect(sanitizeLensName("a1-b2-c3")).toBe("a1-b2-c3");
  });
});

describe("parseLensResponse", () => {
  it("parses valid YAML with perspectives", () => {
    const yaml = [
      "perspectives:",
      "  - name: risk-first",
      '    guidance: Focus on risks and mitigations.',
      "  - name: user-centric",
      '    guidance: Prioritize user experience above all.',
    ].join("\n");

    const result = parseLensResponse(yaml);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "risk-first",
      guidance: "Focus on risks and mitigations.",
    });
    expect(result[1]).toEqual({
      name: "user-centric",
      guidance: "Prioritize user experience above all.",
    });
  });

  it("strips markdown code fences before parsing", () => {
    const yaml = [
      "```yaml",
      "perspectives:",
      "  - name: cost-benefit",
      "    guidance: Weigh costs against benefits.",
      "```",
    ].join("\n");

    const result = parseLensResponse(yaml);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("cost-benefit");
  });

  it("deduplicates lens names keeping the first occurrence", () => {
    const yaml = [
      "perspectives:",
      "  - name: risk-first",
      "    guidance: First occurrence guidance.",
      "  - name: risk-first",
      "    guidance: Duplicate that should be skipped.",
    ].join("\n");

    const result = parseLensResponse(yaml);

    expect(result).toHaveLength(1);
    expect(result[0]!.guidance).toBe("First occurrence guidance.");
  });

  it("skips entries with missing name or guidance", () => {
    const yaml = [
      "perspectives:",
      "  - name: valid-one",
      "    guidance: Has both fields.",
      "  - name: no-guidance",
      "  - guidance: No name field.",
      "  - name: also-valid",
      "    guidance: Another complete entry.",
    ].join("\n");

    const result = parseLensResponse(yaml);

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("valid-one");
    expect(result[1]!.name).toBe("also-valid");
  });

  it("throws LensGenerationError when no perspectives key", () => {
    const yaml = [
      "lenses:",
      "  - name: oops",
      "    guidance: Wrong top-level key.",
    ].join("\n");

    expect(() => parseLensResponse(yaml)).toThrow(LensGenerationError);
    expect(() => parseLensResponse(yaml)).toThrow(
      "Response did not contain 'perspectives' array",
    );
  });

  it("returns empty array when all entries are invalid", () => {
    const yaml = [
      "perspectives:",
      "  - name: ''",
      "    guidance: Empty name becomes empty after sanitize.",
      "  - guidance: Missing name entirely.",
    ].join("\n");

    const result = parseLensResponse(yaml);

    expect(result).toEqual([]);
  });
});
