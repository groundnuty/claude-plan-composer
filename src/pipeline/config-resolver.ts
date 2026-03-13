import * as fs from "node:fs/promises";
import * as yaml from "js-yaml";
import { GenerateConfigSchema, MergeConfigSchema } from "../types/config.js";
import type { GenerateConfig, MergeConfig } from "../types/config.js";
import { ConfigValidationError } from "../types/errors.js";

/** Convert snake_case YAML keys to camelCase for Zod schemas */
function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c: string) =>
      c.toUpperCase(),
    );
    result[camelKey] = Array.isArray(value)
      ? value.map((v) =>
          typeof v === "object" && v !== null
            ? snakeToCamel(v as Record<string, unknown>)
            : v,
        )
      : typeof value === "object" && value !== null
        ? snakeToCamel(value as Record<string, unknown>)
        : value;
  }
  return result;
}

/** Try to find a config file using the resolution chain */
async function findConfigFile(
  baseName: string,
  cliPath?: string,
  envVar?: string,
): Promise<string | undefined> {
  // 1. CLI flag (highest priority)
  if (cliPath) return cliPath;

  // 2. Environment variable
  const envPath = envVar ? process.env[envVar] : undefined;
  if (envPath) return envPath;

  // 3. Local override (*.local.yaml)
  const localPath = baseName.replace(/\.yaml$/, ".local.yaml");
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    /* not found */
  }

  // 4. Default config file
  try {
    await fs.access(baseName);
    return baseName;
  } catch {
    /* not found */
  }

  return undefined;
}

/**
 * Convert bash-style variant map to TS array format.
 *
 * Bash format:    { baseline: "", simplicity: "guidance", depth: { model: "sonnet", guidance: "..." } }
 * TS format:      [{ name: "baseline", guidance: "" }, { name: "simplicity", guidance: "guidance" }, ...]
 */
function normalizeVariants(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const variants = raw.variants;
  if (variants == null || Array.isArray(variants)) return raw;

  if (typeof variants === "object") {
    const map = variants as Record<string, unknown>;
    const arr = Object.entries(map).map(([name, value]) => {
      if (typeof value === "string" || value === null || value === undefined) {
        return { name, guidance: value ?? "" };
      }
      if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        return {
          name,
          guidance: obj.guidance ?? "",
          ...(obj.model ? { model: obj.model } : {}),
          ...(obj.promptFile ? { promptFile: obj.promptFile } : {}),
        };
      }
      return { name, guidance: String(value) };
    });
    return { ...raw, variants: arr };
  }

  return raw;
}

/** Convert bash-style timeout (seconds) to timeoutMs if present */
function normalizeTimeout(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if ("timeout" in raw && !("timeoutMs" in raw)) {
    const secs = Number(raw.timeout);
    if (!isNaN(secs) && secs > 0) {
      const { timeout: _, ...rest } = raw;
      return { ...rest, timeoutMs: secs * 1000 };
    }
  }
  if ("timeoutSecs" in raw && !("timeoutMs" in raw)) {
    const secs = Number(raw.timeoutSecs);
    if (!isNaN(secs) && secs > 0) {
      const { timeoutSecs: _, ...rest } = raw;
      return { ...rest, timeoutMs: secs * 1000 };
    }
  }
  return raw;
}

/** Convert bash-style add_dirs to additionalDirs */
function normalizeAddDirs(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if ("addDirs" in raw && !("additionalDirs" in raw)) {
    const { addDirs, ...rest } = raw;
    return { ...rest, additionalDirs: addDirs };
  }
  return raw;
}

/** Load and parse a YAML config file, transforming snake_case to camelCase */
async function loadYamlConfig(
  filePath: string,
): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, "utf-8");
  const raw = yaml.load(content);
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  let config = snakeToCamel(raw as Record<string, unknown>);
  config = normalizeVariants(config);
  config = normalizeTimeout(config);
  config = normalizeAddDirs(config);
  return config;
}

/** Apply environment variable overrides (CPC_* prefix) */
function applyEnvOverrides(
  config: Record<string, unknown>,
  envMap: Record<string, string>,
): Record<string, unknown> {
  const result = { ...config };
  for (const [envVar, configKey] of Object.entries(envMap)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      // Parse numbers and booleans
      if (/^\d+$/.test(value)) {
        result[configKey] = Number(value);
      } else if (/^\d+\.\d+$/.test(value)) {
        result[configKey] = Number(value);
      } else if (value === "true" || value === "false") {
        result[configKey] = value === "true";
      } else {
        result[configKey] = value;
      }
    }
  }
  return result;
}

/** Apply CLI flag overrides */
function applyCli(
  config: Record<string, unknown>,
  cliOverrides: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...config };
  for (const [key, value] of Object.entries(cliOverrides)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

const GENERATE_ENV_MAP: Record<string, string> = {
  CPC_MODEL: "model",
  CPC_MAX_TURNS: "maxTurns",
  CPC_TIMEOUT_MS: "timeoutMs",
  CPC_BUDGET_USD: "budgetUsd",
  CPC_WORK_DIR: "workDir",
};

const MERGE_ENV_MAP: Record<string, string> = {
  CPC_MODEL: "model",
  CPC_MAX_TURNS: "maxTurns",
  CPC_TIMEOUT_MS: "timeoutMs",
  CPC_BUDGET_USD: "budgetUsd",
  CPC_WORK_DIR: "workDir",
  CPC_STRATEGY: "strategy",
};

export interface ResolveOptions {
  readonly cliConfigPath?: string;
  readonly cliOverrides?: Record<string, unknown>;
}

export async function resolveGenerateConfig(
  options: ResolveOptions = {},
): Promise<GenerateConfig> {
  const configPath = await findConfigFile(
    "config.yaml",
    options.cliConfigPath,
    "CPC_CONFIG",
  );

  let raw: Record<string, unknown> = {};
  if (configPath) {
    raw = await loadYamlConfig(configPath);
  }

  raw = applyEnvOverrides(raw, GENERATE_ENV_MAP);
  raw = applyCli(raw, options.cliOverrides ?? {});

  const result = GenerateConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }
  return result.data;
}

export async function resolveMergeConfig(
  options: ResolveOptions = {},
): Promise<MergeConfig> {
  const configPath = await findConfigFile(
    "merge-config.yaml",
    options.cliConfigPath,
    "CPC_MERGE_CONFIG",
  );

  let raw: Record<string, unknown> = {};
  if (configPath) {
    raw = await loadYamlConfig(configPath);
  }

  raw = applyEnvOverrides(raw, MERGE_ENV_MAP);
  raw = applyCli(raw, options.cliOverrides ?? {});

  const result = MergeConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(result.error);
  }
  return result.data;
}

// Exported for testing
export { snakeToCamel, loadYamlConfig, applyEnvOverrides };
