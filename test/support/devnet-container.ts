/**
 * Containerized multi-validator devnet lifecycle for `lionden test --network devnet`.
 *
 * This module's namespace object *is* a LionDen `TestingHookHandlers` map — it is
 * registered as a lazy hook factory by `test/support/devnet-plugin.ts`, which
 * `lionden.config.ts` only adds to `plugins` when `TEST_MODE=devnet`.
 *
 * Lifecycle: `suiteSetup` runs in the parent CLI process (before Vitest forks any
 * worker) and publishes `DEVNET_ENDPOINT` into `process.env`. Workers inherit it,
 * re-import `lionden.config.ts`, and resolve `networks.devnet.endpoint` from it.
 *
 * Because the parent's LRE is built at CLI boot — before this hook runs — the
 * dynamically mapped host port is *not* visible to an in-process `compile`.
 * Devnet runs must therefore compile first and pass `--no-compile`. See
 * `docs/TESTING.md` § Devnet mode.
 */

import type { StartedTestContainer } from "testcontainers";
import { parseBooleanEnv } from "@lionden/config";
import type { LionDenRuntimeEnvironment } from "@lionden/core";

/** Network key in `lionden.config.ts` that this container backs. */
const DEVNET_NETWORK_NAME = "devnet";

const DEFAULT_IMAGE = "ghcr.io/sealance-io/aleo-devnet:v4.3.1-v4.8.1";
const DEFAULT_ENDPOINT = "http://127.0.0.1:3030";
/**
 * Both values are coupled to DEVNET_IMAGE. Its snarkOS requires *exactly* one
 * height per consensus version it knows about, and that count is also the
 * highest version the chain will ever report — snarkOS 4.8.1 takes 16, so
 * targeting 17 never becomes ready. Re-derive both whenever DEVNET_IMAGE moves;
 * a wrong count fails the run at container startup with a clear message.
 */
const DEFAULT_CONSENSUS_VERSION = 16;
/** One activation height per consensus version; the image validates the count exactly. */
const DEFAULT_CONSENSUS_VERSION_HEIGHTS = "0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15";
const DEFAULT_READY_TIMEOUT_MS = 600_000;

const CONTAINER_API_PORT = 3030;
const CONTAINER_STARTUP_TIMEOUT_MS = 600_000;
const READY_POLL_INTERVAL_MS = 5_000;
const READY_REQUEST_TIMEOUT_MS = 5_000;
const LOG_DUMP_TIMEOUT_MS = 10_000;

/** Module-private: the container started by `suiteSetup`, if any. */
let container: StartedTestContainer | undefined;

const MISSING_DEPLOYER_KEY =
  'Devnet mode needs a signable "deployer" named account — it is passed to the ' +
  "container as PRIVATE_KEY and its genesis balance funds every other test account. " +
  "Set ALEO_DEVNET_DEPLOYER_PRIVATE_KEY (see .env.example).";

interface DevnetSettings {
  readonly image: string;
  readonly external: boolean;
  readonly containerLogs: boolean;
  readonly targetConsensusVersion: number;
  readonly consensusVersionHeights: string;
  readonly readyTimeoutMs: number;
  /** Aleo network id used in REST paths, e.g. "testnet". */
  readonly networkId: string;
  /** Resolved `namedAccounts.deployer` key; seeds the container's genesis funding. */
  readonly deployerPrivateKey: string | undefined;
}

// ---------------------------------------------------------------------------
// Consensus-version parsing (pure — unit-tested in devnet-container.test.ts)
// ---------------------------------------------------------------------------

/**
 * Normalize the response shapes `GET /<network>/consensus_version` is known to
 * return: a bare number, a bare numeric string, or an object carrying `result`,
 * `consensus_version`, or `version`.
 *
 * Returns `undefined` for anything else. The readiness loop treats `undefined`
 * as "not ready yet" and reports it in the timeout diagnostics, so an
 * unrecognized payload fails loudly instead of being mistaken for readiness.
 */
export function parseConsensusVersion(data: unknown): number | undefined {
  let raw: unknown;

  if (typeof data === "string" || typeof data === "number") {
    raw = data;
  } else if (isRecord(data)) {
    raw = data["result"] ?? data["consensus_version"] ?? data["version"];
  }

  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) ? raw : undefined;
  }
  if (typeof raw !== "string") {
    return undefined;
  }

  // Whole string or nothing. parseInt would read "16junk" and "16.5" as 16,
  // which turns a payload we do not actually understand into a readiness signal.
  const trimmed = raw.trim();
  if (!INTEGER_PATTERN.test(trimmed)) return undefined;

  // The pattern alone still admits digit strings too long for a JS number, which
  // become Infinity (>= any target, so instantly "ready") or silently round.
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** A complete, unsigned base-10 integer — no prefixes, suffixes, or decimals. */
const INTEGER_PATTERN = /^\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Hook handlers
// ---------------------------------------------------------------------------

