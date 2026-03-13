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

/**
 * Extract significant words (≥4 chars, lowercased, alphanumeric only) from text.
 *
 * Filters out short words (common stop words: the, and, for, etc.) to focus
 * on content-bearing terms. Used for word-level Jaccard which gives a much
 * stronger diversity signal than heading-level Jaccard.
 */
export function extractSignificantWords(text: string): ReadonlySet<string> {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z][a-z0-9]{3,}/g)) {
    words.add(match[0]);
  }
  return words;
}

export interface EntropyResult {
  readonly perNgram: Readonly<Record<number, number>>;
  readonly mean: number;
}

/**
 * Extract ordered array of significant words from text.
 *
 * Same regex as extractSignificantWords but returns an array (preserving
 * order and duplicates) instead of a Set. Needed for n-gram construction.
 */
function extractOrderedWords(text: string): readonly string[] {
  return Array.from(text.toLowerCase().matchAll(/[a-z][a-z0-9]{3,}/g), (m) => m[0]);
}

/**
 * Compute Shannon entropy on n-gram frequency distributions across all texts.
 *
 * Matches MIMIC (Chen et al., ASE 2025 RT) §4.3 methodology:
 * - Tokenize all texts into ordered word arrays
 * - Build sliding-window n-grams for each n-gram size
 * - Compute H = -Σ p(x) log₂ p(x) on the frequency distribution
 *
 * Returns per-n-gram entropy and the mean across all n-gram sizes.
 */
export function computeShannonEntropy(
  texts: readonly string[],
  ngramSizes: readonly number[] = [1, 2, 3],
): EntropyResult {
  const allWords = texts.flatMap(extractOrderedWords);
  if (allWords.length === 0 || ngramSizes.length === 0) {
    return { perNgram: {}, mean: 0 };
  }

  const perNgram: Record<number, number> = {};

  for (const n of ngramSizes) {
    const freq = new Map<string, number>();
    let total = 0;

    for (let i = 0; i <= allWords.length - n; i++) {
      const ngram = allWords.slice(i, i + n).join(" ");
      freq.set(ngram, (freq.get(ngram) ?? 0) + 1);
      total++;
    }

    if (total === 0) {
      perNgram[n] = 0;
      continue;
    }

    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    perNgram[n] = entropy;
  }

  const values = Object.values(perNgram);
  const mean = values.length > 0
    ? values.reduce((s, v) => s + v, 0) / values.length
    : 0;

  return { perNgram, mean };
}

export interface RetentionResult {
  readonly overall: number;
  readonly perVariant: Readonly<Record<string, number>>;
  readonly retained: readonly string[];
  readonly lost: readonly string[];
}

/**
 * Compute term-level content retention: what fraction of source plan
 * vocabulary survives in the merged plan.
 *
 * Uses extractSignificantWords (same as word-level Jaccard) to extract
 * content-bearing terms, then measures overlap between sources and merged.
 * Also computes per-variant retention to detect minority suppression.
 */
export function computeRetentionScore(
  sources: readonly { readonly name: string; readonly content: string }[],
  mergedContent: string,
): RetentionResult {
  const mergedWords = extractSignificantWords(mergedContent);
  const variantWordSets = sources.map((s) => ({
    name: s.name,
    words: extractSignificantWords(s.content),
  }));

  const allSourceWords = new Set<string>();
  for (const v of variantWordSets) {
    for (const w of v.words) {
      allSourceWords.add(w);
    }
  }

  if (allSourceWords.size === 0) {
    const perVariant: Record<string, number> = {};
    for (const v of variantWordSets) {
      perVariant[v.name] = 1.0;
    }
    return { overall: 1.0, perVariant, retained: [], lost: [] };
  }

  const retainedSet = new Set<string>();
  const lostSet = new Set<string>();
  for (const word of allSourceWords) {
    if (mergedWords.has(word)) {
      retainedSet.add(word);
    } else {
      lostSet.add(word);
    }
  }

  const overall = retainedSet.size / allSourceWords.size;

  const perVariant: Record<string, number> = {};
  for (const v of variantWordSets) {
    if (v.words.size === 0) {
      perVariant[v.name] = 1.0;
      continue;
    }
    let retained = 0;
    for (const w of v.words) {
      if (mergedWords.has(w)) retained++;
    }
    perVariant[v.name] = retained / v.words.size;
  }

  return {
    overall,
    perVariant,
    retained: [...retainedSet].sort(),
    lost: [...lostSet].sort(),
  };
}

