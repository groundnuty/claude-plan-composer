// Types
export type {
  Variant,
  Plan,
  PlanMetadata,
  TokenUsage,
  PlanSet,
  ConflictClass,
  ComparisonEntry,
  MergeResult,
  MergeMetadata,
  DimensionScore,
  EvalResult,
  Gap,
  PlanScore,
  VerifyGateResult,
  VerifyResult,
  PipelineConfig,
  PipelineResult,
} from "./types/index.js";

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
} from "./types/index.js";

// Config schemas (for runtime validation)
export {
  GenerateConfigSchema,
  MergeConfigSchema,
  VariantSchema,
  DimensionSchema,
  MergeStrategySchema,
} from "./types/config.js";
export type { GenerateConfig, MergeConfig } from "./types/config.js";

// Pipeline utilities
export {
  writePlanSet,
  readPlanSet,
  writeMergeResult,
  writeEvalResult,
  readEvalResult,
  writeVerifyResult,
  loadMcpConfig,
  resolveGenerateConfig,
  resolveMergeConfig,
  NdjsonLogger,
} from "./pipeline/index.js";

// Generate
export { generate } from "./generate/index.js";
export type { GenerateOptions } from "./generate/index.js";

// Merge
export { merge } from "./merge/index.js";
export type { MergeStrategy } from "./merge/index.js";

// Evaluate
export { evaluate } from "./evaluate/index.js";
export type { EvaluateOptions } from "./evaluate/index.js";

// Verify
export { verify } from "./verify/index.js";
export type { VerifyOptions } from "./verify/index.js";

// Pipeline
export { runPipeline } from "./pipeline/run.js";
export type { RunOptions } from "./pipeline/run.js";
