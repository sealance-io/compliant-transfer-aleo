# Architecture

System design and component structure for compliant token transfers on Aleo.

## Leo Programs

Programs are organized in `/programs` subdirectories:

### Core (`core/`)

- **`merkle_tree.leo`**: Verifies Merkle proofs (inclusion and non-inclusion). Imported by freeze list registry and compliance programs.

### Freeze List Registry (`freezelist_registry/`)

- **`sealance_freezelist_registry.leo`**: Standalone registry with Merkle tree verification. Role-based access control (`MANAGER_ROLE`, `FREEZELIST_MANAGER_ROLE`). Maintains current and previous roots with configurable block height windows.
- **`multisig_freezelist_registry.leo`**: Multi-signature variant.

### Compliance Policies (`policy/`)

- **`sealed_report_policy.leo`**: Grants issuers access to transaction details. Enforces sanctions compliance.
- **`sealed_threshold_report_policy.leo`**: Reports transactions when daily spend exceeds 1000.
- **`sealed_timelock_policy.leo`**: Allows senders to lock funds for a specified period.

### Token Implementations (`token/`)

- **`sealed_report_token.leo`**: Self-contained token managing its own supply without `token_registry.aleo`.
- **`compliant_token_template.leo`**: Template for new compliant tokens.
- **`multisig_compliant_token.leo`**: Multi-signature implementation.

### Proxy Contracts (`proxy/`)

- **`multisig_token_proxy.leo`**: Multi-sig proxy for token operations.
- **`multisig_freezelist_proxy.leo`**: Multi-sig proxy for freeze list operations.

### Vendor (`vendor/`)

- **`token_registry.leo`**: Shared token registry.
- **`multisig_core.leo`**: Core multi-signature functionality.

### Demo (`demo/`)

- **`gqrfmwbtyp.leo`**: Exchange native Aleo tokens for compliant tokens.

## Compliance Architecture

Programs use **Merkle tree non-inclusion proofs** to privately verify addresses are NOT on the freeze list:

1. Freeze list stored on-chain in `sealance_freezelist_registry.aleo`
2. SDK fetches list, builds Merkle tree off-chain, generates non-inclusion proofs
3. Proofs submitted with transactions for private compliance verification

**Merkle Tree**: Max depth 15, leaves sorted and padded to power of 2, non-inclusion uses two adjacent leaf proofs.

**Role-Based Access Control**: Mapping-based roles with bitmasking (`MANAGER_ROLE = 8u16`, `FREEZELIST_MANAGER_ROLE = 16u16`). Stored in `mapping address_to_role: address => u16`.

## Policy Engine SDK

Located in `/packages/policy-engine-sdk`:

| Module             | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `policy-engine.ts` | Main `PolicyEngine` class - fetches freeze lists, generates proofs |
| `api-client.ts`    | Blockchain API client with retry logic, concurrency control        |
| `merkle-tree.ts`   | `buildTree()`, `getSiblingPath()`, `getLeafIndices()`              |
| `conversion.ts`    | Address/field conversion utilities                                 |

## Testing Infrastructure

Tests use **LionDen** to compile programs and manage a local `leo devnode` process:

| File                | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `lionden.config.ts` | Networks, named accounts, plugins, codegen config |
| `/test/*.test.ts`   | Sequential Vitest integration tests               |
| `/lib/*.ts`         | Shared test and deployment helpers                |

**Test Accounts**: deployer, admin, investigator, frozen_address, sender, recipient, minter, burner, supply_manager, spender, freeze_list_manager, pauser

## Compilation Artifacts

Compiled programs output to `/artifacts`:

- ABI and key artifact metadata
- Type definitions
- TypeScript bindings in `/typechain`

## LionDen Framework

Uses npm-published `@lionden/*` packages for compiling Leo, generating TypeScript bindings, managing devnode tests, and running deployment recipes. Configuration lives in `lionden.config.ts`.

**Key APIs**: `LionDenRuntimeEnvironment`, generated `/typechain` contracts, `@lionden/testing` `TestContext`
