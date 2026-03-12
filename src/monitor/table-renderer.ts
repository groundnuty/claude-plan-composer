// src/monitor/table-renderer.ts

import type { PipelineState, SessionState, ChildState } from "./types.js";

// ── ANSI color codes ────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Conditionally wrap text in ANSI color codes. */
function c(color: string, text: string, noColor: boolean): string {
  if (noColor) return text;
  return `${color}${text}${RESET}`;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Format token count: 0=—, ≥1M=X.XM, ≥1K=XXXK, else string. */
export function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Format byte count: 0=—, ≥1MB, ≥1KB, else NB. */
function formatBytes(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}MB`;
  if (n >= 1_024) return `${Math.round(n / 1_024)}KB`;
  return `${n}B`;
}

/** Format duration in ms: 0=—, ≥60s=XmXXs, else Xs. */
function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds >= 60) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}m${String(s).padStart(2, "0")}s`;
  }
  return `${totalSeconds}s`;
}

/** Format cost: 0=—, else $X.XX. */
function formatCost(cost: number): string {
  if (cost === 0) return "—";
  return `$${cost.toFixed(2)}`;
}

/** Return top N tools sorted by count as "Name(count) Name(count)". */
function topTools(breakdown: Readonly<Record<string, number>>, n: number): string {
  return Object.entries(breakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([name, count]) => `${name}(${count})`)
    .join(" ");
}

/** Compute activity label relative to previous state. */
function activityLabel(
  session: SessionState,
  prev: SessionState | undefined,
  nc: boolean,
): string {
  if (session.status === "done" || session.status === "pending") return "—";
  if (prev === undefined) return c(GREEN, "new", nc);
  const delta = session.turns - prev.turns;
  if (delta > 0) return c(GREEN, `+${delta}`, nc);
  return c(DIM, "idle", nc);
}

/** Color-code status string. */
function statusColor(status: SessionState["status"], nc: boolean): string {
  switch (status) {
    case "running": return c(GREEN, status, nc);
    case "done": return c(DIM, status, nc);
    case "failed": return c(RED, status, nc);
    case "pending": return c(DIM, status, nc);
  }
}

/** Extract project name from "projects/NAME/config.yaml" pattern. */
function projectName(configPath: string): string {
  const match = /projects\/([^/]+)\//.exec(configPath);
  return match ? match[1] : configPath;
}

/** Strip ANSI escape codes from a string to measure its display length. */
function visibleLength(s: string): number {
  return s.replace(ANSI_PATTERN, "").length;
}

/** Left-align string within width, padding with spaces (ANSI-aware). */
function leftAlign(s: string, w: number): string {
  const len = visibleLength(s);
  const pad = Math.max(0, w - len);
  return s + " ".repeat(pad);
}

/** Right-align string within width, padding with spaces (ANSI-aware). */
function rightAlign(s: string, w: number): string {
  const len = visibleLength(s);
  const pad = Math.max(0, w - len);
  return " ".repeat(pad) + s;
}

/** Build a Map from session name to SessionState for quick prev lookup. */
function prevLookup(prev?: PipelineState): Map<string, SessionState> {
  if (!prev) return new Map();
  return new Map(prev.sessions.map((s) => [s.name, s]));
}

// ── Column widths ───────────────────────────────────────────────────────────

const COL = {
  variant: 26,
  status: 10,
  session: 10,
  turns: 5,
  tools: 5,
  agents: 6,
  input: 6,
  output: 6,
  cacheCreate: 7,
  cacheRead: 7,
  total: 7,
  ctx: 10,
  compactions: 3,
  activity: 8,
} as const;

// ── Row renderers ───────────────────────────────────────────────────────────

/** Render the main columns for a session row. */
function renderSessionRow(
  s: SessionState,
  prev: SessionState | undefined,
  nc: boolean,
): string {
  const cols = [
    leftAlign(c(CYAN, s.name, nc), COL.variant),
    leftAlign(statusColor(s.status, nc), COL.status),
    leftAlign(s.sessionId.slice(0, 8), COL.session),
    rightAlign(String(s.turns), COL.turns),
    rightAlign(String(s.toolCalls), COL.tools),
    rightAlign(`${s.agents.running}/${s.agents.total}`, COL.agents),
    rightAlign(formatTokens(s.inputTokens), COL.input),
    rightAlign(formatTokens(s.outputTokens), COL.output),
    rightAlign(formatTokens(s.cacheCreationTokens), COL.cacheCreate),
    rightAlign(formatTokens(s.cacheReadTokens), COL.cacheRead),
    rightAlign(formatTokens(s.totalTokens), COL.total),
    rightAlign(`${formatTokens(s.contextTokens)}(${s.contextPercent}%)`, COL.ctx),
    rightAlign(String(s.compactions), COL.compactions),
    rightAlign(activityLabel(s, prev, nc), COL.activity),
    ` ${c(DIM, s.lastAction.slice(0, 40), nc)}`,
  ];
  return cols.join(" ");
}

/** Render detail rows showing log/plan size and tool breakdown. */
function renderDetailRows(s: SessionState, nc: boolean): string {
  const indent = "  ";
  const tools = topTools(s.toolBreakdown, 5);
  const duration = formatDuration(s.durationMs);
  const cost = formatCost(s.cost);
  const log = formatBytes(s.logSize);
  const plan = formatBytes(s.planSize);

  const sizeLine = `${indent}${c(DIM, `log:${log}  plan:${plan}  dur:${duration}  cost:${cost}`, nc)}`;
  const toolLine = `${indent}${c(DIM, tools, nc)}`;
  const actionLine = `${indent}\u2514\u2500 ${c(DIM, s.lastAction, nc)}`;

  return [sizeLine, toolLine, actionLine].join("\n");
}

