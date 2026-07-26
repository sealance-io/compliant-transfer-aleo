# Compliant Transfer - Aleo Projects

[![Nightly](https://img.shields.io/github/actions/workflow/status/sealance-io/compliant-transfer-aleo/nightly-tests.yml?label=Nightly)](https://github.com/sealance-io/compliant-transfer-aleo/actions/workflows/nightly-tests.yml)
[![SDK](https://img.shields.io/npm/v/@sealance-io/policy-engine-aleo.svg?label=SDK)](https://www.npmjs.com/package/@sealance-io/policy-engine-aleo)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Audited by Veridise](https://img.shields.io/badge/Audited%20by-Veridise-green.svg)](./audits/veridise_09:2025.pdf)

This repository contains programs (smart contracts), tests, and auxiliary scripts for implementing compliant token transfers on the Aleo blockchain.

## Compatibility

This project is developed and tested with the following tooling:

- [Leo](https://github.com/ProvableHQ/leo) CLI v4.3.2

- [LionDen](./lionden.config.ts) Aleo development framework for compiling programs, generating TypeScript bindings, deployment, and testing

## Audits

- [Sealance Compliance Technology for Aleo](./audits/veridise_09:2025.pdf) by [Veridise](https://veridise.com/) conducted at 09/2025.

## Repository Structure

This repository uses [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) to manage the monorepo structure.

- **/packages/policy-engine-sdk**: TypeScript SDK for generating Merkle proofs and interacting with Aleo compliance policy programs (published as `@sealance-io/policy-engine-aleo`)
- **/programs**: Aleo programs implementing various compliance policies (see below)
- **/artifacts**: Compiled artifacts and JS bindings for interacting with contracts
- **/test**: TypeScript tests that validate contract functionalities
- **/lib**: Shared TypeScript utility libraries
- **/recipes**: LionDen deployment and upgrade recipes
- **/scripts**: Utility scripts
- **/docs**: Additional documentation (testing, security)
- **/imports**: Shared Aleo modules (e.g., credits.aleo)

### Programs

**Core** (`/programs/core`)

- `merkle_tree.leo` - Functions for verifying Merkle proofs (inclusion and non-inclusion)

**Freeze List Registry** (`/programs/freezelist_registry`)

- `sealance_freezelist_registry.leo` - Standalone freeze list registry with role-based access control for adding/removing addresses and privately verifying address status
- `multisig_freezelist_registry.leo` - Multi-signature variant with multisig manager for privileged operations

**Compliance Policies** (`/programs/policy`)

- `sealed_report_policy.leo` - Grants issuers access to transaction details; both sender and recipient must not be on the sanctions list
- `sealed_threshold_report_policy.leo` - Reports transactions when daily spent amount exceeds 1000; sanctions compliance for both parties
- `sealed_timelock_policy.leo` - Allows senders to lock funds for a specified period; sanctions compliance for both parties

**Tokens** (`/programs/token`)

- `compliant_token_template.leo` - Template token program granting issuers access to transaction details; sender must not be sanctioned
- `sealed_report_token.leo` - Self-contained token managing its own supply and balances without relying on `token_registry.aleo`; sanctions compliance for both parties
- `multisig_compliant_token.leo` - Compliant token with multisig manager for privileged operations

**Proxies** (`/programs/proxy`)

- `multisig_token_proxy.leo` - Proxy enabling multisig control of non-multisig compliant tokens
- `multisig_freezelist_proxy.leo` - Proxy enabling multisig control of non-multisig freeze registries

**Demo** (`/programs/demo`)

- `gqrfmwbtyp.leo` - Enables exchange of native Aleo tokens for compliant tokens

**Vendor** (`/programs/vendor`)

- `token_registry.leo` - Shared token registry used by some policies
- `multisig_core.leo` - Core multi-signature functionality

## Getting Started

1. **Install Dependencies**

   **IMPORTANT**: Always install from the repository root. The repository uses npm workspaces with a single root `package-lock.json` that manages all dependencies.

   ```bash
   # Navigate to repository root
   cd compliant-transfer-aleo

   # Validate lockfile and install all dependencies
   npm run lint:lockfile
   npm ci --ignore-scripts --allow-git=none
   ```

   **Note**: Do not run `npm install` in workspace directories (`packages/*/`). The root workspace manages all dependencies and ensures consistent versions across packages.

2. **Build the Contracts**
   ```bash
   npm run compile
   ```

## Deployment and Upgrades

Use the root LionDen config when running deployment or upgrade recipes.

```bash
# Deploy all configured programs to the local devnode
npm run deploy:devnode

# Deploy all configured programs to testnet
npm run deploy:testnet

# Upgrade one program on the local devnode
lionden recipe --file recipes/upgrade.ts --network devnode --program <program-name>

# Example: upgrade the merkle_tree program
lionden recipe --file recipes/upgrade.ts --network devnode --program merkle_tree
```

Deployments run `recipes/setup.ts` through the npm scripts. Replace `<program-name>` with the target program name from `/programs` without the `.aleo` suffix. The upgrade recipe compiles before running the upgrade.

### Workspace Commands

The repository uses npm workspaces. Common workspace operations:

```bash
# Run SDK-specific commands
npm run build --workspace=@sealance-io/policy-engine-aleo
npm run test --workspace=@sealance-io/policy-engine-aleo

# Install a dependency to the SDK workspace
npm install --workspace=@sealance-io/policy-engine-aleo <package-name>

# Run commands in all workspaces
npm run format --workspaces
```

## Testing

Tests use LionDen's managed `leo devnode` lifecycle by default.

```bash
# Run all tests (fast mode - default)
npm test

# Run specific test
npm test test/merkle_tree.test.ts

```

### Testing Modes

| Mode        | Command    | Speed          | Use Case                       | Status                      |
| ----------- | ---------- | -------------- | ------------------------------ | --------------------------- |
| **Devnode** | `npm test` | Fast (minutes) | Local development, standard CI | **Default and recommended** |

**Devnode mode** is the default path for local work and regular CI. It gives fast feedback while keeping the same sequential Vitest harness.

Use `npm test --prove` when you explicitly want proof generation during devnode tests.

**Note**: Tests run sequentially (no parallelism) as they share blockchain state.

For complete configuration reference, troubleshooting, and manual setup instructions, see [docs/TESTING.md](docs/TESTING.md).

## Contributing

Contributions are welcome. Please create pull requests with detailed descriptions and adhere to the repository's coding guidelines. For questions or discussions, open an issue on GitHub.

## License

This repository is licensed under the Apache License, Version 2.0.
See the [LICENSE](./LICENSE) file for details.