export async function suiteSetup(context: unknown): Promise<void> {
  const settings = resolveSettings(context);
  validateConfiguration(settings);

  let endpoint = process.env["DEVNET_ENDPOINT"] ?? DEFAULT_ENDPOINT;

  if (settings.external) {
    console.log(`[devnet] DEVNET_EXTERNAL is set — using the devnet already at ${endpoint}`);
  } else {
    endpoint = await startContainer(settings);
  }

  // Published for the forked Vitest workers: they re-import lionden.config.ts,
  // whose `devnet` network reads DEVNET_ENDPOINT. dotenv does not override an
  // already-set variable, so this wins over .env.
  process.env["DEVNET_ENDPOINT"] = endpoint;

  await waitForConsensusVersion(endpoint, settings);
}

export async function suiteTeardown(): Promise<void> {
  // suiteTeardown is dispatched unconditionally — including after a suiteSetup
  // that threw before (or instead of) starting a container.
  if (!container) return;

  const stopping = container;
  // Clear first so a failed stop cannot be retried against a dead handle.
  container = undefined;

  try {
    await stopping.stop();
  } catch (error) {
    // Deliberately rethrown, not swallowed: CI disables Ryuk, so a container we
    // failed to stop is a leak with nothing left to reap it. @lionden/plugin-test
    // propagates teardown errors (aggregating with any run failure), and a green
    // run that leaked a devnet would hide exactly that.
    throw new Error(`Failed to stop devnet container: ${describeError(error)}`, { cause: error });
  }
}

// ---------------------------------------------------------------------------
// Container startup
// ---------------------------------------------------------------------------

