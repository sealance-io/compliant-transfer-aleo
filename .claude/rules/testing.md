---
paths:
  - "test/**/*.test.ts"
  - "test/support/*.ts"
  - "lionden.config.ts"
---

# Testing

See @docs/TESTING.md for complete testing guide.

**Critical constraints:**

- Test files run serially, each in its own forked worker with its own chain — no state is
  shared across files and file order is irrelevant. Tests _within_ a file share a chain and
  stay order-dependent.
- Use LionDen-managed devnode for fast iteration: `npm test` (default and recommended)
- Run one file with `npm test test/merkle_tree.test.ts`
- Use `npm test --no-compile` only when intentionally reusing existing artifacts/typechain
- Use `npm test --prove` when proof generation is required
- Devnet (containerized multi-validator) is one container per invocation and **must**
  precompile then pass `--no-compile`:
  `TEST_MODE=devnet npx lionden test test/<file>.test.ts --network devnet --no-compile --timeout 7200000`,
  or `npm run test:devnet` for the full loop
- `npm run typecheck` gates test/lib/recipes/scripts; it needs the built SDK and `typechain/`
