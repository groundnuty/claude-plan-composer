# `cpc monitor` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live pipeline monitoring via HTTP-over-Unix-socket status server and `cpc monitor` CLI command, matching bash `monitor-sessions.sh --summary` data richness.

**Architecture:** Pipeline commands start an HTTP server on a Unix domain socket (`os.tmpdir()/cpc-<pid>.sock`). Each `query()` loop feeds SDK events to a `StatusCollector` that updates in-memory state. `cpc monitor` discovers running pipelines via socket glob, connects, polls `/status`, and renders a colored summary table.

**Tech Stack:** Node.js `http` (built-in), `os.tmpdir()`, Agent SDK `query()` event stream, Commander CLI, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-12-cpc-monitor-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/monitor/types.ts` | `PipelineState`, `SessionState`, `ChildState`, `AgentCount` interfaces |
| `src/monitor/status-collector.ts` | `StatusCollector` class — SDK event → in-memory state update |
| `src/monitor/status-server.ts` | HTTP server on Unix socket, `GET /status` endpoint |
| `src/monitor/process-discovery.ts` | Find `cpc-*.sock` files, verify PID alive, fetch `/status` |
| `src/monitor/ndjson-parser.ts` | Parse `.log` files for post-hoc mode |
| `src/monitor/table-renderer.ts` | Format summary table with ANSI colors, detail rows, children |
| `src/monitor/monitor.ts` | Poll loop orchestrator (live socket or post-hoc directory) |
| `src/cli/monitor.ts` | Commander subcommand definition |
| `test/monitor/status-collector.test.ts` | StatusCollector unit tests |
| `test/monitor/ndjson-parser.test.ts` | NDJSON parser unit tests |
| `test/monitor/table-renderer.test.ts` | Table renderer unit tests |
| `test/monitor/process-discovery.test.ts` | Process discovery unit tests |
| `test/monitor/status-server.test.ts` | HTTP server integration tests |

### Modified files

| File | Change |
|------|--------|
| `src/pipeline/logger.ts` | Add `bytesWritten` getter |
| `src/merge/strategy.ts` | Add optional `onStatusMessage` to `MergeStrategy.merge()` |
| `src/merge/index.ts` | Thread `onStatusMessage` to strategy |
| `src/merge/strategies/simple.ts` | Call `onStatusMessage?.()` in `for await` loop |
| `src/merge/strategies/agent-teams.ts` | Call `onStatusMessage?.()` in `for await` loop |
| `src/merge/strategies/subagent-debate.ts` | Call `onStatusMessage?.()` in `for await` loop |
| `src/generate/session-runner.ts` | Add optional `onStatusMessage` callback param |
| `src/generate/index.ts` | Thread `onStatusMessage` to session runner |
| `src/evaluate/index.ts` | Add optional `onStatusMessage` callback param |
| `src/verify/index.ts` | Add optional `onStatusMessage` callback param |
| `src/verify/pre-mortem.ts` | Add optional `onStatusMessage` callback param |
| `src/cli/index.ts` | Import and register monitor subcommand, start/stop status server |

---

## Chunk 1: Core Types and StatusCollector

### Task 1: Monitor type definitions

**Files:**
- Create: `src/monitor/types.ts`
- Test: `test/monitor/status-collector.test.ts` (type import test)

- [ ] **Step 1: Write the type definitions file**

```typescript
// src/monitor/types.ts

/** Callback signature for status message forwarding */
export type OnStatusMessage = (sessionName: string, msg: unknown) => void;

export interface AgentCount {
  readonly running: number;
  readonly total: number;
}

export interface ChildState {
  readonly type: "task" | "team-member";
  readonly name: string;
  readonly taskId: string | null;
  readonly status: "pending" | "running" | "done" | "failed";
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Readonly<Record<string, number>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
  readonly lastAction: string;
}

export interface SessionState {
  readonly name: string;
  readonly status: "pending" | "running" | "done" | "failed";
  readonly sessionId: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Readonly<Record<string, number>>;
  readonly agents: AgentCount;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
  readonly contextTokens: number;
  readonly contextPercent: number;
  readonly compactions: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly lastAction: string;
  readonly logSize: number;
  readonly planSize: number;
  readonly children: readonly ChildState[];
}

