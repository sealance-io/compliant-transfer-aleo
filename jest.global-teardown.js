// If Jest runs in parallel mode using workers (which is default) this runs in parent process
export default async function () {
  console.log("=== Starting global test teardown in parent process ===");

  try {
    if (globalThis.__TEST_CONTAINERS__?.amareleo) {
      await globalThis.__TEST_CONTAINERS__.amareleo.stop();
      globalThis.__TEST_CONTAINERS__.amareleo = undefined;
    }
  } catch (error) {
    console.error("Error stopping container:", error);
  }

  // allow the process to exit even if stdin/stdout/stderr is still open
  ["stdin", "stdout", "stderr"].forEach(stream => {
    if (process[stream] && typeof process[stream].unref === "function") {
      process[stream].unref();
    }
  });
  console.log("Global teardown complete");
}
