import { describe, it, expect, beforeEach } from "vitest";
import { StatusCollector } from "../../src/monitor/status-collector.js";

// Helper: build a mock SDK assistant message with tool_use blocks
function mockAssistantWithTools(
  tools: Array<{ name: string; input?: Record<string, unknown> }>,
): unknown {
  return {
    type: "assistant",
    message: {
      content: tools.map((t) => ({
        type: "tool_use",
        name: t.name,
        input: t.input ?? {},
      })),
      usage: { input_tokens: 1000, output_tokens: 200 },
    },
  };
}

function mockAssistantText(): unknown {
  return {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Some analysis..." }],
      usage: { input_tokens: 500, output_tokens: 100 },
    },
  };
}

function mockResultSuccess(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "result",
    subtype: "success",
    num_turns: 10,
    total_cost_usd: 1.23,
    session_id: "sess-abc123",
    duration_ms: 5000,
    modelUsage: {
      "claude-opus-4-6": {
        inputTokens: 50000,
        outputTokens: 12000,
        cacheReadInputTokens: 8000,
        cacheCreationInputTokens: 3000,
        costUSD: 1.23,
      },
    },
    ...overrides,
  };
}

function mockCompactBoundary(): unknown {
  return { type: "system", subtype: "compact_boundary" };
}

function mockTaskStarted(taskId: string, description: string): unknown {
  return { type: "task_started", task_id: taskId, description };
}

function mockTaskCompleted(taskId: string): unknown {
  return {
    type: "task_notification",
    task_id: taskId,
    status: "completed",
    summary: "Done",
    usage: { inputTokens: 5000, outputTokens: 1000 },
  };
}