/**
 * Compute pairwise word-level Jaccard similarity for plan content.
 *
 * Returns mean similarity across all C(N,2) pairs. Unlike heading-level
 * Jaccard (which is too coarse for haiku), word-level Jaccard reliably
 * differentiates plans with different topical focus.
 */
export function computeWordPairwiseJaccard(
  plans: readonly { readonly name: string; readonly content: string }[],
): { readonly mean: number; readonly pairs: readonly { readonly a: string; readonly b: string; readonly similarity: number }[] } {
  if (plans.length < 2) {
    return { mean: 0, pairs: [] };
  }

  const wordSets = plans.map((p) => ({
    name: p.name,
    words: extractSignificantWords(p.content),
  }));

  const pairs: { readonly a: string; readonly b: string; readonly similarity: number }[] = [];
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const a = wordSets[i]!;
      const b = wordSets[j]!;
      const union = new Set([...a.words, ...b.words]);
      if (union.size === 0) {
        pairs.push({ a: a.name, b: b.name, similarity: 0 });
        continue;
      }
      let intersection = 0;
      for (const word of a.words) {
        if (b.words.has(word)) intersection++;
      }
      pairs.push({ a: a.name, b: b.name, similarity: intersection / union.size });
    }
  }

  const mean = pairs.reduce((sum, p) => sum + p.similarity, 0) / pairs.length;
  return { mean, pairs };
}

export interface ComparisonMetrics {
  readonly jaccardDistance: number;
  readonly dimensionCoverage: Record<string, boolean>;
  readonly model: string;
  readonly shannonEntropy?: number;
  readonly retentionScore?: number;
}

/** Format delta for comparison table. Values within ±0.005 show "=" to suppress floating-point noise. */
function formatDelta(delta: number): string {
  if (Math.abs(delta) < 0.005) return "=";
  const arrow = delta > 0 ? "↑" : "↓";
  return `${arrow}${Math.abs(delta).toFixed(2)}`;
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
  lines.push(
    padRow(
      "Jaccard distance",
      baseline.jaccardDistance.toFixed(2),
      current.jaccardDistance.toFixed(2),
      formatDelta(jDelta),
    ),
  );

  // Shannon entropy
  if (baseline.shannonEntropy != null || current.shannonEntropy != null) {
    const bStr = baseline.shannonEntropy != null ? baseline.shannonEntropy.toFixed(2) : "N/A";
    const cStr = current.shannonEntropy != null ? current.shannonEntropy.toFixed(2) : "N/A";
    const delta = baseline.shannonEntropy != null && current.shannonEntropy != null
      ? formatDelta(current.shannonEntropy - baseline.shannonEntropy)
      : "—";
    lines.push(padRow("Shannon entropy", bStr, cStr, delta));
  }

  // Retention score
  if (baseline.retentionScore != null || current.retentionScore != null) {
    const bStr = baseline.retentionScore != null ? baseline.retentionScore.toFixed(2) : "N/A";
    const cStr = current.retentionScore != null ? current.retentionScore.toFixed(2) : "N/A";
    const delta = baseline.retentionScore != null && current.retentionScore != null
      ? formatDelta(current.retentionScore - baseline.retentionScore)
      : "—";
    lines.push(padRow("Retention score", bStr, cStr, delta));
  }

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
