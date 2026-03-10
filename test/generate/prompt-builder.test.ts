import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  buildOutputInstruction,
  buildVariantPrompts,
  buildMultiFilePrompts,
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
});

describe("buildVariantPrompts", () => {
  const basePrompt = "Create a deployment plan for the API service.";

  const variants: readonly Variant[] = [
    { name: "baseline", guidance: "" },
    { name: "depth", guidance: "Go deep on implementation specifics." },
    { name: "breadth", guidance: "Take a wide view." },
  ];

  it("includes base prompt in all variants", () => {
    const results = buildVariantPrompts(
      basePrompt,
      variants,
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).toContain(basePrompt);
    }
  });

  it("adds guidance section when guidance is non-empty", () => {
    const results = buildVariantPrompts(
      basePrompt,
      variants,
      defaultConfig,
      RUN_DIR,
    );
    const depth = results.find((r) => r.variant.name === "depth");
    expect(depth).toBeDefined();
    expect(depth!.fullPrompt).toContain("## Additional guidance");
    expect(depth!.fullPrompt).toContain(
      "Go deep on implementation specifics.",
    );
  });

  it("omits guidance section when guidance is empty", () => {
    const results = buildVariantPrompts(
      basePrompt,
      variants,
      defaultConfig,
      RUN_DIR,
    );
    const baseline = results.find((r) => r.variant.name === "baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.fullPrompt).not.toContain("## Additional guidance");
  });

  it("sets correct planPath for each variant", () => {
    const results = buildVariantPrompts(
      basePrompt,
      variants,
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      const expected = path.join(RUN_DIR, `plan-${vp.variant.name}.md`);
      expect(vp.planPath).toBe(expected);
    }
  });
});

describe("buildMultiFilePrompts", () => {
  const promptFiles = [
    { name: "architecture", content: "Analyze the system architecture." },
    { name: "security", content: "Review security posture." },
  ];

  it("uses file content as base prompt", () => {
    const results = buildMultiFilePrompts(
      promptFiles,
      undefined,
      defaultConfig,
      RUN_DIR,
    );
    for (let i = 0; i < promptFiles.length; i++) {
      expect(results[i]!.fullPrompt).toContain(promptFiles[i]!.content);
    }
  });

  it("appends shared context when provided", () => {
    const context = "The project uses Node.js 22 and PostgreSQL 16.";
    const results = buildMultiFilePrompts(
      promptFiles,
      context,
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).toContain("## Shared context");
      expect(vp.fullPrompt).toContain(context);
    }
  });

  it("omits context section when undefined", () => {
    const results = buildMultiFilePrompts(
      promptFiles,
      undefined,
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).not.toContain("## Shared context");
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
