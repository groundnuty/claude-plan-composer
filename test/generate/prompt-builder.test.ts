import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  buildOutputInstruction,
  buildPrompts,
} from "../../src/generate/prompt-builder.js";
import {
  validatePlanOutput,
  isValidMergeInput,
} from "../../src/generate/validation.js";
import type { Variant } from "../../src/types/plan.js";
import type { GenerateConfig } from "../../src/types/config.js";
import { GenerateConfigSchema } from "../../src/types/config.js";

const RUN_DIR = "/tmp/test-run-dir";

/** Minimal valid GenerateConfig for tests (all defaults). */
const defaultConfig: GenerateConfig = GenerateConfigSchema.parse({});

describe("buildOutputInstruction", () => {
  it("includes the correct file path", () => {
    const result = buildOutputInstruction(RUN_DIR, "baseline");
    const expected = path.join(RUN_DIR, "plan-baseline.md");
    expect(result).toContain(expected);
  });

  it("includes all 6 rules", () => {
    const result = buildOutputInstruction(RUN_DIR, "v1");
    for (let i = 1; i <= 6; i++) {
      expect(result).toContain(`${i}.`);
    }
  });

  it("resolves relative runDir to absolute path", () => {
    const result = buildOutputInstruction("generated-plans/plan/run-001", "v1");
    const match = result.match(/Write the COMPLETE plan.*?\n\s+(.+\.md)/);
    expect(match).toBeTruthy();
    expect(path.isAbsolute(match![1]!)).toBe(true);
  });
});

describe("buildPrompts", () => {
  const basePrompt = "Create a deployment plan for the API service.";
  const context = "The project uses Node.js 22 and PostgreSQL 16.";

  const variants: readonly Variant[] = [
    { name: "baseline", guidance: "" },
    { name: "depth", guidance: "Go deep on implementation specifics." },
    { name: "breadth", guidance: "Take a wide view." },
  ];

  it("uses base prompt for variants without promptFile content (empty map)", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).toContain(basePrompt);
    }
  });

  it("uses variant-specific content when present in map", () => {
    const variantContent = "Override content for baseline.";
    const map = new Map([["baseline", variantContent]]);
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      map,
      defaultConfig,
      RUN_DIR,
    );
    const baseline = results.find((r) => r.variant.name === "baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.fullPrompt).toContain(variantContent);
    expect(baseline!.fullPrompt).not.toContain(basePrompt);
  });

  it("appends guidance when non-empty", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    const depth = results.find((r) => r.variant.name === "depth");
    expect(depth).toBeDefined();
    expect(depth!.fullPrompt).toContain("## Additional guidance");
    expect(depth!.fullPrompt).toContain("Go deep on implementation specifics.");
  });

  it("omits guidance section when guidance is empty", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    const baseline = results.find((r) => r.variant.name === "baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.fullPrompt).not.toContain("## Additional guidance");
  });

  it("appends context when provided (under '## Shared context' heading)", () => {
    const results = buildPrompts(
      basePrompt,
      context,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).toContain("## Shared context");
      expect(vp.fullPrompt).toContain(context);
    }
  });

  it("omits context section when undefined", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).not.toContain("## Shared context");
    }
  });

  it("appends guidance to variant with promptFile content (both applied)", () => {
    const variantContent = "Security-focused analysis prompt.";
    const guidanceVariant: Variant = {
      name: "secure",
      guidance: "Focus on threat modeling.",
    };
    const map = new Map([["secure", variantContent]]);
    const results = buildPrompts(
      basePrompt,
      undefined,
      [guidanceVariant],
      map,
      defaultConfig,
      RUN_DIR,
    );
    expect(results[0]!.fullPrompt).toContain(variantContent);
    expect(results[0]!.fullPrompt).toContain("## Additional guidance");
    expect(results[0]!.fullPrompt).toContain("Focus on threat modeling.");
  });

  it("appends context to variant with promptFile content (both applied)", () => {
    const variantContent = "Security-focused analysis prompt.";
    const map = new Map([["secure", variantContent]]);
    const results = buildPrompts(
      basePrompt,
      context,
      [{ name: "secure", guidance: "" }],
      map,
      defaultConfig,
      RUN_DIR,
    );
    expect(results[0]!.fullPrompt).toContain(variantContent);
    expect(results[0]!.fullPrompt).toContain("## Shared context");
    expect(results[0]!.fullPrompt).toContain(context);
  });

  it("sets correct planPath for each variant", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      const expected = path.join(RUN_DIR, `plan-${vp.variant.name}.md`);
      expect(vp.planPath).toBe(expected);
    }
  });

  it("produces absolute planPath even when runDir is relative", () => {
    const relativeRunDir = "generated-plans/plan/run-001";
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      relativeRunDir,
    );
    for (const vp of results) {
      expect(path.isAbsolute(vp.planPath)).toBe(true);
    }
  });

  it("embeds absolute path in output instruction even when runDir is relative", () => {
    const relativeRunDir = "generated-plans/plan/run-001";
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      relativeRunDir,
    );
    for (const vp of results) {
      // The fullPrompt must contain an absolute path for the Write tool
      const match = vp.fullPrompt.match(
        /Write the COMPLETE plan to this exact file path.*?\n\s+(.+\.md)/,
      );
      expect(match).toBeTruthy();
      expect(path.isAbsolute(match![1]!)).toBe(true);
    }
  });
});

describe("validatePlanOutput", () => {
  it("returns valid for content >= minBytes", () => {
    const content = "x".repeat(5000);
    const result = validatePlanOutput(content, 5000);
    expect(result.valid).toBe(true);
    expect(result.sizeBytes).toBe(5000);
    expect(result.error).toBeUndefined();
  });

  it("returns invalid with error for empty content", () => {
    const result = validatePlanOutput("", 5000);
    expect(result.valid).toBe(false);
    expect(result.sizeBytes).toBe(0);
    expect(result.error).toContain("not created");
  });

  it("returns invalid for content < minBytes", () => {
    const content = "x".repeat(100);
    const result = validatePlanOutput(content, 5000);
    expect(result.valid).toBe(false);
    expect(result.sizeBytes).toBe(100);
    expect(result.error).toContain("too small");
  });
});

describe("isValidMergeInput", () => {
  it("returns true for >= 1000 bytes", () => {
    expect(isValidMergeInput("a".repeat(1000))).toBe(true);
    expect(isValidMergeInput("a".repeat(2000))).toBe(true);
  });

  it("returns false for < 1000 bytes", () => {
    expect(isValidMergeInput("a".repeat(999))).toBe(false);
    expect(isValidMergeInput("")).toBe(false);
  });
});
