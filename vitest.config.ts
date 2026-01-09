import { defineConfig } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

/**
 * Custom sequencer that sorts test files alphabetically.
 *
 * By default, Vitest's BaseSequencer uses cached test durations to order files
 * (slower tests run first). This can cause issues when tests share global on-chain
 * state and have implicit ordering dependencies.
 *
 * For example, if upgrade.test.ts (which initializes sealed_report_token in beforeAll)
 * runs before report_token.test.ts (which has a "test initialize" without a guard),
 * the latter test fails because the program is already initialized.
 *
 * Alphabetical ordering ensures predictable test execution order.
 */
class AlphabeticalSequencer extends BaseSequencer {
  async sort(files: string[]) {
    return files.sort();
  }
}

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
      sequencer: AlphabeticalSequencer,
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
