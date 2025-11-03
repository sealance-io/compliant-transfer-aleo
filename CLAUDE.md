# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo for implementing compliant token transfers on the Aleo blockchain. It contains Leo programs (smart contracts) and a TypeScript SDK for generating Merkle proofs and interacting with compliance policies.

**Core Components:**

- **Leo Programs** (`/programs`): Smart contracts implementing various compliance policies
- **Policy Engine SDK** (`/packages/policy-engine-sdk`): TypeScript SDK published as `@sealance-io/policy-engine-aleo`
- **Test Suite** (`/test`): Comprehensive tests using Testcontainers + leo devnet
- **Scripts** (`/scripts`): Deployment and configuration utilities

## Development Commands

### Dependencies & Setup

```bash
# ALWAYS install from repository root (uses npm workspaces)
npm ci

# Install doko-js CLI (required for compiling Leo programs)
# See docs/doko-installation-guide.md
```

### Building

```bash
# Compile all Leo programs (output to /artifacts)
dokojs compile
# or
npm run compile

# Build SDK only
npm run build --workspace=@sealance-io/policy-engine-aleo
```

### Testing

```bash
# Run all tests (uses Testcontainers with leo devnet)
npm test

# Run specific test file
npm run test:select ./test/merkle_tree.test.ts

# Run tests without Testcontainers (requires manual devnet setup)
USE_TEST_CONTAINERS=0 npm test

# Customize devnet verbosity (0-4, default 1)
DEVNET_VERBOSITY=4 npm test

# Use custom devnet image
ALEO_DEVNET_IMAGE=custom/aleo-devnet:latest npm test
```

### SDK Development

```bash
# Run SDK tests only
npm run test --workspace=@sealance-io/policy-engine-aleo

# Watch mode for SDK tests
npm run test:watch --workspace=@sealance-io/policy-engine-aleo

# Format SDK code
npm run format:fix --workspace=@sealance-io/policy-engine-aleo
```

### Deployment

```bash
# Deploy to devnet
npm run deploy:devnet

# Deploy to testnet
npm run deploy:testnet

# Update freeze list on devnet
npm run update-freeze-list:devnet
```

### Code Formatting

```bash
# Check formatting
npm run format

# Auto-fix formatting
npm run format:fix
```

## Architecture & Key Concepts

### Workspace Structure

This repository uses **npm workspaces** with a single root `package-lock.json`. Never run `npm install` in workspace directories (`packages/*/`). Always install from the root.

### Leo Programs

All programs are in `/programs` as single-file `.leo` contracts:

- **`sealance_freezelist_registry.leo`**: Standalone freeze list registry with Merkle tree verification. This is the reference implementation for freeze list management.

- **`sealed_report_policy.leo`**: Token policy that grants issuers access to transaction details. Enforces sanctions list compliance for both sender and recipient.

- **`sealed_report_token.leo`**: Self-contained token (manages own supply/balances without `token_registry.aleo`). Includes transaction reporting to issuers.

- **`sealed_threshold_report_policy.leo`**: Reports transactions only when daily spend exceeds 1000. Enforces sanctions compliance.

- **`sealed_timelock_policy.leo`**: Allows senders to lock funds for a specified period. Enforces sanctions compliance.

- **`merkle_tree.leo`**: Core program for verifying Merkle proofs (inclusion and non-inclusion).

- **`gqrfmwbtyp.leo`**: Enables exchange of native Aleo tokens for compliant tokens.

- **`token_registry.leo`**: Shared token registry (in `/imports`) used by some policies.

- **`compliant_token_template.leo`**: Template for creating new compliant tokens.

### Compliance Architecture

**Key Pattern**: Programs use **Merkle tree non-inclusion proofs** to privately verify that addresses are NOT on the freeze list.

1. Freeze list is stored on-chain in the `sealance_freezelist_registry.aleo` program
2. SDK fetches freeze list and builds Merkle tree off-chain
3. SDK generates non-inclusion proofs for sender/recipient
4. Proofs are submitted with transactions to verify compliance privately

**Merkle Tree Details:**

- Default max depth: 15 (configurable)
- Leaves are sorted and padded to power of 2
- Root is stored on-chain for verification
- Non-inclusion uses two adjacent leaf proofs

### Policy Engine SDK

Located in `/packages/policy-engine-sdk`. Key modules:

- **`policy-engine.ts`**: Main SDK class (`PolicyEngine`)

  - Fetches freeze lists from blockchain
  - Generates non-inclusion proofs
  - Builds and manages Merkle trees

- **`api-client.ts`**: Blockchain API client with retry logic and concurrency control

  - Fetches mappings from Aleo nodes
  - Handles rate limiting and retries

