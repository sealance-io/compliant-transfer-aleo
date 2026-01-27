# sealance-io/compliant-transfer-aleo AI Agent Guide

> Last Updated: 2026-01-26

AI agent instructions for this repository. See detailed docs for specific topics.

## Repository Overview

Monorepo for compliant token transfers on Aleo blockchain. Leo programs (smart contracts) + TypeScript SDK for Merkle proofs and compliance policies.

**Components:**

- **Leo Programs** (`/programs`): Compliance policy smart contracts
- **Policy Engine SDK** (`/packages/policy-engine-sdk`): Published as `@sealance-io/policy-engine-aleo`
- **Test Suite** (`/test`): Testcontainers + leo devnet
- **Shared Libraries** (`/lib`): Freeze lists, tokens, deployment, roles, funding
- **Deployment Scripts** (`/scripts`): Devnet/testnet deployment and configuration

## Quick Reference

```bash
# Setup
npm ci --ignore-scripts
npm install -g @sealance-io/dokojs@1.0.1 --ignore-scripts

# Build
dokojs compile              # Compile Leo programs
npm run build --workspace=@sealance-io/policy-engine-aleo  # SDK only

# Test
DEVNET=true npm test        # Full devnet mode (default, stable)
npm test                    # Fast devnode mode (experimental)
npm run test:select ./test/merkle_tree.test.ts  # Specific test

# Deploy
npm run deploy:devnet       # Deploy to devnet
npm run deploy:testnet      # Deploy to testnet

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
| `/scripts/`                    | Deployment scripts     |
| `/docs/`                       | Detailed documentation |

## Key Libraries (`/lib`)

| Module          | Purpose                                         |
| --------------- | ----------------------------------------------- |
| `FreezeList.ts` | Merkle tree operations                          |
| `Deploy.ts`     | `deployIfNotDeployed()` utility                 |
| `Fund.ts`       | Credit funding for test accounts                |
| `Token.ts`      | Token operation utilities                       |
| `Role.ts`       | Role management utilities                       |
| `Constants.ts`  | `MAX_TREE_DEPTH`, `ZERO_ADDRESS`, etc.          |
| `Block.ts`      | Block height queries, `waitBlocks()` utility    |
| `Initalize.ts`  | `isProgramInitialized()`, `initializeProgram()` |
| `Multisig.ts`   | Multisig wallet creation and approval           |
| `Upgrade.ts`    | Program upgrade and checksum verification       |

## Critical Constraints

1. **Node Version**: Requires Node >= 20.0.0 (see `.nvmrc`)
2. **Leo Version**: Developed with Leo CLI v3.4.0
3. **Workspace Rules**: Always install packages from repository root, never in subdirectories
4. **Sequential Testing**: Integration/devnet tests MUST run sequentially (shared devnet state)
5. **npm Security**: Always use `--ignore-scripts` for installs (`npm ci`, `npm install`); build/publish workflows may run scripts as needed
6. **Dokojs Patches**: `@doko-js/*` blocked in dependabot - verify against `/patches` before updating

## CI/CD Status Checks

Required for branch protection:

- `CI Status` (on-pull-request-main.yml)
- `SDK Status` (on-pull-request-main-sdk.yml)
- `Nightly Status`, `Security Audit Status`, `Release Status`

## Documentation

Load the linked file(s) when your task touches that area. Do not assume links are auto-loaded.

- **Build, deploy, devnet, release, or setup:** `docs/DEVELOPMENT.md` - commands, SDK development, deployment
- **Testing or CI failures:** `docs/TESTING.md` - manual devnet setup, test configuration
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

| Issue            | Solution                                                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| Container auth   | `docker login ghcr.io`                                                       |
| Tests too slow   | Use experimental devnode mode: `npm test` with `SKIP_EXECUTE_PROOF=true`     |
| Port 3030 in use | `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)` |
| Manual devnet    | See `docs/TESTING.md`                                                        |
