# @sealance-io/policy-engine-aleo

SDK for generating Merkle proofs and interacting with Aleo compliance policy programs.

## Features

- Merkle Tree Operations: Build trees, sort leaves, compute roots
- Non-Inclusion Proofs: Generate proofs for private compliant operations
- Blockchain Integration: Fetch freeze lists from Aleo nodes
- Address Conversion: Convert between Aleo addresses and field elements
- ESM Only: Modern ES module package
- Minimal Dependencies: Only `@provablehq/sdk` and `@scure/base`

## Installation

```bash
npm install @sealance-io/policy-engine-aleo
```

## Quick Start

```typescript
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

// 1. Initialize (defaults to mainnet)
const engine = new PolicyEngine();
// For testnet: new PolicyEngine({ endpoint: "https://api.explorer.provable.com/v1", network: "testnet" })
// For devnet: new PolicyEngine({ endpoint: "http://localhost:3030", network: "testnet" })

// 2. Fetch freeze list
const freezeList = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
console.log(`Found ${freezeList.addresses.length} frozen addresses`);

// 3. Generate non-inclusion proof
const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
  programId: "sealance_freezelist_registry.aleo",
});

// 4. Use in Leo transaction
const tx = await policyContract.transfer_private(recipient, amount, inputRecord, witness.proofs);
```

## API Overview

### PolicyEngine Methods

| Method                                | Description                              |
| ------------------------------------- | ---------------------------------------- |
| `fetchCurrentRoot(programId)`         | Lightweight root fetch (1 API call)      |
| `fetchFreezeListFromChain(programId)` | Fetch full freeze list                   |
| `generateFreezeListNonInclusionProof(addr, opts)` | Generate non-inclusion proof |
| `buildMerkleTree(addresses)`          | Build tree from addresses                |
| `getMerkleRoot(addresses)`            | Compute root from addresses              |
| `getConfig()`                         | Get current configuration                |

### Utility Functions

| Function                  | Description                              |
| ------------------------- | ---------------------------------------- |
| `convertAddressToField`   | Address → field element                  |
| `convertFieldToAddress`   | Field element → address                  |
| `stringToBigInt`          | ASCII string → BigInt                    |
| `buildTree`               | Build Merkle tree from leaves            |
| `generateLeaves`          | Generate sorted/padded leaves            |
| `getLeafIndices`          | Find leaf indices for address            |
| `getSiblingPath`          | Generate Merkle proof                    |
| `trackTransactionStatus`  | Track transaction confirmation           |

See [API.md](./API.md) for complete documentation.

## Configuration

| Option           | Default                                  | Description                    |
| ---------------- | ---------------------------------------- | ------------------------------ |
| `endpoint`       | `"https://api.explorer.provable.com/v1"` | Aleo network endpoint          |
| `network`        | `"mainnet"`                              | Network name                   |
| `maxTreeDepth`   | `15`                                     | Maximum Merkle tree depth      |
| `maxRetries`     | `5`                                      | Max API retry attempts         |
| `retryDelay`     | `2000`                                   | Delay between retries (ms)     |
| `maxConcurrency` | `10`                                     | Max concurrent HTTP requests   |
| `logger`         | `defaultLogger`                          | Custom logger function         |

## Program Compatibility

Your Aleo program must include these mappings:

```leo
mapping freeze_list_index: u32 => address;
mapping freeze_list_last_index: bool => u32;
mapping freeze_list_root: u8 => field;
```

Compatible programs: `sealance_freezelist_registry.aleo`, `sealed_report_policy.aleo`, `sealed_threshold_report_policy.aleo`, `sealed_timelock_policy.aleo`

## Cache Pattern (Recommended)

```typescript
let cache: { addresses: string[]; root: bigint } | null = null;

// Validate cache with lightweight root check
const currentRoot = await engine.fetchCurrentRoot(programId);
if (!cache || cache.root !== currentRoot) {
  const result = await engine.fetchFreezeListFromChain(programId);
  cache = { addresses: result.addresses, root: currentRoot };
}

// Use validated cache
const witness = await engine.generateFreezeListNonInclusionProof(address, {
  freezeList: cache.addresses,
  programId,
});
```

See `examples/cached-freeze-list.ts` for complete implementation.

## Documentation

- [API.md](./API.md) - Complete API reference
- [examples/](./examples/) - Usage examples
- [CHANGELOG.md](./CHANGELOG.md) - Version history

## Development

```bash
npm run build                # Build package
npm run test                 # Run tests
npm run format:fix           # Format code
```

## License

Apache License, Version 2.0. See [LICENSE](./LICENSE).

## Support

[GitHub Issues](https://github.com/sealance-io/compliant-transfer-aleo/issues)
