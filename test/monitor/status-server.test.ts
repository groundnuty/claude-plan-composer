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
