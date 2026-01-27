# Leo/Aleo Program Patterns (Authoritative)

Status: Normative
Last verified: 2026-01-26 (commit 6efaf4531c0c49c2138f8f5ce7fdb55d19cffd4f)
Scope: Leo v3.4.0; Aleo execution model; programs under /programs in this repository.
External program behavior is treated as assumptions and called out explicitly.

This document is authoritative for how this repo's Leo programs are structured and how agents
should reason about execution, visibility, and compliance logic.

## Normative Keywords

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as in RFC 2119.

## External Dependencies (Assumptions)

This repository depends on external programs and protocol behaviors. These are treated as
assumptions and must be re-verified when upgrading:

- token*registry.aleo: prehook*\_ / transfer\_\_ API and authorization semantics relied on by
  programs/policy/sealed_report_policy.leo and programs/policy/sealed_threshold_report_policy.leo.
- merkle_tree.aleo: verify_non_inclusion returns a root commitment from (account, merkle_proof),
  as used by programs/freezelist_registry/sealance_freezelist_registry.leo::verify_non_inclusion_priv.
- Aleo execution model: async transitions produce Futures and async functions execute on-chain
  (see Execution Model section).

## Glossary

- async transition: Off-chain execution that produces a ZKP and a Future for on-chain execution.
- async function: On-chain execution triggered by a Future; performs public checks and writes mappings.
- Future: A request to execute an async function on-chain; carries only public values and commitments.
- record: Private (encrypted) asset data stored off-chain by the user; consumed/produced by transitions.
- mapping: Public on-chain key/value state; writable only in async functions.
- struct: Transient circuit data; not persisted.

## Execution Model (Protocol Assumptions)

This section captures protocol-level behavior that this repo assumes.

### Async transition (off-chain)

- MUST run locally (client/SDK).
- MAY read public on-chain mappings.
- MUST NOT write mappings directly.
- MUST produce a ZKP and a Future for any public state change.

### Async function (on-chain)

- MUST be triggered by a Future created by a proven transition.
- MUST only use public values or commitments carried by the Future.
- MUST perform final authorization/state checks.
- MUST be the only place where mappings are written.

### Lifecycle (informative)

1. User calls async transition.
2. Transition runs locally and produces ZKP + Future.
3. Transaction submitted to Aleo node.
4. Validators verify ZKP, execute async function, and update mappings.

### Data primitives (protocol)

| Type    | Visibility          | Storage                | Behavior                                          |
| ------- | ------------------- | ---------------------- | ------------------------------------------------- |
| record  | Private (encrypted) | Off-chain (user holds) | UTXO-like; consumed/produced by transitions       |
| mapping | Public              | On-chain               | Key/value store; writable only in async functions |
| struct  | N/A (transient)     | None                   | Circuit data only; not persisted                  |

## Repository-Specific Architecture (Normative)

### Compliance models

| Model             | Programs                                                                                       | Freeze list location                                          | Verification                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Self-contained    | programs/policy/sealed_report_policy.leo, programs/token/sealed_report_token.leo               | Internal mappings                                             | Direct mapping lookups                          |
| External registry | programs/policy/sealed_timelock_policy.leo, programs/policy/sealed_threshold_report_policy.leo | programs/freezelist_registry/sealance_freezelist_registry.leo | Merkle proofs via verify_non_inclusion_pub/priv |

### Freeze list rules

- MUST use array-like mappings: freeze_list: address => bool, freeze_list_index: u32 => address.
- MUST use ZERO_ADDRESS as a sentinel for empty slots; ZERO_ADDRESS MUST NOT be a real frozen entry.
- MUST initialize freeze_list_last_index, freeze_list, and freeze_list_index in initialize
  (programs/freezelist_registry/sealance_freezelist_registry.leo::initialize).
- MUST update freeze_list_last_index when adding entries at last_index + 1
  (programs/freezelist_registry/sealance_freezelist_registry.leo::update_freeze_list).
- MUST update root_updated_height when roots change
  (programs/freezelist_registry/sealance_freezelist_registry.leo::update_freeze_list).
- MUST enforce the previous_root window in verify_non_inclusion_priv
  (programs/freezelist_registry/sealance_freezelist_registry.leo::verify_non_inclusion_priv).
- Sentinel value is defined in lib/Constants.ts; SDK handling is in lib/FreezeList.ts.

### Block height window (threshold policy)

