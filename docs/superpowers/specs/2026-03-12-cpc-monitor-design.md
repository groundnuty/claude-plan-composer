# `cpc monitor` — Live Pipeline Monitoring

## Goal

Add a `cpc monitor` CLI command that provides real-time visibility into running `cpc` pipelines, matching the data richness of the bash `monitor-sessions.sh --summary` while leveraging the Agent SDK's structured event stream.

## Architecture

Two-part feature:
1. **Status server**: HTTP-over-Unix-socket exposed by every `cpc` pipeline command (`run`, `generate`, `merge`, `evaluate`, `verify`). Pipeline stages update an in-memory state object as SDK events flow through. Serves `GET /status` returning the full pipeline state as JSON.
2. **Monitor client**: `cpc monitor` CLI command that discovers running pipelines via process table + socket connection, polls `/status`, and renders a bash-style summary table with auto-refresh.

The status server uses Node.js built-in `http.createServer()` listening on a Unix domain socket at `$TMPDIR/cpc-<pid>.sock`. This is the Docker/nginx pattern for local daemon status — standard, curl-debuggable, extensible for future telemetry endpoints.

## Tech Stack

- Node.js `http` (built-in) — status server
- Node.js `net` / `http.get()` — monitor client
- Node.js `child_process.execSync` — process discovery via `ps`
- No new dependencies

---

## Part 1: Status Server

### 1.1 State Model

```typescript
interface PipelineState {
  readonly pid: number;
  readonly startedAt: string;           // ISO 8601
  readonly command: string;             // "run" | "generate" | "merge" | "evaluate" | "verify"
  readonly configPath: string;          // resolved config file path
  readonly outputDir: string;           // run directory path
  readonly stage: string;               // "generating" | "evaluating" | "merging" | "verifying" | "done"
  readonly sessions: readonly SessionState[];
}

interface SessionState {
  readonly name: string;                // e.g. "plan-01-maintainability", "merge-agent-teams"
  readonly status: "pending" | "running" | "done" | "failed";
  readonly sessionId: string;
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Record<string, number>;  // tool name -> count
  readonly agents: AgentCount;          // { running: number, total: number }
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;         // computed sum
  readonly contextTokens: number;       // current context size
  readonly contextPercent: number;      // contextTokens / model context window
  readonly compactions: number;         // compact_boundary events
  readonly cost: number;                // USD
  readonly durationMs: number;          // wall clock since session start
  readonly lastAction: string;          // last tool name + first arg
  readonly logSize: number;             // bytes written to .log file
  readonly planSize: number;            // bytes of output .md file (0 if not yet written)
  readonly children: readonly ChildState[];  // subagents and team members
}

interface ChildState {
  readonly type: "task" | "team-member";
  readonly name: string;                // task description or teammate name
  readonly taskId: string | null;       // SDK task ID (Agent tool) or null (TeamCreate members)
  readonly status: "pending" | "running" | "done" | "failed";
  readonly turns: number;
  readonly toolCalls: number;
  readonly toolBreakdown: Record<string, number>;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  readonly totalTokens: number;
  readonly lastAction: string;
}

interface AgentCount {
  readonly running: number;
  readonly total: number;
}
```

### 1.2 StatusCollector Dependency Injection

The `StatusCollector` is threaded through the pipeline via an optional callback parameter added to each session-running function. This avoids global state while keeping the change minimal.

**Pattern:**

```typescript
// status-collector.ts exports a factory
export type OnMessage = (sessionName: string, msg: unknown) => void;

export function createStatusCollector(state: PipelineStateManager): OnMessage {
  return (sessionName: string, msg: unknown) => {
    state.updateSession(sessionName, msg);
  };
}
```

**Threading through the pipeline:**

1. `cli/index.ts` (the `run` action, which implements the full pipeline inline — NOT `pipeline/run.ts`) creates a `PipelineStateManager` and starts the status server.
2. It creates an `onMessage` callback via `createStatusCollector(state)`.
3. It passes `onMessage` to each stage function as an optional parameter:
   - `generate(config, { ..., onStatusMessage })` → forwarded to `runParallelSessions()` → each `runVariantSession()` calls `onStatusMessage(variantName, msg)` in the `for await` loop
   - `merge(planSet, config, evalResult, { onStatusMessage })` → strategy's `merge()` calls `onStatusMessage("merge-" + strategy, msg)`
   - `evaluate(planSet, config, { ..., onStatusMessage })` → calls `onStatusMessage("evaluate", msg)`
   - `verify(mergeResult, planSet, { ..., onStatusMessage })` → calls `onStatusMessage("verify", msg)`
4. When `onStatusMessage` is not provided (e.g., running `cpc generate` standalone without the status server), the callback is simply not called. No behavior change.

