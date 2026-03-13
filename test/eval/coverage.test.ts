import * as fs from "node:fs/promises";
import { describe, it, expect, afterAll } from "vitest";
import { runPipeline } from "../../src/pipeline/run.js";
import { computePairwiseJaccard } from "../../src/evaluate/jaccard.js";
import {
  getEvalMode,
  loadGenerateConfig,
  loadMergeConfig,
  hasClaudeAuth,
  makeTempOutputDir,
} from "./helpers/runner.js";
import {
  extractDimensionNames,
  checkDimensionCoverage,
  computeRetentionScore,
} from "./helpers/metrics.js";
import {
  saveBaseline,
  compareBaseline,
  getCommitSha,
  type Baseline,
} from "./helpers/baseline.js";

const outputDir = makeTempOutputDir("coverage");

afterAll(async () => {
  try {
    await fs.rm(outputDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

const suite = (await hasClaudeAuth()) ? describe : describe.skip;

suite("metamorphic: dimension coverage", () => {
  it(
    "merged plan covers all configured dimensions",
    async () => {
      const mode = getEvalMode();
      const genConfig = await loadGenerateConfig(mode);
      const mergeConfig = await loadMergeConfig(mode);

      console.log(
        `[coverage] Running full pipeline (model=${genConfig.model}, ` +
          `${genConfig.variants.length} variants, strategy=${mergeConfig.strategy})`,
      );

      const result = await runPipeline(genConfig, mergeConfig, {
        generateOptions: { outputDir },
      });

      const mergedContent = result.mergeResult.content;
      const dimensionNames = extractDimensionNames(mergeConfig.dimensions);
      const coverage = checkDimensionCoverage(mergedContent, dimensionNames);

      // Log results
      console.log("[coverage] Dimension coverage:");
      for (const [dim, found] of Object.entries(coverage)) {
        console.log(`  ${found ? "FOUND" : "MISSING"}: ${dim}`);
      }

      // Assert all dimensions covered
      for (const dim of dimensionNames) {
        expect(
          coverage[dim],
          `Merged plan missing dimension: ${dim}`,
        ).toBe(true);
      }

      // Compute Jaccard for baseline storage
      const jaccard = computePairwiseJaccard(result.planSet.plans);
      const jaccardDistance = 1 - jaccard.mean;
      console.log(`[coverage] Jaccard distance: ${jaccardDistance.toFixed(4)}`);

      // Compute content retention
      const retention = computeRetentionScore(
        result.planSet.plans.map((p) => ({ name: p.variant.name, content: p.content })),
        mergedContent,
      );

      console.log(`[coverage] Retention — overall: ${retention.overall.toFixed(4)}`);
      for (const [variant, score] of Object.entries(retention.perVariant)) {
        console.log(`  ${variant}: ${score.toFixed(4)}`);
      }
      console.log(`[coverage] Lost words: ${retention.lost.length}, Retained: ${retention.retained.length}`);

      // Baseline save/compare (opt-in via env vars)
      const saveBaselineName = process.env["EVAL_SAVE_BASELINE"];
      const compareBaselineName = process.env["EVAL_COMPARE_BASELINE"];

      if (saveBaselineName) {
        const baseline: Baseline = {
          name: saveBaselineName,
          mode,
          timestamp: new Date().toISOString(),
          commitSha: getCommitSha(),
          model: genConfig.model,
          jaccardMean: jaccard.mean,
          jaccardDistance,
          jaccardPairs: jaccard.pairs,
          dimensionCoverage: coverage,
          retentionScore: retention,
          configPaths: {
            generate: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/config.yaml`,
            merge: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/merge-config.yaml`,
          },
        };

        const planContents = new Map(
          result.planSet.plans.map((p) => [p.variant.name, p.content]),
        );

        const dir = await saveBaseline(
          baseline,
          planContents,
          mergedContent,
        );
        console.log(`[coverage] Baseline saved to ${dir}`);
      }

      if (compareBaselineName) {
        const table = await compareBaseline(compareBaselineName, {
          jaccardDistance,
          dimensionCoverage: coverage,
          model: genConfig.model,
          retentionScore: retention.overall,
        });
        console.log(`\n${table}`);
      }
    },
    600_000,
  );
});
