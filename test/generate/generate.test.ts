import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { materializeConfig } from "../../src/generate/index.js";
import { GenerateConfigSchema } from "../../src/types/config.js";
import type { GenerateConfig } from "../../src/types/config.js";
import { MissingBasePromptError, IncompatibleFlagsError } from "../../src/types/errors.js";

const fixtureDir = path.dirname(
  fileURLToPath(new URL("../fixtures", import.meta.url)),
);
const fixturesPath = path.join(fixtureDir, "fixtures");

describe("materializeConfig", () => {
  it("reads base prompt file and returns content", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      prompt: path.join(fixturesPath, "prompts", "task.md"),
    });
    const result = await materializeConfig(config);
    expect(result.basePrompt).toBeDefined();
    expect(result.basePrompt!.length).toBeGreaterThan(0);
  });

  it("reads context file when specified", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      prompt: path.join(fixturesPath, "prompts", "task.md"),
      context: path.join(fixturesPath, "prompts", "alt.md"),
    });
    const result = await materializeConfig(config);
    expect(result.context).toBeDefined();
    expect(result.context!.length).toBeGreaterThan(0);
  });

  it("returns undefined context when not specified", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      prompt: path.join(fixturesPath, "prompts", "task.md"),
    });
    const result = await materializeConfig(config);
    expect(result.context).toBeUndefined();
  });

  it("reads per-variant prompt files and returns contents map", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      variants: [
        {
          name: "alt",
          guidance: "test",
          promptFile: path.join(fixturesPath, "prompts", "alt.md"),
        },
      ],
    });
    const result = await materializeConfig(config);
    expect(result.variantPromptContents.get("alt")).toContain("security");
  });

  it("returns empty map when no variants have promptFile", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      prompt: path.join(fixturesPath, "prompts", "task.md"),
      variants: [{ name: "alpha", guidance: "test" }],
    });
    const result = await materializeConfig(config);
    expect(result.variantPromptContents.size).toBe(0);
  });

  it("throws MissingBasePromptError when no prompt and variants lack promptFile", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      variants: [{ name: "alpha", guidance: "test" }],
    });
    await expect(materializeConfig(config)).rejects.toThrow(
      MissingBasePromptError,
    );
  });

  it("does not throw when all variants have promptFile (no base prompt needed)", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      variants: [
        {
          name: "alt",
          guidance: "",
          promptFile: path.join(fixturesPath, "prompts", "alt.md"),
        },
      ],
    });
    const result = await materializeConfig(config);
    expect(result.basePrompt).toBeUndefined();
  });

  it("throws IncompatibleFlagsError when autoLenses with promptFile variants", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      prompt: path.join(fixturesPath, "prompts", "task.md"),
      autoLenses: true,
      variants: [
        {
          name: "alt",
          guidance: "",
          promptFile: path.join(fixturesPath, "prompts", "alt.md"),
        },
      ],
    });
    await expect(materializeConfig(config)).rejects.toThrow(
      IncompatibleFlagsError,
    );
  });

  it("throws IncompatibleFlagsError when sequentialDiversity with promptFile variants", async () => {
    const config: GenerateConfig = GenerateConfigSchema.parse({
      prompt: path.join(fixturesPath, "prompts", "task.md"),
      sequentialDiversity: true,
      variants: [
        {
          name: "alt",
          guidance: "",
          promptFile: path.join(fixturesPath, "prompts", "alt.md"),
        },
      ],
    });
    await expect(materializeConfig(config)).rejects.toThrow(
      IncompatibleFlagsError,
    );
  });
});
