# Leo/Aleo Program Patterns

> **Scope**: Leo v3.4.0, programs in `/programs`
> **Status**: Normative
> **Last Verified**: 2026-01-26

Verified insights from program analysis for AI agents and developers. Protocol-level facts are distinguished from repository conventions.

## Glossary

| Term | Definition |
|------|------------|
| **transition** | Leo function that executes off-chain on the user's machine. Declared with `async transition`. Produces a ZKP and optionally a `Future`. |
| **finalize** | On-chain code block that executes after transition proof verification. Declared as a nested block within an async transition. MUST be used for all mapping writes. |
| **Future** | Handle returned by an async transition, representing deferred on-chain execution. Passed to `finalize` via `return`. |
| **record** | Private, encrypted data held by the owner. UTXO-like: consumed and produced by transitions. |
| **mapping** | Public on-chain key-value storage. Only writable in `finalize` blocks. |

## Execution Model

Aleo uses a hybrid execution model: off-chain (private) computation + on-chain (public) state commitment.

### Transition (Off-Chain)

Declared as `async transition`. Runs on user's local machine, not on the blockchain.

- Takes private and public inputs
- Can read from public on-chain state (mappings)
- Performs core logic and assertions
- Can create/consume `record` types (private assets)
- **MUST NOT** write to mappings directly

**Outputs:**
1. Zero-Knowledge Proof (ZKP) proving correct execution
2. `Future` object - a request to make public state changes

### Finalize (On-Chain)

Declared as `finalize` block within an async transition. Runs on Aleo blockchain, executed by validators.

- Triggered by the `Future` from a proven transition
- Receives data from the `Future` (not private inputs)
- Performs final public checks (authorization, state verification)
- **MUST be used for** all mapping writes - this is its critical function
- **CANNOT** access private inputs from the original transition

### Execution Lifecycle

```
1. User calls async transition (client/SDK)
2. Transition runs locally → generates ZKP + Future
3. Transaction submitted to Aleo node
4. Validators verify ZKP → execute finalize block → update mappings
```

### Data Primitives

| Type | Visibility | Storage | Behavior |
|------|------------|---------|----------|
| `record` | Private (encrypted) | Off-chain (user holds) | UTXO-like: consumed/produced by transitions |
| `mapping` | Public | On-chain | Key-value store; only `finalize` blocks can write |
| `struct` | N/A (transient) | None | Circuit data only; not persisted |

## Compliance Architecture

### Two Compliance Models

| Model | Programs | Freeze List Location | Verification |
|-------|----------|---------------------|--------------|
| Self-Contained | `sealed_report_policy.leo`, `sealed_report_token.leo` | Internal mappings | Direct mapping lookups |
| External Registry | `sealed_timelock_policy.leo`, `sealed_threshold_report_policy.leo` | `sealance_freezelist_registry.aleo` | Off-chain Merkle proofs via `verify_non_inclusion_pub()` |

### Freeze List Implementation

- Array-like mappings: `freeze_list: address => bool`, `freeze_list_index: u32 => address`
- **ZERO_ADDRESS** (`aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc`) serves as sentinel for empty slots
  - Canonical source: `packages/policy-engine-sdk/src/constants.ts` (exported as `ZERO_ADDRESS`)
  - Re-exported from `lib/Constants.ts` for test utilities
- ZERO_ADDRESS **MUST NOT** be used as a real frozen entry - it marks reusable indices
- SDK sentinel handling: `lib/FreezeList.ts` function `calculateFreezeListUpdate()` finds empty slots via `ZERO_ADDRESS`

### Block Height Window (Threshold Policy)

- User supplies `estimated_block_height: u32` parameter
- Finalize validates: `(block.height - window) <= estimated_block_height <= block.height`
- Trade-off: Usability over strict timekeeping; requires off-chain coordination
- Enforcement: `sealed_threshold_report_policy.leo` finalize blocks (e.g., `finalize_transfer_from_public`)

## Authorization & Async Patterns

### External Authorization Flow

**Applies to**: External registry compliance flows (`sealed_timelock_policy.leo`, `sealed_threshold_report_policy.leo`)

```
prehook_public() → transfer_from_public() → finalize: await both futures
```

- Prehook establishes authorization (e.g., `sealance_freezelist_registry.aleo/prehook_public`)
- Transfer executes the operation
- Finalize awaits futures in order to enforce correctness
- This call order is **MANDATORY** for authorization guarantees
- **Enforcement**: Future await ordering in each policy's finalize blocks (e.g., `finalize_transfer_from_public`)

### Multisig Architecture

- Operation registration: Hash operation with `BHP256::hash_to_field(multisig_op)`
- Private ops: Use `BHP256::commit_to_field(multisig_op, salt)` to hide payload
- Expiration: `WalletSigningOp.expires_at_block: u32`
- Rounds: Increment on operation changes; prevents stale signatures
- Supports both Aleo signers and ECDSA signers

