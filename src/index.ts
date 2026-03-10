// Types
export type {
  Variant, Plan, PlanMetadata, TokenUsage, PlanSet,
  ConflictClass, ComparisonEntry, MergeResult, MergeMetadata,
  DimensionScore, EvalResult, Gap,
  PipelineConfig, PipelineResult,
} from "./types/index.js";

export {
  CpcError, ConfigValidationError, PlanExtractionError,
  VariantError, MergeError, AllVariantsFailedError,
  IncompatibleFlagsError, PlanTooSmallError, LensGenerationError,
} from "./types/index.js";

// Config schemas (for runtime validation)
export {
  GenerateConfigSchema, MergeConfigSchema, VariantSchema,
  DimensionSchema, MergeStrategySchema,
} from "./types/config.js";
export type { GenerateConfig, MergeConfig } from "./types/config.js";

// Pipeline utilities
export {
  writePlanSet, readPlanSet, writeMergeResult, loadMcpConfig,
  resolveGenerateConfig, resolveMergeConfig, NdjsonLogger,
} from "./pipeline/index.js";
