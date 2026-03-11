import { generate } from "../generate/index.js";
import type { GenerateOptions } from "../generate/index.js";
import { merge } from "../merge/index.js";
import { evaluate } from "../evaluate/index.js";
import type { EvaluateOptions } from "../evaluate/index.js";
import { writePlanSet, writeMergeResult, writeEvalResult } from "./io.js";
import type { GenerateConfig, MergeConfig } from "../types/config.js";
import type { PipelineResult } from "../types/pipeline.js";

export interface RunOptions {
  readonly generateOptions: GenerateOptions;
  readonly evaluateOptions?: EvaluateOptions;
  readonly skipEval?: boolean;
  readonly signal?: AbortSignal;
}

/**
 * Run the full pipeline: generate → evaluate → merge.
 * Verify phase will be added in Phase C.
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

  // Step 3: Evaluate plans (optional — skipped when skipEval is true)
  let evalResult = undefined;
  if (!options.skipEval) {
    evalResult = await evaluate(planSet, mergeConfig, {
      ...options.evaluateOptions,
      signal: options.signal,
    });
    await writeEvalResult(evalResult, planSet.runDir);
  }

  // Step 4: Merge plans (pass evalResult for eval-informed merging)
  const mergeResult = await merge(planSet, mergeConfig, evalResult);

  // Step 5: Persist merge result
  await writeMergeResult(mergeResult, planSet.runDir);

  return { planSet, mergeResult, evalResult };
}
