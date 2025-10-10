# Policy Engine SDK Examples

This directory contains example scripts demonstrating various use cases of the `@sealance-io/policy-engine-aleo` SDK.

## Prerequisites

Before running the examples, ensure you have:

1. **Node.js 20+** installed
2. **Dependencies installed**:
   ```bash
   npm install
   ```
3. **Aleo node running** (for transaction examples):
   - Local devnet: `http://localhost:3030`
   - Or use a public testnet endpoint

## Available Examples

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
- ✅ No blockchain interaction required
- ✅ Shows complete proof generation workflow
- ✅ Demonstrates utility functions

---

### 2. Cached Freeze List (`cached-freeze-list.ts`)

Shows best practices for generating multiple proofs efficiently:
- Fetch the freeze list once
- Reuse it for multiple witness generations
- Reduce API calls and improve performance

**Run:**
```bash
npm run cached
```

**Features:**
- ✅ Performance optimization example
- ✅ Multiple address verification
- ✅ Demonstrates caching strategy

---

### 3. Verify Non-Inclusion Transaction (`verify-non-inclusion-transaction.ts`) 🆕

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
- ✅ Full transaction workflow
- ✅ Uses `@provablehq/sdk` directly (no doko-js dependency)
- ✅ Lightweight TypeScript bindings for Aleo programs
- ✅ Demonstrates proof formatting for Leo structs
- ✅ Handles transaction submission and error reporting
- ✅ **Built-in transaction tracking** with exponential backoff
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
- Active Aleo network (local devnet or testnet)
- Private key with sufficient balance for transaction fees
- Program deployed on the network

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

## Environment Variables

### Required for Transaction Examples

- `PRIVATE_KEY`: Aleo private key (e.g., `APrivateKey1zkp...`)

  **Generate a new account:**
  ```bash
  npm install -g @provablehq/sdk
  node -e "import('@provablehq/sdk/dist/testnet/node.js').then(sdk => {
    const acc = new sdk.Account();
    console.log('Private Key:', acc.privateKey().to_string());
    console.log('Address:', acc.address().to_string());
  })"
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
- For local devnet, use the faucet or pre-funded accounts

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
# Install dependencies
npm install

# Run with tsx (TypeScript execution)
npx tsx basic-usage.ts

# Run with Node.js (after building)
node basic-usage.js
```

### Creating New Examples

1. Create a new `.ts` file in this directory
2. Import the SDK: `import { PolicyEngine } from "@sealance-io/policy-engine-aleo";`
3. Add a script entry in `package.json`
4. Update this README

## License

Apache-2.0
