import type { VerifyGateResult, VerifyResult } from "../types/evaluation.js";

// ---------------------------------------------------------------------------
// Valid gate names
// ---------------------------------------------------------------------------

const VALID_GATES = ["consistency", "completeness", "actionability"] as const;
type GateName = (typeof VALID_GATES)[number];

// ---------------------------------------------------------------------------
// Internal raw type
// ---------------------------------------------------------------------------

interface RawGate {
  readonly gate: unknown;
  readonly pass: unknown;
  readonly findings: unknown;
}

interface RawVerifyResponse {
  readonly gates: readonly RawGate[];
  readonly report: string;
}

// ---------------------------------------------------------------------------
// JSON extraction helpers
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
    throw new Error("parseVerifyResponse: no JSON object found in text");
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

  throw new Error("parseVerifyResponse: unmatched braces in text");
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Normalise a gate name to lowercase and validate it is one of the 3 known gates */
function normaliseGateName(raw: unknown): GateName {
  if (typeof raw !== "string") {
    throw new Error(
      `parseVerifyResponse: gate name must be a string, got ${typeof raw}`,
    );
  }
  const lower = raw.toLowerCase();
  if (!VALID_GATES.includes(lower as GateName)) {
    throw new Error(
      `parseVerifyResponse: unknown gate name "${raw}"; expected one of ${VALID_GATES.join(", ")}`,
    );
  }
  return lower as GateName;
}

/**
 * Normalise the `findings` field: accept either a string (wraps in array)
 * or an array of strings.
 */
function normaliseFindings(raw: unknown): readonly string[] {
  if (typeof raw === "string") {
    return [raw];
  }
  if (Array.isArray(raw)) {
    return raw as readonly string[];
  }
  throw new Error(
    `parseVerifyResponse: "findings" must be a string or array, got ${typeof raw}`,
  );
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

/** Parse and validate the top-level raw object */
function parseRawResponse(obj: Record<string, unknown>): RawVerifyResponse {
  if (!("gates" in obj)) {
    throw new Error('parseVerifyResponse: missing required field "gates"');
  }
  if (!("report" in obj)) {
    throw new Error('parseVerifyResponse: missing required field "report"');
  }

  if (!Array.isArray(obj["gates"])) {
    throw new Error('parseVerifyResponse: "gates" must be an array');
  }

  return {
    gates: obj["gates"] as readonly RawGate[],
    report: obj["report"] as string,
  };
}

/** Convert raw gate entries to typed VerifyGateResult values */
function buildGateResults(
  rawGates: readonly RawGate[],
): readonly VerifyGateResult[] {
  return rawGates.map((raw, idx) => {
    const gate = normaliseGateName(raw.gate);

    if (typeof raw.pass !== "boolean") {
      throw new Error(
        `parseVerifyResponse: gates[${idx}].pass must be a boolean, got ${typeof raw.pass}`,
      );
    }

    const findings = normaliseFindings(raw.findings);

    return { gate, pass: raw.pass, findings };
  });
}

// ---------------------------------------------------------------------------
// parseVerifyResponse (public API)
// ---------------------------------------------------------------------------

/**
 * Parse LLM response text into a structured VerifyResult.
 *
 * - Extracts JSON from markdown code fences when present.
 * - Falls back to raw `{...}` brace matching.
 * - Normalises gate names to lowercase.
 * - Normalises `findings` to `string[]` regardless of whether the LLM
 *   returned a string or an array.
 * - Computes the overall `pass` by checking that every gate passes
 *   (ignores any `pass` field in the raw JSON).
 *
 * @throws if JSON is invalid, missing required fields, or fields have unexpected types.
 */
export function parseVerifyResponse(text: string): VerifyResult {
  const jsonText = extractJsonText(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`parseVerifyResponse: invalid JSON — ${String(err)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("parseVerifyResponse: expected a JSON object at top level");
  }

  const obj = parsed as Record<string, unknown>;
  const raw = parseRawResponse(obj);
  const gates = buildGateResults(raw.gates);

  // Overall pass is true only when ALL gates pass
  const pass = gates.every((g) => g.pass);

  return { gates, pass, report: raw.report };
}
