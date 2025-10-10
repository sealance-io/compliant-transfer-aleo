/**
 * Example: Using cached freeze list for multiple proof generations
 *
 * This demonstrates best practices when generating multiple proofs:
 * - Fetch the freeze list once
 * - Reuse it for multiple witness generations
 * - Reduces API calls and improves performance
 */

import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

async function main() {
  const engine = new PolicyEngine({
    endpoint: "http://localhost:3030",
    network: "testnet",
  });

  console.log("=== Fetching Freeze List Once ===");

  // Fetch freeze list once
  const freezeListResult = await engine.fetchFreezeListFromChain("sealed_report_policy.aleo");

  console.log(`Fetched ${freezeListResult.addresses.length} addresses`);
  console.log(`Current root: ${freezeListResult.currentRoot}\n`);

  // Multiple addresses to check
  const addressesToCheck = [
    "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    "aleo1j7qxyunfldj2lp8hsvy7mw5k8zaqgjfyr72x2gh3x4ewgae8v5gscf5jh3",
    "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc",
  ];

  console.log("=== Generating Multiple Proofs with Cached Freeze List ===\n");

  for (const address of addressesToCheck) {
    try {
      // Generate witness using cached freeze list
      const witness = await engine.genNonInclusionProof(address, {
        freezeList: freezeListResult.addresses, // Reuse cached data
        programId: "sealed_report_policy.aleo",
      });

      console.log(`Address: ${address.slice(0, 20)}...`);
      console.log(`  Root: ${witness.root}`);
      console.log(`  Proof indices: [${witness.proofs[0].leaf_index}, ${witness.proofs[1].leaf_index}]`);
      console.log(`  ✅ Proof generated successfully\n`);
    } catch (error) {
      console.error(`  ❌ Error for ${address}:`, error);
    }
  }

  console.log("=== Performance Benefit ===");
  console.log("By caching the freeze list:");
  console.log("- Made 1 API call instead of", addressesToCheck.length);
  console.log("- Reduced network latency");
  console.log("- Faster proof generation");
}

main().catch(console.error);
