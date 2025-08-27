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
const AMARELEO_IMAGE = process.env.AMARELEO_IMAGE || "ghcr.io/sealance-io/amareleo-chain:v2.3.0";
const AMARELEO_VERBOSITY = process.env.AMARELEO_VERBOSITY || "1";
const MIN_CONSENSUS_VERSION = process.env.MIN_CONSENSUS_VERSION || "9";
const CONSENSUS_CHECK_TIMEOUT = parseInt(process.env.CONSENSUS_CHECK_TIMEOUT || "180000", 10); // 3 minutes default
const CONSENSUS_CHECK_INTERVAL = parseInt(process.env.CONSENSUS_CHECK_INTERVAL || "5000", 10); // 5 seconds default

async function waitForConsensusVersion(
  port: number,
  targetVersion: string,
  timeout: number = CONSENSUS_CHECK_TIMEOUT,
  interval: number = CONSENSUS_CHECK_INTERVAL
): Promise<void> {
  const startTime = Date.now();
  const apiUrl = `http://localhost:${port}/testnet/consensus_version`;
  
  console.log(`Waiting for consensus version >= ${targetVersion} at ${apiUrl}`);
  console.log(`Timeout: ${timeout}ms, Check interval: ${interval}ms`);

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout per request
      });

      if (response.ok) {
        const data = await response.json();
        
        // The response might be in different formats depending on the API version
        // Try to extract the consensus version from various possible response structures
        let currentVersion: string | undefined;
        
        if (typeof data === 'string') {
          currentVersion = data;
        } else if (typeof data === 'number') {
          currentVersion = String(data);
        } else if (data?.result !== undefined) {
          currentVersion = String(data.result);
        } else if (data?.consensus_version !== undefined) {
          currentVersion = String(data.consensus_version);
        } else if (data?.version !== undefined) {
          currentVersion = String(data.version);
        }

        console.log(`Current consensus version: ${currentVersion}, Target: ${targetVersion}`);

        // Convert to numbers for comparison to handle >= properly
        const currentVersionNum = parseInt(currentVersion, 10);
        const targetVersionNum = parseInt(targetVersion, 10);

        if (!isNaN(currentVersionNum) && !isNaN(targetVersionNum) && currentVersionNum >= targetVersionNum) {
          console.log(`✅ Consensus version ${currentVersion} meets or exceeds target ${targetVersion}`);
          return;
        }

        // If we got a response but version not ready, wait before retrying
        if (!isNaN(currentVersionNum) && !isNaN(targetVersionNum)) {
          console.log(`Consensus version not ready. Current: ${currentVersion}, Minimum required: ${targetVersion}`);
        } else {
          console.log(`Invalid version format. Current: ${currentVersion}, Target: ${targetVersion}`);
        }
      } else {
        console.log(`API responded with status ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      // Network errors are expected initially while the devnet is starting up
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      if (error instanceof Error) {
        console.log(`[${elapsed}s] Waiting for devnet API... (${error.message})`);
      } else {
        console.log(`[${elapsed}s] Waiting for devnet API...`);
      }
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  // Timeout reached
  throw new Error(
    `Timeout waiting for consensus version >= ${targetVersion}. ` +
    `Waited ${timeout}ms but devnet did not reach the minimum required consensus version.`
  );
}

// Setup function - executed before all tests
export async function setup() {
  console.log("=== Starting global test setup for Vitest ===");

  let mappedPort: number = 3030;
  if (USE_TEST_CONTAINERS) {
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

    mappedPort = amareleoContainer.getMappedPort(3030);
    console.log(`Container started with mapped port: ${mappedPort}`);
  }

  await waitForConsensusVersion(mappedPort, MIN_CONSENSUS_VERSION);
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