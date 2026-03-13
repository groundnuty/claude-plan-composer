import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../../src/pipeline/config-resolver.js";

const fixturesPath = fileURLToPath(new URL("../fixtures", import.meta.url));

// -----------------------------------------------------------------------
// resolveGenerateConfig snapshots
// -----------------------------------------------------------------------

describe("resolveGenerateConfig snapshots", () => {
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

  it("fixture YAML only", async () => {
    const config = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config.yaml"),
    });
    expect(config).toMatchSnapshot();
  });

  it("fixture YAML + CLI overrides", async () => {
    const config = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config.yaml"),
      cliOverrides: { model: "haiku", maxTurns: 5 },
    });
    expect(config).toMatchSnapshot();
  });

  it("fixture YAML + env overrides", async () => {
    process.env["CPC_MODEL"] = "haiku";
    const config = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config.yaml"),
    });
    expect(config).toMatchSnapshot();
  });

  it("per-variant prompt_file YAML", async () => {
    const config = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config-with-prompt-file.yaml"),
    });
    expect(config).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// resolveMergeConfig snapshots
// -----------------------------------------------------------------------

describe("resolveMergeConfig snapshots", () => {
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

  it("fixture YAML only", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
    });
    expect(config).toMatchSnapshot();
  });

  it("fixture YAML + CLI override", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
      cliOverrides: { strategy: "subagent-debate" },
    });
    expect(config).toMatchSnapshot();
  });

  it("fixture YAML + env override", async () => {
    process.env["CPC_STRATEGY"] = "agent-teams";
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
    });
    expect(config).toMatchSnapshot();
  });
});
