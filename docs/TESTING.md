# Testing Configuration

## Testing Modes

| Mode        | Command    | Speed | Use Case            | Status                      |
| ----------- | ---------- | ----- | ------------------- | --------------------------- |
| **Devnode** | `npm test` | Fast  | Local iteration, CI | **Default and recommended** |

> `npm test` uses LionDen's managed `leo devnode` by default.

## Quick Start

```bash
cp .env.example .env
npm test                    # Default devnode mode (recommended)
npm test test/your-test.test.ts  # Single test
npm test --grep "mint"           # Filter tests by name
npm test --prove                 # Generate proofs during execution
```

## Environment Variables

### Core

| Variable        | Default | Description                                             |
| --------------- | ------- | ------------------------------------------------------- |
| `LIONDEN_PROVE` | Unset   | Generate proofs during tests; normally set by `--prove` |

### Timing & Logging

| Variable               | Default  | Description                                         |
| ---------------------- | -------- | --------------------------------------------------- |
| `LIONDEN_DEVNODE_LOGS` | Buffered | Devnode log mode: `inherit`, `forward`, or buffered |

## Manual Setup

The repository tests use LionDen's managed devnode by default. For ad hoc tests or scripts that call `setup({ skipDevnode: true })`, start a devnode separately:

```bash
# In another terminal:
leo devnode start \
  --private-key "$ALEO_DEVNET_DEPLOYER_PRIVATE_KEY" \
  --consensus-heights 0,1,2,3,4,5,6,7,8,9,10,11,12,13
```

## Troubleshooting

| Issue               | Solution                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| Devnode logs hidden | `LIONDEN_DEVNODE_LOGS=forward npm test`                                      |
| Leo CLI missing     | Install a Leo CLI compatible with `lionden.config.ts`                        |
| Tests too slow      | Keep proofs disabled for normal devnode runs; use `--prove` only when needed |
| Port 3030 in use    | Stop the process currently listening on port 3030                            |

## Notes

- Tests run **sequentially** (shared blockchain state)
- `devnode` is the default locally and in standard CI runs
- Devnode is for **local testing only** - use `npm run deploy:testnet` for public networks
