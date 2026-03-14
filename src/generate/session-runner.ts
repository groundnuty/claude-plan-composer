import * as fs from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Plan, Variant, PlanMetadata } from "../types/plan.js";
import type { GenerateConfig } from "../types/config.js";
import {
  PlanExtractionError,
  VariantError,
  AllVariantsFailedError,
} from "../types/errors.js";
import { NdjsonLogger } from "../pipeline/logger.js";
import { SessionProgress } from "../pipeline/progress.js";
import type { OnStatusMessage } from "../monitor/types.js";
import type { VariantPrompt } from "./prompt-builder.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract a Plan from SDK messages and the file written by the Write tool */
export async function extractPlan(
  messages: unknown[],
  variant: Variant,
  planPath: string,
): Promise<Plan> {
  // Find the result message for metadata
  const resultMsg = messages.find(
    (m: any) => m.type === "result" && m.subtype === "success",
  ) as any;

  if (!resultMsg) {
    const errorMsg = messages.find(
      (m: any) => m.type === "result" && m.subtype !== "success",
    ) as any;
    throw new PlanExtractionError(
      variant.name,
      errorMsg
        ? `Session ended with: ${errorMsg.subtype}`
        : "No result message found",
    );
  }

  // Read plan content from disk (Write tool writes to filesystem)
  let content: string | undefined;
  try {
    content = await fs.readFile(planPath, "utf-8");
  } catch {
    // Fallback: extract from last assistant message text content
    const lastAssistant = [...messages]
      .reverse()
      .find((m: any) => m.type === "assistant") as any;
    if (lastAssistant?.message?.content) {
      content = lastAssistant.message.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");
    }
  }

  if (!content) {
    throw new PlanExtractionError(
      variant.name,
      `No plan file found at ${planPath} and no text content in assistant messages. ` +
        "Ensure your prompt instructs the agent to use the Write tool to save output.",
    );
  }

  // Build metadata from result message
  const modelKeys = Object.keys(resultMsg.modelUsage ?? {});
  const firstModel = modelKeys[0] ?? "unknown";
  const modelUsage = resultMsg.modelUsage?.[firstModel];

  const metadata: PlanMetadata = {
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
  };

  return { variant, content, metadata };
}

/** Run a single variant session with NDJSON logging */
async function runVariantSession(
  vp: VariantPrompt,
  config: GenerateConfig,
  parentSignal?: AbortSignal,
  onStatusMessage?: OnStatusMessage,
): Promise<Plan> {
  const logPath = vp.planPath.replace(/\.md$/, ".log");
  const phase = onStatusMessage?.currentPhase?.();
  const logger = new NdjsonLogger(logPath, phase);

  const abortController = new AbortController();

  // Link to parent signal (for SIGINT/SIGTERM)
  if (parentSignal) {
    parentSignal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
  }

  // Timeout
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);

  const messages: unknown[] = [];
  const progress = new SessionProgress(`generate:${vp.variant.name}`);

  try {
    for await (const msg of query({
      prompt: vp.fullPrompt,
      options: {
        model: vp.variant.model ?? config.model,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.budgetUsd,
        tools: config.tools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        cwd: config.workDir || undefined,
        additionalDirectories:
          config.additionalDirs.length > 0 ? config.additionalDirs : undefined,
        systemPrompt: config.systemPrompt,
        settingSources: config.settingSources,
        mcpServers:
          Object.keys(config.mcpServers).length > 0
            ? config.mcpServers
            : undefined,
        strictMcpConfig: config.strictMcp,
        persistSession: false,
        abortController,
        env: {
          ...process.env,
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "128000",
          CLAUDECODE: "",
        },
      },
    })) {
      messages.push(msg);
      progress.onMessage(msg);
      onStatusMessage?.(vp.variant.name, msg);
      await logger.write(msg);
    }

    return await extractPlan(messages, vp.variant, vp.planPath);
  } catch (err) {
    if (err instanceof PlanExtractionError) throw err;
    throw new VariantError(vp.variant.name, err);
  } finally {
    clearTimeout(timeout);
    await logger.close();
  }
}

/** Run all variant sessions in parallel with optional stagger */
export async function runParallelSessions(
  prompts: VariantPrompt[],
  config: GenerateConfig,
  parentSignal?: AbortSignal,
  onStatusMessage?: OnStatusMessage,
): Promise<Plan[]> {
  const results = await Promise.allSettled(
    prompts.map(async (vp, i) => {
      if (config.staggerMs > 0 && i > 0) {
        await delay(config.staggerMs * i);
      }
      return runVariantSession(vp, config, parentSignal, onStatusMessage);
    }),
  );

  // Log failures
  const failed = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  for (const f of failed) {
    const err =
      f.reason instanceof VariantError
        ? f.reason
        : new VariantError("unknown", f.reason);
    console.error(`✗ ${err.variant}: ${err.message}`);
  }

  // Collect successes
  const succeeded = results
    .filter((r): r is PromiseFulfilledResult<Plan> => r.status === "fulfilled")
    .map((r) => r.value);

  if (succeeded.length === 0) {
    throw new AllVariantsFailedError(
      failed.map((f) =>
        f.reason instanceof VariantError
          ? f.reason
          : new VariantError("unknown", f.reason),
      ),
    );
  }

  console.log(`✓ ${succeeded.length}/${results.length} variants succeeded`);
  return succeeded;
}

/** Run sessions sequentially for diversity (variant N+1 sees N's skeleton) */
export async function runSequentialSessions(
  prompts: VariantPrompt[],
  config: GenerateConfig,
  parentSignal?: AbortSignal,
  onStatusMessage?: OnStatusMessage,
): Promise<Plan[]> {
  if (prompts.length < 3) {
    console.warn(
      "Warning: sequential diversity requires >= 3 variants — falling back to parallel",
    );
    return runParallelSessions(prompts, config, parentSignal, onStatusMessage);
  }

  // Wave 1: first half in parallel
  const midpoint = Math.ceil(prompts.length / 2);
  const wave1Prompts = prompts.slice(0, midpoint);
  const wave1Plans = await runParallelSessions(
    wave1Prompts,
    config,
    parentSignal,
    onStatusMessage,
  );

  // Build skeleton from wave 1 (first 20 lines of each plan)
  const skeleton = wave1Plans
    .map(
      (p) =>
        `### ${p.variant.name}\n${p.content.split("\n").slice(0, 20).join("\n")}`,
    )
    .join("\n\n");

  // Wave 2: remaining variants with skeleton context
  const wave2Prompts = prompts.slice(midpoint).map((vp) => ({
    ...vp,
    fullPrompt: `${vp.fullPrompt}\n\n## Previous plans (skeleton — for structural diversity)\n${skeleton}\n\nProduce a plan that is STRUCTURALLY DIFFERENT from the above.`,
  }));

  const wave2Plans = await runParallelSessions(
    wave2Prompts,
    config,
    parentSignal,
    onStatusMessage,
  );

  return [...wave1Plans, ...wave2Plans];
}
