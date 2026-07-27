import dotenv from "dotenv";
import { configVariable, defineConfig } from "@lionden/config";
import pluginDeploy from "@lionden/plugin-deploy";
import pluginLeo from "@lionden/plugin-leo";
import pluginNetwork from "@lionden/plugin-network";
import pluginTest from "@lionden/plugin-test";
// Explicit .ts extension: Vitest workers re-import this config through Node's
// native TypeScript loader, which resolves specifiers literally and will not
// remap a ".js" specifier onto a ".ts" file the way tsx and Vite do.
import devnetContainerPlugin from "./test/support/devnet-plugin.ts";

dotenv.config({ quiet: true });

/**
 * Test topology.
 *
 * - `devnode` (default): LionDen's managed single-node `leo devnode`, one per
 *   Vitest worker (i.e. one per test file).
 * - `devnet`: a real multi-validator devnet in a container, started once per
 *   `lionden test` invocation by `test/support/devnet-container.ts`. Runs must
 *   compile first and pass `--no-compile`; see `docs/TESTING.md` § Devnet mode.
 */
const TEST_MODE = process.env.TEST_MODE ?? "devnode";
const IS_DEVNET = TEST_MODE === "devnet";

// Workaround for @lionden/*@0.1.1.
//
// initConsensusHeights() primes the SDK's internal consensus-version state from
// snarkVM's *test* height table — the same compressed activation schedule the
// devnet image runs. LionDen only calls it when the connection type is
// "devnode", so our `http` devnet never gets primed and rejects the first
// deployment with:
//   Invalid deployment transaction '<id>' - missing program checksum
//
// Causality is measured, not assumed: identical `lionden test
// test/merkle_tree.test.ts --network devnet` runs fail at the first ctx.deploy()
// without this and pass 7/7 with it. The mechanism is inferred — unprimed, the
// SDK appears to resolve the consensus version from the production height table
// and omit the program checksum the chain (at v16) requires.
//
// This is orthogonal to proving — the http path always proves, since it calls
// programManager.deploy() and useDevnodeFastPath requires type === "devnode".
//
// Must run per process: the CLI parent and every Vitest worker hold their own
// SDK instance, and each one imports this config.
if (IS_DEVNET) {
  const { initConsensusHeights } = await import("@lionden/network");
  await initConsensusHeights();
}

