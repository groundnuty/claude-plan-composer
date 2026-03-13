import * as fs from "node:fs/promises";

export interface NdjsonSummary {
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Readonly<Record<string, number>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly contextTokens: number;
  readonly compactions: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly sessionId: string;
  readonly lastAction: string;
}

export async function parseNdjsonLog(filePath: string): Promise<NdjsonSummary> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return emptySummary();
  }

  let turns = 0;
  let toolCalls = 0;
  const toolBreakdown: Record<string, number> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let contextTokens = 0;
  let compactions = 0;
  let cost = 0;
  let durationMs = 0;
  let sessionId = "";
  let lastAction = "";

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (msg.type === "assistant") {
      turns++;
      const message = msg.message as Record<string, unknown> | undefined;
      const contentArr = message?.content;

      const usage = message?.usage as Record<string, number> | undefined;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
        cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
        cacheReadTokens += usage.cache_read_input_tokens ?? 0;
        contextTokens = usage.input_tokens ?? contextTokens;
      }

      if (Array.isArray(contentArr)) {
        const tools = contentArr.filter(
          (b: Record<string, unknown>) => b.type === "tool_use",
        );
        toolCalls += tools.length;
        for (const tool of tools) {
          const name = tool.name as string;
          toolBreakdown[name] = (toolBreakdown[name] ?? 0) + 1;
          lastAction = name;
        }
      }
    } else if (msg.type === "result" && msg.subtype === "success") {
      cost = (msg.total_cost_usd as number) ?? 0;
      durationMs = (msg.duration_ms as number) ?? 0;
      sessionId = (msg.session_id as string) ?? "";
    } else if (msg.type === "system" && msg.subtype === "compact_boundary") {
      compactions++;
    }
  }

  return {
    turns,
    toolCalls,
    toolBreakdown,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    contextTokens,
    compactions,
    cost,
    durationMs,
    sessionId,
    lastAction,
  };
}

function emptySummary(): NdjsonSummary {
  return {
    turns: 0,
    toolCalls: 0,
    toolBreakdown: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    contextTokens: 0,
    compactions: 0,
    cost: 0,
    durationMs: 0,
    sessionId: "",
    lastAction: "",
  };
}
