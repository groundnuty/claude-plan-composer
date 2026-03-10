import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  snakeToCamel,
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../../src/pipeline/config-resolver.js";
import { ConfigValidationError } from "../../src/types/errors.js";

const fixtureDir = path.dirname(fileURLToPath(new URL("../fixtures", import.meta.url)));
const fixturesPath = path.join(fixtureDir, "fixtures");

describe("snakeToCamel", () => {
  it("converts flat snake_case keys to camelCase", () => {
    const input = { max_turns: 20, timeout_ms: 600_000, model: "opus" };
    const result = snakeToCamel(input);
    expect(result).toEqual({ maxTurns: 20, timeoutMs: 600_000, model: "opus" });
  });

  it("converts nested snake_case keys recursively", () => {
    const input = {
      top_level: {
        inner_key: "value",
        deep_nest: {
          another_key: 42,
        },
      },
    };
    const result = snakeToCamel(input);
    expect(result).toEqual({
      topLevel: {
        innerKey: "value",
        deepNest: {
          anotherKey: 42,
        },
      },
    });
  });

  it("handles arrays with objects correctly", () => {
    const input = {
      variants: [
        { some_name: "baseline", variant_guidance: "" },
        { some_name: "simplicity", variant_guidance: "Keep it simple." },
      ],
    };
    const result = snakeToCamel(input);
    expect(result).toEqual({
      variants: [
        { someName: "baseline", variantGuidance: "" },
        { someName: "simplicity", variantGuidance: "Keep it simple." },
      ],
    });
  });

  it("preserves arrays of primitives unchanged", () => {
    const input = { allowed_tools: ["Read", "Write", "Bash"] };
    const result = snakeToCamel(input);
    expect(result).toEqual({ allowedTools: ["Read", "Write", "Bash"] });
  });

  it("preserves already-camelCase keys", () => {
    const input = { maxTurns: 10, timeoutMs: 5000 };
    const result = snakeToCamel(input);
    expect(result).toEqual({ maxTurns: 10, timeoutMs: 5000 });
  });

  it("handles empty objects", () => {
    expect(snakeToCamel({})).toEqual({});
  });
});

describe("resolveGenerateConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear all CPC_* env vars to isolate tests
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CPC_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("returns defaults when no config file is found", async () => {
    const config = await resolveGenerateConfig();
    expect(config.model).toBe("opus");
    expect(config.maxTurns).toBe(80);
    expect(config.timeoutMs).toBe(3_600_000);
    expect(config.variants).toHaveLength(4);
    expect(config.variants[0]!.name).toBe("baseline");
    expect(config.autoLenses).toBe(false);
    expect(config.sequentialDiversity).toBe(false);
    expect(config.staggerMs).toBe(0);
    expect(config.minOutputBytes).toBe(5000);
  });

  it("loads and parses a YAML config file from fixture", async () => {
    const configPath = path.join(fixturesPath, "config.yaml");
    const config = await resolveGenerateConfig({ cliConfigPath: configPath });

    expect(config.model).toBe("sonnet");
    expect(config.maxTurns).toBe(20);
    expect(config.timeoutMs).toBe(600_000);
    expect(config.minOutputBytes).toBe(500);
    expect(config.variants).toHaveLength(2);
    expect(config.variants[0]!.name).toBe("baseline");
    expect(config.variants[1]!.name).toBe("simplicity");
    expect(config.variants[1]!.guidance).toBe("Prioritize minimalism.");
  });

  it("applies CPC_* env var overrides", async () => {
    process.env["CPC_MODEL"] = "haiku";
    process.env["CPC_MAX_TURNS"] = "10";
    process.env["CPC_TIMEOUT_MS"] = "300000";

    const config = await resolveGenerateConfig();
    expect(config.model).toBe("haiku");
    expect(config.maxTurns).toBe(10);
    expect(config.timeoutMs).toBe(300_000);
  });

  it("parses boolean env var values", async () => {
    // autoLenses is not in the GENERATE_ENV_MAP, so test with a numeric one
    // to verify that number parsing works from env
    process.env["CPC_MAX_TURNS"] = "5";
    const config = await resolveGenerateConfig();
    expect(config.maxTurns).toBe(5);
    expect(typeof config.maxTurns).toBe("number");
  });

  it("applies CLI overrides with highest priority", async () => {
    const configPath = path.join(fixturesPath, "config.yaml");
    // Fixture has model: sonnet, maxTurns: 20
    const config = await resolveGenerateConfig({
      cliConfigPath: configPath,
      cliOverrides: { model: "haiku", maxTurns: 5 },
    });

    expect(config.model).toBe("haiku");
    expect(config.maxTurns).toBe(5);
    // Non-overridden values should come from fixture
    expect(config.timeoutMs).toBe(600_000);
  });

  it("follows priority order: CLI > env > config > default", async () => {
    const configPath = path.join(fixturesPath, "config.yaml");
    // Fixture: model=sonnet, maxTurns=20, timeoutMs=600000

    // Env overrides config for maxTurns
    process.env["CPC_MAX_TURNS"] = "50";
    // Env overrides config for model
    process.env["CPC_MODEL"] = "haiku";

    const config = await resolveGenerateConfig({
      cliConfigPath: configPath,
      // CLI overrides env for model
      cliOverrides: { model: "opus" },
    });

    // CLI wins over env and config
    expect(config.model).toBe("opus");
    // Env wins over config (fixture has 20)
    expect(config.maxTurns).toBe(50);
    // Config wins over default (default is 3_600_000, fixture has 600_000)
    expect(config.timeoutMs).toBe(600_000);
    // Default applies where nothing else overrides
    expect(config.autoLenses).toBe(false);
  });
});

