# Regression Testing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add snapshot + property-based regression tests that catch any change to prompt output, config resolution, or end-to-end pipeline behavior.

**Architecture:** Dedicated `test/regression/` suite with 4 test files. Shared mock factories in `test/helpers/factories.ts` (extracted from existing tests). Fast-check arbitraries in `test/helpers/arbitraries.ts`. Vitest `toMatchSnapshot()` for deterministic output, `fast-check` for structural invariants.

**Tech Stack:** Vitest 3.x snapshots, fast-check ^3.0.0

**Spec:** `docs/superpowers/specs/2026-03-13-regression-testing-design.md`

---

## Task 1: Install fast-check and create shared test factories

**Files:**
- Create: `test/helpers/factories.ts`
- Modify: `package.json` (devDependency)
- Modify: `test/merge/merge-prompt-builder.test.ts` — remove local factories, import from helpers
- Modify: `test/evaluate/prompt-builder.test.ts` — remove local factories, rewrite positional calls
- Modify: `test/evaluate/evaluate.test.ts` — remove local factories, rewrite positional calls

**Why this task exists:** The 3 test files above each have their own `makePlan`/`makeConfig` factories with incompatible signatures. Extract to one shared module before regression tests can use them.

Note: `test/verify/verify.test.ts` and `test/verify/pre-mortem.test.ts` are listed in the spec as migration candidates but contain no `makePlan`/`makeConfig` local factories — they use inline fixtures only. No changes required for those files.

- [ ] **Step 1: Install fast-check**

```bash
devbox run -- npm install --save-dev fast-check
```

- [ ] **Step 2: Run existing tests to confirm baseline**

```bash
make -f dev.mk check
```

Expected: 312 tests pass.

- [ ] **Step 3: Create `test/helpers/factories.ts`**

```typescript
import type { Plan, PlanSet, Variant } from "../../src/types/plan.js";
import type { MergeConfig } from "../../src/types/config.js";
import { MergeConfigSchema } from "../../src/types/config.js";
import type { EvalResult } from "../../src/types/evaluation.js";

/** Create a Plan with sensible defaults. Override any field via Partial<Plan>. */
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    variant: { name: "test-variant", guidance: "test guidance" },
    content: "# Test Plan\nSome plan content here.",
    metadata: {
      model: "opus",
      turns: 10,
      durationMs: 5000,
      durationApiMs: 4000,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 2000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUsd: 0.05,
      },
      costUsd: 0.05,
      stopReason: "end_turn",
      sessionId: "sess-001",
    },
    ...overrides,
  };
}

/** Wrap plans into a PlanSet with fixed timestamp and runDir. */
export function makePlanSet(plans: Plan[]): PlanSet {
  return {
    plans,
    timestamp: "2026-03-10T12:00:00Z",
    runDir: "/tmp/test-run",
  };
}

/** Create a MergeConfig via schema parse (gets all defaults). */
export function makeDefaultMergeConfig(
  overrides: Partial<MergeConfig> = {},
): MergeConfig {
  return MergeConfigSchema.parse(overrides);
}

/** Binary scoring eval result fixture. */
export function makeBinaryEvalResult(): EvalResult {
  return {
    scores: [
      { dimension: "Approach", pass: true, critique: "Solid approach" },
      { dimension: "Risk", pass: false, critique: "Missing risk analysis" },
    ],
    summary: "Overall: plan is strong on approach but weak on risk.",
    planScores: [],
    gaps: [],
    convergence: 0,
  };
}

/** Likert scoring eval result fixture. */
export function makeLikertEvalResult(): EvalResult {
  return {
    scores: [
      { dimension: "Approach", score: 4, critique: "Good approach" },
      { dimension: "Risk", score: 2, critique: "Inadequate risk coverage" },
    ],
    summary: "Overall: moderate quality plan.",
    planScores: [],
    gaps: [],
    convergence: 0,
  };
}
```

Note: The `EvalResult` type requires `planScores`, `gaps`, and `convergence` fields (see `src/types/evaluation.ts:22-29`). The existing `makeBinaryEvalResult` in `merge-prompt-builder.test.ts` omitted these — the `formatEvalSummary` function only reads `scores` and `summary`, so tests passed. Adding them here for type correctness.

