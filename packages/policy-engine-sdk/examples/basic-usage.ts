/**
 * Basic usage example for @sealance-io/policy-engine-aleo
 *
 * This example demonstrates:
 * 1. Initializing the PolicyEngine
 * 2. Fetching freeze list from chain
 * 3. Generating non-inclusion proofs
 * 4. Using utility functions
 */

import { PolicyEngine, convertAddressToField, ZERO_ADDRESS } from "@sealance-io/policy-engine-aleo";

async function main() {
  // Initialize the SDK with your Aleo node endpoint
  const engine = new PolicyEngine({
    endpoint: "http://localhost:3030",
    network: "testnet",
    maxTreeDepth: 15,
    leavesLength: 16384,
  });

  console.log("=== Fetching Freeze List from Chain ===");

  try {
    // Fetch the current freeze list from the blockchain
    const freezeListResult = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");

    console.log(`Found ${freezeListResult.addresses.length} frozen addresses`);
    console.log(`Last index: ${freezeListResult.lastIndex}`);
    console.log(`Current root: ${freezeListResult.currentRoot}`);

    // Filter out zero addresses
    const activeAddresses = freezeListResult.addresses.filter(addr => addr !== ZERO_ADDRESS);
    console.log(`Active frozen addresses: ${activeAddresses.length}`);

    console.log("\n=== Generating Non-Inclusion Proof ===");

    // Example address to prove is NOT in the freeze list
    const addressToCheck = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";

    // Generate witness (non-inclusion proof)
    const witness = await engine.genNonInclusionProof(addressToCheck, {
      programId: "sealance_freezelist_registry.aleo",
      // Optional: pass cached freeze list to avoid refetching
      // freezeList: freezeListResult.addresses
    });

    console.log(`Generated proofs for address: ${addressToCheck}`);
    console.log(`Root: ${witness.root}`);
    console.log(`Proof 1 - leaf index: ${witness.proofs[0].leaf_index}`);
    console.log(`Proof 1 - siblings length: ${witness.proofs[0].siblings.length}`);
    console.log(`Proof 2 - leaf index: ${witness.proofs[1].leaf_index}`);
    console.log(`Proof 2 - siblings length: ${witness.proofs[1].siblings.length}`);

    console.log("\n=== Using Proofs in Leo Program ===");
    console.log("// In your Leo program or TypeScript code:");
    console.log(`
    const tx = await policyContract.transfer_private(
      recipientAddress,
      amount,
      inputRecord,
      ${JSON.stringify({ siblings: witness.proofs[0].siblings.map(s => s.toString()), leaf_index: witness.proofs[0].leaf_index })},
      ${JSON.stringify({ siblings: witness.proofs[1].siblings.map(s => s.toString()), leaf_index: witness.proofs[1].leaf_index })},
      investigatorAddress
    );
    `);

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
    console.log(`Leaves Length: ${config.leavesLength}`);

  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the example
main().catch(console.error);
