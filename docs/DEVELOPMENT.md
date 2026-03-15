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

| Mode        | Command                | Speed | Use Case            | Status                       |
| ----------- | ---------------------- | ----- | ------------------- | ---------------------------- |
| **Devnode** | `npm test`             | Fast  | Local iteration, CI | **Default and recommended**  |
| **Devnet**  | `DEVNET=true npm test` | Slow  | Nightly, pre-deploy | Supported full-network check |

```bash
npm test                                        # Default devnode mode (recommended)
DEVNET=true npm test                            # Full devnet mode
npm run test:select ./test/merkle_tree.test.ts  # Specific test file
USE_TEST_CONTAINERS=0 npm test                  # Manual local Aleo setup
ALEO_VERBOSITY=4 npm test                       # Verbose logging (0-4)
ALEO_TEST_IMAGE=custom/aleo:latest npm test     # Custom Docker image
```

**Note**: PR CI and local runs now default to devnode. The nightly cron workflow keeps devnet as the default full-network regression job.

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

| Variable                  | Description                                   | Default   |
| ------------------------- | --------------------------------------------- | --------- |
| `DEVNET`                  | Enable full devnet mode                       | `false`   |
| `USE_TEST_CONTAINERS`     | Use Testcontainers                            | `true`    |
| `SKIP_EXECUTE_PROOF`      | Skip ZK proofs (devnode only, Leo v3.5.0+)    | `true`    |
| `SKIP_DEPLOY_CERTIFICATE` | Skip deploy certs (devnode only, Leo v3.5.0+) | `true`    |
| `ALEO_VERBOSITY`          | Logging level (0-4)                           | `1`       |
| `CONSENSUS_CHECK_TIMEOUT` | Consensus wait timeout (ms)                   | `600000`  |
| `ALEO_TEST_IMAGE`         | Custom Docker image                           | See below |

**Default images:**

- Devnode: `ghcr.io/sealance-io/leo-lang:v3.5.0`
- Devnet: `ghcr.io/sealance-io/aleo-devnet:v3.5.0-v4.5.1`

## Common Issues

- **Container auth**: Run `docker login ghcr.io` for ghcr.io images
- **Tests too slow**: Skip flags are on by default in devnode; increase `CONSENSUS_CHECK_TIMEOUT` for CI
- **Port 3030 in use**: `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)`
- **Manual local Aleo setup**: See `docs/TESTING.md`
