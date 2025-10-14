# Policy Engine SDK Examples

This directory contains example scripts demonstrating various use cases of the `@sealance-io/policy-engine-aleo` SDK.

## Prerequisites

Before running the examples, ensure you have:

1. **Node.js 20+** installed

2. **SDK built and dependencies installed**:

   These examples use a local file dependency (`"file:.."`) that references the SDK source code directly. This means changes to the SDK are immediately reflected in the examples without republishing.

   **Option 1: Quick setup (from SDK directory)**
   ```bash
   # From packages/policy-engine-sdk/
   npm run build:examples
   ```
   This builds the SDK and installs example dependencies in one command.

   **Option 2: Manual setup**
   ```bash
   # Build the SDK first
   cd packages/policy-engine-sdk
   npm run build

   # Install example dependencies
   cd examples
   npm install
   ```

   **How the file dependency works:**
   - `package.json` contains: `"@sealance-io/policy-engine-aleo": "file:.."`
   - This creates a symlink to `../dist` (the built SDK)
   - When you run `npm install`, it automatically links the local SDK
   - No need to publish to npm for local development!

3. **Aleo network node running** (required for all examples):
   - Local devnet: `http://localhost:3030` (recommended for testing)
   - Public testnet: `https://api.explorer.provable.com/v1`
   - Public mainnet: `https://api.explorer.provable.com/v1`

   **All examples interact with an Aleo network** to fetch freeze list data from on-chain mappings.

4. **Compatible program deployed** on the target network:

   The SDK works with any Aleo program that implements the freeze list API:
   ```leo
   mapping freeze_list_index: u32 => address
   mapping freeze_list_last_index: bool => u32
   mapping freeze_list_root: u8 => field
   ```

   **Compatible programs:**
   - `sealance_freezelist_registry.aleo` (reference implementation, used in examples)
   - `sealed_report_policy.aleo`
   - `sealed_threshold_report_policy.aleo`
   - `sealed_timelock_policy.aleo`
   - Your own custom compliance program

   **To use a different program:** Update the `CONFIG.programId` constant at the top of each example file.

## Available Examples

| Example | Script | Queries Chain | Broadcasts Transaction | Description |
|---------|--------|---------------|------------------------|-------------|
| Basic Usage | `npm run basic` | ✅ Yes | ❌ No | Fetches freeze list and generates proofs |
| Cached Freeze List | `npm run cached` | ✅ Yes | ❌ No | Demonstrates root validation and caching |
| Verify Transaction | `npm run verify-tx` | ✅ Yes | ✅ Yes | Complete transaction submission workflow |

---

### 1. Basic Usage (`basic-usage.ts`)

Demonstrates the fundamental features of the SDK:
- Fetching freeze lists from the blockchain
- Generating non-inclusion proofs
- Converting addresses to field elements
- Building custom Merkle trees

**Run:**
```bash
npm run basic
```

**Features:**
- ✅ Queries blockchain for freeze list data
- ✅ Shows complete proof generation workflow
- ✅ Demonstrates utility functions
- ❌ Does not broadcast transactions (read-only)

---

### 2. Cached Freeze List (`cached-freeze-list.ts`)

Shows best practices for generating multiple proofs efficiently:
- Uses `fetchCurrentRoot()` to validate cache with lightweight API call
- Only re-fetches full freeze list when root changes
- Generates multiple proofs using cached data
- Demonstrates the recommended caching pattern

**Run:**
```bash
npm run cached
```

**Features:**
- ✅ Queries blockchain (fetchCurrentRoot + fetchFreezeListFromChain)
- ✅ Performance optimization with root validation
- ✅ Multiple address verification
- ✅ Demonstrates production-ready caching strategy
- ❌ Does not broadcast transactions (read-only)

---

### 3. Verify Non-Inclusion Transaction (`verify-non-inclusion-transaction.ts`)

**Complete end-to-end example** showing how to:
1. Generate a non-inclusion proof using the SDK
2. Create a transaction for `verify_non_inclusion_priv` using `@provablehq/sdk`
3. Broadcast the transaction to the Aleo network

**Run:**
```bash
# Set your private key
export PRIVATE_KEY="APrivateKey1zkp..."

# Run the example
npm run verify-tx
```

**Features:**
- ✅ Queries blockchain for freeze list data
- ✅ **Broadcasts transaction** to Aleo network
- ✅ Full end-to-end transaction workflow
- ✅ Uses `@provablehq/sdk` directly (no doko-js dependency)
- ✅ Demonstrates proof formatting for Leo structs
- ✅ Built-in transaction tracking with status polling
- ✅ Automatic confirmation detection (accepted/rejected/aborted/timeout)

**Configuration:**

You can modify the configuration in the script:

```typescript
const CONFIG = {
  endpoint: "http://localhost:3030",
  network: "testnet",
  programId: "sealance_freezelist_registry.aleo",
  privateKey: process.env.PRIVATE_KEY,
  addressToVerify: "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
  priorityFee: 0,

  // Transaction tracking configuration
  trackTransaction: true,        // Set to false to skip waiting for confirmation
  trackingTimeout: 300000,       // 5 minutes (in milliseconds)
};
```

