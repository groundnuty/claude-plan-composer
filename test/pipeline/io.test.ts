import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  writePlanSet,
  readPlanSet,
  writeMergeResult,
  loadMcpConfig,
} from "../../src/pipeline/io.js";
import { NdjsonLogger } from "../../src/pipeline/logger.js";
import { PlanExtractionError } from "../../src/types/errors.js";
import type { PlanSet } from "../../src/types/plan.js";
import type { MergeResult } from "../../src/types/merge-result.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, "..", "fixtures");

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(TMPDIR, `io-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("writePlanSet", () => {
  const makePlanSet = (timestamp: string): PlanSet => ({
    timestamp,
    runDir: "",
    plans: [
      {
        variant: { name: "alpha", guidance: "be thorough" },
        content: "# Alpha Plan\n\nAlpha content here.\n",
        metadata: {
          model: "claude-sonnet-4-6-20260310",
          turns: 3,
          durationMs: 15000,
          durationApiMs: 12000,
          tokenUsage: {
            inputTokens: 2000,
            outputTokens: 4000,
            cacheReadInputTokens: 1000,
            cacheCreationInputTokens: 500,
            costUsd: 0.08,
          },
          costUsd: 0.08,
          stopReason: "end_turn",
          sessionId: "sess-alpha",
        },
      },
      {
        variant: { name: "beta", guidance: "be concise" },
        content: "# Beta Plan\n\nBeta content here.\n",
        metadata: {
          model: "claude-sonnet-4-6-20260310",
          turns: 2,
          durationMs: 10000,
          durationApiMs: 8000,
          tokenUsage: {
            inputTokens: 1500,
            outputTokens: 3000,
            cacheReadInputTokens: 800,
            cacheCreationInputTokens: 300,
            costUsd: 0.05,
          },
          costUsd: 0.05,
          stopReason: "end_turn",
          sessionId: "sess-beta",
        },
      },
    ],
  });

  it("creates run directory with plan-*.md files", async () => {
    const planSet = makePlanSet("2026-03-10T14:30:00.000Z");
    const runDir = await writePlanSet(planSet, tmpDir);

    const alphaContent = await fs.readFile(path.join(runDir, "plan-alpha.md"), "utf-8");
    const betaContent = await fs.readFile(path.join(runDir, "plan-beta.md"), "utf-8");

    expect(alphaContent).toBe("# Alpha Plan\n\nAlpha content here.\n");
    expect(betaContent).toBe("# Beta Plan\n\nBeta content here.\n");
  });

  it("creates plan-*.meta.json files with correct metadata", async () => {
    const planSet = makePlanSet("2026-03-10T14:30:00.000Z");
    const runDir = await writePlanSet(planSet, tmpDir);

    const alphaMeta = JSON.parse(
      await fs.readFile(path.join(runDir, "plan-alpha.meta.json"), "utf-8"),
    );
    const betaMeta = JSON.parse(
      await fs.readFile(path.join(runDir, "plan-beta.meta.json"), "utf-8"),
    );

    expect(alphaMeta.model).toBe("claude-sonnet-4-6-20260310");
    expect(alphaMeta.turns).toBe(3);
    expect(alphaMeta.sessionId).toBe("sess-alpha");
    expect(alphaMeta.tokenUsage.inputTokens).toBe(2000);

    expect(betaMeta.model).toBe("claude-sonnet-4-6-20260310");
    expect(betaMeta.turns).toBe(2);
    expect(betaMeta.sessionId).toBe("sess-beta");
  });

  it("creates latest symlink pointing to run directory", async () => {
    const planSet = makePlanSet("2026-03-10T14:30:00.000Z");
    const runDir = await writePlanSet(planSet, tmpDir);

    const latestLink = path.join(tmpDir, "latest");
    const target = await fs.readlink(latestLink);

    expect(target).toBe(runDir);
  });

  it("derives run directory name from timestamp", async () => {
    const planSet = makePlanSet("2026-03-10T14:30:00.123Z");
    const runDir = await writePlanSet(planSet, tmpDir);

    // Colons and dots in the timestamp are replaced with hyphens
    const dirName = path.basename(runDir);
    expect(dirName).toBe("2026-03-10T14-30-00-123Z");
    expect(dirName).not.toContain(":");
    expect(dirName).not.toContain(".");
  });
});

describe("readPlanSet", () => {
  it("reads plan-*.md files from a directory", async () => {
    const planSet = await readPlanSet(fixturesDir);

    const variantNames = planSet.plans.map(p => p.variant.name);
    expect(variantNames).toContain("baseline");
    expect(variantNames).toContain("simplicity");

    const baseline = planSet.plans.find(p => p.variant.name === "baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.content).toContain("# Plan: Baseline Approach");
    expect(baseline!.content).toContain("Component A: handles input processing");
  });

  it("reads plan-*.meta.json when available", async () => {
    const planSet = await readPlanSet(fixturesDir);

    const baseline = planSet.plans.find(p => p.variant.name === "baseline");
    expect(baseline).toBeDefined();
    expect(baseline!.metadata.model).toBe("claude-sonnet-4-6-20260310");
    expect(baseline!.metadata.turns).toBe(5);
    expect(baseline!.metadata.durationMs).toBe(30000);
    expect(baseline!.metadata.sessionId).toBe("test-session-baseline");
    expect(baseline!.metadata.tokenUsage.inputTokens).toBe(5000);
  });

  it("provides default metadata when meta.json is missing", async () => {
    const planSet = await readPlanSet(fixturesDir);

    // plan-simplicity.md has no matching .meta.json
    const simplicity = planSet.plans.find(p => p.variant.name === "simplicity");
    expect(simplicity).toBeDefined();
    expect(simplicity!.metadata.model).toBe("unknown");
    expect(simplicity!.metadata.turns).toBe(0);
    expect(simplicity!.metadata.durationMs).toBe(0);
    expect(simplicity!.metadata.costUsd).toBe(0);
    expect(simplicity!.metadata.sessionId).toBe("");
    expect(simplicity!.metadata.stopReason).toBeNull();
  });

  it("throws PlanExtractionError when no plan-*.md files found", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    await fs.mkdir(emptyDir, { recursive: true });

    await expect(readPlanSet(emptyDir)).rejects.toThrow(PlanExtractionError);
    await expect(readPlanSet(emptyDir)).rejects.toThrow(/No plan-\*\.md files found/);
  });

  it("returns plans sorted alphabetically by variant name", async () => {
    const planSet = await readPlanSet(fixturesDir);

    const variantNames = planSet.plans.map(p => p.variant.name);
    const sorted = [...variantNames].sort();
    expect(variantNames).toEqual(sorted);
  });
});

describe("writeMergeResult", () => {
  const makeMergeResult = (): MergeResult => ({
    content: "# Merged Plan\n\nBest of both worlds.\n",
    comparison: [
      {
        dimension: "architecture",
        winner: "baseline",
        classification: "genuine-tradeoff",
        justification: "Baseline provides more thorough component breakdown.",
      },
      {
        dimension: "timeline",
        winner: "simplicity",
        classification: "complementary",
        justification: "Simplicity plan is more realistic.",
      },
    ],
    strategy: "simple",
    metadata: {
      model: "claude-sonnet-4-6-20260310",
      turns: 4,
      durationMs: 20000,
      durationApiMs: 18000,
      tokenUsage: {
        inputTokens: 10000,
        outputTokens: 6000,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 2000,
        costUsd: 0.20,
      },
      costUsd: 0.20,
      stopReason: "end_turn",
      sessionId: "sess-merge",
      sourcePlans: 2,
      totalCostUsd: 0.33,
    },
  });

  it("creates merged-plan.md with content", async () => {
    const result = makeMergeResult();
    await writeMergeResult(result, tmpDir);

    const content = await fs.readFile(path.join(tmpDir, "merged-plan.md"), "utf-8");
    expect(content).toBe("# Merged Plan\n\nBest of both worlds.\n");
  });

  it("creates merge-result.json with comparison, strategy, metadata", async () => {
    const result = makeMergeResult();
    await writeMergeResult(result, tmpDir);

    const raw = JSON.parse(
      await fs.readFile(path.join(tmpDir, "merge-result.json"), "utf-8"),
    );

    expect(raw.strategy).toBe("simple");
    expect(raw.comparison).toHaveLength(2);
    expect(raw.comparison[0].dimension).toBe("architecture");
    expect(raw.comparison[0].winner).toBe("baseline");
    expect(raw.comparison[0].classification).toBe("genuine-tradeoff");
    expect(raw.comparison[1].dimension).toBe("timeline");
    expect(raw.metadata.model).toBe("claude-sonnet-4-6-20260310");
    expect(raw.metadata.sourcePlans).toBe(2);
    expect(raw.metadata.totalCostUsd).toBe(0.33);

    // merged-plan.md content should NOT be in merge-result.json
    expect(raw.content).toBeUndefined();
  });
});

describe("loadMcpConfig", () => {
  it("returns resolved path for existing file", async () => {
    const result = loadMcpConfig("mcp-servers.json", fixturesDir);
    expect(result).toBe(path.join(fixturesDir, "mcp-servers.json"));
  });

  it("returns undefined for non-existent file", () => {
    const result = loadMcpConfig("does-not-exist.json", fixturesDir);
    expect(result).toBeUndefined();
  });

  it("resolves relative paths against base directory", () => {
    const result = loadMcpConfig("mcp-servers.json", fixturesDir);
    expect(result).toBeDefined();
    expect(path.isAbsolute(result!)).toBe(true);
    expect(result).toBe(path.resolve(fixturesDir, "mcp-servers.json"));
  });
});

describe("NdjsonLogger", () => {
  it("writes messages as newline-delimited JSON", async () => {
    const logPath = path.join(tmpDir, "test.ndjson");
    const logger = new NdjsonLogger(logPath);

    await logger.write({ type: "init", sessionId: "s1" });
    await logger.write({ type: "message", content: "hello" });
    await logger.write({ type: "done", turns: 3 });
    await logger.close();

    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.trimEnd().split("\n");

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ type: "init", sessionId: "s1" });
    expect(JSON.parse(lines[1]!)).toEqual({ type: "message", content: "hello" });
    expect(JSON.parse(lines[2]!)).toEqual({ type: "done", turns: 3 });
  });

  it("close completes without error", async () => {
    const logPath = path.join(tmpDir, "empty.ndjson");
    const logger = new NdjsonLogger(logPath);

    await expect(logger.close()).resolves.toBeUndefined();
    expect(existsSync(logPath)).toBe(true);
  });
});
