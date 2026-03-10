/** Stub types for Phase C — evaluate + verify */

export interface DimensionScore {
  readonly dimension: string;
  readonly pass?: boolean;         // binary mode
  readonly score?: number;         // likert mode (1-5)
  readonly critique: string;
}

export interface EvalResult {
  readonly scores: readonly DimensionScore[];
  readonly summary: string;
}

export interface Gap {
  readonly dimension: string;
  readonly description: string;
}
