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
