import * as path from "node:path";
import type { PlanSet } from "../types/plan.js";
import type { MergeConfig } from "../types/config.js";
import type { MergeResult } from "../types/merge-result.js";
import type { EvalResult } from "../types/evaluation.js";
import { MergeError } from "../types/errors.js";
import type { MergeStrategy } from "./strategy.js";
import { SimpleStrategy } from "./strategies/simple.js";
import { isValidMergeInput } from "../generate/validation.js";

/** Create a merge strategy by name */
function createStrategy(name: string): MergeStrategy {
  switch (name) {
    case "simple":
      return new SimpleStrategy();
    // Phase 4 & 5 will add:
    // case "subagent-debate": return new SubagentDebateStrategy();
    // case "agent-teams": return new AgentTeamsStrategy();
    default:
      throw new MergeError(`Unknown merge strategy: ${name}`);
  }
}

/** Main merge function */
export async function merge(
  plans: PlanSet,
  config: MergeConfig,
  evalResult?: EvalResult,
): Promise<MergeResult> {
  // Filter plans by size (skip < 1000 bytes)
  const validPlans = plans.plans.filter(p => {
    const valid = isValidMergeInput(p.content);
    if (!valid) {
      console.warn(`Warning: skipping ${p.variant.name} (< 1000 bytes)`);
    }
    return valid;
  });

  if (validPlans.length < 2) {
    throw new MergeError(
      `Need >= 2 valid plans for merge, got ${validPlans.length}`
    );
  }

  const filteredPlanSet: PlanSet = {
    ...plans,
    plans: validPlans,
  };

  const mergePlanPath = path.join(plans.runDir, "merged-plan.md");
  const strategy = createStrategy(config.strategy);
  return strategy.merge(filteredPlanSet, config, mergePlanPath, evalResult);
}

export type { MergeStrategy } from "./strategy.js";
