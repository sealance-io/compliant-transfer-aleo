import console from "console";
import { afterAll } from "vitest";

// Set up global console
global.console = console;

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

  hookTimer.printReport();
});


// vitest.setup.ts
import type { SuiteHooks } from 'vitest';

interface HookMetrics {
  totalTime: number;
  callCount: number;
}

class HookTimer {
  private metrics = new Map<keyof SuiteHooks, HookMetrics>([
    ['beforeAll', { totalTime: 0, callCount: 0 }],
    ['beforeEach', { totalTime: 0, callCount: 0 }],
    ['afterEach', { totalTime: 0, callCount: 0 }],
    ['afterAll', { totalTime: 0, callCount: 0 }],
  ]);

  wrapHook<T extends (...args: any[]) => any>(
    hookName: keyof SuiteHooks,
    originalHook: T
  ): T {
    return ((...args: Parameters<T>) => {
      const [fn, timeout] = args;
      
      const wrappedFn = async () => {
        const start = performance.now();
        const metrics = this.metrics.get(hookName)!;
        metrics.callCount++;
        
        try {
          return await fn();
        } finally {
          metrics.totalTime += performance.now() - start;
        }
      };
      
      return originalHook(wrappedFn, timeout);
    }) as T;
  }

  printReport(): void {
    console.log('\n=== Hook Performance Summary ===');
    
    let totalTime = 0;
    
    this.metrics.forEach((metrics, hookName) => {
      const timeInSeconds = (metrics.totalTime / 1000).toFixed(2);
      console.log(
        `${hookName}: ${timeInSeconds}s (called ${metrics.callCount} times)`
      );
      totalTime += metrics.totalTime;
    });
    
    console.log(`Total hook time: ${(totalTime / 1000).toFixed(2)}s`);
  }
}

// Initialize timer and monkey-patch hooks
const hookTimer = new HookTimer();

globalThis.beforeAll = hookTimer.wrapHook('beforeAll', globalThis.beforeAll);
globalThis.beforeEach = hookTimer.wrapHook('beforeEach', globalThis.beforeEach);
globalThis.afterEach = hookTimer.wrapHook('afterEach', globalThis.afterEach);
globalThis.afterAll = hookTimer.wrapHook('afterAll', globalThis.afterAll);