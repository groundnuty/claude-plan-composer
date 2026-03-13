# Unified CLI Config Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge single-file and multi-file generate modes into a single config-driven model with per-variant `prompt_file` support.

**Architecture:** Add `prompt` and `context` fields to `GenerateConfig`, add `promptFile` to `VariantSchema`. A new `materializeConfig()` function reads all file paths (base prompt, context, per-variant prompt files) and returns resolved content. The unified `buildPrompts()` replaces both `buildVariantPrompts()` and `buildMultiFilePrompts()`. CLI positional args, `--multi`, and `--context` flags are removed; `--prompt` override flag is added.

**Tech Stack:** TypeScript, Zod v4, Commander, Vitest, ESM-only (`.js` import extensions)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types/config.ts` | Modify | Add `prompt`, `context` to `GenerateConfigSchema`; add `promptFile` to `VariantSchema` |
| `src/types/errors.ts` | Modify | Add `MissingBasePromptError` |
| `src/generate/prompt-builder.ts` | Modify | Replace two functions with unified `buildPrompts()` |
| `src/generate/index.ts` | Modify | Add `materializeConfig()`, simplify `GenerateOptions`, update `generate()` |
| `src/cli/index.ts` | Modify | Remove positional args/`--multi`/`--context`, add `--prompt` flag |
| `test/generate/prompt-builder.test.ts` | Modify | Replace old tests with unified `buildPrompts` tests |
| `test/pipeline/config-resolver.test.ts` | Modify | Add tests for new schema fields |
| `test/generate/generate.test.ts` | Create | Test `materializeConfig()` and validation logic |
| `test/fixtures/config.yaml` | Modify | Add `prompt` field |
| `test/fixtures/config-with-prompt-file.yaml` | Create | Fixture with per-variant `prompt_file` |
| `test/fixtures/prompts/task.md` | Create | Fixture base prompt file for `materializeConfig` tests |
| `test/fixtures/prompts/alt.md` | Create | Fixture prompt file for `prompt_file` tests |

---

## Chunk 1: Schema and Error Changes

### Task 1: Add `promptFile` to `VariantSchema` and new config fields

**Files:**
- Modify: `src/types/config.ts:1-49`
- Modify: `src/types/errors.ts:39-41`
- Test: `test/pipeline/config-resolver.test.ts`

- [ ] **Step 1: Write failing test — `VariantSchema` accepts `promptFile`**

Add to `test/pipeline/config-resolver.test.ts` at the end, before the closing of the file:

```typescript
describe("schema: promptFile on variants", () => {
  it("accepts variants with prompt_file", async () => {
    const config = await resolveGenerateConfig({
      cliOverrides: {
        prompt: "prompts/base.md",
        variants: [
          { name: "alpha", guidance: "", promptFile: "prompts/alt.md" },
        ],
      },
    });
    expect(config.variants[0]!.promptFile).toBe("prompts/alt.md");
  });

  it("defaults promptFile to undefined when not provided", async () => {
    const config = await resolveGenerateConfig({
      cliOverrides: {
        variants: [{ name: "alpha", guidance: "test" }],
      },
    });
    expect(config.variants[0]!.promptFile).toBeUndefined();
  });
});