export interface PipelineState {
  readonly pid: number;
  readonly startedAt: string;
  readonly command: string;
  readonly configPath: string;
  readonly outputDir: string;
  readonly stage: string;
  readonly sessions: readonly SessionState[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `make -f dev.mk build`
Expected: PASS (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/monitor/types.ts
git commit -m "feat(monitor): add pipeline state type definitions"
```

---

### Task 2: StatusCollector — SDK event to state mapping

**Files:**
- Create: `src/monitor/status-collector.ts`
- Create: `test/monitor/status-collector.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/monitor/status-collector.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { StatusCollector } from "../../src/monitor/status-collector.js";

// Helper: build a mock SDK assistant message with tool_use blocks
function mockAssistantWithTools(tools: Array<{ name: string; input?: Record<string, unknown> }>): unknown {
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

// Helper: build a mock assistant message with text only
function mockAssistantText(): unknown {
  return {
    type: "assistant",
    message: {
      content: [{ type: "text", text: "Some analysis..." }],
      usage: { input_tokens: 500, output_tokens: 100 },
    },
  };
}

// Helper: build a mock result success message
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

// Helper: build a mock system message with compact_boundary
function mockCompactBoundary(): unknown {
  return {
    type: "system",
    subtype: "compact_boundary",
  };
}

// Helper: build a mock task_started event
function mockTaskStarted(taskId: string, description: string): unknown {
  return {
    type: "task_started",
    task_id: taskId,
    description,
  };
}

// Helper: build a mock task_notification (completed)
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
    it("registers a new session as running", () => {
      collector.registerSession("plan-01-alpha");
      const state = collector.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]!.name).toBe("plan-01-alpha");
      expect(state.sessions[0]!.status).toBe("running");
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
      collector.onMessage("s1", mockAssistantWithTools([
        { name: "Read", input: { file_path: "/src/foo.ts" } },
        { name: "Glob", input: { pattern: "**/*.ts" } },
      ]));

      const session = collector.getState().sessions[0]!;
      expect(session.turns).toBe(1);
      expect(session.toolCalls).toBe(2);
      expect(session.toolBreakdown).toEqual({ Read: 1, Glob: 1 });
      expect(session.lastAction).toBe("Glob");
    });

    it("accumulates tool counts across messages", () => {
      collector.registerSession("s1");
      collector.onMessage("s1", mockAssistantWithTools([{ name: "Read" }]));
      collector.onMessage("s1", mockAssistantWithTools([{ name: "Read" }, { name: "Write" }]));

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
      // contextTokens is the latest input_tokens, not cumulative
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
      collector.onMessage("s1", mockAssistantWithTools([{
        name: "TeamCreate",
        input: {
          members: [
            { name: "reliability-advocate" },
            { name: "security-advocate" },
          ],
        },
      }]));

      const session = collector.getState().sessions[0]!;
      expect(session.children).toHaveLength(2);
      expect(session.children[0]!.type).toBe("team-member");
      expect(session.children[0]!.name).toBe("reliability-advocate");
      expect(session.children[0]!.taskId).toBeNull();
    });

    it("tracks SendMessage activity on team members", () => {
      collector.registerSession("s1");
      // First create team
      collector.onMessage("s1", mockAssistantWithTools([{
        name: "TeamCreate",
        input: { members: [{ name: "advocate-1" }] },
      }]));
      // Then send message to advocate-1
      collector.onMessage("s1", mockAssistantWithTools([{
        name: "SendMessage",
        input: { to: "advocate-1", message: "Present your case" },
      }]));

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

  describe("getState immutability", () => {
    it("returns a new object on each call", () => {
      const s1 = collector.getState();
      const s2 = collector.getState();
      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test -- test/monitor/status-collector.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement StatusCollector**

```typescript
// src/monitor/status-collector.ts
import type {
  PipelineState,
  SessionState,
  ChildState,
  OnStatusMessage,
} from "./types.js";

/** Model context window limits (tokens) */
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  default: 200_000,
};

function contextLimit(model: string): number {
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.includes(key)) return limit;
  }
  return MODEL_CONTEXT_LIMITS["default"]!;
}

interface MutableChild {
  type: "task" | "team-member";
  name: string;
  taskId: string | null;
  status: "pending" | "running" | "done" | "failed";
  turns: number;
  toolCalls: number;
  toolBreakdown: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  lastAction: string;
}

interface MutableSession {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  sessionId: string;
  startedAt: number;
  durationMs: number;
  turns: number;
  toolCalls: number;
  toolBreakdown: Record<string, number>;
  agentsRunning: number;
  agentsTotal: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  contextTokens: number;
  compactions: number;
  cost: number;
  lastAction: string;
  logSize: number;
  planSize: number;
  children: MutableChild[];
}

interface InitOptions {
  readonly pid: number;
  readonly command: string;
  readonly configPath: string;
  readonly outputDir: string;
}

/** Collects SDK events and maintains pipeline state. */
export class StatusCollector {
  private readonly pid: number;
  private readonly startedAt: string;
  private readonly command: string;
  private readonly configPath: string;
  private readonly outputDir: string;
  private stage = "idle";
  private readonly sessions = new Map<string, MutableSession>();

  constructor(opts: InitOptions) {
    this.pid = opts.pid;
    this.startedAt = new Date().toISOString();
    this.command = opts.command;
    this.configPath = opts.configPath;
    this.outputDir = opts.outputDir;
  }

  /** Register a new session as running */
  registerSession(name: string): void {
    this.sessions.set(name, {
      name,
      status: "running",
      sessionId: "",
      startedAt: Date.now(),
      durationMs: 0,
      turns: 0,
      toolCalls: 0,
      toolBreakdown: {},
      agentsRunning: 0,
      agentsTotal: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      contextTokens: 0,
      compactions: 0,
      cost: 0,
      lastAction: "",
      logSize: 0,
      planSize: 0,
      children: [],
    });
  }

  /** Update stage label */
  setStage(stage: string): void {
    this.stage = stage;
  }

  /** Mark a session as done or failed */
  completeSession(name: string, status: "done" | "failed"): void {
    const s = this.sessions.get(name);
    if (s) s.status = status;
  }

  /** Update session log/plan size */
  updateSizes(name: string, logSize: number, planSize: number): void {
    const s = this.sessions.get(name);
    if (s) {
      s.logSize = logSize;
      s.planSize = planSize;
    }
  }

  /** Process an SDK event for a session */
  onMessage(sessionName: string, msg: unknown): void {
    const s = this.sessions.get(sessionName);
    if (!s) return;

    const m = msg as Record<string, unknown>;

    switch (m.type) {
      case "assistant":
        this.handleAssistant(s, m);
        break;
      case "result":
        this.handleResult(s, m);
        break;
      case "system":
        this.handleSystem(s, m);
        break;
      case "task_started":
        this.handleTaskStarted(s, m);
        break;
      case "task_progress":
        this.handleTaskProgress(s, m);
        break;
      case "task_notification":
        this.handleTaskNotification(s, m);
        break;
      default:
        break;
    }
  }

  /** Create the OnStatusMessage callback for pipeline integration */
  createCallback(): OnStatusMessage {
    return (sessionName: string, msg: unknown) => {
      this.onMessage(sessionName, msg);
    };
  }

  /** Snapshot current state as an immutable PipelineState */
  getState(): PipelineState {
    const now = Date.now();
    const sessions: SessionState[] = [];

    for (const s of this.sessions.values()) {
      const totalTokens =
        s.inputTokens + s.outputTokens + s.cacheCreationTokens + s.cacheReadTokens;
      const ctxLimit = contextLimit("default");
      const contextPercent =
        ctxLimit > 0 ? Math.round((s.contextTokens / ctxLimit) * 100) : 0;

      const children: ChildState[] = s.children.map((c) => ({
        type: c.type,
        name: c.name,
        taskId: c.taskId,
        status: c.status,
        turns: c.turns,
        toolCalls: c.toolCalls,
        toolBreakdown: { ...c.toolBreakdown },
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        cacheCreationTokens: c.cacheCreationTokens,
        cacheReadTokens: c.cacheReadTokens,
        totalTokens:
          c.inputTokens + c.outputTokens + c.cacheCreationTokens + c.cacheReadTokens,
        lastAction: c.lastAction,
      }));

      sessions.push({
        name: s.name,
        status: s.status,
        sessionId: s.sessionId,
        turns: s.turns,
        toolCalls: s.toolCalls,
        toolBreakdown: { ...s.toolBreakdown },
        agents: { running: s.agentsRunning, total: s.agentsTotal },
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cacheCreationTokens: s.cacheCreationTokens,
        cacheReadTokens: s.cacheReadTokens,
        totalTokens,
        contextTokens: s.contextTokens,
        contextPercent,
        compactions: s.compactions,
        cost: s.cost,
        durationMs: s.status === "running" ? now - s.startedAt : s.durationMs,
        lastAction: s.lastAction,
        logSize: s.logSize,
        planSize: s.planSize,
        children,
      });
    }

    return {
      pid: this.pid,
      startedAt: this.startedAt,
      command: this.command,
      configPath: this.configPath,
      outputDir: this.outputDir,
      stage: this.stage,
      sessions,
    };
  }

  // ---- Private handlers ----

  private handleAssistant(s: MutableSession, m: Record<string, unknown>): void {
    s.turns++;
    const message = m.message as Record<string, unknown> | undefined;
    const content = message?.content;

    // Track tokens from usage
    const usage = message?.usage as Record<string, number> | undefined;
    if (usage) {
      s.inputTokens += usage.input_tokens ?? 0;
      s.outputTokens += usage.output_tokens ?? 0;
      s.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      s.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      // Context size = latest input tokens (approximation)
      s.contextTokens = usage.input_tokens ?? s.contextTokens;
    }

    if (!Array.isArray(content)) return;

    const toolUses = content.filter(
      (b: Record<string, unknown>) => b.type === "tool_use",
    );

    if (toolUses.length === 0) return;

    s.toolCalls += toolUses.length;

    for (const tool of toolUses) {
      const name = tool.name as string;
      s.toolBreakdown[name] = (s.toolBreakdown[name] ?? 0) + 1;
      s.lastAction = name;

      // Detect TeamCreate → add team-member children
      if (name === "TeamCreate") {
        this.handleTeamCreate(s, tool.input as Record<string, unknown>);
      }

      // Detect SendMessage → update team member activity
      if (name === "SendMessage") {
        this.handleSendMessage(s, tool.input as Record<string, unknown>);
      }
    }
  }

  private handleResult(s: MutableSession, m: Record<string, unknown>): void {
    if (m.subtype === "success") {
      s.status = "done";
      s.cost = (m.total_cost_usd as number) ?? 0;
      s.sessionId = (m.session_id as string) ?? "";
      s.durationMs = (m.duration_ms as number) ?? Date.now() - s.startedAt;
    } else {
      s.status = "failed";
    }
  }

  private handleSystem(s: MutableSession, m: Record<string, unknown>): void {
    if (m.subtype === "compact_boundary") {
      s.compactions++;
    }
  }

  private handleTaskStarted(s: MutableSession, m: Record<string, unknown>): void {
    const taskId = m.task_id as string;
    const description = m.description as string;
    s.agentsTotal++;
    s.agentsRunning++;
    s.children.push({
      type: "task",
      name: description,
      taskId,
      status: "running",
      turns: 0,
      toolCalls: 0,
      toolBreakdown: {},
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      lastAction: "",
    });
  }

  private handleTaskProgress(s: MutableSession, m: Record<string, unknown>): void {
    const taskId = m.task_id as string;
    const child = s.children.find((c) => c.taskId === taskId);
    if (!child) return;

    const usage = m.usage as Record<string, number> | undefined;
    if (usage) {
      child.inputTokens = usage.inputTokens ?? child.inputTokens;
      child.outputTokens = usage.outputTokens ?? child.outputTokens;
    }
  }

  private handleTaskNotification(s: MutableSession, m: Record<string, unknown>): void {
    const taskId = m.task_id as string;
    const status = m.status as string;
    const child = s.children.find((c) => c.taskId === taskId);
    if (!child) return;

    child.status = status === "completed" ? "done" : "failed";
    s.agentsRunning = Math.max(0, s.agentsRunning - 1);

    const usage = m.usage as Record<string, number> | undefined;
    if (usage) {
      child.inputTokens = usage.inputTokens ?? child.inputTokens;
      child.outputTokens = usage.outputTokens ?? child.outputTokens;
    }
  }

  private handleTeamCreate(s: MutableSession, input: Record<string, unknown>): void {
    const members = input.members as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(members)) return;

    for (const member of members) {
      const name = (member.name as string) ?? "unnamed";
      s.agentsTotal++;
      s.agentsRunning++;
      s.children.push({
        type: "team-member",
        name,
        taskId: null,
        status: "running",
        turns: 0,
        toolCalls: 0,
        toolBreakdown: {},
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        lastAction: "",
      });
    }
  }

  private handleSendMessage(s: MutableSession, input: Record<string, unknown>): void {
    const to = input.to as string | undefined;
    if (!to) return;

    const child = s.children.find((c) => c.name === to);
    if (child) {
      child.turns++;
      child.lastAction = `SendMessage from lead`;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make -f dev.mk test -- test/monitor/status-collector.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Run full test suite**

Run: `make -f dev.mk check`
Expected: PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/monitor/types.ts src/monitor/status-collector.ts test/monitor/status-collector.test.ts
git commit -m "feat(monitor): add StatusCollector with SDK event-to-state mapping"
```

---

### Task 3: NdjsonLogger `bytesWritten` getter

**Files:**
- Modify: `src/pipeline/logger.ts:4-23`
- Test: `test/pipeline/io.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing test**

Add to `test/pipeline/io.test.ts` (or create a small `test/pipeline/logger.test.ts`):

```typescript
// test/pipeline/logger.test.ts
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NdjsonLogger } from "../../src/pipeline/logger.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";

describe("NdjsonLogger.bytesWritten", () => {
  let logPath: string;

  afterEach(async () => {
    if (logPath) await fs.rm(logPath, { force: true });
  });

  it("returns 0 before any writes", () => {
    logPath = path.join(TMPDIR, `logger-test-${Date.now()}.ndjson`);
    const logger = new NdjsonLogger(logPath);
    expect(logger.bytesWritten).toBe(0);
    // cleanup
    logger.close();
  });

  it("returns bytes written after writes", async () => {
    logPath = path.join(TMPDIR, `logger-test-${Date.now()}.ndjson`);
    const logger = new NdjsonLogger(logPath);
    await logger.write({ type: "test", data: "hello" });
    expect(logger.bytesWritten).toBeGreaterThan(0);
    await logger.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make -f dev.mk test -- test/pipeline/logger.test.ts`
Expected: FAIL (bytesWritten is not a property)

- [ ] **Step 3: Add the getter to NdjsonLogger**

In `src/pipeline/logger.ts`, add after line 8:

```typescript
  /** Number of bytes written to the log file so far */
  get bytesWritten(): number {
    return this.stream.bytesWritten;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make -f dev.mk test -- test/pipeline/logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/logger.ts test/pipeline/logger.test.ts
git commit -m "feat(monitor): add bytesWritten getter to NdjsonLogger"
```

---

## Chunk 2: Status Server and NDJSON Parser

### Task 4: Status server — HTTP over Unix socket

**Files:**
- Create: `src/monitor/status-server.ts`
- Create: `test/monitor/status-server.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/monitor/status-server.test.ts
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { StatusServer } from "../../src/monitor/status-server.js";
import { StatusCollector } from "../../src/monitor/status-collector.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";

function httpGet(socketPath: string, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode!, body }));
    });
    req.on("error", reject);
  });
}

describe("StatusServer", () => {
  let server: StatusServer | undefined;

  afterEach(async () => {
    if (server) await server.stop();
    server = undefined;
  });

  it("starts and serves GET /status", async () => {
    const collector = new StatusCollector({
      pid: process.pid,
      command: "run",
      configPath: "test.yaml",
      outputDir: "/tmp/test",
    });

    server = new StatusServer(collector);
    const socketPath = path.join(TMPDIR, `cpc-test-${Date.now()}.sock`);
    await server.start(socketPath);

    const { status, body } = await httpGet(socketPath, "/status");
    expect(status).toBe(200);

    const state = JSON.parse(body);
    expect(state.pid).toBe(process.pid);
    expect(state.command).toBe("run");
    expect(state.sessions).toEqual([]);
  });

  it("returns 404 for unknown paths", async () => {
    const collector = new StatusCollector({
      pid: process.pid,
      command: "run",
      configPath: "test.yaml",
      outputDir: "/tmp/test",
    });

    server = new StatusServer(collector);
    const socketPath = path.join(TMPDIR, `cpc-test-${Date.now()}.sock`);
    await server.start(socketPath);

    const { status } = await httpGet(socketPath, "/unknown");
    expect(status).toBe(404);
  });

  it("cleans up socket on stop", async () => {
    const collector = new StatusCollector({
      pid: process.pid,
      command: "run",
      configPath: "test.yaml",
      outputDir: "/tmp/test",
    });

    server = new StatusServer(collector);
    const socketPath = path.join(TMPDIR, `cpc-test-${Date.now()}.sock`);
    await server.start(socketPath);
    await server.stop();
    server = undefined;

    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it("reflects live session state", async () => {
    const collector = new StatusCollector({
      pid: process.pid,
      command: "generate",
      configPath: "test.yaml",
      outputDir: "/tmp/test",
    });

    collector.registerSession("plan-01-alpha");
    collector.onMessage("plan-01-alpha", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: {} }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      },
    });

    server = new StatusServer(collector);
    const socketPath = path.join(TMPDIR, `cpc-test-${Date.now()}.sock`);
    await server.start(socketPath);

    const { body } = await httpGet(socketPath, "/status");
    const state = JSON.parse(body);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].turns).toBe(1);
    expect(state.sessions[0].toolCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test -- test/monitor/status-server.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement StatusServer**

```typescript
// src/monitor/status-server.ts
import * as http from "node:http";
import * as fs from "node:fs";
import type { StatusCollector } from "./status-collector.js";

/** HTTP server on a Unix domain socket serving pipeline status */
export class StatusServer {
  private readonly collector: StatusCollector;
  private server: http.Server | undefined;
  private socketPath: string | undefined;

  constructor(collector: StatusCollector) {
    this.collector = collector;
  }

  /** Start serving on the given Unix socket path */
  async start(socketPath: string): Promise<void> {
    this.socketPath = socketPath;

    // Remove stale socket if exists
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // ignore — file doesn't exist
    }

    this.server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/status") {
        const state = this.collector.getState();
        const body = JSON.stringify(state);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(socketPath, () => resolve());
      this.server!.on("error", reject);
    });
  }

  /** Stop the server and remove the socket file */
  async stop(): Promise<void> {
    if (!this.server) return;

    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });

    if (this.socketPath) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // ignore
      }
    }

    this.server = undefined;
    this.socketPath = undefined;
  }

  /** Get the socket path (for discovery) */
  getSocketPath(): string | undefined {
    return this.socketPath;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make -f dev.mk test -- test/monitor/status-server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor/status-server.ts test/monitor/status-server.test.ts
git commit -m "feat(monitor): add HTTP status server on Unix domain socket"
```

---

### Task 5: NDJSON parser for post-hoc mode

**Files:**
- Create: `src/monitor/ndjson-parser.ts`
- Create: `test/monitor/ndjson-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/monitor/ndjson-parser.test.ts
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseNdjsonLog } from "../../src/monitor/ndjson-parser.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";

describe("parseNdjsonLog", () => {
  let tmpFile: string;

  afterEach(async () => {
    if (tmpFile) await fs.rm(tmpFile, { force: true });
  });

  it("counts turns from assistant messages", async () => {
    tmpFile = path.join(TMPDIR, `ndjson-test-${Date.now()}.log`);
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }], usage: { input_tokens: 100, output_tokens: 50 } } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "bye" }], usage: { input_tokens: 200, output_tokens: 60 } } }),
      JSON.stringify({ type: "result", subtype: "success", num_turns: 2, total_cost_usd: 0.05, session_id: "s1" }),
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
          content: [{ type: "tool_use", name: "Write", input: { file_path: "/out/plan.md" } }],
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test -- test/monitor/ndjson-parser.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement NDJSON parser**

```typescript
// src/monitor/ndjson-parser.ts
import * as fs from "node:fs/promises";

export interface NdjsonSummary {
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Readonly<Record<string, number>>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly contextTokens: number;
  readonly compactions: number;
  readonly cost: number;
  readonly sessionId: string;
  readonly lastAction: string;
}

/** Parse an NDJSON log file and extract session summary stats */
export async function parseNdjsonLog(filePath: string): Promise<NdjsonSummary> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return emptySummary();
  }

  let turns = 0;
  let toolCalls = 0;
  const toolBreakdown: Record<string, number> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let contextTokens = 0;
  let compactions = 0;
  let cost = 0;
  let sessionId = "";
  let lastAction = "";

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (msg.type === "assistant") {
      turns++;
      const message = msg.message as Record<string, unknown> | undefined;
      const contentArr = message?.content;

      // Track tokens
      const usage = message?.usage as Record<string, number> | undefined;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
        cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
        cacheReadTokens += usage.cache_read_input_tokens ?? 0;
        contextTokens = usage.input_tokens ?? contextTokens;
      }

      if (Array.isArray(contentArr)) {
        const tools = contentArr.filter(
          (b: Record<string, unknown>) => b.type === "tool_use",
        );
        toolCalls += tools.length;
        for (const tool of tools) {
          const name = tool.name as string;
          toolBreakdown[name] = (toolBreakdown[name] ?? 0) + 1;
          lastAction = name;
        }
      }
    } else if (msg.type === "result" && msg.subtype === "success") {
      cost = (msg.total_cost_usd as number) ?? 0;
      sessionId = (msg.session_id as string) ?? "";
    } else if (msg.type === "system" && msg.subtype === "compact_boundary") {
      compactions++;
    }
  }

  return {
    turns,
    toolCalls,
    toolBreakdown,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    contextTokens,
    compactions,
    cost,
    sessionId,
    lastAction,
  };
}

function emptySummary(): NdjsonSummary {
  return {
    turns: 0,
    toolCalls: 0,
    toolBreakdown: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    contextTokens: 0,
    compactions: 0,
    cost: 0,
    sessionId: "",
    lastAction: "",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make -f dev.mk test -- test/monitor/ndjson-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor/ndjson-parser.ts test/monitor/ndjson-parser.test.ts
git commit -m "feat(monitor): add NDJSON log parser for post-hoc monitoring"
```

---

## Chunk 3: Table Renderer and Process Discovery

### Task 6: Table renderer — colored summary output

**Files:**
- Create: `src/monitor/table-renderer.ts`
- Create: `test/monitor/table-renderer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/monitor/table-renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderTable, formatTokens } from "../../src/monitor/table-renderer.js";
import type { PipelineState, SessionState } from "../../src/monitor/types.js";

// Helper to build a minimal session
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
    expect(output).toContain("44"); // turns
    expect(output).toContain("35"); // tools
  });

  it("renders detail rows with tool breakdown", () => {
    const state = makeState([makeSession()]);
    const output = renderTable(state, {});
    expect(output).toContain("Read(15)");
    expect(output).toContain("Glob(8)");
  });

  it("renders totals footer", () => {
    const state = makeState([makeSession(), makeSession({ name: "plan-02-beta" })]);
    const output = renderTable(state, {});
    expect(output).toContain("generating");
  });

  it("renders child rows with tree characters", () => {
    const state = makeState([makeSession({
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
    })]);
    const output = renderTable(state, {});
    expect(output).toContain("reliability");
    expect(output).toContain("└");
  });

  it("strips ANSI when noColor is set", () => {
    const state = makeState([makeSession()]);
    const output = renderTable(state, { noColor: true });
    // Should not contain escape sequences
    expect(output).not.toMatch(/\x1b\[/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test -- test/monitor/table-renderer.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement table renderer**

```typescript
// src/monitor/table-renderer.ts
import type { PipelineState, SessionState, ChildState } from "./types.js";

// ANSI color codes
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

interface RenderOptions {
  readonly noColor?: boolean;
  readonly previousState?: PipelineState;
}

function c(color: string, text: string, noColor: boolean): string {
  return noColor ? text : `${color}${text}${RESET}`;
}

/** Format token count as human-readable (500, 180K, 1.5M) */
export function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Format bytes as human-readable */
function formatBytes(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(0)}KB`;
  return `${n}B`;
}

/** Format duration in seconds */
function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  const s = Math.round(ms / 1000);
  if (s >= 60) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${s}s`;
}

/** Format cost as USD */
function formatCost(cost: number): string {
  if (cost === 0) return "—";
  return `$${cost.toFixed(2)}`;
}

/** Get top N tools from breakdown */
function topTools(breakdown: Readonly<Record<string, number>>, n: number): string {
  return Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${name}(${count})`)
    .join(" ");
}

/** Compute activity indicator by comparing turns to previous state */
function activityLabel(
  session: SessionState,
  prev: SessionState | undefined,
  nc: boolean,
): string {
  if (session.status === "done" || session.status === "pending") {
    return c(DIM, "—", nc);
  }
  if (!prev) return c(CYAN, "new", nc);

  const delta = session.turns - prev.turns;
  if (delta > 0) return c(GREEN, `+${delta}`, nc);
  return c(YELLOW, "idle", nc);
}

/** Color for session status */
function statusColor(status: string, nc: boolean): string {
  switch (status) {
    case "running": return c(GREEN, status.toUpperCase(), nc);
    case "done": return c(DIM, status.toUpperCase(), nc);
    case "failed": return c(RED, status.toUpperCase(), nc);
    case "pending": return c(DIM, status.toUpperCase(), nc);
    default: return status.toUpperCase();
  }
}

/** Extract config project name from path */
function projectName(configPath: string): string {
  const parts = configPath.split("/");
  // Look for a meaningful segment like "daytrader-t2" in "projects/daytrader-t2/config.yaml"
  const projectIdx = parts.indexOf("projects");
  if (projectIdx >= 0 && projectIdx + 1 < parts.length) {
    return parts[projectIdx + 1]!;
  }
  return parts[parts.length - 1]?.replace(/\.(yaml|yml|json)$/, "") ?? "unknown";
}

/** Left-align string within width */
function leftAlign(s: string, w: number): string {
  // Strip ANSI for length calculation
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, w - stripped.length);
  return s + " ".repeat(pad);
}

/** Right-align string within width */
function rightAlign(s: string, w: number): string {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, w - stripped.length);
  return " ".repeat(pad) + s;
}

/** Build previous sessions lookup by name */
function prevLookup(prev?: PipelineState): Map<string, SessionState> {
  const map = new Map<string, SessionState>();
  if (!prev) return map;
  for (const s of prev.sessions) {
    map.set(s.name, s);
  }
  return map;
}

/** Render a single session row */
function renderSessionRow(
  s: SessionState,
  prev: SessionState | undefined,
  nc: boolean,
): string {
  const agents = s.agents.total > 0 ? `${s.agents.running}/${s.agents.total}` : "—";
  const ctx = s.contextPercent > 0 ? `${formatTokens(s.contextTokens)} ${s.contextPercent}%` : "—";
  const compactStr = s.compactions > 0 ? c(RED, String(s.compactions), nc) : "—";
  const activity = activityLabel(s, prev, nc);

  return [
    leftAlign(s.name.slice(0, 25), 26),
    leftAlign(statusColor(s.status, nc), nc ? 12 : 12 + 9), // account for ANSI
    rightAlign(s.sessionId.slice(0, 8) || "—", 10),
    rightAlign(String(s.turns || "—"), 5),
    rightAlign(String(s.toolCalls || "—"), 5),
    rightAlign(agents, 6),
    rightAlign(formatTokens(s.inputTokens), 6),
    rightAlign(formatTokens(s.outputTokens), 6),
    rightAlign(formatTokens(s.cacheCreationTokens), 7),
    rightAlign(formatTokens(s.cacheReadTokens), 7),
    rightAlign(formatTokens(s.totalTokens), 7),
    rightAlign(ctx, 10),
    rightAlign(compactStr, nc ? 3 : 3 + 9),
    rightAlign(activity, nc ? 8 : 8 + 9),
    s.lastAction.slice(0, 40),
  ].join(" ");
}

/** Render detail rows (log size, plan size, tool breakdown, last action) */
function renderDetailRows(s: SessionState, _nc: boolean): string[] {
  const indent = " ".repeat(26);
  const lines: string[] = [];

  const logStr = `Log: ${formatBytes(s.logSize)}`;
  const planStr = s.planSize > 0 ? `  Plan: ${formatBytes(s.planSize)}` : "";
  const tools = topTools(s.toolBreakdown, 5);
  lines.push(`${indent}${logStr}${planStr}  ${tools}`);

  if (s.lastAction) {
    lines.push(`${indent}\u2514\u2500 ${s.lastAction.slice(0, 60)}`);
  }

  return lines;
}

/** Render child rows */
function renderChildRows(children: readonly ChildState[], nc: boolean): string[] {
  const lines: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const isLast = i === children.length - 1;
    const prefix = isLast ? "  \u2514 " : "  \u251C ";

    const statusStr = statusColor(child.status, nc);
    const line = [
      leftAlign(prefix + child.name.slice(0, 20), 26),
      leftAlign(statusStr, nc ? 12 : 12 + 9),
      rightAlign("—", 10), // no session ID for children
      rightAlign(String(child.turns || "—"), 5),
      rightAlign(String(child.toolCalls || "—"), 5),
      rightAlign("—", 6), // no agents for children
      rightAlign(formatTokens(child.inputTokens), 6),
      rightAlign(formatTokens(child.outputTokens), 6),
      rightAlign(formatTokens(child.cacheCreationTokens), 7),
      rightAlign(formatTokens(child.cacheReadTokens), 7),
      rightAlign(formatTokens(child.totalTokens), 7),
      rightAlign("—", 10),
      rightAlign("—", 3),
      rightAlign("—", 8),
      child.lastAction.slice(0, 40),
    ].join(" ");

    lines.push(line);
  }
  return lines;
}

