# Testing Configuration Guide

This guide explains how to configure the testing environment for the compliant-transfer-aleo project.

## Overview

The project supports two distinct testing modes optimized for different use cases:

| Mode        | Use Case                           | Speed   | Realism | Command       | Status       |
| ----------- | ---------------------------------- | ------- | ------- | ------------- | ------------ |
| **Devnet**  | Pre-deployment validation, CI      | 🐌 Slow | High    | `DEVNET=true` | **Stable**   |
| **Devnode** | Local development, rapid iteration | ⚡ Fast | Basic   | Default       | Experimental |

> **Important: Devnode is Experimental**
>
> The `devnode` feature is **not yet included in Leo v3.4.0**. It relies on a feature branch that has not been merged to the main Leo repository. For production-like testing and CI, always use **devnet mode** (`DEVNET=true`).
>
> To use devnode locally, you must either:
>
> 1. **Install Leo from feature branch:**
>
>    ```bash
>    git clone https://github.com/ProvableHQ/leo.git
>    cd leo
>    git checkout feat/leo-devnode-final
>    cargo install --path .
>    ```
>
> 2. **Use the pre-built devnode image** (recommended for Testcontainers):
>    `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`

## Quick Start

### For Local Development (Recommended)

```bash
# Copy the recommended config
cp .env.testing .env

# Run tests with fast mode (default)
npm test
```

The default configuration in `.env.testing` uses **devnode with proof skipping** for maximum speed during development.

### For Comprehensive Testing

```bash
# Edit .env and uncomment the devnet configuration
# DEVNET=true
# CONSENSUS_VERSION=12

npm test
```

## Configuration Modes

### Mode 1: Fast Development (Default) ⚡

**Best for:** Daily development, quick feedback loops

```bash
CONSENSUS_VERSION=12
SKIP_EXECUTE_PROOF=true
SKIP_DEPLOY_CERTIFICATE=true
```

**What it does:**

- Runs a single devnode (not full network)
- Skips ZK proof generation (much faster transactions)
- Skips deployment certificate generation
- Advances blocks automatically for testing

**Performance:** Transactions complete in seconds instead of minutes

**Trade-offs:** Not a realistic simulation of mainnet/testnet behavior

---

### Mode 2: Full Devnet 🔬

**Best for:** Final validation before deployment, CI pipelines

```bash
DEVNET=true
CONSENSUS_VERSION=12
```

**What it does:**

- Runs full devnet with multiple validators
- Performs complete consensus simulation
- Generates real ZK proofs
- Creates deployment certificates

**Performance:** Slow but realistic (minutes per transaction)

**Trade-offs:** Significantly slower, resource-intensive

---

### Mode 3: Custom Consensus Heights (Advanced) 🎛️

**Best for:** Testing consensus version transitions, advanced scenarios

```bash
DEVNET=true
CONSENSUS_VERSION=12
CONSENSUS_VERSION_HEIGHTS=0,1,2,3,4,5,6,7,8,9,10,11
```

**What it does:**

- Same as Mode 2 but with explicit control over consensus version at each block height
- Useful for testing behavior across consensus version upgrades

**Use when:** You need to simulate specific consensus version transitions

## Environment Variables Reference

### Core Configuration

| Variable                  | Default | Description                                           |
| ------------------------- | ------- | ----------------------------------------------------- |
| `DEVNET`                  | `false` | Enable full devnet mode (vs. single devnode)          |
| `CONSENSUS_VERSION`       | `12`    | Target consensus version to wait for                  |
| `SKIP_EXECUTE_PROOF`      | `false` | Skip ZK proof generation (devnode only)               |
| `SKIP_DEPLOY_CERTIFICATE` | `false` | Skip deployment certificate generation (devnode only) |

### Container Configuration

| Variable              | Default   | Description                                   |
| --------------------- | --------- | --------------------------------------------- |
| `USE_TEST_CONTAINERS` | `true`    | Use Testcontainers for automated devnet setup |
| `ALEO_TEST_IMAGE`     | See below | Docker image for devnet/devnode               |

**Default Images:**

- Devnode: `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`
- Devnet: `ghcr.io/sealance-io/aleo-devnet:v3.4.0-v4.4.0`

### Network Configuration

| Variable           | Default    | Description                                                           |
| ------------------ | ---------- | --------------------------------------------------------------------- |
| `ALEO_PRIVATE_KEY` | Required\* | Private key for devnode operations (\*only required for devnode mode) |
| `FIRST_BLOCK`      | `20`       | Initial block advancement (devnode only)                              |
| `CONSENSUS_HEIGHT` | -          | Custom consensus height configuration (devnet only)                   |

### Consensus Monitoring

| Variable                    | Default  | Description                               |
| --------------------------- | -------- | ----------------------------------------- |
| `CONSENSUS_CHECK_TIMEOUT`   | `300000` | Max wait time for consensus (ms)          |
| `CONSENSUS_CHECK_INTERVAL`  | `5000`   | Check interval for consensus (ms)         |
| `CONSENSUS_VERSION_HEIGHTS` | -        | Custom consensus version per block height |

### Logging

| Variable         | Default | Description                           |
| ---------------- | ------- | ------------------------------------- |
| `ALEO_VERBOSITY` | `1`     | Log verbosity: 0 (quiet) to 4 (debug) |

