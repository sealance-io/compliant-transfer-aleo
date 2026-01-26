# API Reference

Complete API documentation for `@sealance-io/policy-engine-aleo`.

## PolicyEngine

Main class for SDK operations.

### Constructor

```typescript
new PolicyEngine(config?: PolicyEngineConfig)
```

**Config Options (all optional):**

| Option           | Type     | Default                                     | Description                    |
| ---------------- | -------- | ------------------------------------------- | ------------------------------ |
| `endpoint`       | `string` | `"https://api.explorer.provable.com/v1"`    | Aleo network endpoint          |
| `network`        | `string` | `"mainnet"`                                 | Network name                   |
| `maxTreeDepth`   | `number` | `15`                                        | Maximum Merkle tree depth      |
| `maxRetries`     | `number` | `5`                                         | Max API retry attempts         |
| `retryDelay`     | `number` | `2000`                                      | Delay between retries (ms)     |
| `maxConcurrency` | `number` | `10`                                        | Max concurrent HTTP requests   |
| `logger`         | `Logger` | `defaultLogger`                             | Custom logger function         |

### Methods

#### `fetchCurrentRoot(programId: string): Promise<bigint>`

Fetches only the current Merkle root from the blockchain. Lightweight operation (single API call) without fetching the entire freeze list or building the tree.

```typescript
const currentRoot = await engine.fetchCurrentRoot("sealance_freezelist_registry.aleo");
// Returns: 123456789n

// Use for cache validation
if (cache.root !== currentRoot) {
  const freezeList = await engine.fetchFreezeListFromChain(programId);
  cache = { addresses: freezeList.addresses, root: currentRoot };
}
```

#### `fetchFreezeListFromChain(programId: string): Promise<FreezeListResult>`

Fetches the freeze list from the blockchain by querying the `freeze_list_index` mapping.

```typescript
const result = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
// Returns:
// {
//   addresses: ["aleo1...", "aleo1..."],
//   lastIndex: 5,
//   currentRoot: 123456789n
// }
```

#### `generateFreezeListNonInclusionProof(address: string, options?: NonInclusionProofOptions): Promise<NonInclusionWitness>`

Generates a non-inclusion proof for private compliant transfers.

```typescript
const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
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

#### `buildMerkleTree(addresses: string[]): bigint[]`

Builds a complete Merkle tree from an array of addresses.

```typescript
const tree = engine.buildMerkleTree(["aleo1...", "aleo1..."]);
```

#### `getMerkleRoot(addresses: string[]): bigint`

Computes the Merkle root from a list of addresses.

```typescript
const root = engine.getMerkleRoot(["aleo1...", "aleo1..."]);
```

#### `getConfig(): Required<PolicyEngineConfig>`

Gets the current PolicyEngine configuration.

```typescript
const config = engine.getConfig();
console.log(config.endpoint); // "https://api.explorer.provable.com/v1"
console.log(config.network);  // "mainnet"
```

## Utility Functions

### Address Conversion

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

// Convert ASCII string to BigInt (for token names, symbols)
const nameField = stringToBigInt("MyToken");
console.log(nameField); // 39473518878318894n
```

### Merkle Tree Operations

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

### Transaction Tracking

```typescript
import { trackTransactionStatus } from "@sealance-io/policy-engine-aleo";

// Track with default settings (5 minute timeout)
const status = await trackTransactionStatus(txId, "http://localhost:3030/testnet");

// Track with custom options
const status = await trackTransactionStatus(
  txId,
  "https://api.explorer.provable.com/v1/testnet",
  {
    timeout: 600000,        // Overall timeout: 10 minutes
    pollInterval: 10000,    // Check every 10 seconds
    fetchTimeout: 30000,    // 30 second timeout per request
    maxAttempts: 60         // Max 60 polling attempts
  }
);

if (status.status === "accepted") {
  console.log(`Transaction confirmed in block ${status.blockHeight}`);
} else if (status.status === "rejected") {
  console.error(`Transaction failed: ${status.error}`);
}
```

## Type Definitions

### MerkleProof

```typescript
interface MerkleProof {
  siblings: bigint[];
  leaf_index: number;
}
```

### NonInclusionWitness

```typescript
interface NonInclusionWitness {
  proofs: [MerkleProof, MerkleProof];
  root: bigint;
  freezeList: string[];
}
```

### FreezeListResult

```typescript
interface FreezeListResult {
  addresses: string[];
  lastIndex: number;
  currentRoot: bigint;
}
```

### TransactionStatus

```typescript
interface TransactionStatus {
  status: 'accepted' | 'rejected' | 'aborted' | 'pending';
  type: 'execute' | 'deploy' | 'fee';
  confirmedId: string;
  unconfirmedId?: string;
  blockHeight?: number;
  error?: string;
}
```

**Status meanings:**
- `accepted`: Successfully executed and included in a block
- `rejected`: Failed but fee was consumed (type will be 'fee')
- `aborted`: Both execution and fee processing failed
- `pending`: Waiting to be included in a block

### TransactionTrackingOptions

```typescript
interface TransactionTrackingOptions {
  maxAttempts?: number;     // Max polling attempts (default: 60)
  pollInterval?: number;    // Delay between polls in ms (default: 5000)
  timeout?: number;         // Overall timeout in ms (default: 300000)
  fetchTimeout?: number;    // Per-request timeout in ms (default: 30000)
  network?: string;         // Network name for logging
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

// Custom logger
const customLogger: Logger = (level, message, ...args) => {
  console.log(`[${level.toUpperCase()}] ${message}`, ...args);
};
const engine2 = new PolicyEngine({ logger: customLogger });
```

## Constants

| Constant          | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| `ZERO_ADDRESS`    | `"aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc"` |
| `maxTreeDepth`    | `15` (default)                                                        |
| `leavesLength`    | `16384` (2^14, default)                                               |

## Program Compatibility

Your Aleo program must include these mappings:

```leo
mapping freeze_list_index: u32 => address;
mapping freeze_list_last_index: bool => u32;
mapping freeze_list_root: u8 => field;
```

**Compatible programs:**
- `sealance_freezelist_registry.aleo` - Reference implementation
- `sealed_report_policy.aleo` - Transaction reporting
- `sealed_threshold_report_policy.aleo` - Threshold reporting
- `sealed_timelock_policy.aleo` - Time-locked transfers

## Best Practices

### Cache Freeze List with Root Validation

```typescript
interface FreezeListCache {
  addresses: string[];
  root: bigint;
  lastFetched: Date;
}

let cache: FreezeListCache | null = null;

// Before each proof generation:
const currentRoot = await engine.fetchCurrentRoot(programId);

if (!cache || cache.root !== currentRoot) {
  const freezeListResult = await engine.fetchFreezeListFromChain(programId);
  cache = {
    addresses: freezeListResult.addresses,
    root: currentRoot,
    lastFetched: new Date(),
  };
}

const witness = await engine.generateFreezeListNonInclusionProof(address, {
  freezeList: cache.addresses,
  programId,
});
```

### Error Handling

```typescript
try {
  const witness = await engine.generateFreezeListNonInclusionProof(address);
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
