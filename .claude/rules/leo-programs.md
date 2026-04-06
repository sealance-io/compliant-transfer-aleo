---
paths:
  - "programs/**/*"
  - "artifacts/**/*"
---

# Leo Programs

See @docs/ARCHITECTURE.md for program structure and @docs/LEO-ALEO-PATTERNS.md for language patterns.

**Build constraints:**

- Compile with `dokojs compile` (not `leo build`)
- Leo CLI version: 4.0.0
- Never update `@doko-js/*` without checking `/patches`

**Execution model:**

- Entry `fn` runs off-chain (user's machine) → generates ZKP + `Final`
- `final { }` block runs on-chain (validators) → writes to mappings
- Only `public` values visible inside `final` block; private values need public commitments (Merkle roots)

**Program structure (Leo v4):**

- Inside `program {}`: entry `fn`s, `record` types, `mapping`, `const`, `constructor`
- Outside `program {}`: `struct` types, helper `fn`s, `final fn`s (helpers that access mappings), `const`
- Cross-program calls use `::` separator: `token_registry.aleo::transfer_public(...)`

**Data types:**

- `record` = private asset (UTXO-like, off-chain); `struct` = transient circuit data; `mapping` = public on-chain storage
- Poseidon for Merkle tree hashing; BHP256 for structured data
- Mappings emulate arrays with index maps; `get_or_use` conflates "unset" with default

**Compliance patterns:**

- Authorization flow: `prehook_public()` → `transfer_from_public()` → final block runs both via `.run()` (order mandatory)
- `ZERO_ADDRESS` is sentinel for empty freeze list slots - never use as real frozen entry
- Two models: self-contained freeze lists (report policy) vs external registry with off-chain proofs (timelock/threshold)

**Language limitations:**

- Cross-program calls are hardcoded (e.g., `token_registry.aleo::...`); Leo v4 adds interfaces/dynamic dispatch but this repo doesn't use them yet
- No inheritance/traits: common logic duplicated across policy programs
- No parameterized caller: separate functions for `self.caller` vs `self.signer` variants
- Mapping workarounds: index emulation for arrays, hash-based multi-dimensional keys, `get_or_use` for absent values

**Design patterns:**

- Integrated dual-auth: single program with `address_to_role` + `wallet_id_to_role`
- Separated (proxy): token template + multisig proxy wrapper
- Upgradability: `@custom constructor()` with `self.edition` check + multisig approval
