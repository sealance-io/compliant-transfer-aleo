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

// Initialize the SDK
const engine = new PolicyEngine({
  endpoint: "http://localhost:3030",
  network: "testnet",
});

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
new PolicyEngine(config: PolicyEngineConfig)
```

**Config Options:**
- `endpoint`: Aleo network endpoint (e.g., "http://localhost:3030")
- `network`: Network name (e.g., "testnet", "mainnet")
- `maxTreeDepth`: Maximum depth of Merkle tree (default: 15)
- `leavesLength`: Number of leaves in tree (default: 16384)
- `maxRetries`: Max API retry attempts (default: 5)
- `retryDelay`: Delay between retries in ms (default: 2000)

#### Methods

##### `fetchFreezeListFromChain(programId?: string): Promise<FreezeListResult>`

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

### Utility Functions

#### Address Conversion

```typescript
import {
  convertAddressToField,
  convertFieldToAddress
} from "@sealance-io/policy-engine-aleo";

// Convert address to field element
const field = convertAddressToField("aleo1...");
console.log(field); // 123456789n

// Convert field element back to address
const address = convertFieldToAddress("123456789field");
console.log(address); // "aleo1..."
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

## Usage with Tests

The SDK can be used in your test suites alongside the main repository's testing infrastructure:

```typescript
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";

describe("Freeze List Tests", () => {
  const engine = new PolicyEngine({
    endpoint: "http://localhost:3030",
    network: "testnet",
  });

  test("verify non-inclusion", async () => {
    const address = "aleo1...";
    const witness = await engine.generateNonInclusionProof(address);

    // Use with contract
    const contract = new Sealance_freezelist_registryContract({...});
    const tx = await contract.verify_non_inclusion_priv(
      address,
      witness.proofs
    );
    await tx.wait();
  });
});
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

## Constants

- `ZERO_ADDRESS`: `"aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc"`
- Default `maxTreeDepth`: `15`
- Default `leavesLength`: `16384` (2^14)

## Best Practices

1. **Reuse PolicyEngine instances**: Creating a new instance is lightweight, but reusing avoids redundant configuration.

2. **Cache freeze lists**: If making multiple proof generations, fetch the freeze list once and pass it via `options.freezeList`.

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
