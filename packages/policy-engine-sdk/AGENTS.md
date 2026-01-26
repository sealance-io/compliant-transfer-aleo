# Policy Engine SDK - AI Agent Guide

Quick reference for AI agents working with the `@sealance-io/policy-engine-aleo` SDK.

## Quick Commands

```bash
# Development (run from repository root)
npm run build --workspace=@sealance-io/policy-engine-aleo   # Build
npm run test --workspace=@sealance-io/policy-engine-aleo    # Test
npm run test:watch --workspace=@sealance-io/policy-engine-aleo  # Watch
npm run format:fix --workspace=@sealance-io/policy-engine-aleo  # Format

# Version management
npx changeset  # Add changeset for SDK changes
```

## Module Structure

| File                 | Purpose                                    |
| -------------------- | ------------------------------------------ |
| `src/policy-engine.ts` | Main `PolicyEngine` class                |
| `src/api-client.ts`    | Blockchain API with retry/concurrency    |
| `src/merkle-tree.ts`   | Tree building and proof generation       |
| `src/conversion.ts`    | Address/field conversion utilities       |
| `src/types.ts`         | TypeScript type definitions              |
| `src/index.ts`         | Public exports                           |

## Key APIs

### PolicyEngine Class

```typescript
const engine = new PolicyEngine({ endpoint, network, maxTreeDepth });

// Core methods
engine.fetchCurrentRoot(programId)                      // Lightweight root fetch
engine.fetchFreezeListFromChain(programId)              // Full freeze list
engine.generateFreezeListNonInclusionProof(addr, opts)  // Generate proof
engine.buildMerkleTree(addresses)                       // Build tree
engine.getMerkleRoot(addresses)                         // Get root
```

### Utility Functions

```typescript
import {
  convertAddressToField,   // aleo1... → bigint
  convertFieldToAddress,   // field → aleo1...
  stringToBigInt,          // ASCII → bigint
  buildTree,               // leaves → tree
  generateLeaves,          // addresses → sorted leaves
  getLeafIndices,          // tree + address → indices
  getSiblingPath,          // tree + index → proof
  trackTransactionStatus   // txId → status
} from "@sealance-io/policy-engine-aleo";
```

## Design Principles

1. **ESM Only**: Modern ES module package
2. **Minimal Dependencies**: Only `@provablehq/sdk` and `@scure/base`
3. **Configurable**: All options have sensible defaults
4. **Cache-Friendly**: `fetchCurrentRoot()` enables efficient cache validation

## Documentation

Load the linked file(s) when your task touches that area. Do not assume links are auto-loaded.

- **SDK usage or public API surface:** `README.md` (installation, quick start) and `API.md` (complete API reference)
- **SDK examples or integration guidance:** `examples/` directory
- **SDK version history or release notes:** `CHANGELOG.md`
- **Publishing or package registry setup:** See Publishing section below
- **Repo-wide constraints or shared tooling:** Root `AGENTS.md`

## Testing

SDK tests are pure TypeScript (no blockchain required):

```bash
npm run test --workspace=@sealance-io/policy-engine-aleo
```

Integration tests are in `/test/*.test.ts` (require devnet).
SDK unit tests can run in parallel; integration/devnet tests must run sequentially.

## Publishing

Publish to GitHub npm registry and/or public npm registry.

**Prerequisites (~/.npmrc):**

```
# GitHub Package Registry
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT

# npm Registry
//registry.npmjs.org/:_authToken=YOUR_NPM_TOKEN
```

**Commands (from SDK directory):**

```bash
cd packages/policy-engine-sdk
npm run publish:github    # GitHub npm registry
npm run publish:npm       # Public npm registry
```

The `prepublishOnly` script builds automatically before publishing.

## SDK-Specific Notes

- **ESM Only**: No CommonJS - use `import`/`export` only
- Add changeset for any SDK change: `npx changeset`

See root `/AGENTS.md` for repository-wide constraints.
