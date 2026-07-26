# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Monorepo for compliant token transfers on the Aleo blockchain. Leo programs (smart contracts) enforce compliance policies using Merkle tree non-inclusion proofs against on-chain freeze lists. A TypeScript SDK generates those proofs off-chain.

## Commands

```bash
# Setup
npm run lint:lockfile                                # Explicit lockfile validation
npm ci --ignore-scripts --allow-git=none            # ALWAYS use --ignore-scripts

# Build
npm run compile                                      # Compile Leo programs with LionDen
npm run build --workspace=@sealance-io/policy-engine-aleo  # SDK only

# Test
npm test                                             # LionDen-managed devnode mode (fast, default)
npm test test/merkle_tree.test.ts                    # Single test file
npm test --grep "mint"                               # Filter tests by name
npm test --no-compile                                # Reuse existing artifacts/typechain
npm test --prove                                     # Generate proofs during execution
npm run test:devnet                                  # Containerized multi-validator devnet, one container per file

# Quality
npm run typecheck                                    # tsc --noEmit (needs built SDK + typechain)
npm run format:fix                                   # Prettier (run before committing)
npm run lint:licenses                                # Check for GPL/AGPL (blocked)

# SDK release
npx changeset                                        # Add changeset for SDK changes

# Deploy
npm run deploy:devnode
npm run deploy:testnet

# Upgrade
lionden recipe --file recipes/upgrade.ts --network devnode --program <program-name>
# Example: lionden recipe --file recipes/upgrade.ts --network devnode --program merkle_tree
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

**Testing**: LionDen manages the local `leo devnode` lifecycle by default. Test files run serially, each in its own forked worker with its own devnode — no chain state is shared across files and file order is irrelevant. Devnode is the recommended local and PR-CI path; `TEST_MODE=devnet` swaps in a containerized multi-validator devnet (one container per file, via the nightly per-file matrix).

## Constraints

- **npm security**: Always `--ignore-scripts` for install/ci commands and use `--allow-git=none` with `npm ci`
- **Workspace**: Install packages from repo root only, never in subdirectories
- **Leo version**: v4.3.2 — compile with `npm run compile`, not `leo build`
- **LionDen dependencies**: `@lionden/*` packages are installed from npm and pinned exactly; update them intentionally as a group
- **Program upgrades**: Use `lionden recipe --file recipes/upgrade.ts --network <network> --program <program-name>` where the program name comes from `/programs` without the `.aleo` suffix
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

- Prefer `npm test` for root integration tests so LionDen manages compile, typechain, and devnode lifecycle
- Use `npm test --no-compile` only when intentionally reusing existing artifacts/typechain

## Documentation Index

Load the linked file when your task touches that area:

- **Leo/Aleo patterns**: `docs/LEO-ALEO-PATTERNS.md` — execution model, program structure, compliance patterns, limitations
- **Architecture**: `docs/ARCHITECTURE.md` — program dependencies, compliance system, SDK modules
- **Code patterns**: `docs/CODE-PATTERNS.md` — contract interaction, freeze lists, test structure
- **Build/deploy/upgrade**: `docs/DEVELOPMENT.md` — commands, SDK development, deployment, upgrades
- **Testing**: `docs/TESTING.md` — LionDen devnode setup and troubleshooting
- **npm security**: `docs/NPM-SECURITY.md` — security model, attack prevention
- **SDK guide**: `packages/policy-engine-sdk/AGENTS.md`
- **Releasing**: `docs/RELEASING.md` — Changesets workflow, emergency procedures
- **CI security**: `docs/SECURITY-WORKFLOWS.md` — action pinning, permissions
- **Dependabot**: `docs/DEPENDABOT-STRATEGY.md` — update policies, blocked packages
