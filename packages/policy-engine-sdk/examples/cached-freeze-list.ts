/**
 * Example: Using cached freeze list with root validation
 *
 * This demonstrates best practices for caching freeze lists:
 * 1. Fetch the freeze list and cache it in memory
 * 2. Before generating proofs, check if the on-chain root has changed
 * 3. Only re-fetch if the root has been invalidated
 * 4. Reuse cached data for multiple witness generations
 *
 * Benefits:
 * - Reduces API calls significantly
 * - Ensures proofs are always generated against current freeze list
 * - Improves performance while maintaining correctness
 */

import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

// In-memory cache (in production, consider using Redis, database, etc.)
interface FreezeListCache {
  addresses: string[];
  root: bigint;
  lastFetched: Date;
}

let cache: FreezeListCache | null = null;

async function main() {
  const engine = new PolicyEngine({
    endpoint: "http://localhost:3030",
    network: "testnet",
  });

  const programId = "sealed_report_policy.aleo";

  console.log("=== Initial Fetch ===");

  // First fetch: populate cache
  let freezeListResult = await engine.fetchFreezeListFromChain(programId);
  cache = {
    addresses: freezeListResult.addresses,
    root: freezeListResult.currentRoot,
    lastFetched: new Date(),
  };

  console.log(`Fetched ${cache.addresses.length} addresses`);
  console.log(`Cached root: ${cache.root}`);
  console.log(`Cache populated at: ${cache.lastFetched.toISOString()}\n`);

  // Multiple addresses to check
  const addressesToCheck = [
    "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    "aleo1j7qxyunfldj2lp8hsvy7mw5k8zaqgjfyr72x2gh3x4ewgae8v5gscf5jh3",
    "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc",
  ];

  console.log("=== Generating Proofs with Root Validation ===\n");

  for (const address of addressesToCheck) {
    try {
      // RECOMMENDED PATTERN: Validate cache before generating proof
      console.log(`Processing: ${address.slice(0, 20)}...`);

      // Step 1: Fetch ONLY the current root from chain (lightweight - single API call)
      const currentRoot = await engine.fetchCurrentRoot(programId);

      // Step 2: Compare with cached root
      if (!cache || cache.root !== currentRoot) {
        console.log("  ⚠️  Cache invalidated! Root changed on-chain.");
        console.log(`  Old root: ${cache?.root || 'none'}`);
        console.log(`  New root: ${currentRoot}`);

        // Step 3: Re-fetch freeze list only if root changed
        const freezeListResult = await engine.fetchFreezeListFromChain(programId);
        cache = {
          addresses: freezeListResult.addresses,
          root: currentRoot,
          lastFetched: new Date(),
        };
        console.log(`  ✓ Cache updated with ${cache.addresses.length} addresses\n`);
      } else {
        console.log("  ✓ Cache valid, using cached freeze list");
      }

      // Step 4: Generate witness using cached freeze list
      const witness = await engine.generateNonInclusionProof(address, {
        freezeList: cache.addresses, // Use validated cache
        programId,
      });

      console.log(`  Root: ${witness.root}`);
      console.log(`  Proof indices: [${witness.proofs[0].leaf_index}, ${witness.proofs[1].leaf_index}]`);
      console.log(`  ✅ Proof generated successfully\n`);
    } catch (error) {
      console.error(`  ❌ Error for ${address}:`, error);
    }
  }

  console.log("=== Performance Benefits ===");
  console.log("With root validation pattern using fetchCurrentRoot:");
  console.log("- Fetches ONLY the root (1 API call) to validate cache");
  console.log("- Fetches full freeze list only when root changes");
  console.log("- Avoids expensive tree building when cache is valid");
  console.log("- Guarantees correctness while minimizing API calls");
  console.log("- Ideal for applications generating many proofs");
  console.log("\nNote: In production, consider:");
  console.log("- Periodic root checks (e.g., every 30 seconds)");
  console.log("- Persistent cache (Redis, database)");
  console.log("- Cache TTL based on block time");
}

main().catch(console.error);
