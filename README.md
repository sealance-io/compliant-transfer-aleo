# Compliant Transfer - Aleo Projects

This repository contains programs (smart contracts), tests, and auxiliary scripts for implementing compliant token transfers on the Aleo blockchain.

## Compatibility

This project is developed and tested with the following tooling:

- [Leo](https://github.com/ProvableHQ/leo) CLI v3.3.1

- [Dokojs](https://github.com/sealance-io/sealed-token-aleo) testing framework, a custom fork with fixes that are not yet released by the [maintainers](https://github.com/venture23-aleo/doko-js)

## Repository Structure

This repository uses [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) to manage the monorepo structure.

- **/packages/policy-engine-sdk**: TypeScript SDK for generating Merkle proofs and interacting with Aleo compliance policy programs (published as `@sealance-io/policy-engine-aleo`)

- **/programs**: Aleo token programs implementing various compliance policies

  - `sealed_report_policy.leo`

    Token program that grants asset issuers access to transaction details. Both sender and recipient must not be on the sanctions list.

  - `sealed_report_token.leo`

    Token program that grants asset issuers access to transaction details. Manages its own supply and balances without relying on a `token_registry.aleo` Both sender and recipient must not be on the sanctions list.

  - `sealed_threshold_report_policy.leo`

    Token program that grants asset issuers access to transaction details when daily spent amount exceeds 1000. Both sender and recipient must not be on the sanctions list.

  - `sealed_timelock_policy.leo`

    Token program that allows senders to lock funds for a specified period. Both sender and recipient must not be on the sanctions list.

  - `sealance_freezelist_registry.leo`

    Standalone program implementing a freeze list registry with functions to add/remove addresses and privately verify address status.

  - `merkle_tree.leo`

    Program containing functions for verifying Merkle proofs for leaf inclusion and non-inclusion.

  - `gqrfmwbtyp.leo`
    Program enabling users to exchange native Aleo tokens for compliant tokens.

- **/artifacts**: Compiled artifacts and JS bindings for interacting with contracts.
- **/test**: TypeScript tests that validate contract functionalities.
- **/imports**: Shared modules and additional contracts (e.g., token_registry.aleo).

## Getting Started

1. **Install Dependencies**

   **IMPORTANT**: Always install from the repository root. The repository uses npm workspaces with a single root `package-lock.json` that manages all dependencies.

   ```bash
   # Navigate to repository root
   cd compliant-transfer-aleo

   # Install all dependencies (root + SDK workspace)
   npm ci
   ```

   **Note**: Do not run `npm install` in workspace directories (`packages/*/`). The root workspace manages all dependencies and ensures consistent versions across packages.

2. **Install doko-js CLI**
   [Jump to Installation Guide](docs/doko-installation-guide.md)

3. **Build the Contracts**
   ```bash
   dokojs compile
   ```

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

**For comprehensive testing documentation, see [docs/testing-configuration-guide.md](docs/testing-configuration-guide.md)**

### Quick Start

Tests use [Testcontainers](https://node.testcontainers.org/) to automatically provision an Aleo blockchain environment. By default, tests run in **fast development mode** using devnode with proof skipping.

```bash
# Run all tests (fast mode - default)
npm test

# Run specific test
npm run test:select ./test/merkle_tree.test.ts

# Run with verbose logging
ALEO_VERBOSITY=4 npm test
```

### Testing Modes

The project supports two testing modes optimized for different use cases:

| Mode | Command | Speed | Use Case |
|------|---------|-------|----------|
| **Devnode** (default) | `npm test` | Fast (minutes) | Local development, rapid iteration |
| **Devnet** | `DEVNET=true npm test` | Slow (30-60min) | Pre-deployment validation, CI |

**Fast mode** skips ZK proof generation for quick feedback. **Full mode** runs complete consensus simulation with real proofs.

See [.env.testing](.env.testing) for configuration templates.

### Key Configuration Options

```bash
# Fast development mode (default in .env.testing)
SKIP_PROVING=true
SKIP_DEPLOY_CERTIFICATE=true

# Full devnet mode
DEVNET=true

# Manual devnet setup (no containers)
USE_TEST_CONTAINERS=0

# Custom Docker image
ALEO_TEST_IMAGE=custom/image:latest
```

**Note**: Tests run sequentially (no parallelism) as they share blockchain state.

### Troubleshooting

**Tests timeout waiting for consensus:**
```bash
CONSENSUS_CHECK_TIMEOUT=600000 npm test
```

**Container authentication issues:**
```bash
docker login ghcr.io
```

**Tests too slow:**
Use fast mode by removing `DEVNET=true` from `.env`

For detailed troubleshooting, configuration reference, and manual setup instructions, see [docs/testing-configuration-guide.md](docs/testing-configuration-guide.md).

## Contributing

Contributions are welcome. Please create pull requests with detailed descriptions and adhere to the repository's coding guidelines.

## Audits

1. [Sealance Compliance Technology for Aleo](./audits/veridise_09:2025.pdf) by [Veridise](https://veridise.com/) conducted at 09/2025.

## License

This repository is licensed under the Apache License, Version 2.0.  
See the [LICENSE](./LICENSE) file for details.
