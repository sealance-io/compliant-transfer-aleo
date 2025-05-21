# Compliant Transfer - Aleo Projects

This repository contains programs (smart contracts), tests, and auxiliary scripts for implementing compliant token transfers on the Aleo blockchain.

## Compatibility

This project is developed and tested with the following tooling:

- [Leo](https://github.com/ProvableHQ/leo) CLI v2.5.0

- [Amareleo](https://github.com/kaxxa123/amareleo-chain) Aleo chain instances v2.3.0,

- [Dokojs](https://github.com/sealance-io/sealed-token-aleo) testing framework, a custom fork with fixes that are not yet released by the [maintainers](https://github.com/venture23-aleo/doko-js)

## Repository Structure

- **/programs**: Aleo token programs implementing various compliance policies

  - `sealed_report_policy.leo`

    Token program that grants asset issuers access to transaction details. Both sender and recipient must not be on the sanctions list.

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
   Navigate to the repository root and run:

   ```bash
   npm ci
   ```

2. **Install doko-js CLI**
   [Jump to Installation Guide](docs/doko-installation-guide.md)

3. **Build the Contracts**
   ```bash
   dokojs compile
   ```

## Testing

This project uses automated testing with infrastructure components that simulate a local Aleo blockchain environment.

### Default Testing Approach

Tests use [Testcontainers](https://node.testcontainers.org/) to automatically spin up a local Aleo devnet using [Amareleo](https://amareleo.com/) light nodes. This approach requires no manual setup and provides a consistent testing environment across different machines.

#### Running Tests

```bash
# Run all tests
npm test

# Run specific tests
npm run test:select ./test/merkle_tree.test.ts
```

#### Customizing Container Behavior

You can customize the Amareleo container with environment variables:

```bash
# Use a custom Amareleo image
AMARELEO_IMAGE=custom/amareleo:latest npm test

# Set verbosity level (0-4, default is 1)
AMARELEO_VERBOSITY=2 npm test
```

**Note:** The Amareleo container does not persist blockchain state by default, and the same chain is reused across all tests.

#### Container Runtime Support

Both Docker and Podman are supported as container runtimes. For troubleshooting container-related issues, refer to:

- [Supported Container Runtimes](https://node.testcontainers.org/supported-container-runtimes/)
- [Configuration Options](https://node.testcontainers.org/configuration/)

### Alternative Testing Methods

#### Option 1: Running Tests Without Containers

You can disable testcontainers and use your own manually-started infrastructure:

```bash
# Disable testcontainers
USE_TEST_CONTAINERS=false npm test
```

When disabling containers, you'll need to run Amareleo manually outside the test environment.
For instructions, refer to the [Amareleo repository](https://github.com/kaxxa123/amareleo-chain).

#### Option 2: Using Aleo's Full Devnet (Not Recommended)

A slower and more cumbersome option is to use Aleo's `devnet.sh` script:

1. **Run devnet**

   ```bash
   ./devnet.sh
   ```

   (Following instructions from [snarkOS](https://github.com/ProvableHQ/snarkOS/blob/staging/devnet.sh))

2. **Run tests**
   ```bash
   npm test
   ```

This approach is not recommended for regular development as it's significantly slower and requires more system resources than the containerized Amareleo approach.

### Troubleshooting

If you encounter issues with the containerized tests:

1. Ensure Docker/Podman is running and properly configured
2. For macOS and/or podman make sure to refer to [Supported Container Runtimes](https://node.testcontainers.org/supported-container-runtimes/)
3. Check container runtime logs for errors
4. Try increasing Testcontainers verbosity using `DEBUG=testcontainers*` (refer to [Testcontainers configuration](https://node.testcontainers.org/configuration/))
5. If on Linux, ensure your user has permissions to access the container runtime
6. On macOS, ensure Docker Desktop or podman-machine is running with sufficient resources allocated
7. Try increasing Amareleo node's verbosity with `AMARELEO_VERBOSITY=4`

#### Container Registry Authentication

If you're using an image from a container registry that requires authentication (such as GitHub Container Registry - ghcr.io) and experience authentication issues:

1. Run `docker login` or `podman login` in the same terminal session you'll use to run tests
2. Explicitly pull the target Amareleo image before running tests:

   ```bash
   # For Docker
   docker pull ghcr.io/sealance-io/amareleo-chain:latest

   # For Podman
   podman pull ghcr.io/sealance-io/amareleo-chain:latest
   ```

This can help resolve authentication timeouts or permission issues that might occur when Testcontainers attempts to pull images automatically.

For container-specific issues, refer to the [Testcontainers documentation](https://node.testcontainers.org/).

### CI Test Workflows

- **Manual Triggering Only**: Tests are computationally intensive and can take significant time to complete. To conserve CI resources, automatic triggers on pull requests have been disabled. All test runs must be manually initiated.

## Contributing

Contributions are welcome. Please create pull requests with detailed descriptions and adhere to the repository's coding guidelines.

## License

This repository is licensed under the Apache License, Version 2.0.  
See the [LICENSE](./LICENSE) file for details.
