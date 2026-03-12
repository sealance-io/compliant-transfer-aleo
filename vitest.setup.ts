// vitest.setup.ts

// In devnode mode (DEVNET unset or false), default SKIP_EXECUTE_PROOF and
// SKIP_DEPLOY_CERTIFICATE to "true" for faster iteration (Leo v3.5.0+).
// Opt out by explicitly setting either to "false".
import { parseBooleanEnv } from "./lib/Env";

const IS_DEVNET_SETUP = parseBooleanEnv(process.env.DEVNET, false);
if (!IS_DEVNET_SETUP) {
  if (process.env.SKIP_EXECUTE_PROOF === undefined || process.env.SKIP_EXECUTE_PROOF === "") {
    process.env.SKIP_EXECUTE_PROOF = "true";
  }
  if (process.env.SKIP_DEPLOY_CERTIFICATE === undefined || process.env.SKIP_DEPLOY_CERTIFICATE === "") {
    process.env.SKIP_DEPLOY_CERTIFICATE = "true";
  }
}

import console from "console";
import type { SuiteHooks } from "vitest";
import { beforeAll, beforeEach, afterEach, afterAll } from "vitest";

// Set up global console
global.console = console;

// Opt-in via environment variables
const ENABLE_HOOK_TIMING = process.env.VITEST_HOOK_TIMING === "true";
const ENABLE_TEST_MARKERS = process.env.VITEST_TEST_MARKERS === "true";

interface HookMetrics {
  totalTime: number;
}

class HookTimer {
  private metrics = new Map<keyof SuiteHooks, HookMetrics>([
    ["beforeAll", { totalTime: 0 }],
    ["beforeEach", { totalTime: 0 }],
    ["afterEach", { totalTime: 0 }],
    ["afterAll", { totalTime: 0 }],
  ]);

  wrapHook<T extends (...args: any[]) => any>(hookName: keyof SuiteHooks, originalHook: T): T {
    return ((...args: Parameters<T>) => {
      const [fn, timeout] = args;

      const wrappedFn = async () => {
        const start = performance.now();

        if (ENABLE_TEST_MARKERS && hookName !== "beforeEach" && hookName !== "afterEach") {
          console.log(`  ⚙️  [HOOK START] ${hookName}`);
        }

        try {
          return await fn();
        } finally {
          const elapsed = performance.now() - start;
          const metrics = this.metrics.get(hookName)!;
          metrics.totalTime += elapsed;

          if (ENABLE_TEST_MARKERS && hookName !== "beforeEach" && hookName !== "afterEach") {
            console.log(`  ⚙️  [HOOK END] ${hookName} (${(elapsed / 1000).toFixed(2)}s)`);
          }
        }
      };

      return originalHook(wrappedFn, timeout);
    }) as T;
  }

  printReport(): void {
    console.log("\n" + "═".repeat(80));
    console.log("  📊 HOOK PERFORMANCE SUMMARY (Entire Test Run)");
    console.log("═".repeat(80));

    let totalTime = 0;

    this.metrics.forEach((metrics, hookName) => {
      const timeInSeconds = (metrics.totalTime / 1000).toFixed(2);

      console.log(`  ${hookName.padEnd(12)} : ${timeInSeconds.padStart(10)}s`);
      totalTime += metrics.totalTime;
    });

    console.log("─".repeat(80));
    console.log(`  ⏱️  Total hook time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log("═".repeat(80) + "\n");
  }
}

// Initialize hook timing if enabled
let hookTimer: HookTimer | null = null;

if (ENABLE_HOOK_TIMING) {
  hookTimer = new HookTimer();

  // Monkey-patch hooks to add timing
  globalThis.beforeAll = hookTimer.wrapHook("beforeAll", globalThis.beforeAll);
  globalThis.beforeEach = hookTimer.wrapHook("beforeEach", globalThis.beforeEach);
  globalThis.afterEach = hookTimer.wrapHook("afterEach", globalThis.afterEach);
  globalThis.afterAll = hookTimer.wrapHook("afterAll", globalThis.afterAll);

  // Since we're in single-threaded mode, register exit handler here
  let reportPrinted = false;

  const printReportOnce = () => {
    if (!reportPrinted && hookTimer) {
      reportPrinted = true;
      hookTimer.printReport();
    }
  };

  // Register multiple handlers to ensure we catch the exit
  process.on("exit", printReportOnce);
  process.on("beforeExit", printReportOnce);

  // Also handle interrupts
  process.once("SIGINT", () => {
    printReportOnce();
    process.exit(130);
  });

  process.once("SIGTERM", () => {
    printReportOnce();
    process.exit(143);
  });
}

// Test execution markers for better visibility (same as before)
if (ENABLE_TEST_MARKERS) {
  let testCounter = 0;
  let suiteCounter = 0;
  let currentSuiteName = "";

  const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
  };

  beforeAll(() => {
    suiteCounter++;
    const worker = (globalThis as any).__vitest_worker__;
    currentSuiteName = worker?.current?.file?.name || `Test Suite #${suiteCounter}`;

    const separator = "▓".repeat(80);
    console.log(`\n${colors.cyan}${separator}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}📁 [TEST SUITE #${suiteCounter}] ${currentSuiteName}${colors.reset}`);
    console.log(`${colors.cyan}${separator}${colors.reset}\n`);
  });

  beforeEach(({ task }: any) => {
    testCounter++;
    const testName = task?.name || "Test";

    const separator = "─".repeat(60);
    console.log(`\n${colors.yellow}${separator}${colors.reset}`);
    console.log(`${colors.bright}🧪 [TEST #${testCounter}] ${testName}${colors.reset}`);
    console.log(`${colors.yellow}${separator}${colors.reset}`);
  });

  afterEach(({ task }: any) => {
    const state = task?.result?.state;
    const startTime = task?.result?.startTime ?? 0;
    const duration = Date.now() - startTime;

    let icon = "✅";
    let color = colors.green;
    let status = "PASSED";

    if (state === "fail") {
      icon = "❌";
      color = colors.red;
      status = "FAILED";
    } else if (state === "skip") {
      icon = "⏭️";
      color = colors.dim;
      status = "SKIPPED";
    }

    console.log(`${color}${icon} [TEST ${status}] (${(duration / 1000).toFixed(2)}s)${colors.reset}`);
    console.log(`${colors.dim}${"─".repeat(60)}${colors.reset}`);
  });

  afterAll(() => {
    const separator = "▓".repeat(80);
    console.log(`\n${colors.cyan}${separator}${colors.reset}`);
    console.log(`${colors.bright}${colors.green}✅ [SUITE COMPLETE] ${currentSuiteName}${colors.reset}`);
    console.log(`${colors.cyan}${separator}${colors.reset}\n`);
  });
}

// This is equivalent to Jest's afterAll hook
afterAll(() => {
  // When a readline interface is created with process.stdin, it creates an active handle
  // that keeps Node's event loop alive indefinitely. Without this fix, the test runner will hang
  // after tests complete, waiting for stdin to close (which never happens).
  // Root cause is at '@doko-js/utils' Shell class

  // allow the process to exit even if stdin/stdout/stderr is still open
  ["stdin", "stdout", "stderr"].forEach(stream => {
    if (process[stream] && typeof process[stream].unref === "function") {
      process[stream].unref();
    }
  });
});
