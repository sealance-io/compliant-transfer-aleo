/**
 * Example: Generating and submitting a verify_non_inclusion_priv transaction
 *
 * This example demonstrates the full workflow of:
 * 1. Generating a non-inclusion proof using the SDK
 * 2. Creating a transaction for verify_non_inclusion_priv using @provablehq/sdk
 * 3. Broadcasting the transaction to the Aleo network
 *
 * This does NOT use doko-js, only the lightweight @provablehq/sdk for transaction management.
 *
 * NOTE: This example works with any Aleo program that:
 * 1. Implements the freeze list API mappings:
 *    - mapping freeze_list_index: u32 => address
 *    - mapping freeze_list_last_index: bool => u32
 *    - mapping freeze_list_root: u8 => field
 * 2. Has a verify_non_inclusion_priv transition with signature:
 *    transition verify_non_inclusion_priv(account: address, merkle_proof: [MerkleProof; 2])
 *
 * Compatible programs:
 * - sealance_freezelist_registry.aleo (reference implementation)
 * - sealed_report_policy.aleo
 * - sealed_threshold_report_policy.aleo
 * - custom_compliance_policy.aleo (your own program)
 */

import { PolicyEngine } from "@sealance-io/policy-engine-aleo";
import { Account, ProgramManager, AleoKeyProvider, initThreadPool } from "@provablehq/sdk";
import { trackTransactionStatus } from "./aleo-transaction-tracker.js";

// ============================================================================
// Configuration
// ============================================================================

