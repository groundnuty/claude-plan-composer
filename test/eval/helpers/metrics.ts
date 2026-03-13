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
    const delta = bFound && !cFound ? "↓REGRESSION"
      : !bFound && cFound ? "↑IMPROVED"
      : "=";
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
