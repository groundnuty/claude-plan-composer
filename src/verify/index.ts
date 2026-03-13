import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PlanSet } from "../types/plan.js";
import type { MergeResult } from "../types/merge-result.js";
import type { VerifyResult } from "../types/evaluation.js";
import type { OnStatusMessage } from "../monitor/types.js";
import type { SourcePlanRef } from "./prompt-builder.js";
import { buildVerifyPrompt } from "./prompt-builder.js";
import { parseVerifyResponse } from "./gates.js";
import { NdjsonLogger } from "../pipeline/logger.js";
import { SessionProgress } from "../pipeline/progress.js";

/** Default model for verification sessions — sonnet for quality assessment */
export const DEFAULT_VERIFY_MODEL = "claude-sonnet-4-6";

export interface VerifyOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly onStatusMessage?: OnStatusMessage;
}

/**
 * Run an LLM verification session over a MergeResult against its source PlanSet.
 *
 * Checks the merged plan against three quality gates: CONSISTENCY, COMPLETENESS,
 * and ACTIONABILITY. Returns a structured VerifyResult with per-gate results
 * and an overall pass/fail determination.
 */
export async function verify(
  mergeResult: MergeResult,
  planSet: PlanSet,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const model = options.model ?? DEFAULT_VERIFY_MODEL;

  const sourcePlans: readonly SourcePlanRef[] = planSet.plans.map((plan) => ({
    name: plan.variant.name,
    content: plan.content,
  }));

  const prompt = buildVerifyPrompt(mergeResult.content, sourcePlans);

  const phase = options.onStatusMessage?.currentPhase?.();
  const logger = new NdjsonLogger(
    `${planSet.runDir}/verify-session.ndjson`,
    phase,
  );

  const abortController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  let responseText = "";
  const progress = new SessionProgress("verify");

  try {
    for await (const msg of query({
      prompt,
      options: {
        model,
        maxTurns: 10,
        tools: ["WebSearch"],
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        persistSession: false,
        abortController,
        env: {
          ...process.env,
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "16000",
          CLAUDECODE: "",
        },
      },
    })) {
      progress.onMessage(msg);
      options.onStatusMessage?.("verify", msg);
      await logger.write(msg);

      // Collect text from assistant messages
      if (
        msg.type === "assistant" &&
        "message" in msg &&
        (msg as any).message?.content
      ) {
        const textBlocks: string = (msg as any).message.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text as string)
          .join("\n");
        if (textBlocks) {
          responseText += textBlocks;
        }
      }
    }
  } finally {
    await logger.close();
  }

  return parseVerifyResponse(responseText);
}