/** Group sessions by pipeline stage (inferred from name prefix) */
function groupByStage(sessions: readonly SessionState[]): Map<string, SessionState[]> {
  const groups = new Map<string, SessionState[]>();
  for (const s of sessions) {
    let stage: string;
    if (s.name.startsWith("plan-")) stage = "generate";
    else if (s.name.startsWith("evaluate") || s.name.startsWith("eval")) stage = "evaluate";
    else if (s.name.startsWith("merge")) stage = "merge";
    else if (s.name.startsWith("verify")) stage = "verify";
    else if (s.name.startsWith("pre-mortem")) stage = "verify";
    else stage = "other";

    const group = groups.get(stage) ?? [];
    group.push(s);
    groups.set(stage, group);
  }
  return groups;
}

/** Render the full summary table */
export function renderTable(
  state: PipelineState,
  options: RenderOptions,
): string {
  const nc = options.noColor ?? false;
  const prevMap = prevLookup(options.previousState);
  const lines: string[] = [];

  // Header
  const name = projectName(state.configPath);
  const startTime = new Date(state.startedAt).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  lines.push(`cpc monitor \u2014 ${name} (PID ${state.pid}, started ${startTime})`);
  lines.push("");

  // Column headers
  const header = [
    leftAlign("Variant", 26),
    leftAlign("Status", 12),
    rightAlign("Session", 10),
    rightAlign("Turns", 5),
    rightAlign("Tools", 5),
    rightAlign("Agents", 6),
    rightAlign("Input", 6),
    rightAlign("Output", 6),
    rightAlign("Cache+", 7),
    rightAlign("Cache>", 7),
    rightAlign("Total", 7),
    rightAlign("Ctx", 10),
    rightAlign("C#", 3),
    rightAlign("Activity", 8),
    "Last Action",
  ].join(" ");
  lines.push(header);
  lines.push("─".repeat(header.length));

  // Session rows grouped by stage (infer stage from session name prefix)
  const stageGroups = groupByStage(state.sessions);

  for (const [stageName, sessions] of stageGroups) {
    lines.push(`\u2500\u2500 ${stageName.toUpperCase()} ${"─".repeat(Math.max(0, header.length - stageName.length - 4))}`);
    for (const s of sessions) {
      const prev = prevMap.get(s.name);
      lines.push(renderSessionRow(s, prev, nc));
      lines.push(...renderDetailRows(s, nc));

      if (s.children.length > 0) {
        lines.push(...renderChildRows(s.children, nc));
      }
    }
    lines.push("");
  }

  // Totals footer
  lines.push("");
  const totalSessions = state.sessions.length;
  const doneSessions = state.sessions.filter((s) => s.status === "done").length;
  const runningSessions = state.sessions.filter((s) => s.status === "running").length;
  const failedSessions = state.sessions.filter((s) => s.status === "failed").length;

  const totalInput = state.sessions.reduce((a, s) => a + s.inputTokens, 0);
  const totalOutput = state.sessions.reduce((a, s) => a + s.outputTokens, 0);
  const totalCacheC = state.sessions.reduce((a, s) => a + s.cacheCreationTokens, 0);
  const totalCacheR = state.sessions.reduce((a, s) => a + s.cacheReadTokens, 0);
  const totalTokens = totalInput + totalOutput + totalCacheC + totalCacheR;
  const totalCost = state.sessions.reduce((a, s) => a + s.cost, 0);

  lines.push(`Status: ${state.stage} \u2014 ${doneSessions}/${totalSessions} sessions done`);
  lines.push(`Plans:  ${doneSessions} done, ${runningSessions} running, ${failedSessions} failed`);
  lines.push(`Tokens: ${formatTokens(totalInput)} input, ${formatTokens(totalOutput)} output, ${formatTokens(totalCacheC)} cache+, ${formatTokens(totalCacheR)} cache> (${formatTokens(totalTokens)} total)`);
  lines.push(`Cost:   ${formatCost(totalCost)}`);

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make -f dev.mk test -- test/monitor/table-renderer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor/table-renderer.ts test/monitor/table-renderer.test.ts
git commit -m "feat(monitor): add colored summary table renderer"
```

---

### Task 7: Process discovery — find running cpc pipelines

**Files:**
- Create: `src/monitor/process-discovery.ts`
- Create: `test/monitor/process-discovery.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// test/monitor/process-discovery.test.ts
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverSockets, fetchStatus } from "../../src/monitor/process-discovery.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";

