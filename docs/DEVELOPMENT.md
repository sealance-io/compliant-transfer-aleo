# Development Guide

Commands and workflows for developing in this repository.

## Dependencies & Setup

```bash
# Install from repository root (uses npm workspaces)
npm ci --ignore-scripts

# Install doko-js CLI (required for compiling Leo programs)
npm install -g @sealance-io/dokojs@1.0.1 --ignore-scripts
```

**Critical**: Uses npm workspaces with a single root `package-lock.json`. Never run `npm install` in workspace directories (`packages/*/`).

## Building

```bash
# Compile all Leo programs (output to /artifacts)
dokojs compile
# or: npm run compile

# Build SDK only
npm run build --workspace=@sealance-io/policy-engine-aleo
```

## Testing

| Mode        | Command                | Speed | Use Case                    |
| ----------- | ---------------------- | ----- | --------------------------- |
| **Devnode** | `npm test`             | Fast  | Local development (default) |
| **Devnet**  | `DEVNET=true npm test` | Slow  | Pre-deployment, CI          |

```bash
npm test                                      # Fast devnode mode (default)
npm run test:select ./test/merkle_tree.test.ts  # Specific test file
DEVNET=true npm test                          # Full devnet (slower)
USE_TEST_CONTAINERS=0 npm test                # Manual devnet setup
ALEO_VERBOSITY=4 npm test                     # Verbose logging (0-4)
ALEO_TEST_IMAGE=custom/aleo:latest npm test   # Custom Docker image
```

**Note**: Devnode is experimental, requires Leo from `feat/leo-devnode-final` branch or `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`. For stable testing, use `DEVNET=true`.

## SDK Development

```bash
npm run test --workspace=@sealance-io/policy-engine-aleo        # SDK tests
npm run test:watch --workspace=@sealance-io/policy-engine-aleo  # Watch mode
npm run format:fix --workspace=@sealance-io/policy-engine-aleo  # Format
```

## SDK Releasing

Uses [Changesets](https://github.com/changesets/changesets) for version management.

```bash
npx changeset   # Add changeset when making SDK changes
npm run version # Preview version bumps (dry-run)
```

## Deployment

```bash
npm run deploy:devnet               # Deploy to devnet
npm run deploy:testnet              # Deploy to testnet
npm run update-freeze-list:devnet   # Update freeze list on devnet
npm run update-freeze-list:testnet  # Update freeze list on testnet
```

## Code Formatting

```bash
npm run format      # Check formatting
npm run format:fix  # Auto-fix formatting
npm run lint:licenses  # Check for GPL/AGPL licenses (blocked)
```

## Adding Dependencies

```bash
npm install <package>                                          # Root workspace
npm install --workspace=@sealance-io/policy-engine-aleo <pkg>  # SDK workspace
```

## Environment Variables

| Variable                  | Description                 | Default   |
| ------------------------- | --------------------------- | --------- |
| `DEVNET`                  | Enable full devnet mode     | `false`   |
| `USE_TEST_CONTAINERS`     | Use Testcontainers          | `true`    |
| `SKIP_EXECUTE_PROOF`      | Skip ZK proofs in devnode   | -         |
| `ALEO_VERBOSITY`          | Logging level (0-4)         | `0`       |
| `CONSENSUS_CHECK_TIMEOUT` | Consensus wait timeout (ms) | -         |
| `ALEO_TEST_IMAGE`         | Custom Docker image         | See below |

**Default images:**

- Devnode: `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`
- Devnet: `ghcr.io/sealance-io/aleo-devnet:v3.4.0-v4.4.0`

## Common Issues

- **Container auth**: Run `docker login ghcr.io` for ghcr.io images
- **Tests too slow**: Use devnode mode with `SKIP_EXECUTE_PROOF=true`; increase `CONSENSUS_CHECK_TIMEOUT` for CI
- **Port 3030 in use**: `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)`
- **Manual devnet**: See `docs/TESTING.md`