## Leo Language Essentials

| Concept | Key Points | Example Location |
|---------|------------|------------------|
| **Future ordering** | `Future.await()` order in finalize enforces execution sequence | `sealed_report_policy.leo` finalize blocks (e.g., `finalize_transfer_from_public`) |
| **Visibility** | Only `public` values visible to finalize or cross-program calls; private requires public commitments (Merkle roots) | `merkle_tree.leo`, `sealance_freezelist_registry.leo` |
| **Mapping quirks** | Arrays emulated with index maps; `get_or_use` conflates "unset" with default value | `sealance_freezelist_registry.leo` freeze list mappings, `sealed_report_policy.leo` role mappings |
| **Hashing** | Poseidon for Merkle tree nodes/leaves; BHP256 for structured data | `merkle_tree.leo` functions `hash_leaf()`, `hash_node()`; `multisig_core.leo` operation hashing |
| **Upgrades** | `self.edition`/`self.checksum` gate upgrades; multisig core has upgrade kill switch | `compliant_token_template.leo` constructor, `multisig_core.leo` constructor |

## Leo/Aleo Limitations & Workarounds

Understanding these limitations is essential for working with Leo programs.

### No Dynamic Dispatch

All cross-program calls use hardcoded program names. Cannot parameterize which program to call.

```leo
// Must hardcode every external call
let call: Future = token_registry.aleo/prehook_public(...);  // Cannot use variable
```

**Impact**: Tight coupling; cannot write generic policies that work with different token implementations.
**Workaround**: Proxy pattern provides soft indirection (see Design Patterns below).

### No Inheritance or Traits

No code sharing between programs. Common logic must be duplicated.

**Example**: Three policy programs have identical `update_role()` implementations:
- `sealed_report_policy.leo` function `update_role()`
- `sealed_timelock_policy.leo` function `update_role()`
- `sealed_threshold_report_policy.leo` function `update_role()`

**Impact**: Bug fixes MUST be applied to multiple locations.

### Code Duplication from Caller Resolution

Cannot parameterize `self.caller` vs `self.signer` vs `self.address`, requiring separate functions:

- `transfer_public()` - uses `self.caller`
- `transfer_public_as_signer()` - uses `self.signer` (identical logic otherwise)

Each policy has multiple near-identical transfer variants (e.g., `transfer_public`, `transfer_public_as_signer`, `transfer_from_public`, `transfer_from_public_as_signer`).

### Mapping Limitations

**No native arrays**: Emulated with index mappings + sentinel values:
```leo
mapping freeze_list_index: u32 => address;    // Acts as array[index]
mapping freeze_list_last_index: bool => u32;  // Tracks highest index
const ZERO_ADDRESS = aleo1qqqq...;            // Sentinel for empty slots
```

**No optional types**: `get_or_use(key, default)` conflates "unset" with default value. This pattern is used extensively throughout all policy programs for mapping access.

**Hash-based multi-dimensional keys**:
```leo
mapping balances: field => Balance;  // hash(token_id, account) => Balance
```

### Cross-Program Visibility

**Rule**: Only `public` values can be passed to external program calls. When calling another program's function, all arguments MUST be declared `public` at the call site.

**Privacy preservation**: The `_priv` suffix on some function names (e.g., `verify_non_inclusion_priv`) is a naming convention indicating the function is designed for private transfer flows, but the actual parameters passed cross-program are still `public` in the Leo type system. Privacy is preserved through the ZKP mechanism - the value is included in the proof but not exposed on-chain.

```leo
// Arguments passed to external calls are public in Leo's type system
// The "_priv" suffix indicates this function supports private transfer flows
sealance_freezelist_registry.aleo/verify_non_inclusion_priv(recipient, proofs);
```

**Security note**: Values passed to external programs are visible to that program's logic but remain private from on-chain observers if no mapping writes expose them.

## Design Patterns

### Dual-Auth Token Patterns

Two approaches for combining direct address roles + multisig wallet roles:

| Aspect | Integrated | Separated (Proxy) |
|--------|------------|-------------------|
| Files | `multisig_compliant_token.leo` | `compliant_token_template.leo` + `multisig_token_proxy.leo` |
| Auth Model | Either/Or (direct OR multisig) | Proxy-Mediated |
| Deployments | 1 program | 2 programs |
| Freeze Registry | `multisig_freezelist_registry.aleo` | `sealance_freezelist_registry.aleo` |
| Standalone | N/A | Token works independently |

#### Integrated Pattern

Single program with dual role mappings:
- `address_to_role` - direct address authorization
- `wallet_id_to_role` - multisig wallet authorization

**Branching logic** (e.g., `f_update_role`):
```leo
if (wallet_id != ZERO_ADDRESS) {
    // MULTISIG PATH: verify wallet has role + signing completed
} else {
    // DIRECT PATH: verify caller has role
}
```

