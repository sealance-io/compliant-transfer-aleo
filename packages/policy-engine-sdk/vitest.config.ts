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
      ],
      include: ["src/**/*.ts"],
      all: true,
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
    testTimeout: 30000, // 30 seconds for unit tests
    hookTimeout: 10000,
  },
});
