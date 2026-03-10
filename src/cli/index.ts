#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";

import { resolveGenerateConfig, resolveMergeConfig } from "../pipeline/config-resolver.js";
import { writePlanSet, readPlanSet, writeMergeResult } from "../pipeline/io.js";
import { generate } from "../generate/index.js";
import type { GenerateOptions } from "../generate/index.js";
import { merge } from "../merge/index.js";
import { CpcError } from "../types/errors.js";
import type { PipelineResult } from "../types/pipeline.js";

// ---------------------------------------------------------------------------
// Signal handling
// ---------------------------------------------------------------------------

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const coerceInt = (v: string): number => parseInt(v, 10);
const coerceFloat = (v: string): number => parseFloat(v);

/** Read a file and return { name, content }. Name = filename without extension. */
async function readPromptFile(
  filePath: string,
): Promise<{ name: string; content: string }> {
  const content = await fs.readFile(filePath, "utf-8");
  const name = path.basename(filePath, path.extname(filePath));
  return { name, content };
}

/** Print a generate summary to stderr. */
function printGenerateSummary(
  runDir: string,
  planCount: number,
  variantNames: readonly string[],
): void {
  console.error(`Run directory: ${runDir}`);
  console.error(`Plans generated: ${planCount}`);
  console.error(`Variants: ${variantNames.join(", ")}`);
}

/** Print a merge summary to stderr. */
function printMergeSummary(dir: string, strategy: string): void {
  console.error(`Merge complete: ${dir}`);
  console.error(`Strategy: ${strategy}`);
}

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

const program = new Command()
  .name("cpc")
  .description("Claude Plan Composer — multi-variant plan generation and merge")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

program
  .command("generate")
  .description("Generate plans from prompt file(s)")
  .argument("<prompt-file>", "Primary prompt file")
  .argument("[extra-files...]", "Additional prompt files (multi-file mode)")
  .option("--config <file>", "Config file path")
  .option("--multi", "Multi-file mode: treat extra positional args as variant files")
  .option("--context <file>", "Shared context file (multi-file mode)")
  .option("--debug [variant]", "Debug mode: sonnet, 20 turns, single variant")
  .option("--dry-run", "Show resolved config and exit")
  .option("--auto-lenses", "Generate task-specific variants via LLM")
  .option("--sequential-diversity", "Two-wave generation")
  .option("--model <name>", "Override model")
  .option("--max-turns <n>", "Override max turns", coerceInt)
  .option("--timeout <ms>", "Override timeout in milliseconds", coerceInt)
  .option("--budget <usd>", "Override budget cap in USD", coerceFloat)
  .action(async (promptFile: string, extraFiles: string[], opts) => {
    try {
      const overrides: Record<string, unknown> = {};
      if (opts.model !== undefined) overrides.model = opts.model;
      if (opts.maxTurns !== undefined) overrides.maxTurns = opts.maxTurns;
      if (opts.timeout !== undefined) overrides.timeoutMs = opts.timeout;
      if (opts.budget !== undefined) overrides.budgetUsd = opts.budget;
      if (opts.autoLenses) overrides.autoLenses = true;
      if (opts.sequentialDiversity) overrides.sequentialDiversity = true;

      const config = await resolveGenerateConfig({
        cliConfigPath: opts.config,
        cliOverrides: overrides,
      });

      if (opts.dryRun) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      // Build generate options
      const generateOpts: GenerateOptions = opts.multi
        ? {
            promptFiles: await Promise.all(
              [promptFile, ...extraFiles].map(readPromptFile),
            ),
            context: opts.context
              ? await fs.readFile(opts.context, "utf-8")
              : undefined,
            debug: opts.debug ?? false,
            signal: controller.signal,
          }
        : {
            prompt: (await readPromptFile(promptFile)).content,
            debug: opts.debug ?? false,
            signal: controller.signal,
          };

      const result = await generate(config, generateOpts);
      await writePlanSet(result, result.runDir);

      const variantNames = result.plans.map((p) => p.variant.name);
      printGenerateSummary(result.runDir, result.plans.length, variantNames);
    } catch (err) {
      if (err instanceof CpcError) {
        console.error(`Error [${err.code}]: ${err.message}`);
      } else {
        console.error(err);
      }
      process.exitCode = 1;
    }
  });

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

program
  .command("merge")
  .description("Merge generated plans from a directory")
  .argument("<plans-dir>", "Directory containing plan-*.md files")
  .option("--config <file>", "Merge config file path")
  .option("--strategy <name>", "Merge strategy: simple, agent-teams, subagent-debate")
  .option("--comparison <method>", "Comparison method: holistic, pairwise")
  .option("--model <name>", "Override model")
  .option("--dry-run", "Show resolved config and exit")
  .action(async (plansDir: string, opts) => {
    try {
      const overrides: Record<string, unknown> = {};
      if (opts.model !== undefined) overrides.model = opts.model;
      if (opts.strategy !== undefined) overrides.strategy = opts.strategy;
      if (opts.comparison !== undefined) overrides.comparisonMethod = opts.comparison;

      const config = await resolveMergeConfig({
        cliConfigPath: opts.config,
        cliOverrides: overrides,
      });

      if (opts.dryRun) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      const plans = await readPlanSet(plansDir);
      const result = await merge(plans, config);
      await writeMergeResult(result, plansDir);

      printMergeSummary(plansDir, result.strategy);
    } catch (err) {
      if (err instanceof CpcError) {
        console.error(`Error [${err.code}]: ${err.message}`);
      } else {
        console.error(err);
      }
      process.exitCode = 1;
    }
  });

