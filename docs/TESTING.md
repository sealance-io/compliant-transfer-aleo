# Testing Configuration

## Testing Modes

| Mode        | Command               | Speed | Use Case                             | Status                      |
| ----------- | --------------------- | ----- | ------------------------------------ | --------------------------- |
| **Devnode** | `npm test`            | Fast  | Local iteration, PR CI               | **Default and recommended** |
| **Devnet**  | `npm run test:devnet` | Slow  | Multi-validator regression (nightly) | Opt-in                      |

> `npm test` uses LionDen's managed `leo devnode` by default. `test:devnet` runs the
> programs against a real multi-validator devnet in a container — see [Devnet mode](#devnet-mode).

## Execution Model

LionDen runs test **files serially**, each in its own forked Vitest worker:

- Each worker builds its own LionDen runtime environment and its own chain, so **no
  chain state is shared across files** and **file order is irrelevant**.
- Within a file, all tests share that one chain, so tests inside a file remain order-dependent.
- Devnode mode: one managed `leo devnode` per worker.
- Devnet mode: **one container per `lionden test` invocation**, which is why devnet is
  driven as one file per invocation (a per-file CI matrix, or the `test:devnet` loop).

## Quick Start

```bash
cp .env.example .env
npm test                         # Default devnode mode (recommended)
npm test test/your-test.test.ts  # Single test
npm test -- --grep "mint"           # Filter tests by name
npm test -- --prove                 # Generate proofs during execution
```

## Devnet mode

Devnet is a real multi-validator network running in a container
(`ghcr.io/sealance-io/aleo-devnet`). It is configured as an `http` network, not a
`devnode` one — so transactions are genuinely proven and block production is driven by
the network rather than by LionDen's devnode-only `advanceBlocks` fast path.

Lifecycle lives in `test/support/devnet-container.ts`, registered as a LionDen `testing`
hook by `test/support/devnet-plugin.ts`. `lionden.config.ts` only adds that plugin when
`TEST_MODE=devnet`, so devnode runs never touch Docker.

Transactions are always proven on devnet. Nothing needs `--prove`: LionDen's `http` deploy
path calls `programManager.deploy()` directly, and the unproven devnode fast path requires
`type: "devnode"`, so neither is reachable here.

### Consensus-height priming (LionDen workaround)

`lionden.config.ts` calls `initConsensusHeights()` when `TEST_MODE=devnet`. LionDen
(`@lionden/*@0.1.1`) only does this for `devnode` connections, but the devnet image
activates consensus versions on snarkVM's compressed _test_ height schedule. Without
priming, the first `ctx.deploy()` is rejected with
`Invalid deployment transaction '<id>' - missing program checksum`.

This is measured, not assumed: identical runs fail without the call and pass 7/7 with it.
The mechanism is inferred — unprimed, the SDK appears to resolve the consensus version
from the production height table and omit the checksum the chain requires. It is unrelated
to proving; see above. Remove the workaround once LionDen primes heights for `http`
networks too.

### Devnet requires precompiled artifacts (`--no-compile`)

The LionDen CLI resolves the config and builds the runtime environment **at boot**, before
any task (and therefore before the container starts). The container's host port is mapped
dynamically, so an in-process `compile` would still target the stale default endpoint.

The contract is therefore: **compile first, then run tests with `--no-compile`.** Both
supported entrypoints encode it — `npm run test:devnet` and the `Run tests` step in
`.github/workflows/test-runner.yml`. It cannot be enforced programmatically: by the time
the `suiteSetup` hook gets control, LionDen has already run compile.

```bash
npm run build --workspace=@sealance-io/policy-engine-aleo
npm run compile -- --network testnet
docker pull ghcr.io/sealance-io/aleo-devnet:v4.3.1-v4.8.1

# One file:
TEST_MODE=devnet DEVNET_CONTAINER_LOGS=1 \
  npx lionden test test/merkle_tree.test.ts --network devnet --no-compile --timeout 7200000

# Every file, one container each:
npm run test:devnet
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

### Devnet

| Variable                           | Default                                         | Description                                                                             |
| ---------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `TEST_MODE`                        | `devnode`                                       | Set to `devnet` to register the container plugin in `lionden.config.ts`                 |
| `DEVNET_IMAGE`                     | `ghcr.io/sealance-io/aleo-devnet:v4.3.1-v4.8.1` | Devnet container image                                                                  |
| `DEVNET_ENDPOINT`                  | `http://127.0.0.1:3030`                         | Devnet REST endpoint; **overwritten** by the hook with the container's mapped host/port |
| `DEVNET_EXTERNAL`                  | `false`                                         | Skip container start and use the devnet already at `DEVNET_ENDPOINT`                    |
| `DEVNET_CONSENSUS_VERSION`         | `16`                                            | Readiness gate — the hook polls until the chain reports at least this version           |
| `DEVNET_CONSENSUS_VERSION_HEIGHTS` | `0,1,2,...,15`                                  | Passed to the image as `CONSENSUS_VERSION_HEIGHTS`; must be able to reach the above     |
| `DEVNET_READY_TIMEOUT_MS`          | `600000`                                        | Readiness poll budget (CI uses `1500000`)                                               |
| `DEVNET_CONTAINER_LOGS`            | `false`                                         | Stream container logs to the console                                                    |

**The consensus values are image-coupled.** The image requires _exactly_ one height per
consensus version its snarkOS knows about, and that same count is the highest version the
chain will ever report. `v4.3.1-v4.8.1` ships snarkOS 4.8.1 and takes **16** — targeting
17 simply never becomes ready. (The older `v4.0.1-v4.6.0` took 14.) Re-derive both values
whenever `DEVNET_IMAGE` moves; a wrong count aborts the run during container startup with
`expected exactly N consensus heights` in the container logs.

The deployer key comes from the resolved `deployer` named account
(`ALEO_DEVNET_DEPLOYER_PRIVATE_KEY`) and is passed to the image as `PRIVATE_KEY`; the
container's genesis balance funds every other test account.

## Manual Setup

The repository tests use LionDen's managed devnode by default. For ad hoc tests or scripts
that call `setup({ skipDevnode: true })`, start a devnode separately:

```bash
# In another terminal:
leo devnode start \
  --private-key "$ALEO_DEVNET_DEPLOYER_PRIVATE_KEY" \
  --consensus-heights 0,1,2,3,4,5,6,7,8,9,10,11,12,13
```

For devnet, `DEVNET_EXTERNAL=1` plus a `DEVNET_ENDPOINT` points the suite at a network you
started yourself. Nothing is torn down in that mode, and readiness failures report the poll
trace (endpoint, elapsed, last HTTP status, last parsed consensus version) rather than
container logs.

## Troubleshooting

| Issue                        | Solution                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Devnode logs hidden          | `LIONDEN_DEVNODE_LOGS=forward npm test`                                                                                    |
| Devnet container logs hidden | `DEVNET_CONTAINER_LOGS=1`                                                                                                  |
| Leo CLI missing              | Install a Leo CLI compatible with `lionden.config.ts`                                                                      |
| Tests too slow               | Keep proofs disabled for normal devnode runs; use `npm test -- --prove` only when needed                                   |
| Port 3030 in use             | Stop the process currently listening on port 3030 (devnet maps a dynamic host port instead)                                |
| Container exits immediately  | Wrong `DEVNET_CONSENSUS_VERSION_HEIGHTS` count for the image; run with `DEVNET_CONTAINER_LOGS=1` to see the expected count |
| Devnet never reaches ready   | Check `DEVNET_CONSENSUS_VERSION` against what the pinned `DEVNET_IMAGE` can actually reach                                 |
| Devnet artifacts look stale  | Devnet always runs `--no-compile`; re-run `npm run compile -- --network testnet` first                                     |

## Notes

- Test files run **serially, one chain each** — see [Execution Model](#execution-model)
- `devnode` is the default locally and in PR CI; `devnet` runs nightly per file
- Devnode and devnet are for **local/CI testing only** - use `npm run deploy:testnet` for public networks
- `npm run typecheck` gates `lib/`, `recipes/`, `scripts/`, and `test/`; it needs the SDK
  built (`npm run build --workspace=@sealance-io/policy-engine-aleo`) and `typechain/`
  generated (`npm run compile`)
