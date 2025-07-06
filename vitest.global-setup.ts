import { GenericContainer, StartedTestContainer } from "testcontainers";

function parseBooleanEnv(value: string | undefined, defaultValue = true): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const stringValue = String(value).toLowerCase().trim();

  // Values that should be interpreted as true
  if (["true", "t", "yes", "y", "1", "on", "enabled"].includes(stringValue)) {
    return true;
  }

  // Values that should be interpreted as false
  if (["false", "f", "no", "n", "0", "off", "disabled"].includes(stringValue)) {
    return false;
  }

  // For any other unexpected values, log a warning and use the default
  console.warn(`Warning: Unexpected boolean environment value "${value}" - using default (${defaultValue})`);
  return defaultValue;
}

// This is private to this module and not exposed globally
let amareleoContainer: StartedTestContainer | undefined;

const USE_TEST_CONTAINERS = parseBooleanEnv(process.env.USE_TEST_CONTAINERS, true);
const AMARELEO_IMAGE = process.env.AMARELEO_IMAGE || "ghcr.io/sealance-io/amareleo-chain:v2.5.0";
const AMARELEO_VERBOSITY = process.env.AMARELEO_VERBOSITY || "1";

// Setup function - executed before all tests
export async function setup() {
  console.log("=== Starting global test setup for Vitest ===");

  if (!USE_TEST_CONTAINERS) {
    return;
  }

  amareleoContainer = await new GenericContainer(AMARELEO_IMAGE)
    .withCommand([
      "--network",
      "1",
      "--verbosity",
      AMARELEO_VERBOSITY,
      "--rest",
      "0.0.0.0:3030",
      "--storage",
      "/data/amareleo",
      "--rest-rps",
      "100",
    ])
    .withExposedPorts({
      container: 3030,
      host: 3030,
    })
    .withStartupTimeout(120000) // 2 minutes timeout
    .start();

  console.log(`Container started with mapped port: ${amareleoContainer.getMappedPort(3030)}`);
}

// Teardown function - executed after all tests
export async function teardown() {
  console.log("=== Starting global test teardown for Vitest ===");

  try {
    if (amareleoContainer) {
      await amareleoContainer.stop();
      amareleoContainer = undefined;
    }
  } catch (error) {
    console.error("Error stopping container:", error);
  }

  // Allow the process to exit even if stdin/stdout/stderr is still open
  ["stdin", "stdout", "stderr"].forEach(stream => {
    if (process[stream] && typeof process[stream].unref === "function") {
      process[stream].unref();
    }
  });
  console.log("Global teardown complete");
}
