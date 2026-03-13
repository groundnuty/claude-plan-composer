import type { ZodError } from "zod";

export class CpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ConfigValidationError extends CpcError {
  constructor(readonly zodErrors: ZodError) {
    super(
      `Config validation failed: ${zodErrors.message}`,
      "CONFIG_VALIDATION",
    );
  }
}

export class PlanExtractionError extends CpcError {
  constructor(
    readonly variantName: string,
    reason: string,
  ) {
    super(
      `Failed to extract plan for ${variantName}: ${reason}`,
      "PLAN_EXTRACTION",
    );
  }
}

export class VariantError extends CpcError {
  constructor(
    readonly variant: string,
    cause: unknown,
  ) {
    super(
      cause instanceof Error ? cause.message : String(cause),
      "VARIANT_ERROR",
    );
    this.cause = cause;
  }
}

export class MergeError extends CpcError {
  constructor(reason: string) {
    super(reason, "MERGE_ERROR");
  }
}

export class AllVariantsFailedError extends CpcError {
  constructor(readonly errors: readonly VariantError[]) {
    super(`All ${errors.length} variants failed`, "ALL_VARIANTS_FAILED");
  }
}

export class IncompatibleFlagsError extends CpcError {
  constructor(reason: string) {
    super(reason, "INCOMPATIBLE_FLAGS");
  }
}

export class MissingBasePromptError extends CpcError {
  constructor() {
    super(
      "Base prompt required: set 'prompt' in config or use --prompt flag " +
        "(variants without prompt_file need a base prompt)",
      "MISSING_BASE_PROMPT",
    );
  }
}

export class PlanTooSmallError extends CpcError {
  constructor(
    readonly variantName: string,
    readonly sizeBytes: number,
    readonly minBytes: number,
  ) {
    super(
      `Plan ${variantName} too small (${sizeBytes} < ${minBytes} bytes)`,
      "PLAN_TOO_SMALL",
    );
  }
}

export class LensGenerationError extends CpcError {
  constructor(reason: string) {
    super(reason, "LENS_GENERATION");
  }
}
