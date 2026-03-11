import type {
  DimensionScore,
  PlanScore,
  EvalResult,
  Gap,
} from "../types/evaluation.js";

// ---------------------------------------------------------------------------
// Internal type
// ---------------------------------------------------------------------------

interface RawEvalResponse {
  readonly planScores: readonly PlanScore[];
  readonly gaps: readonly Gap[];
  readonly convergence: number;
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// parseEvalResponse
// ---------------------------------------------------------------------------

/** Extract JSON text from markdown code fences or raw brace matching */
function extractJsonText(text: string): string {
  // Try ```json ... ``` or ``` ... ``` fences first
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }

  // Fall back: find the first `{` and matching closing `}`
  const start = text.indexOf("{");
  if (start === -1) {
    throw new Error("parseEvalResponse: no JSON object found in text");
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  throw new Error("parseEvalResponse: unmatched braces in text");
}

/**
 * Parse LLM response text into structured evaluation data.
 * Extracts JSON from markdown code fences if present, otherwise
 * finds a raw `{...}` block in the text.
 *
 * @throws if JSON is invalid or required fields are missing
 */
export function parseEvalResponse(text: string): RawEvalResponse {
  const jsonText = extractJsonText(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`parseEvalResponse: invalid JSON — ${String(err)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("parseEvalResponse: expected a JSON object at top level");
  }

  const obj = parsed as Record<string, unknown>;

  const requiredFields = [
    "planScores",
    "gaps",
    "convergence",
    "summary",
  ] as const;
  for (const field of requiredFields) {
    if (!(field in obj)) {
      throw new Error(`parseEvalResponse: missing required field "${field}"`);
    }
  }

  return {
    planScores: obj["planScores"] as readonly PlanScore[],
    gaps: obj["gaps"] as readonly Gap[],
    convergence: obj["convergence"] as number,
    summary: obj["summary"] as string,
  };
}

// ---------------------------------------------------------------------------
// aggregateScores helpers
// ---------------------------------------------------------------------------

/** Collect all raw DimensionScore values for a given dimension name */
function collectDimScores(
  planScores: readonly PlanScore[],
  dimension: string,
): readonly DimensionScore[] {
  return planScores.flatMap((ps) =>
    ps.dimensions.filter((d) => d.dimension === dimension),
  );
}

/** Determine whether scores are binary (pass field) or likert (score field) */
function isBinary(scores: readonly DimensionScore[]): boolean {
  return scores.some((s) => "pass" in s);
}

/** Compute the median of a sorted array of numbers */
function computeMedian(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  // Even count: average of the two middle values
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Aggregate a set of DimensionScores with the given consensus method */
function aggregateDimension(
  dimension: string,
  scores: readonly DimensionScore[],
  consensus: "median" | "majority" | "min",
): DimensionScore {
  // Synthesize a combined critique from all scores
  const critique = scores
    .map((s) => s.critique)
    .filter(Boolean)
    .join(" | ");

  if (isBinary(scores)) {
    const passCount = scores.filter((s) => s.pass === true).length;

    let pass: boolean;
    if (consensus === "min") {
      // All must pass
      pass = passCount === scores.length;
    } else {
      // majority or median: >50% pass
      pass = passCount / scores.length > 0.5;
    }

    return { dimension, pass, critique };
  }

  // Likert path
  const values = scores
    .map((s) => s.score)
    .filter((v): v is number => typeof v === "number");

  const sorted = [...values].sort((a, b) => a - b);

  let score: number;
  if (consensus === "median") {
    score = computeMedian(sorted);
  } else if (consensus === "min") {
    score = sorted[0]!;
  } else {
    // majority: mean rounded
    const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
    score = Math.round(mean);
  }

  return { dimension, score, critique };
}

// ---------------------------------------------------------------------------
// aggregateScores
// ---------------------------------------------------------------------------

/**
 * Aggregate per-plan dimension scores into a single cross-plan score
 * per dimension using the specified consensus method.
 *
 * Binary consensus:
 *   - majority: >50% of plans pass
 *   - min:      all plans must pass
 *   - median:   treated as majority (>50%)
 *
 * Likert consensus:
 *   - median:   middle value of sorted scores (average for even count)
 *   - min:      lowest value
 *   - majority: mean rounded to nearest integer
 */
export function aggregateScores(
  planScores: readonly PlanScore[],
  consensus: "median" | "majority" | "min",
): readonly DimensionScore[] {
  // Collect unique dimension names preserving insertion order
  const seen = new Set<string>();
  const dimensions: string[] = [];
  for (const ps of planScores) {
    for (const d of ps.dimensions) {
      if (!seen.has(d.dimension)) {
        seen.add(d.dimension);
        dimensions.push(d.dimension);
      }
    }
  }

  return dimensions.map((dim) => {
    const scores = collectDimScores(planScores, dim);
    return aggregateDimension(dim, scores, consensus);
  });
}

// ---------------------------------------------------------------------------
// buildEvalResult
// ---------------------------------------------------------------------------

/**
 * Combine a raw eval response with aggregated cross-plan scores
 * into the final EvalResult structure.
 */
export function buildEvalResult(
  response: RawEvalResponse,
  consensus: "median" | "majority" | "min",
): EvalResult {
  const scores = aggregateScores(response.planScores, consensus);

  return {
    scores,
    summary: response.summary,
    planScores: response.planScores,
    gaps: response.gaps,
    convergence: response.convergence,
  };
}