- [ ] **Step 4: Migrate `test/merge/merge-prompt-builder.test.ts`**

Remove lines 18-74 (the local `makePlan`, `makePlanSet`, `makeDefaultMergeConfig`, `makeBinaryEvalResult`, `makeLikertEvalResult` factories). Add import:

```typescript
import {
  makePlan,
  makePlanSet,
  makeDefaultMergeConfig,
  makeBinaryEvalResult,
  makeLikertEvalResult,
} from "../helpers/factories.js";
```

Remove `import type { MergeConfig } from "../../src/types/config.js";` and `import { MergeConfigSchema } from "../../src/types/config.js";` if they become unused. Keep `import type { Plan, PlanSet } from "../../src/types/plan.js";` only if still referenced directly. Keep `import type { EvalResult } from "../../src/types/evaluation.js";` if still used.

- [ ] **Step 5: Migrate `test/evaluate/prompt-builder.test.ts`**

Remove lines 9-47 (local `makePlan` and `makeConfig`). Add import:

```typescript
import { makePlan, makeDefaultMergeConfig } from "../helpers/factories.js";
```

Rewrite all `makePlan("name", "content")` calls to `makePlan({ variant: { name: "name", guidance: "" }, content: "content" })`:

```
Line 54: makePlan("alpha", "Alpha plan content")
  → makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan content" })
Line 55: makePlan("beta", "Beta plan content")
  → makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan content" })
Line 84: makePlan("solo", "Solo plan")
  → makePlan({ variant: { name: "solo", guidance: "" }, content: "Solo plan" })
Line 121-122: makePlan("alpha", "Alpha content"), makePlan("beta", "Beta content")
  → same pattern
Line 137-138: same
Line 161-162: same
```

Rewrite all `makeConfig(...)` calls to `makeDefaultMergeConfig(...)`:

```
Line 56: makeConfig()  → makeDefaultMergeConfig()
Line 87: makeConfig({ dimensions: [...] })  → makeDefaultMergeConfig({ dimensions: [...] })
Line 95-100: makeConfig({ dimensions: [...] })  → makeDefaultMergeConfig({ dimensions: [...] })
Line 107: makeConfig({ dimensions: [...] })  → makeDefaultMergeConfig({ dimensions: [...] })
Line 123: makeConfig({ evalScoring: "binary" })  → makeDefaultMergeConfig({ evalScoring: "binary" })
Line 137: makeConfig({ evalScoring: "likert" })  → makeDefaultMergeConfig({ evalScoring: "likert" })
Line 160: makeConfig()  → makeDefaultMergeConfig()
```

- [ ] **Step 6: Migrate `test/evaluate/evaluate.test.ts`**

Remove lines 17-55 (local `makePlan` and `makeConfig`). Add import:

```typescript
import { makePlan, makeDefaultMergeConfig } from "../helpers/factories.js";
```

Rewrite `makePlan("name", "content")` calls (same pattern as step 5):

```
Line 100-101: makePlan("alpha", "Alpha plan content here"), makePlan("beta", "Beta plan content here")
Line 182-184: makePlan("v1", "Version 1 plan"), makePlan("v2", "..."), makePlan("v3", "...")
```

Rewrite `makeConfig(...)` → `makeDefaultMergeConfig(...)`:

```
Line 102: makeConfig({ evalScoring: "binary", evalConsensus: "majority" })
  → makeDefaultMergeConfig({ evalScoring: "binary", evalConsensus: "majority" })
Line 185: makeConfig({ evalScoring: "likert", evalConsensus: "median" })
  → makeDefaultMergeConfig({ evalScoring: "likert", evalConsensus: "median" })
```

- [ ] **Step 7: Run all tests to verify migration**

```bash
make -f dev.mk check
```

Expected: still 312 tests pass (same count — no tests added or removed).

- [ ] **Step 8: Commit**

```bash
git add test/helpers/factories.ts test/merge/merge-prompt-builder.test.ts \
  test/evaluate/prompt-builder.test.ts test/evaluate/evaluate.test.ts package.json package-lock.json
git commit -m "refactor(test): extract shared factories, install fast-check"
```

