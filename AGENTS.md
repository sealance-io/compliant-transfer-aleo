# sealance-io/compliant-transfer-aleo AI Agent Guide

This document provides comprehensive information for AI agents working with code in this repository.

## Repository Overview

This is a monorepo for implementing compliant token transfers on the Aleo blockchain. It contains Leo programs (smart contracts) and a TypeScript SDK for generating Merkle proofs and interacting with compliance policies.

**Core Components:**

- **Leo Programs** (`/programs`): Smart contracts implementing various compliance policies
- **Policy Engine SDK** (`/packages/policy-engine-sdk`): TypeScript SDK published as `@sealance-io/policy-engine-aleo`
- **Test Suite** (`/test`): Comprehensive tests using Testcontainers + leo devnet
- **Scripts** (`/scripts`): Deployment and configuration utilities
- **Shared Libraries** (`/lib`): Helper utilities for freeze lists, tokens, deployment, roles, and funding

## Development Commands

### Dependencies & Setup

```bash
# ALWAYS install from repository root (uses npm workspaces)
npm ci

# Install doko-js CLI (required for compiling Leo programs)
# See docs/doko-installation-guide.md
```

**Critical**: This repository uses npm workspaces with a single root `package-lock.json`. Never run `npm install` in workspace directories (`packages/*/`). Always install from the root.

**Security Note**: See `docs/NPM-SECURITY.md` for the npm security model. CI workflows use `--ignore-scripts` with controlled execution; local development allows scripts after lockfile validation. Registry locking is enforced via `lockfile-lint` validation.

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

The project supports two testing modes:

| Mode        | Command                | Speed | Use Case                      |
| ----------- | ---------------------- | ----- | ----------------------------- |
| **Devnode** | `npm test`             | Fast  | Local development (default)   |
| **Devnet**  | `DEVNET=true npm test` | Slow  | Pre-deployment validation, CI |

```bash
# Run all tests (fast devnode mode - default)
npm test

# Run specific test file
npm run test:select ./test/merkle_tree.test.ts

# Run with full devnet (slower but realistic)
DEVNET=true npm test

# Run tests without Testcontainers (requires manual devnet setup)
USE_TEST_CONTAINERS=0 npm test

# Verbose logging (0-4)
ALEO_VERBOSITY=4 npm test

# Use custom Docker image
ALEO_TEST_IMAGE=custom/aleo:latest npm test
```

**Important**: Tests are computationally intensive. Devnode mode skips ZK proofs for speed; devnet mode generates real proofs and takes much longer.

> **Devnode is Experimental**: The devnode feature requires Leo built from `feat/leo-devnode-final` branch or the pre-built image `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`. For stable testing, use `DEVNET=true`.

### SDK Development

```bash
# Run SDK tests only
npm run test --workspace=@sealance-io/policy-engine-aleo

# Watch mode for SDK tests
npm run test:watch --workspace=@sealance-io/policy-engine-aleo

# Format SDK code
npm run format:fix --workspace=@sealance-io/policy-engine-aleo
```

### SDK Releasing

