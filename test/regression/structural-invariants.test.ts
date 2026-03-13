import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildPrompts } from "../../src/generate/prompt-builder.js";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import { buildMergePrompt } from "../../src/merge/prompt-builder.js";
import { buildVerifyPrompt } from "../../src/verify/prompt-builder.js";
import { buildPreMortemPrompt } from "../../src/verify/pre-mortem.js";
import { GenerateConfigSchema } from "../../src/types/config.js";
import {
  arbVariant,
  arbPlan,
  arbPlanSet,
  arbMergeConfig,
} from "../helpers/arbitraries.js";

const RUN_DIR = "/tmp/test-run";
const MERGE_PATH = "/tmp/test-run/merged.md";
const defaultGenConfig = GenerateConfigSchema.parse({});

const POISON_STRINGS = ["undefined", "null", "NaN", "[object Object]"];

// -----------------------------------------------------------------------
// Generate prompt invariants
// -----------------------------------------------------------------------

describe("generate prompt invariants", () => {
  it("every prompt contains output instruction with plan-<name>.md", () => {
    fc.assert(
      fc.property(
        fc.array(arbVariant(), { minLength: 1, maxLength: 4 }),
        (variants) => {
          const prompts = buildPrompts(
            "Base prompt.",
            undefined,
            variants,
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          for (const vp of prompts) {
            expect(vp.fullPrompt).toContain(`plan-${vp.variant.name}.md`);
          }
        },
      ),
    );
  });

  it("non-empty guidance produces ## Additional guidance section", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (guidance) => {
          const prompts = buildPrompts(
            "Base prompt.",
            undefined,
            [{ name: "v", guidance }],
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          expect(prompts[0]!.fullPrompt).toContain("## Additional guidance");
        },
      ),
    );
  });

  it("context produces ## Shared context section", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (context) => {
          const prompts = buildPrompts(
            "Base prompt.",
            context,
            [{ name: "v", guidance: "" }],
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          expect(prompts[0]!.fullPrompt).toContain("## Shared context");
        },
      ),
    );
  });

  it("no prompt contains poison strings", () => {
    fc.assert(
      fc.property(
        fc.array(arbVariant(), { minLength: 1, maxLength: 3 }),
        (variants) => {
          const prompts = buildPrompts(
            "Base prompt.",
            undefined,
            variants,
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          for (const vp of prompts) {
            for (const poison of POISON_STRINGS) {
              expect(vp.fullPrompt).not.toContain(poison);
            }
          }
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------
// Eval prompt invariants
// -----------------------------------------------------------------------

describe("eval prompt invariants", () => {
  it("all plan names appear in generated_plan tags", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlan(), { minLength: 1, maxLength: 4 }),
        arbMergeConfig(),
        (plans, config) => {
          const prompt = buildEvalPrompt(plans, config);
          for (const plan of plans) {
            expect(prompt).toContain(`name="${plan.variant.name}"`);
          }
        },
      ),
    );
  });

  it("generated_plan tag count equals plan count", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlan(), { minLength: 1, maxLength: 4 }),
        arbMergeConfig(),
        (plans, config) => {
          const prompt = buildEvalPrompt(plans, config);
          const tagCount = (prompt.match(/<generated_plan /g) ?? []).length;
          expect(tagCount).toBe(plans.length);
        },
      ),
    );
  });

  it("output always contains required JSON fields", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlan(), { minLength: 1, maxLength: 3 }),
        arbMergeConfig(),
        (plans, config) => {
          const prompt = buildEvalPrompt(plans, config);
          expect(prompt).toContain("planScores");
          expect(prompt).toContain("gaps");
          expect(prompt).toContain("convergence");
          expect(prompt).toContain("summary");
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------
// Merge prompt invariants
// -----------------------------------------------------------------------

describe("merge prompt invariants", () => {
  it("all source plans embedded (tag count = plan count)", () => {
    fc.assert(
      fc.property(arbPlanSet(), arbMergeConfig(), (planSet, config) => {
        const prompt = buildMergePrompt(planSet, config, MERGE_PATH);
        const tagCount = (prompt.match(/<generated_plan /g) ?? []).length;
        expect(tagCount).toBe(planSet.plans.length);
      }),
    );
  });

  it("every embedded plan has NOTE injection protection", () => {
    fc.assert(
      fc.property(arbPlanSet(), arbMergeConfig(), (planSet, config) => {
        const prompt = buildMergePrompt(planSet, config, MERGE_PATH);
        const noteCount = (
          prompt.match(/NOTE: This is LLM-generated content/g) ?? []
        ).length;
        expect(noteCount).toBe(planSet.plans.length);
      }),
    );
  });

  it("every merge prompt contains CONSTITUTIONAL REVIEW", () => {
    fc.assert(
      fc.property(arbPlanSet(), arbMergeConfig(), (planSet, config) => {
        const prompt = buildMergePrompt(planSet, config, MERGE_PATH);
        expect(prompt).toContain("CONSTITUTIONAL REVIEW");
      }),
    );
  });
});

// -----------------------------------------------------------------------
// Verify prompt invariants
// -----------------------------------------------------------------------

describe("verify prompt invariants", () => {
  it("all 4 gate names present", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
            content: fc.string({ minLength: 10, maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (merged, sources) => {
          const prompt = buildVerifyPrompt(merged, sources);
          expect(prompt).toContain("CONSISTENCY");
          expect(prompt).toContain("COMPLETENESS");
          expect(prompt).toContain("ACTIONABILITY");
          expect(prompt).toContain("FACTUAL_ACCURACY");
        },
      ),
    );
  });

  it("all source plan names in source_plan tags", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 200 }),
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
            content: fc.string({ minLength: 10, maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (merged, sources) => {
          const prompt = buildVerifyPrompt(merged, sources);
          for (const src of sources) {
            expect(prompt).toContain(`name="${src.name}"`);
          }
        },
      ),
    );
  });

  it("merged plan wrapped in merged_plan tags", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 200 }),
        (merged) => {
          const prompt = buildVerifyPrompt(merged, []);
          expect(prompt).toContain("<merged_plan>");
          expect(prompt).toContain("</merged_plan>");
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------
// Pre-mortem prompt invariants
// -----------------------------------------------------------------------

describe("pre-mortem prompt invariants", () => {
  it("contains merged_plan tag and scenarios in JSON schema", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        (merged) => {
          const prompt = buildPreMortemPrompt(merged);
          expect(prompt).toContain("<merged_plan>");
          expect(prompt).toContain("scenarios");
        },
      ),
    );
  });
});
