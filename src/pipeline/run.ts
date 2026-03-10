import { generate } from "../generate/index.js";
import type { GenerateOptions } from "../generate/index.js";
import { merge } from "../merge/index.js";
import { writePlanSet, writeMergeResult } from "./io.js";
import type { GenerateConfig, MergeConfig } from "../types/config.js";
import type { PipelineResult } from "../types/pipeline.js";

export interface RunOptions {
  readonly generateOptions: GenerateOptions;
  readonly signal?: AbortSignal;
}

/**
 * Run the full pipeline: generate → merge.
 * Evaluate and verify phases will be added in Phase C.
 */
export async function runPipeline(
  genConfig: GenerateConfig,
  mergeConfig: MergeConfig,
  options: RunOptions,
): Promise<PipelineResult> {
  // Step 1: Generate plans
  const planSet = await generate(genConfig, {
    ...options.generateOptions,
    signal: options.signal,
  });

  // Step 2: Persist generated plans
  await writePlanSet(planSet, planSet.runDir);

  // Step 3: Merge plans
  const mergeResult = await merge(planSet, mergeConfig);

  // Step 4: Persist merge result
  await writeMergeResult(mergeResult, planSet.runDir);

  return { planSet, mergeResult };
}