---

## Task 2: Create fast-check arbitraries

**Files:**
- Create: `test/helpers/arbitraries.ts`

- [ ] **Step 1: Create `test/helpers/arbitraries.ts`**

```typescript
import fc from "fast-check";
import type { Variant } from "../../src/types/plan.js";
import type { Plan, PlanSet } from "../../src/types/plan.js";
import type { GenerateConfig } from "../../src/types/config.js";
import type { MergeConfig } from "../../src/types/config.js";
import { GenerateConfigSchema, MergeConfigSchema } from "../../src/types/config.js";
import { makePlan, makePlanSet } from "./factories.js";

/** Arbitrary Variant with random name, guidance, and optional model. */
export function arbVariant(): fc.Arbitrary<Variant> {
  return fc.record({
    name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
    guidance: fc.string({ minLength: 0, maxLength: 200 }),
    model: fc.option(fc.constantFrom("opus", "sonnet", "haiku"), { nil: undefined }),
  });
}

/** Arbitrary Plan using makePlan for metadata stub. */
export function arbPlan(): fc.Arbitrary<Plan> {
  return fc.record({
    variant: arbVariant(),
    content: fc.string({ minLength: 10, maxLength: 500 }),
  }).map(({ variant, content }) => makePlan({ variant, content }));
}

/** Arbitrary PlanSet with 2-5 plans. */
export function arbPlanSet(): fc.Arbitrary<PlanSet> {
  return fc.array(arbPlan(), { minLength: 2, maxLength: 5 })
    .map((plans) => makePlanSet(plans));
}

/** Arbitrary GenerateConfig via schema parse. */
export function arbGenerateConfig(): fc.Arbitrary<GenerateConfig> {
  return fc.record({
    model: fc.constantFrom("opus", "sonnet", "haiku"),
    maxTurns: fc.integer({ min: 1, max: 200 }),
    timeoutMs: fc.integer({ min: 1000, max: 7_200_000 }),
    minOutputBytes: fc.integer({ min: 100, max: 50_000 }),
    variants: fc.array(
      fc.record({
        name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
        guidance: fc.string({ minLength: 0, maxLength: 200 }),
      }),
      { minLength: 1, maxLength: 6 },
    ),
  }).map((raw) => GenerateConfigSchema.parse(raw));
}

/** Arbitrary MergeConfig via schema parse. Randomizes comparisonMethod to exercise both paths. */
export function arbMergeConfig(): fc.Arbitrary<MergeConfig> {
  const arbDimension = fc.oneof(
    fc.stringMatching(/^[A-Z][a-z ]{2,30}$/),
    fc.record({
      name: fc.stringMatching(/^[A-Z][a-z ]{2,30}$/),
      weight: fc.integer({ min: 1, max: 10 }),
    }),
  );

  return fc.record({
    model: fc.constantFrom("opus", "sonnet", "haiku"),
    comparisonMethod: fc.constantFrom("holistic" as const, "pairwise" as const),
    dimensions: fc.array(arbDimension, { minLength: 1, maxLength: 6 }),
    constitution: fc.array(
      fc.string({ minLength: 5, maxLength: 100 }),
      { minLength: 1, maxLength: 5 },
    ),
    evalScoring: fc.constantFrom("binary" as const, "likert" as const),
  }).map((raw) => MergeConfigSchema.parse(raw));
}
```

- [ ] **Step 2: Verify it compiles**

```bash
devbox run -- npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add test/helpers/arbitraries.ts
git commit -m "test: add fast-check arbitraries for property testing"
```

---

## Task 3: Prompt snapshot tests

**Files:**
- Create: `test/regression/prompt-snapshots.test.ts`