**Note on `pipeline/run.ts`:** This file exists but is NOT used by the CLI's `run` action (the CLI implements the pipeline inline in `cli/index.ts`). The status server hooks go into `cli/index.ts` directly. `pipeline/run.ts` may be updated for library-API users in a future refactor.

### 1.3 State Update from SDK Events

The existing `for await (const msg of query(...))` loop in session runners already processes every SDK event. The `onStatusMessage` callback is called alongside the existing `SessionProgress.onMessage()` and `NdjsonLogger.write()`.

Event-to-state mapping:

| SDK Event Type | State Update |
|----------------|--------------|
| `assistant` (with `tool_use` content) | `turns++`, `toolCalls += N`, update `toolBreakdown`, set `lastAction` |
| `assistant` (text only) | `turns++` |
| `system` with `compact_boundary` | `compactions++` |
| `result` (success) | Set `status = "done"`, extract final `cost`, `sessionId`, `modelUsage` |
| `result` (error) | Set `status = "failed"` |
| `tool_progress` | Update `lastAction` with tool name |
| `task_started` | Add child to `children[]` with `status = "running"` (Agent tool subagents) |
| `task_progress` | Update child's usage stats |
| `task_notification` (completed/failed) | Update child's `status`, final usage |

**Agent Teams (TeamCreate/SendMessage) child tracking:**

The `TeamCreate` and `SendMessage` tools do not emit separate SDK event types (`task_started`, etc.). Instead, team activity is detected from tool_use content blocks within assistant messages:

- When `tool_use.name === "TeamCreate"`: parse the input to extract team member names, add children with `type: "team-member"` and `status: "running"` to the parent session's `children[]`.
- When `tool_use.name === "SendMessage"`: update the targeted child's `turns++` and `lastAction`. The tool result contains the team member's response — use this to track activity.
- When `tool_use.name === "TeamDelete"`: set all team children's `status` to `"done"`.

This means team member visibility is coarser than Agent-tool subagent visibility (we see message-level activity, not per-turn internal state), which is acceptable and matches what the bash monitor shows for agent-teams.

**Token tracking:** `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens` are accumulated from the `usage` field in assistant messages. `contextTokens` is the latest `input_tokens` value (approximates current context size).

**Cost for in-progress sessions:** The `cost` field is `0` until the session completes (the `result` event provides `total_cost_usd`). The totals footer estimates in-progress cost from token counts using known pricing rates as a best-effort approximation.

**Duration tracking:** Each session records `startedAt = Date.now()` when its first event arrives. `durationMs` is computed as `Date.now() - startedAt` on each status poll.

### 1.4 Server Lifecycle

- **Start**: Called at the beginning of any pipeline command (`run`, `generate`, `merge`, `evaluate`, `verify`). Creates socket at `os.tmpdir()/cpc-<pid>.sock` (uses Node.js `os.tmpdir()` for portability — not `$TMPDIR` env var directly).
- **Endpoint**: `GET /status` returns `PipelineState` as JSON (`Content-Type: application/json`).
- **Shutdown**: On pipeline completion, SIGINT, or SIGTERM — close server, unlink socket file. The existing `AbortController` signal handling in `cli/index.ts` is extended to trigger shutdown.
- **Crash cleanup**: If the process crashes without cleanup, stale sockets are detected by the monitor (PID not alive via `process.kill(pid, 0)`).

### 1.5 Integration Points

The status server is wired into `cli/index.ts` (which implements the full pipeline inline in its `run` action):

**Level 1 — CLI orchestrator** (`cli/index.ts`):
- Start status server before first stage in each command action (`run`, `generate`, `merge`, `evaluate`, `verify`)
- Update `stage` field at each transition (generating → evaluating → merging → verifying → done)
- Register shutdown on completion/signal via existing `AbortController`

**Level 2 — Session runners** (`generate/session-runner.ts`, `merge/strategies/*.ts`, `evaluate/index.ts`, `verify/index.ts`):
- Each function gains an optional `onStatusMessage?: (name: string, msg: unknown) => void` parameter
- Before `query()`: caller registers session as `"running"` in state
- Inside `for await` loop: call `onStatusMessage?.(sessionName, msg)` alongside existing `progress.onMessage(msg)`
- After `query()`: caller marks session `"done"` or `"failed"`

**Level 3 — Computed fields**:
- `logSize`: exposed via `NdjsonLogger.bytesWritten` getter (delegates to `stream.bytesWritten`)
- `planSize`: checked after session completes (file exists on disk)
- `contextPercent`: `contextTokens / MODEL_CONTEXT_LIMITS[model]` where limits are:

```typescript
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  // fallback for unknown models
  default: 200_000,
};
```

---

## Part 2: Monitor Client

### 2.1 CLI Interface

