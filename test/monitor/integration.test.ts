import * as os from "node:os";
import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { StatusCollector } from "../../src/monitor/status-collector.js";
import { StatusServer } from "../../src/monitor/status-server.js";
import { fetchStatus } from "../../src/monitor/process-discovery.js";
import { renderTable } from "../../src/monitor/table-renderer.js";

const TMPDIR = process.env["TMPDIR"] ?? os.tmpdir();

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