- [ ] **Step 1: Create `test/regression/prompt-snapshots.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { buildPrompts } from "../../src/generate/prompt-builder.js";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import {
  buildHolisticMergePrompt,
  buildPairwiseMergePrompt,
} from "../../src/merge/prompt-builder.js";
import { buildVerifyPrompt } from "../../src/verify/prompt-builder.js";
import { buildPreMortemPrompt } from "../../src/verify/pre-mortem.js";
import { GenerateConfigSchema } from "../../src/types/config.js";
import {
  makePlan,
  makePlanSet,
  makeDefaultMergeConfig,
  makeBinaryEvalResult,
  makeLikertEvalResult,
} from "../helpers/factories.js";

const RUN_DIR = "/tmp/test-run";
const MERGE_PATH = "/tmp/test-run/merged.md";
const defaultGenConfig = GenerateConfigSchema.parse({});

// -----------------------------------------------------------------------
// buildPrompts (generate)
// -----------------------------------------------------------------------

describe("buildPrompts snapshots", () => {
  it("minimal: base prompt only, no context, no guidance", () => {
    const result = buildPrompts(
      "Create a deployment plan.",
      undefined,
      [{ name: "baseline", guidance: "" }],
      new Map(),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });

  it("full: base prompt + context + variants with guidance", () => {
    const result = buildPrompts(
      "Create a deployment plan.",
      "Project uses Node.js 22 and PostgreSQL 16.",
      [
        { name: "baseline", guidance: "" },
        { name: "depth", guidance: "Go deep on implementation specifics." },
        { name: "breadth", guidance: "Take a wide view." },
      ],
      new Map(),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });

  it("per-variant promptFile content overrides base prompt", () => {
    const result = buildPrompts(
      "Base prompt ignored for overridden variant.",
      undefined,
      [
        { name: "security", guidance: "Focus on threats." },
        { name: "perf", guidance: "" },
      ],
      new Map([
        ["security", "Analyze from a security perspective."],
        ["perf", "Analyze performance bottlenecks."],
      ]),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });

  it("mixed: 1 from map, 2 from base, with context", () => {
    const result = buildPrompts(
      "Base deployment plan prompt.",
      "Shared project context here.",
      [
        { name: "alpha", guidance: "Alpha guidance." },
        { name: "beta", guidance: "" },
        { name: "gamma", guidance: "Gamma guidance." },
      ],
      new Map([["beta", "Custom beta prompt content."]]),
      defaultGenConfig,
      RUN_DIR,
    );
    expect(result.map((r) => r.fullPrompt)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildEvalPrompt (evaluate)
// -----------------------------------------------------------------------

describe("buildEvalPrompt snapshots", () => {
  it("binary scoring, string dimensions, 2 plans", () => {
    const plans = [
      makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan content." }),
      makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan content." }),
    ];
    const config = makeDefaultMergeConfig({ evalScoring: "binary" });
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });

  it("likert scoring, weighted dimensions, 3 plans", () => {
    const plans = [
      makePlan({ variant: { name: "a", guidance: "" }, content: "Plan A." }),
      makePlan({ variant: { name: "b", guidance: "" }, content: "Plan B." }),
      makePlan({ variant: { name: "c", guidance: "" }, content: "Plan C." }),
    ];
    const config = makeDefaultMergeConfig({
      evalScoring: "likert",
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
        { name: "Readability", weight: 1 },
      ],
    });
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });

  it("mixed dimensions, single plan", () => {
    const plans = [
      makePlan({ variant: { name: "solo", guidance: "" }, content: "Solo plan." }),
    ];
    const config = makeDefaultMergeConfig({
      dimensions: ["Approach", { name: "Security", weight: 3 }],
    });
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildHolisticMergePrompt (merge)
// -----------------------------------------------------------------------

describe("buildHolisticMergePrompt snapshots", () => {
  const planA = makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha content." });
  const planB = makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta content." });
  const planC = makePlan({ variant: { name: "gamma", guidance: "" }, content: "Gamma content." });

  it("default config, 2 plans, no eval", () => {
    const plans = makePlanSet([planA, planB]);
    const config = makeDefaultMergeConfig();
    expect(buildHolisticMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });

  it("weighted dims, 3 plans, binary eval", () => {
    const plans = makePlanSet([planA, planB, planC]);
    const config = makeDefaultMergeConfig({
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
        "Readability",
      ],
    });
    expect(
      buildHolisticMergePrompt(plans, config, MERGE_PATH, makeBinaryEvalResult()),
    ).toMatchSnapshot();
  });

  it("default config, 2 plans, likert eval", () => {
    const plans = makePlanSet([planA, planB]);
    const config = makeDefaultMergeConfig();
    expect(
      buildHolisticMergePrompt(plans, config, MERGE_PATH, makeLikertEvalResult()),
    ).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildPairwiseMergePrompt (merge)
// -----------------------------------------------------------------------

describe("buildPairwiseMergePrompt snapshots", () => {
  it("3 plans, unweighted", () => {
    const plans = makePlanSet([
      makePlan({ variant: { name: "a", guidance: "" }, content: "A." }),
      makePlan({ variant: { name: "b", guidance: "" }, content: "B." }),
      makePlan({ variant: { name: "c", guidance: "" }, content: "C." }),
    ]);
    const config = makeDefaultMergeConfig({ comparisonMethod: "pairwise" });
    expect(buildPairwiseMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });

  it("4 plans, weighted, with eval", () => {
    const plans = makePlanSet([
      makePlan({ variant: { name: "a", guidance: "" }, content: "A." }),
      makePlan({ variant: { name: "b", guidance: "" }, content: "B." }),
      makePlan({ variant: { name: "c", guidance: "" }, content: "C." }),
      makePlan({ variant: { name: "d", guidance: "" }, content: "D." }),
    ]);
    const config = makeDefaultMergeConfig({
      comparisonMethod: "pairwise",
      dimensions: [
        { name: "Security", weight: 3 },
        { name: "Performance", weight: 2 },
      ],
    });
    expect(
      buildPairwiseMergePrompt(plans, config, MERGE_PATH, makeBinaryEvalResult()),
    ).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildVerifyPrompt (verify)
// -----------------------------------------------------------------------

describe("buildVerifyPrompt snapshots", () => {
  it("merged plan + 2 source plans", () => {
    expect(
      buildVerifyPrompt("# Merged Plan\nContent here.", [
        { name: "plan-A", content: "Source A content." },
        { name: "plan-B", content: "Source B content." },
      ]),
    ).toMatchSnapshot();
  });

  it("merged plan + 4 source plans", () => {
    expect(
      buildVerifyPrompt("# Merged Plan\nContent.", [
        { name: "a", content: "A." },
        { name: "b", content: "B." },
        { name: "c", content: "C." },
        { name: "d", content: "D." },
      ]),
    ).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// buildPreMortemPrompt (pre-mortem)
// -----------------------------------------------------------------------

describe("buildPreMortemPrompt snapshots", () => {
  it("representative merged plan", () => {
    expect(
      buildPreMortemPrompt("# Implementation Plan\n\n## Phase 1\nDeploy services.\n\n## Phase 2\nMonitor and iterate."),
    ).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to generate initial snapshots**

```bash
devbox run -- npx vitest run test/regression/prompt-snapshots.test.ts
```

Expected: 15 tests pass, `test/regression/__snapshots__/prompt-snapshots.test.ts.snap` created.

- [ ] **Step 3: Verify snapshot file was created and has content**

```bash
wc -l test/regression/__snapshots__/prompt-snapshots.test.ts.snap
```

Expected: several hundred lines of snapshot content.

- [ ] **Step 4: Commit**

```bash
git add test/regression/prompt-snapshots.test.ts test/regression/__snapshots__/
git commit -m "test: add prompt snapshot regression tests (15 snapshots)"
```

---

## Task 4: Config resolution snapshot tests

**Files:**
- Create: `test/regression/config-snapshots.test.ts`

- [ ] **Step 1: Create `test/regression/config-snapshots.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../../src/pipeline/config-resolver.js";

