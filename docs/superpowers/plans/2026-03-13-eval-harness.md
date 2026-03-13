# Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build eval test infrastructure for metamorphic testing of LLM output quality and golden benchmark comparison.

**Architecture:** Pure test infrastructure in `test/eval/` (no new `src/` code). Two metamorphic tests verify relational properties of pipeline output. Three helper modules handle metrics, config loading, and baseline storage. Two eval modes (quick/full) control cost. Dedicated vitest config and Makefile targets.

**Tech Stack:** Vitest, existing `generate()` and `runPipeline()` APIs, `computePairwiseJaccard()` from jaccard.ts.

**Spec:** `docs/superpowers/specs/2026-03-13-eval-harness-design.md`

---

## File Structure

```
Create: vitest.eval.config.ts
Create: test/fixtures/eval/config.yaml
Create: test/fixtures/eval/merge-config.yaml
Create: test/fixtures/eval/prompts/task.md
Create: eval/configs/full/README.md
Create: eval/baselines/.gitkeep
Create: test/eval/helpers/metrics.ts
Create: test/eval/helpers/runner.ts
Create: test/eval/helpers/baseline.ts
Create: test/eval/diversity.test.ts
Create: test/eval/coverage.test.ts
Modify: vitest.config.ts (add eval exclude)
Modify: dev.mk (add eval targets)
```

---

## Chunk 1: Infrastructure

### Task 1: Eval Fixtures

**Files:**
- Create: `test/fixtures/eval/config.yaml`
- Create: `test/fixtures/eval/merge-config.yaml`
- Create: `test/fixtures/eval/prompts/task.md`
- Create: `eval/configs/full/README.md`
- Create: `eval/baselines/.gitkeep`

- [ ] **Step 1: Create eval task prompt**

```markdown
<!-- test/fixtures/eval/prompts/task.md -->
Plan a REST API migration from v1 to v2 for a user management service.

The service currently handles user registration, authentication, and profile management.
The v2 API should support pagination, rate limiting, and improved error responses
while maintaining backward compatibility during a 3-month transition period.
```

- [ ] **Step 2: Create eval generate config**

```yaml
# test/fixtures/eval/config.yaml
model: haiku
max_turns: 20
timeout_ms: 300000
prompt: test/fixtures/eval/prompts/task.md    # relative to CWD (project root)

variants:
  - name: architecture
    guidance: "Focus on system architecture: components, data flow, integration points"
  - name: risk
    guidance: "Focus on risks: failure modes, rollback strategy, monitoring"
  - name: testing
    guidance: "Focus on testing: test strategy, coverage, validation gates"
```

- [ ] **Step 3: Create eval merge config**

```yaml
# test/fixtures/eval/merge-config.yaml
model: haiku
max_turns: 20
timeout_ms: 300000
strategy: simple
comparison_method: holistic

dimensions:
  - Architecture
  - Risk Management
  - Testing Strategy
```

- [ ] **Step 4: Create full mode placeholder**

```markdown
<!-- eval/configs/full/README.md -->
# Full Eval Configs

This directory holds opus-tier eval configs for serious before/after comparison.

Not populated initially — create `config.yaml` and `merge-config.yaml` here
when you decide on the right opus setup.

See `test/fixtures/eval/` for the quick-mode (haiku) equivalents.
```

- [ ] **Step 5: Commit**

- [ ] **Step 5a: Create baselines directory**

```bash
touch eval/baselines/.gitkeep
```

- [ ] **Step 5b: Commit**

```bash
git add test/fixtures/eval/ eval/configs/full/README.md eval/baselines/.gitkeep
git commit -m "test(eval): add eval fixtures, full mode placeholder, baselines dir"
```

---

### Task 2: Vitest Config & Makefile Targets

**Files:**
- Create: `vitest.eval.config.ts`
- Modify: `vitest.config.ts` (add `"test/eval/**"` to exclude)
- Modify: `dev.mk` (add 6 eval targets)

- [ ] **Step 1: Create vitest.eval.config.ts**

```typescript
// vitest.eval.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/eval/**/*.test.ts"],
    testTimeout: 600_000,
    globals: true,
  },
});
```

- [ ] **Step 2: Add eval exclude to vitest.config.ts**

In `vitest.config.ts`, change the `exclude` array from:

```typescript
exclude: ["test/e2e/**"],
```

to:

```typescript
exclude: ["test/e2e/**", "test/eval/**"],
```