- Transitions in programs/policy/sealed_threshold_report_policy.leo accept public estimated_block_height.
- Async functions MUST enforce:
  - block.height >= estimated_block_height
  - estimated_block_height >= (block.height - window)
- These checks appear in f\_\* finalize functions such as f_signup_and_transfer_private in
  programs/policy/sealed_threshold_report_policy.leo.

## Authorization and Async Patterns (Normative)

### External authorization order

For token_registry authorization flows, the following order MUST be preserved:

- Transition: prehook*\* is called before transfer*\*.
- Async function: the Future returned by prehook*\* MUST be awaited before transfer*\*.

Example (repo pattern):

- token_registry.aleo/prehook_public then token_registry.aleo/transfer_public_as_signer
- Await order in programs/policy/sealed_report_policy.leo::f_transfer_public_as_signer

### Multisig architecture

- Operation registration uses BHP256::hash_to_field on the operation struct.
- Private operations use BHP256::commit_to_field with a salt to hide payload.
- Wallet signing ops expire via WalletSigningOp.expires_at_block.
- Rounds MUST increment when operation content changes to prevent stale signatures.
- Implementations live in programs/vendor/multisig_core.leo and programs/token/multisig_compliant_token.leo.

## Visibility and Cross-Program Calls (Normative)

- Only public values (or public commitments derived from private inputs) can be consumed by
  an async function or cross-program call.
- Private inputs remain private unless explicitly committed or revealed.

Example:

- programs/freezelist_registry/sealance_freezelist_registry.leo::verify_non_inclusion_pub
  reveals the account publicly.
- programs/freezelist_registry/sealance_freezelist_registry.leo::verify_non_inclusion_priv
  keeps the account private and passes only the Merkle root to the async function.

## Leo/Aleo Platform Limitations (Informative)

### No dynamic dispatch

- Cross-program calls use hardcoded program names; program ids cannot be parameterized.
- Impact: tight coupling; generic policies across token implementations are not possible.
- Workaround: proxy pattern (see Design Patterns).

### No inheritance or traits

- No code sharing between programs; logic is duplicated across policy programs.
- Example: update*role implementations across sealed*\* policies.

### Caller resolution duplication

- self.caller vs self.signer vs self.address cannot be parameterized.
- Result: separate transfer\_\* variants for caller vs signer flows.

### Mapping limitations

- No native arrays; use index mappings + sentinel values.
- No optional types; get_or_use conflates unset with default value.
- Multi-dimensional keys are hash-composed (e.g., hash(token_id, account)).

## Design Patterns (Informative)

### Dual-auth token patterns

| Aspect          | Integrated                                                    | Separated (Proxy)                                                                     |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Files           | programs/token/multisig_compliant_token.leo                   | programs/token/compliant_token_template.leo + programs/proxy/multisig_token_proxy.leo |
| Auth model      | direct OR multisig                                            | proxy-mediated                                                                        |
| Deployments     | 1 program                                                     | 2 programs                                                                            |
| Freeze registry | programs/freezelist_registry/multisig_freezelist_registry.leo | programs/freezelist_registry/sealance_freezelist_registry.leo                         |
| Standalone      | N/A                                                           | token can be used without proxy                                                       |

Integrated pattern:

- address_to_role for direct auth
- wallet_id_to_role for multisig auth

Separated pattern:

- proxy program address MUST be granted roles in token template address_to_role.
- direct access remains possible by design for hybrid setups.

### Upgradability

- All programs use constructor-based upgrade protection.
- Upgrades (edition > 0) require multisig approval using the program's own address as wallet_id.
- See programs/token/compliant_token_template.leo and programs/vendor/multisig_core.leo.

### Bitmasking for roles

- Roles are composed via bitwise OR; checks via AND.
- Constants live in role-related programs and lib/Role.ts for off-chain parity.

## SDK Integration Points (Normative)

Off-chain computations MUST match on-chain logic exactly:

- Hash inputs: same field ordering, padding, and encoding as on-chain.
- String encoding: ASCII-packed u128; see packages/policy-engine-sdk/src/conversion.ts.
- Merkle proofs: use buildTree, generateLeaves, getSiblingPath from
  packages/policy-engine-sdk/src/merkle-tree.ts.
- Constants: MAX_TREE_DEPTH and ZERO_ADDRESS in lib/Constants.ts.

## External References (Informative)

- Leo language: https://docs.leo-lang.org/leo
- Aleo fundamentals: https://developer.aleo.org/category/fundamentals
- snarkVM (hash functions): https://github.com/ProvableHQ/snarkVM
