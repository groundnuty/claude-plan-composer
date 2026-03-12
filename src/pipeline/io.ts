import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import type { Plan, PlanMetadata, PlanSet, TokenUsage } from "../types/plan.js";
import type { MergeResult } from "../types/merge-result.js";
import type { EvalResult, VerifyResult } from "../types/evaluation.js";
import type { PreMortemResult } from "../verify/pre-mortem.js";
import { PlanExtractionError } from "../types/errors.js";

/** Write a PlanSet to disk: plan-*.md + plan-*.meta.json + latest symlink */
export async function writePlanSet(
  planSet: PlanSet,
  baseDir: string,
): Promise<string> {
  const runDir = path.join(baseDir, planSet.timestamp.replace(/[:.]/g, "-"));
  await fs.mkdir(runDir, { recursive: true });

  for (const plan of planSet.plans) {
    await fs.writeFile(
      path.join(runDir, `plan-${plan.variant.name}.md`),
      plan.content,
    );
    await fs.writeFile(
      path.join(runDir, `plan-${plan.variant.name}.meta.json`),
      JSON.stringify(plan.metadata, null, 2),
    );
  }

  // Create latest symlink (atomic: create temp symlink, then rename)
  const latestLink = path.join(baseDir, "latest");
  const tmpLink = path.join(baseDir, `.latest-${process.pid}`);
  try {
    await fs.symlink(runDir, tmpLink);
    await fs.rename(tmpLink, latestLink);
  } catch {
    // Fallback: non-atomic (rm + symlink) if rename fails
    await fs.rm(latestLink, { force: true });
    await fs.symlink(runDir, latestLink);
  }

  return runDir;
}

const EMPTY_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUsd: 0,
};

const EMPTY_METADATA: PlanMetadata = {
  model: "unknown",
  turns: 0,
  durationMs: 0,
  durationApiMs: 0,
  tokenUsage: EMPTY_TOKEN_USAGE,
  costUsd: 0,
  stopReason: null,
  sessionId: "",
};

/** Read a PlanSet from a run directory (plan-*.md + optional *.meta.json) */
export async function readPlanSet(dir: string): Promise<PlanSet> {
  const entries = await fs.readdir(dir);
  const planFiles = entries
    .filter((f) => f.startsWith("plan-") && f.endsWith(".md"))
    .sort();

  if (planFiles.length === 0) {
    throw new PlanExtractionError(
      "(all)",
      `No plan-*.md files found in ${dir}`,
    );
  }

  const plans: Plan[] = await Promise.all(
    planFiles.map(async (file) => {
      const variantName = file.replace(/^plan-/, "").replace(/\.md$/, "");
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const metaPath = path.join(dir, `plan-${variantName}.meta.json`);

      let metadata: PlanMetadata = EMPTY_METADATA;
      try {
        const raw = JSON.parse(await fs.readFile(metaPath, "utf-8"));
        metadata = raw as PlanMetadata;
      } catch {
        // meta.json is optional (bash plans won't have it)
      }

      return {
        variant: { name: variantName, guidance: "" },
        content,
        metadata,
      };
    }),
  );

  const dirName = path.basename(dir);
  return { plans, timestamp: dirName, runDir: dir };
}

/** Write merge result to disk: merged-plan.md + merge-result.json */
export async function writeMergeResult(
  result: MergeResult,
  dir: string,
): Promise<void> {
  await fs.writeFile(path.join(dir, "merged-plan.md"), result.content);
  await fs.writeFile(
    path.join(dir, "merge-result.json"),
    JSON.stringify(
      {
        comparison: result.comparison,
        strategy: result.strategy,
        metadata: result.metadata,
      },
      null,
      2,
    ),
  );
}

/** Resolve MCP config path relative to a base directory */
export function loadMcpConfig(
  configPath: string,
  baseDir: string,
): string | undefined {
  if (!configPath) return undefined;
  const resolved = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(baseDir, configPath);
  if (!existsSync(resolved)) {
    console.warn(`Warning: mcp_config file not found: ${resolved} (skipping)`);
    return undefined;
  }
  return resolved;
}

/** Write evaluation result to disk: evaluation.json */
export async function writeEvalResult(
  result: EvalResult,
  dir: string,
): Promise<void> {
  await fs.writeFile(
    path.join(dir, "evaluation.json"),
    JSON.stringify(result, null, 2),
  );
}

/** Read evaluation result from disk, returns undefined if file not found */
export async function readEvalResult(
  dir: string,
): Promise<EvalResult | undefined> {
  const filePath = path.join(dir, "evaluation.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as EvalResult;
  } catch {
    return undefined;
  }
}

/** Write verification result to disk: verification-report.json */
export async function writeVerifyResult(
  result: VerifyResult,
  dir: string,
): Promise<void> {
  await fs.writeFile(
    path.join(dir, "verification-report.json"),
    JSON.stringify(result, null, 2),
  );
}

/** Write pre-mortem result to disk: pre-mortem.md + pre-mortem.json */
export async function writePreMortemResult(
  result: PreMortemResult,
  dir: string,
): Promise<void> {
  await fs.writeFile(path.join(dir, "pre-mortem.md"), result.markdown);
  await fs.writeFile(
    path.join(dir, "pre-mortem.json"),
    JSON.stringify(result, null, 2),
  );
}