**Requirements:**
- ✅ Active Aleo network (local devnet, testnet, or mainnet)
- ✅ Private key with sufficient balance for transaction fees
- ✅ `sealance_freezelist_registry.aleo` program deployed on the network
- ✅ Network endpoint accessible (e.g., `http://localhost:3030`)

**Output Example:**
```
================================================================================
Verify Non-Inclusion Transaction Example
================================================================================

[1/5] Initializing Policy Engine SDK...
[1/5] ✅ SDK initialized
      Endpoint: http://localhost:3030
      Network: testnet

[2/5] Fetching freeze list from chain...
      Program: sealance_freezelist_registry.aleo
[2/5] ✅ Freeze list fetched
      Total addresses: 3
      Last index: 2
      Current root: 12345...

[2/5] Generating non-inclusion proof...
      Address to verify: aleo1rhgdu...
[2/5] ✅ Non-inclusion proof generated
      Root: 12345...
      Proof 1: leaf_index=0, siblings=16
      Proof 2: leaf_index=1, siblings=16

[3/5] Setting up Aleo account and ProgramManager...
[3/5] ✅ Account loaded
      Address: aleo1abc...

[4/5] Building verify_non_inclusion_priv transaction...
[4/5] ✅ Transaction broadcast
      Transaction ID: at1xyz...

[5/5] Tracking transaction confirmation...
      Waiting for transaction to be included in a block...
      (This may take several minutes)
Transaction at1xyz... pending in mempool...

[5/5] ✅ Transaction tracking complete!

Final Status:
      Status: ACCEPTED
      Transaction ID: at1xyz...
      Block Height: 12345
      Type: execute

      Explorer: https://explorer.aleo.org/transaction/at1xyz...
```

---

### Utility Modules

#### `aleo-transaction-tracker.ts`

This is a **utility module** (not a standalone example) that provides transaction tracking functionality. It's used by the `verify-non-inclusion-transaction.ts` example.

**Features:**
- Polls the Aleo API to track transaction status
- Distinguishes between accepted, rejected, and aborted transactions
- Retrieves block height for confirmed transactions
- Configurable timeout, retry attempts, and polling interval
- Handles edge cases (fee-only transactions, API errors, etc.)

**Usage:**
```typescript
import { trackTransactionStatus } from "./aleo-transaction-tracker.js";

const status = await trackTransactionStatus(txId, endpoint, {
  maxAttempts: 60,
  pollInterval: 5000,
  timeout: 300000,
  network: "testnet",
});

console.log(status.status); // 'accepted' | 'rejected' | 'aborted' | 'pending'
```

This utility is reusable for any Aleo transaction tracking needs in your applications.

---

## Environment Variables

### Required for Transaction Examples

- `PRIVATE_KEY`: Aleo private key (e.g., `APrivateKey1zkp...`)

  **Generate a new account:**
  ```bash
  # Using Leo CLI (recommended)
  leo account new

  # Or using snarkOS CLI
  snarkos account new
  ```

### Optional

- `ALEO_ENDPOINT`: Override default endpoint (default: `http://localhost:3030`)
- `ALEO_NETWORK`: Network name (default: `testnet`)

## Troubleshooting

### Common Issues

**"Cannot find module '@provablehq/sdk'"**
- Run `npm install` in the examples directory

**"Account has insufficient balance"**
- Ensure your account has Aleo credits for transaction fees
- For local devnet use pre-funded accounts

**"Program not found"**
- Ensure the program is deployed on the network
- Check the `programId` in the configuration matches the deployed program

**"Root mismatch error"**
- The on-chain freeze list may have been updated
- Re-fetch the freeze list before generating proofs

### Getting Help

- **SDK Documentation**: [packages/policy-engine-sdk/README.md](../README.md)
- **Aleo Documentation**: https://developer.aleo.org/
- **Report Issues**: https://github.com/sealance-io/compliant-transfer-aleo/issues

## Development

### Running Examples in Development

```bash
# Run with tsx (TypeScript execution - recommended)
npx tsx basic-usage.ts

# Or use the npm scripts
npm run basic
npm run cached
npm run verify-tx
```

### Iterating on SDK Changes

Because examples use `"file:.."` dependency, you can iterate on SDK code and test changes immediately:

```bash
# 1. Make changes to SDK source code (../src/*)
# 2. Rebuild the SDK
cd ..
npm run build

# 3. Run examples - they'll use the updated SDK
cd examples
npm run basic
```

**Note:** If you add/remove exports from the SDK, you may need to reinstall:
```bash
cd examples
npm install  # Refreshes the symlink
```

### Creating New Examples

1. Create a new `.ts` file in this directory
2. Import the SDK:
   ```typescript
   import { PolicyEngine } from "@sealance-io/policy-engine-aleo";
   ```
3. Add a script entry in `package.json`:
   ```json
   "scripts": {
     "your-example": "tsx your-example.ts"
   }
   ```
4. Update this README with:
   - Example description
   - Features list
   - Run command
   - Any special requirements

### File Dependency vs Published Package

**During Development (current setup):**
- Uses `"file:.."` to reference local SDK
- Changes to SDK immediately available after rebuilding
- No need to publish or version bump

**In Production Applications:**
- Use published package: `"@sealance-io/policy-engine-aleo": "^0.1.0"`
- Install from GitHub Packages registry
- See main README for registry setup

## License

Apache-2.0
