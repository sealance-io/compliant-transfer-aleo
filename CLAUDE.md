# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Monorepo for compliant token transfers on the Aleo blockchain. Leo programs (smart contracts) enforce compliance policies using Merkle tree non-inclusion proofs against on-chain freeze lists. A TypeScript SDK generates those proofs off-chain.

## Commands

```bash
# Setup
npm ci --ignore-scripts                              # ALWAYS use --ignore-scripts
npm install -g @sealance-io/dokojs@1.0.6 --ignore-scripts

# Build
dokojs compile                                       # Compile Leo programs (NOT leo build)
npm run build --workspace=@sealance-io/policy-engine-aleo  # SDK only

# Test
npm test                                             # Devnode mode (fast, default)
DEVNET=true npm test                                 # Devnet mode (slow, full network)
npm run test:select ./test/merkle_tree.test.ts       # Single test file
npm run test:agent                                   # Machine-friendly agent reporter
npm run test:select:agent ./test/some.test.ts        # Single test with agent reporter

# Quality
npm run format:fix                                   # Prettier (run before committing)
npm run lint:licenses                                # Check for GPL/AGPL (blocked)

# SDK release
npx changeset                                        # Add changeset for SDK changes

# Deploy
npm run deploy:devnet
npm run deploy:testnet
```

## Architecture

**Leo programs** (`/programs`) are the core — 14 programs across 7 directories:

- `vendor/` — `token_registry.leo` (shared token registry), `multisig_core.leo` (multisig primitives)
- `core/` — `merkle_tree.leo` (Merkle proof verification)
- `freezelist_registry/` — On-chain freeze lists with Merkle roots + multisig variant
- `token/` — Compliant token template, self-contained report token, multisig token
- `policy/` — Report, threshold-report, and timelock compliance policies
- `proxy/` — Multisig proxy wrappers for tokens and freeze lists
- `demo/` — Credit-to-token exchange

**Execution model** (Leo v4): Entry `fn` runs off-chain (generates ZKP + `Final`). The `final { }` block runs on-chain (validators write to mappings). Only `public` values are visible inside `final` blocks.

**Compliance flow**: Freeze list stored on-chain -> SDK fetches list and builds Merkle tree -> generates non-inclusion proof -> proof submitted with transfer transaction -> on-chain final block verifies proof.

**SDK** (`/packages/policy-engine-sdk`): Published as `@sealance-io/policy-engine-aleo`. Pure TypeScript, ESM only. Fetches freeze lists, builds Merkle trees, generates proofs.

**Testing**: Testcontainers spin up a local Aleo node. Tests run sequentially (shared chain state, alphabetical file order). Devnode is fast (minutes); devnet is slow (60-90 min, nightly only).

## Constraints

- **npm security**: Always `--ignore-scripts` for install/ci commands
- **Workspace**: Install packages from repo root only, never in subdirectories
- **Leo version**: v4.0.0 — compile with `dokojs compile`, not `leo build`
- **dokojs patches**: `@doko-js/*` is patched locally — verify against `/patches` before updating
- **Node**: v24 (see `.nvmrc`); v20.19.0+ or v22.12.0+ also work

## Rules

Context-specific rules load automatically from `.claude/rules/` based on file paths — covering Leo programs, testing, SDK, deployment, lib, and npm security.

### Git Workflow

- Create commits only when explicitly requested
- Never amend commits after hook failures — create new commits
- Stage specific files, avoid `git add -A` or `git add .`

### Code Style

- Run `npm run format:fix` before committing
- No GPL/AGPL licensed dependencies (`npm run lint:licenses`)
- Only make requested changes — avoid over-engineering

### Testing

- Prefer `npm run test:agent` or `npm run test:select:agent` for machine-friendly output
- When running Vitest directly, use `--reporter=agent`

## Documentation Index

Load the linked file when your task touches that area:

- **Leo/Aleo patterns**: `docs/LEO-ALEO-PATTERNS.md` — execution model, program structure, compliance patterns, limitations
- **Architecture**: `docs/ARCHITECTURE.md` — program dependencies, compliance system, SDK modules
- **Code patterns**: `docs/CODE-PATTERNS.md` — contract interaction, freeze lists, test structure
- **Build/deploy**: `docs/DEVELOPMENT.md` — commands, environment variables, SDK development
- **Testing**: `docs/TESTING.md` — modes, container config, troubleshooting
- **npm security**: `docs/NPM-SECURITY.md` — security model, attack prevention
- **SDK guide**: `packages/policy-engine-sdk/AGENTS.md`
- **Releasing**: `docs/RELEASING.md` — Changesets workflow, emergency procedures
- **CI security**: `docs/SECURITY-WORKFLOWS.md` — action pinning, permissions
- **Dependabot**: `docs/DEPENDABOT-STRATEGY.md` — update policies, blocked packages