async function startContainer(settings: DevnetSettings): Promise<string> {
  // validateConfiguration() already rejected a missing key; re-narrow for the type system.
  const { deployerPrivateKey } = settings;
  if (!deployerPrivateKey) throw new Error(MISSING_DEPLOYER_KEY);

  // Imported lazily so neither the CLI's config load nor a Vitest worker pays
  // for `testcontainers` unless a container is actually being started.
  const { GenericContainer, Wait } = await import("testcontainers");

  let image = new GenericContainer(settings.image)
    // Image contract (ghcr.io/sealance-io/aleo-devnet): the entrypoint reads
    // PRIVATE_KEY as the genesis/validator key and CONSENSUS_VERSION_HEIGHTS as
    // the comma-separated activation height per consensus version.
    .withEnvironment({
      PRIVATE_KEY: deployerPrivateKey,
      CONSENSUS_VERSION_HEIGHTS: settings.consensusVersionHeights,
    })
    .withExposedPorts(CONTAINER_API_PORT)
    // Port-listening only; the consensus-version poll below is the real readiness gate.
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS);

  if (settings.containerLogs) {
    image = image.withLogConsumer(stream => {
      stream.on("data", (line: unknown) => process.stdout.write(`[devnet] ${String(line)}`));
      stream.on("err", (line: unknown) => process.stderr.write(`[devnet] ${String(line)}`));
    });
  }

  container = await image.start();

  // getHost()/getMappedPort() rather than a hard-coded 127.0.0.1:3030 — the
  // Docker host may be remote or VM-backed (Podman machine, Colima, DOCKER_HOST).
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(CONTAINER_API_PORT)}`;
  console.log(`[devnet] container started from ${settings.image} at ${endpoint}`);
  return endpoint;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

async function waitForConsensusVersion(endpoint: string, settings: DevnetSettings): Promise<void> {
  const url = `${endpoint}/${settings.networkId}/consensus_version`;
  const target = settings.targetConsensusVersion;
  const startTime = Date.now();

  let lastStatus: string | undefined;
  let lastError: string | undefined;
  let lastVersion: number | undefined;

  console.log(
    `[devnet] waiting for consensus version >= ${target} at ${url} ` + `(timeout ${settings.readyTimeoutMs}ms)`,
  );

  while (Date.now() - startTime < settings.readyTimeoutMs) {
    try {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(READY_REQUEST_TIMEOUT_MS),
      });
      lastStatus = `${response.status} ${response.statusText}`;

      if (response.ok) {
        lastError = undefined;
        lastVersion = parseConsensusVersion(await response.json());

        if (lastVersion !== undefined && lastVersion >= target) {
          console.log(
            `[devnet] ready — consensus version ${lastVersion} >= ${target} ` + `after ${elapsedSeconds(startTime)}s`,
          );
          return;
        }

        console.log(
          lastVersion === undefined
            ? `[${elapsedSeconds(startTime)}s] unrecognized consensus_version payload; still waiting`
            : `[${elapsedSeconds(startTime)}s] consensus version ${lastVersion} < ${target}; still waiting`,
        );
      }
    } catch (error) {
      // Connection errors are expected while the devnet boots.
      lastError = describeError(error);
      console.log(`[${elapsedSeconds(startTime)}s] waiting for devnet API... (${lastError})`);
    }

    await sleep(READY_POLL_INTERVAL_MS);
  }

  // Diagnostics first: with DEVNET_EXTERNAL there is no container to dump logs
  // from, so the readiness trace is the only evidence available.
  const diagnostics =
    `endpoint=${url} elapsed=${elapsedSeconds(startTime)}s ` +
    `lastHttpStatus=${lastStatus ?? "none"} lastError=${lastError ?? "none"} ` +
    `lastParsedConsensusVersion=${lastVersion ?? "none"}`;

  await dumpContainerLogs();

  throw new Error(
    `Devnet did not reach consensus version >= ${target} within ` + `${settings.readyTimeoutMs}ms. ${diagnostics}`,
  );
}

async function dumpContainerLogs(): Promise<void> {
  if (!container) return;

  try {
    const stream = await container.logs();
    console.error("[devnet] --- container logs ---");

    await Promise.race([
      new Promise<void>(resolve => {
        stream.on("data", (line: unknown) => process.stderr.write(`[devnet] ${String(line)}`));
        stream.on("end", () => resolve());
        stream.on("error", () => resolve());
      }),
      // container.logs() follows a running container, so `end` may never fire.
      sleep(LOG_DUMP_TIMEOUT_MS),
    ]);

    stream.destroy();
    console.error("[devnet] --- end container logs ---");
  } catch (error) {
    console.error(`[devnet] could not read container logs: ${describeError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function resolveSettings(context: unknown): DevnetSettings {
  const lre = (context as { lre?: LionDenRuntimeEnvironment } | undefined)?.lre;
  if (!lre) {
    throw new Error("Devnet suiteSetup received no LionDen runtime environment.");
  }

  const network = lre.config.networks[DEVNET_NETWORK_NAME];
  if (!network) {
    throw new Error(`lionden.config.ts has no "${DEVNET_NETWORK_NAME}" network.`);
  }

  return {
    image: process.env["DEVNET_IMAGE"] || DEFAULT_IMAGE,
    external: parseBooleanEnv(process.env["DEVNET_EXTERNAL"], false),
    containerLogs: parseBooleanEnv(process.env["DEVNET_CONTAINER_LOGS"], false),
    targetConsensusVersion: parsePositiveInt(
      process.env["DEVNET_CONSENSUS_VERSION"],
      DEFAULT_CONSENSUS_VERSION,
      "DEVNET_CONSENSUS_VERSION",
    ),
    consensusVersionHeights: process.env["DEVNET_CONSENSUS_VERSION_HEIGHTS"] || DEFAULT_CONSENSUS_VERSION_HEIGHTS,
    readyTimeoutMs: parsePositiveInt(
      process.env["DEVNET_READY_TIMEOUT_MS"],
      DEFAULT_READY_TIMEOUT_MS,
      "DEVNET_READY_TIMEOUT_MS",
    ),
    networkId: network.network,
    deployerPrivateKey: resolveDeployerPrivateKey(lre),
  };
}

function resolveDeployerPrivateKey(lre: LionDenRuntimeEnvironment): string | undefined {
  const entry = lre.config.namedAccounts["deployer"];
  const value = entry?.networks[DEVNET_NETWORK_NAME] ?? entry?.default;
  return value?.type === "privateKey" ? value.privateKey : undefined;
}

function validateConfiguration(settings: DevnetSettings): void {
  if (!settings.external && !settings.deployerPrivateKey) {
    throw new Error(MISSING_DEPLOYER_KEY);
  }

  if (settings.readyTimeoutMs < 60_000) {
    console.warn(
      `[devnet] DEVNET_READY_TIMEOUT_MS is only ${settings.readyTimeoutMs}ms; ` +
        "a cold devnet normally needs several minutes to reach the target consensus version.",
    );
  }

  console.log(
    `[devnet] image=${settings.image} external=${settings.external} ` +
      `targetConsensusVersion=${settings.targetConsensusVersion} ` +
      `readyTimeoutMs=${settings.readyTimeoutMs}`,
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parsePositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;

  // Strict: parseInt would silently accept "16junk" or "16.5" as 16, so a typo in
  // a CI env var would quietly change the readiness gate instead of failing.
  // isSafeInteger also rejects digit strings that overflow to Infinity.
  const trimmed = value.trim();
  const parsed = INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}".`);
  }
  return parsed;
}

function elapsedSeconds(startTime: number): number {
  return Math.floor((Date.now() - startTime) / 1000);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
