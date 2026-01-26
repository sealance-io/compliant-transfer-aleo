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

## Quick Reference

```bash
# Setup
npm ci --ignore-scripts
npm install -g @sealance-io/dokojs@1.0.1 --ignore-scripts

# Build
dokojs compile              # Compile Leo programs
npm run build --workspace=@sealance-io/policy-engine-aleo  # SDK only

# Test
npm test                    # Fast devnode mode (default)
DEVNET=true npm test        # Full devnet (slow)
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

| Module          | Purpose                                |
| --------------- | -------------------------------------- |
| `FreezeList.ts` | Merkle tree operations                 |
| `Deploy.ts`     | `deployIfNotDeployed()` utility        |
| `Fund.ts`       | Credit funding for test accounts       |
| `Token.ts`      | Token operation utilities              |
| `Role.ts`       | Role management utilities              |
| `Constants.ts`  | `MAX_TREE_DEPTH`, `ZERO_ADDRESS`, etc. |

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

## Documentation Index

### Development

- `docs/DEVELOPMENT.md` - Commands, testing, SDK development, deployment
- `docs/TESTING.md` - Manual devnet setup, test configuration
- `docs/NPM-SECURITY.md` - npm security model and practices

### Architecture

- `docs/ARCHITECTURE.md` - Leo programs, dependencies, compliance system
- `docs/CODE-PATTERNS.md` - Contract interaction, freeze lists, test structure

### SDK

- `packages/policy-engine-sdk/AGENTS.md` - SDK agent guide
- `packages/policy-engine-sdk/README.md` - Installation and quick start
- `packages/policy-engine-sdk/API.md` - Complete API reference

### Security & CI

- `docs/SECURITY-WORKFLOWS.md` - GitHub Actions security
- `docs/DEPENDABOT-STRATEGY.md` - Dependency update policies
- `.github/dependabot.yml` - Dependabot configuration

## Audits

[Sealance Compliance Technology for Aleo](./audits/veridise_09:2025.pdf) by [Veridise](https://veridise.com/) - 09/2025

## Common Issues

| Issue            | Solution                                                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| Container auth   | `docker login ghcr.io`                                                       |
| Tests too slow   | Use devnode mode with `SKIP_EXECUTE_PROOF=true`                              |
| Port 3030 in use | `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)` |
| Manual devnet    | See `docs/TESTING.md`                                                        |
