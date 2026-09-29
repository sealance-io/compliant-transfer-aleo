# ARC-22 compatibility

This repository has two direct ARC-22 implementations:

- `sealance_freezelist_registry.aleo` implements the official `IARC22Freezelist` interface.
- `compliant_token_template.aleo` implements the official `IARC22` interface and uses the
  registry above for public and private freeze-list enforcement.

The standard is pinned to ProvableHQ/ARCs commit
`7e66621306953bc58822a393fb45d0e8749ebb5d`. The public HTTPS dependency and resolved
commit are recorded in `standards/iarc22-check/program.json` and
`standards/iarc22-check/leo.lock`.

## Compatibility and migration

ARC-22 requires `name()` and `symbol()` to return `identifier`. The source-level
`compliant_token_template.aleo` now stores those fields as `identifier`, so fresh
deployments conform. The multisig token still uses its legacy metadata and is not claimed
as an ARC-22 implementation.

The registry preserves `freeze_list`, `freeze_list_index`, `freeze_list_last_index`, and
`freeze_list_root`. The published Policy Engine SDK reads the latter three mappings
directly for proof generation; the registry uses `freeze_list` for public membership
checks. Current and previous roots remain at the legacy `1u8` and `2u8` keys,
and the last index remains at the `true` key. This lets `fetchCurrentRoot()`,
`fetchFreezeListFromChain()`, and `generateFreezeListNonInclusionProof({ programId, ... })`
continue reconstructing the ordered list and its Merkle root. The update height, grace
window, and initialization sentinel use scalar storage. The required standard views expose
the same state without changing the SDK-facing mapping ABI. The registry private-proof ABI
uses the standard `MerkleProof` type.

The ARC-22 interface does not specify these mappings. Devnode SDK regression tests separately
protect the direct mapping reads used to reconstruct the ordered list and generate proofs.

The token pause flag and initialization sentinel are scalar storage. Token metadata remains
in the singleton `token_info` mapping: Leo 4.4.3 rejects `identifier` as a scalar storage
type, including when it is nested in `TokenInfo`, while ARC-22 requires `name()` and
`symbol()` to return genuine identifiers. Replacing that mapping with `storage token_info:
TokenInfo` does not compile under the configured toolchain; encoding the identifiers as
another type would not be standards-compatible.

These changes alter parts of the registry and token storage layouts, the `TokenInfo` value
type, initialization ABI, and registry proof ABI. They must not be treated as a
storage-compatible edition upgrade. The four SDK-facing registry mappings retain their
legacy names and types, but the height/window state moved to scalar storage. Existing
deployments must deploy fresh programs under new program IDs, initialize them, reconstruct
the freeze-list and root state, pause the old token, snapshot balances/allowances and
outstanding private records off-chain, and issue equivalent public/private balances under
an application-approved migration. The old program remains authoritative until that
reconciliation is complete; already-deployed editions do not become ARC-22 compatible.

## Build, verify, test, and deploy

Use Leo 4.4.3 and run from the repository root:

```bash
npm run compile
npm run check:iarc22
npm test test/iarc22.test.ts
npm run deploy:devnode
```

`npm run compile` compiles repository sources through LionDen using repository-local
development interface mirrors. It does **not** validate against the official Git-hosted
interface. Leo supports Git dependencies, but the current LionDen compilation workflow
regenerates temporary manifests and cannot preserve or materialize this dependency.

`npm run check:iarc22` is the authoritative upstream conformance check. It creates
temporary consumer packages, removes the local mirrors from temporary copies of the
target sources, declares implementation of the official interfaces, and compiles those
packages against the pinned ProvableHQ/ARCs Git dependency and `leo.lock`. It also checks
that the legacy token is rejected as a negative control. CI runs this command to detect
drift between the local development mirrors and the pinned standard.

## Updating the standard pin

Choose a reviewed immutable ARCs commit or tag compatible with the repository's Leo
version. Update the `rev` in `standards/iarc22-check/program.json`, run `leo update` in
that directory with Leo 4.4.3 to regenerate `leo.lock`, then run the compile, conformance,
type-check, and complete test suite. Commit the manifest and lockfile together. Never pin
the dependency to a branch. Upstream GitHub changes have no effect until a maintainer
explicitly updates both the immutable revision and lockfile. `npm run check:iarc22`
rejects a manifest/lockfile pin mismatch before invoking Leo.
