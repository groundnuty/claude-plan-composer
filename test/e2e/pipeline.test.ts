/**
 * E2E pipeline test: generate -> merge (simple/holistic)
 *
 * Makes REAL Claude API calls (costs ~$1).
 * Excluded from default `vitest run` via vitest.config.ts.
 * Run explicitly: `vitest run test/e2e/`
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, it, expect, afterAll } from "vitest";
import { generate } from "../../src/generate/index.js";
import { merge } from "../../src/merge/index.js";
import { writePlanSet } from "../../src/pipeline/io.js";
import type { GenerateConfig } from "../../src/types/config.js";
import type { MergeConfig } from "../../src/types/config.js";
import { GenerateConfigSchema, MergeConfigSchema } from "../../src/types/config.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";
const outputDir = path.join(
  TMPDIR,
  `e2e-pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
);

const genConfig: GenerateConfig = GenerateConfigSchema.parse({
  model: "haiku",
  maxTurns: 10,
  timeoutMs: 120_000,
  minOutputBytes: 500,
  variants: [
    { name: "concise", guidance: "Be concise and minimal." },
    { name: "detailed", guidance: "Be detailed and thorough." },
  ],
});

const mergeConfig: MergeConfig = MergeConfigSchema.parse({
  model: "haiku",
  maxTurns: 10,
  timeoutMs: 120_000,
  strategy: "simple",
  comparisonMethod: "holistic",
});

const PROMPT = "Create a plan for a hello world CLI app in Python";

// Skip the entire suite if no API key is available
const suite = process.env["ANTHROPIC_API_KEY"]
  ? describe
  : describe.skip;

suite("E2E: generate -> merge pipeline", () => {
  let runDir: string;

  afterAll(async () => {
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("full pipeline: generate 2 variants then merge", async () => {
    // --- Generate phase ---
    const planSet = await generate(genConfig, {
      prompt: PROMPT,
      outputDir,
    });

    runDir = planSet.runDir;

    // PlanSet has 2 plans
    expect(planSet.plans).toHaveLength(2);

    // Each plan has content > 500 bytes
    for (const plan of planSet.plans) {
      const sizeBytes = Buffer.byteLength(plan.content, "utf-8");
      expect(sizeBytes).toBeGreaterThan(500);
    }

    // Plan files were written to disk by the session runner
    const concisePath = path.join(runDir, "plan-concise.md");
    const detailedPath = path.join(runDir, "plan-detailed.md");
    const conciseExists = await fs.stat(concisePath).then(() => true, () => false);
    const detailedExists = await fs.stat(detailedPath).then(() => true, () => false);
    expect(conciseExists).toBe(true);
    expect(detailedExists).toBe(true);

    // NDJSON log files exist in the run directory
    const conciseLogPath = path.join(runDir, "plan-concise.log");
    const detailedLogPath = path.join(runDir, "plan-detailed.log");
    const conciseLogExists = await fs.stat(conciseLogPath).then(() => true, () => false);
    const detailedLogExists = await fs.stat(detailedLogPath).then(() => true, () => false);
    expect(conciseLogExists).toBe(true);
    expect(detailedLogExists).toBe(true);

    // --- Merge phase ---
    const mergeResult = await merge(planSet, mergeConfig);

    // MergeResult has content > 500 bytes
    const mergeSizeBytes = Buffer.byteLength(mergeResult.content, "utf-8");
    expect(mergeSizeBytes).toBeGreaterThan(500);

    // merged-plan.md was written to disk by the merge strategy
    const mergedPlanPath = path.join(runDir, "merged-plan.md");
    const mergedPlanExists = await fs.stat(mergedPlanPath).then(() => true, () => false);
    expect(mergedPlanExists).toBe(true);

    const mergedContent = await fs.readFile(mergedPlanPath, "utf-8");
    expect(Buffer.byteLength(mergedContent, "utf-8")).toBeGreaterThan(500);
  }, 180_000);

  it("NDJSON log files contain valid JSON with expected message types", async () => {
    // This test depends on runDir being set by the previous test.
    // If the previous test failed, skip gracefully.
    if (!runDir) {
      expect.fail("runDir not set -- previous test likely failed");
    }

    const entries = await fs.readdir(runDir);
    const logFiles = entries.filter((f) => f.endsWith(".log"));

    expect(logFiles.length).toBeGreaterThanOrEqual(2);

    let foundAssistantOrResult = false;

    for (const logFile of logFiles) {
      const logContent = await fs.readFile(
        path.join(runDir, logFile),
        "utf-8",
      );

      const lines = logContent.trimEnd().split("\n");
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        // Each line must be valid JSON
        const parsed = JSON.parse(line);
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe("object");

        if (
          parsed.type === "assistant" ||
          parsed.type === "result"
        ) {
          foundAssistantOrResult = true;
        }
      }
    }

    expect(foundAssistantOrResult).toBe(true);
  }, 180_000);
});