export default defineConfig({
  plugins: [
    pluginLeo,
    pluginNetwork,
    pluginDeploy,
    pluginTest,
    // Registering the container plugin is the devnet toggle — devnode runs never
    // load it, so they never touch testcontainers or Docker.
    ...(IS_DEVNET ? [devnetContainerPlugin] : []),
  ],
  leoVersion: "4.3.2",
  defaultNetwork: "devnode",
  networks: {
    devnode: {
      type: "devnode",
      network: "testnet",
      autoBlock: true,
      provider: "leo",
      privateKey: configVariable(
        "ALEO_DEVNET_DEPLOYER_PRIVATE_KEY",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
    // Containerized multi-validator devnet. Deliberately `http`, not `devnode`:
    // the devnode fast path builds unproven transactions a real network rejects,
    // and its `advanceBlocks` endpoint does not exist on the devnet image. Under
    // `http` the devnet genuinely proves and `lib/Block.ts` falls back to
    // height-polling. The endpoint is published by the container hook before
    // Vitest forks its workers; the default only matters for `DEVNET_EXTERNAL`.
    devnet: {
      type: "http",
      endpoint: process.env.DEVNET_ENDPOINT ?? "http://127.0.0.1:3030",
      network: "testnet",
      // Same key as `namedAccounts.deployer` — the container's genesis funds it.
      privateKey: configVariable(
        "ALEO_DEVNET_DEPLOYER_PRIVATE_KEY",
        "APrivateKey1zkp3svrUTVPiKLUEUzYiAB3yhuN3w4ZQwMtZtHZ6rxfh31A",
      ),
      // HttpNetworkConfig.ephemeral defaults to false, which would persist
      // deployment records for a chain that dies with the container.
      ephemeral: true,
    },
    testnet: {
      type: "http",
      endpoint: "https://api.explorer.provable.com/v1",
      network: "testnet",
      privateKey: configVariable(
        "ALEO_PRIVATE_KEY_TESTNET",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
    mainnet: {
      type: "http",
      endpoint: "https://api.explorer.aleo.org/v1",
      network: "mainnet",
      privateKey: configVariable(
        "ALEO_PRIVATE_KEY_MAINNET",
        "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",
      ),
    },
  },
  namedAccounts: {
    deployer: {
      default: configVariable(
        "ALEO_DEVNET_DEPLOYER_PRIVATE_KEY",
        "APrivateKey1zkp3svrUTVPiKLUEUzYiAB3yhuN3w4ZQwMtZtHZ6rxfh31A",
      ),
    },
    admin: {
      default: configVariable(
        "ALEO_DEVNET_ADMIN_PRIVATE_KEY",
        "APrivateKey1zkp3svrUTVPiKLUEUzYiAB3yhuN3w4ZQwMtZtHZ6rxfh31A",
      ),
    },
    investigator: {
      default: configVariable(
        "ALEO_DEVNET_INVESTIGATOR_PRIVATE_KEY",
        "APrivateKey1zkpBjpEgLo4arVUkQmcLdKQMiAKGaHAQVVwmF8HQby8vdYs",
      ),
    },
    frozenAccount: {
      default: configVariable(
        "ALEO_DEVNET_FROZEN_ADDRESS_PRIVATE_KEY",
        "APrivateKey1zkpAaWyA9Qcs6hQbVPJv6Wjh7eSzTnxrobhTGguSpfJX5jz",
      ),
    },
    account: {
      default: configVariable(
        "ALEO_DEVNET_SENDER_PRIVATE_KEY",
        "APrivateKey1zkp2RWGDcde3efb89rjhME1VYA8QMxcxep5DShNBR6n8Yjh",
      ),
    },
    recipient: {
      default: configVariable(
        "ALEO_DEVNET_RECIPIENT_PRIVATE_KEY",
        "APrivateKey1zkp2GUmKbVsuc1NSj28pa1WTQuZaK5f1DQJAT6vPcHyWokG",
      ),
    },
    minter: {
      default: configVariable(
        "ALEO_DEVNET_MINTER_PRIVATE_KEY",
        "APrivateKey1zkp9FL6oLk5e5unwQrXCz3PfDJPE1WM1W7psGm8edP5KRLL",
      ),
    },
    burner: {
      default: configVariable(
        "ALEO_DEVNET_BURNER_PRIVATE_KEY",
        "APrivateKey1zkpDigVA9KDuNh7ziQ6QD7CGSDdGCYxixtVDsuf4f1U2jZC",
      ),
    },
    supplyManager: {
      default: configVariable(
        "ALEO_DEVNET_SUPPLY_MANAGER_PRIVATE_KEY",
        "APrivateKey1zkpGt8jNxSYTRgoYM21NuRzp7ockeeGDmpnXpUEvGyNeNSS",
      ),
    },
    spender: {
      default: configVariable(
        "ALEO_DEVNET_SPENDER_PRIVATE_KEY",
        "APrivateKey1zkpFKQi2yiWf1P1McSz5DarAH1EVtWn96jzGsc57ddn4fT4",
      ),
    },
    freezeListManager: {
      default: configVariable(
        "ALEO_DEVNET_FREEZE_LIST_MANAGER_PRIVATE_KEY",
        "APrivateKey1zkp8EXvwBCw1Tic27Uz7sZiZPpsGosLmmHFS3uzWFVU9q4e",
      ),
    },
    pauser: {
      default: configVariable(
        "ALEO_DEVNET_PAUSER_PRIVATE_KEY",
        "APrivateKey1zkpB4jk2y5fQDAH7cq6p1SiqwMGhj88QsUVQsa5zbnNd6Ub",
      ),
    },
    signer1: {
      default: configVariable(
        "ALEO_DEVNET_SIGNER1_PRIVATE_KEY",
        "APrivateKey1zkp3ZrLvtBha1dKbgYHcLr3jiEFQXZR5f3PagKSb2EA7zPe",
      ),
    },
    signer2: {
      default: configVariable(
        "ALEO_DEVNET_SIGNER2_PRIVATE_KEY",
        "APrivateKey1zkpCKsb5i4wFyAuuZinJiW5Eru25aFLYE6ofJBwjQrxgqLB",
      ),
    },
  },
  testing: {
    timeout: 600_000,
  },
  deploy: {
    confirmTransactions: true,
    confirmationTimeout: 600_000,
    // @lionden/plugin-deploy defaults this to 12_000ms for http networks; at 8
    // programs per file that is ~96s of pure sleep. The devnet image produces
    // blocks far faster than that — retune if its block time changes.
    ...(IS_DEVNET ? { interDeploymentDelay: 3_000 } : {}),
  },

  codegen: {
    dynamicRecords: {
      asTokenRegistryRecord: {
        sourceRecord: "Token",
        sourceProgram: "token_registry.aleo",
        schema: {
          owner: "address.private",
          amount: "u128.private",
          token_id: "field.private",
          external_authorization_required: "boolean.private",
          authorized_until: "u32.private",
          _nonce: "group.public",
        },
      },
      asTimelockCompliantTokenRecord: {
        sourceRecord: "CompliantToken",
        sourceProgram: "sealed_timelock_policy.aleo",
        schema: {
          owner: "address.private",
          amount: "u128.private",
          locked_until: "u32.private",
          _nonce: "group.public",
        },
      },
    },
  },
});
