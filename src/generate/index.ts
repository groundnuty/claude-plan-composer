import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PlanSet } from "../types/plan.js";
import type { GenerateConfig } from "../types/config.js";
import { IncompatibleFlagsError } from "../types/errors.js";
import { buildVariantPrompts, buildMultiFilePrompts } from "./prompt-builder.js";
import type { VariantPrompt } from "./prompt-builder.js";
import { generateLenses } from "./auto-lenses.js";
import { runParallelSessions, runSequentialSessions } from "./session-runner.js";

export interface GenerateOptions {
  /** Base prompt content (single-file mode) */
  readonly prompt?: string;
  /** Multi-file mode: array of {name, content} */
  readonly promptFiles?: ReadonlyArray<{ name: string; content: string }>;
  /** Shared context for multi-file mode */
  readonly context?: string;
  /** Override output directory base */
  readonly outputDir?: string;
  /** Debug mode: single variant, cheaper model */
  readonly debug?: boolean | string;
  /** Parent abort signal for graceful shutdown */
  readonly signal?: AbortSignal;
}

/** Create a timestamped run directory */
function createRunDirName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

/** Validate flag combinations */
function validateFlags(
  options: GenerateOptions,
  config: GenerateConfig,
): void {
  const isMulti = !!options.promptFiles;

  if (isMulti && config.autoLenses) {
    throw new IncompatibleFlagsError("auto-lenses requires single-file mode");
  }
  if (isMulti && config.sequentialDiversity) {
    throw new IncompatibleFlagsError("sequential diversity requires single-file mode");
  }
  if (options.debug && isMulti) {
    throw new IncompatibleFlagsError("debug requires single-file mode");
  }
}

/** Apply debug mode overrides */
function applyDebugOverrides(
  config: GenerateConfig,
  debugVariant?: string,
): GenerateConfig {
  const variant = debugVariant
    ? config.variants.find(v => v.name === debugVariant) ?? { name: debugVariant, guidance: "" }
    : config.variants[0] ?? { name: "baseline", guidance: "" };

  return {
    ...config,
    model: "sonnet",
    maxTurns: 20,
    timeoutMs: 600_000,
    minOutputBytes: 500,
    variants: [variant],
  };
}

/** Main generate function */
export async function generate(
  config: GenerateConfig,
  options: GenerateOptions,
): Promise<PlanSet> {
  validateFlags(options, config);

  // Apply debug overrides
  const resolvedConfig = options.debug
    ? applyDebugOverrides(config, typeof options.debug === "string" ? options.debug : undefined)
    : config;

  // Determine prompt name and base dir
  const promptName = options.promptFiles
    ? `multi-${createRunDirName().slice(-6)}`
    : "plan";
  const baseDir = options.outputDir ?? path.join("generated-plans", promptName);
  const runDir = path.join(baseDir, createRunDirName());
  await fs.mkdir(runDir, { recursive: true });

  // Build variant prompts
  let variantPrompts: VariantPrompt[];

  if (options.promptFiles) {
    // Multi-file mode
    variantPrompts = buildMultiFilePrompts(
      options.promptFiles,
      options.context,
      resolvedConfig,
      runDir,
    );
  } else if (!options.prompt) {
    throw new Error("Either prompt or promptFiles must be provided");
  } else {
    // Single-file mode: resolve variants (config or auto-lenses)
    const variants = resolvedConfig.autoLenses
      ? await generateLenses(options.prompt, resolvedConfig, runDir)
      : resolvedConfig.variants;

    variantPrompts = buildVariantPrompts(
      options.prompt,
      variants,
      resolvedConfig,
      runDir,
    );
  }

  // Run sessions
  const plans = resolvedConfig.sequentialDiversity
    ? await runSequentialSessions(variantPrompts, resolvedConfig, options.signal)
    : await runParallelSessions(variantPrompts, resolvedConfig, options.signal);

  return {
    plans,
    timestamp: new Date().toISOString(),
    runDir,
  };
}
