# API Reference

API reference for `@sealance-io/policy-engine-aleo`. Installation, configuration options, program compatibility and the recommended cache pattern are in the [README](./README.md). All exports carry TSDoc, visible in your IDE.

## PolicyEngine

```typescript
const engine = new PolicyEngine();
```

The constructor takes an optional `PolicyEngineConfig`; options and defaults are in the README's "Configuration" section.

| Method                                                                                 | Description                                                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `fetchCurrentRoot(programId): Promise<bigint>`                                         | Reads only the `freeze_list_root` mapping (one API call). Use to validate a cache |
| `fetchFreezeListFromChain(programId): Promise<FreezeListResult>`                       | Reads `freeze_list_last_index` and the root, then every `freeze_list_index` entry |
| `generateFreezeListNonInclusionProof(address, options?): Promise<NonInclusionWitness>` | Builds the tree and returns the two proofs for a private compliant transfer       |
| `buildMerkleTree(addresses): bigint[]`                                                 | Builds the full tree (leaves first, root last)                                    |
| `getMerkleRoot(addresses): bigint`                                                     | Computes the root                                                                 |
| `getConfig(): Required<PolicyEngineConfig>`                                            | Returns the resolved configuration, including defaults                            |

`generateFreezeListNonInclusionProof` options (`NonInclusionProofOptions`) require **either** `freezeList` (use a cached list, no network calls) **or** `programId` (fetch from chain). With neither it throws.

```typescript
const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
  programId: "sealance_freezelist_registry.aleo",
});
// { proofs: [MerkleProof, MerkleProof], root: 123456789n, freezeList: ["aleo1...", ...] }
```

## Utility Functions

### Address Conversion

```typescript
import { convertAddressToField, convertFieldToAddress, stringToBigInt } from "@sealance-io/policy-engine-aleo";

convertAddressToField("aleo1..."); // 123456789n
convertFieldToAddress("123456789field"); // "aleo1..."
stringToBigInt("MyToken"); // ASCII string to BigInt (token names, symbols)
```

### Merkle Tree Operations

Low-level steps behind `generateFreezeListNonInclusionProof`:

```typescript
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "@sealance-io/policy-engine-aleo";

const leaves = generateLeaves(["aleo1...", "aleo1..."], 15); // sorted, zero-padded; throws if over 2^(depth-1) addresses
const tree = buildTree(leaves);
const [leftIdx, rightIdx] = getLeafIndices(tree, "aleo1..."); // leaves surrounding the address
const proof = getSiblingPath(tree, leftIdx, 15); // { siblings: [leaf, ...15 siblings], leaf_index }
```

### Transaction Tracking

`trackTransactionStatus(txId, endpoint, options?): Promise<TransactionStatus>` polls until the transaction is confirmed or tracking times out.

```typescript
import { trackTransactionStatus } from "@sealance-io/policy-engine-aleo";

const status = await trackTransactionStatus(txId, "https://api.explorer.provable.com/v1/testnet", {
  timeout: 600000, // 10 minutes
});

if (status.status === "accepted") {
  console.log(`Transaction confirmed in block ${status.blockHeight}`);
} else if (status.status === "rejected") {
  console.error(`Transaction failed: ${status.error}`);
}
```

`TransactionTrackingOptions` (all optional):

| Option         | Default         | Description                    |
| -------------- | --------------- | ------------------------------ |
| `maxAttempts`  | `60`            | Max polling attempts           |
| `pollInterval` | `5000`          | Delay between polls (ms)       |
| `timeout`      | `300000`        | Overall timeout (ms)           |
| `fetchTimeout` | `30000`         | Per-request timeout (ms)       |
| `network`      | —               | Network name, used for logging |
| `logger`       | `defaultLogger` | See [Logger](#logger)          |

### Other Exports

`AleoAPIClient` (HTTP client with retries and rate-limit handling) and the fetch helpers `calculateBackoff`, `parseRetryAfter` and `sleep` are also exported. See their TSDoc.

## Types

```typescript
interface MerkleProof {
  siblings: bigint[];
  leaf_index: number;
}

interface NonInclusionWitness {
  proofs: [MerkleProof, MerkleProof];
  root: bigint;
  freezeList: string[];
}

interface FreezeListResult {
  addresses: string[];
  lastIndex: number; // last populated index in the on-chain list
  currentRoot: bigint;
}

interface TransactionStatus {
  status: "accepted" | "rejected" | "aborted" | "pending"; // TransactionStatusType
  type: "execute" | "deploy" | "fee"; // TransactionType
  confirmedId: string;
  unconfirmedId?: string; // typically set when rejected
  blockHeight?: number;
  error?: string;
}
```

Status meanings:

- `accepted`: executed and included in a block
- `rejected`: execution failed but the fee was consumed (`type` is `"fee"`)
- `aborted`: both execution and fee processing failed
- `pending`: waiting to be included in a block

### Logger

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";
type Logger = (level: LogLevel, message: string, context?: Record<string, unknown>) => void;
```

`defaultLogger` logs to the console; `silentLogger` discards everything. Both `PolicyEngineConfig` and `TransactionTrackingOptions` accept a `logger`.

```typescript
import { PolicyEngine, silentLogger } from "@sealance-io/policy-engine-aleo";

const quiet = new PolicyEngine({ logger: silentLogger });
const custom = new PolicyEngine({
  logger: (level, message, context) => myAppLogger.log({ level, message, ...context }),
});
```

## Constants

| Constant       | Value                                                               |
| -------------- | ------------------------------------------------------------------- |
| `ZERO_ADDRESS` | `"aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc"` |

`ZERO_ADDRESS` is field element `0`, used as Merkle tree padding and filtered out of freeze lists.

## Errors

The SDK throws plain `Error`s.

### PolicyEngine and AleoAPIClient

Mapping reads treat HTTP 404 as "no value" rather than an error; `PolicyEngine` then reports it as a missing mapping.

| Message (prefix)                                             | Cause                                                                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `Either freezeList or programId must be provided in options` | `generateFreezeListNonInclusionProof` called without either                                                      |
| `Failed to fetch freeze_list_root for program ...`           | Mapping missing (404) or empty: wrong program ID or registry not initialized (same for `freeze_list_last_index`) |
| `Failed to fetch after N attempts: ...`                      | Network error, 5xx or 429 persisted through all retries                                                          |
| `HTTP 4xx: ...`                                              | Client error other than 404 and 429, not retried                                                                 |
| `Leaves limit exceeded. Max: ..., provided: ...`             | Freeze list larger than the tree capacity                                                                        |

```typescript
try {
  const witness = await engine.generateFreezeListNonInclusionProof(address, { programId });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Leaves limit exceeded")) {
    // freeze list exceeds tree capacity
  }
}
```

### trackTransactionStatus

A 404 means "not yet confirmed" and polling continues. Other HTTP and network errors are also caught and polling continues until `maxAttempts` or `timeout` is reached. It then throws one of:

| Message (prefix)                                              | Cause                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Transaction polling timeout after ...`                       | `timeout` elapsed                                                   |
| `Failed after N attempts. Last error: ...`                    | The final attempt errored (e.g. `HTTP 401: Unauthorized`)           |
| `Transaction status could not be determined after N attempts` | `maxAttempts` reached without confirmation; it may still be pending |
