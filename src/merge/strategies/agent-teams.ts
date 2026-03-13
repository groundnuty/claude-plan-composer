import * as fs from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { MergeResult, MergeMetadata } from "../../types/merge-result.js";
import type { PlanSet } from "../../types/plan.js";
import type { MergeConfig } from "../../types/config.js";
import type { EvalResult } from "../../types/evaluation.js";
import { MergeError } from "../../types/errors.js";
import { NdjsonLogger } from "../../pipeline/logger.js";
import { SessionProgress } from "../../pipeline/progress.js";
import type { OnStatusMessage } from "../../monitor/types.js";
import type { MergeStrategy } from "../strategy.js";
import { formatEvalSummary } from "../prompt-builder.js";

/** Build team lead prompt — instructs lead to create advocate teammates */
function buildTeamLeadPrompt(
  plans: PlanSet,
  config: MergeConfig,
  mergePlanPath: string,
  evalResult?: EvalResult,
): string {
  const dimensionList = config.dimensions
    .map((d) =>
      typeof d === "string" ? `- ${d}` : `- ${d.name} (weight: ${d.weight})`,
    )
    .join("\n");
  const constitutionRules = config.constitution
    .map((r, i) => `${i + 1}. ${r}`)
    .join("\n");
  const evalSummary = evalResult ? formatEvalSummary(evalResult) : "";

  // Per-advocate definitions
  const advocateDefs = plans.plans
    .map((plan, i) => {
      const planFile = `plan-${plan.variant.name}.md`;
      return `- **Advocate ${i + 1} (${plan.variant.name})**: Read \`${planFile}\` and become\n  its champion. ${config.advocateInstructions}`;
    })
    .join("\n\n");

  return `# Agent Teams Merge — Competing Advocates

I have generated multiple plans for ${config.projectDescription || "the project"}.
Each plan was generated with a different focus. Your job is to merge the
best elements into one final plan.

## Instructions

Create an agent team with these teammates:

${advocateDefs}

${evalSummary}

## Team lead role

You (the lead) will:
1. Have each advocate present their plan's strengths (2-3 min each)
2. Facilitate a structured debate across these dimensions:
${dimensionList}
3. For each dimension where advocates disagree, classify the disagreement:
   - GENUINE TRADE-OFF: Present both options with trade-off analysis
   - COMPLEMENTARY: Merge both contributions
   - ARBITRARY DIVERGENCE: Pick the more specific/actionable version
4. After the debate, produce:
   - A comparison table with the winner per dimension + justification
   - A COMPLETE merged plan taking the best of each
   - ${config.outputGoal}
5. Scan each source plan for unique insights not in any other plan.
   Include valuable ones with "[Source: variant-name]".
6. Verify the merged plan against these quality principles:
${constitutionRules}
   Revise any sections that violate a principle.

## Constraints for advocates
- Use delegate mode — do NOT implement anything yourself, only coordinate
- Require advocates to READ their assigned plan file before debating
- Each advocate must identify at least 2 weaknesses in their OWN plan
- Each advocate must identify at least 2 strengths in a COMPETING plan

## Output (CRITICAL)
Write the final merged plan (titled "${config.outputTitle}") to this exact file path
using the Write tool:
  ${mergePlanPath}`;
}

export class AgentTeamsStrategy implements MergeStrategy {
  readonly name = "agent-teams" as const;

  async merge(
    plans: PlanSet,
    config: MergeConfig,
    mergePlanPath: string,
    evalResult?: EvalResult,
    onStatusMessage?: OnStatusMessage,
  ): Promise<MergeResult> {
    const prompt = buildTeamLeadPrompt(
      plans,
      config,
      mergePlanPath,
      evalResult,
    );
    const logPath = mergePlanPath.replace(/\.md$/, ".log");
    const phase = onStatusMessage?.currentPhase?.();
    const logger = new NdjsonLogger(logPath, phase);
    const messages: unknown[] = [];
    const progress = new SessionProgress("merge:agent-teams");

    try {
      for await (const msg of query({
        prompt,
        options: {
          model: config.model,
          maxTurns: config.maxTurns * 3, // team runs need more turns
          maxBudgetUsd: config.budgetUsd,
          tools: [
            "Read",
            "Write",
            "Glob",
            "Grep",
            "TeamCreate",
            "SendMessage",
            "TeamDelete",
          ],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          cwd: config.workDir || undefined,
          settingSources: config.settingSources,
          strictMcpConfig: config.strictMcp,
          persistSession: false,
          env: {
            ...process.env,
            CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
            CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
            CLAUDECODE: "",
          },
        },
      })) {
        messages.push(msg);
        progress.onMessage(msg);
        onStatusMessage?.(`merge-${this.name}`, msg);
        await logger.write(msg);
      }
    } finally {
      await logger.close();
    }

    const resultMsg = messages.find(
      (m: any) => m.type === "result" && m.subtype === "success",
    ) as any;

    if (!resultMsg) {
      throw new MergeError(
        "Agent-teams session did not produce a success result",
      );
    }

    let content: string;
    try {
      content = await fs.readFile(mergePlanPath, "utf-8");
    } catch {
      throw new MergeError(
        "Agent-teams session did not write the merged plan file",
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
      // Note: per-teammate metrics would require parsing team messages
    };

    return {
      content,
      comparison: [],
      strategy: this.name,
      metadata,
    };
  }
}
