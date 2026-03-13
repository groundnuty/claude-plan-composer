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

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

async function selectPipeline(
  pipelines: readonly {
    socket: { pid: number; socketPath: string };
    state: PipelineState;
  }[],
): Promise<string> {
  const isTTY = process.stdin.isTTY ?? false;

  if (!isTTY) {
    const sorted = [...pipelines].sort(
      (a, b) =>
        new Date(b.state.startedAt).getTime() -
        new Date(a.state.startedAt).getTime(),
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
    console.log(
      `  ${i + 1}) ${name}  (PID ${p.socket.pid}, started ${time}, ${p.state.stage})`,
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `\nWhich process to monitor? [1-${pipelines.length}]: `,
      resolve,
    );
  });
  rl.close();

  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= pipelines.length) {
    throw new Error("Invalid selection");
  }

  return pipelines[idx]!.socket.socketPath;
}

async function buildPostHocState(dir: string): Promise<PipelineState> {
  const entries = await fs.readdir(dir);
  const sessions: SessionState[] = [];
  const logFiles = entries.filter(
    (f) => f.endsWith(".log") || f.endsWith(".ndjson"),
  );

  for (const logFile of logFiles) {
    const logPath = path.join(dir, logFile);
    const summary = await parseNdjsonLog(logPath);
    const name = logFile.replace(/\.(log|ndjson)$/, "");

    let planSize = 0;
    const mdFile = entries.find((f) => f === `${name}.md`);
    if (mdFile) {
      const stat = await fs.stat(path.join(dir, mdFile));
      planSize = stat.size;
    }

    const logStat = await fs.stat(logPath);

    sessions.push({
      name,
      phaseName: summary.phaseName,
      phaseOrdinal: summary.phaseOrdinal,
      status: summary.sessionId ? "done" : "running",
      sessionId: summary.sessionId,
      turns: summary.turns,
      toolCalls: summary.toolCalls,
      toolBreakdown: summary.toolBreakdown,
      agents: { running: 0, total: 0 },
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheCreationTokens: summary.cacheCreationTokens,
      cacheReadTokens: summary.cacheReadTokens,
      totalTokens:
        summary.inputTokens +
        summary.outputTokens +
        summary.cacheCreationTokens +
        summary.cacheReadTokens,
      contextTokens: summary.contextTokens,
      contextPercent:
        summary.contextTokens > 0
          ? Math.round((summary.contextTokens / 200_000) * 100)
          : 0,
      compactions: summary.compactions,
      cost: summary.cost,
      durationMs: summary.durationMs,
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

export async function runMonitor(options: MonitorOptions): Promise<void> {
  const intervalMs = (options.interval ?? 3) * 1000;

  // Post-hoc mode
  if (options.dir) {
    const renderPostHoc = async () => {
      const state = await buildPostHocState(options.dir!);
      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
      } else {
        if (!options.once) clearScreen();
        console.log(renderTable(state, { noColor: !process.stdout.isTTY }));
      }
    };

    await renderPostHoc();
    if (options.once || !options.interval) return;

    // Refresh loop for post-hoc with --interval
    await new Promise<void>((resolve) => {
      let stopped = false;
      const scheduleNext = () => {
        if (stopped) return;
        setTimeout(async () => {
          if (stopped) return;
          await renderPostHoc();
          scheduleNext();
        }, intervalMs);
      };
      process.on("SIGINT", () => {
        stopped = true;
        resolve();
      });
      scheduleNext();
    });
    return;
  }

  // Live mode: discover
  const tmpDir = os.tmpdir();
  const pipelines = await discoverLivePipelines(tmpDir);

  if (pipelines.length === 0) {
    console.error(
      "No running cpc processes found. Specify a run directory: cpc monitor <dir>",
    );
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
        console.log(
          renderTable(state, { previousState, noColor: !process.stdout.isTTY }),
        );
      }

      previousState = state;
      return state.stage === "done";
    } catch {
      console.error("Connection lost. Pipeline may have finished.");
      return true;
    }
  };

  const done = await poll();
  if (options.once || done) return;

  // Recursive setTimeout avoids overlapping async polls
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
