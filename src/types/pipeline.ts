import type { DiversityResult } from "./diversity.js";
import type { PlanSet } from "./plan.js";
import type { MergeResult } from "./merge-result.js";
import type { GenerateConfig, MergeConfig } from "./config.js";
import type { EvalResult, VerifyResult } from "./evaluation.js";

export interface PipelineConfig {
  readonly generate: GenerateConfig;
  readonly merge: MergeConfig;
}

export interface PipelineResult {
  readonly planSet: PlanSet;
  readonly mergeResult: MergeResult;
  readonly evalResult?: EvalResult;
  readonly verifyResult?: VerifyResult;
  readonly diversityResult?: DiversityResult;
}
