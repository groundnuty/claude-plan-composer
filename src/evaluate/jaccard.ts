import type { Plan } from "../types/plan.js";

export interface JaccardPair {
  readonly a: string;
  readonly b: string;
  readonly similarity: number;
}

export interface JaccardResult {
  readonly pairs: readonly JaccardPair[];
  readonly mean: number;
  readonly warning?: string;
}

/** Extract ## headings from markdown, lowercased and trimmed */
export function extractHeadings(markdown: string): ReadonlySet<string> {
  const headings = new Set<string>();
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      headings.add(trimmed.replace(/^#+\s*/, "").trim().toLowerCase());
    }
  }
  return headings;
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B|, returns 0 for two empty sets */
export function computeJaccard(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }

  return intersection / union.size;
}

/**
 * Compute pairwise Jaccard similarity on section headings for all C(N,2) plan pairs.
 *
 * Returns structured result with per-pair scores, mean, and optional warning
 * if plans are too similar (>0.8) or too divergent (<0.1).
 */
export function computePairwiseJaccard(plans: readonly Plan[]): JaccardResult {
  if (plans.length < 2) {
    return { pairs: [], mean: 0 };
  }

  const headingsMap = plans.map((p) => ({
    name: p.variant.name,
    headings: extractHeadings(p.content),
  }));

  const pairs: JaccardPair[] = [];
  for (let i = 0; i < headingsMap.length; i++) {
    for (let j = i + 1; j < headingsMap.length; j++) {
      pairs.push({
        a: headingsMap[i]!.name,
        b: headingsMap[j]!.name,
        similarity: computeJaccard(
          headingsMap[i]!.headings,
          headingsMap[j]!.headings,
        ),
      });
    }
  }

  const mean =
    pairs.reduce((sum, p) => sum + p.similarity, 0) / pairs.length;

  let warning: string | undefined;
  if (mean > 0.8) {
    warning =
      "Plans are very similar (mean Jaccard > 0.8) — prompt diversity may be insufficient";
  } else if (mean < 0.1) {
    warning =
      "Plans are very divergent (mean Jaccard < 0.1) — plans may lack common ground for merging";
  }

  return { pairs, mean, ...(warning ? { warning } : {}) };
}
