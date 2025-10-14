# @sealance-io/policy-engine-aleo

SDK for generating Merkle proofs and interacting with Aleo compliance policy programs.

## Features

- 🌲 **Merkle Tree Operations**: Build trees, sort leaves, and compute roots
- 🔐 **Non-Inclusion Proofs**: Generate proofs for private compliant operations
- 🌐 **Blockchain Integration**: Fetch freeze lists from Aleo nodes
- 🔄 **Address Conversion**: Convert between Aleo addresses and field elements
- 📦 **ESM Only**: Modern ES module package
- 🚀 **Zero Dependencies** (except @provablehq/sdk and @scure/base)

## Installation

```bash
npm install @sealance-io/policy-engine-aleo
```

### GitHub Package Registry Setup

Since this package is published to GitHub's npm registry, you need to configure your `.npmrc`:

```bash
echo "@sealance-io:registry=https://npm.pkg.github.com" >> .npmrc
```

Or authenticate with:

```bash
npm login --scope=@sealance-io --registry=https://npm.pkg.github.com
```

## Quick Start

```typescript
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

// Initialize the SDK (defaults to mainnet)
const engine = new PolicyEngine();

// Or for public testnet:
// const engine = new PolicyEngine({
//   endpoint: "https://api.explorer.provable.com/v1",
//   network: "testnet",
// });

// Or for local devnet:
// const engine = new PolicyEngine({
//   endpoint: "http://localhost:3030",
//   network: "testnet",
// });

// Fetch the freeze list from chain
const freezeList = await engine.fetchFreezeListFromChain(
  "sealance_freezelist_registry.aleo"
);

console.log(`Found ${freezeList.addresses.length} frozen addresses`);
console.log(`Current root: ${freezeList.currentRoot}`);

// Generate non-inclusion proof for an address
const witness = await engine.generateNonInclusionProof("aleo1...", {
  programId: "sealance_freezelist_registry.aleo",
});

console.log(`Generated proofs with root: ${witness.root}`);
```

## API Reference

### PolicyEngine

Main class for SDK operations.

#### Constructor

```typescript
new PolicyEngine(config?: PolicyEngineConfig)
```

**Config Options (all optional):**
- `endpoint`: Aleo network endpoint (default: `"https://api.explorer.provable.com/v1"`)
- `network`: Network name (default: `"mainnet"`)
- `maxTreeDepth`: Maximum depth of Merkle tree (default: `15`)
- `maxRetries`: Max API retry attempts (default: `5`)
- `retryDelay`: Delay between retries in ms (default: `2000`)
- `maxConcurrency`: Max concurrent HTTP requests (default: `10`)
- `logger`: Custom logger function (default: `defaultLogger`)

#### Methods

##### `fetchCurrentRoot(programId: string): Promise<bigint>`

Fetches only the current Merkle root from the blockchain. This is a lightweight operation that makes a single API call without fetching the entire freeze list or building the Merkle tree. Use this method to validate cached freeze lists by comparing roots.

```typescript
const currentRoot = await engine.fetchCurrentRoot(
  "sealance_freezelist_registry.aleo"
);

// Returns: 123456789n

// Use for cache validation
if (cache.root !== currentRoot) {
  // Root changed - re-fetch freeze list
  const freezeList = await engine.fetchFreezeListFromChain(programId);
  cache = { addresses: freezeList.addresses, root: currentRoot };
}
```

##### `fetchFreezeListFromChain(programId: string): Promise<FreezeListResult>`

Fetches the freeze list from the blockchain by querying the `freeze_list_index` mapping.

```typescript
const result = await engine.fetchFreezeListFromChain(
  "sealance_freezelist_registry.aleo"
);

// Returns:
// {
//   addresses: ["aleo1...", "aleo1..."],
//   lastIndex: 5,
//   currentRoot: 123456789n
// }
```

##### `generateNonInclusionProof(address: string, options?: TransferWitnessOptions): Promise<TransferWitness>`

Generates a non-inclusion proof for private compliant transfers.

```typescript
const witness = await engine.generateNonInclusionProof("aleo1...", {
  programId: "sealance_freezelist_registry.aleo",
  freezeList: [...], // Optional: provide cached freeze list
});

// Returns:
// {
//   proofs: [MerkleProof, MerkleProof],
//   root: 123456789n,
//   freezeList: ["aleo1...", ...]
// }
```

**Usage with Leo Program:**

```typescript
// In your application code
const witness = await engine.generateNonInclusionProof(senderAddress);

// Use in Aleo transaction
const tx = await policyContract.transfer_private(
  recipient,
  amount,
  inputRecord,
  witness.proofs[0], // sender proof
  witness.proofs[1], // recipient proof
  investigatorAddress
);
```

##### `buildMerkleTree(addresses: string[]): bigint[]`

Builds a complete Merkle tree from an array of addresses.

```typescript
const tree = engine.buildMerkleTree(["aleo1...", "aleo1..."]);
```

##### `getMerkleRoot(addresses: string[]): bigint`

Computes the Merkle root from a list of addresses.

```typescript
const root = engine.getMerkleRoot(["aleo1...", "aleo1..."]);
```

##### `getConfig(): Required<PolicyEngineConfig>`