describe("discoverSockets", () => {
  it("finds cpc-*.sock files in tmpdir", async () => {
    // Create a fake socket file (just a regular file for test purposes)
    const sockPath = path.join(TMPDIR, `cpc-${process.pid}.sock`);
    fs.writeFileSync(sockPath, "");

    try {
      const sockets = await discoverSockets(TMPDIR);
      const match = sockets.find((s) => s.pid === process.pid);
      expect(match).toBeDefined();
      expect(match!.socketPath).toBe(sockPath);
    } finally {
      fs.unlinkSync(sockPath);
    }
  });

  it("returns empty array when no sockets exist", async () => {
    // Use a fresh directory with no sockets
    const emptyDir = path.join(TMPDIR, `empty-${Date.now()}`);
    fs.mkdirSync(emptyDir, { recursive: true });
    try {
      const sockets = await discoverSockets(emptyDir);
      expect(sockets).toEqual([]);
    } finally {
      fs.rmdirSync(emptyDir);
    }
  });
});

describe("fetchStatus", () => {
  let server: http.Server | undefined;
  let sockPath: string;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      try { fs.unlinkSync(sockPath); } catch {}
      server = undefined;
    }
  });

  it("fetches JSON status from a Unix socket", async () => {
    sockPath = path.join(TMPDIR, `cpc-test-discovery-${Date.now()}.sock`);
    const mockState = { pid: 1, command: "run", sessions: [] };

    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mockState));
    });

    await new Promise<void>((resolve) => server!.listen(sockPath, resolve));

    const result = await fetchStatus(sockPath);
    expect(result.pid).toBe(1);
    expect(result.command).toBe("run");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make -f dev.mk test -- test/monitor/process-discovery.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement process discovery**

