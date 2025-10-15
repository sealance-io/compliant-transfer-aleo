# Quick Start Guide

Get up and running with `@sealance-io/policy-engine-aleo` in 5 minutes.

## Installation

```bash
npm install @sealance-io/policy-engine-aleo
```

## Basic Usage

### 1. Initialize the SDK

```typescript
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

// For production (mainnet - uses defaults)
const engine = new PolicyEngine();

// For public testnet
// const engine = new PolicyEngine({
//   endpoint: "https://api.explorer.provable.com/v1",
//   network: "testnet"
// });

// For local devnet
// const engine = new PolicyEngine({
//   endpoint: "http://localhost:3030",
//   network: "testnet"
// });
```

### 2. Fetch Freeze List

```typescript
const freezeList = await engine.fetchFreezeListFromChain(
  "sealance_freezelist_registry.aleo"
);

console.log(`Found ${freezeList.addresses.length} frozen addresses`);
console.log(`Current root: ${freezeList.currentRoot}`);
```

### 3. Generate Proof

```typescript
const witness = await engine.generateFreezeListNonInclusionProof(
  "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
  {
    freezeList: freezeList.addresses
  }
);

console.log(`Proofs generated with root: ${witness.root}`);
```

### 4. Use in Leo Transaction

```typescript
// With doko-js
import { Sealance_freezelist_registryContract } from "./artifacts/js/sealance_freezelist_registry";

const contract = new Sealance_freezelist_registryContract({
  mode: ExecutionMode.SnarkExecute,
  privateKey: "..."
});

const tx = await contract.verify_non_inclusion_priv(
  address,
  witness.proofs
);

await tx.wait();
```

## Common Patterns

### Pattern 1: Cache Freeze List with Root Validation (RECOMMENDED)

When generating multiple proofs, use `fetchCurrentRoot` to validate your cache with a single lightweight API call:

```typescript
// Cache structure
interface FreezeListCache {
  addresses: string[];
  root: bigint;
  lastFetched: Date;
}

let cache: FreezeListCache | null = null;

// For each address
for (const address of addresses) {
  // Fetch ONLY the root (1 API call, no tree building)
  const currentRoot = await engine.fetchCurrentRoot(programId);

  // Compare cached root with on-chain root
  if (!cache || cache.root !== currentRoot) {
    // Root changed - re-fetch freeze list
    const freezeListResult = await engine.fetchFreezeListFromChain(programId);
    cache = {
      addresses: freezeListResult.addresses,
      root: currentRoot,
      lastFetched: new Date(),
    };
  }

  // Use validated cache
  const witness = await engine.generateFreezeListNonInclusionProof(address, {
    freezeList: cache.addresses,
    programId
  });
  // Use witness...
}
```

See `examples/cached-freeze-list.ts` for a complete implementation.

### Pattern 2: Custom Configuration

```typescript
// Public testnet with custom settings
const engine = new PolicyEngine({
  endpoint: "https://api.explorer.provable.com/v1",
  network: "testnet",
  maxTreeDepth: 15,        // Merkle tree depth
  maxRetries: 5,           // API retry attempts
  retryDelay: 2000,        // Delay between retries (ms)
  maxConcurrency: 10       // Parallel HTTP requests
});
```

### Pattern 3: Utility Functions

```typescript
import {
  convertAddressToField,
  convertFieldToAddress,
  buildTree,
  generateLeaves
} from "@sealance-io/policy-engine-aleo";

// Convert address to field
const field = convertAddressToField("aleo1...");

// Build custom tree
const leaves = generateLeaves(["aleo1...", "aleo1..."], 15);
const tree = buildTree(leaves);
const root = tree[tree.length - 1];
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `"https://api.explorer.provable.com/v1"` | Aleo node endpoint |
| `network` | `string` | `"mainnet"` | Network name (testnet/mainnet) |
| `maxRetries` | `number` | `5` | API retry attempts |
| `retryDelay` | `number` | `2000` | Retry delay (ms) |
| `maxConcurrency` | `number` | `10` | Max concurrent HTTP requests |
| `logger` | `Logger` | `defaultLogger` | Custom logger function |

## API Quick Reference

### PolicyEngine Methods

- `fetchCurrentRoot(programId)`: Fetch only the root (lightweight, 1 API call)
- `fetchFreezeListFromChain(programId)`: Fetch addresses from chain
- `generateFreezeListNonInclusionProof(address, options)`: Generate non-inclusion proof
- `buildMerkleTree(addresses)`: Build tree from addresses
- `getMerkleRoot(addresses)`: Get root from addresses
- `getConfig()`: Get current configuration

### Utility Functions

- `convertAddressToField(address)`: Address → Field
- `convertFieldToAddress(field)`: Field → Address
- `stringToBigInt(str)`: Convert ASCII string to BigInt (for token names/symbols)
- `buildTree(leaves)`: Build Merkle tree
- `generateLeaves(addresses, depth)`: Generate sorted leaves
- `getLeafIndices(tree, address)`: Find leaf indices
- `getSiblingPath(tree, index, depth)`: Generate proof

### Type Exports

- `MerkleProof`: Proof structure
- `PolicyEngineConfig`: SDK configuration
- `FreezeListResult`: Fetch result
- `NonInclusionProofOptions`: Witness options
- `NonInclusionWitness`: Witness result

## Error Handling

Always wrap API calls in try-catch:

```typescript
try {
  const witness = await engine.generateFreezeListNonInclusionProof(address);
  // Use witness...
} catch (error) {
  if (error.message.includes("Failed to fetch")) {
    console.error("Network error:", error);
  } else if (error.message.includes("Leaves limit exceeded")) {
    console.error("Tree capacity exceeded:", error);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Next Steps

- Read the full [README.md](./README.md) for detailed documentation
- Check [examples/](./examples/) for complete examples
- Review [DEVELOPMENT.md](./DEVELOPMENT.md) for contributing
- See [CHANGELOG.md](./CHANGELOG.md) for version history
