import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "examples/**",
        "test/**",
        "*.config.ts",
        "*.config.js",
        "src/types.ts", // Type definitions only, no runtime code
      ],
      include: ["src/**/*.ts"],
      thresholds: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
    },
    testTimeout: 30000, // 30 seconds for unit tests
    hookTimeout: 10000,
  },
});