**Trade-offs**:
- (+) Single deployment, atomic state
- (+) Flexible either/or authorization
- (-) Code duplication: `mint_public` vs `mint_public_multisig` (8 function pairs)
- (-) Inconsistent structure: some ops dual-path, some separate functions

#### Separated (Proxy) Pattern

Token template (direct auth only) + proxy wrapper (adds multisig layer):

```
User → multisig_token_proxy.aleo → compliant_token_template.aleo
```

**Setup requirement**: Proxy program address must be granted roles in token template's `address_to_role`.

**Trade-offs**:
- (+) Modularity: token works standalone
- (+) Separation of concerns: easier to audit
- (-) Two upgrade paths
- (-) Direct access bypass possible (intentional for hybrid setups)

### Upgradability

All programs use constructor-based upgrade protection:

```leo
@custom
async constructor() {
    if self.edition > 0u16 {
        // Require multisig approval for upgrades
        let signing_op_id = BHP256::hash_to_field(ChecksumEdition {
            checksum: self.checksum,
            edition: self.edition
        });
        let wallet_signing_op_id_hash = BHP256::hash_to_field(WalletSigningOpId {
            wallet_id: self.address,  // Program's own address as wallet_id
            signing_op_id: signing_op_id
        });
        let signing_complete = multisig_core.aleo/completed_signing_ops.contains(wallet_signing_op_id_hash);
        assert(signing_complete);
    }
}
```

**Key points**:
- Initial deployment (`edition == 0`): No multisig required
- Upgrades (`edition > 0`): Multisig approval required
- Uses program's own address (`self.address`) as `wallet_id`
- Multisig wallet must be set up in `multisig_core.aleo` before upgrades possible

### Bitmasking for Roles

Compound permissions via bitwise operations:

```leo
const MINTER_ROLE: u16 = 1u16;
const BURNER_ROLE: u16 = 2u16;
const PAUSE_ROLE: u16 = 4u16;
const MANAGER_ROLE: u16 = 8u16;

// Check permission
assert(role & MANAGER_ROLE == MANAGER_ROLE);

// Grant multiple roles
address_to_role.set(addr, MINTER_ROLE | BURNER_ROLE);
```

## SDK Integration Points

Off-chain code MUST match on-chain exactly:

- **Hash inputs**: Same field ordering, padding, encoding
- **String encoding**: ASCII-packed `u128` via `stringToBigInt()` (`packages/policy-engine-sdk/src/conversion.ts`)
- **Merkle proofs**: Use `buildTree()`, `generateLeaves()`, `getSiblingPath()` from `@sealance-io/policy-engine-aleo`
- **Constants**:
  - `MAX_TREE_DEPTH = 16` (`lib/Constants.ts`)
  - `ZERO_ADDRESS` (`packages/policy-engine-sdk/src/constants.ts`, re-exported from `lib/Constants.ts`)

## Rules Summary

Numbered, testable statements for agents:

1. All public state changes MUST occur in `finalize` blocks
2. Transitions MUST NOT write to mappings directly
3. Freeze list indices MUST use `ZERO_ADDRESS` sentinel for empty/reusable slots
4. `ZERO_ADDRESS` MUST NOT be used as a real frozen entry
5. External authorization flows MUST await futures in correct order (prehook before transfer)
6. Cross-program function arguments MUST be declared `public` at the call site
7. Bug fixes in duplicated logic (e.g., `update_role()`) MUST be applied to all policy programs
8. Off-chain hash computations MUST use identical field ordering as on-chain Leo code

## Verification Checklist

When working with these programs:

- [ ] Hash ordering matches between SDK and Leo (field order in structs)
- [ ] Merkle path length equals `MAX_TREE_DEPTH` (16)
- [ ] `ZERO_ADDRESS` used only as sentinel, never as actual frozen address
- [ ] Future await order correct in finalize blocks (prehook → transfer)
- [ ] Block height estimates within acceptable window for threshold policy
- [ ] Role bitmasks use correct constants (`lib/Constants.ts`)

## Security Considerations

- **Mapping default values**: `get_or_use()` cannot distinguish "unset" from "set to default" - design mappings accordingly
- **Cross-program visibility**: Arguments to external calls are visible to the called program; ensure no secrets are passed
- **Future ordering**: Incorrect await order can bypass authorization checks
- **Upgrade protection**: Programs with `edition > 0` require multisig approval; verify multisig wallet is properly configured

## Non-Goals

This document does not cover:
- General Leo/Aleo tutorials (see External Documentation)
- Deployment procedures (see `docs/DEVELOPMENT.md`)
- Test configuration (see `docs/TESTING.md`)
- SDK API reference (see `packages/policy-engine-sdk/API.md`)

## External Documentation

- Leo language: https://docs.leo-lang.org/leo
- Aleo concepts: https://developer.aleo.org/category/fundamentals
- snarkVM (hash functions): https://github.com/ProvableHQ/snarkVM
