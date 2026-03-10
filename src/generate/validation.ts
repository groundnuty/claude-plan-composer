/** Validation result for plan output */
export interface ValidationResult {
  readonly valid: boolean;
  readonly sizeBytes: number;
  readonly error?: string;
}

/** Validate plan output meets minimum size requirements */
export function validatePlanOutput(
  content: string,
  minBytes: number,
): ValidationResult {
  const sizeBytes = Buffer.byteLength(content, "utf-8");
  if (sizeBytes === 0) {
    return { valid: false, sizeBytes, error: "plan file not created (Claude didn't use Write tool)" };
  }
  if (sizeBytes < minBytes) {
    return { valid: false, sizeBytes, error: `plan too small (${sizeBytes} bytes < ${minBytes})` };
  }
  return { valid: true, sizeBytes };
}

/** Check if a plan file is large enough to include in merge (>= 1000 bytes) */
export function isValidMergeInput(content: string): boolean {
  return Buffer.byteLength(content, "utf-8") >= 1000;
}
