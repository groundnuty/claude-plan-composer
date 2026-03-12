// src/monitor/types.ts

/** Callback signature for status message forwarding */
export type OnStatusMessage = (sessionName: string, msg: unknown) => void;

export interface AgentCount {
  readonly running: number;
  readonly total: number;
}

export interface ChildState {
  readonly type: "task" | "team-member";
  readonly name: string;
  readonly taskId: string | null;
  readonly status: "pending" | "running" | "done" | "failed";
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Readonly<Record<string, number>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
  readonly lastAction: string;
}

export interface SessionState {
  readonly name: string;
  readonly status: "pending" | "running" | "done" | "failed";
  readonly sessionId: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Readonly<Record<string, number>>;
  readonly agents: AgentCount;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
  readonly contextTokens: number;
  readonly contextPercent: number;
  readonly compactions: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly lastAction: string;
  readonly logSize: number;
  readonly planSize: number;
  readonly children: readonly ChildState[];
}

export interface PipelineState {
  readonly pid: number;
  readonly startedAt: string;
  readonly command: string;
  readonly configPath: string;
  readonly outputDir: string;
  readonly stage: string;
  readonly sessions: readonly SessionState[];
}
