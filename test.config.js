import console from 'console';
import { Shell } from '@doko-js/utils';

global.console = console;

// Patching 'doko-js' to prevent tests from hanging 

// Monkey patch the Shell class
const originalAsyncExec = Shell.prototype.asyncExec;
Shell.prototype.asyncExec = async function() {
  try {
    return await originalAsyncExec.call(this);
  } finally {
    // Ensure readline is closed
    if (this.rl && typeof this.rl.close === 'function') {
      this.rl.close();
    }
  }
};

// Store the original setRawMode function
const originalSetRawMode = process.stdin.setRawMode?.bind(process.stdin);

// Clean up TTY listeners after each test
afterEach(() => {
  // If stdin is a TTY and has setRawMode capability
  if (process.stdin.isTTY && originalSetRawMode) {
    // Turn off raw mode if it's on
    try {
      originalSetRawMode(false);
    } catch (e) {
      // Ignore errors
    }

    // Remove all keypress listeners
    process.stdin.removeAllListeners('keypress');
    
    // In some Node versions, need to clear 'data' and 'readable' as well
    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('readable');
  }
});

// Restore normal console functionality at exit
afterAll(() => {
  // Ensure stdin is in a usable state for other processes
  if (process.stdin.isTTY && originalSetRawMode) {
    try {
      // Reset raw mode to false
      originalSetRawMode(false);
    } catch (e) {
      // Ignore errors
    }
  }
  
  // Additional cleanup
  if (process.stdin.unref) {
    // Allow the process to exit even if stdin is still open
    process.stdin.unref();
  }
});