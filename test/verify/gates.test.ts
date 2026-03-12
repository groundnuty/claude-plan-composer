import { describe, it, expect } from "vitest";
import { parseVerifyResponse } from "../../src/verify/gates.js";
import type { VerifyResult } from "../../src/types/evaluation.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A valid payload where every gate passes */
const allPassPayload = {
  gates: [
    {
      gate: "consistency",
      pass: true,
      findings: ["No contradictions found."],
    },
    {
      gate: "completeness",
      pass: true,
      findings: ["All source content represented."],
    },
    {
      gate: "actionability",
      pass: true,
      findings: ["Each section has concrete next steps."],
    },
  ],
  report: "All 3 gates passed. Merged plan is high quality.",
};

/** A valid payload where one gate fails */
const mixedPayload = {
  gates: [
    {
      gate: "consistency",
      pass: true,
      findings: ["No internal contradictions."],
    },
    {
      gate: "completeness",
      pass: false,
      findings: ["Section 3 dropped key risk from beta plan."],
    },
    {
      gate: "actionability",
      pass: true,
      findings: ["Steps are concrete."],
    },
  ],
  report: "2 of 3 gates passed. Completeness gate failed.",
};

/** A valid payload using uppercase gate names (as LLM would output from prompt) */
const uppercaseGatesPayload = {
  gates: [
    { gate: "CONSISTENCY", pass: true, findings: ["OK"] },
    { gate: "COMPLETENESS", pass: true, findings: ["OK"] },
    { gate: "ACTIONABILITY", pass: true, findings: ["OK"] },
  ],
  report: "All passed.",
};

// ---------------------------------------------------------------------------
// parseVerifyResponse — basic parsing
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — mixed pass/fail gates", () => {
  it("parses valid verification JSON with mixed pass/fail gates", () => {
    const text = JSON.stringify(mixedPayload);
    const result: VerifyResult = parseVerifyResponse(text);
    expect(result.gates).toHaveLength(3);
    expect(result.report).toBe(
      "2 of 3 gates passed. Completeness gate failed.",
    );
  });

  it("returns gate entries with correct pass values", () => {
    const text = JSON.stringify(mixedPayload);
    const result = parseVerifyResponse(text);
    const consistency = result.gates.find((g) => g.gate === "consistency");
    const completeness = result.gates.find((g) => g.gate === "completeness");
    const actionability = result.gates.find((g) => g.gate === "actionability");
    expect(consistency?.pass).toBe(true);
    expect(completeness?.pass).toBe(false);
    expect(actionability?.pass).toBe(true);
  });

  it("returns findings as an array", () => {
    const text = JSON.stringify(mixedPayload);
    const result = parseVerifyResponse(text);
    const completeness = result.gates.find((g) => g.gate === "completeness");
    expect(Array.isArray(completeness?.findings)).toBe(true);
    expect(completeness?.findings[0]).toBe(
      "Section 3 dropped key risk from beta plan.",
    );
  });
});

// ---------------------------------------------------------------------------
// parseVerifyResponse — overall pass computation
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — overall pass computation", () => {
  it("overall pass is true when all gates pass", () => {
    const text = JSON.stringify(allPassPayload);
    const result = parseVerifyResponse(text);
    expect(result.pass).toBe(true);
  });

  it("overall pass is false when any gate fails", () => {
    const text = JSON.stringify(mixedPayload);
    const result = parseVerifyResponse(text);
    expect(result.pass).toBe(false);
  });

  it("overall pass is false when multiple gates fail", () => {
    const allFail = {
      gates: [
        {
          gate: "consistency",
          pass: false,
          findings: ["Contradictions found."],
        },
        { gate: "completeness", pass: false, findings: ["Content missing."] },
        { gate: "actionability", pass: true, findings: ["Steps present."] },
      ],
      report: "2 gates failed.",
    };
    const result = parseVerifyResponse(JSON.stringify(allFail));
    expect(result.pass).toBe(false);
  });

  it("ignores any pass field in the raw JSON and recomputes from gates", () => {
    // Even if the LLM incorrectly marks pass=true while a gate fails,
    // our parser should recompute from the gates array.
    const lying = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: false, findings: ["Missing content"] },
        { gate: "actionability", pass: true, findings: [] },
      ],
      pass: true, // incorrect — should be overridden
      report: "Claimed all good.",
    };
    const result = parseVerifyResponse(JSON.stringify(lying));
    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseVerifyResponse — markdown code fence extraction
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — markdown code fence extraction", () => {
  it("extracts JSON from ```json ... ``` fences", () => {
    const json = JSON.stringify(allPassPayload);
    const text = `Here is the verification result:\n\`\`\`json\n${json}\n\`\`\`\nEnd of response.`;
    const result = parseVerifyResponse(text);
    expect(result.gates).toHaveLength(3);
    expect(result.pass).toBe(true);
  });

  it("extracts JSON from plain ``` fences", () => {
    const json = JSON.stringify(mixedPayload);
    const text = `\`\`\`\n${json}\n\`\`\``;
    const result = parseVerifyResponse(text);
    expect(result.pass).toBe(false);
    expect(result.report).toBe(
      "2 of 3 gates passed. Completeness gate failed.",
    );
  });

  it("falls back to raw brace extraction when no fences present", () => {
    const json = JSON.stringify(allPassPayload);
    const text = `Some preamble. ${json} Some trailing text.`;
    const result = parseVerifyResponse(text);
    expect(result.gates).toHaveLength(3);
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseVerifyResponse — gate name normalisation (uppercase from LLM)
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — uppercase gate name normalisation", () => {
  it("normalises uppercase CONSISTENCY to lowercase", () => {
    const text = JSON.stringify(uppercaseGatesPayload);
    const result = parseVerifyResponse(text);
    const gates = result.gates.map((g) => g.gate);
    expect(gates).toContain("consistency");
  });

  it("normalises uppercase COMPLETENESS to lowercase", () => {
    const text = JSON.stringify(uppercaseGatesPayload);
    const result = parseVerifyResponse(text);
    const gates = result.gates.map((g) => g.gate);
    expect(gates).toContain("completeness");
  });

  it("normalises uppercase ACTIONABILITY to lowercase", () => {
    const text = JSON.stringify(uppercaseGatesPayload);
    const result = parseVerifyResponse(text);
    const gates = result.gates.map((g) => g.gate);
    expect(gates).toContain("actionability");
  });
});