const fixtureDir = path.dirname(
  fileURLToPath(new URL("../fixtures", import.meta.url)),
);
const fixturesPath = path.join(fixtureDir, "fixtures");

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
```

- [ ] **Step 2: Run to generate snapshots**

```bash
devbox run -- npx vitest run test/regression/config-snapshots.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/regression/config-snapshots.test.ts test/regression/__snapshots__/
git commit -m "test: add config resolution snapshot tests (7 snapshots)"
```

---

## Task 5: Integration snapshot tests

**Files:**
- Create: `test/regression/integration-snapshots.test.ts`

**Key detail:** `materializeConfig` reads files relative to CWD. After `resolveGenerateConfig`, override `config.prompt` and variant `promptFile` paths to absolute fixture paths.

- [ ] **Step 1: Create `test/regression/integration-snapshots.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  resolveGenerateConfig,
  resolveMergeConfig,
} from "../../src/pipeline/config-resolver.js";
import { materializeConfig } from "../../src/generate/index.js";
import { buildPrompts } from "../../src/generate/prompt-builder.js";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import {
  buildHolisticMergePrompt,
  buildPairwiseMergePrompt,
} from "../../src/merge/prompt-builder.js";
import type { GenerateConfig } from "../../src/types/config.js";
import { makePlan, makePlanSet } from "../helpers/factories.js";