```typescript
// src/monitor/process-discovery.ts
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import type { PipelineState } from "./types.js";

export interface DiscoveredSocket {
  readonly pid: number;
  readonly socketPath: string;
}

/** Find all cpc-*.sock files in the given directory */
export async function discoverSockets(
  tmpDir: string,
): Promise<readonly DiscoveredSocket[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(tmpDir);
  } catch {
    return [];
  }

  const sockets: DiscoveredSocket[] = [];

  for (const entry of entries) {
    const match = entry.match(/^cpc-(\d+)\.sock$/);
    if (!match) continue;

    const pid = parseInt(match[1]!, 10);
    sockets.push({
      pid,
      socketPath: path.join(tmpDir, entry),
    });
  }

  return sockets;
}

/** Check if a PID is alive */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Fetch /status from a Unix socket, with timeout */
export function fetchStatus(
  socketPath: string,
  timeoutMs = 3000,
): Promise<PipelineState> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { socketPath, path: "/status", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as PipelineState);
          } catch (err) {
            reject(new Error(`Invalid JSON from ${socketPath}: ${String(err)}`));
          }
        });
      },
    );

    req.on("error", (err) =>
      reject(new Error(`Cannot connect to ${socketPath}: ${err.message}`)),
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout connecting to ${socketPath}`));
    });
  });
}