describe("schema: prompt and context fields", () => {
  it("accepts prompt field in config", async () => {
    const config = await resolveGenerateConfig({
      cliOverrides: { prompt: "prompts/task.md" },
    });
    expect(config.prompt).toBe("prompts/task.md");
  });

  it("defaults prompt to undefined", async () => {
    const config = await resolveGenerateConfig();
    expect(config.prompt).toBeUndefined();
  });

  it("accepts context field in config", async () => {
    const config = await resolveGenerateConfig({
      cliOverrides: { context: "ctx.md" },
    });
    expect(config.context).toBe("ctx.md");
  });

  it("defaults context to undefined", async () => {
    const config = await resolveGenerateConfig();
    expect(config.context).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -f dev.mk test -- test/pipeline/config-resolver.test.ts`
Expected: FAIL — `promptFile` not recognized by schema, `prompt`/`context` properties don't exist on `GenerateConfig`

- [ ] **Step 3: Implement schema changes**

In `src/types/config.ts`, modify `VariantSchema` (lines 3-7):

```typescript
export const VariantSchema = z.object({
  name: z.string(),
  guidance: z.string().default(""),
  model: z.string().optional(),
  promptFile: z.string().optional(),
});
```

In `src/types/config.ts`, add two fields to `GenerateConfigSchema` (after line 14, the `workDir` field):

```typescript
  prompt: z.string().optional(),
  context: z.string().optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make -f dev.mk test -- test/pipeline/config-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Add `MissingBasePromptError` to errors**

In `src/types/errors.ts`, add after `IncompatibleFlagsError` (after line 41):

```typescript
export class MissingBasePromptError extends CpcError {
  constructor() {
    super(
      "Base prompt required: set 'prompt' in config or use --prompt flag " +
        "(variants without prompt_file need a base prompt)",
      "MISSING_BASE_PROMPT",
    );
  }
}
```

- [ ] **Step 6: Run full check**

Run: `make -f dev.mk check`
Expected: PASS — build, lint, all tests green

- [ ] **Step 7: Commit**

```bash
git add src/types/config.ts src/types/errors.ts test/pipeline/config-resolver.test.ts
git commit -m "feat(config): add prompt, context, promptFile fields to generate config schema"
```

---

## Chunk 2: Unified Prompt Builder

### Task 2: Replace `buildVariantPrompts` and `buildMultiFilePrompts` with `buildPrompts`

**Files:**
- Modify: `src/generate/prompt-builder.ts:1-84`
- Modify: `test/generate/prompt-builder.test.ts:1-178`

- [ ] **Step 1: Write failing tests for `buildPrompts`**

Replace the `buildVariantPrompts` and `buildMultiFilePrompts` describe blocks in `test/generate/prompt-builder.test.ts` (lines 36-141) with:

```typescript
describe("buildPrompts", () => {
  const basePrompt = "Create a deployment plan for the API service.";

  const variants: readonly Variant[] = [
    { name: "baseline", guidance: "" },
    { name: "depth", guidance: "Go deep on implementation specifics." },
    { name: "breadth", guidance: "Take a wide view." },
  ];

  it("uses base prompt for variants without promptFile content", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).toContain(basePrompt);
    }
  });

  it("uses variant-specific content when present in map", () => {
    const altContent = "Analyze security posture.";
    const variantContents = new Map([["depth", altContent]]);
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      variantContents,
      defaultConfig,
      RUN_DIR,
    );
    const depth = results.find((r) => r.variant.name === "depth");
    expect(depth!.fullPrompt).toContain(altContent);
    expect(depth!.fullPrompt).not.toContain(basePrompt);
  });

  it("appends guidance when non-empty", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    const depth = results.find((r) => r.variant.name === "depth");
    expect(depth!.fullPrompt).toContain("## Additional guidance");
    expect(depth!.fullPrompt).toContain(
      "Go deep on implementation specifics.",
    );
  });

  it("omits guidance section when guidance is empty", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    const baseline = results.find((r) => r.variant.name === "baseline");
    expect(baseline!.fullPrompt).not.toContain("## Additional guidance");
  });

  it("appends context when provided", () => {
    const context = "The project uses Node.js 22 and PostgreSQL 16.";
    const results = buildPrompts(
      basePrompt,
      context,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).toContain("## Shared context");
      expect(vp.fullPrompt).toContain(context);
    }
  });

  it("omits context section when undefined", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      expect(vp.fullPrompt).not.toContain("## Shared context");
    }
  });

  it("appends guidance to variant with promptFile content", () => {
    const altContent = "Alternative approach.";
    const variantContents = new Map([["depth", altContent]]);
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      variantContents,
      defaultConfig,
      RUN_DIR,
    );
    const depth = results.find((r) => r.variant.name === "depth");
    expect(depth!.fullPrompt).toContain(altContent);
    expect(depth!.fullPrompt).toContain("## Additional guidance");
    expect(depth!.fullPrompt).toContain(
      "Go deep on implementation specifics.",
    );
  });

  it("appends context to variant with promptFile content", () => {
    const altContent = "Alternative approach.";
    const context = "Shared context here.";
    const variantContents = new Map([["depth", altContent]]);
    const results = buildPrompts(
      basePrompt,
      context,
      variants,
      variantContents,
      defaultConfig,
      RUN_DIR,
    );
    const depth = results.find((r) => r.variant.name === "depth");
    expect(depth!.fullPrompt).toContain(altContent);
    expect(depth!.fullPrompt).toContain("## Shared context");
    expect(depth!.fullPrompt).toContain(context);
  });

  it("sets correct planPath for each variant", () => {
    const results = buildPrompts(
      basePrompt,
      undefined,
      variants,
      new Map(),
      defaultConfig,
      RUN_DIR,
    );
    for (const vp of results) {
      const expected = path.join(RUN_DIR, `plan-${vp.variant.name}.md`);
      expect(vp.planPath).toBe(expected);
    }
  });
});
```

Update the import at the top of the test file (line 4-7) to import `buildPrompts` instead of the old functions:

```typescript
import {
  buildOutputInstruction,
  buildPrompts,
} from "../../src/generate/prompt-builder.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -f dev.mk test -- test/generate/prompt-builder.test.ts`
Expected: FAIL — `buildPrompts` is not exported

- [ ] **Step 3: Implement unified `buildPrompts`**

Replace the contents of `src/generate/prompt-builder.ts` (lines 37-84, the two builder functions) with:

```typescript
/** Build prompts for all variants using unified logic.
 *
 * @param basePrompt - Base prompt content (for variants without their own prompt)
 * @param context - Shared context content (appended to all prompts when present)
 * @param variants - Variant definitions (name, guidance)
 * @param variantPromptContents - Pre-resolved prompt file contents keyed by variant name
 * @param _config - GenerateConfig (reserved for future use)
 * @param runDir - Output directory for plan files
 */
export function buildPrompts(
  basePrompt: string | undefined,
  context: string | undefined,
  variants: readonly Variant[],
  variantPromptContents: ReadonlyMap<string, string>,
  _config: GenerateConfig,
  runDir: string,
): VariantPrompt[] {
  return variants.map((variant) => {
    const prompt = variantPromptContents.get(variant.name) ?? basePrompt ?? "";
    const parts: string[] = [prompt];

    if (context) {
      parts.push(`\n## Shared context\n${context}`);
    }

    if (variant.guidance) {
      parts.push(`\n## Additional guidance\n${variant.guidance}`);
    }

    parts.push(`\n${buildOutputInstruction(runDir, variant.name)}`);

    return {
      variant,
      fullPrompt: parts.join("\n"),
      planPath: path.join(runDir, `plan-${variant.name}.md`),
    };
  });
}
```

Update the exports: remove `buildVariantPrompts` and `buildMultiFilePrompts`, keep `buildOutputInstruction` and add `buildPrompts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `make -f dev.mk test -- test/generate/prompt-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Do NOT commit yet** — prompt-builder changes will break the build until `generate/index.ts` is updated in the next steps. Continue directly.

---

## Chunk 3: Materialization and Generate Refactor

### Task 3: Add `materializeConfig`, refactor `generate()`, and commit together with Task 2

**Files:**
- Modify: `src/generate/index.ts:1-159`
- Create: `test/generate/generate.test.ts`
- Create: `test/fixtures/prompts/task.md`
- Create: `test/fixtures/prompts/alt.md`

- [ ] **Step 1: Create test fixture files**

Create `test/fixtures/prompts/task.md`:

```markdown
Create a deployment plan for the API service.
```

Create `test/fixtures/prompts/alt.md`:

```markdown
Analyze the system from a security perspective.
```

- [ ] **Step 2: Write failing tests for `materializeConfig` and validation**

Create `test/generate/generate.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `make -f dev.mk test -- test/generate/generate.test.ts`
Expected: FAIL — `materializeConfig` is not exported

