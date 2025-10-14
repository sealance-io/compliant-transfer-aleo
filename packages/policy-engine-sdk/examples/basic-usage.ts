/**
 * Basic usage example for @sealance-io/policy-engine-aleo
 *
 * This example demonstrates:
 * 1. Initializing the PolicyEngine
 * 2. Fetching freeze list from chain
 * 3. Generating non-inclusion proofs
 * 4. Using utility functions
 *
 * NOTE: This example works with any Aleo program that implements the freeze list API:
 * - mapping freeze_list_index: u32 => address
 * - mapping freeze_list_last_index: bool => u32
 * - mapping freeze_list_root: u8 => field
 *
 * Examples of compatible programs:
 * - sealance_freezelist_registry.aleo (reference implementation)
 * - sealed_report_policy.aleo
 * - custom_compliance_policy.aleo (your own program)
 */

import { PolicyEngine, convertAddressToField } from "@sealance-io/policy-engine-aleo";

// Configuration - customize for your use case
const EXAMPLE_CONFIG = {
  endpoint: "http://localhost:3030", // or "https://api.explorer.provable.com/v1" for public aleo networks
  network: "testnet", // or "mainnet"
  programId: "sealance_freezelist_registry.aleo", // Change to your deployed program
};

async function main() {
  // Initialize the SDK with your Aleo node endpoint
  const engine = new PolicyEngine({
    endpoint: EXAMPLE_CONFIG.endpoint,
    network: EXAMPLE_CONFIG.network,
    maxTreeDepth: 15,
  });

  console.log("=== Fetching Freeze List from Chain ===");
  console.log(`Program: ${EXAMPLE_CONFIG.programId}`);

  try {
    // Fetch the current freeze list from the blockchain
    const freezeListResult = await engine.fetchFreezeListFromChain(EXAMPLE_CONFIG.programId);

    console.log(`Found ${freezeListResult.addresses.length} frozen addresses`);
    console.log(`Last index: ${freezeListResult.lastIndex}`);
    console.log(`Current root: ${freezeListResult.currentRoot}`);

    console.log("\n=== Generating Non-Inclusion Proof ===");

    // Example address to prove is NOT in the freeze list
    const addressToCheck = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";

    // Generate witness (non-inclusion proof)
    const witness = await engine.generateNonInclusionProof(addressToCheck, {
      programId: EXAMPLE_CONFIG.programId,
      // Optional: pass cached freeze list to avoid refetching
      // freezeList: freezeListResult.addresses
    });

    console.log(`Generated proofs for address: ${addressToCheck}`);
    console.log(`Root: ${witness.root}`);
    console.log(`Proof 1 - leaf index: ${witness.proofs[0].leaf_index}`);
    console.log(`Proof 1 - siblings length: ${witness.proofs[0].siblings.length}`);
    console.log(`Proof 2 - leaf index: ${witness.proofs[1].leaf_index}`);
    console.log(`Proof 2 - siblings length: ${witness.proofs[1].siblings.length}`);

    console.log("\n=== Utility Functions ===");

    // Convert address to field
    const addressField = convertAddressToField(addressToCheck);
    console.log(`Address as field: ${addressField}`);

    // Build a custom Merkle tree
    const customAddresses = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1j7qxyunfldj2lp8hsvy7mw5k8zaqgjfyr72x2gh3x4ewgae8v5gscf5jh3",
    ];

    const root = engine.getMerkleRoot(customAddresses);
    console.log(`\nCustom tree root: ${root}`);

    console.log("\n=== Configuration ===");
    const config = engine.getConfig();
    console.log(`Endpoint: ${config.endpoint}`);
    console.log(`Network: ${config.network}`);
    console.log(`Max Tree Depth: ${config.maxTreeDepth}`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