Gets the current PolicyEngine configuration.

```typescript
const config = engine.getConfig();
console.log(config.endpoint); // "https://api.explorer.provable.com/v1"
console.log(config.network);  // "mainnet"
```

### Utility Functions

#### Address Conversion

```typescript
import {
  convertAddressToField,
  convertFieldToAddress,
  stringToBigInt
} from "@sealance-io/policy-engine-aleo";

// Convert address to field element
const field = convertAddressToField("aleo1...");
console.log(field); // 123456789n

// Convert field element back to address
const address = convertFieldToAddress("123456789field");
console.log(address); // "aleo1..."

// Convert ASCII string to BigInt (for token names, symbols, etc.)
const nameField = stringToBigInt("MyToken");
console.log(nameField); // 39473518878318894n
```

#### Merkle Tree Operations

```typescript
import {
  buildTree,
  generateLeaves,
  getLeafIndices,
  getSiblingPath
} from "@sealance-io/policy-engine-aleo";

// Generate leaves from addresses (sorted and padded)
const leaves = generateLeaves(["aleo1...", "aleo1..."], 15);

// Build the tree
const tree = buildTree(leaves);

// Get leaf indices for non-inclusion proof
const [leftIdx, rightIdx] = getLeafIndices(tree, "aleo1...");

// Get sibling path (Merkle proof)
const proof = getSiblingPath(tree, leftIdx, 16);
```

## Type Definitions

### MerkleProof

```typescript
interface MerkleProof {
  siblings: bigint[];
  leaf_index: number;
}
```

### TransferWitness

```typescript
interface TransferWitness {
  proofs: [MerkleProof, MerkleProof];
  root: bigint;
  freezeList: string[];
}
```

### Logger

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";
type Logger = (level: LogLevel, message: string, ...args: unknown[]) => void;

// Built-in loggers
import { defaultLogger, silentLogger } from "@sealance-io/policy-engine-aleo";

// Use silent logger to suppress all logs
const engine = new PolicyEngine({ logger: silentLogger });

// Use custom logger
const customLogger: Logger = (level, message, ...args) => {
  console.log(`[${level.toUpperCase()}] ${message}`, ...args);
};
const engine2 = new PolicyEngine({ logger: customLogger });
```

## Constants

- `ZERO_ADDRESS`: `"aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc"`
- Default `maxTreeDepth`: `15`
- Default `leavesLength`: `16384` (2^14)

## Program Compatibility

The SDK is designed to work with any Aleo program that implements the freeze list API. Your program must include these mappings:

```leo
mapping freeze_list_index: u32 => address;
mapping freeze_list_last_index: bool => u32;
mapping freeze_list_root: u8 => field;
```

**Compatible programs in this repository:**
- `sealance_freezelist_registry.aleo` - Standalone freeze list registry (reference implementation)
- `sealed_report_policy.aleo` - Token with transaction reporting
- `sealed_threshold_report_policy.aleo` - Token with threshold-based reporting
- `sealed_timelock_policy.aleo` - Token with time-locked transfers

**Using multiple programs:**

```typescript
const engine = new PolicyEngine({
  endpoint: "http://localhost:3030",
  network: "testnet",
});

// Fetch from different programs
const registry = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
const policy = await engine.fetchFreezeListFromChain("custom_compliance_policy.aleo");

// Generate proofs for specific program
const witness1 = await engine.generateNonInclusionProof(address, {
  programId: "sealance_freezelist_registry.aleo",
});

const witness2 = await engine.generateNonInclusionProof(address, {
  programId: "custom_compliance_policy.aleo",
});
```

## Best Practices

1. **Reuse PolicyEngine instances**: Creating a new instance is lightweight, but reusing avoids redundant configuration.

2. **Cache freeze lists with root validation** (RECOMMENDED): When generating multiple proofs, use `fetchCurrentRoot` to validate your cache with a single lightweight API call:

   ```typescript
   // Cache structure
   interface FreezeListCache {
     addresses: string[];
     root: bigint;
     lastFetched: Date;
   }

   let cache: FreezeListCache | null = null;

   // Before each proof generation:
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
   const witness = await engine.generateNonInclusionProof(address, {
     freezeList: cache.addresses,
     programId,
   });
   ```

   **Why this pattern?**
   - Fetches ONLY the root (1 API call) to validate cache
   - Fetches full freeze list only when root changes
   - Avoids expensive tree building when cache is valid
   - Guarantees correctness while minimizing API calls
   - Ideal for applications generating many proofs

   See `examples/cached-freeze-list.ts` for a complete implementation.

3. **Error Handling**: Always wrap API calls in try-catch blocks:
   ```typescript
   try {
     const witness = await engine.generateNonInclusionProof(address);
   } catch (error) {
     console.error("Failed to generate witness:", error);
   }
   ```

4. **Testing**: Use the same devnet infrastructure as the main repository for consistent results.

## Development

```bash
# Install dependencies
npm install

# Build the package
npm run build

# Format code
npm run format:fix

# Clean build artifacts
npm run clean
```

## License

Apache-2.0

## Support

For issues and questions, please visit the [GitHub repository](https://github.com/sealance-io/compliant-transfer-aleo).