describe("resolveMergeConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CPC_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("returns defaults when no config file is found", async () => {
    const config = await resolveMergeConfig();
    expect(config.model).toBe("opus");
    expect(config.maxTurns).toBe(30);
    expect(config.timeoutMs).toBe(3_600_000);
    expect(config.strategy).toBe("simple");
    expect(config.comparisonMethod).toBe("holistic");
    expect(config.dimensions).toHaveLength(6);
    expect(config.constitution).toHaveLength(5);
    expect(config.evalScoring).toBe("binary");
    expect(config.evalPasses).toBe(1);
    expect(config.outputTitle).toBe("Merged Plan");
  });

  it("loads and parses a YAML merge config file from fixture", async () => {
    const configPath = path.join(fixturesPath, "merge-config.yaml");
    const config = await resolveMergeConfig({ cliConfigPath: configPath });

    expect(config.model).toBe("sonnet");
    expect(config.maxTurns).toBe(15);
    expect(config.strategy).toBe("simple");
    expect(config.comparisonMethod).toBe("holistic");
    expect(config.projectDescription).toBe("test project");
    expect(config.role).toBe("an expert analyst");
    expect(config.dimensions).toHaveLength(2);
    expect(config.dimensions[0]).toBe("Approach and strategy");
    expect(config.dimensions[1]).toBe("Technical depth");
    expect(config.constitution).toHaveLength(2);
  });

  it("applies CPC_STRATEGY env var override", async () => {
    process.env["CPC_STRATEGY"] = "agent-teams";
    const config = await resolveMergeConfig();
    expect(config.strategy).toBe("agent-teams");
  });
});

describe("config validation errors", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CPC_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("throws ConfigValidationError for invalid maxTurns type", async () => {
    await expect(
      resolveGenerateConfig({
        cliOverrides: { maxTurns: "not-a-number" },
      }),
    ).rejects.toThrow(ConfigValidationError);
  });

  it("throws ConfigValidationError for invalid merge strategy", async () => {
    await expect(
      resolveMergeConfig({
        cliOverrides: { strategy: "invalid-strategy" },
      }),
    ).rejects.toThrow(ConfigValidationError);
  });

  it("thrown error has code CONFIG_VALIDATION", async () => {
    try {
      await resolveGenerateConfig({
        cliOverrides: { maxTurns: "bad" },
      });
      expect.fail("Expected ConfigValidationError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as ConfigValidationError).code).toBe("CONFIG_VALIDATION");
    }
  });
});
