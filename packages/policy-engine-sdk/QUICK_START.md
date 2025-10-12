# Quick Start Guide

Get up and running with `@sealance-io/policy-engine-aleo` in 5 minutes.

## Installation

```bash
npm install @sealance-io/policy-engine-aleo
```

Configure `.npmrc` for GitHub registry:
```bash
echo "@sealance-io:registry=https://npm.pkg.github.com" >> .npmrc
```

## Basic Usage

### 1. Initialize the SDK

```typescript
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

const engine = new PolicyEngine({
  endpoint: "http://localhost:3030",
  network: "testnet"
});
```

### 2. Fetch Freeze List

```typescript
const result = await engine.fetchFreezeListFromChain(
  "sealance_freezelist_registry.aleo"
);

console.log(`Found ${result.addresses.length} frozen addresses`);
console.log(`Current root: ${result.currentRoot}`);
```

### 3. Generate Proof

```typescript
const witness = await engine.generateNonInclusionProof(
  "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
  {
    programId: "sealance_freezelist_registry.aleo"
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

### Pattern 1: Cache Freeze List

When generating multiple proofs, fetch once and reuse:

```typescript
// Fetch once
const freezeList = await engine.fetchFreezeListFromChain(programId);

// Reuse for multiple addresses
for (const address of addresses) {
  const witness = await engine.generateNonInclusionProof(address, {
    freezeList: freezeList.addresses,
    programId
  });
  // Use witness...
}
```

### Pattern 2: Custom Configuration

```typescript
const engine = new PolicyEngine({
  endpoint: "https://api.explorer.provable.com/v1",
  network: "testnet",
  maxTreeDepth: 15,        // Merkle tree depth
  leavesLength: 16384,     // 2^14 leaves
  maxRetries: 5,           // API retry attempts
  retryDelay: 2000         // Delay between retries (ms)
});
```

### Pattern 3: Utility Functions

```typescript
import {
  convertAddressToField,
  convertFieldToAddress,
  buildTree,
  genLeaves
} from "@sealance-io/policy-engine-aleo";

// Convert address to field
const field = convertAddressToField("aleo1...");

// Build custom tree
const leaves = genLeaves(["aleo1...", "aleo1..."], 15);
const tree = buildTree(leaves);
const root = tree[tree.length - 1];
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | Required | Aleo node endpoint |
| `network` | `string` | Required | Network name (testnet/mainnet) |
| `maxTreeDepth` | `number` | `15` | Max Merkle tree depth |
| `leavesLength` | `number` | `16384` | Number of tree leaves |
| `maxRetries` | `number` | `5` | API retry attempts |
| `retryDelay` | `number` | `2000` | Retry delay (ms) |

## API Quick Reference

### PolicyEngine Methods

- `fetchFreezeListFromChain(programId)`: Fetch addresses from chain
- `generateNonInclusionProof(address, options)`: Generate non-inclusion proof
- `buildMerkleTree(addresses)`: Build tree from addresses
- `getMerkleRoot(addresses)`: Get root from addresses
- `getConfig()`: Get current configuration

### Utility Functions

- `convertAddressToField(address)`: Address → Field
- `convertFieldToAddress(field)`: Field → Address
- `stringToBigInt(str)`: ASCII → BigInt
- `buildTree(leaves)`: Build Merkle tree
- `genLeaves(addresses, depth)`: Generate sorted leaves
- `getLeafIndices(tree, address)`: Find leaf indices
- `getSiblingPath(tree, index, depth)`: Generate proof

### Type Exports

- `MerkleProof`: Proof structure
- `PolicyEngineConfig`: SDK configuration
- `FreezeListResult`: Fetch result
- `TransferWitnessOptions`: Witness options
- `TransferWitness`: Witness result

## Error Handling

Always wrap API calls in try-catch:

```typescript
try {
  const witness = await engine.generateNonInclusionProof(address);
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

## Support

For issues and questions:
- GitHub Issues: https://github.com/sealance-io/compliant-transfer-aleo/issues
- Documentation: https://github.com/sealance-io/compliant-transfer-aleo

## License

Apache-2.0 © 2024 Sealance Team
