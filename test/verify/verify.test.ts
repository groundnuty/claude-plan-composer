import { describe, it, expect } from "vitest";
import { parseVerifyResponse } from "../../src/verify/gates.js";
import { buildVerifyPrompt } from "../../src/verify/prompt-builder.js";
import { DEFAULT_VERIFY_MODEL } from "../../src/verify/index.js";
import type { VerifyOptions } from "../../src/verify/index.js";
import type { VerifyResult, VerifyGateResult } from "../../src/types/evaluation.js";

// ---------------------------------------------------------------------------
// DEFAULT_VERIFY_MODEL constant
// ---------------------------------------------------------------------------

describe("DEFAULT_VERIFY_MODEL", () => {
  it("is a non-empty string", () => {
    expect(typeof DEFAULT_VERIFY_MODEL).toBe("string");
    expect(DEFAULT_VERIFY_MODEL.length).toBeGreaterThan(0);
  });

  it("defaults to a sonnet model", () => {
    expect(DEFAULT_VERIFY_MODEL).toMatch(/sonnet/i);
  });
});

// ---------------------------------------------------------------------------
// VerifyOptions type shape
// ---------------------------------------------------------------------------

describe("VerifyOptions interface shape", () => {
  it("accepts an object with optional model string", () => {
    const opts: VerifyOptions = { model: "claude-sonnet-4-6" };
    expect(opts.model).toBe("claude-sonnet-4-6");
  });

  it("accepts an object with optional AbortSignal", () => {
    const controller = new AbortController();
    const opts: VerifyOptions = { signal: controller.signal };
    expect(opts.signal).toBe(controller.signal);
  });

  it("accepts an empty object (all options are optional)", () => {
    const opts: VerifyOptions = {};
    expect(opts.model).toBeUndefined();
    expect(opts.signal).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: buildVerifyPrompt → parseVerifyResponse
// ---------------------------------------------------------------------------

const MOCK_ALL_PASS_JSON = {
  gates: [
    {
      gate: "CONSISTENCY",
      pass: true,
      findings: "No contradictions found. Recommendations are internally consistent.",
    },
    {
      gate: "COMPLETENESS",
      pass: true,
      findings: "All key insights from source plans are represented.",
    },
    {
      gate: "ACTIONABILITY",
      pass: true,
      findings: "Each section has concrete next steps.",
    },
  ],
  report: "All 3 gates passed. The merged plan is high quality.",
};

const MOCK_PARTIAL_FAIL_JSON = {
  gates: [
    { gate: "CONSISTENCY", pass: true, findings: "Consistent." },
    { gate: "COMPLETENESS", pass: false, findings: "Missing risk section from plan-A." },
    { gate: "ACTIONABILITY", pass: true, findings: "Actionable steps present." },
  ],
  report: "2 of 3 gates passed. Completeness needs improvement.",
};

describe("verify pipeline integration — all gates pass", () => {
  it("buildVerifyPrompt produces a non-empty prompt", () => {
    const prompt = buildVerifyPrompt("Merged plan content", [
      { name: "plan-A", content: "Source plan A content" },
      { name: "plan-B", content: "Source plan B content" },
    ]);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain("Merged plan content");
    expect(prompt).toContain("Source plan A content");
    expect(prompt).toContain("Source plan B content");
  });

  it("parseVerifyResponse returns pass=true when all gates pass", () => {
    const result: VerifyResult = parseVerifyResponse(
      JSON.stringify(MOCK_ALL_PASS_JSON),
    );
    expect(result.pass).toBe(true);
    expect(result.gates).toHaveLength(3);
    expect(result.report).toContain("3 gates passed");
  });

  it("gate names are normalised to lowercase", () => {
    const result = parseVerifyResponse(JSON.stringify(MOCK_ALL_PASS_JSON));
    const gateNames = result.gates.map((g: VerifyGateResult) => g.gate);
    expect(gateNames).toEqual(["consistency", "completeness", "actionability"]);
  });

  it("each gate has findings as an array of strings", () => {
    const result = parseVerifyResponse(JSON.stringify(MOCK_ALL_PASS_JSON));
    for (const gate of result.gates) {
      expect(Array.isArray(gate.findings)).toBe(true);
    }
  });
});

describe("verify pipeline integration — partial failure", () => {
  it("parseVerifyResponse returns pass=false when any gate fails", () => {
    const result: VerifyResult = parseVerifyResponse(
      JSON.stringify(MOCK_PARTIAL_FAIL_JSON),
    );
    expect(result.pass).toBe(false);
  });

  it("failed gate has pass=false and non-empty findings", () => {
    const result = parseVerifyResponse(JSON.stringify(MOCK_PARTIAL_FAIL_JSON));
    const completeness = result.gates.find((g: VerifyGateResult) => g.gate === "completeness");
    expect(completeness).toBeDefined();
    expect(completeness?.pass).toBe(false);
    expect(completeness?.findings.length).toBeGreaterThan(0);
  });

  it("passing gates still have pass=true", () => {
    const result = parseVerifyResponse(JSON.stringify(MOCK_PARTIAL_FAIL_JSON));
    const consistency = result.gates.find((g: VerifyGateResult) => g.gate === "consistency");
    expect(consistency?.pass).toBe(true);
  });
});

describe("verify pipeline integration — findings normalisation", () => {
  it("findings provided as array are kept as-is", () => {
    const jsonWithArrayFindings = {
      gates: [
        {
          gate: "consistency",
          pass: false,
          findings: ["Contradiction in section 2", "Conflict in timeline"],
        },
        { gate: "completeness", pass: true, findings: "All complete." },
        { gate: "actionability", pass: true, findings: "Actionable." },
      ],
      report: "1 gate failed.",
    };
    const result = parseVerifyResponse(JSON.stringify(jsonWithArrayFindings));
    const consistency = result.gates.find((g: VerifyGateResult) => g.gate === "consistency");
    expect(consistency?.findings).toEqual(["Contradiction in section 2", "Conflict in timeline"]);
  });

  it("findings provided as string are wrapped in array", () => {
    const result = parseVerifyResponse(JSON.stringify(MOCK_ALL_PASS_JSON));
    for (const gate of result.gates) {
      expect(Array.isArray(gate.findings)).toBe(true);
    }
  });
});

describe("verify pipeline integration — markdown fenced JSON", () => {
  it("parses JSON wrapped in markdown code fences", () => {
    const fenced = `\`\`\`json\n${JSON.stringify(MOCK_ALL_PASS_JSON)}\n\`\`\``;
    const result = parseVerifyResponse(fenced);
    expect(result.pass).toBe(true);
    expect(result.gates).toHaveLength(3);
  });
});