const fixtureDir = path.dirname(
  fileURLToPath(new URL("../fixtures", import.meta.url)),
);
const fixturesPath = path.join(fixtureDir, "fixtures");
const RUN_DIR = "/tmp/test-run";
const MERGE_PATH = "/tmp/test-run/merged.md";

/** Resolve fixture-relative paths in config to absolute paths. */
function absolutifyPromptPaths(config: GenerateConfig): GenerateConfig {
  return {
    ...config,
    ...(config.prompt ? { prompt: path.join(fixturesPath, config.prompt) } : {}),
    ...(config.context ? { context: path.join(fixturesPath, config.context) } : {}),
    variants: config.variants.map((v) => ({
      ...v,
      ...(v.promptFile ? { promptFile: path.join(fixturesPath, v.promptFile) } : {}),
    })),
  };
}

// -----------------------------------------------------------------------
// Generate pipeline
// -----------------------------------------------------------------------

describe("generate pipeline integration snapshots", () => {
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

  it("config.yaml -> resolve -> materialize -> buildPrompts", async () => {
    const raw = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config.yaml"),
    });
    const config = absolutifyPromptPaths(raw);
    const mat = await materializeConfig(config);
    const prompts = buildPrompts(
      mat.basePrompt,
      mat.context,
      config.variants,
      mat.variantPromptContents,
      config,
      RUN_DIR,
    );
    expect(prompts.map((p) => p.fullPrompt)).toMatchSnapshot();
  });

  it("config-with-prompt-file.yaml -> per-variant prompt_file flows through", async () => {
    const raw = await resolveGenerateConfig({
      cliConfigPath: path.join(fixturesPath, "config-with-prompt-file.yaml"),
    });
    const config = absolutifyPromptPaths(raw);
    const mat = await materializeConfig(config);
    const prompts = buildPrompts(
      mat.basePrompt,
      mat.context,
      config.variants,
      mat.variantPromptContents,
      config,
      RUN_DIR,
    );
    expect(prompts.map((p) => p.fullPrompt)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// Evaluate pipeline
// -----------------------------------------------------------------------

describe("evaluate pipeline integration snapshots", () => {
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

  it("merge-config.yaml -> resolve -> buildEvalPrompt", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
    });
    const plans = [
      makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan." }),
      makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan." }),
    ];
    expect(buildEvalPrompt(plans, config)).toMatchSnapshot();
  });
});

// -----------------------------------------------------------------------
// Merge pipeline
// -----------------------------------------------------------------------

describe("merge pipeline integration snapshots", () => {
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

  const plans = makePlanSet([
    makePlan({ variant: { name: "alpha", guidance: "" }, content: "Alpha plan." }),
    makePlan({ variant: { name: "beta", guidance: "" }, content: "Beta plan." }),
  ]);

  it("merge-config.yaml holistic -> buildHolisticMergePrompt", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
    });
    expect(buildHolisticMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });

  it("merge-config.yaml pairwise override -> buildPairwiseMergePrompt", async () => {
    const config = await resolveMergeConfig({
      cliConfigPath: path.join(fixturesPath, "merge-config.yaml"),
      cliOverrides: { comparisonMethod: "pairwise" },
    });
    expect(buildPairwiseMergePrompt(plans, config, MERGE_PATH)).toMatchSnapshot();
  });
});

