import { generate } from "../generate/index.js";
import type { GenerateOptions } from "../generate/index.js";
import { merge } from "../merge/index.js";
import { evaluate } from "../evaluate/index.js";
import type { EvaluateOptions } from "../evaluate/index.js";
import { verify } from "../verify/index.js";
import type { VerifyOptions } from "../verify/index.js";
import {
  writePlanSet,
  writeMergeResult,
  writeEvalResult,
  writeVerifyResult,
  writeDiversityResult,
} from "./io.js";
import { measureDiversity } from "../evaluate/diversity.js";
import type { OnStatusMessage } from "../monitor/types.js";
import { NdjsonLogger } from "./logger.js";
import type { GenerateConfig, MergeConfig } from "../types/config.js";
import type { PipelineResult } from "../types/pipeline.js";

export interface RunOptions {
  readonly generateOptions: GenerateOptions;
  readonly evaluateOptions?: EvaluateOptions;
  readonly verifyOptions?: VerifyOptions;
  readonly skipEval?: boolean;
  readonly verify?: boolean;
  readonly signal?: AbortSignal;
  readonly onStatusMessage?: OnStatusMessage;
}

/**
 * Run the full pipeline: generate → evaluate → merge → verify.
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

  // Step 3: Measure diversity (always runs, even with skipEval)
  const diversityResult = measureDiversity(
    planSet.plans,
    genConfig.diversityThreshold,
  );
  await writeDiversityResult(diversityResult, planSet.runDir);

  // Log diversity metrics to NDJSON (spec: { type: "diversity", ...result })
  const diversityLogger = new NdjsonLogger(
    `${planSet.runDir}/diversity.ndjson`,
  );
  await diversityLogger.write({ type: "diversity", ...diversityResult });
  await diversityLogger.close();

  if (diversityResult.warning) {
    options.onStatusMessage?.("diversity", {
      type: "diversity_warning",
      message: diversityResult.warning,
    });
  }

  // Step 4: Evaluate plans (optional — skipped when skipEval is true)
  let evalResult = undefined;
  if (!options.skipEval) {
    evalResult = await evaluate(planSet, mergeConfig, {
      ...options.evaluateOptions,
      signal: options.signal,
    });
    await writeEvalResult(evalResult, planSet.runDir);
  }

  // Step 5: Merge plans (pass evalResult for eval-informed merging)
  const mergeResult = await merge(planSet, mergeConfig, { evalResult });

  // Step 6: Persist merge result
  await writeMergeResult(mergeResult, planSet.runDir);

  // Step 7: Verify merged plan (optional — enabled when verify flag is set)
  let verifyResult = undefined;
  if (options.verify) {
    verifyResult = await verify(mergeResult, planSet, {
      ...options.verifyOptions,
      signal: options.signal,
    });
    await writeVerifyResult(verifyResult, planSet.runDir);
  }

  return { planSet, mergeResult, evalResult, verifyResult, diversityResult };
}
