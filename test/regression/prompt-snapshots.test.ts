import { describe, it, expect } from "vitest";
import { buildPrompts } from "../../src/generate/prompt-builder.js";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import {
  buildHolisticMergePrompt,
  buildPairwiseMergePrompt,
} from "../../src/merge/prompt-builder.js";
import { buildVerifyPrompt } from "../../src/verify/prompt-builder.js";
import { buildPreMortemPrompt } from "../../src/verify/pre-mortem.js";
import { GenerateConfigSchema } from "../../src/types/config.js";
import {
  makePlan,
  makePlanSet,
  makeDefaultMergeConfig,
  makeBinaryEvalResult,
  makeLikertEvalResult,
} from "../helpers/factories.js";

const RUN_DIR = "/tmp/test-run";
const MERGE_PATH = "/tmp/test-run/merged.md";
const defaultGenConfig = GenerateConfigSchema.parse({});

// -----------------------------------------------------------------------
// buildPrompts (generate)
// -----------------------------------------------------------------------

describe("buildPrompts snapshots", () => {
  it("minimal: base prompt only, no context, no guidance", () => {
    const result = buildPrompts(
      "Create a deployment plan.",
      undefined,
      [{ name: "baseline", guidance: "" }],
      new Map(),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });

  it("full: base prompt + context + variants with guidance", () => {
    const result = buildPrompts(
      "Create a deployment plan.",
      "Project uses Node.js 22 and PostgreSQL 16.",
      [
        { name: "baseline", guidance: "" },
        { name: "depth", guidance: "Go deep on implementation specifics." },
        { name: "breadth", guidance: "Take a wide view." },
      ],
      new Map(),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });

  it("per-variant promptFile content overrides base prompt", () => {
    const result = buildPrompts(
      "Base prompt ignored for overridden variant.",
      undefined,
      [
        { name: "security", guidance: "Focus on threats." },
        { name: "perf", guidance: "" },
      ],
      new Map([
        ["security", "Analyze from a security perspective."],
        ["perf", "Analyze performance bottlenecks."],
      ]),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });

  it("mixed: 1 from map, 2 from base, with context", () => {
    const result = buildPrompts(
      "Base deployment plan prompt.",
      "Shared project context here.",
      [
        { name: "alpha", guidance: "Alpha guidance." },
        { name: "beta", guidance: "" },
        { name: "gamma", guidance: "Gamma guidance." },
      ],
      new Map([["beta", "Custom beta prompt content."]]),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildEvalPrompt (evaluate)
// -----------------------------------------------------------------------

describe("buildEvalPrompt snapshots", () => {
  it("binary scoring, string dimensions, 2 plans", () => {
    const plans = [
      makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan content." }),
      makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan content." }),
    ];
    const config = makeDefaultMergeConfig({ evalScoring: "binary" });
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });

  it("likert scoring, weighted dimensions, 3 plans", () => {
    const plans = [
      makePlan({ variant: { name: "a", guidance: "" }, content: "Plan A." }),
      makePlan({ variant: { name: "b", guidance: "" }, content: "Plan B." }),
      makePlan({ variant: { name: "c", guidance: "" }, content: "Plan C." }),
    ];
    const config = makeDefaultMergeConfig({
      evalScoring: "likert",
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
        { name: "Readability", weight: 1 },
      ],
    });
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });

  it("mixed dimensions, single plan", () => {
    const plans = [
      makePlan({ variant: { name: "solo", guidance: "" }, content: "Solo plan." }),
    ];
    const config = makeDefaultMergeConfig({
      dimensions: ["Approach", { name: "Security", weight: 3 }],
    });
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildHolisticMergePrompt (merge)
// -----------------------------------------------------------------------

describe("buildHolisticMergePrompt snapshots", () => {
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha content." });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta content." });
  const planC = makePlan({ variant: { name: "gamma", guidance: "" }, content: "Gamma content." });

  it("default config, 2 plans, no eval", () => {
    const plans = makePlanSet([planA, planB]);
    const config = makeDefaultMergeConfig();
    expect(buildHolisticMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });

  it("weighted dims, 3 plans, binary eval", () => {
    const plans = makePlanSet([planA, planB, planC]);
    const config = makeDefaultMergeConfig({
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
        "Readability",
      ],
    });
    expect(
      buildHolisticMergePrompt(plans, config, MERGE_PATH, makeBinaryEvalResult()),
    ).toMatchSnapshot();
  });

  it("default config, 2 plans, likert eval", () => {
    const plans = makePlanSet([planA, planB]);
    const config = makeDefaultMergeConfig();
    expect(
      buildHolisticMergePrompt(plans, config, MERGE_PATH, makeLikertEvalResult()),
    ).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildPairwiseMergePrompt (merge)
// -----------------------------------------------------------------------

describe("buildPairwiseMergePrompt snapshots", () => {
  it("3 plans, unweighted", () => {
    const plans = makePlanSet([
      makePlan({ variant: { name: "a", guidance: "" }, content: "A." }),
      makePlan({ variant: { name: "b", guidance: "" }, content: "B." }),
      makePlan({ variant: { name: "c", guidance: "" }, content: "C." }),
    ]);
    const config = makeDefaultMergeConfig({ comparisonMethod: "pairwise" });
    expect(buildPairwiseMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });

  it("4 plans, weighted, with eval", () => {
    const plans = makePlanSet([
      makePlan({ variant: { name: "a", guidance: "" }, content: "A." }),
      makePlan({ variant: { name: "b", guidance: "" }, content: "B." }),
      makePlan({ variant: { name: "c", guidance: "" }, content: "C." }),
      makePlan({ variant: { name: "d", guidance: "" }, content: "D." }),
    ]);
    const config = makeDefaultMergeConfig({
      comparisonMethod: "pairwise",
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
      ],
    });
    expect(
      buildPairwiseMergePrompt(plans, config, MERGE_PATH, makeBinaryEvalResult()),
    ).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildVerifyPrompt (verify)
// -----------------------------------------------------------------------

describe("buildVerifyPrompt snapshots", () => {
  it("merged plan + 2 source plans", () => {
    expect(
      buildVerifyPrompt("# Merged Plan\nContent here.", [
        { name: "plan-A", content: "Source A content." },
        { name: "plan-B", content: "Source B content." },
      ]),
    ).toMatchSnapshot();
  });

  it("merged plan + 4 source plans", () => {
    expect(
      buildVerifyPrompt("# Merged Plan\nContent.", [
        { name: "a", content: "A." },
        { name: "b", content: "B." },
        { name: "c", content: "C." },
        { name: "d", content: "D." },
      ]),
    ).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildPreMortemPrompt (pre-mortem)
// -----------------------------------------------------------------------

describe("buildPreMortemPrompt snapshots", () => {
  it("representative merged plan", () => {
    expect(
      buildPreMortemPrompt(
        "# Implementation Plan\n\n## Phase 1\nDeploy services.\n\n## Phase 2\nMonitor and iterate.",
      ),
    ).toMatchSnapshot();
  });
});
