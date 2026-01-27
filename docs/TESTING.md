# Testing Configuration

## Testing Modes

| Mode        | Command           | Speed | Use Case              | Status                        |
| ----------- | ----------------- | ----- | --------------------- | ----------------------------- |
| **Devnet**  | `DEVNET=true`     | Slow  | CI, pre-deployment    | **Current default (stable)**  |
| **Devnode** | Default (no flag) | Fast  | Local rapid iteration | Experimental (future default) |

> **Devnet is currently the recommended mode** for stable testing. Devnode is experimental and will become the default in a future release when stable. Devnode requires Leo from `feat/leo-devnode-final` branch or the image `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`.

## Quick Start

```bash
cp .env.example .env
DEVNET=true npm test        # Full devnet mode (stable, recommended)
npm test                    # Fast devnode mode (experimental)
npm run test:select ./test/your-test.test.ts  # Single test
```

## Environment Variables

### Core

| Variable                  | Default | Description                             |
| ------------------------- | ------- | --------------------------------------- |
| `DEVNET`                  | `false` | Enable full devnet mode                 |
| `SKIP_EXECUTE_PROOF`      | `false` | Skip ZK proofs (devnode only)           |
| `SKIP_DEPLOY_CERTIFICATE` | `false` | Skip deploy certificates (devnode only) |

### Container

| Variable              | Default | Description           |
| --------------------- | ------- | --------------------- |
| `USE_TEST_CONTAINERS` | `true`  | Use Testcontainers    |
| `ALEO_TEST_IMAGE`     | Auto    | Docker image override |

Default images: Devnode `ghcr.io/sealance-io/leo-lang:v3.4.0-devnode`, Devnet `ghcr.io/sealance-io/aleo-devnet:v3.4.0-v4.4.0`

### Timing & Logging

| Variable                  | Default  | Description                       |
| ------------------------- | -------- | --------------------------------- |
| `CONSENSUS_CHECK_TIMEOUT` | `300000` | Max wait for consensus (ms)       |
| `ALEO_VERBOSITY`          | `1`      | Log level: 0 (quiet) to 4 (debug) |

## Manual Setup (Without Testcontainers)

```bash
export USE_TEST_CONTAINERS=0

# In another terminal:
docker run -p 3030:3030 ghcr.io/sealance-io/leo-lang:v3.4.0-devnode \
  leo devnode start --listener-addr 0.0.0.0:3030 \
  --private-key "$ALEO_PRIVATE_KEY" --verbosity 1

npm test
```

## Troubleshooting

| Issue                | Solution                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| Consensus timeout    | `CONSENSUS_CHECK_TIMEOUT=600000 npm test`                                    |
| Container auth error | `docker login ghcr.io` (use PAT with `read:packages`)                        |
| Tests too slow       | Use experimental devnode: set `DEVNET=false`, set `SKIP_EXECUTE_PROOF=true`  |
| Port 3030 in use     | `docker stop $(docker ps -q --filter ancestor=ghcr.io/sealance-io/leo-lang)` |

## Notes

- Tests run **sequentially** (shared blockchain state)
- Devnode/devnet are for **local testing only** - use `npm run deploy:testnet` for public networks