This is REQUIRED — without it, `npx vitest run` picks up eval tests and fails (no API credentials, long timeouts).

- [ ] **Step 3: Add eval targets to dev.mk**

Add to `.PHONY` declaration and append these targets:

```makefile
.PHONY: check test lint build clean test-e2e eval eval-full eval-save eval-full-save eval-compare eval-full-compare

eval:  ## Quick eval (haiku, cheap fixtures)
	EVAL_MODE=quick devbox run -- npx vitest run --config vitest.eval.config.ts

eval-full:  ## Serious eval (opus, full configs)
	EVAL_MODE=full devbox run -- npx vitest run --config vitest.eval.config.ts

eval-save:  ## Quick eval + save baseline (NAME=...)
	EVAL_MODE=quick EVAL_SAVE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts

eval-full-save:  ## Full eval + save baseline (NAME=...)
	EVAL_MODE=full EVAL_SAVE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts

eval-compare:  ## Quick eval + compare against baseline (NAME=...)
	EVAL_MODE=quick EVAL_COMPARE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts

eval-full-compare:  ## Full eval + compare against baseline (NAME=...)
	EVAL_MODE=full EVAL_COMPARE_BASELINE=$(NAME) devbox run -- npx vitest run --config vitest.eval.config.ts
```

- [ ] **Step 4: Verify existing tests still pass**

Run: `make -f dev.mk test`
Expected: All existing tests pass (eval tests excluded)

- [ ] **Step 5: Commit**

```bash
git add vitest.eval.config.ts vitest.config.ts dev.mk
git commit -m "test(eval): add vitest eval config and Makefile targets"
```

---

### Task 3: Metrics Helper

**Files:**
- Create: `test/eval/helpers/metrics.ts`
- Test: `test/eval/helpers/metrics.test.ts`

- [ ] **Step 1: Write failing tests for metrics helpers**

```typescript
// test/eval/helpers/metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  extractAllHeadings,
  extractDimensionNames,
  checkDimensionCoverage,
  formatComparisonTable,
} from "../../eval/helpers/metrics.js";

describe("extractAllHeadings", () => {
  it("extracts headings at all levels", () => {
    const md = "# Top\n## Section\n### Sub\nText\n## Another";
    expect(extractAllHeadings(md)).toEqual([
      "top",
      "section",
      "sub",
      "another",
    ]);
  });

  it("returns empty array for no headings", () => {
    expect(extractAllHeadings("Just text.")).toEqual([]);
  });

  it("handles headings with markdown formatting", () => {
    const md = "## **Bold heading**\n## `Code heading`";
    expect(extractAllHeadings(md)).toEqual(["**bold heading**", "`code heading`"]);
  });
});

describe("extractDimensionNames", () => {
  it("extracts from plain string dimensions", () => {
    expect(extractDimensionNames(["Architecture", "Risk"])).toEqual([
      "Architecture",
      "Risk",
    ]);
  });

  it("extracts from weighted dimensions", () => {
    expect(
      extractDimensionNames([
        { name: "Architecture", weight: 3 },
        { name: "Risk", weight: 1 },
      ]),
    ).toEqual(["Architecture", "Risk"]);
  });

  it("handles mixed dimensions", () => {
    expect(
      extractDimensionNames([
        "Architecture",
        { name: "Risk", weight: 2 },
      ]),
    ).toEqual(["Architecture", "Risk"]);
  });
});

describe("checkDimensionCoverage", () => {
  it("finds dimensions present as headings", () => {
    const md = "## Architecture\nDetails\n## Risk Management\nDetails";
    const result = checkDimensionCoverage(md, [
      "Architecture",
      "Risk Management",
    ]);
    expect(result).toEqual({
      Architecture: true,
      "Risk Management": true,
    });
  });

  it("detects missing dimensions", () => {
    const md = "## Architecture\nDetails";
    const result = checkDimensionCoverage(md, [
      "Architecture",
      "Risk Management",
    ]);
    expect(result).toEqual({
      Architecture: true,
      "Risk Management": false,
    });
  });

  it("matches case-insensitively and as substrings", () => {
    const md = "## System Architecture Overview\n## risk management plan";
    const result = checkDimensionCoverage(md, [
      "Architecture",
      "Risk Management",
    ]);
    expect(result).toEqual({
      Architecture: true,
      "Risk Management": true,
    });
  });
});

describe("formatComparisonTable", () => {
  it("formats a comparison table", () => {
    const table = formatComparisonTable(
      {
        jaccardDistance: 0.42,
        dimensionCoverage: { Architecture: true, Risk: true },
        model: "opus",
      },
      {
        jaccardDistance: 0.38,
        dimensionCoverage: { Architecture: true, Risk: false },
        model: "haiku",
      },
    );
    expect(table).toContain("Jaccard distance");
    expect(table).toContain("0.42");
    expect(table).toContain("0.38");
    expect(table).toContain("Architecture");
    expect(table).toContain("REGRESSION");
  });

  it("warns on model mismatch", () => {
    const table = formatComparisonTable(
      {
        jaccardDistance: 0.4,
        dimensionCoverage: {},
        model: "opus",
      },
      {
        jaccardDistance: 0.4,
        dimensionCoverage: {},
        model: "haiku",
      },
    );
    expect(table).toContain("Warning");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/helpers/metrics.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement metrics helpers**

```typescript
// test/eval/helpers/metrics.ts
import type { MergeConfig } from "../../../src/types/config.js";

