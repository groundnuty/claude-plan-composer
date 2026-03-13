import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PlanSet } from "../types/plan.js";
import type { GenerateConfig } from "../types/config.js";
import type { OnStatusMessage } from "../monitor/types.js";
import { IncompatibleFlagsError, MissingBasePromptError } from "../types/errors.js";
import { buildPrompts } from "./prompt-builder.js";
import type { VariantPrompt } from "./prompt-builder.js";
import { generateLenses } from "./auto-lenses.js";
import {
  runParallelSessions,
  runSequentialSessions,
} from "./session-runner.js";

export interface GenerateOptions {
  /** Override output directory base */
  readonly outputDir?: string;
  /** Debug mode: single variant, cheaper model */
  readonly debug?: boolean | string;
  /** Parent abort signal for graceful shutdown */
  readonly signal?: AbortSignal;
  /** Callback for status message forwarding */
  readonly onStatusMessage?: OnStatusMessage;
}

export interface MaterializedConfig {
  readonly basePrompt: string | undefined;
  readonly context: string | undefined;
  readonly variantPromptContents: ReadonlyMap<string, string>;
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

/** Read all file-based config fields into memory, validate flag combinations */
export async function materializeConfig(
  config: GenerateConfig,
): Promise<MaterializedConfig> {
  const hasPromptFileVariants = config.variants.some((v) => v.promptFile);

  if (hasPromptFileVariants && config.autoLenses) {
    throw new IncompatibleFlagsError(
      "auto-lenses is incompatible with per-variant prompt_file",
    );
  }
  if (hasPromptFileVariants && config.sequentialDiversity) {
    throw new IncompatibleFlagsError(
      "sequential diversity is incompatible with per-variant prompt_file",
    );
  }

  const allVariantsHavePromptFile = config.variants.every((v) => v.promptFile);
  if (!allVariantsHavePromptFile && !config.prompt) {
    throw new MissingBasePromptError();
  }

  const basePrompt = config.prompt
    ? await fs.readFile(config.prompt, "utf-8")
    : undefined;

  const context = config.context
    ? await fs.readFile(config.context, "utf-8")
    : undefined;

  const entries: [string, string][] = [];
  for (const variant of config.variants) {
    if (variant.promptFile) {
      const content = await fs.readFile(variant.promptFile, "utf-8");
      entries.push([variant.name, content]);
    }
  }

  return {
    basePrompt,
    context,
    variantPromptContents: new Map(entries),
  };
}

/** Apply debug mode overrides */
function applyDebugOverrides(
  config: GenerateConfig,
  debugVariant?: string,
): GenerateConfig {
  const variant = debugVariant
    ? (config.variants.find((v) => v.name === debugVariant) ?? {
        name: debugVariant,
        guidance: "",
      })
    : (config.variants[0] ?? { name: "baseline", guidance: "" });

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
  const resolvedConfig = options.debug
    ? applyDebugOverrides(
        config,
        typeof options.debug === "string" ? options.debug : undefined,
      )
    : config;

  const materialized = await materializeConfig(resolvedConfig);

  const hasPromptFiles = resolvedConfig.variants.some((v) => v.promptFile);
  const promptName = hasPromptFiles
    ? `multi-${createRunDirName().slice(-6)}`
    : "plan";
  const baseDir = options.outputDir ?? path.join("generated-plans", promptName);
  const runDir = path.join(baseDir, createRunDirName());
  await fs.mkdir(runDir, { recursive: true });

  let variantPrompts: VariantPrompt[];

  if (resolvedConfig.autoLenses) {
    const variants = await generateLenses(
      materialized.basePrompt!,
      resolvedConfig,
      runDir,
    );
    variantPrompts = buildPrompts(
      materialized.basePrompt,
      materialized.context,
      variants,
      new Map(),
      resolvedConfig,
      runDir,
    );
  } else {
    variantPrompts = buildPrompts(
      materialized.basePrompt,
      materialized.context,
      resolvedConfig.variants,
      materialized.variantPromptContents,
      resolvedConfig,
      runDir,
    );
  }

  const plans = resolvedConfig.sequentialDiversity
    ? await runSequentialSessions(
        variantPrompts,
        resolvedConfig,
        options.signal,
        options.onStatusMessage,
      )
    : await runParallelSessions(
        variantPrompts,
        resolvedConfig,
        options.signal,
        options.onStatusMessage,
      );

  return {
    plans,
    timestamp: new Date().toISOString(),
    runDir,
  };
}
