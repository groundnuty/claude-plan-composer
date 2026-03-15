import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseNdjsonLog } from "../../src/monitor/ndjson-parser.js";

const TMPDIR = process.env["TMPDIR"] ?? os.tmpdir();

describe("parseNdjsonLog", () => {
  let tmpFile: string;

  afterEach(async () => {
    if (tmpFile) await fs.rm(tmpFile, { force: true });
  });

  it("counts turns from assistant messages", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "bye" }],
          usage: { input_tokens: 200, output_tokens: 60 },
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        num_turns: 2,
        total_cost_usd: 0.05,
        session_id: "s1",
      }),
    ];
    await fs.writeFile(tmpFile, lines.join("\n") + "\n");

    const result = await parseNdjsonLog(tmpFile);
    expect(result.turns).toBe(2);
    expect(result.cost).toBe(0.05);
    expect(result.sessionId).toBe("s1");
  });

  it("counts tool calls and builds breakdown", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", name: "Read", input: {} },
            { type: "tool_use", name: "Glob", input: {} },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: {} }],
          usage: { input_tokens: 200, output_tokens: 60 },
        },
      }),
    ];
    await fs.writeFile(tmpFile, lines.join("\n") + "\n");

    const result = await parseNdjsonLog(tmpFile);
    expect(result.toolCalls).toBe(3);
    expect(result.toolBreakdown).toEqual({ Read: 2, Glob: 1 });
  });

  it("tracks last action from last tool_use", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    const lines = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/out/plan.md" },
            },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ];
    await fs.writeFile(tmpFile, lines.join("\n") + "\n");

    const result = await parseNdjsonLog(tmpFile);
    expect(result.lastAction).toBe("Write");
  });

  it("counts compactions from system compact_boundary", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    const lines = [
      JSON.stringify({ type: "system", subtype: "compact_boundary" }),
      JSON.stringify({ type: "system", subtype: "compact_boundary" }),
    ];
    await fs.writeFile(tmpFile, lines.join("\n") + "\n");

    const result = await parseNdjsonLog(tmpFile);
    expect(result.compactions).toBe(2);
  });

  it("returns zero values for empty file", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    await fs.writeFile(tmpFile, "");

    const result = await parseNdjsonLog(tmpFile);
    expect(result.turns).toBe(0);
    expect(result.toolCalls).toBe(0);
  });

  it("parses synthetic phase events", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    const lines = [
      JSON.stringify({ type: "phase", name: "generating", ordinal: 0 }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "hi" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
    ];
    await fs.writeFile(tmpFile, lines.join("\n") + "\n");

    const result = await parseNdjsonLog(tmpFile);
    expect(result.phaseName).toBe("generating");
    expect(result.phaseOrdinal).toBe(0);
  });
});