type Dimension = MergeConfig["dimensions"][number];

/**
 * Extract all markdown headings (#, ##, ###) — lowercased and trimmed.
 *
 * Differs from `extractHeadings()` in jaccard.ts which only extracts `##`.
 * Used for dimension coverage checking where headings at any level matter.
 */
export function extractAllHeadings(markdown: string): readonly string[] {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (/^#{1,3}\s/.test(trimmed)) {
      headings.push(trimmed.replace(/^#+\s*/, "").trim().toLowerCase());
    }
  }
  return headings;
}

/** Extract dimension names from the MergeConfig dimensions union type. */
export function extractDimensionNames(
  dimensions: readonly Dimension[],
): readonly string[] {
  return dimensions.map((d) => (typeof d === "string" ? d : d.name));
}

/**
 * Check which configured dimensions appear as headings in the merged plan.
 *
 * Matching is case-insensitive substring: a heading "System Architecture Overview"
 * matches dimension "Architecture".
 */
export function checkDimensionCoverage(
  mergedContent: string,
  dimensionNames: readonly string[],
): Record<string, boolean> {
  const headings = extractAllHeadings(mergedContent);
  const result: Record<string, boolean> = {};

  for (const dim of dimensionNames) {
    const dimLower = dim.toLowerCase();
    result[dim] = headings.some((h) => h.includes(dimLower));
  }

  return result;
}

export interface ComparisonMetrics {
  readonly jaccardDistance: number;
  readonly dimensionCoverage: Record<string, boolean>;
  readonly model: string;
}

/**
 * Format a markdown comparison table between baseline and current metrics.
 */
export function formatComparisonTable(
  baseline: ComparisonMetrics,
  current: ComparisonMetrics,
): string {
  const lines: string[] = [];

  if (baseline.model !== current.model) {
    lines.push(
      `Warning: baseline used ${baseline.model}, current run uses ${current.model}`,
    );
    lines.push("");
  }

  lines.push(
    "Metric                    Baseline    Current     Delta",
  );
  lines.push(
    "─────────────────────────────────────────────────────────",
  );

  // Jaccard distance
  const jDelta = current.jaccardDistance - baseline.jaccardDistance;
  const jArrow = jDelta > 0 ? "↑" : jDelta < 0 ? "↓" : "=";
  lines.push(
    padRow(
      "Jaccard distance",
      baseline.jaccardDistance.toFixed(2),
      current.jaccardDistance.toFixed(2),
      jDelta === 0 ? "=" : `${jArrow}${Math.abs(jDelta).toFixed(2)}`,
    ),
  );

  // Dimension coverage
  const allDims = new Set([
    ...Object.keys(baseline.dimensionCoverage),
    ...Object.keys(current.dimensionCoverage),
  ]);

  for (const dim of allDims) {
    const bFound = baseline.dimensionCoverage[dim] ?? false;
    const cFound = current.dimensionCoverage[dim] ?? false;
    const bStr = bFound ? "FOUND" : "MISSING";
    const cStr = cFound ? "FOUND" : "MISSING";
    let delta = "=";
    if (bFound && !cFound) delta = "↓REGRESSION";
    else if (!bFound && cFound) delta = "↑IMPROVED";
    lines.push(padRow(`Dimension: ${dim}`, bStr, cStr, delta));
  }

  return lines.join("\n");
}

function padRow(
  label: string,
  baseline: string,
  current: string,
  delta: string,
): string {
  return `${label.padEnd(26)}${baseline.padEnd(12)}${current.padEnd(12)}${delta}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/helpers/metrics.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add test/eval/helpers/metrics.ts test/eval/helpers/metrics.test.ts
git commit -m "test(eval): add metrics helpers (heading extraction, dimension coverage, comparison table)"
```

---

### Task 4: Runner Helper

**Files:**
- Create: `test/eval/helpers/runner.ts`
- Test: `test/eval/helpers/runner.test.ts`

- [ ] **Step 1: Write failing tests for runner helpers**

```typescript
// test/eval/helpers/runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getEvalMode,
  getConfigDir,
} from "../../eval/helpers/runner.js";

describe("getEvalMode", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("defaults to quick", () => {
    delete process.env["EVAL_MODE"];
    expect(getEvalMode()).toBe("quick");
  });

  it("reads EVAL_MODE env var", () => {
    process.env["EVAL_MODE"] = "full";
    expect(getEvalMode()).toBe("full");
  });

  it("throws on invalid mode", () => {
    process.env["EVAL_MODE"] = "invalid";
    expect(() => getEvalMode()).toThrow();
  });
});

describe("getConfigDir", () => {
  it("returns test/fixtures/eval for quick mode", () => {
    expect(getConfigDir("quick")).toBe("test/fixtures/eval");
  });

  it("returns eval/configs/full for full mode", () => {
    expect(getConfigDir("full")).toBe("eval/configs/full");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/helpers/runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement runner helpers**

```typescript
// test/eval/helpers/runner.ts
import * as fs from "node:fs/promises";
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
 * Create a temp output directory for eval runs.
 * Returns the path. Caller must clean up in afterAll.
 */
export function makeTempOutputDir(prefix: string): string {
  const tmpBase = process.env["TMPDIR"] ?? "/private/tmp/claude-501";
  return path.join(
    tmpBase,
    `eval-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/helpers/runner.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add test/eval/helpers/runner.ts test/eval/helpers/runner.test.ts
git commit -m "test(eval): add runner helpers (eval mode, config loading, auth check)"
```

---

## Chunk 2: Baseline Storage

### Task 5: Baseline Helper

**Files:**
- Create: `test/eval/helpers/baseline.ts`
- Test: `test/eval/helpers/baseline.test.ts`

- [ ] **Step 1: Write failing tests for baseline helpers**

```typescript
// test/eval/helpers/baseline.test.ts
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  saveBaseline,
  loadBaseline,
  compareBaseline,
} from "../../eval/helpers/baseline.js";
import type { Baseline } from "../../eval/helpers/baseline.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";
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
    // Save first
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/helpers/baseline.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement baseline helpers**

```typescript
// test/eval/helpers/baseline.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { JaccardPair } from "../../../src/evaluate/jaccard.js";
import {
  formatComparisonTable,
  type ComparisonMetrics,
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
  };

  const header = `Comparing against baseline "${baselineName}" (${baseline.timestamp.slice(0, 10)})`;
  const table = formatComparisonTable(baselineMetrics, currentMetrics);

  return `${header}\n\n${table}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/helpers/baseline.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add test/eval/helpers/baseline.ts test/eval/helpers/baseline.test.ts
git commit -m "test(eval): add baseline helpers (save, load, compare golden benchmarks)"
```

---

## Chunk 3: Metamorphic Tests

### Task 6: Diversity Metamorphic Test

**Files:**
- Create: `test/eval/diversity.test.ts`

**Depends on:** Tasks 1-5 (fixtures, runner, metrics, baseline)

- [ ] **Step 1: Implement diversity test**

```typescript
// test/eval/diversity.test.ts
import * as fs from "node:fs/promises";
import { describe, it, expect, afterAll } from "vitest";
import { generate } from "../../src/generate/index.js";
import { computePairwiseJaccard } from "../../src/evaluate/jaccard.js";
import type { GenerateConfig } from "../../src/types/config.js";
import {
  getEvalMode,
  loadGenerateConfig,
  loadMergeConfig,
  hasClaudeAuth,
  makeTempOutputDir,
} from "./helpers/runner.js";
import { checkDimensionCoverage, extractDimensionNames } from "./helpers/metrics.js";
import {
  saveBaseline,
  compareBaseline,
  getCommitSha,
  type Baseline,
} from "./helpers/baseline.js";

const outputDirDiverse = makeTempOutputDir("diversity-diverse");
const outputDirHomogeneous = makeTempOutputDir("diversity-homo");

afterAll(async () => {
  for (const dir of [outputDirDiverse, outputDirHomogeneous]) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

const suite = (await hasClaudeAuth()) ? describe : describe.skip;

suite("metamorphic: lens diversity", () => {
  it(
    "diverse lenses produce higher Jaccard distance than homogeneous lenses",
    async () => {
      const mode = getEvalMode();
      const genConfig = await loadGenerateConfig(mode);

      // Run A: diverse lenses (normal config — 3 different lenses)
      console.log(
        `[diversity] Run A: diverse lenses (${genConfig.variants.length} variants, model=${genConfig.model})`,
      );
      const diversePlanSet = await generate(genConfig, {
        outputDir: outputDirDiverse,
      });

      // Run B: homogeneous lenses (same guidance repeated with distinct names)
      const firstGuidance = genConfig.variants[0]?.guidance ?? "";
      const homogeneousVariants = genConfig.variants.map((v, i) => ({
        ...v,
        name: `${genConfig.variants[0]!.name}-${i + 1}`,
        guidance: firstGuidance,
      }));
      const homogeneousConfig: GenerateConfig = {
        ...genConfig,
        variants: homogeneousVariants,
      };

      console.log(
        `[diversity] Run B: homogeneous lenses (${homogeneousVariants.length} variants, same guidance)`,
      );
      const homoPlanSet = await generate(homogeneousConfig, {
        outputDir: outputDirHomogeneous,
      });

      // Compute Jaccard on both runs
      const diverseJaccard = computePairwiseJaccard(diversePlanSet.plans);
      const homoJaccard = computePairwiseJaccard(homoPlanSet.plans);

      const diverseDistance = 1 - diverseJaccard.mean;
      const homoDistance = 1 - homoJaccard.mean;

      console.log(`[diversity] Diverse Jaccard distance: ${diverseDistance.toFixed(4)}`);
      console.log(`[diversity] Homogeneous Jaccard distance: ${homoDistance.toFixed(4)}`);
      console.log(
        `[diversity] Delta: ${(diverseDistance - homoDistance).toFixed(4)}`,
      );

      // Metamorphic assertion: diverse > homogeneous
      expect(diverseDistance).toBeGreaterThan(homoDistance);

      // Baseline save/compare (opt-in via env vars)
      const saveBaselineName = process.env["EVAL_SAVE_BASELINE"];
      const compareBaselineName = process.env["EVAL_COMPARE_BASELINE"];

      if (saveBaselineName || compareBaselineName) {
        const mergeConfig = await loadMergeConfig(mode);
        const dimensionNames = extractDimensionNames(mergeConfig.dimensions);

        // We don't have a merged plan in this test, so dimension coverage is empty
        const dimCoverage: Record<string, boolean> = {};
        for (const dim of dimensionNames) {
          dimCoverage[dim] = false;
        }

        if (saveBaselineName) {
          const baseline: Baseline = {
            name: saveBaselineName,
            mode,
            timestamp: new Date().toISOString(),
            commitSha: getCommitSha(),
            model: genConfig.model,
            jaccardMean: diverseJaccard.mean,
            jaccardDistance: diverseDistance,
            jaccardPairs: diverseJaccard.pairs,
            dimensionCoverage: dimCoverage,
            configPaths: {
              generate: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/config.yaml`,
              merge: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/merge-config.yaml`,
            },
          };

          const planContents = new Map(
            diversePlanSet.plans.map((p) => [p.variant.name, p.content]),
          );

          const dir = await saveBaseline(baseline, planContents, "");
          console.log(`[diversity] Baseline saved to ${dir}`);
        }

        if (compareBaselineName) {
          const table = await compareBaseline(compareBaselineName, {
            jaccardDistance: diverseDistance,
            dimensionCoverage: dimCoverage,
            model: genConfig.model,
          });
          console.log(`\n${table}`);
        }
      }
    },
    300_000,
  );
});
```

- [ ] **Step 2: Verify test structure compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add test/eval/diversity.test.ts
git commit -m "test(eval): add diversity metamorphic test (diverse lenses > homogeneous)"
```

---

### Task 7: Coverage Metamorphic Test

**Files:**
- Create: `test/eval/coverage.test.ts`

**Depends on:** Tasks 1-5 (fixtures, runner, metrics, baseline)

- [ ] **Step 1: Implement coverage test**

```typescript
// test/eval/coverage.test.ts
import * as fs from "node:fs/promises";
import { describe, it, expect, afterAll } from "vitest";
import { runPipeline } from "../../src/pipeline/run.js";
import { computePairwiseJaccard } from "../../src/evaluate/jaccard.js";
import {
  getEvalMode,
  loadGenerateConfig,
  loadMergeConfig,
  hasClaudeAuth,
  makeTempOutputDir,
} from "./helpers/runner.js";
import {
  extractDimensionNames,
  checkDimensionCoverage,
} from "./helpers/metrics.js";
import {
  saveBaseline,
  compareBaseline,
  getCommitSha,
  type Baseline,
} from "./helpers/baseline.js";

const outputDir = makeTempOutputDir("coverage");

afterAll(async () => {
  try {
    await fs.rm(outputDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

const suite = (await hasClaudeAuth()) ? describe : describe.skip;

suite("metamorphic: dimension coverage", () => {
  it(
    "merged plan covers all configured dimensions",
    async () => {
      const mode = getEvalMode();
      const genConfig = await loadGenerateConfig(mode);
      const mergeConfig = await loadMergeConfig(mode);

      console.log(
        `[coverage] Running full pipeline (model=${genConfig.model}, ` +
          `${genConfig.variants.length} variants, strategy=${mergeConfig.strategy})`,
      );

      const result = await runPipeline(genConfig, mergeConfig, {
        generateOptions: { outputDir },
      });

      const mergedContent = result.mergeResult.content;
      const dimensionNames = extractDimensionNames(mergeConfig.dimensions);
      const coverage = checkDimensionCoverage(mergedContent, dimensionNames);

      // Log results
      console.log("[coverage] Dimension coverage:");
      for (const [dim, found] of Object.entries(coverage)) {
        console.log(`  ${found ? "FOUND" : "MISSING"}: ${dim}`);
      }

      // Assert all dimensions covered
      for (const dim of dimensionNames) {
        expect(
          coverage[dim],
          `Merged plan missing dimension: ${dim}`,
        ).toBe(true);
      }

      // Compute Jaccard for baseline storage
      const jaccard = computePairwiseJaccard(result.planSet.plans);
      const jaccardDistance = 1 - jaccard.mean;
      console.log(`[coverage] Jaccard distance: ${jaccardDistance.toFixed(4)}`);

      // Baseline save/compare (opt-in via env vars)
      const saveBaselineName = process.env["EVAL_SAVE_BASELINE"];
      const compareBaselineName = process.env["EVAL_COMPARE_BASELINE"];

      if (saveBaselineName) {
        const baseline: Baseline = {
          name: saveBaselineName,
          mode,
          timestamp: new Date().toISOString(),
          commitSha: getCommitSha(),
          model: genConfig.model,
          jaccardMean: jaccard.mean,
          jaccardDistance,
          jaccardPairs: jaccard.pairs,
          dimensionCoverage: coverage,
          configPaths: {
            generate: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/config.yaml`,
            merge: `${mode === "quick" ? "test/fixtures/eval" : "eval/configs/full"}/merge-config.yaml`,
          },
        };

        const planContents = new Map(
          result.planSet.plans.map((p) => [p.variant.name, p.content]),
        );

        const dir = await saveBaseline(
          baseline,
          planContents,
          mergedContent,
        );
        console.log(`[coverage] Baseline saved to ${dir}`);
      }

      if (compareBaselineName) {
        const table = await compareBaseline(compareBaselineName, {
          jaccardDistance,
          dimensionCoverage: coverage,
          model: genConfig.model,
        });
        console.log(`\n${table}`);
      }
    },
    600_000,
  );
});
```

- [ ] **Step 2: Verify test structure compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add test/eval/coverage.test.ts
git commit -m "test(eval): add coverage metamorphic test (merged plan covers all dimensions)"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run `make -f dev.mk check` to verify no regressions**

Run: `make -f dev.mk check`
Expected: All existing tests PASS. Build and lint clean.

- [ ] **Step 2: Verify eval tests are excluded from default run**

Run: `npx vitest run --reporter=verbose 2>&1 | head -50`
Expected: No `test/eval/` files in the output.

- [ ] **Step 3: Verify eval config loads correctly**

Run: `npx tsc --noEmit`
Expected: No type errors in eval test files.

- [ ] **Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "test(eval): eval harness implementation complete"
```