```
cpc monitor              # auto-discover running cpc process, attach
cpc monitor <dir>        # post-hoc: read files from completed run directory
cpc monitor --once       # single snapshot, no refresh loop
cpc monitor --interval 5 # poll every N seconds (default: 3)
cpc monitor --json       # raw JSON from /status (for scripting/telemetry)
```

### 2.2 Auto-Discovery

1. Scan `os.tmpdir()` for files matching `cpc-*.sock` glob pattern. This is the primary discovery mechanism — only processes that started a status server will have sockets.
2. For each socket, verify the PID (extracted from filename) is still alive via `process.kill(pid, 0)`. Remove stale sockets from crashed processes.
3. For each live socket, connect and fetch `GET /status` to get `PipelineState` (config name, stage, etc.).
4. **0 reachable**: Print "No running cpc processes found. Specify a run directory: `cpc monitor <dir>`" and exit.
5. **1 reachable**: Attach automatically.
6. **Multiple reachable**: If stdin is a TTY, present interactive selection:

```
Multiple cpc processes found:

  1) daytrader-t2  (PID 12345, started 12:06, generating 4 lenses)
  2) nier-case     (PID 12400, started 12:10, merging)

Which process to monitor? [1-2]:
```

Selection uses stdin readline. The display extracts config name from `PipelineState.configPath` and current stage from `PipelineState.stage`.

**Non-TTY behavior:** If stdin is not a TTY (piped, non-interactive shell), auto-select the most recently started process. Print which process was selected to stderr.

### 2.3 Display Format

Matches bash `monitor-sessions.sh --summary` column layout.

**Header:**
```
cpc monitor — daytrader-t2 (PID 12345, started 12:06)
```

**Column definitions (default view):**

| Column | Width | Source | Format |
|--------|-------|--------|--------|
| Variant | 25 | `session.name` | left-aligned, truncated |
| Status | 12 | `session.status` | colored (GREEN=running, DIM=done, RED=failed) |
| Session | 10 | `session.sessionId` (first 8 chars) | right-aligned |
| Turns | 5 | `session.turns` | right-aligned |
| Tools | 5 | `session.toolCalls` | right-aligned |
| Agents | 6 | `session.agents` as `R/T` | right-aligned |
| Input | 6 | `session.inputTokens` | human-formatted (K/M) |
| Output | 6 | `session.outputTokens` | human-formatted |
| Cache+ | 7 | `session.cacheCreationTokens` | human-formatted |
| Cache> | 7 | `session.cacheReadTokens` | human-formatted |
| Total | 7 | `session.totalTokens` | human-formatted |
| Ctx | 8 | `session.contextPercent` | `{tokens} {pct}%`, colored |
| C# | 3 | `session.compactions` | RED if >0 |
| Activity | 8 | delta detection (see below) | colored |
| Last Action | 40+ | `session.lastAction` | truncated |

**Detail rows (below each session):**
```
                           Log: 2.1MB  Plan: 34KB  Read(15) Glob(8) Bash(6) Write(4) WebFetch(2)
                           └─ Read src/auth/SecurityModule.java
```

- Row 2: `logSize`, `planSize`, top 5 from `toolBreakdown`
- Row 3: Full `lastAction` with tree character

**Child rows (indented under parent, for agent-teams/subagent sessions):**
```
merge-agent-teams  RUNNING     25     15     4/4   120K    28K    95K    70K   313K  180K 90%  0  +12   SendMessage advocate-team
  ├ reliability    RUNNING      8      3     —/—    30K     8K     —      —    38K     —   —   —  +3    Read OrderService.java
  ├ security       RUNNING      6      2     —/—    25K     6K     —      —    31K     —   —   —  +2    Grep "auth.*token"
  ├ performance    IDLE         —      —     —/—     —      —      —      —     —      —   —   —   —    (waiting)
  └ maintainability DONE        5      2     —/—    20K     5K     —      —    25K     —   —   —   —    (responded)
```

**Activity tracking:**
- Between polls, compare `turns` to previous snapshot (turns are the stable metric — they increment discretely per assistant response)
- `"new"` (CYAN): session appeared since last poll
- `"+N"` (GREEN): N new turns since last poll
- `"idle"` (YELLOW): no change but session is running
- `"—"` (DIM): session is done or pending

**Section headers** (when running full pipeline):
```
── GENERATE ──────────────────────────────────────────────────────
[session rows]

── EVALUATE ──────────────────────────────────────────────────────
[session rows or file status]

── MERGE ─────────────────────────────────────────────────────────
[session rows with children]

── VERIFY ────────────────────────────────────────────────────────
[session rows or file status]
```

**Totals footer:**
```
Status: generating — 1/4 stages done
Plans:  2 done, 2 running, 0 failed
Tokens: 380K input, 84K output, 190K cache+, 95K cache> (749K total)
Cost:   $4.94
```

