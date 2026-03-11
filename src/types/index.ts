export type {
  Variant,
  Plan,
  PlanMetadata,
  TokenUsage,
  PlanSet,
} from "./plan.js";
export type {
  ConflictClass,
  ComparisonEntry,
  MergeResult,
  MergeMetadata,
} from "./merge-result.js";
export type {
  DimensionScore,
  EvalResult,
  Gap,
  PlanScore,
  VerifyGateResult,
  VerifyResult,
} from "./evaluation.js";
export type { PipelineConfig, PipelineResult } from "./pipeline.js";
export {
  CpcError,
  ConfigValidationError,
  PlanExtractionError,
  VariantError,
  MergeError,
  AllVariantsFailedError,
  IncompatibleFlagsError,
  PlanTooSmallError,
  LensGenerationError,
} from "./errors.js";
