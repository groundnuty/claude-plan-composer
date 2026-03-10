/** A single variant's configuration */
export interface Variant {
  readonly name: string;
  readonly guidance: string;
  readonly model?: string;  // per-variant model override
}

/** A generated plan from one variant session */
export interface Plan {
  readonly variant: Variant;
  readonly content: string;          // the plan markdown
  readonly metadata: PlanMetadata;
}

export interface PlanMetadata {
  readonly model: string;
  readonly turns: number;
  readonly durationMs: number;
  readonly durationApiMs: number;
  readonly tokenUsage: TokenUsage;
  readonly costUsd: number;
  readonly stopReason: string | null;
  readonly sessionId: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUsd: number;
}

/** A complete set of variant plans from one generation run */
export interface PlanSet {
  readonly plans: readonly Plan[];
  readonly timestamp: string;        // ISO 8601
  readonly runDir: string;
}
