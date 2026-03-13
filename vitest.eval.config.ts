import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/eval/**/*.test.ts"],
    testTimeout: 600_000,
    globals: true,
  },
});