// Note: buildVerifyPrompt takes no config parameter, so there is no
// config -> prompt integration path. Verify prompt snapshots are covered
// in Task 3 (prompt-snapshots.test.ts) only.
```

- [ ] **Step 2: Run to generate snapshots**

```bash
devbox run -- npx vitest run test/regression/integration-snapshots.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/regression/integration-snapshots.test.ts test/regression/__snapshots__/
git commit -m "test: add integration snapshot tests (5 end-to-end snapshots)"
```

---

## Task 6: Structural invariant tests with fast-check

**Files:**
- Create: `test/regression/structural-invariants.test.ts`

- [ ] **Step 1: Create `test/regression/structural-invariants.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildPrompts } from "../../src/generate/prompt-builder.js";
import { buildEvalPrompt } from "../../src/evaluate/prompt-builder.js";
import { buildMergePrompt } from "../../src/merge/prompt-builder.js";
import { buildVerifyPrompt } from "../../src/verify/prompt-builder.js";
import { buildPreMortemPrompt } from "../../src/verify/pre-mortem.js";
import { GenerateConfigSchema } from "../../src/types/config.js";
import {
  arbVariant,
  arbPlan,
  arbPlanSet,
  arbMergeConfig,
} from "../helpers/arbitraries.js";
import { makePlanSet } from "../helpers/factories.js";

const RUN_DIR = "/tmp/test-run";
const MERGE_PATH = "/tmp/test-run/merged.md";
const defaultGenConfig = GenerateConfigSchema.parse({});

const POISON_STRINGS = ["undefined", "null", "NaN", "[object Object]"];

// -----------------------------------------------------------------------
// Generate prompt invariants
// -----------------------------------------------------------------------

