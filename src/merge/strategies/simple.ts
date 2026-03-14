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
import { buildMergePrompt } from "../prompt-builder.js";

export class SimpleStrategy implements MergeStrategy {
  readonly name = "simple" as const;

  async merge(
    plans: PlanSet,
    config: MergeConfig,
    mergePlanPath: string,
    evalResult?: EvalResult,
    onStatusMessage?: OnStatusMessage,
  ): Promise<MergeResult> {
    const prompt = buildMergePrompt(plans, config, mergePlanPath, evalResult);
    const logPath = mergePlanPath.replace(/\.md$/, ".log");
    const phase = onStatusMessage?.currentPhase?.();
    const logger = new NdjsonLogger(logPath, phase);

    const messages: unknown[] = [];
    const progress = new SessionProgress("merge:simple");

    try {
      for await (const msg of query({
        prompt,
        options: {
          model: config.model,
          maxTurns: config.maxTurns,
          maxBudgetUsd: config.budgetUsd,
          tools: ["Read", "Write", "Glob", "Grep"],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          cwd: config.workDir || undefined,
          settingSources: config.settingSources,
          mcpServers:
            Object.keys(config.mcpServers).length > 0
              ? config.mcpServers
              : undefined,
          strictMcpConfig: config.strictMcp,
          persistSession: false,
          systemPrompt: config.systemPrompt,
          env: {
            ...process.env,
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

    // Extract result
    const resultMsg = messages.find(
      (m: any) => m.type === "result" && m.subtype === "success",
    ) as any;

    if (!resultMsg) {
      throw new MergeError("Merge session did not produce a success result");
    }

    // Read merged plan from disk
    let content: string;
    try {
      content = await fs.readFile(mergePlanPath, "utf-8");
    } catch {
      throw new MergeError(
        `Merge session did not write the merged plan file at ${mergePlanPath}`,
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
      comparison: [], // TODO: extract from content or separate JSON
      strategy: this.name,
      metadata,
    };
  }
}
