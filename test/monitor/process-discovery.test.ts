import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverSockets, fetchStatus } from "../../src/monitor/process-discovery.js";

const TMPDIR = process.env["TMPDIR"] ?? os.tmpdir();

describe("discoverSockets", () => {
  it("finds cpc-*.sock files in tmpdir", async () => {
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
