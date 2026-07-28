# sealance-io/compliant-transfer-aleo AI Agent Guide

> Last Updated: 2026-05-28

AI agent instructions for this repository. See detailed docs for specific topics.

## Repository Overview

Monorepo for compliant token transfers on Aleo blockchain. Leo programs (smart contracts) + TypeScript SDK for Merkle proofs and compliance policies.

**Components:**

- **Leo Programs** (`/programs`): Compliance policy smart contracts
- **Policy Engine SDK** (`/packages/policy-engine-sdk`): Published as `@sealance-io/policy-engine-aleo`
- **Test Suite** (`/test`): LionDen-managed `leo devnode` integration tests
- **Shared Libraries** (`/lib`): Freeze lists, tokens, deployment, roles, funding
- **Deployment Recipes** (`/recipes`): Devnode/testnet deployment and upgrades

## Quick Reference

```bash
# Setup
npm run lint:lockfile
npm ci --ignore-scripts --allow-git=none

# Build
npm run compile              # Compile Leo programs with LionDen
npm run build --workspace=@sealance-io/policy-engine-aleo  # SDK only

# Test
npm test                    # Default devnode mode (recommended)
npm test test/merkle_tree.test.ts  # Specific test
npm test --grep "mint"      # Filter tests by name
npm test --no-compile       # Reuse existing artifacts/typechain
npm test --prove            # Generate proofs during execution

# Deploy
npm run deploy:devnode      # Deploy to local devnode
npm run deploy:testnet      # Deploy to testnet

# Upgrade
lionden recipe --file recipes/upgrade.ts --network devnode --program <program-name>
# Example: lionden recipe --file recipes/upgrade.ts --network devnode --program merkle_tree

# Format
npm run format:fix          # Auto-fix formatting
```

## File Locations

| Path                           | Contents               |
| ------------------------------ | ---------------------- |
| `/programs/**/*.leo`           | Leo programs           |
| `/packages/policy-engine-sdk/` | SDK source and docs    |
| `/test/*.test.ts`              | Integration tests      |
| `/lib/`                        | Shared utilities       |
| `/artifacts/`                  | Compiled output        |
| `/recipes/`                    | Deployment recipes     |
| `/scripts/`                    | Utility scripts        |
| `/docs/`                       | Detailed documentation |

## Key Libraries (`/lib`)

| Module               | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `Block.ts`           | Block height queries, `waitBlocks()` utility |
| `Constants.ts`       | Shared constants, policy metadata, roles     |
| `Fund.ts`            | Credit funding for test accounts             |
| `LiondenAdapters.ts` | Type and signer adapters for LionDen calls   |
| `Multisig.ts`        | Multisig wallet creation and approval        |
| `Token.ts`           | Token operation utilities                    |
| `Upgrade.ts`         | Program upgrade and checksum verification    |

## Critical Constraints

1. **Node Version**: Use Node 20.19.0+ on the 20.x line, or Node 22.12.0+; the repo default in `.nvmrc` is `v24`
2. **Leo Version**: Developed with Leo CLI v4.3.2
3. **Workspace Rules**: Always install packages from repository root, never in subdirectories
4. **Sequential Testing**: Integration tests MUST run sequentially (shared chain state in devnode/testnet)
5. **npm Security**: Always use `--ignore-scripts` for installs; use `--allow-git=none` with `npm ci`. Build/publish workflows may run scripts as needed
6. **LionDen Dependencies**: `@lionden/*` packages are installed from npm and pinned exactly; update them intentionally as a group
7. **Program Upgrades**: Use `lionden recipe --file recipes/upgrade.ts --network <network> --program <program-name>` where the program name comes from `/programs` without the `.aleo` suffix

## CI/CD Status Checks

Required for branch protection:

- `CI Status` (on-pull-request-main.yml)
- `SDK Status` (on-pull-request-main-sdk.yml)
- `Nightly Status`, `Security Audit Status`, `Release Status`

## Documentation

Load the linked file(s) when your task touches that area. Do not assume links are auto-loaded.

- **Build, deploy, upgrade, release, or setup:** `docs/DEVELOPMENT.md` - commands, SDK development, deployment, upgrades
- **Testing or CI failures:** `docs/TESTING.md` - manual local Aleo setup, test configuration
- **npm install, security policy, or dependency updates:** `docs/NPM-SECURITY.md` - security model and practices
- **Program structure or compliance flow:** `docs/ARCHITECTURE.md` - Leo programs, dependencies, compliance system
- **Leo/Aleo language patterns:** `docs/LEO-ALEO-PATTERNS.md` - execution model, limitations, dual-auth patterns, upgradability
- **Patterns for Leo contracts or tests:** `docs/CODE-PATTERNS.md` - contract interaction, freeze lists, test structure
- **SDK development tasks:** `packages/policy-engine-sdk/AGENTS.md` - SDK agent guide
- **SDK usage or API questions:** `packages/policy-engine-sdk/README.md` (quick start) and `packages/policy-engine-sdk/API.md` (API reference)
- **Security workflows or Dependabot:** `docs/SECURITY-WORKFLOWS.md` (GitHub Actions) and `docs/DEPENDABOT-STRATEGY.md` (update policies)

## Audits

[Sealance Compliance Technology for Aleo](./audits/veridise_09:2025.pdf) by [Veridise](https://veridise.com/) - 09/2025

## Common Issues

| Issue                   | Solution                                                    |
| ----------------------- | ----------------------------------------------------------- |
| Leo CLI missing         | Install a Leo CLI compatible with `lionden.config.ts`       |
| Tests too slow          | Keep proofs disabled; use `npm test --prove` only as needed |
| Port 3030 in use        | Stop the process currently listening on port 3030           |
| Manual local Aleo setup | See `docs/TESTING.md`                                       |

## Testing Preferences

- Prefer `npm test` for root integration tests so LionDen manages compile, typechain, and devnode lifecycle.
- Use `npm test --no-compile` only when intentionally reusing existing artifacts/typechain.
