# Testing Configuration

## Testing Modes

| Mode        | Command           | Speed | Use Case            | Status                       |
| ----------- | ----------------- | ----- | ------------------- | ---------------------------- |
| **Devnode** | Default (no flag) | Fast  | Local iteration, CI | **Default and recommended**  |
| **Devnet**  | `DEVNET=true`     | Slow  | Nightly, pre-deploy | Supported full-network check |

> `npm test` now uses `devnode` by default. Use `DEVNET=true` when you specifically want the slower full-network path.

## Quick Start

```bash
cp .env.example .env
npm test                    # Default devnode mode (recommended)
DEVNET=true npm test        # Full devnet mode
npm run test:select ./test/your-test.test.ts  # Single test
```

## Environment Variables

### Core

| Variable                  | Default | Description                                                            |
| ------------------------- | ------- | ---------------------------------------------------------------------- |
| `DEVNET`                  | `false` | Enable full devnet mode                                                |
| `SKIP_EXECUTE_PROOF`      | `true`  | Skip ZK proofs (devnode only, Leo v3.5.0+). Set `false` to opt out.    |
| `SKIP_DEPLOY_CERTIFICATE` | `true`  | Skip deploy certs (devnode only, Leo v3.5.0+). Set `false` to opt out. |

### Container

| Variable              | Default | Description           |
| --------------------- | ------- | --------------------- |
| `USE_TEST_CONTAINERS` | `true`  | Use Testcontainers    |
| `ALEO_TEST_IMAGE`     | Auto    | Docker image override |

Default images: Devnode `ghcr.io/sealance-io/leo-lang:v3.5.0`, Devnet `ghcr.io/sealance-io/aleo-devnet:v3.5.0-v4.5.1`

### Timing & Logging

| Variable                  | Default  | Description                       |
| ------------------------- | -------- | --------------------------------- |
| `CONSENSUS_CHECK_TIMEOUT` | `600000` | Max wait for consensus (ms)       |
| `ALEO_VERBOSITY`          | `1`      | Log level: 0 (quiet) to 4 (debug) |

## Manual Setup (Without Testcontainers)

```bash
export USE_TEST_CONTAINERS=0

# In another terminal:
docker run -p 3030:3030 ghcr.io/sealance-io/leo-lang:v3.5.0 \
  leo devnode start --listener-addr 0.0.0.0:3030 \
  --private-key "$ALEO_PRIVATE_KEY" --verbosity 1

npm test
```

## Troubleshooting

| Issue                | Solution                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| Consensus timeout    | `CONSENSUS_CHECK_TIMEOUT=600000 npm test`                                          |
| Container auth error | `docker login ghcr.io` (use PAT with `read:packages`)                              |
| Tests too slow       | Skip flags are on by default in devnode; increase `CONSENSUS_CHECK_TIMEOUT` for CI |
| Port 3030 in use     | `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)`       |

## Notes

- Tests run **sequentially** (shared blockchain state)
- `devnode` is the default locally and in standard CI runs; nightly CI keeps `devnet` as the default full-network coverage job
- Devnode/devnet are for **local testing only** - use `npm run deploy:testnet` for public networks
