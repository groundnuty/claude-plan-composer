import * as fs from "node:fs/promises";
import { query, type AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import type { MergeResult, MergeMetadata } from "../../types/merge-result.js";
import type { Plan, PlanSet } from "../../types/plan.js";
import type { MergeConfig } from "../../types/config.js";
import type { EvalResult } from "../../types/evaluation.js";
import { MergeError } from "../../types/errors.js";
import { NdjsonLogger } from "../../pipeline/logger.js";
import { SessionProgress } from "../../pipeline/progress.js";
import type { MergeStrategy } from "../strategy.js";
import { embedPlan, buildMergeOutputInstruction } from "../prompt-builder.js";

/** Build advocate prompt — each advocate champions one plan */
function buildAdvocatePrompt(
  plan: Plan,
  allPlans: PlanSet,
  config: MergeConfig,
): string {
  const otherPlans = allPlans.plans
    .filter((p) => p.variant.name !== plan.variant.name)
    .map((p) => `- ${p.variant.name}`)
    .join("\n");

  const dimensionList = config.dimensions
    .map((d) =>
      typeof d === "string" ? `- ${d}` : `- ${d.name} (weight: ${d.weight})`,
    )
    .join("\n");

  return `You are an advocate for the "${plan.variant.name}" plan.

## Your plan
${embedPlan(plan)}

## Other plans under consideration
${otherPlans}

## Dimensions for comparison
${dimensionList}

## Instructions
${config.advocateInstructions}

Additionally:
- Identify at least 2 weaknesses in your OWN plan
- Identify at least 2 strengths in a COMPETING plan
- Be specific — cite exact sections and trade-offs
- Structure your response by dimension`;
}

/** Build lead agent prompt for orchestrating the debate */
function buildLeadPrompt(
  plans: PlanSet,
  config: MergeConfig,
  mergePlanPath: string,
  _evalResult?: EvalResult,
): string {
  const dimensionList = config.dimensions
    .map((d) =>
      typeof d === "string" ? `- ${d}` : `- ${d.name} (weight: ${d.weight})`,
    )
    .join("\n");
  const constitutionRules = config.constitution
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");

  return `You are the lead analyst in a structured debate about ${plans.plans.length} plans for ${config.projectDescription || "the project"}.

You have ${plans.plans.length} advocate subagents, each championing one plan. Your role:

1. Dispatch each advocate to present their plan's case
2. Review their arguments across these dimensions:
${dimensionList}
3. For each dimension, classify disagreements:
   - GENUINE TRADE-OFF / COMPLEMENTARY / ARBITRARY DIVERGENCE
4. Produce a comparison table with winner + justification per dimension
5. Synthesize a MERGED PLAN taking the best of each
   - ${config.outputGoal}
6. Scan for unique insights from each plan
7. Verify against quality principles:
${constitutionRules}

${buildMergeOutputInstruction(config, mergePlanPath)}`;
}

export class SubagentDebateStrategy implements MergeStrategy {
  readonly name = "subagent-debate" as const;

  async merge(
    plans: PlanSet,
    config: MergeConfig,
    mergePlanPath: string,
    evalResult?: EvalResult,
  ): Promise<MergeResult> {
    // Define one advocate subagent per plan
    const agents: Record<string, AgentDefinition> = {};

    for (const plan of plans.plans) {
      agents[`advocate-${plan.variant.name}`] = {
        description: `Advocate for the ${plan.variant.name} plan. Champion its strengths, challenge competitors.`,
        prompt: buildAdvocatePrompt(plan, plans, config),
        tools: ["Read", "Grep", "Glob"],
        model: "sonnet",
        maxTurns: 10,
      };
    }

    const leadPrompt = buildLeadPrompt(
      plans,
      config,
      mergePlanPath,
      evalResult,
    );
    const logPath = mergePlanPath.replace(/\.md$/, ".log");
    const logger = new NdjsonLogger(logPath);
    const messages: unknown[] = [];
    const progress = new SessionProgress("merge:subagent-debate");

    try {
      for await (const msg of query({
        prompt: leadPrompt,
        options: {
          model: config.model,
          maxTurns: config.maxTurns,
          maxBudgetUsd: config.budgetUsd,
          tools: ["Read", "Write", "Agent"],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          cwd: config.workDir || undefined,
          settingSources: config.settingSources,
          strictMcpConfig: config.strictMcp,
          persistSession: false,
          agents,
          env: {
            ...process.env,
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
            CLAUDECODE: "",
          },
        },
      })) {
        messages.push(msg);
        progress.onMessage(msg);
        await logger.write(msg);
      }
    } finally {
      await logger.close();
    }

    // Extract result
    const resultMsg = messages.find(
      (m: any) => m.type === "result" && m.subtype === "success",
    ) as any;

    if (!resultMsg) {
      throw new MergeError(
        "Subagent-debate session did not produce a success result",
      );
    }

    let content: string;
    try {
      content = await fs.readFile(mergePlanPath, "utf-8");
    } catch {
      throw new MergeError(
        "Subagent-debate session did not write the merged plan file",
      );
    }

    const modelKeys = Object.keys(resultMsg.modelUsage ?? {});
    const firstModel = modelKeys[0] ?? "unknown";
    const modelUsage = resultMsg.modelUsage?.[firstModel];

    const metadata: MergeMetadata = {
      model: firstModel,
      turns: resultMsg.num_turns ?? 0,
      durationMs: resultMsg.duration_ms ?? 0,
      durationApiMs: resultMsg.duration_api_ms ?? 0,
      tokenUsage: {
        inputTokens: modelUsage?.inputTokens ?? 0,
        outputTokens: modelUsage?.outputTokens ?? 0,
        cacheReadInputTokens: modelUsage?.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: modelUsage?.cacheCreationInputTokens ?? 0,
        costUsd: modelUsage?.costUSD ?? 0,
      },
      costUsd: resultMsg.total_cost_usd ?? 0,
      stopReason: resultMsg.stop_reason ?? null,
      sessionId: resultMsg.session_id ?? "",
      sourcePlans: plans.plans.length,
      totalCostUsd: resultMsg.total_cost_usd ?? 0,
    };

    return {
      content,
      comparison: [],
      strategy: this.name,
      metadata,
    };
  }
}
