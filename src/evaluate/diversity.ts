import type { Plan } from "../types/plan.js";
import type { DiversityResult } from "../types/diversity.js";
import { computePairwiseJaccard } from "./jaccard.js";
import {
  computeShannonEntropy,
  computeNormalizedEntropy,
} from "./entropy.js";

/**
 * Measure diversity of generated plan variants.
 *
 * Computes a composite score from heading-level Jaccard distance
 * and normalized Shannon entropy. Pure computation — no side effects.
 *
 * @param plans - Generated plan variants
 * @param threshold - Composite score below which a warning is emitted
 * @returns DiversityResult with scores and optional warning
 */
export function measureDiversity(
  plans: readonly Plan[],
  threshold: number,
): DiversityResult {
  if (plans.length < 2) {
    return {
      jaccardDistance: 0,
      shannonEntropy: { perNgram: {}, mean: 0 },
      normalizedEntropy: 0,
      compositeScore: 0,
      warning:
        "Cannot measure diversity with fewer than 2 plans",
    };
  }

  // Heading-level Jaccard: 1 - similarity = distance
  // When all heading sets are empty, Jaccard similarity is 0 by convention
  // (no union), but distance should also be 0 (no structural difference).
  const jaccard = computePairwiseJaccard(plans);
  const hasAnyHeadings = jaccard.pairs.some((p) => p.similarity > 0) ||
    plans.some((p) => /^## /m.test(p.content));
  const jaccardDistance = hasAnyHeadings ? 1 - jaccard.mean : 0;

  // Raw Shannon entropy (backward compat with eval baselines)
  const contents = plans.map((p) => p.content);
  const shannonEntropy = computeShannonEntropy(contents);

  // Normalized entropy → [0, 1]
  const normalized = computeNormalizedEntropy(contents);
  const normalizedEntropy = normalized.mean;

  // Composite: equal-weight mean of two complementary signals
  const compositeScore = (jaccardDistance + normalizedEntropy) / 2;

  const warning =
    compositeScore < threshold
      ? `Low diversity detected (score: ${compositeScore.toFixed(2)}, threshold: ${threshold}). Consider adjusting lenses or variant guidance.`
      : undefined;

  return {
    jaccardDistance,
    shannonEntropy: {
      perNgram: shannonEntropy.perNgram,
      mean: shannonEntropy.mean,
    },
    normalizedEntropy,
    compositeScore,
    ...(warning !== undefined ? { warning } : {}),
  };
}