// ---------------------------------------------------------------------------
// run (generate + merge)
// ---------------------------------------------------------------------------

program
  .command("run")
  .description("Generate plans then merge (full pipeline)")
  .argument("<prompt-file>", "Primary prompt file")
  .argument("[extra-files...]", "Additional prompt files (multi-file mode)")
  // generate flags
  .option("--config <file>", "Generate config file path")
  .option("--multi", "Multi-file mode: treat extra positional args as variant files")
  .option("--context <file>", "Shared context file (multi-file mode)")
  .option("--debug [variant]", "Debug mode: sonnet, 20 turns, single variant")
  .option("--dry-run", "Show resolved configs and exit")
  .option("--auto-lenses", "Generate task-specific variants via LLM")
  .option("--sequential-diversity", "Two-wave generation")
  .option("--model <name>", "Override model (both generate and merge)")
  .option("--max-turns <n>", "Override max turns", coerceInt)
  .option("--timeout <ms>", "Override timeout in milliseconds", coerceInt)
  .option("--budget <usd>", "Override budget cap in USD", coerceFloat)
  // merge flags
  .option("--merge-config <file>", "Merge config file path")
  .option("--strategy <name>", "Merge strategy: simple, agent-teams, subagent-debate")
  .option("--comparison <method>", "Comparison method: holistic, pairwise")
  .action(async (promptFile: string, extraFiles: string[], opts) => {
    try {
      // Resolve generate config
      const genOverrides: Record<string, unknown> = {};
      if (opts.model !== undefined) genOverrides.model = opts.model;
      if (opts.maxTurns !== undefined) genOverrides.maxTurns = opts.maxTurns;
      if (opts.timeout !== undefined) genOverrides.timeoutMs = opts.timeout;
      if (opts.budget !== undefined) genOverrides.budgetUsd = opts.budget;
      if (opts.autoLenses) genOverrides.autoLenses = true;
      if (opts.sequentialDiversity) genOverrides.sequentialDiversity = true;

      const genConfig = await resolveGenerateConfig({
        cliConfigPath: opts.config,
        cliOverrides: genOverrides,
      });

      // Resolve merge config
      const mergeOverrides: Record<string, unknown> = {};
      if (opts.model !== undefined) mergeOverrides.model = opts.model;
      if (opts.strategy !== undefined) mergeOverrides.strategy = opts.strategy;
      if (opts.comparison !== undefined) mergeOverrides.comparisonMethod = opts.comparison;

      const mergeConfig = await resolveMergeConfig({
        cliConfigPath: opts.mergeConfig,
        cliOverrides: mergeOverrides,
      });

      if (opts.dryRun) {
        console.log(JSON.stringify({ generate: genConfig, merge: mergeConfig }, null, 2));
        return;
      }

      // 1. Generate
      const generateOpts: GenerateOptions = opts.multi
        ? {
            promptFiles: await Promise.all(
              [promptFile, ...extraFiles].map(readPromptFile),
            ),
            context: opts.context
              ? await fs.readFile(opts.context, "utf-8")
              : undefined,
            debug: opts.debug ?? false,
            signal: controller.signal,
          }
        : {
            prompt: (await readPromptFile(promptFile)).content,
            debug: opts.debug ?? false,
            signal: controller.signal,
          };

      const planSet = await generate(genConfig, generateOpts);
      await writePlanSet(planSet, planSet.runDir);

      const variantNames = planSet.plans.map((p) => p.variant.name);
      printGenerateSummary(planSet.runDir, planSet.plans.length, variantNames);

      // 2. Merge
      const mergeResult = await merge(planSet, mergeConfig);
      await writeMergeResult(mergeResult, planSet.runDir);

      printMergeSummary(planSet.runDir, mergeResult.strategy);

      const pipelineResult: PipelineResult = {
        planSet,
        mergeResult,
      };

      // Print final pipeline summary to stderr
      console.error("---");
      console.error(`Pipeline complete: ${planSet.runDir}`);
      console.error(`Plans: ${pipelineResult.planSet.plans.length}`);
      console.error(`Merge strategy: ${pipelineResult.mergeResult.strategy}`);
    } catch (err) {
      if (err instanceof CpcError) {
        console.error(`Error [${err.code}]: ${err.message}`);
      } else {
        console.error(err);
      }
      process.exitCode = 1;
    }
  });

// ---------------------------------------------------------------------------
// Parse and run
// ---------------------------------------------------------------------------

program.parse();
