#!/usr/bin/env node

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";

import {
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../pipeline/config-resolver.js";
import {
  writePlanSet,
  readPlanSet,
  writeMergeResult,
  writeEvalResult,
  writeVerifyResult,
  writePreMortemResult,
} from "../pipeline/io.js";
import { generate } from "../generate/index.js";
import type { GenerateOptions } from "../generate/index.js";
import { merge } from "../merge/index.js";
import { evaluate } from "../evaluate/index.js";
import type { EvaluateOptions } from "../evaluate/index.js";
import { verify } from "../verify/index.js";
import type { VerifyOptions } from "../verify/index.js";
import { runPreMortem } from "../verify/pre-mortem.js";
import type { PreMortemOptions } from "../verify/pre-mortem.js";
import { CpcError } from "../types/errors.js";
import type { PipelineResult } from "../types/pipeline.js";
import { StatusCollector } from "../monitor/status-collector.js";
import { StatusServer } from "../monitor/status-server.js";
import { monitorCommand } from "./monitor.js";

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

/** Print an eval summary to stderr. */
function printEvalSummary(
  convergence: number,
  gaps: readonly { dimension: string; description: string }[],
  summary: string,
): void {
  console.error(`Convergence: ${(convergence * 100).toFixed(1)}%`);
  console.error(`Gaps: ${gaps.length}`);
  for (const gap of gaps) {
    console.error(`  [${gap.dimension}] ${gap.description}`);
  }
  console.error(`Summary: ${summary}`);
}

/** Print verify gate results to stderr. */
function printVerifySummary(
  gates: readonly {
    gate: string;
    pass: boolean;
    findings: readonly string[];
  }[],
  pass: boolean,
): void {
  console.error(`Verification: ${pass ? "PASS" : "FAIL"}`);
  for (const gate of gates) {
    const status = gate.pass ? "PASS" : "FAIL";
    console.error(`  [${gate.gate.toUpperCase()}] ${status}`);
    for (const finding of gate.findings) {
      console.error(`    - ${finding}`);
    }
  }
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
  .option(
    "--multi",
    "Multi-file mode: treat extra positional args as variant files",
  )
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

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "generate",
        configPath: opts.config ?? "",
        outputDir: "",
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();
      collector.setStage("generating");

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
            onStatusMessage,
          }
        : {
            prompt: (await readPromptFile(promptFile)).content,
            debug: opts.debug ?? false,
            signal: controller.signal,
            onStatusMessage,
          };

      const result = await generate(config, generateOpts);
      await writePlanSet(result, result.runDir);
      collector.setOutputDir(result.runDir);

      const variantNames = result.plans.map((p) => p.variant.name);
      printGenerateSummary(result.runDir, result.plans.length, variantNames);

      collector.setStage("done");
      await statusServer.stop();
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
  .option(
    "--strategy <name>",
    "Merge strategy: simple, agent-teams, subagent-debate",
  )
  .option("--comparison <method>", "Comparison method: holistic, pairwise")
  .option("--model <name>", "Override model")
  .option("--dry-run", "Show resolved config and exit")
  .action(async (plansDir: string, opts) => {
    try {
      const overrides: Record<string, unknown> = {};
      if (opts.model !== undefined) overrides.model = opts.model;
      if (opts.strategy !== undefined) overrides.strategy = opts.strategy;
      if (opts.comparison !== undefined)
        overrides.comparisonMethod = opts.comparison;

      const config = await resolveMergeConfig({
        cliConfigPath: opts.config,
        cliOverrides: overrides,
      });

      if (opts.dryRun) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "merge",
        configPath: opts.config ?? "",
        outputDir: plansDir,
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();
      collector.setStage("merging");

      const plans = await readPlanSet(plansDir);
      const result = await merge(plans, config, { onStatusMessage });
      await writeMergeResult(result, plansDir);

      printMergeSummary(plansDir, result.strategy);

      collector.setStage("done");
      await statusServer.stop();
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
// evaluate
// ---------------------------------------------------------------------------

program
  .command("evaluate")
  .description("Evaluate generated plans from a directory")
  .argument("<plans-dir>", "Directory containing plan-*.md files")
  .option("--config <file>", "Merge config file path")
  .option("--model <name>", "Model for evaluation (default: haiku)")
  .action(async (plansDir: string, opts) => {
    try {
      const resolvedDir = path.resolve(plansDir);

      const config = await resolveMergeConfig({
        cliConfigPath: opts.config,
        cliOverrides: {},
      });

      const planSet = await readPlanSet(resolvedDir);

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "evaluate",
        configPath: opts.config ?? "",
        outputDir: resolvedDir,
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();
      collector.setStage("evaluating");

      const evalOpts: EvaluateOptions = {
        model: opts.model,
        signal: controller.signal,
        onStatusMessage,
      };

      const evalResult = await evaluate(planSet, config, evalOpts);
      await writeEvalResult(evalResult, planSet.runDir);

      printEvalSummary(
        evalResult.convergence,
        evalResult.gaps,
        evalResult.summary,
      );

      collector.setStage("done");
      await statusServer.stop();
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
// verify
// ---------------------------------------------------------------------------

program
  .command("verify")
  .description("Verify a merged plan against its source plans")
  .argument(
    "<plans-dir>",
    "Directory containing merged-plan.md and plan-*.md files",
  )
  .option("--config <file>", "Merge config file path")
  .option("--model <name>", "Model for verification (default: sonnet)")
  .option("--pre-mortem", "Run pre-mortem failure analysis after verification")
  .action(async (plansDir: string, opts) => {
    try {
      const resolvedDir = path.resolve(plansDir);

      const planSet = await readPlanSet(resolvedDir);

      const mergedContent = await fs.readFile(
        path.join(resolvedDir, "merged-plan.md"),
        "utf-8",
      );

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "verify",
        configPath: opts.config ?? "",
        outputDir: resolvedDir,
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();
      collector.setStage("verifying");

      const minimalMergeResult = {
        content: mergedContent,
        comparison: [] as const,
        strategy: "simple" as const,
        metadata: {
          model: opts.model ?? "unknown",
          turns: 0,
          durationMs: 0,
          durationApiMs: 0,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUsd: 0,
          },
          costUsd: 0,
          stopReason: null,
          sessionId: "",
          sourcePlans: planSet.plans.length,
          totalCostUsd: 0,
        },
      };

      const verifyOpts: VerifyOptions = {
        model: opts.model,
        signal: controller.signal,
        onStatusMessage,
      };

      const verifyResult = await verify(
        minimalMergeResult,
        planSet,
        verifyOpts,
      );
      await writeVerifyResult(verifyResult, resolvedDir);

      printVerifySummary(verifyResult.gates, verifyResult.pass);

      if (opts.preMortem) {
        collector.setStage("pre-mortem");
        const pmOpts: PreMortemOptions = {
          model: opts.model,
          signal: controller.signal,
          onStatusMessage,
        };
        const pmResult = await runPreMortem(mergedContent, resolvedDir, pmOpts);
        await writePreMortemResult(pmResult, resolvedDir);
        console.error(
          `Pre-mortem: ${pmResult.scenarios.length} failure scenarios → ${resolvedDir}/pre-mortem.md`,
        );
      }

      collector.setStage("done");
      await statusServer.stop();
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
  .option(
    "--multi",
    "Multi-file mode: treat extra positional args as variant files",
  )
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
  .option(
    "--strategy <name>",
    "Merge strategy: simple, agent-teams, subagent-debate",
  )
  .option("--comparison <method>", "Comparison method: holistic, pairwise")
  // pipeline flags
  .option("--skip-eval", "Skip pre-merge evaluation")
  .option("--verify", "Run post-merge verification")
  .option("--verify-model <name>", "Model for verification (default: sonnet)")
  .option("--pre-mortem", "Run pre-mortem failure analysis after verification")
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
      if (opts.comparison !== undefined)
        mergeOverrides.comparisonMethod = opts.comparison;

      const mergeConfig = await resolveMergeConfig({
        cliConfigPath: opts.mergeConfig,
        cliOverrides: mergeOverrides,
      });

      if (opts.dryRun) {
        console.log(
          JSON.stringify({ generate: genConfig, merge: mergeConfig }, null, 2),
        );
        return;
      }

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "run",
        configPath: opts.config ?? opts.mergeConfig ?? "",
        outputDir: "",
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();

      // 1. Generate
      collector.setStage("generating");
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
            onStatusMessage,
          }
        : {
            prompt: (await readPromptFile(promptFile)).content,
            debug: opts.debug ?? false,
            signal: controller.signal,
            onStatusMessage,
          };

      const planSet = await generate(genConfig, generateOpts);
      await writePlanSet(planSet, planSet.runDir);
      collector.setOutputDir(planSet.runDir);

      const variantNames = planSet.plans.map((p) => p.variant.name);
      printGenerateSummary(planSet.runDir, planSet.plans.length, variantNames);

      // 2. Evaluate (optional — skipped when --skip-eval is set)
      let evalResult = undefined;
      if (!opts.skipEval) {
        collector.setStage("evaluating");
        evalResult = await evaluate(planSet, mergeConfig, {
          signal: controller.signal,
          onStatusMessage,
        });
        await writeEvalResult(evalResult, planSet.runDir);
        printEvalSummary(
          evalResult.convergence,
          evalResult.gaps,
          evalResult.summary,
        );
      }

      // 3. Merge
      collector.setStage("merging");
      const mergeResult = await merge(planSet, mergeConfig, {
        evalResult,
        onStatusMessage,
      });
      await writeMergeResult(mergeResult, planSet.runDir);

      printMergeSummary(planSet.runDir, mergeResult.strategy);

      // 4. Verify (optional — enabled when --verify is set)
      let verifyResult = undefined;
      if (opts.verify) {
        collector.setStage("verifying");
        const verifyOpts: VerifyOptions = {
          model: opts.verifyModel,
          signal: controller.signal,
          onStatusMessage,
        };
        verifyResult = await verify(mergeResult, planSet, verifyOpts);
        await writeVerifyResult(verifyResult, planSet.runDir);
        printVerifySummary(verifyResult.gates, verifyResult.pass);

        if (opts.preMortem) {
          collector.setStage("pre-mortem");
          const pmOpts: PreMortemOptions = {
            model: opts.verifyModel,
            signal: controller.signal,
            onStatusMessage,
          };
          const pmResult = await runPreMortem(
            mergeResult.content,
            planSet.runDir,
            pmOpts,
          );
          await writePreMortemResult(pmResult, planSet.runDir);
          console.error(
            `Pre-mortem: ${pmResult.scenarios.length} failure scenarios → ${planSet.runDir}/pre-mortem.md`,
          );
        }
      }

      collector.setStage("done");
      await statusServer.stop();

      const pipelineResult: PipelineResult = {
        planSet,
        mergeResult,
        evalResult,
        verifyResult,
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
// monitor
// ---------------------------------------------------------------------------

program.addCommand(monitorCommand);

// ---------------------------------------------------------------------------
// Parse and run
// ---------------------------------------------------------------------------

program.parse();
