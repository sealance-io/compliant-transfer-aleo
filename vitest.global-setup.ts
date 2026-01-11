import { GenericContainer, StartedTestContainer } from "testcontainers";
import networkConfig from "./aleo-config";
import { advanceBlocks } from "./lib/Block";

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
let devnetContainer: StartedTestContainer | undefined;

const USE_TEST_CONTAINERS = parseBooleanEnv(process.env.USE_TEST_CONTAINERS, true);
const IS_DEVNET = parseBooleanEnv(process.env.DEVNET, true);
const DEFAULT_ALEO_IMAGE = IS_DEVNET
  ? "ghcr.io/sealance-io/aleo-devnet:v3.4.0-v4.4.0"
  : "ghcr.io/sealance-io/leo-lang:v3.4.0-devnode";
const ALEO_TEST_IMAGE = process.env.ALEO_TEST_IMAGE || DEFAULT_ALEO_IMAGE;
const ALEO_VERBOSITY = process.env.ALEO_VERBOSITY || "1";
const TARGET_CONSENSUS_VERSION = parseInt(process.env.CONSENSUS_VERSION || "12", 10);
const FIRST_BLOCK = parseInt(process.env.FIRST_BLOCK || "20", 10);
const CONSENSUS_CHECK_TIMEOUT = parseInt(process.env.CONSENSUS_CHECK_TIMEOUT || "600000", 10); // 10 minutes default
const CONSENSUS_CHECK_INTERVAL = parseInt(process.env.CONSENSUS_CHECK_INTERVAL || "5000", 10); // 5 seconds default
const ALEO_PRIVATE_KEY = process.env.ALEO_PRIVATE_KEY;

function validateConfiguration(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for required variables based on mode
  if (!IS_DEVNET && !ALEO_PRIVATE_KEY) {
    errors.push("ALEO_PRIVATE_KEY is required for devnode mode (used for block advancement)");
  }

  // Check for conflicting configurations
  if (IS_DEVNET && (process.env.SKIP_EXECUTE_PROOF || process.env.SKIP_DEPLOY_CERTIFICATE)) {
    warnings.push(
      "SKIP_EXECUTE_PROOF and SKIP_DEPLOY_CERTIFICATE are ignored in DEVNET mode (only applicable to devnode)",
    );
  }

  // Check for suspicious values
  if (CONSENSUS_CHECK_TIMEOUT < 60000) {
    warnings.push(
      `CONSENSUS_CHECK_TIMEOUT is very low (${CONSENSUS_CHECK_TIMEOUT}ms). Consider at least 60000ms (1 minute)`,
    );
  }

  if (ALEO_VERBOSITY && !["0", "1", "2", "3", "4"].includes(ALEO_VERBOSITY)) {
    warnings.push(`ALEO_VERBOSITY should be 0-4, got: ${ALEO_VERBOSITY}`);
  }

  if (process.env.CONSENSUS_HEIGHT && !IS_DEVNET) {
    warnings.push(
      "CONSENSUS_HEIGHT is set but only applies to devnet mode. This setting will be ignored in devnode mode.",
    );
  }

  // Display configuration summary
  console.log("\n=== Test Configuration ===");
  console.log(`Mode: ${IS_DEVNET ? "Devnet (Full Network)" : "Devnode (Single Node)"}`);
  console.log(`Image: ${ALEO_TEST_IMAGE}`);
  console.log(`Verbosity: ${ALEO_VERBOSITY}`);
  console.log(`Target Consensus: ${TARGET_CONSENSUS_VERSION}`);
  console.log(`Use Testcontainers: ${USE_TEST_CONTAINERS}`);

  if (!IS_DEVNET) {
    const skipProving = parseBooleanEnv(process.env.SKIP_EXECUTE_PROOF, false);
    const skipCert = parseBooleanEnv(process.env.SKIP_DEPLOY_CERTIFICATE, false);
    console.log(`Skip Proving: ${skipProving}`);
    console.log(`Skip Deploy Certificate: ${skipCert}`);
  }
  console.log("========================\n");

  // Display warnings
  if (warnings.length > 0) {
    console.warn("⚠️  Configuration Warnings:");
    warnings.forEach(warning => console.warn(`  - ${warning}`));
    console.warn("");
  }

  // Fail on errors
  if (errors.length > 0) {
    console.error("❌ Configuration Errors:");
    errors.forEach(error => console.error(`  - ${error}`));
    console.error("\nSee docs/testing-configuration-guide.md for configuration help");
    throw new Error("Invalid test configuration. Fix the errors above and try again.");
  }

  // Helpful hint for slow tests
  if (IS_DEVNET) {
    console.log(
      "💡 Tip: Using full DEVNET mode. Tests will be slow but realistic. " +
        "For faster development, use devnode mode (remove DEVNET=true from .env)\n",
    );
  }
}