/** Discover live cpc processes: find sockets, verify PID, optionally fetch status */
export async function discoverLivePipelines(
  tmpDir: string,
): Promise<readonly { socket: DiscoveredSocket; state: PipelineState }[]> {
  const sockets = await discoverSockets(tmpDir);
  const live: { socket: DiscoveredSocket; state: PipelineState }[] = [];

  for (const sock of sockets) {
    if (!isPidAlive(sock.pid)) {
      // Clean up stale socket
      try {
        await fs.unlink(sock.socketPath);
      } catch {
        // ignore
      }
      continue;
    }

    try {
      const state = await fetchStatus(sock.socketPath);
      live.push({ socket: sock, state });
    } catch {
      // Socket exists but not connectable — skip
    }
  }

  return live;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make -f dev.mk test -- test/monitor/process-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/monitor/process-discovery.ts test/monitor/process-discovery.test.ts
git commit -m "feat(monitor): add process discovery via Unix socket scanning"
```

---

## Chunk 4: Monitor Orchestrator and CLI

### Task 8: Monitor orchestrator — poll loop

**Files:**
- Create: `src/monitor/monitor.ts`

- [ ] **Step 1: Implement the monitor orchestrator**

```typescript
// src/monitor/monitor.ts
import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as readline from "node:readline";
import { discoverLivePipelines, fetchStatus } from "./process-discovery.js";
import { renderTable } from "./table-renderer.js";
import { parseNdjsonLog } from "./ndjson-parser.js";
import type { PipelineState, SessionState } from "./types.js";

export interface MonitorOptions {
  readonly dir?: string;
  readonly interval?: number;
  readonly once?: boolean;
  readonly json?: boolean;
}

/** Clear terminal */
function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

/** Prompt user to select from multiple pipelines */
async function selectPipeline(
  pipelines: readonly { socket: { pid: number; socketPath: string }; state: PipelineState }[],
): Promise<string> {
  const isTTY = process.stdin.isTTY ?? false;

  if (!isTTY) {
    // Non-interactive: pick most recently started
    const sorted = [...pipelines].sort(
      (a, b) => new Date(b.state.startedAt).getTime() - new Date(a.state.startedAt).getTime(),
    );
    const chosen = sorted[0]!;
    console.error(`Auto-selected PID ${chosen.socket.pid} (most recent)`);
    return chosen.socket.socketPath;
  }

  console.log("Multiple cpc processes found:\n");
  for (let i = 0; i < pipelines.length; i++) {
    const p = pipelines[i]!;
    const name = path.basename(path.dirname(p.state.configPath));
    const time = new Date(p.state.startedAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    console.log(`  ${i + 1}) ${name}  (PID ${p.socket.pid}, started ${time}, ${p.state.stage})`);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`\nWhich process to monitor? [1-${pipelines.length}]: `, resolve);
  });
  rl.close();

  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= pipelines.length) {
    throw new Error("Invalid selection");
  }

  return pipelines[idx]!.socket.socketPath;
}

/** Build PipelineState from a completed run directory (post-hoc mode) */
async function buildPostHocState(dir: string): Promise<PipelineState> {
  const entries = await fs.readdir(dir);

  const sessions: SessionState[] = [];

  // Find plan-*.log files
  const logFiles = entries.filter((f) => f.endsWith(".log") || f.endsWith(".ndjson"));

  for (const logFile of logFiles) {
    const logPath = path.join(dir, logFile);
    const summary = await parseNdjsonLog(logPath);
    const name = logFile.replace(/\.(log|ndjson)$/, "");

    // Check for corresponding meta.json or md file
    let planSize = 0;
    const mdFile = entries.find((f) => f === `${name}.md`);
    if (mdFile) {
      const stat = await fs.stat(path.join(dir, mdFile));
      planSize = stat.size;
    }

    const logStat = await fs.stat(logPath);

    sessions.push({
      name,
      status: summary.sessionId ? "done" : "running", // sessionId only present in result success events
      sessionId: summary.sessionId,
      turns: summary.turns,
      toolCalls: summary.toolCalls,
      toolBreakdown: summary.toolBreakdown,
      agents: { running: 0, total: 0 },
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheCreationTokens: summary.cacheCreationTokens,
      cacheReadTokens: summary.cacheReadTokens,
      totalTokens: summary.inputTokens + summary.outputTokens + summary.cacheCreationTokens + summary.cacheReadTokens,
      contextTokens: summary.contextTokens,
      contextPercent: summary.contextTokens > 0 ? Math.round((summary.contextTokens / 200_000) * 100) : 0,
      compactions: summary.compactions,
      cost: summary.cost,
      durationMs: 0,
      lastAction: summary.lastAction,
      logSize: logStat.size,
      planSize,
      children: [],
    });
  }

  return {
    pid: 0,
    startedAt: "",
    command: "post-hoc",
    configPath: dir,
    outputDir: dir,
    stage: "done",
    sessions,
  };
}