- [ ] **Step 4: Implement `materializeConfig`**

In `src/generate/index.ts`, add the following imports and function. Replace the existing imports at lines 1-6 with:

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PlanSet } from "../types/plan.js";
import type { GenerateConfig } from "../types/config.js";
import type { OnStatusMessage } from "../monitor/types.js";
import { IncompatibleFlagsError, MissingBasePromptError } from "../types/errors.js";
import { buildPrompts } from "./prompt-builder.js";
import type { VariantPrompt } from "./prompt-builder.js";
import { generateLenses } from "./auto-lenses.js";
import {
  runParallelSessions,
  runSequentialSessions,
} from "./session-runner.js";
```

Add the `MaterializedConfig` interface and `materializeConfig` function after the imports:

```typescript
export interface MaterializedConfig {
  readonly basePrompt: string | undefined;
  readonly context: string | undefined;
  readonly variantPromptContents: ReadonlyMap<string, string>;
}

/** Read all file paths from config and return resolved content.
 *
 * Validates cross-field constraints:
 * - autoLenses/sequentialDiversity incompatible with promptFile variants
 * - base prompt required when some variants lack promptFile
 */
export async function materializeConfig(
  config: GenerateConfig,
): Promise<MaterializedConfig> {
  const hasPromptFileVariants = config.variants.some((v) => v.promptFile);

  // Validate incompatible flag combinations
  if (hasPromptFileVariants && config.autoLenses) {
    throw new IncompatibleFlagsError(
      "auto-lenses is incompatible with per-variant prompt_file",
    );
  }
  if (hasPromptFileVariants && config.sequentialDiversity) {
    throw new IncompatibleFlagsError(
      "sequential diversity is incompatible with per-variant prompt_file",
    );
  }

  // Check if base prompt is needed
  const allVariantsHavePromptFile = config.variants.every((v) => v.promptFile);
  const needsBasePrompt = !allVariantsHavePromptFile;

  if (needsBasePrompt && !config.prompt) {
    throw new MissingBasePromptError();
  }

  // Read base prompt
  const basePrompt = config.prompt
    ? await fs.readFile(config.prompt, "utf-8")
    : undefined;

  // Read context
  const context = config.context
    ? await fs.readFile(config.context, "utf-8")
    : undefined;

  // Read per-variant prompt files
  const entries: [string, string][] = [];
  for (const variant of config.variants) {
    if (variant.promptFile) {
      const content = await fs.readFile(variant.promptFile, "utf-8");
      entries.push([variant.name, content]);
    }
  }

  return {
    basePrompt,
    context,
    variantPromptContents: new Map(entries),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `make -f dev.mk test -- test/generate/generate.test.ts`
Expected: PASS

- [ ] **Step 6: Refactor `GenerateOptions` and `generate()`**

Update `GenerateOptions` (replace the existing interface at lines 18-33):

```typescript
export interface GenerateOptions {
  /** Override output directory base */
  readonly outputDir?: string;
  /** Debug mode: single variant, cheaper model */
  readonly debug?: boolean | string;
  /** Parent abort signal for graceful shutdown */
  readonly signal?: AbortSignal;
  /** Callback for status message forwarding */
  readonly onStatusMessage?: OnStatusMessage;
}
```

Delete `validateFlags` function (lines 51-65) entirely — all validation is now in
`materializeConfig()`. Debug mode is compatible with all variant types.

Update `generate()` function (replace lines 90-159):

```typescript
/** Main generate function */
export async function generate(
  config: GenerateConfig,
  options: GenerateOptions,
): Promise<PlanSet> {
  // Apply debug overrides
  const resolvedConfig = options.debug
    ? applyDebugOverrides(
        config,
        typeof options.debug === "string" ? options.debug : undefined,
      )
    : config;

  // Materialize: read all files, validate cross-field constraints
  const materialized = await materializeConfig(resolvedConfig);

  // Determine prompt name and base dir
  const hasPromptFiles = resolvedConfig.variants.some((v) => v.promptFile);
  const promptName = hasPromptFiles
    ? `multi-${createRunDirName().slice(-6)}`
    : "plan";
  const baseDir = options.outputDir ?? path.join("generated-plans", promptName);
  const runDir = path.join(baseDir, createRunDirName());
  await fs.mkdir(runDir, { recursive: true });

  // Build variant prompts
  let variantPrompts: VariantPrompt[];

  if (resolvedConfig.autoLenses) {
    // Auto-lenses replaces config variants with generated ones
    const variants = await generateLenses(
      materialized.basePrompt!,
      resolvedConfig,
      runDir,
    );
    variantPrompts = buildPrompts(
      materialized.basePrompt,
      materialized.context,
      variants,
      new Map(),
      resolvedConfig,
      runDir,
    );
  } else {
    variantPrompts = buildPrompts(
      materialized.basePrompt,
      materialized.context,
      resolvedConfig.variants,
      materialized.variantPromptContents,
      resolvedConfig,
      runDir,
    );
  }

  // Run sessions
  const plans = resolvedConfig.sequentialDiversity
    ? await runSequentialSessions(
        variantPrompts,
        resolvedConfig,
        options.signal,
        options.onStatusMessage,
      )
    : await runParallelSessions(
        variantPrompts,
        resolvedConfig,
        options.signal,
        options.onStatusMessage,
      );

  return {
    plans,
    timestamp: new Date().toISOString(),
    runDir,
  };
}
```

- [ ] **Step 7: Run full check**

Run: `make -f dev.mk check`
Expected: FAIL — `src/cli/index.ts` still passes old-style `GenerateOptions` fields (`prompt`, `promptFiles`, `context`). This is expected; fixed in Task 4.

- [ ] **Step 8: Commit (includes Task 2 prompt-builder changes)**

```bash
git add src/generate/index.ts src/generate/prompt-builder.ts test/generate/prompt-builder.test.ts test/generate/generate.test.ts test/fixtures/prompts/task.md test/fixtures/prompts/alt.md
git commit -m "feat(generate): unified prompt builder, materializeConfig, and simplified GenerateOptions"
```

---

## Chunk 4: CLI Refactor

### Task 4: Update CLI to use config-driven prompts

**Files:**
- Modify: `src/cli/index.ts:112-223` (generate command)
- Modify: `src/cli/index.ts:498-702` (run command)
- Modify: `test/fixtures/config.yaml`

- [ ] **Step 1: Update test fixture config**

Modify `test/fixtures/config.yaml` to add a `prompt` field:

```yaml
model: sonnet
max_turns: 20
timeout_ms: 600000
work_dir: ""
min_output_bytes: 500
prompt: prompts/task.md

variants:
  - name: baseline
    guidance: ""
  - name: simplicity
    guidance: "Prioritize minimalism."
```

- [ ] **Step 2: Create fixture for `prompt_file` variant config**

Create `test/fixtures/config-with-prompt-file.yaml`:

```yaml
model: sonnet
max_turns: 20
timeout_ms: 600000
min_output_bytes: 500

variants:
  - name: security
    guidance: "Focus on security"
    prompt_file: prompts/alt.md
  - name: performance
    prompt_file: prompts/alt.md
```

- [ ] **Step 3: Update `generate` command in CLI**

In `src/cli/index.ts`, replace the generate command definition (lines 122-223) with:

```typescript
program
  .command("generate")
  .description("Generate plans from config")
  .option("--config <file>", "Config file path")
  .option("--prompt <file>", "Override base prompt file path")
  .option("--debug [variant]", "Debug mode: sonnet, 20 turns, single variant")
  .option("--dry-run", "Show resolved config and exit")
  .option("--auto-lenses", "Generate task-specific variants via LLM")
  .option("--sequential-diversity", "Two-wave generation")
  .option("--model <name>", "Override model")
  .option("--max-turns <n>", "Override max turns", coerceInt)
  .option("--timeout <ms>", "Override timeout in milliseconds", coerceInt)
  .option("--budget <usd>", "Override budget cap in USD", coerceFloat)
  .action(async (opts) => {
    try {
      const overrides: Record<string, unknown> = {};
      if (opts.model !== undefined) overrides.model = opts.model;
      if (opts.maxTurns !== undefined) overrides.maxTurns = opts.maxTurns;
      if (opts.timeout !== undefined) overrides.timeoutMs = opts.timeout;
      if (opts.budget !== undefined) overrides.budgetUsd = opts.budget;
      if (opts.prompt !== undefined) overrides.prompt = opts.prompt;
      if (opts.autoLenses) overrides.autoLenses = true;
      if (opts.sequentialDiversity) overrides.sequentialDiversity = true;

      const config = await resolveGenerateConfig({
        cliConfigPath: opts.config,
        cliOverrides: overrides,
      });

      if (opts.dryRun) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "generate",
        configPath: opts.config ?? "",
        outputDir: "",
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();
      collector.setStage("generating");

      try {
        const generateOpts: GenerateOptions = {
          debug: opts.debug ?? false,
          signal: controller.signal,
          onStatusMessage,
        };

        const result = await generate(config, generateOpts);
        await writePlanSet(result, result.runDir);
        collector.setOutputDir(result.runDir);

        const variantNames = result.plans.map((p) => p.variant.name);
        printGenerateSummary(result.runDir, result.plans.length, variantNames);

        collector.setStage("done");
      } finally {
        await statusServer.stop();
      }
    } catch (err) {
      if (err instanceof CpcError) {
        console.error(`Error [${err.code}]: ${err.message}`);
      } else {
        console.error(err);
      }
      process.exitCode = 1;
    }
  });
```

- [ ] **Step 4: Update `run` command in CLI**

In `src/cli/index.ts`, replace the run command definition (lines 498-702). Key changes:
- Remove `.argument("<prompt-file>", ...)` and `.argument("[extra-files...]", ...)`
- Remove `--multi` and `--context` options
- Add `--prompt <file>` option
- Replace the action signature from `async (promptFile: string, extraFiles: string[], opts)` to `async (opts)`
- Simplify the `GenerateOptions` construction (no more `prompt`/`promptFiles`/`context` fields)
- Add `opts.prompt` to `genOverrides`

```typescript
program
  .command("run")
  .description("Generate plans then merge (full pipeline)")
  // generate flags
  .option("--config <file>", "Generate config file path")
  .option("--prompt <file>", "Override base prompt file path")
  .option("--debug [variant]", "Debug mode: sonnet, 20 turns, single variant")
  .option("--dry-run", "Show resolved configs and exit")
  .option("--auto-lenses", "Generate task-specific variants via LLM")
  .option("--sequential-diversity", "Two-wave generation")
  .option("--model <name>", "Override model (both generate and merge)")
  .option("--max-turns <n>", "Override max turns", coerceInt)
  .option("--timeout <ms>", "Override timeout in milliseconds", coerceInt)
  .option("--budget <usd>", "Override budget cap in USD", coerceFloat)
  // merge flags
  .option("--merge-config <file>", "Merge config file path")
  .option(
    "--strategy <name>",
    "Merge strategy: simple, agent-teams, subagent-debate",
  )
  .option("--comparison <method>", "Comparison method: holistic, pairwise")
  // pipeline flags
  .option("--skip-eval", "Skip pre-merge evaluation")
  .option("--verify", "Run post-merge verification")
  .option("--verify-model <name>", "Model for verification (default: sonnet)")
  .option("--pre-mortem", "Run pre-mortem failure analysis after verification")
  .action(async (opts) => {
    try {
      // Resolve generate config
      const genOverrides: Record<string, unknown> = {};
      if (opts.model !== undefined) genOverrides.model = opts.model;
      if (opts.maxTurns !== undefined) genOverrides.maxTurns = opts.maxTurns;
      if (opts.timeout !== undefined) genOverrides.timeoutMs = opts.timeout;
      if (opts.budget !== undefined) genOverrides.budgetUsd = opts.budget;
      if (opts.prompt !== undefined) genOverrides.prompt = opts.prompt;
      if (opts.autoLenses) genOverrides.autoLenses = true;
      if (opts.sequentialDiversity) genOverrides.sequentialDiversity = true;

      const genConfig = await resolveGenerateConfig({
        cliConfigPath: opts.config,
        cliOverrides: genOverrides,
      });

      // Resolve merge config
      const mergeOverrides: Record<string, unknown> = {};
      if (opts.model !== undefined) mergeOverrides.model = opts.model;
      if (opts.strategy !== undefined) mergeOverrides.strategy = opts.strategy;
      if (opts.comparison !== undefined)
        mergeOverrides.comparisonMethod = opts.comparison;

      const mergeConfig = await resolveMergeConfig({
        cliConfigPath: opts.mergeConfig,
        cliOverrides: mergeOverrides,
      });

      if (opts.dryRun) {
        console.log(
          JSON.stringify({ generate: genConfig, merge: mergeConfig }, null, 2),
        );
        return;
      }

      // Set up status server for live monitoring
      const collector = new StatusCollector({
        pid: process.pid,
        command: "run",
        configPath: opts.config ?? opts.mergeConfig ?? "",
        outputDir: "",
      });
      const statusServer = new StatusServer(collector);
      const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
      await statusServer.start(socketPath);

      controller.signal.addEventListener(
        "abort",
        () => {
          statusServer.stop();
        },
        { once: true },
      );

      const onStatusMessage = collector.createCallback();

      try {
        // 1. Generate
        collector.setStage("generating");
        const generateOpts: GenerateOptions = {
          debug: opts.debug ?? false,
          signal: controller.signal,
          onStatusMessage,
        };

        const planSet = await generate(genConfig, generateOpts);
        await writePlanSet(planSet, planSet.runDir);
        collector.setOutputDir(planSet.runDir);

        const variantNames = planSet.plans.map((p) => p.variant.name);
        printGenerateSummary(
          planSet.runDir,
          planSet.plans.length,
          variantNames,
        );

        // 2. Evaluate (optional — skipped when --skip-eval is set)
        let evalResult = undefined;
        if (!opts.skipEval) {
          collector.setStage("evaluating");
          evalResult = await evaluate(planSet, mergeConfig, {
            signal: controller.signal,
            onStatusMessage,
          });
          await writeEvalResult(evalResult, planSet.runDir);
          printEvalSummary(
            evalResult.convergence,
            evalResult.gaps,
            evalResult.summary,
          );
        }

        // 3. Merge
        collector.setStage("merging");
        const mergeResult = await merge(planSet, mergeConfig, {
          evalResult,
          onStatusMessage,
        });
        await writeMergeResult(mergeResult, planSet.runDir);

        printMergeSummary(planSet.runDir, mergeResult.strategy);

        // 4. Verify (optional — enabled when --verify is set)
        let verifyResult = undefined;
        if (opts.verify) {
          collector.setStage("verifying");
          const verifyOpts: VerifyOptions = {
            model: opts.verifyModel,
            signal: controller.signal,
            onStatusMessage,
          };
          verifyResult = await verify(mergeResult, planSet, verifyOpts);
          await writeVerifyResult(verifyResult, planSet.runDir);
          printVerifySummary(verifyResult.gates, verifyResult.pass);

          if (opts.preMortem) {
            collector.setStage("pre-mortem");
            const pmOpts: PreMortemOptions = {
              model: opts.verifyModel,
              signal: controller.signal,
              onStatusMessage,
            };
            const pmResult = await runPreMortem(
              mergeResult.content,
              planSet.runDir,
              pmOpts,
            );
            await writePreMortemResult(pmResult, planSet.runDir);
            console.error(
              `Pre-mortem: ${pmResult.scenarios.length} failure scenarios → ${planSet.runDir}/pre-mortem.md`,
            );
          }
        }

        collector.setStage("done");

        const pipelineResult: PipelineResult = {
          planSet,
          mergeResult,
          evalResult,
          verifyResult,
        };

        // Print final pipeline summary to stderr
        console.error("---");
        console.error(`Pipeline complete: ${planSet.runDir}`);
        console.error(`Plans: ${pipelineResult.planSet.plans.length}`);
        console.error(`Merge strategy: ${pipelineResult.mergeResult.strategy}`);
      } finally {
        await statusServer.stop();
      }
    } catch (err) {
      if (err instanceof CpcError) {
        console.error(`Error [${err.code}]: ${err.message}`);
      } else {
        console.error(err);
      }
      process.exitCode = 1;
    }
  });
```

- [ ] **Step 5: Remove unused `readPromptFile` helper**

In `src/cli/index.ts`, delete the `readPromptFile` function (lines 50-57) — no longer needed since `materializeConfig()` handles file reading.

- [ ] **Step 6: Run full check**

Run: `make -f dev.mk check`
Expected: PASS — build, lint, all tests green

- [ ] **Step 7: Commit**

```bash
git add src/cli/index.ts test/fixtures/config.yaml test/fixtures/config-with-prompt-file.yaml
git commit -m "feat(cli): remove positional args and --multi/--context, add --prompt override flag"
```

---

## Chunk 5: Cleanup and Verification

### Task 5: Remove dead code, update normalizeVariants, final verification

**Files:**
- Modify: `src/pipeline/config-resolver.ts:66-92` (normalizeVariants)

- [ ] **Step 1: Update `normalizeVariants` to handle `prompt_file` in bash-style map format**

In `src/pipeline/config-resolver.ts`, update the `normalizeVariants` function (lines 66-92) to preserve `promptFile`/`prompt_file` when converting from bash-style map:

```typescript
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
```

- [ ] **Step 2: Run full check**

Run: `make -f dev.mk check`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pipeline/config-resolver.ts
git commit -m "feat(config): support prompt_file in bash-style variant map normalization"
```

### Task 6: Update MEMORY.md with CLI changes

**Files:**
- Modify: `/Users/orzech/.claude/projects/-Users-orzech-Dropbox-home-repos-hyperflow-1000genome-claude-plan-composer-ts/memory/MEMORY.md`

- [ ] **Step 1: Update the "CLI Flags (IMPORTANT)" section in MEMORY.md**

Update to reflect the new unified CLI shape:

```markdown
## CLI Flags (IMPORTANT)

All commands use `--config`. No positional arguments.

```
cpc generate --config <gen-config> [--prompt <file>]
cpc evaluate --config <merge-config>
cpc merge    --config <merge-config>
cpc verify   --config <merge-config>
cpc run      --config <gen-config> --merge-config <merge-config> [--prompt <file>]
```

Override flags: `--model`, `--max-turns`, `--timeout`, `--prompt`
Removed: positional `<prompt-file>`, `--multi`, `--context`

Config fields `prompt`, `context` replace CLI file args.
Per-variant `prompt_file` replaces multi-file mode.
```

- [ ] **Step 2: Commit**

```bash
git add /Users/orzech/.claude/projects/-Users-orzech-Dropbox-home-repos-hyperflow-1000genome-claude-plan-composer-ts/memory/MEMORY.md
git commit -m "docs: update memory with unified CLI config changes"
```