async function waitForConsensusVersion(
  targetVersion: number,
  timeout: number = CONSENSUS_CHECK_TIMEOUT,
  interval: number = CONSENSUS_CHECK_INTERVAL,
): Promise<void> {
  const networkName = networkConfig.defaultNetwork;
  const endpoint = networkConfig.networks[networkName].endpoint;
  const startTime = Date.now();
  const apiUrl = `${endpoint}/testnet/consensus_version`;

  console.log(`Waiting for consensus version >= ${targetVersion} at ${apiUrl}`);
  console.log(`Timeout: ${timeout}ms, Check interval: ${interval}ms`);

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout per request
      });

      if (response.ok) {
        const data = await response.json();

        // The response might be in different formats depending on the API version
        // Try to extract the consensus version from various possible response structures
        let currentVersion: string | undefined;

        if (typeof data === "string") {
          currentVersion = data;
        } else if (typeof data === "number") {
          currentVersion = String(data);
        } else if (data?.result !== undefined) {
          currentVersion = String(data.result);
        } else if (data?.consensus_version !== undefined) {
          currentVersion = String(data.consensus_version);
        } else if (data?.version !== undefined) {
          currentVersion = String(data.version);
        }

        console.log(`Current consensus version: ${currentVersion}, Target: ${targetVersion}`);

        // Convert to number for comparison to handle >= properly
        const currentVersionNum = parseInt(currentVersion, 10);

        if (!isNaN(currentVersionNum) && !isNaN(targetVersion) && currentVersionNum >= targetVersion) {
          console.log(`✅ Consensus version ${currentVersion} meets or exceeds target ${targetVersion}`);
          return;
        }

        // If we got a response but version not ready, wait before retrying
        if (!isNaN(currentVersionNum) && !isNaN(targetVersion)) {
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
      `Waited ${timeout}ms but devnet did not reach the minimum required consensus version.`,
  );
}

// Setup function - executed before all tests
export async function setup() {
  console.log("=== Starting global test setup for Vitest ===");

  // Validate configuration before starting
  validateConfiguration();

  let command = [];
  if (IS_DEVNET) {
    command = [
      "devnet",
      "--snarkos",
      "./snarkos",
      "--yes",
      "--clear-storage",
      "--storage",
      "/data",
      "--num-clients",
      "1",
    ];
  } else {
    command = ["devnode", "start", "--socket-addr", "0.0.0.0:3030", "--private-key", ALEO_PRIVATE_KEY!];
  }

  let mappedPort: number = 3030;
  if (USE_TEST_CONTAINERS) {
    // Build environment object with only defined values
    const containerEnv: Record<string, string> = {};
    // if (ALEO_PRIVATE_KEY) {
    //   containerEnv.PRIVATE_KEY = ALEO_PRIVATE_KEY;
    // }
    if (process.env.CONSENSUS_HEIGHT) {
      containerEnv.CONSENSUS_HEIGHT = process.env.CONSENSUS_HEIGHT;
    }

    let container = new GenericContainer(ALEO_TEST_IMAGE)
      .withEntrypoint(["/usr/local/bin/leo"])
      .withCommand([...command, "--verbosity", ALEO_VERBOSITY]);

    // Only add environment if we have any variables to set
    if (Object.keys(containerEnv).length > 0) {
      container = container.withEnvironment(containerEnv);
    }

    devnetContainer = await container
      .withExposedPorts({
        container: 3030,
        host: 3030,
      })
      .withStartupTimeout(600_000) // 10 minutes timeout
      .start();

    mappedPort = devnetContainer.getMappedPort(3030);
    console.log(`Container started with mapped port: ${mappedPort}`);
  }

  if (!IS_DEVNET) {
    await advanceBlocks(FIRST_BLOCK);
  }
  await waitForConsensusVersion(TARGET_CONSENSUS_VERSION);
}

// Teardown function - executed after all tests
export async function teardown() {
  console.log("=== Starting global test teardown for Vitest ===");

  try {
    if (devnetContainer) {
      await devnetContainer.stop();
      devnetContainer = undefined;
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
