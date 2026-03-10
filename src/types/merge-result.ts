import type { TokenUsage } from "./plan.js";

export type ConflictClass = "genuine-tradeoff" | "complementary" | "arbitrary-divergence";

export interface ComparisonEntry {
  readonly dimension: string;
  readonly winner: string;
  readonly classification: ConflictClass;
  readonly justification: string;
}

export interface MergeResult {
  readonly content: string;
  readonly comparison: readonly ComparisonEntry[];
  readonly strategy: "simple" | "agent-teams" | "subagent-debate";
  readonly metadata: MergeMetadata;
}

export interface MergeMetadata {
  readonly model: string;
  readonly turns: number;
  readonly durationMs: number;
  readonly durationApiMs: number;
  readonly tokenUsage: TokenUsage;
  readonly costUsd: number;
  readonly stopReason: string | null;
  readonly sessionId: string;
  readonly sourcePlans: number;
  readonly teammateMetrics?: Record<string, TokenUsage>;
  readonly totalCostUsd: number;
}