/** Render child rows with tree-drawing characters. */
function renderChildRows(children: readonly ChildState[], nc: boolean): string {
  return children
    .map((child, idx) => {
      const isLast = idx === children.length - 1;
      const prefix = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
      const name = leftAlign(c(YELLOW, prefix + child.name, nc), COL.variant);
      const status = leftAlign(
        child.status === "running" ? c(GREEN, child.status, nc) : c(DIM, child.status, nc),
        COL.status,
      );
      const cols = [
        name,
        status,
        leftAlign("", COL.session),
        rightAlign(String(child.turns), COL.turns),
        rightAlign(String(child.toolCalls), COL.tools),
        rightAlign("", COL.agents),
        rightAlign(formatTokens(child.inputTokens), COL.input),
        rightAlign(formatTokens(child.outputTokens), COL.output),
        rightAlign(formatTokens(child.cacheCreationTokens), COL.cacheCreate),
        rightAlign(formatTokens(child.cacheReadTokens), COL.cacheRead),
        rightAlign(formatTokens(child.totalTokens), COL.total),
        ` ${c(DIM, child.lastAction.slice(0, 40), nc)}`,
      ];
      return cols.join(" ");
    })
    .join("\n");
}

// ── Stage grouping ──────────────────────────────────────────────────────────

type Stage = "generate" | "evaluate" | "merge" | "verify" | "other";

/** Group sessions by pipeline stage based on name prefix. */
function groupByStage(sessions: readonly SessionState[]): Map<Stage, SessionState[]> {
  const groups = new Map<Stage, SessionState[]>();
  for (const s of sessions) {
    let stage: Stage;
    if (s.name.startsWith("plan-")) stage = "generate";
    else if (s.name.startsWith("evaluate")) stage = "evaluate";
    else if (s.name.startsWith("merge")) stage = "merge";
    else if (s.name.startsWith("verify") || s.name.startsWith("pre-mortem")) stage = "verify";
    else stage = "other";

    const existing = groups.get(stage);
    if (existing !== undefined) {
      existing.push(s);
    } else {
      groups.set(stage, [s]);
    }
  }
  return groups;
}

// ── Column header line ──────────────────────────────────────────────────────

function renderColumnHeaders(nc: boolean): string {
  const header = [
    leftAlign("VARIANT", COL.variant),
    leftAlign("STATUS", COL.status),
    leftAlign("SESSION", COL.session),
    rightAlign("TURN", COL.turns),
    rightAlign("TOOL", COL.tools),
    rightAlign("AGNT", COL.agents),
    rightAlign("IN", COL.input),
    rightAlign("OUT", COL.output),
    rightAlign("CACHE+", COL.cacheCreate),
    rightAlign("CACHE>", COL.cacheRead),
    rightAlign("TOTAL", COL.total),
    rightAlign("CTX", COL.ctx),
    rightAlign("C#", COL.compactions),
    rightAlign("ACT", COL.activity),
    " LAST ACTION",
  ].join(" ");
  return c(BOLD, header, nc);
}

// ── Totals footer ───────────────────────────────────────────────────────────

function renderTotalsFooter(
  state: PipelineState,
  sessions: readonly SessionState[],
  nc: boolean,
): string {
  const totalTokens = sessions.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
  const running = sessions.filter((s) => s.status === "running").length;
  const done = sessions.filter((s) => s.status === "done").length;
  const failed = sessions.filter((s) => s.status === "failed").length;

  const parts = [
    `stage:${c(CYAN, state.stage, nc)}`,
    `sessions:${sessions.length}`,
    `running:${c(GREEN, String(running), nc)}`,
    `done:${String(done)}`,
    failed > 0 ? `failed:${c(RED, String(failed), nc)}` : null,
    `tokens:${formatTokens(totalTokens)}`,
    `cost:${formatCost(totalCost)}`,
  ].filter((p): p is string => p !== null);

  return parts.join("  ");
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RenderOptions {
  readonly noColor?: boolean;
  readonly previousState?: PipelineState;
}

/**
 * Render a full monitoring table for the given pipeline state.
 * Returns a multi-line string ready to print to the terminal.
 */
export function renderTable(state: PipelineState, options: RenderOptions): string {
  const nc = options.noColor ?? false;
  const lookup = prevLookup(options.previousState);

  const lines: string[] = [];

  // Header
  const project = projectName(state.configPath);
  const elapsed = formatDuration(
    Date.now() - new Date(state.startedAt).getTime(),
  );
  lines.push(
    c(BOLD, `cpc monitor — ${project}`, nc) +
    `  pid:${state.pid}  cmd:${state.command}  elapsed:${elapsed}`,
  );
  lines.push("─".repeat(120));

  // Column headers
  lines.push(renderColumnHeaders(nc));
  lines.push("─".repeat(120));

  // Group sessions by stage and render
  const groups = groupByStage(state.sessions);
  let firstGroup = true;
  for (const [stage, sessions] of groups) {
    if (!firstGroup) lines.push("");
    firstGroup = false;

    lines.push(c(DIM, `── ${stage} `, nc) + c(DIM, "─".repeat(Math.max(0, 60 - stage.length - 4)), nc));

    for (const session of sessions) {
      const prev = lookup.get(session.name);
      lines.push(renderSessionRow(session, prev, nc));
      lines.push(renderDetailRows(session, nc));
      if (session.children.length > 0) {
        lines.push(renderChildRows(session.children, nc));
      }
    }
  }

  // Separator + totals
  lines.push("─".repeat(120));
  lines.push(renderTotalsFooter(state, state.sessions, nc));

  return lines.join("\n");
}