/** Run the monitor loop */
export async function runMonitor(options: MonitorOptions): Promise<void> {
  const intervalMs = (options.interval ?? 3) * 1000;

  // Post-hoc mode
  if (options.dir) {
    const state = await buildPostHocState(options.dir);
    if (options.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(renderTable(state, { noColor: !process.stdout.isTTY }));
    }
    return;
  }

  // Live mode: discover
  const tmpDir = os.tmpdir();
  const pipelines = await discoverLivePipelines(tmpDir);

  if (pipelines.length === 0) {
    console.error("No running cpc processes found. Specify a run directory: cpc monitor <dir>");
    process.exitCode = 1;
    return;
  }

  let socketPath: string;
  if (pipelines.length === 1) {
    socketPath = pipelines[0]!.socket.socketPath;
  } else {
    socketPath = await selectPipeline(pipelines);
  }

  // Poll loop
  let previousState: PipelineState | undefined;

  const poll = async (): Promise<boolean> => {
    try {
      const state = await fetchStatus(socketPath);

      if (options.json) {
        console.log(JSON.stringify(state));
      } else {
        clearScreen();
        console.log(renderTable(state, { previousState, noColor: !process.stdout.isTTY }));
      }

      previousState = state;

      // Auto-exit when done
      return state.stage === "done";
    } catch {
      console.error("Connection lost. Pipeline may have finished.");
      return true;
    }
  };

  // First poll
  const done = await poll();
  if (options.once || done) return;

  // Subsequent polls — recursive setTimeout avoids overlapping polls
  await new Promise<void>((resolve) => {
    let stopped = false;

    const scheduleNext = () => {
      if (stopped) return;
      setTimeout(async () => {
        if (stopped) return;
        const isDone = await poll();
        if (isDone) {
          resolve();
        } else {
          scheduleNext();
        }
      }, intervalMs);
    };

    process.on("SIGINT", () => {
      stopped = true;
      resolve();
    });

    scheduleNext();
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `make -f dev.mk build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/monitor/monitor.ts
git commit -m "feat(monitor): add poll loop orchestrator with live and post-hoc modes"
```

---

### Task 9: CLI subcommand — `cpc monitor`

**Files:**
- Create: `src/cli/monitor.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Create the CLI subcommand module**

```typescript
// src/cli/monitor.ts
import { Command } from "commander";
import { runMonitor } from "../monitor/monitor.js";

const coerceInt = (v: string): number => parseInt(v, 10);

export const monitorCommand = new Command("monitor")
  .description("Monitor running cpc pipelines or review completed runs")
  .argument("[dir]", "Run directory for post-hoc monitoring")
  .option("--once", "Single snapshot, no refresh loop")
  .option("--interval <seconds>", "Poll interval in seconds (default: 3)", coerceInt)
  .option("--json", "Output raw JSON (for scripting)")
  .action(async (dir: string | undefined, opts) => {
    try {
      await runMonitor({
        dir,
        interval: opts.interval,
        once: opts.once,
        json: opts.json,
      });
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });
```

- [ ] **Step 2: Register the subcommand in cli/index.ts**

At the top of `src/cli/index.ts`, add the import:

```typescript
import { monitorCommand } from "./monitor.js";
```

Before the `program.parse()` line at the bottom, add:

```typescript
program.addCommand(monitorCommand);
```

- [ ] **Step 3: Verify it compiles and help works**

Run: `make -f dev.mk build && npx cpc monitor --help`
Expected: Shows monitor command help text

- [ ] **Step 4: Commit**

```bash
git add src/cli/monitor.ts src/cli/index.ts
git commit -m "feat(monitor): add cpc monitor CLI subcommand"
```

---

## Chunk 5: Pipeline Integration

### Task 10: Thread `onStatusMessage` through the pipeline

This task adds the optional callback parameter to all session-running functions and wires the status server into the CLI commands. This is the largest integration task.

**Files:**
- Modify: `src/merge/strategy.ts`
- Modify: `src/merge/index.ts`
- Modify: `src/merge/strategies/simple.ts`
- Modify: `src/merge/strategies/agent-teams.ts`
- Modify: `src/merge/strategies/subagent-debate.ts`
- Modify: `src/generate/session-runner.ts`
- Modify: `src/generate/index.ts`
- Modify: `src/evaluate/index.ts`
- Modify: `src/verify/index.ts`
- Modify: `src/verify/pre-mortem.ts`
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add `onStatusMessage` to MergeStrategy interface**

In `src/merge/strategy.ts`, update the `merge` method signature:

```typescript
import type { OnStatusMessage } from "../monitor/types.js";

export interface MergeStrategy {
  readonly name: "simple" | "agent-teams" | "subagent-debate";

  merge(
    plans: PlanSet,
    config: MergeConfig,
    mergePlanPath: string,
    evalResult?: EvalResult,
    onStatusMessage?: OnStatusMessage,
  ): Promise<MergeResult>;
}
```

- [ ] **Step 2: Thread through merge/index.ts using options object**

In `src/merge/index.ts`, change the public `merge` function to accept an options object for the optional params. This avoids awkward `merge(plans, config, undefined, callback)` calls:

```typescript
import type { OnStatusMessage } from "../monitor/types.js";

export interface MergeOptions {
  readonly evalResult?: EvalResult;
  readonly onStatusMessage?: OnStatusMessage;
}

export async function merge(
  plans: PlanSet,
  config: MergeConfig,
  options: MergeOptions = {},
): Promise<MergeResult> {
  // ... existing validation ...
  return strategy.merge(filteredPlanSet, config, mergePlanPath, options.evalResult, options.onStatusMessage);
}
```

**IMPORTANT:** Update all existing callers of `merge()`:
- `cli/index.ts` line 477: `merge(planSet, mergeConfig, evalResult)` → `merge(planSet, mergeConfig, { evalResult })`
- `cli/index.ts` line 225: `merge(plans, config)` → `merge(plans, config)` (no change needed — default `{}`)
- `pipeline/run.ts` line 54: `merge(planSet, mergeConfig, evalResult)` → `merge(planSet, mergeConfig, { evalResult })`

- [ ] **Step 3: Add callback to all three merge strategies**

In each of `simple.ts`, `agent-teams.ts`, `subagent-debate.ts`:

1. Add `onStatusMessage?: OnStatusMessage` as the last parameter to `merge()`
2. Import `OnStatusMessage` from `../../monitor/types.js`
3. Add `onStatusMessage?.(this.name, msg);` inside the `for await` loop, alongside `progress.onMessage(msg)`

Example for `simple.ts` — the change in the `for await` loop:

```typescript
for await (const msg of query({ ... })) {
  messages.push(msg);
  progress.onMessage(msg);
  onStatusMessage?.(`merge-${this.name}`, msg);
  await logger.write(msg);
}
```

Same pattern for `agent-teams.ts` and `subagent-debate.ts`.

- [ ] **Step 4: Add callback to generate session-runner**

In `src/generate/session-runner.ts`:

1. Import: `import type { OnStatusMessage } from "../monitor/types.js";`
2. Add `onStatusMessage?: OnStatusMessage` as 4th parameter to `runVariantSession()`
3. Add `onStatusMessage?.(vp.variant.name, msg);` in the `for await` loop (line ~140, after `progress.onMessage(msg)`)
4. Add `onStatusMessage?: OnStatusMessage` as 4th parameter to `runParallelSessions()` and `runSequentialSessions()`
5. Pass it through: `return runVariantSession(vp, config, parentSignal, onStatusMessage);`

In `src/generate/index.ts`:

1. Import: `import type { OnStatusMessage } from "../monitor/types.js";`
2. Add `readonly onStatusMessage?: OnStatusMessage` to `GenerateOptions`
3. At line 127-128, pass it through:
   - `runParallelSessions(variantPrompts, resolvedConfig, options.signal, options.onStatusMessage)`
   - `runSequentialSessions(variantPrompts, resolvedConfig, options.signal, options.onStatusMessage)`

- [ ] **Step 5: Add callback to evaluate/index.ts**

1. Add `onStatusMessage?: OnStatusMessage` to `EvaluateOptions`
2. Add `onStatusMessage?.("evaluate", msg);` in the `for await` loop

- [ ] **Step 6: Add callback to verify/index.ts and pre-mortem.ts**

In `verify/index.ts`:
1. Add `onStatusMessage?: OnStatusMessage` to `VerifyOptions`
2. Add `onStatusMessage?.("verify", msg);` in the `for await` loop

In `verify/pre-mortem.ts`:
1. Add `onStatusMessage?: OnStatusMessage` to `PreMortemOptions`
2. Add `onStatusMessage?.("pre-mortem", msg);` in the `for await` loop

- [ ] **Step 7: Wire status server into cli/index.ts `run` action**

In the `run` action handler in `src/cli/index.ts`, add status server lifecycle.

**First**, add a `setOutputDir()` method to `StatusCollector` (in `src/monitor/status-collector.ts`):

```typescript
  /** Update output directory (set after generate determines runDir) */
  setOutputDir(dir: string): void {
    (this as any).outputDir = dir;
  }
```

And change `private readonly outputDir` to `private outputDir` in the class declaration.

**Then** add imports to `cli/index.ts`:

```typescript
import * as os from "node:os";
import { StatusCollector } from "../monitor/status-collector.js";
import { StatusServer } from "../monitor/status-server.js";
```

At the top of the `run` action, before generating:

```typescript
// Start status server for monitoring
const collector = new StatusCollector({
  pid: process.pid,
  command: "run",
  configPath: opts.config ?? opts.mergeConfig ?? "",
  outputDir: "",
});
const statusServer = new StatusServer(collector);
const socketPath = `${os.tmpdir()}/cpc-${process.pid}.sock`;
await statusServer.start(socketPath);

// Ensure cleanup via existing AbortController (not separate signal handlers)
controller.signal.addEventListener("abort", () => {
  statusServer.stop();
}, { once: true });

const onStatusMessage = collector.createCallback();
```

Pass `onStatusMessage` to each stage. Note the `merge()` call uses the new options object:

```typescript
// Generate
collector.setStage("generating");
const planSet = await generate(genConfig, { ...generateOpts, onStatusMessage });
collector.setOutputDir(planSet.runDir);

// Evaluate
collector.setStage("evaluating");
const evalResult = await evaluate(planSet, mergeConfig, { signal: controller.signal, onStatusMessage });

// Merge
collector.setStage("merging");
const mergeResult = await merge(planSet, mergeConfig, { evalResult, onStatusMessage });

// Verify
collector.setStage("verifying");
const verifyResult = await verify(mergeResult, planSet, { ...verifyOpts, onStatusMessage });
```

After pipeline completes (in the finally/success path):

```typescript
collector.setStage("done");
await statusServer.stop();
```

- [ ] **Step 8: Wire status server into standalone commands (generate, merge, evaluate, verify)**

Apply the same pattern (create collector, start server, pass callback, stop server) to each standalone CLI command action. The collector's `command` field differs (`"generate"`, `"merge"`, `"evaluate"`, `"verify"`).

- [ ] **Step 9: Run full test suite**

Run: `make -f dev.mk check`
Expected: PASS (all existing tests still pass — the new parameter is optional everywhere)

- [ ] **Step 10: Commit**

```bash
git add src/merge/strategy.ts src/merge/index.ts src/merge/strategies/simple.ts \
  src/merge/strategies/agent-teams.ts src/merge/strategies/subagent-debate.ts \
  src/generate/session-runner.ts src/generate/index.ts \
  src/evaluate/index.ts src/verify/index.ts src/verify/pre-mortem.ts \
  src/cli/index.ts
git commit -m "feat(monitor): wire status server into pipeline with onStatusMessage callback"
```

---

### Task 11: Final integration test

**Files:**
- Create: `test/monitor/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// test/monitor/integration.test.ts
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import * as path from "node:path";
import { StatusCollector } from "../../src/monitor/status-collector.js";
import { StatusServer } from "../../src/monitor/status-server.js";
import { discoverSockets, fetchStatus } from "../../src/monitor/process-discovery.js";
import { renderTable } from "../../src/monitor/table-renderer.js";

const TMPDIR = process.env["TMPDIR"] ?? "/private/tmp/claude-501";

describe("monitor integration", () => {
  let server: StatusServer | undefined;

  afterEach(async () => {
    if (server) await server.stop();
    server = undefined;
  });

  it("full flow: collector → server → discovery → render", async () => {
    // 1. Create collector and simulate pipeline activity
    const collector = new StatusCollector({
      pid: process.pid,
      command: "run",
      configPath: "projects/test-project/config.yaml",
      outputDir: "/tmp/test",
    });

    collector.setStage("generating");
    collector.registerSession("plan-01-alpha");
    collector.onMessage("plan-01-alpha", {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/src/foo.ts" } },
          { type: "tool_use", name: "Glob", input: { pattern: "**/*.ts" } },
        ],
        usage: { input_tokens: 5000, output_tokens: 1200 },
      },
    });

    // 2. Start server
    const socketPath = path.join(TMPDIR, `cpc-${process.pid}.sock`);
    server = new StatusServer(collector);
    await server.start(socketPath);

    // 3. Fetch status via HTTP
    const state = await fetchStatus(socketPath);
    expect(state.pid).toBe(process.pid);
    expect(state.stage).toBe("generating");
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.turns).toBe(1);
    expect(state.sessions[0]!.toolCalls).toBe(2);

    // 4. Render table
    const output = renderTable(state, { noColor: true });
    expect(output).toContain("test-project");
    expect(output).toContain("plan-01-alpha");
    expect(output).toContain("Read(1)");
    expect(output).toContain("Glob(1)");

    // 5. Cleanup
    await server.stop();
    server = undefined;
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `make -f dev.mk test -- test/monitor/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full suite**

Run: `make -f dev.mk check`
Expected: PASS (all tests green, build passes, lint passes)

- [ ] **Step 4: Commit**

```bash
git add test/monitor/integration.test.ts
git commit -m "test(monitor): add integration test for full monitor flow"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | 1-3 | Core types, StatusCollector with tests, logger enhancement |
| 2 | 4-5 | HTTP status server, NDJSON parser — both with tests |
| 3 | 6-7 | Table renderer, process discovery — both with tests |
| 4 | 8-9 | Monitor orchestrator, CLI subcommand |
| 5 | 10-11 | Pipeline integration (threading callback), integration test |

Each chunk produces independently testable code. No chunk depends on pipeline integration until Chunk 5, so Chunks 1-4 can be developed without touching existing pipeline code.