describe("StatusCollector", () => {
  let collector: StatusCollector;

  beforeEach(() => {
    collector = new StatusCollector({
      pid: 12345,
      command: "run",
      configPath: "projects/test/config.yaml",
      outputDir: "/tmp/test-run",
    });
  });

  describe("session registration", () => {
    it("registers a new session as running with current phase", () => {
      collector.setStage("generating");
      collector.registerSession("plan-01-alpha");
      const state = collector.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]!.name).toBe("plan-01-alpha");
      expect(state.sessions[0]!.status).toBe("running");
      expect(state.sessions[0]!.phaseName).toBe("generating");
      expect(state.sessions[0]!.phaseOrdinal).toBe(0);
    });

    it("registers multiple sessions", () => {
      collector.registerSession("plan-01-alpha");
      collector.registerSession("plan-02-beta");
      const state = collector.getState();
      expect(state.sessions).toHaveLength(2);
    });
  });

  describe("onMessage — assistant with tools", () => {
    it("increments turns and tool counts", () => {
      collector.registerSession("s1");
      collector.onMessage(
        "s1",
        mockAssistantWithTools([
          { name: "Read", input: { file_path: "/src/foo.ts" } },
          { name: "Glob", input: { pattern: "**/*.ts" } },
        ]),
      );

      const session = collector.getState().sessions[0]!;
      expect(session.turns).toBe(1);
      expect(session.toolCalls).toBe(2);
      expect(session.toolBreakdown).toEqual({ Read: 1, Glob: 1 });
      expect(session.lastAction).toBe("Glob");
    });

    it("accumulates tool counts across messages", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockAssistantWithTools([{ name: "Read" }]));
      collector.onMessage(
        "s1",
        mockAssistantWithTools([{ name: "Read" }, { name: "Write" }]),
      );

      const session = collector.getState().sessions[0]!;
      expect(session.turns).toBe(2);
      expect(session.toolCalls).toBe(3);
      expect(session.toolBreakdown).toEqual({ Read: 2, Write: 1 });
    });
  });

  describe("onMessage — assistant text only", () => {
    it("increments turns but not tool counts", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockAssistantText());

      const session = collector.getState().sessions[0]!;
      expect(session.turns).toBe(1);
      expect(session.toolCalls).toBe(0);
    });
  });

  describe("onMessage — tokens", () => {
    it("tracks input tokens as context size", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockAssistantText());

      const session = collector.getState().sessions[0]!;
      expect(session.inputTokens).toBe(500);
      expect(session.outputTokens).toBe(100);
      expect(session.contextTokens).toBe(500);
    });

    it("accumulates tokens across messages", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockAssistantText());
      collector.onMessage("s1", mockAssistantWithTools([{ name: "Read" }]));

      const session = collector.getState().sessions[0]!;
      expect(session.inputTokens).toBe(1500);
      expect(session.outputTokens).toBe(300);
      expect(session.contextTokens).toBe(1000);
    });
  });

  describe("onMessage — result", () => {
    it("marks session as done and extracts final metadata", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockResultSuccess());

      const session = collector.getState().sessions[0]!;
      expect(session.status).toBe("done");
      expect(session.cost).toBe(1.23);
      expect(session.sessionId).toBe("sess-abc123");
    });

    it("marks session as failed on error result", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", { type: "result", subtype: "error" });

      const session = collector.getState().sessions[0]!;
      expect(session.status).toBe("failed");
    });
  });

  describe("onMessage — compaction", () => {
    it("increments compaction count", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockCompactBoundary());

      const session = collector.getState().sessions[0]!;
      expect(session.compactions).toBe(1);
    });
  });

  describe("onMessage — task events (subagent children)", () => {
    it("adds child on task_started", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockTaskStarted("t1", "Reliability advocate"));

      const session = collector.getState().sessions[0]!;
      expect(session.children).toHaveLength(1);
      expect(session.children[0]!.name).toBe("Reliability advocate");
      expect(session.children[0]!.taskId).toBe("t1");
      expect(session.children[0]!.status).toBe("running");
    });

    it("updates child on task_notification completed", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockTaskStarted("t1", "Advocate"));
      collector.onMessage("s1", mockTaskCompleted("t1"));

      const child = collector.getState().sessions[0]!.children[0]!;
      expect(child.status).toBe("done");
    });
  });

  describe("onMessage — TeamCreate/SendMessage (agent-teams children)", () => {
    it("adds team members on TeamCreate tool_use", () => {
      collector.registerSession("s1");
      collector.onMessage(
        "s1",
        mockAssistantWithTools([
          {
            name: "TeamCreate",
            input: {
              members: [
                { name: "reliability-advocate" },
                { name: "security-advocate" },
              ],
            },
          },
        ]),
      );

      const session = collector.getState().sessions[0]!;
      expect(session.children).toHaveLength(2);
      expect(session.children[0]!.type).toBe("team-member");
      expect(session.children[0]!.name).toBe("reliability-advocate");
      expect(session.children[0]!.taskId).toBeNull();
    });

    it("tracks SendMessage activity on team members", () => {
      collector.registerSession("s1");
      collector.onMessage(
        "s1",
        mockAssistantWithTools([
          {
            name: "TeamCreate",
            input: { members: [{ name: "advocate-1" }] },
          },
        ]),
      );
      collector.onMessage(
        "s1",
        mockAssistantWithTools([
          {
            name: "SendMessage",
            input: { to: "advocate-1", message: "Present your case" },
          },
        ]),
      );

      const child = collector.getState().sessions[0]!.children[0]!;
      expect(child.turns).toBe(1);
    });
  });

  describe("stage management", () => {
    it("starts with stage from constructor", () => {
      const state = collector.getState();
      expect(state.stage).toBe("idle");
    });

    it("updates stage", () => {
      collector.setStage("generating");
      expect(collector.getState().stage).toBe("generating");
    });

    it("increments phase ordinal on each setStage call", () => {
      collector.setStage("generating");
      collector.registerSession("s1");
      collector.setStage("evaluating");
      collector.registerSession("s2");
      collector.setStage("merging");
      collector.registerSession("s3");

      const sessions = collector.getState().sessions;
      expect(sessions[0]!.phaseName).toBe("generating");
      expect(sessions[0]!.phaseOrdinal).toBe(0);
      expect(sessions[1]!.phaseName).toBe("evaluating");
      expect(sessions[1]!.phaseOrdinal).toBe(1);
      expect(sessions[2]!.phaseName).toBe("merging");
      expect(sessions[2]!.phaseOrdinal).toBe(2);
    });
  });

  describe("completeSession", () => {
    it("marks session as done", () => {
      collector.registerSession("s1");
      collector.completeSession("s1", "done");
      expect(collector.getState().sessions[0]!.status).toBe("done");
    });

    it("marks session as failed", () => {
      collector.registerSession("s1");
      collector.completeSession("s1", "failed");
      expect(collector.getState().sessions[0]!.status).toBe("failed");
    });
  });

  describe("createCallback", () => {
    it("exposes currentPhase with up-to-date stage info", () => {
      const cb = collector.createCallback();
      collector.setStage("generating");
      expect(cb.currentPhase?.()).toEqual({ name: "generating", ordinal: 0 });

      collector.setStage("merging");
      expect(cb.currentPhase?.()).toEqual({ name: "merging", ordinal: 1 });
    });
  });

  describe("getState immutability", () => {
    it("returns a new object on each call", () => {
      const s1 = collector.getState();
      const s2 = collector.getState();
      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2);
    });
  });
});
