# Architecture

System design and component structure for compliant token transfers on Aleo.

The standards-compatible path consists of `compliant_token_template.aleo` and
`sealance_freezelist_registry.aleo`; see [IARC22.md](./IARC22.md). The multisig variants
extend the project APIs and are not claimed as direct ARC-22 implementations.

## Leo Programs

Programs are organized in `/programs` subdirectories:

### Core (`core/`)

- **`merkle_tree.leo`**: Verifies Merkle proofs (inclusion and non-inclusion). Imported by freeze list registry and compliance programs.

### Freeze List Registry (`freezelist_registry/`)

- **`sealance_freezelist_registry.leo`**: Standalone registry with Merkle tree verification. Role-based access control (`MANAGER_ROLE`, `FREEZELIST_MANAGER_ROLE`). Preserves the SDK-facing freeze-list/root mappings and uses scalar storage for the update height, grace window, and initialization sentinel.
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

## Invariants

Cross-program rules that must survive edits. Program sources live at
`programs/<category>/<name>/main.leo`.

### Freeze lists

- **Two models**: `sealed_report_policy` and `sealed_report_token` keep their own freeze-list
  mappings and root. `sealed_timelock_policy`, `sealed_threshold_report_policy`, and
  `compliant_token_template` call `sealance_freezelist_registry`; `multisig_compliant_token`
  calls `multisig_freezelist_registry`.
- Keep the `freeze_list`, `freeze_list_index`, `freeze_list_last_index`, and `freeze_list_root`
  mappings and their key/value types: the SDK reads them directly.
- `ZERO_ADDRESS` marks empty index slots and must never be a real frozen entry. It is exported by
  the SDK and re-exported from `lib/Constants.ts`.
- `update_freeze_list` must require the caller to pass the current root, keep the previous root,
  extend `freeze_list_last_index` when freezing at `last_index + 1`, and set
  `freeze_list_root_updated_at`.
- `verify_non_inclusion_priv` accepts the previous root only within the grace window after the
  last update. `verify_non_inclusion_pub` reveals the account; the `_priv` variant passes only the
  Merkle root to the final block.

### Transfers and time

- `token_registry.aleo` flows call `prehook_*` before `transfer_*` in the entry fn, and run the
  prehook `Final` before the transfer `Final` in the final block.
- `sealed_threshold_report_policy` takes a public `estimated_block_height`; final blocks must
  assert it is no later than the current height and within the last `window` blocks.

### Multisig and upgrades

- Operation IDs are `BHP256::hash_to_field(op)`, or `BHP256::commit_to_field(op, salt)` to hide
  the payload. Signing ops expire at `expires_at_block`; `round` must increment when an
  operation changes so stale signatures cannot confirm it (`multisig_core`).
- `multisig_compliant_token` authorizes via `address_to_role` (direct) or `wallet_id_to_role`
  (multisig). With `compliant_token_template` + `multisig_token_proxy`, the proxy's program
  address must be granted roles on the token; direct access stays available by design.
- Upgradeable programs use `@custom constructor()` that skips checks at edition 0 and requires a
  completed multisig op for the program's own address afterwards. `merkle_tree` and
  `token_registry` are `@noupgrade`.

### Off-chain parity

The SDK and `lib/` must match on-chain encoding exactly: Poseidon4 for Merkle hashing, BHP256 for
operation IDs and composite keys, ASCII-packed `u128` strings (`conversion.ts`), and the same
`MAX_TREE_DEPTH` and role constants (`lib/Constants.ts`).

## Policy Engine SDK

Located in `/packages/policy-engine-sdk`:

| Module             | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `policy-engine.ts` | Main `PolicyEngine` class - fetches freeze lists, generates proofs |
| `api-client.ts`    | Blockchain API client with retry logic, concurrency control        |
| `merkle-tree.ts`   | `buildTree()`, `getSiblingPath()`, `getLeafIndices()`              |
| `conversion.ts`    | Address/field conversion utilities                                 |

The published SDK reconstructs private non-inclusion proofs by reading the registry's
`freeze_list_root`, `freeze_list_last_index`, `freeze_list_index`, and `freeze_list`
mappings directly. Those mapping names and key/value types are compatibility-sensitive.

## Testing Infrastructure

Tests use **LionDen** to compile programs and manage a local `leo devnode` process:

| File                | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `lionden.config.ts` | Networks, named accounts, plugins, codegen config |
| `/test/*.test.ts`   | Sequential Vitest integration tests               |
| `/lib/*.ts`         | Shared test and deployment helpers                |

**Test Accounts** (`namedAccounts` in `lionden.config.ts`, used via `ctx.named.signer("<name>")`): `deployer`, `admin`, `investigator`, `frozenAccount`, `account`, `recipient`, `minter`, `burner`, `supplyManager`, `spender`, `freezeListManager`, `pauser`

## Compilation Artifacts

Compiled programs output to `/artifacts`:

- ABI and key artifact metadata
- Type definitions
- TypeScript bindings in `/typechain`

## LionDen Framework

Uses npm-published `@lionden/*` packages for compiling Leo, generating TypeScript bindings, managing devnode tests, and running deployment recipes. Configuration lives in `lionden.config.ts`.

**Key APIs**: `LionDenRuntimeEnvironment`, generated `/typechain` contracts, `@lionden/testing` `TestContext`
