---
paths:
  - "programs/**/*"
  - "artifacts/**/*"
---

# Leo Programs

See @docs/ARCHITECTURE.md for program structure and @docs/LEO-ALEO-PATTERNS.md for language patterns.

**Build constraints:**

- Compile with `dokojs compile` (not `leo build`)
- Leo CLI version: 3.4.0
- Never update `@doko-js/*` without checking `/patches`

**Execution model:**

- `async transition` runs off-chain (user's machine) → generates ZKP + `Future`
- `async function` runs on-chain (validators) → writes to mappings
- Only `public` values visible to `async function`; private values need public commitments (Merkle roots)

**Data types:**

- `record` = private asset (UTXO-like, off-chain); `struct` = transient circuit data; `mapping` = public on-chain storage
- Poseidon for Merkle tree hashing; BHP256 for structured data
- Mappings emulate arrays with index maps; `get_or_use` conflates "unset" with default

**Compliance patterns:**

- Authorization flow: `prehook_public()` → `transfer_from_public()` → finalize awaits both futures (order mandatory)
- `ZERO_ADDRESS` is sentinel for empty freeze list slots - never use as real frozen entry
- Two models: self-contained freeze lists (report policy) vs external registry with off-chain proofs (timelock/threshold)

**Language limitations:**

- No dynamic dispatch: all cross-program calls hardcoded (e.g., `token_registry.aleo/...`)
- No inheritance/traits: common logic duplicated across policy programs
- No parameterized caller: separate functions for `self.caller` vs `self.signer` variants
- Mapping workarounds: index emulation for arrays, hash-based multi-dimensional keys, `get_or_use` for absent values

**Design patterns:**

- Integrated dual-auth: single program with `address_to_role` + `wallet_id_to_role`
- Separated (proxy): token template + multisig proxy wrapper
- Upgradability: `@custom async constructor()` with `self.edition` check + multisig approval
