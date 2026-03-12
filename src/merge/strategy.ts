import type { PlanSet } from "../types/plan.js";
import type { MergeConfig } from "../types/config.js";
import type { MergeResult } from "../types/merge-result.js";
import type { EvalResult } from "../types/evaluation.js";
import type { OnStatusMessage } from "../monitor/types.js";

/** Interface for all merge strategies */
export interface MergeStrategy {
  readonly name: "simple" | "agent-teams" | "subagent-debate";

  merge(
    plans: PlanSet,
    config: MergeConfig,
    mergePlanPath: string,
    evalResult?: EvalResult,
    onStatusMessage?: OnStatusMessage,
  ): Promise<MergeResult>;
}
