# sealance-io/compliant-transfer-aleo AI Agent Guide

> Last Updated: 2026-09-30

AI agent instructions for this repository. See detailed docs for specific topics.

## Repository Overview

Monorepo for compliant token transfers on Aleo blockchain. Leo programs (smart contracts) + TypeScript SDK for Merkle proofs and compliance policies.

**Components:**

- **Leo Programs** (`/programs`): Compliance policy smart contracts
- **Policy Engine SDK** (`/packages/policy-engine-sdk`): Published as `@sealance-io/policy-engine-aleo`
- **Test Suite** (`/test`): LionDen-managed `leo devnode` integration tests
- **Shared Libraries** (`/lib`): Freeze lists, tokens, deployment, roles, funding
- **Deployment Recipes** (`/recipes`): Devnode/testnet deployment and upgrades

**Execution model** (Leo v4): Entry `fn` runs off-chain (generates ZKP + `Final`). The `final { }` block runs on-chain (validators write to mappings). Only `public` values are visible inside `final` blocks.

**Compliance flow**: Freeze list stored on-chain -> SDK fetches list and builds Merkle tree -> generates non-inclusion proof -> proof submitted with transfer transaction -> on-chain final block verifies proof.

## Quick Reference

```bash
# Setup
npm run lint:lockfile
npm ci --ignore-scripts --allow-git=none

# Build
npm run compile              # Compile Leo programs with LionDen
npm run build --workspace=@sealance-io/policy-engine-aleo  # SDK only

# Test
npm run compile             # Required after a clean checkout/program change
npm test                    # Default devnode mode; reuses artifacts/typechain
npm test test/merkle_tree.test.ts  # Specific test
npm test -- --grep "mint"      # Filter tests by name
npm test -- --prove            # Generate proofs during execution
npm run test:devnet         # Containerized multi-validator devnet, one container per file

# Quality
npm run typecheck           # tsc --noEmit (needs built SDK + typechain)
npm run lint:licenses       # Check for GPL/AGPL (blocked)

# SDK release
npx changeset               # Add changeset for SDK changes

# Deploy
npm run deploy:devnode      # Deploy to local devnode
npm run deploy:testnet      # Deploy to testnet

# Upgrade
lionden recipe --file recipes/upgrade.ts --network devnode --program <program-name>
# Example: lionden recipe --file recipes/upgrade.ts --network devnode --program merkle_tree

# Format
npm run format:fix          # Auto-fix formatting
```

## Critical Constraints

1. **Node Version**: Use Node 20.19.0+ on the 20.x line, or Node 22.12.0+; the repo default in `.nvmrc` is `v24`
2. **Leo Version**: Developed with Leo CLI v4.4.3 — compile with `npm run compile`, not `leo build`
3. **Workspace Rules**: Always install packages from repository root, never in subdirectories. Sole exception: the standalone `packages/policy-engine-sdk/examples/` package (outside the workspace), installed in place with `--ignore-scripts`
4. **One Chain Per Test File**: Test files run serially, each in its own forked worker with its own chain. No state is shared across files and file order is irrelevant — but a file's own tests do share a chain and must stay ordered within the file
5. **npm Security**: Always use `--ignore-scripts` for installs; use `--allow-git=none` with `npm ci`. Build/publish workflows may run scripts as needed
6. **LionDen Dependencies**: `@lionden/*` packages are installed from npm and pinned exactly; update them intentionally as a group
7. **Program Upgrades**: Use `lionden recipe --file recipes/upgrade.ts --network <network> --program <program-name>` where the program name comes from `/programs` without the `.aleo` suffix
8. **Licenses**: No GPL/AGPL licensed dependencies (`npm run lint:licenses`). Sole exception: `@provablehq/sdk` and `@provablehq/wasm` (`GPL-3.0`, the core Aleo SDK), excluded by name

## Git Workflow

- Create commits only when explicitly requested
- Never amend commits after hook failures — create new commits
- Stage specific files, avoid `git add -A` or `git add .`

## Code Style

- Run `npm run format:fix` before committing
- Only make requested changes — avoid over-engineering

## CI/CD Status Checks

Required for branch protection:

- `CI Status` (on-pull-request-main.yml)
- `SDK Status` (on-pull-request-main-sdk.yml)
- `Nightly Status`, `Security Audit Status`, `Release Status`

## Documentation

Load the linked file(s) when your task touches that area. Do not assume links are auto-loaded.

- **Build, deploy, upgrade, release, or setup:** `docs/DEVELOPMENT.md` - commands, SDK development, deployment, upgrades
- **Releasing SDK versions:** `docs/RELEASING.md` - Changesets workflow, bump types, pre-releases
- **Release admin, failures, or emergencies:** `docs/RELEASE-OPERATIONS.md` - environments, troubleshooting, rollback/deprecate/unpublish
- **Testing or CI failures:** `docs/TESTING.md` - manual local Aleo setup, test configuration
- **npm install, security policy, or dependency updates:** `docs/NPM-SECURITY.md` - security model and practices
- **Program structure, compliance flow, or editing Leo programs:** `docs/ARCHITECTURE.md` - Leo programs, dependencies, compliance system, cross-program invariants
- **ARC-22 compatibility or conformance checks:** `docs/IARC22.md` - ARC-22 implementations, SDK-facing mapping compatibility, pinned standard
- **Patterns for Leo contracts or tests:** `docs/CODE-PATTERNS.md` - contract interaction, freeze lists, test structure
- **SDK development tasks:** `packages/policy-engine-sdk/AGENTS.md` - SDK agent guide
- **SDK usage or API questions:** `packages/policy-engine-sdk/README.md` (quick start) and `packages/policy-engine-sdk/API.md` (API reference)
- **Security workflows or Dependabot:** `docs/SECURITY-WORKFLOWS.md` (GitHub Actions) and `docs/DEPENDABOT-STRATEGY.md` (update policies)

## Audits

[Sealance Compliance Technology for Aleo](./audits/veridise_09:2025.pdf) by [Veridise](https://veridise.com/) - 09/2025

## Common Issues

| Issue                   | Solution                                                       |
| ----------------------- | -------------------------------------------------------------- |
| Leo CLI missing         | Install a Leo CLI compatible with `lionden.config.ts`          |
| Tests too slow          | Keep proofs disabled; use `npm test -- --prove` only as needed |
| Port 3030 in use        | Stop the process currently listening on port 3030              |
| Manual local Aleo setup | See `docs/TESTING.md`                                          |

## Testing Preferences

- Run `npm run compile` after a clean checkout or Leo program change to generate the
  gitignored artifacts and typechain.
- Prefer `npm test` for root integration tests; the script intentionally passes
  `--no-compile` and reuses the generated artifacts/typechain while LionDen manages the
  devnode lifecycle.
- Devnode is the recommended local and PR-CI path; `TEST_MODE=devnet` (`npm run test:devnet`)
  swaps in a containerized multi-validator devnet, one container per test file.
