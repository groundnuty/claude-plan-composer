import * as os from "node:os";
import * as path from "node:path";
import {
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../../../src/pipeline/config-resolver.js";
import type { GenerateConfig, MergeConfig } from "../../../src/types/config.js";

export type EvalMode = "quick" | "full";

const VALID_MODES: readonly EvalMode[] = ["quick", "full"];

/** Read EVAL_MODE env var, default to "quick" */
export function getEvalMode(): EvalMode {
  const raw = process.env["EVAL_MODE"] ?? "quick";
  if (!VALID_MODES.includes(raw as EvalMode)) {
    throw new Error(
      `Invalid EVAL_MODE: "${raw}". Must be one of: ${VALID_MODES.join(", ")}`,
    );
  }
  return raw as EvalMode;
}

/** Map eval mode to config directory (relative to project root / CWD) */
export function getConfigDir(mode: EvalMode): string {
  return mode === "quick" ? "test/fixtures/eval" : "eval/configs/full";
}

/** Load generate config for the current eval mode */
export async function loadGenerateConfig(mode: EvalMode): Promise<GenerateConfig> {
  const dir = getConfigDir(mode);
  return resolveGenerateConfig({
    cliConfigPath: path.join(dir, "config.yaml"),
  });
}

/** Load merge config for the current eval mode */
export async function loadMergeConfig(mode: EvalMode): Promise<MergeConfig> {
  const dir = getConfigDir(mode);
  return resolveMergeConfig({
    cliConfigPath: path.join(dir, "merge-config.yaml"),
  });
}

/**
 * Check if Claude auth is available (API key or logged-in CLI).
 * Same pattern as test/e2e/pipeline.test.ts.
 */
export async function hasClaudeAuth(): Promise<boolean> {
  if (process.env["ANTHROPIC_API_KEY"]) return true;
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("claude", ["--version"], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a temp output directory path for eval runs.
 * Returns the path. Caller must clean up in afterAll.
 * Note: does not create the directory — generate() creates it with mkdir({recursive: true}).
 */
export function makeTempOutputDir(prefix: string): string {
  const tmpBase = process.env["TMPDIR"] ?? os.tmpdir();
  return path.join(
    tmpBase,
    `eval-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}
