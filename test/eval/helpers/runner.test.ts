import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getEvalMode,
  getConfigDir,
} from "./runner.js";

describe("getEvalMode", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("defaults to quick", () => {
    delete process.env["EVAL_MODE"];
    expect(getEvalMode()).toBe("quick");
  });

  it("reads EVAL_MODE env var", () => {
    process.env["EVAL_MODE"] = "full";
    expect(getEvalMode()).toBe("full");
  });

  it("throws on invalid mode", () => {
    process.env["EVAL_MODE"] = "invalid";
    expect(() => getEvalMode()).toThrow();
  });
});

describe("getConfigDir", () => {
  it("returns test/fixtures/eval for quick mode", () => {
    expect(getConfigDir("quick")).toBe("test/fixtures/eval");
  });

  it("returns eval/configs/full for full mode", () => {
    expect(getConfigDir("full")).toBe("eval/configs/full");
  });
});
