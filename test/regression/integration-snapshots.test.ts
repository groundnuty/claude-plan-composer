import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../../src/pipeline/config-resolver.js";
import { materializeConfig } from "../../src/generate/index.js";
import { buildPrompts } from "../../src/generate/prompt-builder.js";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import {
  buildHolisticMergePrompt,
  buildPairwiseMergePrompt,
} from "../../src/merge/prompt-builder.js";
import type { GenerateConfig } from "../../src/types/config.js";
import { makePlan, makePlanSet } from "../helpers/factories.js";

const fixturesPath = fileURLToPath(new URL("../fixtures", import.meta.url));
const RUN_DIR = "/tmp/test-run";
const MERGE_PATH = "/tmp/test-run/merged.md";

/** Resolve fixture-relative paths in config to absolute paths. */
function absolutifyPromptPaths(config: GenerateConfig): GenerateConfig {
  return {
    ...config,
    ...(config.prompt ? { prompt: path.join(fixturesPath, config.prompt) } : {}),
    ...(config.context ? { context: path.join(fixturesPath, config.context) } : {}),
    variants: config.variants.map((v) => ({
      ...v,
      ...(v.promptFile ? { promptFile: path.join(fixturesPath, v.promptFile) } : {}),
    })),
  };
}

// -----------------------------------------------------------------------
// Generate pipeline
// -----------------------------------------------------------------------

describe("generate pipeline integration snapshots", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CPC_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("config.yaml -> resolve -> materialize -> buildPrompts", async () => {
    const raw = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config.yaml"),
    });
    const config = absolutifyPromptPaths(raw);
    const mat = await materializeConfig(config);
    const prompts = buildPrompts(
      mat.basePrompt,
      mat.context,
      config.variants,
      mat.variantPromptContents,
      config,
      RUN_DIR,
    );
    expect(prompts.map((p) => p.fullPrompt)).toMatchSnapshot();
  });

  it("config-with-prompt-file.yaml -> per-variant prompt_file flows through", async () => {
    const raw = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config-with-prompt-file.yaml"),
    });
    const config = absolutifyPromptPaths(raw);
    const mat = await materializeConfig(config);
    const prompts = buildPrompts(
      mat.basePrompt,
      mat.context,
      config.variants,
      mat.variantPromptContents,
      config,
      RUN_DIR,
    );
    expect(prompts.map((p) => p.fullPrompt)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// Evaluate pipeline
// -----------------------------------------------------------------------

describe("evaluate pipeline integration snapshots", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CPC_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("merge-config.yaml -> resolve -> buildEvalPrompt", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
    });
    const plans = [
      makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan." }),
      makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan." }),
    ];
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// Merge pipeline
// -----------------------------------------------------------------------

describe("merge pipeline integration snapshots", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CPC_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  const plans = makePlanSet([
    makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan." }),
    makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan." }),
  ]);

  it("merge-config.yaml holistic -> buildHolisticMergePrompt", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
    });
    expect(buildHolisticMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });

  it("merge-config.yaml pairwise override -> buildPairwiseMergePrompt", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
      cliOverrides: { comparisonMethod: "pairwise" },
    });
    expect(buildPairwiseMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });
});

// Note: buildVerifyPrompt takes no config parameter, so there is no
// config -> prompt integration path. Verify prompt snapshots are covered
// in prompt-snapshots.test.ts only.
