import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Variant } from "../types/plan.js";
import type { GenerateConfig } from "../types/config.js";
import { LensGenerationError } from "../types/errors.js";

/** Build the prompt that asks Claude to generate analytical perspectives */
export function buildLensPrompt(basePrompt: string, lensCount: number): string {
  return [
    `Given this planning task, generate exactly ${lensCount} maximally different`,
    `analytical perspectives to approach it from. Each perspective should force`,
    `genuinely different trade-offs, priorities, and reasoning paths.`,
    ``,
    `At least one perspective MUST be explicitly adversarial — focused on finding`,
    `weaknesses in the obvious approach, identifying missing alternatives, and`,
    `surfacing reasons the proposed solution might fail.`,
    ``,
    `For each perspective, output:`,
    `- name: a short kebab-case identifier (e.g., 'risk-first', 'user-centric')`,
    `- guidance: 2-3 sentences of specific guidance for that perspective`,
    ``,
    `Output ONLY valid YAML, no other text:`,
    `perspectives:`,
    `  - name: ...`,
    `    guidance: ...`,
    ``,
    `The task:`,
    basePrompt,
  ].join("\n");
}

/** Sanitize lens name: lowercase, non-alphanumeric → dashes, collapse consecutive */
export function sanitizeLensName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** Parse YAML response into Variant[], with name sanitization and dedup */
export function parseLensResponse(yamlText: string): Variant[] {
  // Strip markdown code fences if present
  const cleaned = yamlText
    .replace(/^```(?:ya?ml)?\s*\n/m, "")
    .replace(/\n```\s*$/m, "")
    .trim();

  const parsed = yaml.load(cleaned) as { perspectives?: Array<{ name: string; guidance: string }> };

  if (!parsed?.perspectives || !Array.isArray(parsed.perspectives)) {
    throw new LensGenerationError("Response did not contain 'perspectives' array");
  }

  const seen = new Set<string>();
  const variants: Variant[] = [];

  for (const p of parsed.perspectives) {
    if (!p.name || !p.guidance) continue;

    const name = sanitizeLensName(p.name);
    if (!name) continue;

    if (seen.has(name)) {
      console.warn(`Warning: duplicate lens name '${name}' — skipping`);
      continue;
    }
    seen.add(name);

    variants.push({
      name,
      guidance: p.guidance.trim(),
    });
  }

  return variants;
}

/** Generate task-specific variant perspectives via LLM */
export async function generateLenses(
  prompt: string,
  config: GenerateConfig,
  runDir: string,
): Promise<Variant[]> {
  const lensPrompt = buildLensPrompt(prompt, config.lensCount);

  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    config.lensTimeoutMs,
  );

  try {
    let responseText = "";

    for await (const msg of query({
      prompt: lensPrompt,
      options: {
        model: config.lensModel,
        maxTurns: 3,
        tools: [],  // lens generation doesn't need tools
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        settingSources: [],
        abortController,
        env: {
          ...process.env,
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4000",
        },
      },
    })) {
      if (msg.type === "assistant" && "message" in msg) {
        const textBlocks = (msg.message as any).content
          ?.filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");
        if (textBlocks) {
          responseText += textBlocks;
        }
      }
    }

    const variants = parseLensResponse(responseText);

    if (variants.length === 0) {
      console.warn("Warning: no valid lenses generated — falling back to config variants");
      return [...config.variants];
    }

    // Save lenses for reproducibility
    await fs.writeFile(
      path.join(runDir, "auto-lenses.yaml"),
      yaml.dump({ perspectives: variants.map(v => ({ name: v.name, guidance: v.guidance })) }),
    );

    return variants;
  } catch (err) {
    if (err instanceof LensGenerationError) throw err;
    throw new LensGenerationError(
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timeout);
  }
}
