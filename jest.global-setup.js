import { GenericContainer } from "testcontainers";

function parseBooleanEnv(value, defaultValue = true) {
  if (value === undefined || value === '') {
    return defaultValue;
  }
  
  const stringValue = String(value).toLowerCase().trim();
  
  // Values that should be interpreted as true
  if (['true', 't', 'yes', 'y', '1', 'on', 'enabled'].includes(stringValue)) {
    return true;
  }
  
  // Values that should be interpreted as false
  if (['false', 'f', 'no', 'n', '0', 'off', 'disabled'].includes(stringValue)) {
    return false;
  }
  
  // For any other unexpected values, log a warning and use the default
  console.warn(`Warning: Unexpected boolean environment value "${value}" - using default (${defaultValue})`);
  return defaultValue;
}

const USE_TEST_CONTAINERS = parseBooleanEnv(process.env.USE_TEST_CONTAINERS, true);
const AMARELEO_IMAGE = process.env.AMARELEO_IMAGE || "ghcr.io/sealance-io/amareleo-chain:v2.2.0";
const AMARELEO_VERBOSITY = process.env.AMARELEO_VERBOSITY || "1";

// If Jest runs in parallel mode using workers (which is default) this runs in parent process
export default async function() {
  console.log("=== Starting global test setup in parent process ===");

  if (!USE_TEST_CONTAINERS) {
    return;
  }

  if (!globalThis.__TEST_CONTAINERS__) {
    globalThis.__TEST_CONTAINERS__ = {};
  }

  globalThis.__TEST_CONTAINERS__.amareleo = await new GenericContainer(AMARELEO_IMAGE)
  .withCommand(["--network", "1", "--verbosity", AMARELEO_VERBOSITY, "--rest", "0.0.0.0:3030", "--storage", "/data/amareleo", "--rest-rps", "100"])
  .withExposedPorts({
    container: 3030,
    host: 3030
  })
  .withStartupTimeout(120000) // 2 minutes timeout
  .start();
}