// ---------------------------------------------------------------------------
// parseVerifyResponse — findings format normalisation
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — findings format normalisation", () => {
  it("wraps a string findings value in an array", () => {
    const stringFindings = {
      gates: [
        { gate: "consistency", pass: true, findings: "No issues found." },
        { gate: "completeness", pass: true, findings: "All content present." },
        { gate: "actionability", pass: true, findings: "Steps are clear." },
      ],
      report: "All good.",
    };
    const result = parseVerifyResponse(JSON.stringify(stringFindings));
    expect(Array.isArray(result.gates[0].findings)).toBe(true);
    expect(result.gates[0].findings[0]).toBe("No issues found.");
  });

  it("keeps an empty array findings as-is", () => {
    const emptyFindings = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: true, findings: [] },
        { gate: "actionability", pass: true, findings: [] },
      ],
      report: "All good.",
    };
    const result = parseVerifyResponse(JSON.stringify(emptyFindings));
    expect(result.gates[0].findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseVerifyResponse — factual accuracy gate (Gate 4)
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — factual accuracy gate", () => {
  it("parses FACTUAL_ACCURACY gate name", () => {
    const payload = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: true, findings: [] },
        { gate: "actionability", pass: true, findings: [] },
        {
          gate: "FACTUAL_ACCURACY",
          pass: true,
          findings: "All citations verified.",
        },
      ],
      report: "4/4 gates passed.",
    };
    const result = parseVerifyResponse(JSON.stringify(payload));
    expect(result.gates).toHaveLength(4);
    const fa = result.gates.find((g) => g.gate === "factual_accuracy");
    expect(fa).toBeDefined();
    expect(fa!.pass).toBe(true);
  });

  it("overall pass is false when factual_accuracy fails", () => {
    const payload = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: true, findings: [] },
        { gate: "actionability", pass: true, findings: [] },
        {
          gate: "factual_accuracy",
          pass: false,
          findings: "Citation X not found.",
        },
      ],
      report: "3/4 gates passed.",
    };
    const result = parseVerifyResponse(JSON.stringify(payload));
    expect(result.pass).toBe(false);
  });

  it("handles 4-gate all-pass correctly", () => {
    const payload = {
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: true, findings: [] },
        { gate: "actionability", pass: true, findings: [] },
        { gate: "factual_accuracy", pass: true, findings: [] },
      ],
      report: "All 4 gates passed.",
    };
    const result = parseVerifyResponse(JSON.stringify(payload));
    expect(result.pass).toBe(true);
    expect(result.gates).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// parseVerifyResponse — error cases
// ---------------------------------------------------------------------------

describe("parseVerifyResponse — error cases", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseVerifyResponse("not json at all")).toThrow();
  });

  it("throws on missing gates field", () => {
    const bad = JSON.stringify({ report: "A report but no gates." });
    expect(() => parseVerifyResponse(bad)).toThrow(
      /missing required field "gates"/i,
    );
  });

  it("throws on missing report field", () => {
    const bad = JSON.stringify({
      gates: [
        { gate: "consistency", pass: true, findings: [] },
        { gate: "completeness", pass: true, findings: [] },
        { gate: "actionability", pass: true, findings: [] },
      ],
    });
    expect(() => parseVerifyResponse(bad)).toThrow(
      /missing required field "report"/i,
    );
  });

  it("throws when gates is not an array", () => {
    const bad = JSON.stringify({ gates: "not-an-array", report: "ok" });
    expect(() => parseVerifyResponse(bad)).toThrow();
  });

  it("throws on a non-object top level (e.g. array)", () => {
    expect(() => parseVerifyResponse("[1, 2, 3]")).toThrow();
  });
});