const EXAMPLE_CONFIG = {
  // Aleo network endpoint
  endpoint: "http://localhost:3030", // or "https://api.explorer.provable.com/v1" for public aleo networks
  network: "testnet", // or "mainnet"

  // Program ID - must be deployed on the target network
  // Change to your deployed program (e.g., "custom_compliance_policy.aleo")
  programId: "sealance_freezelist_registry.aleo",

  // Private key for the account that will submit the transaction
  // In production, load this from secure environment variables
  privateKey: process.env.PRIVATE_KEY || "APrivateKey1zkp8CZNn3yeCseEtxuVPbDCwSyhGW6yZKUYKfgXmcpoGPWH",

  // Address to verify (prove it's NOT in the freeze list)
  addressToVerify: "aleo1wdvqj55e7k3z307clpjsgj506mz8jwxwt8r3qsv4g7fs2a25mcgsvlqc42",

  // Transaction fees
  priorityFee: 0, // Priority fee in microcredits

  // Transaction tracking configuration
  // NOTE: Adjust timeouts based on your network conditions:
  // - For fast/reliable networks: shorter timeouts are fine
  // - For slow/unreliable networks: increase timeouts to avoid false failures
  // - Production: consider 5-10 minutes for trackingTimeout
  trackTransaction: true, // Set to false to skip waiting for confirmation
  trackingTimeout: 120000, // Overall timeout: 2 minutes (reasonable for testing, increase for production)
  fetchTimeout: 30000, // Per-request timeout: 30 seconds (prevents hanging on unresponsive endpoints)
  maxTrackingAttempts: 60, // Maximum polling attempts before giving up
  pollInterval: 5000, // Delay between polls: 5 seconds
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats a MerkleProof for use in Aleo program execution
 */
function formatMerkleProofForAleo(proof: { siblings: bigint[]; leaf_index: number }): string {
  // Format siblings array as Leo array syntax: [1field, 2field, ...]
  const siblingsStr = proof.siblings.map(s => `${s}field`).join(", ");

  // Format as Leo struct: { siblings: [...], leaf_index: 0u32 }
  return `{ siblings: [${siblingsStr}], leaf_index: ${proof.leaf_index}u32 }`;
}

/**
 * Formats the complete merkle_proof array parameter for verify_non_inclusion_priv
 */
function formatMerkleProofArray(proof1: { siblings: bigint[]; leaf_index: number }, proof2: { siblings: bigint[]; leaf_index: number }): string {
  return `[${formatMerkleProofForAleo(proof1)}, ${formatMerkleProofForAleo(proof2)}]`;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("=".repeat(80));
  console.log("Verify Non-Inclusion Transaction Example");
  console.log("=".repeat(80));

  // Leverages multi-threading for intensive cryptographic operations via "@provablehq/sdk"
  await initThreadPool();

  // ------------------------------------------------------------------------
  // Step 1: Initialize SDK and Generate Non-Inclusion Proof
  // ------------------------------------------------------------------------
  console.log("\n[1/5] Initializing Policy Engine SDK...");
  const engine = new PolicyEngine({
    endpoint: EXAMPLE_CONFIG.endpoint,
    network: EXAMPLE_CONFIG.network,
    maxTreeDepth: 15,
  });

  console.log(`[1/5] ✅ SDK initialized`);
  console.log(`      Endpoint: ${EXAMPLE_CONFIG.endpoint}`);
  console.log(`      Network: ${EXAMPLE_CONFIG.network}`);

  // ------------------------------------------------------------------------
  // Step 2: Fetch Freeze List and Generate Proof
  // ------------------------------------------------------------------------
  console.log(`\n[2/5] Fetching freeze list from chain...`);
  console.log(`      Program: ${EXAMPLE_CONFIG.programId}`);

  const freezeListResult = await engine.fetchFreezeListFromChain(EXAMPLE_CONFIG.programId);

  console.log(`[2/5] ✅ Freeze list fetched`);
  console.log(`      Total addresses: ${freezeListResult.addresses.length}`);
  console.log(`      Last index: ${freezeListResult.lastIndex}`);
  console.log(`      Current root: ${freezeListResult.currentRoot || "N/A"}`);

  console.log(`\n[2/5] Generating non-inclusion proof...`);
  console.log(`      Address to verify: ${EXAMPLE_CONFIG.addressToVerify}`);

  const witness = await engine.generateNonInclusionProof(EXAMPLE_CONFIG.addressToVerify, {
    freezeList: freezeListResult.addresses,
    programId: EXAMPLE_CONFIG.programId,
  });

  console.log(`[2/5] ✅ Non-inclusion proof generated`);
  console.log(`      Root: ${witness.root}`);
  console.log(`      Proof 1: leaf_index=${witness.proofs[0].leaf_index}, siblings=${witness.proofs[0].siblings.length}`);
  console.log(`      Proof 2: leaf_index=${witness.proofs[1].leaf_index}, siblings=${witness.proofs[1].siblings.length}`);

  // ------------------------------------------------------------------------
  // Step 3: Initialize Aleo Account and ProgramManager
  // ------------------------------------------------------------------------
  console.log(`\n[3/5] Setting up Aleo account and ProgramManager...`);

  // Create account from private key
  const account = new Account({ privateKey: EXAMPLE_CONFIG.privateKey });
  const accountAddress = account.address().to_string();

  console.log(`[3/5] ✅ Account loaded`);
  console.log(`      Address: ${accountAddress}`);

  // Initialize key provider for proving/verifying keys and enable in-memory caching
  const keyProvider = new AleoKeyProvider();
  keyProvider.useCache(true);

  // Create ProgramManager
  const programManager = new ProgramManager(EXAMPLE_CONFIG.endpoint, keyProvider, undefined);
  programManager.setAccount(account);

  console.log(`[3/5] ✅ ProgramManager initialized`);
  console.log(`      Host: ${EXAMPLE_CONFIG.endpoint}`);

  // ------------------------------------------------------------------------
  // Step 4: Build and Execute Transaction
  // ------------------------------------------------------------------------
  console.log(`\n[4/5] Building verify_non_inclusion_priv transaction...`);

  // Format the merkle_proof parameter as [MerkleProof; 2]
  const merkleProofArray = formatMerkleProofArray(witness.proofs[0], witness.proofs[1]);

  console.log(`[4/5] Transaction inputs:`);
  console.log(`      - account: ${EXAMPLE_CONFIG.addressToVerify}`);
  console.log(`      - merkle_proof: [MerkleProof; 2] (${witness.proofs[0].siblings.length * 2} fields)`);

  try {
    // Execute the transition
    const txId = await programManager.execute({
      programName: EXAMPLE_CONFIG.programId,
      functionName: "verify_non_inclusion_priv",
      priorityFee: EXAMPLE_CONFIG.priorityFee,
      privateFee: false,
      inputs: [
        EXAMPLE_CONFIG.addressToVerify,
        merkleProofArray,
      ],
    });

    console.log(`[4/5] ✅ Transaction broadcast`);
    console.log(`      Transaction ID: ${txId}`);

    // ------------------------------------------------------------------------
    // Step 5: Track Transaction Confirmation
    // ------------------------------------------------------------------------
    if (EXAMPLE_CONFIG.trackTransaction) {
      console.log(`\n[5/5] Tracking transaction confirmation...`);
      console.log(`      Waiting for transaction to be included in a block...`);
      console.log(`      (This may take several minutes)`);

      const status = await trackTransactionStatus(txId, EXAMPLE_CONFIG.endpoint + `/${EXAMPLE_CONFIG.network}`, {
        timeout: EXAMPLE_CONFIG.trackingTimeout,
        fetchTimeout: EXAMPLE_CONFIG.fetchTimeout,
        maxAttempts: EXAMPLE_CONFIG.maxTrackingAttempts,
        pollInterval: EXAMPLE_CONFIG.pollInterval,
      });

      console.log(`\n[5/5] ✅ Transaction tracking complete!`);
      console.log(`\nFinal Status:`);
      console.log(`      Status: ${status.status.toUpperCase()}`);
      console.log(`      Transaction ID: ${status.confirmedId || txId}`);

      if (status.blockHeight) {
        console.log(`      Block Height: ${status.blockHeight}`);
      }

      if (status.type) {
        console.log(`      Type: ${status.type}`);
      }

      if (status.error) {
        console.log(`      Error: ${status.error}`);
      }

      // Exit with error if transaction was not accepted
      if (status.status !== "accepted") {
        console.error(`\n⚠️  Transaction was not accepted. Status: ${status.status}`);
        if (status.status === "pending") {
          console.error(`    The transaction may still be pending. Check the explorer for updates.`);
        } else if (status.status === "aborted") {
          console.error(`    Both execution and fee processing failed.`);
        } else if (status.status === "rejected") {
          console.error(`    The transaction was rejected by the network.`);
        }
        throw new Error(`Transaction ${status.status}: ${status.error || "No additional details"}`);
      }

      return { txId, status };
    } else {
      // ------------------------------------------------------------------------
      // Step 5: Transaction Broadcast Complete (No Tracking)
      // ------------------------------------------------------------------------
      console.log(`\n[5/5] ✅ Transaction broadcast complete!`);
      console.log(`\nTransaction Details:`);
      console.log(`      ID: ${txId}`);
      console.log(`      Explorer: ${getExplorerUrl(EXAMPLE_CONFIG.endpoint, EXAMPLE_CONFIG.network, txId) ?? 'unavaialbe'}`);
      console.log(`\nNote: Transaction tracking is disabled.`);
      console.log(`      Check the status manually using the explorer link above if available.`);

      return { txId };
    }
  } catch (error: any) {
    console.error(`\n[4/5] ❌ Transaction execution failed`);
    console.error(`      Error: ${error.message}`);

    throw error;
  }
}

/**
 * Generates explorer URL for a transaction if endpoint is provable.com
 * @param endpoint - API endpoint URL
 * @param network - Network name (mainnet or testnet)
 * @param txId - Transaction ID
 * @returns Explorer URL or undefined if not a provable.com endpoint
 */
export function getExplorerUrl(endpoint: string, network: string, txId: string): string | undefined {
  // Only generate explorer links for provable.com endpoints
  if (!endpoint.includes('provable.com')) {
    return undefined;
  }

  // Determine subdomain based on network
  const subdomain = network === 'testnet' ? 'testnet.explorer' : 'explorer';
  return `https://${subdomain}.provable.com/transaction/${txId}`;
}

// ============================================================================
// Execute Main Function
// ============================================================================

main()
  .then(() => {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ Example completed successfully!`);
    console.log(`${"=".repeat(80)}\n`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`\n${"=".repeat(80)}`);
    console.error(`❌ Example failed with error:`);
    console.error(`${"=".repeat(80)}`);
    console.error(error);
    console.error(`\n`);
    process.exit(1);
  });
