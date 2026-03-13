import * as fs from "node:fs/promises";
import { describe, it, expect, afterAll } from "vitest";
import { generate } from "../../src/generate/index.js";
import { computePairwiseJaccard } from "../../src/evaluate/jaccard.js";
import type { GenerateConfig } from "../../src/types/config.js";
import {
  getEvalMode,
  loadGenerateConfig,
  loadMergeConfig,
  hasClaudeAuth,
  makeTempOutputDir,
} from "./helpers/runner.js";
import { extractDimensionNames, computeWordPairwiseJaccard } from "./helpers/metrics.js";
import {
  saveBaseline,
  compareBaseline,
  getCommitSha,
  type Baseline,
} from "./helpers/baseline.js";

const outputDirDiverse = makeTempOutputDir("diversity-diverse");
const outputDirHomogeneous = makeTempOutputDir("diversity-homo");

afterAll(async () => {
  for (const dir of [outputDirDiverse, outputDirHomogeneous]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

const suite = (await hasClaudeAuth()) ? describe : describe.skip;

suite("metamorphic: lens diversity", () => {
  it(
    "diverse lenses produce higher Jaccard distance than homogeneous lenses",
    async () => {
      const mode = getEvalMode();
      const genConfig = await loadGenerateConfig(mode);

      // Run A: diverse lenses (normal config — 3 different lenses)
      console.log(
        `[diversity] Run A: diverse lenses (${genConfig.variants.length} variants, model=${genConfig.model})`,
      );
      const diversePlanSet = await generate(genConfig, {
        outputDir: outputDirDiverse,
      });

      // Run B: homogeneous lenses (same guidance repeated with distinct names)
      const firstGuidance = genConfig.variants[0]?.guidance ?? "";
      const homogeneousVariants = genConfig.variants.map((v, i) => ({
        ...v,
        name: `${genConfig.variants[0]!.name}-${i + 1}`,
        guidance: firstGuidance,
      }));
      const homogeneousConfig: GenerateConfig = {
        ...genConfig,
        variants: homogeneousVariants,
      };

      console.log(
        `[diversity] Run B: homogeneous lenses (${homogeneousVariants.length} variants, same guidance)`,
      );
      const homoPlanSet = await generate(homogeneousConfig, {
        outputDir: outputDirHomogeneous,
      });

      // Compute heading-level Jaccard (for baseline storage)
      const diverseHeadingJaccard = computePairwiseJaccard(diversePlanSet.plans);
      const homoHeadingJaccard = computePairwiseJaccard(homoPlanSet.plans);

      console.log(`[diversity] Heading Jaccard — diverse: ${diverseHeadingJaccard.mean.toFixed(4)}, homo: ${homoHeadingJaccard.mean.toFixed(4)}`);

      // Compute word-level Jaccard (for assertion — much stronger signal than heading-level)
      const diverseWordJaccard = computeWordPairwiseJaccard(
        diversePlanSet.plans.map((p) => ({ name: p.variant.name, content: p.content })),
      );
      const homoWordJaccard = computeWordPairwiseJaccard(
        homoPlanSet.plans.map((p) => ({ name: p.variant.name, content: p.content })),
      );

      const diverseWordDistance = 1 - diverseWordJaccard.mean;
      const homoWordDistance = 1 - homoWordJaccard.mean;

      console.log(`[diversity] Word Jaccard — diverse similarity: ${diverseWordJaccard.mean.toFixed(4)}, homo similarity: ${homoWordJaccard.mean.toFixed(4)}`);
      console.log(`[diversity] Word distance — diverse: ${diverseWordDistance.toFixed(4)}, homo: ${homoWordDistance.toFixed(4)}`);
      console.log(
        `[diversity] Delta: ${(diverseWordDistance - homoWordDistance).toFixed(4)}`,
      );

      // Metamorphic assertion: homogeneous lenses produce higher word overlap than diverse.
      // With functioning guidance, diverse plans use different vocabulary (architecture vs
      // risk vs testing) while homogeneous plans share more common terms.
      //
      // We assert homo similarity > diverse similarity with a minimum delta to avoid
      // false positives from LLM randomness. Empirically: with guidance delta ≈ 0.018,
      // without guidance delta ≈ 0.009 (noise). Threshold of 0.01 catches regressions.
      const MIN_SIMILARITY_DELTA = 0.01;
      const similarityDelta = homoWordJaccard.mean - diverseWordJaccard.mean;

      console.log(
        `[diversity] Similarity delta (homo - diverse): ${similarityDelta.toFixed(4)} (min required: ${MIN_SIMILARITY_DELTA})`,
      );

      expect(
        similarityDelta,
        `Homogeneous lenses should produce higher word similarity than diverse lenses. ` +
          `Got delta ${similarityDelta.toFixed(4)}, need ≥ ${MIN_SIMILARITY_DELTA}. ` +
          `This may indicate guidance is not influencing plan content.`,
      ).toBeGreaterThanOrEqual(MIN_SIMILARITY_DELTA);

      // Baseline save/compare (opt-in via env vars)
      const saveBaselineName = process.env["EVAL_SAVE_BASELINE"];
      const compareBaselineName = process.env["EVAL_COMPARE_BASELINE"];

      if (saveBaselineName || compareBaselineName) {
        const mergeConfig = await loadMergeConfig(mode);
        const dimensionNames = extractDimensionNames(mergeConfig.dimensions);

        // We don't have a merged plan in this test, so dimension coverage is empty
        const dimCoverage: Record<string, boolean> = {};
        for (const dim of dimensionNames) {
          dimCoverage[dim] = false;
        }

        if (saveBaselineName) {
          const baseline: Baseline = {
            name: saveBaselineName,
            mode,
            timestamp: new Date().toISOString(),
            commitSha: getCommitSha(),
            model: genConfig.model,
            jaccardMean: diverseHeadingJaccard.mean,
            jaccardDistance: diverseWordDistance,
            jaccardPairs: diverseHeadingJaccard.pairs,
            dimensionCoverage: dimCoverage,
            configPaths: {
              generate: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/config.yaml`,
              merge: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/merge-config.yaml`,
            },
          };

          const planContents = new Map(
            diversePlanSet.plans.map((p) => [p.variant.name, p.content]),
          );

          const dir = await saveBaseline(baseline, planContents, "");
          console.log(`[diversity] Baseline saved to ${dir}`);
        }

        if (compareBaselineName) {
          const table = await compareBaseline(compareBaselineName, {
            jaccardDistance: diverseWordDistance,
            dimensionCoverage: dimCoverage,
            model: genConfig.model,
          });
          console.log(`\n${table}`);
        }
      }
    },
    600_000,
  );
});
