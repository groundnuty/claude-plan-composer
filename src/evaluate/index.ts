import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PlanSet } from "../types/plan.js";
import type { MergeConfig } from "../types/config.js";
import type { EvalResult } from "../types/evaluation.js";
import type { OnStatusMessage } from "../monitor/types.js";
import { NdjsonLogger } from "../pipeline/logger.js";
import { SessionProgress } from "../pipeline/progress.js";
import { buildEvalPrompt } from "./prompt-builder.js";
import { parseEvalResponse, buildEvalResult } from "./scorer.js";
import { computePairwiseJaccard } from "./jaccard.js";

/** Default model for evaluation sessions — cheap haiku for cost efficiency */
export const DEFAULT_EVAL_MODEL = "claude-haiku-4-5-20251001";

export interface EvaluateOptions {
  readonly model?: string;
  readonly signal?: AbortSignal;
  readonly onStatusMessage?: OnStatusMessage;
}

/**
 * Run an LLM evaluation session over a PlanSet and return structured EvalResult.
 *
 * Builds an eval prompt, runs a lightweight Claude session, parses the JSON
 * response, and aggregates dimension scores using the configured consensus method.
 */
export async function evaluate(
  planSet: PlanSet,
  config: MergeConfig,
  options: EvaluateOptions = {},
): Promise<EvalResult> {
  const model = options.model ?? DEFAULT_EVAL_MODEL;
  const prompt = buildEvalPrompt(planSet.plans, config);

  const logger = new NdjsonLogger(`${planSet.runDir}/eval-session.ndjson`);

  const abortController = new AbortController();
  if (options.signal) {
    options.signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  let responseText = "";
  const progress = new SessionProgress("evaluate");

  try {
    for await (const msg of query({
      prompt,
      options: {
        model,
        maxTurns: 3,
        tools: [],
        permissionMode: "bypassPermissions" as const,
        allowDangerouslySkipPermissions: true,
        settingSources: config.settingSources,
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
      options.onStatusMessage?.("evaluate", msg);
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

  const jaccard = computePairwiseJaccard(planSet.plans);
  if (jaccard.warning) {
    console.warn(
      `Warning: ${jaccard.warning} (mean=${jaccard.mean.toFixed(3)})`,
    );
  }

  const rawResponse = parseEvalResponse(responseText);
  return { ...buildEvalResult(rawResponse, config.evalConsensus), jaccard };
}
