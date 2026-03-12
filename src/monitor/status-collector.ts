import type {
  PipelineState,
  SessionState,
  ChildState,
  OnStatusMessage,
} from "./types.js";

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

export interface InitOptions {
  readonly pid: number;
  readonly command: string;
  readonly configPath: string;
  readonly outputDir: string;
}

export class StatusCollector {
  private readonly pid: number;
  private readonly startedAt: string;
  private readonly command: string;
  private readonly configPath: string;
  private outputDir: string;
  private stage = "idle";
  private readonly sessions = new Map<string, MutableSession>();

  constructor(opts: InitOptions) {
    this.pid = opts.pid;
    this.startedAt = new Date().toISOString();
    this.command = opts.command;
    this.configPath = opts.configPath;
    this.outputDir = opts.outputDir;
  }

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

  setStage(stage: string): void {
    this.stage = stage;
  }

  setOutputDir(dir: string): void {
    this.outputDir = dir;
  }

  completeSession(name: string, status: "done" | "failed"): void {
    const s = this.sessions.get(name);
    if (s) s.status = status;
  }

  updateSizes(name: string, logSize: number, planSize: number): void {
    const s = this.sessions.get(name);
    if (s) {
      s.logSize = logSize;
      s.planSize = planSize;
    }
  }

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

  createCallback(): OnStatusMessage {
    return (sessionName: string, msg: unknown) => {
      this.onMessage(sessionName, msg);
    };
  }

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

  private handleAssistant(s: MutableSession, m: Record<string, unknown>): void {
    s.turns++;
    const message = m.message as Record<string, unknown> | undefined;
    const content = message?.content;

    const usage = message?.usage as Record<string, number> | undefined;
    if (usage) {
      s.inputTokens += usage.input_tokens ?? 0;
      s.outputTokens += usage.output_tokens ?? 0;
      s.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      s.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
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

      if (name === "TeamCreate") {
        this.handleTeamCreate(s, tool.input as Record<string, unknown>);
      }

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
