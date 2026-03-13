import * as path from "node:path";
import type { Variant } from "../types/plan.js";
import type { GenerateConfig } from "../types/config.js";

/** A fully constructed prompt for a single variant session */
export interface VariantPrompt {
  readonly variant: Variant;
  readonly fullPrompt: string;
  readonly planPath: string; // where the Write tool should create the plan
}

/** Build the output instruction telling Claude where to write the plan */
export function buildOutputInstruction(
  runDir: string,
  variantName: string,
): string {
  const outputPath = path.join(runDir, `plan-${variantName}.md`);
  return [
    "## Output format (CRITICAL)",
    "Write the COMPLETE plan to this exact file path using the Write tool:",
    `  ${outputPath}`,
    "",
    "Rules:",
    "1. Do ALL your research first (read files, web search, etc.) — use as many",
    "   turns as needed for thorough research",
    "2. Then use the Write tool ONCE to create the file at the path above with",
    "   the ENTIRE plan content",
    "3. Start the file content with '# Plan'",
    "4. Include ALL sections in that single Write call — do not split the plan",
    "   across multiple Write calls",
    "5. Do NOT write to .claude/plans/ or any other path — ONLY the path above",
    `6. After writing the file, output a brief confirmation (e.g., 'Plan written`,
    `   to ${outputPath}')`,
  ].join("\n");
}

/** Build variant prompts, unified for both single-file and per-variant prompt_file modes */
export function buildPrompts(
  basePrompt: string | undefined,
  context: string | undefined,
  variants: readonly Variant[],
  variantPromptContents: ReadonlyMap<string, string>,
  _config: GenerateConfig,
  runDir: string,
): VariantPrompt[] {
  return variants.map((variant) => {
    const prompt = variantPromptContents.get(variant.name) ?? basePrompt ?? "";
    const parts: string[] = [prompt];

    if (context) {
      parts.push(`\n## Shared context\n${context}`);
    }

    if (variant.guidance) {
      parts.push(`\n## Additional guidance\n${variant.guidance}`);
    }

    parts.push(`\n${buildOutputInstruction(runDir, variant.name)}`);

    return {
      variant,
      fullPrompt: parts.join("\n"),
      planPath: path.join(runDir, `plan-${variant.name}.md`),
    };
  });
}
