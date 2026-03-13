import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { JaccardPair } from "../../../src/evaluate/jaccard.js";
import {
  formatComparisonTable,
  type ComparisonMetrics,
  type EntropyResult,
  type RetentionResult,
} from "./metrics.js";

export interface Baseline {
  readonly name: string;
  readonly mode: "quick" | "full";
  readonly timestamp: string;
  readonly commitSha: string;
  readonly model: string;
  readonly jaccardMean: number;
  readonly jaccardDistance: number;
  readonly jaccardPairs: readonly JaccardPair[];
  readonly dimensionCoverage: Record<string, boolean>;
  readonly shannonEntropy?: EntropyResult;
  readonly retentionScore?: RetentionResult;
  readonly configPaths: {
    readonly generate: string;
    readonly merge: string;
  };
}

const DEFAULT_BASELINES_DIR = "eval/baselines";

/** Get current git commit SHA */
export function getCommitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf-8",
      timeout: 5_000,
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Save a baseline to disk.
 *
 * Layout:
 *   <baseDir>/<name>/baseline.json
 *   <baseDir>/<name>/plans/plan-<variant>.md
 *   <baseDir>/<name>/merged.md
 */
export async function saveBaseline(
  baseline: Baseline,
  plans: ReadonlyMap<string, string>,
  mergedContent: string,
  baseDir: string = DEFAULT_BASELINES_DIR,
): Promise<string> {
  const dir = path.join(baseDir, baseline.name);
  const plansDir = path.join(dir, "plans");

  await fs.mkdir(plansDir, { recursive: true });

  await fs.writeFile(
    path.join(dir, "baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n",
    "utf-8",
  );

  for (const [variantName, content] of plans) {
    await fs.writeFile(
      path.join(plansDir, `plan-${variantName}.md`),
      content,
      "utf-8",
    );
  }

  await fs.writeFile(path.join(dir, "merged.md"), mergedContent, "utf-8");

  return dir;
}

/** Load a stored baseline by name. */
export async function loadBaseline(
  name: string,
  baseDir: string = DEFAULT_BASELINES_DIR,
): Promise<Baseline> {
  const jsonPath = path.join(baseDir, name, "baseline.json");
  const content = await fs.readFile(jsonPath, "utf-8");
  return JSON.parse(content) as Baseline;
}

/**
 * Compare current metrics against a stored baseline.
 * Returns a formatted comparison table string.
 */
export async function compareBaseline(
  baselineName: string,
  currentMetrics: ComparisonMetrics,
  baseDir: string = DEFAULT_BASELINES_DIR,
): Promise<string> {
  const baseline = await loadBaseline(baselineName, baseDir);

  const baselineMetrics: ComparisonMetrics = {
    jaccardDistance: baseline.jaccardDistance,
    dimensionCoverage: baseline.dimensionCoverage,
    model: baseline.model,
    shannonEntropy: baseline.shannonEntropy?.mean,
    retentionScore: baseline.retentionScore?.overall,
  };

  const header = `Comparing against baseline "${baselineName}" (${baseline.timestamp.slice(0, 10)})`;
  const table = formatComparisonTable(baselineMetrics, currentMetrics);

  return `${header}\n\n${table}`;
}
