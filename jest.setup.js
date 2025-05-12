import console from "console";

global.console = console;

afterAll(() => {
  // When a readline interface is created with process.stdin, it creates an active handle
  // that keeps Node's event loop alive indefinitely. Without this fix, Jest will hang
  // after tests complete, waiting for stdin to close (which never happens).
  // Root cause is at '@doko-js/utils' Shell class

  // allow the process to exit even if stdin/stdout/stderr is still open
  ["stdin", "stdout", "stderr"].forEach(stream => {
    if (process[stream] && typeof process[stream].unref === "function") {
      process[stream].unref();
    }
  });
});
