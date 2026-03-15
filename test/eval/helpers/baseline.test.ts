import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  saveBaseline,
  loadBaseline,
  compareBaseline,
} from "./baseline.js";
import type { Baseline } from "./baseline.js";

const TMPDIR = process.env["TMPDIR"] ?? os.tmpdir();
const testBaseDir = path.join(TMPDIR, `baseline-test-${Date.now()}`);

afterEach(async () => {
  try {
    await fs.rm(testBaseDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("saveBaseline", () => {
  it("writes baseline.json, plans, and merged.md", async () => {
    const baseline: Baseline = {
      name: "test-save",
      mode: "quick",
      timestamp: "2026-03-13T00:00:00.000Z",
      commitSha: "abc1234",
      model: "haiku",
      jaccardMean: 0.5,
      jaccardDistance: 0.5,
      jaccardPairs: [{ a: "arch", b: "risk", similarity: 0.5 }],
      dimensionCoverage: { Architecture: true, Risk: false },
      configPaths: {
        generate: "test/fixtures/eval/config.yaml",
        merge: "test/fixtures/eval/merge-config.yaml",
      },
    };

    const plans = new Map([
      ["architecture", "# Architecture Plan\nContent"],
      ["risk", "# Risk Plan\nContent"],
    ]);

    await saveBaseline(baseline, plans, "# Merged\nContent", testBaseDir);

    // Verify files exist
    const jsonContent = await fs.readFile(
      path.join(testBaseDir, "test-save", "baseline.json"),
      "utf-8",
    );
    const parsed = JSON.parse(jsonContent);
    expect(parsed.name).toBe("test-save");
    expect(parsed.jaccardMean).toBe(0.5);

    const planContent = await fs.readFile(
      path.join(testBaseDir, "test-save", "plans", "plan-architecture.md"),
      "utf-8",
    );
    expect(planContent).toContain("Architecture Plan");

    const mergedContent = await fs.readFile(
      path.join(testBaseDir, "test-save", "merged.md"),
      "utf-8",
    );
    expect(mergedContent).toContain("# Merged");
  });
});

describe("loadBaseline", () => {
  it("loads a saved baseline", async () => {
    const baseline: Baseline = {
      name: "test-load",
      mode: "quick",
      timestamp: "2026-03-13T00:00:00.000Z",
      commitSha: "abc1234",
      model: "haiku",
      jaccardMean: 0.6,
      jaccardDistance: 0.4,
      jaccardPairs: [],
      dimensionCoverage: { Architecture: true },
      configPaths: {
        generate: "config.yaml",
        merge: "merge-config.yaml",
      },
    };

    await saveBaseline(baseline, new Map(), "", testBaseDir);

    const loaded = await loadBaseline("test-load", testBaseDir);
    expect(loaded.name).toBe("test-load");
    expect(loaded.jaccardDistance).toBe(0.4);
  });

  it("throws on missing baseline", async () => {
    await expect(loadBaseline("nonexistent", testBaseDir)).rejects.toThrow();
  });
});

describe("compareBaseline", () => {
  it("returns formatted comparison table", async () => {
    const baseline: Baseline = {
      name: "test-compare",
      mode: "quick",
      timestamp: "2026-03-13T00:00:00.000Z",
      commitSha: "abc1234",
      model: "haiku",
      jaccardMean: 0.58,
      jaccardDistance: 0.42,
      jaccardPairs: [],
      dimensionCoverage: { Architecture: true, Risk: true },
      configPaths: { generate: "g.yaml", merge: "m.yaml" },
    };

    await saveBaseline(baseline, new Map(), "", testBaseDir);

    const table = await compareBaseline(
      "test-compare",
      {
        jaccardDistance: 0.38,
        dimensionCoverage: { Architecture: true, Risk: false },
        model: "haiku",
      },
      testBaseDir,
    );

    expect(table).toContain("0.42");
    expect(table).toContain("0.38");
    expect(table).toContain("REGRESSION");
  });
});
