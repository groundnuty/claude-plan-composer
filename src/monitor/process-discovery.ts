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
