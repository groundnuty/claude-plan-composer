import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    exclude: ["test/e2e/**", "test/eval/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**"],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
});
