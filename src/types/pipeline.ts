import type { PlanSet } from "./plan.js";
import type { MergeResult } from "./merge-result.js";
import type { GenerateConfig, MergeConfig } from "./config.js";

export interface PipelineConfig {
  readonly generate: GenerateConfig;
  readonly merge: MergeConfig;
}

export interface PipelineResult {
  readonly planSet: PlanSet;
  readonly mergeResult: MergeResult;
}
