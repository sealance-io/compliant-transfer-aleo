import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.{js,ts,jsx,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "packages/**"],
    globals: true,
    environment: "node", // Default environment
    typecheck: {
      tsconfig: "./tsconfig.vitest.json",
      enabled: true,
    },
    testTimeout: 3000000,
    hookTimeout: 3000000,
    teardownTimeout: 30000,

    // 1. No file-level parallelism: run test files one after another
    fileParallelism: false,

    // 2. No worker threads or child-process forks: single thread + single fork
    poolOptions: {
      threads: { singleThread: true },
      forks: { singleFork: true },
    },

    // 3. Strict sequence ordering, no concurrency or shuffling
    sequence: {
      shuffle: {
        files: false,
        tests: false,
      },
      concurrent: false,
      hooks: "stack", // run hooks in LIFO/stack order for before/after hooks
      setupFiles: "list", // load setup files in the order defined
    },

    globalSetup: "./vitest.global-setup.ts",
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["verbose"],
  },
  resolve: {
    // Similar to Jest's moduleNameMapper for .js extensions
    extensions: [".js", ".ts", ".jsx", ".tsx", ".json"],
    alias: {
      "@sealance-io/policy-engine-aleo": resolve(__dirname, "packages/policy-engine-sdk/src/index.ts"),
    },
  },
});