### 2.4 Post-Hoc Mode

When `cpc monitor <dir>` is given a directory instead of auto-discovering:
- No socket connection — read files directly from the directory
- Parse `plan-*.meta.json` files for completed generation session metadata (model, turns, cost, tokens, duration)
- Parse NDJSON `*.log` files for session event data (turns, tools, tokens, last action)
- Read `merge-result.json` for completed merge metadata
- Read `evaluation.json` and `verification-report*.json` for stage completion status
- Render the same table format (single snapshot, no refresh unless `--interval` is set)
- Children/team data is NOT available post-hoc (SDK events not persisted in logs)

NDJSON parsing extracts:
- Turns: count entries where `type === "assistant"`
- Tools: count `tool_use` content blocks within assistant messages
- Tool breakdown: aggregate tool names from `tool_use` blocks
- Tokens: extract from `usage` fields in result entries
- Last action: last `tool_use` block's `name` + first input key
- Compactions: count entries where `type === "system"` with compact-related content
- Context: last known `input_tokens` value

### 2.5 Refresh Behavior

- Clear terminal (`\x1b[2J\x1b[H`) between refreshes
- Default interval: 3 seconds
- `--once` flag: single render, then exit
- Auto-exit when pipeline state shows `stage === "done"` (with one final render)
- Ctrl+C exits cleanly

---

## New Files

```
src/monitor/
  status-server.ts       — HTTP server on Unix socket, PipelineState management
  status-collector.ts    — SDK event → state update logic (called per message)
  process-discovery.ts   — find cpc processes via ps, connect to sockets
  table-renderer.ts      — format summary table with colors, detail rows, children
  ndjson-parser.ts       — parse .log files for post-hoc mode
  monitor.ts             — poll loop orchestrator (socket or post-hoc)
src/cli/monitor.ts       — Commander subcommand definition (wired into cli/index.ts)
```

## Modified Files

```
src/cli/index.ts                       — import monitor subcommand, start/stop status server in each command action, pass onStatusMessage callback to stages
src/generate/session-runner.ts         — add optional onStatusMessage callback param, call in for-await loop
src/generate/index.ts                  — thread onStatusMessage through to session runner
src/merge/strategies/simple.ts         — add optional onStatusMessage callback param, call in for-await loop
src/merge/strategies/agent-teams.ts    — add optional onStatusMessage callback param, call in for-await loop
src/merge/strategies/subagent-debate.ts — add optional onStatusMessage callback param, call in for-await loop
src/merge/strategy.ts                  — add onStatusMessage to MergeStrategy interface
src/merge/index.ts                     — thread onStatusMessage through to strategy
src/evaluate/index.ts                  — add optional onStatusMessage callback param, call in for-await loop
src/verify/index.ts                    — add optional onStatusMessage callback param, call in for-await loop
src/verify/pre-mortem.ts               — add optional onStatusMessage callback param, call in for-await loop
src/pipeline/logger.ts                 — add bytesWritten getter (delegates to stream.bytesWritten)
```

## Design Decisions

1. **HTTP over Unix socket** (not raw TCP, not named pipe): Standard pattern (Docker, nginx), curl-debuggable, extensible for future `/metrics`, `/events` endpoints.

2. **In-memory state, not file-based**: The pipeline process holds all state from SDK events. No intermediate files to write/cleanup. The socket is the only artifact, and it auto-cleans on process exit.

3. **Callback injection, not middleware**: `StatusCollector.onMessage()` is called alongside existing `SessionProgress.onMessage()`. No wrapper, no decorator — just one more function call in the existing `for await` loop.

4. **Post-hoc via NDJSON parsing**: For completed runs, we parse the same `.log` files the pipeline already writes. No new file format needed. Trade-off: child/team data is not available post-hoc (acceptable — live monitoring is the primary use case).

5. **Process discovery via `ps` + socket**: Find PID from process table, derive socket path deterministically. No PID file, no lock file, no registry. Stale sockets from crashed processes are detected by checking if PID is alive.

6. **Activity tracking via snapshot delta**: Store previous poll's token/turn counts. Compare on next poll. Same approach as bash monitor's file-size-based activity detection, but using structured data instead of `stat`.

## Non-Goals

- **Web UI / browser dashboard**: Terminal-only for now. The `/status` JSON endpoint enables future web UIs without any server changes.
- **Historical data / time series**: Monitor shows current state only. Historical analysis is done by reading artifacts post-hoc.
- **Cross-machine monitoring**: Unix sockets are local-only. Remote monitoring would require TCP, which is a future extension.
- **Modifying pipeline behavior from monitor**: Monitor is read-only. No stop/pause/resume commands (use Ctrl+C on the pipeline process directly).