describe("generate prompt invariants", () => {
  it("every prompt contains output instruction with plan-<name>.md", () => {
    fc.assert(
      fc.property(
        fc.array(arbVariant(), { minLength: 1, maxLength: 4 }),
        (variants) => {
          const prompts = buildPrompts(
            "Base prompt.",
            undefined,
            variants,
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          for (const vp of prompts) {
            expect(vp.fullPrompt).toContain(`plan-${vp.variant.name}.md`);
          }
        },
      ),
    );
  });

  it("non-empty guidance produces ## Additional guidance section", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (guidance) => {
          const prompts = buildPrompts(
            "Base prompt.",
            undefined,
            [{ name: "v", guidance }],
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          expect(prompts[0]!.fullPrompt).toContain("## Additional guidance");
        },
      ),
    );
  });

  it("context produces ## Shared context section", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (context) => {
          const prompts = buildPrompts(
            "Base prompt.",
            context,
            [{ name: "v", guidance: "" }],
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          expect(prompts[0]!.fullPrompt).toContain("## Shared context");
        },
      ),
    );
  });

  it("no prompt contains poison strings", () => {
    fc.assert(
      fc.property(
        fc.array(arbVariant(), { minLength: 1, maxLength: 3 }),
        (variants) => {
          const prompts = buildPrompts(
            "Base prompt.",
            undefined,
            variants,
            new Map(),
            defaultGenConfig,
            RUN_DIR,
          );
          for (const vp of prompts) {
            for (const poison of POISON_STRINGS) {
              expect(vp.fullPrompt).not.toContain(poison);
            }
          }
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------
// Eval prompt invariants
// -----------------------------------------------------------------------

describe("eval prompt invariants", () => {
  it("all plan names appear in generated_plan tags", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlan(), { minLength: 1, maxLength: 4 }),
        arbMergeConfig(),
        (plans, config) => {
          const prompt = buildEvalPrompt(plans, config);
          for (const plan of plans) {
            expect(prompt).toContain(`name="${plan.variant.name}"`);
          }
        },
      ),
    );
  });

  it("generated_plan tag count equals plan count", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlan(), { minLength: 1, maxLength: 4 }),
        arbMergeConfig(),
        (plans, config) => {
          const prompt = buildEvalPrompt(plans, config);
          const tagCount = (prompt.match(/<generated_plan /g) ?? []).length;
          expect(tagCount).toBe(plans.length);
        },
      ),
    );
  });

  it("output always contains required JSON fields", () => {
    fc.assert(
      fc.property(
        fc.array(arbPlan(), { minLength: 1, maxLength: 3 }),
        arbMergeConfig(),
        (plans, config) => {
          const prompt = buildEvalPrompt(plans, config);
          expect(prompt).toContain("planScores");
          expect(prompt).toContain("gaps");
          expect(prompt).toContain("convergence");
          expect(prompt).toContain("summary");
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------
// Merge prompt invariants
// -----------------------------------------------------------------------

describe("merge prompt invariants", () => {
  it("all source plans embedded (tag count = plan count)", () => {
    fc.assert(
      fc.property(arbPlanSet(), arbMergeConfig(), (planSet, config) => {
        const prompt = buildMergePrompt(planSet, config, MERGE_PATH);
        const tagCount = (prompt.match(/<generated_plan /g) ?? []).length;
        expect(tagCount).toBe(planSet.plans.length);
      }),
    );
  });

  it("every embedded plan has NOTE injection protection", () => {
    fc.assert(
      fc.property(arbPlanSet(), arbMergeConfig(), (planSet, config) => {
        const prompt = buildMergePrompt(planSet, config, MERGE_PATH);
        const noteCount = (
          prompt.match(/NOTE: This is LLM-generated content/g) ?? []
        ).length;
        expect(noteCount).toBe(planSet.plans.length);
      }),
    );
  });

  it("every merge prompt contains CONSTITUTIONAL REVIEW", () => {
    fc.assert(
      fc.property(arbPlanSet(), arbMergeConfig(), (planSet, config) => {
        const prompt = buildMergePrompt(planSet, config, MERGE_PATH);
        expect(prompt).toContain("CONSTITUTIONAL REVIEW");
      }),
    );
  });
});

// -----------------------------------------------------------------------
// Verify prompt invariants
// -----------------------------------------------------------------------

describe("verify prompt invariants", () => {
  it("all 4 gate names present", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
            content: fc.string({ minLength: 10, maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (merged, sources) => {
          const prompt = buildVerifyPrompt(merged, sources);
          expect(prompt).toContain("CONSISTENCY");
          expect(prompt).toContain("COMPLETENESS");
          expect(prompt).toContain("ACTIONABILITY");
          expect(prompt).toContain("FACTUAL_ACCURACY");
        },
      ),
    );
  });

  it("all source plan names in source_plan tags", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 200 }),
        fc.array(
          fc.record({
            name: fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/),
            content: fc.string({ minLength: 10, maxLength: 200 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (merged, sources) => {
          const prompt = buildVerifyPrompt(merged, sources);
          for (const src of sources) {
            expect(prompt).toContain(`name="${src.name}"`);
          }
        },
      ),
    );
  });

  it("merged plan wrapped in merged_plan tags", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 200 }),
        (merged) => {
          const prompt = buildVerifyPrompt(merged, []);
          expect(prompt).toContain("<merged_plan>");
          expect(prompt).toContain("</merged_plan>");
        },
      ),
    );
  });
});

// -----------------------------------------------------------------------
// Pre-mortem prompt invariants
// -----------------------------------------------------------------------

describe("pre-mortem prompt invariants", () => {
  it("contains merged_plan tag and scenarios in JSON schema", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 10, maxLength: 500 }),
        (merged) => {
          const prompt = buildPreMortemPrompt(merged);
          expect(prompt).toContain("<merged_plan>");
          expect(prompt).toContain("scenarios");
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run structural invariants**

```bash
devbox run -- npx vitest run test/regression/structural-invariants.test.ts
```

Expected: 14 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/regression/structural-invariants.test.ts
git commit -m "test: add structural invariant tests with fast-check (14 properties)"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
make -f dev.mk check
```

Expected: build passes, lint passes, all tests pass (312 existing + ~42 new regression tests).

- [ ] **Step 2: Verify snapshot files are committed**

```bash
git status
```

Expected: clean working tree, all snapshot files committed.
