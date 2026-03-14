export interface EntropyResult {
  readonly perNgram: Readonly<Record<string, number>>;
  readonly mean: number;
}

/**
 * Extract ordered array of significant words from text.
 *
 * Words are lowercased, alphanumeric only, ≥4 chars. Order and duplicates
 * preserved (needed for n-gram construction).
 */
export function extractOrderedWords(text: string): readonly string[] {
  return Array.from(
    text.toLowerCase().matchAll(/[a-z][a-z0-9]{3,}/g),
    (m) => m[0],
  );
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
 * Keys in `perNgram` are strings (not numbers) for JSON serialization.
 */
export function computeShannonEntropy(
  texts: readonly string[],
  ngramSizes: readonly number[] = [1, 2, 3],
): EntropyResult {
  const allWords = texts.flatMap(extractOrderedWords);
  if (allWords.length === 0 || ngramSizes.length === 0) {
    return { perNgram: {}, mean: 0 };
  }

  const perNgram: Record<string, number> = {};

  for (const n of ngramSizes) {
    const freq = new Map<string, number>();
    let total = 0;

    for (let i = 0; i <= allWords.length - n; i++) {
      const ngram = allWords.slice(i, i + n).join(" ");
      freq.set(ngram, (freq.get(ngram) ?? 0) + 1);
      total++;
    }

    if (total === 0) {
      perNgram[String(n)] = 0;
      continue;
    }

    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    perNgram[String(n)] = entropy;
  }

  const values = Object.values(perNgram);
  const mean =
    values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  return { perNgram, mean };
}

/**
 * Compute normalized Shannon entropy: H_n / log2(V_n) per n-gram size.
 *
 * Produces values in [0, 1] where 1 = perfectly uniform distribution.
 * When V_n <= 1 (zero or one unique n-gram), normalized value is 0 (no diversity).
 *
 * Scientific basis: Shannon (1948) normalized entropy ("efficiency").
 */
export function computeNormalizedEntropy(
  texts: readonly string[],
  ngramSizes: readonly number[] = [1, 2, 3],
): { readonly perNgram: Readonly<Record<string, number>>; readonly mean: number } {
  const allWords = texts.flatMap(extractOrderedWords);
  if (allWords.length === 0 || ngramSizes.length === 0) {
    return { perNgram: {}, mean: 0 };
  }

  const perNgram: Record<string, number> = {};

  for (const n of ngramSizes) {
    const freq = new Map<string, number>();
    let total = 0;

    for (let i = 0; i <= allWords.length - n; i++) {
      const ngram = allWords.slice(i, i + n).join(" ");
      freq.set(ngram, (freq.get(ngram) ?? 0) + 1);
      total++;
    }

    const V = freq.size;
    if (total === 0 || V <= 1) {
      perNgram[String(n)] = 0;
      continue;
    }

    let entropy = 0;
    for (const count of freq.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    perNgram[String(n)] = entropy / Math.log2(V);
  }

  const values = Object.values(perNgram);
  const mean =
    values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  return { perNgram, mean };
}
