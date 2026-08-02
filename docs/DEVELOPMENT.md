# Development Guide

Commands and workflows for developing in this repository.

## Dependencies & Setup

```bash
# Install from repository root (uses npm workspaces)
npm run lint:lockfile
npm ci --ignore-scripts --allow-git=none
```

**Critical**: Uses npm workspaces with a single root `package-lock.json`. Never run `npm install` in workspace directories (`packages/*/`).

## Building

```bash
# Compile all Leo programs (output to /artifacts)
npm run compile

# Build SDK only
npm run build --workspace=@sealance-io/policy-engine-aleo
```

## Testing

| Mode        | Command    | Speed | Use Case            | Status                      |
| ----------- | ---------- | ----- | ------------------- | --------------------------- |
| **Devnode** | `npm test` | Fast  | Local iteration, CI | **Default and recommended** |

```bash
npm test                                      # Default devnode mode (recommended)
npm test test/merkle_tree.test.ts          # Specific test file
npm test -- --grep "mint"                     # Filter tests by name
npm test -- --no-compile                      # Reuse existing artifacts/typechain
npm test -- --prove                           # Generate proofs during execution
```

**Note**: PR CI and local runs default to LionDen's managed devnode.

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
npm run deploy:devnode               # Deploy to local devnode
npm run deploy:testnet              # Deploy to testnet
```

These commands run the LionDen deployment recipe in `recipes/setup.ts` for the selected network.

## Upgrades

Run the upgrade recipe with the target network and program name:

```bash
lionden recipe --file recipes/upgrade.ts --network devnode --program <program-name>

# Example: upgrade the merkle_tree program
lionden recipe --file recipes/upgrade.ts --network devnode --program merkle_tree
```

Replace `<program-name>` with the target program name from `/programs` without the `.aleo` suffix. The recipe compiles before running the upgrade.

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

## Common Issues

- **Leo CLI missing**: Install a Leo CLI compatible with `lionden.config.ts`
- **Tests too slow**: Keep proofs disabled for normal devnode runs; use `npm test -- --prove` only when needed
- **Port 3030 in use**: Stop the process currently listening on port 3030
- **Manual local Aleo setup**: See `docs/TESTING.md`
