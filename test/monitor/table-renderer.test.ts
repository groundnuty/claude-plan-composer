import { describe, it, expect } from "vitest";
import { renderTable, formatTokens } from "../../src/monitor/table-renderer.js";
import type { PipelineState, SessionState } from "../../src/monitor/types.js";

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    name: "plan-01-alpha",
    status: "done",
    sessionId: "sess-abc1",
    turns: 44,
    toolCalls: 35,
    toolBreakdown: { Read: 15, Glob: 8, Bash: 6, Write: 4, WebFetch: 2 },
    agents: { running: 0, total: 0 },
    inputTokens: 180000,
    outputTokens: 42000,
    cacheCreationTokens: 30000,
    cacheReadTokens: 95000,
    totalTokens: 347000,
    contextTokens: 180000,
    contextPercent: 90,
    compactions: 0,
    cost: 1.17,
    durationMs: 95000,
    lastAction: "Write plan-01-alpha.md",
    logSize: 2100000,
    planSize: 34000,
    children: [],
    ...overrides,
  };
}

function makeState(sessions: SessionState[] = []): PipelineState {
  return {
    pid: 12345,
    startedAt: "2026-03-12T12:06:21Z",
    command: "run",
    configPath: "projects/daytrader-t2/config.yaml",
    outputDir: "/tmp/test-run",
    stage: "generating",
    sessions,
  };
}

describe("formatTokens", () => {
  it("formats thousands as K", () => {
    expect(formatTokens(180000)).toBe("180K");
  });

  it("formats millions as M", () => {
    expect(formatTokens(1500000)).toBe("1.5M");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokens(500)).toBe("500");
  });

  it("returns dash for zero", () => {
    expect(formatTokens(0)).toBe("—");
  });
});

describe("renderTable", () => {
  it("renders header with config name and PID", () => {
    const output = renderTable(makeState(), {});
    expect(output).toContain("daytrader-t2");
    expect(output).toContain("12345");
  });

  it("renders session rows", () => {
    const state = makeState([makeSession()]);
    const output = renderTable(state, {});
    expect(output).toContain("plan-01-alpha");
    expect(output).toContain("44");
    expect(output).toContain("35");
  });

  it("renders detail rows with tool breakdown", () => {
    const state = makeState([makeSession()]);
    const output = renderTable(state, {});
    expect(output).toContain("Read(15)");
    expect(output).toContain("Glob(8)");
  });

  it("renders totals footer", () => {
    const state = makeState([
      makeSession(),
      makeSession({ name: "plan-02-beta" }),
    ]);
    const output = renderTable(state, {});
    expect(output).toContain("stages done");
    expect(output).toContain("2 done");
  });

  it("renders child rows with tree characters", () => {
    const state = makeState([
      makeSession({
        name: "merge-agent-teams",
        status: "running",
        children: [
          {
            type: "team-member",
            name: "reliability",
            taskId: null,
            status: "running",
            turns: 8,
            toolCalls: 3,
            toolBreakdown: { Read: 2, Glob: 1 },
            inputTokens: 30000,
            outputTokens: 8000,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            totalTokens: 38000,
            lastAction: "Read OrderService.java",
          },
        ],
      }),
    ]);
    const output = renderTable(state, {});
    expect(output).toContain("reliability");
    expect(output).toContain("\u2514");
  });

  it("strips ANSI when noColor is set", () => {
    const state = makeState([makeSession()]);
    const output = renderTable(state, { noColor: true });
    expect(output).not.toMatch(/\x1b\[/);
  });
});