- **`merkle-tree.ts`**: Merkle tree operations

  - `buildTree()`: Construct full tree from leaves
  - `getSiblingPath()`: Generate proofs
  - `getLeafIndices()`: Find adjacent leaves for non-inclusion

- **`conversion.ts`**: Address/field conversions
  - `convertAddressToField()`: Aleo address → field element
  - `convertFieldToAddress()`: field element → Aleo address
  - `stringToBigInt()`: ASCII string → BigInt (for token names/symbols)

### Testing Infrastructure

Tests use **Testcontainers** to automatically spin up a containerized leo devnet:

- **Global Setup** (`vitest.global-setup.ts`):

  - Starts leo devnet container before all tests
  - Waits for consensus version >= 10
  - Exposes devnet on port 3030
  - Tears down container after tests

- **Test Configuration** (`vitest.config.ts`):

  - Sequential execution (no parallelism)
  - Single thread, single fork
  - Long timeouts (3000s) for blockchain operations

- **Network Configuration** (`aleo-config.js`):
  - Defines accounts for testing (deployer, admin, investigator, frozen addresses, etc.)
  - Endpoint defaults to `http://localhost:3030` for devnet
  - Priority fees configured per network

**Environment Variables for Testing:**

- `USE_TEST_CONTAINERS`: Set to `0` to disable Testcontainers (requires manual devnet)
- `DEVNET_VERBOSITY`: Verbosity level (0-4, default 1)
- `ALEO_DEVNET_IMAGE`: Custom devnet image (default: `ghcr.io/sealance-io/aleo-devnet:v3.3.1-v4.3.0`)
- `MIN_CONSENSUS_VERSION`: Minimum consensus version to wait for (default: 10)
- `CONSENSUS_CHECK_TIMEOUT`: Timeout for consensus check (default: 180000ms)

### Deployment & Configuration

- **`.env.example`**: Shows required environment variables (12+ private keys for different roles)
- **Accounts/Roles**: deployer, admin, investigator, frozen_address, sender, recipient, minter, burner, supply_manager, spender, freeze_list_manager, pauser
- **Scripts**: Deployment scripts in `/scripts` use dokojs for contract deployment

### Compilation Artifacts

Compiled programs output to `/artifacts`:

- JS bindings for contract interaction
- Type definitions
- Leo2JS conversion utilities (encrypt/decrypt records)

## Common Patterns

### Working with Freeze Lists

```typescript
// SDK pattern for generating non-inclusion proofs
import { PolicyEngine } from "@sealance-io/policy-engine-aleo";

const engine = new PolicyEngine({
  endpoint: "http://localhost:3030",
  network: "testnet",
});

// Fetch freeze list
const freezeList = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");

// Generate proof that address is NOT frozen
const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
  programId: "sealance_freezelist_registry.aleo",
});

// Use witness.proofs in Leo transaction
```

### Test Structure

Tests follow this pattern:

1. Fund accounts with credits
2. Deploy contracts if not deployed
3. Initialize programs (set roles, freeze list, etc.)
4. Execute contract functions
5. Verify outputs using decrypt utilities

### Adding Dependencies

```bash
# Add to root workspace
npm install <package>

# Add to SDK workspace
npm install --workspace=@sealance-io/policy-engine-aleo <package>
```

## Important Constraints

1. **Node Version**: Requires Node >= 20.0.0 (see `.nvmrc` for v24)
2. **Leo Version**: Developed with Leo CLI v3.3.1
3. **Testing**: Tests are computationally intensive; CI runs are manual-only
4. **Container Runtime**: Supports Docker and Podman (see testcontainers docs)
5. **Sequential Testing**: Tests MUST run sequentially (no parallelism) due to shared devnet state
6. **Workspace Rules**: Never install packages in workspace subdirectories; always use root

## Dokojs Framework

This project uses a custom fork of Dokojs (`@doko-js/core`, `@doko-js/utils`, `@doko-js/wasm`) for:

- Compiling Leo programs
- Generating JS bindings
- Executing contracts in tests

**Key Classes:**

- `ExecutionMode.SnarkExecute`: Mode for contract execution
- `BaseContract`: Base class for contract interactions
- `AleoNetworkClient`: Client for Aleo network operations

## File Locations Reference

- Leo programs: `/programs/*.leo`
- SDK source: `/packages/policy-engine-sdk/src/`
- Tests: `/test/*.test.ts`
- Test utilities: `/test/utils/`
- Shared libraries: `/lib/`
- Deployment scripts: `/scripts/`
- Compiled artifacts: `/artifacts/`
- Configuration: `aleo-config.js`, `.env`, `vitest.config.ts`