Examples:

```bash
SKIP_EXECUTE_PROOF=true
SKIP_EXECUTE_PROOF=yes
SKIP_EXECUTE_PROOF=1
# All equivalent
```

## Common Workflows

### Local Development Workflow

```bash
# 1. Use fast mode for development
npm test

# 2. Run specific test
npm run test:select ./test/your-test.test.ts

# 3. Before committing, validate with devnet
# Edit .env: DEVNET=true
npm test
```

### Debugging Failed Tests

```bash
# Enable verbose logging
ALEO_VERBOSITY=4 npm test

# Disable testcontainers to inspect manually
USE_TEST_CONTAINERS=0 npm test
# Then in another terminal: manually run devnode
```

### CI/CD Configuration

```yaml
# GitHub Actions example
env:
  DEVNET: true
  CONSENSUS_VERSION: 12
  ALEO_VERBOSITY: 2
  CONSENSUS_CHECK_TIMEOUT: 600000 # 10 minutes for slower CI
```

## Manual Devnet Setup (Without Testcontainers)

If you need to run devnet manually:

```bash
# 1. Disable testcontainers
export USE_TEST_CONTAINERS=0

# 2. Start devnode manually in another terminal
docker run -p 3030:3030 ghcr.io/sealance-io/leo-lang:v3.4.0-devnode \
  leo devnode start --listener-addr 0.0.0.0:3030 \
  --private-key "$ALEO_PRIVATE_KEY" \
  --verbosity 1

# 3. Run tests
npm test
```

## Troubleshooting

### Tests Timeout Waiting for Consensus

**Symptom:** "Timeout waiting for consensus version >= 12"

**Solutions:**

1. Increase timeout: `CONSENSUS_CHECK_TIMEOUT=600000 npm test`
2. Check Docker logs: `docker logs <container-id>`
3. Verify `ALEO_PRIVATE_KEY` is set correctly
4. Try increasing verbosity: `ALEO_VERBOSITY=4 npm test`

### Container Authentication Errors

**Symptom:** "Error: unauthorized: authentication required"

**Solution:**

```bash
docker login ghcr.io
# Use GitHub personal access token with read:packages scope
```

### Tests Are Too Slow

**Symptom:** Each test takes several minutes

**Solution:** Switch to fast development mode:

```bash
# Edit .env
SKIP_EXECUTE_PROOF=true
SKIP_DEPLOY_CERTIFICATE=true
# Remove or comment out: DEVNET=true
```

### Port 3030 Already in Use

**Symptom:** "Cannot start container: port 3030 already in use"

**Solutions:**

1. Stop existing devnet: `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)`
2. Find and kill process: `lsof -ti:3030 | xargs kill`

## Architecture Notes

### How Modes Work

The testing infrastructure uses Testcontainers to automatically provision and manage containerized Aleo networks:

**Devnode Mode:**

1. Starts single Leo devnode container
2. Advances 20 blocks immediately
3. Waits for consensus version 12
4. Runs tests sequentially
5. Tears down container

**Devnet Mode:**

1. Starts full devnet with validator network
2. Waits for network consensus
3. Waits for consensus version 12
4. Runs tests sequentially
5. Tears down network

### Why Sequential Testing?

Tests run **sequentially** (no parallelism) because:

- All tests share the same devnet instance
- Blockchain state is cumulative
- Parallel execution would cause race conditions

See `vitest.config.ts` for test execution configuration.

## Best Practices

1. **Use devnet for CI** - CI should always use `DEVNET=true` for stable, production-like testing
2. **Devnode for local development only** - Use devnode (without `DEVNET=true`) for fast iteration, but remember it's experimental
3. **Set realistic timeouts in CI** - CI is slower; use longer timeouts
4. **Don't commit .env** - Keep `.env` in `.gitignore`, use `.env.testing` as template
5. **Monitor verbosity** - Use `ALEO_VERBOSITY=2` for CI, `4` for debugging
6. **Clean Docker regularly** - Old containers/images can consume disk space

## Deployment Scripts Warning

> **CRITICAL: Never use devnode/devnet modes for public network deployments**
>
> The `devnode` and `devnet` modes are **testing environments only**. When deploying to public networks:
>
> - **Testnet**: Use `npm run deploy:testnet` with proper testnet endpoint
> - **Mainnet**: Use appropriate mainnet deployment scripts with production endpoints
>
> Deployment scripts (`scripts/deploy-testnet.ts`, `scripts/deploy-devnet.ts`) use `ExecutionMode.SnarkExecute` which generates real ZK proofs. Ensure your `.env` configuration points to the correct public network endpoint:
>
> ```bash
> # For testnet deployment (NOT devnet testing)
> TESTNET_ENDPOINT=https://api.explorer.aleo.org/v1
>
> # For mainnet deployment
> # Configure mainnet endpoint in aleo-config.js
> ```
>
> The `devnet` testing mode (using Testcontainers) is for **local testing only** and should never be confused with deploying to the public Aleo testnet.

## Further Reading

- [Testcontainers Documentation](https://testcontainers.com/)
- [Leo CLI Documentation](https://developer.aleo.org/leo)
- [Project README](../README.md) for overall architecture
- [Doko Installation Guide](./doko-installation-guide.md)