Uses [Changesets](https://github.com/changesets/changesets) for version management. See `docs/RELEASING.md` for complete documentation.

```bash
npx changeset              # Add changeset when making SDK changes
npm run version            # Preview version bumps (dry-run)
```

### Deployment

```bash
# Deploy to devnet
npm run deploy:devnet

# Deploy to testnet
npm run deploy:testnet

# Update freeze list on devnet
npm run update-freeze-list:devnet

# Update freeze list on testnet
npm run update-freeze-list:testnet
```

### Code Formatting

```bash
# Check formatting
npm run format

# Auto-fix formatting
npm run format:fix

# Check for GPL/AGPL licenses (blocked)
npm run lint:licenses
```

## Architecture & Key Concepts

### Leo Programs

Programs are organized in `/programs` subdirectories by function:

**`core/`** - Foundation programs
- **`merkle_tree.leo`**: Core program for verifying Merkle proofs (inclusion and non-inclusion). Imported by freeze list registry and compliance programs.

**`freezelist_registry/`** - Freeze list management
- **`sealance_freezelist_registry.leo`**: Standalone freeze list registry with Merkle tree verification. Uses role-based access control with `MANAGER_ROLE` and `FREEZELIST_MANAGER_ROLE`. Maintains current and previous Merkle roots with configurable block height windows for smooth transitions.
- **`multisig_freezelist_registry.leo`**: Multi-signature variant of the freeze list registry.

**`policy/`** - Compliance policies
- **`sealed_report_policy.leo`**: Token policy that grants issuers access to transaction details. Enforces sanctions list compliance for both sender and recipient.
- **`sealed_threshold_report_policy.leo`**: Reports transactions only when daily spend exceeds 1000. Enforces sanctions compliance.
- **`sealed_timelock_policy.leo`**: Allows senders to lock funds for a specified period. Enforces sanctions compliance.

**`token/`** - Token implementations
- **`sealed_report_token.leo`**: Self-contained token that manages its own supply and balances without relying on `token_registry.aleo`. Includes transaction reporting to issuers.
- **`compliant_token_template.leo`**: Template for creating new compliant tokens.
- **`multisig_compliant_token.leo`**: Multi-signature compliant token implementation.

**`proxy/`** - Proxy contracts
- **`multisig_token_proxy.leo`**: Multi-signature proxy for token operations.
- **`multisig_freezelist_proxy.leo`**: Multi-signature proxy for freeze list operations.

**`vendor/`** - External/shared programs
- **`token_registry.leo`**: Shared token registry used by some policies.
- **`multisig_core.leo`**: Core multi-signature functionality.

**`demo/`** - Demo/example programs
- **`gqrfmwbtyp.leo`**: Enables exchange of native Aleo tokens for compliant tokens.

**Program Dependencies:**

```
token_registry.aleo (base token implementation)
    ↑
merkle_tree.aleo (privacy-preserving proofs)
    ↑
sealance_freezelist_registry.aleo (sanctions management)
    ↑
sealed_*_policy.aleo programs (compliance policies)
    ↑
gqrfmwbtyp.aleo (token exchange)
```

### Compliance Architecture

**Key Pattern**: Programs use **Merkle tree non-inclusion proofs** to privately verify addresses are NOT on the freeze list:
1. Freeze list stored on-chain in `sealance_freezelist_registry.aleo`
2. SDK fetches list, builds Merkle tree off-chain, generates non-inclusion proofs
3. Proofs submitted with transactions for private compliance verification

**Merkle Tree:** Max depth 15 (configurable), leaves sorted and padded to power of 2, non-inclusion uses two adjacent leaf proofs.

**Role-Based Access Control:** Mapping-based roles with bitmasking (`MANAGER_ROLE = 8u16`, `FREEZELIST_MANAGER_ROLE = 16u16`). Stored in `mapping address_to_role: address => u16`.

### Policy Engine SDK

Located in `/packages/policy-engine-sdk`. Key modules:
- **`policy-engine.ts`**: Main `PolicyEngine` class - fetches freeze lists, generates non-inclusion proofs
- **`api-client.ts`**: Blockchain API client with retry logic and concurrency control
- **`merkle-tree.ts`**: `buildTree()`, `getSiblingPath()`, `getLeafIndices()` for Merkle operations
- **`conversion.ts`**: `convertAddressToField()`, `convertFieldToAddress()`, `stringToBigInt()`

### Testing Infrastructure

Tests use **Testcontainers** to spin up a containerized Aleo environment. Configuration:
- `vitest.global-setup.ts`: Starts container, waits for consensus, exposes port 3030
- `vitest.config.ts`: Sequential execution, long timeouts (3000s), alphabetical ordering
- `aleo-config.js`: Test accounts (deployer, admin, investigator, etc.) and network config

**Key environment variables:** `DEVNET` (enable full devnet), `USE_TEST_CONTAINERS` (default true), `SKIP_EXECUTE_PROOF` (skip ZK proofs in devnode), `ALEO_VERBOSITY` (0-4), `CONSENSUS_CHECK_TIMEOUT` (ms).

**Default images:** Devnode: `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`, Devnet: `ghcr.io/sealance-io/aleo-devnet:v3.4.0-v4.4.0`

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

### Contract Interaction Pattern

All TypeScript contract interactions follow this pattern:

```typescript
// 1. Create contract instance with execution mode and private key
const contract = new ContractNameContract({
  mode: ExecutionMode.SnarkExecute, // or SnarkProve, Evaluate
  privateKey: deployerPrivKey,
});

// 2. Check deployment status
const isDeployed = await contract.isDeployed();

// 3. Execute transitions (returns TransactionResponse)
const tx = await contract.transition_name(params);
await tx.wait(); // Wait for confirmation

// 4. Decrypt private outputs
const decryptedRecord = decryptRecordType(ciphertext, viewKey);
```

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

Tests follow: Fund accounts (`lib/Fund.ts`) → Deploy (`deployIfNotDeployed()`) → Initialize (roles, freeze list) → Execute → Verify with decrypt utilities.

### Adding Dependencies

```bash
npm install <package>                                          # Root workspace
npm install --workspace=@sealance-io/policy-engine-aleo <pkg>  # SDK workspace
```

## Important Constraints

1. **Node Version**: Requires Node >= 20.0.0 (see `.nvmrc` for v24)
2. **Leo Version**: Developed with Leo CLI v3.4.0
3. **Testing**: Tests are computationally intensive; CI runs are manual-only. Use devnode mode for fast local development; devnet mode for CI.
4. **Container Runtime**: Supports Docker and Podman (see testcontainers docs)
5. **Sequential Testing**: Tests MUST run sequentially (no parallelism) due to shared devnet state
6. **Workspace Rules**: Never install packages in workspace subdirectories; always use root
7. **Security**: See `docs/NPM-SECURITY.md` for npm security practices and `.github/dependabot.yml` for dependency update policies

## Dokojs Framework

Uses custom fork (`@doko-js/core`, `@doko-js/utils`, `@doko-js/wasm`) for compiling Leo programs and generating JS bindings. Includes patches via `patch-package` in `/patches`. **CRITICAL**: `@doko-js/*` updates blocked in dependabot - verify against patches before updating.

**Key classes:** `ExecutionMode.SnarkExecute`, `BaseContract` (in `/contract`), `AleoNetworkClient`

## Key Libraries (`/lib`)

- **`FreezeList.ts`**: Merkle tree operations (`getLeafIndices()`, `getSiblingPath()`)
- **`Deploy.ts`**: `deployIfNotDeployed()` utility
- **`Fund.ts`**: Credit funding for test accounts
- **`Token.ts`**, **`Role.ts`**, **`Block.ts`**: Token, role, and block utilities
- **`Constants.ts`**: MAX_TREE_DEPTH, ZERO_ADDRESS, etc.

## File Locations

| Path | Contents |
|------|----------|
| `/programs/**/*.leo` | Leo programs (subdirs: `core/`, `freezelist_registry/`, `policy/`, `token/`, `proxy/`, `vendor/`, `demo/`) |
| `/packages/policy-engine-sdk/src/` | SDK source |
| `/test/*.test.ts` | Tests |
| `/lib/` | Shared libraries |
| `/artifacts/` | Compiled output |
| `/scripts/` | Deployment scripts |
| `/docs/` | `NPM-SECURITY.md`, `RELEASING.md`, `testing-configuration-guide.md` |

## Dependency Management & Security

- **Dependabot**: Configured in `.github/dependabot.yml`. Major updates blocked; `@doko-js/*` blocked (custom patches in `/patches`).
- **Security model**: See `docs/NPM-SECURITY.md`. CI uses `npm ci --ignore-scripts` with controlled execution; lockfile-lint validates registry sources.
- **Workflow security**: GitHub Actions pinned to commit SHAs; `zizmor` audits workflows weekly.

## CI/CD and Branch Protection

**Required status checks** for branch protection (use rollup job names, not individual test names):
- `CI Status` (on-pull-request-main.yml)
- `SDK Status` (on-pull-request-main-sdk.yml)
- `Nightly Status`, `Security Audit Status`, `Release Status`

**Workflow pattern**: `detect-changes → linter → test(s) → *-status (rollup)`. Workflows use job-level `if:` conditions instead of workflow-level `paths-ignore` to avoid "Pending" status blocking PRs.

## Audits

- [Sealance Compliance Technology for Aleo](./audits/veridise_09:2025.pdf) by [Veridise](https://veridise.com/) conducted in 09/2025.

## Common Issues

- **Container auth**: Run `docker login ghcr.io` for ghcr.io images
- **Tests too slow**: Use devnode mode (default) with `SKIP_EXECUTE_PROOF=true`; increase `CONSENSUS_CHECK_TIMEOUT` for CI
- **Port 3030 in use**: `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)`
- **Manual devnet**: See `docs/testing-configuration-guide.md`
