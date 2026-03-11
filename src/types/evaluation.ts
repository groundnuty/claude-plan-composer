/** Types for Phase C — evaluate + verify */

export interface DimensionScore {
  readonly dimension: string;
  readonly pass?: boolean;         // binary mode
  readonly score?: number;         // likert mode (1-5)
  readonly critique: string;
}

export interface Gap {
  readonly dimension: string;
  readonly description: string;
}

export interface PlanScore {
  readonly variantName: string;
  readonly dimensions: readonly DimensionScore[];
}

export interface EvalResult {
  readonly scores: readonly DimensionScore[];
  readonly summary: string;
  readonly planScores: readonly PlanScore[];
  readonly gaps: readonly Gap[];
  readonly convergence: number;
}

export interface VerifyGateResult {
  readonly gate: "consistency" | "completeness" | "actionability";
  readonly pass: boolean;
  readonly findings: readonly string[];
}

export interface VerifyResult {
  readonly gates: readonly VerifyGateResult[];
  readonly pass: boolean;
  readonly report: string;
}
