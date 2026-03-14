import { z } from "zod";

export const VariantSchema = z.object({
  name: z.string(),
  guidance: z.string().default(""),
  model: z.string().optional(),
  promptFile: z.string().optional(),
});

export const GenerateConfigSchema = z.object({
  model: z.string().default("opus"),
  maxTurns: z.number().default(80),
  timeoutMs: z.number().default(3_600_000),
  budgetUsd: z.number().optional(),
  workDir: z.string().default(""),
  prompt: z.string().optional(),
  context: z.string().optional(),
  additionalDirs: z.array(z.string()).default([]),
  mcpConfig: z.string().optional(),
  strictMcp: z.boolean().default(true),
  tools: z
    .array(z.string())
    .default(["Read", "Glob", "Bash", "Write", "WebFetch", "WebSearch"]),
  settingSources: z.array(z.enum(["user", "project", "local"])).default([]),
  sessionSettings: z.record(z.string(), z.unknown()).default({}),
  systemPrompt: z.string().optional(),
  variants: z.array(VariantSchema).default([
    { name: "baseline", guidance: "" },
    {
      name: "simplicity",
      guidance:
        "Prioritize minimalism. Find the smallest scope that addresses the core problem.",
    },
    {
      name: "depth",
      guidance:
        "Go deep on implementation specifics. Include exact commands, config snippets, error handling.",
    },
    {
      name: "breadth",
      guidance:
        "Take a wide view. Consider alternatives, trade-offs, and second-order effects.",
    },
  ]),
  autoLenses: z.boolean().default(false),
  sequentialDiversity: z.boolean().default(false),
  staggerMs: z.number().default(0),
  lensModel: z.string().default("haiku"),
  lensCount: z.number().default(4),
  lensTimeoutMs: z.number().default(120_000),
  minOutputBytes: z.number().default(5000),
  diversityThreshold: z.number().min(0).max(1).default(0.30),
});

export type GenerateConfig = z.infer<typeof GenerateConfigSchema>;

export const MergeStrategySchema = z.enum([
  "simple",
  "agent-teams",
  "subagent-debate",
]);

export const DimensionSchema = z.union([
  z.string(),
  z.object({ name: z.string(), weight: z.number() }),
]);

export const MergeConfigSchema = z.object({
  model: z.string().default("opus"),
  maxTurns: z.number().default(30),
  timeoutMs: z.number().default(3_600_000),
  budgetUsd: z.number().optional(),
  workDir: z.string().default(""),
  mcpConfig: z.string().optional(),
  strictMcp: z.boolean().default(true),
  settingSources: z.array(z.enum(["user", "project", "local"])).default([]),
  strategy: MergeStrategySchema.default("simple"),
  comparisonMethod: z.enum(["holistic", "pairwise"]).default("holistic"),
  projectDescription: z.string().default(""),
  role: z.string().default("an expert analyst"),
  systemPrompt: z.string().optional(),
  dimensions: z
    .array(DimensionSchema)
    .default([
      "Approach and strategy",
      "Scope and priorities",
      "Technical depth and specificity",
      "Architecture and structure",
      "Risk assessment and trade-offs",
      "Actionability and next steps",
    ]),
  constitution: z
    .array(z.string())
    .default([
      "Every trade-off must be explicitly acknowledged with pros and cons",
      "No section should be purely aspirational — each needs a concrete next step",
      "Risks identified in any source plan must appear in the merged plan",
      "The plan must be self-consistent — no section contradicts another",
      "When resolving disagreement, verify correction in every section mentioning the topic",
    ]),
  advocateInstructions: z
    .string()
    .default(
      "Argue for your plan's approach. Challenge others where your plan is stronger. " +
        "Identify at least 2 weaknesses in your OWN plan. " +
        "Identify at least 2 strengths in a COMPETING plan.",
    ),
  outputGoal: z
    .string()
    .default(
      "The merged plan must be standalone — readable without the source plans.",
    ),
  outputTitle: z.string().default("Merged Plan"),
  evalScoring: z.enum(["binary", "likert"]).default("binary"),
  evalPasses: z.number().default(1),
  evalConsensus: z.enum(["median", "majority", "min"]).default("median"),
});

export type MergeConfig = z.infer<typeof MergeConfigSchema>;
