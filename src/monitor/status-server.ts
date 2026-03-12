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

  async start(socketPath: string): Promise<void> {
    this.socketPath = socketPath;

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

  getSocketPath(): string | undefined {
    return this.socketPath;
  }
}
