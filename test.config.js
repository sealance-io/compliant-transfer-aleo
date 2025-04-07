import console from 'console';

global.console = console;

const originalSetRawMode = process.stdin.setRawMode?.bind(process.stdin);

// Clean up TTY listeners after each test
afterEach(() => {
  if (process.stdin.isTTY && originalSetRawMode) {
    try {
      originalSetRawMode(false);
    } catch (e) {
      // Ignore errors
    }
    process.stdin.removeAllListeners('keypress');
  }
});

afterAll(() => {
  // When a readline interface is created with process.stdin, it creates an active handle
  // that keeps Node's event loop alive indefinitely. Without this fix, Jest will hang
  // after tests complete, waiting for stdin to close (which never happens).
  // Root cause is at '@doko-js/utils' Shell class

  // allow the process to exit even if stdin is still open
  if (process.stdin.unref) {
    process.stdin.unref();
  }
});
