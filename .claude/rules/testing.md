---
paths:
  - "test/**/*.test.ts"
  - "vitest.*.ts"
---

# Testing

See @docs/TESTING.md for complete testing guide.

**Critical constraints:**

- Tests run sequentially (shared chain state)
- Use LionDen-managed devnode for fast iteration: `npm test` (default and recommended)
- Run one file with `npm test test/merkle_tree.test.ts`
- Use `npm test --no-compile` only when intentionally reusing existing artifacts/typechain
- Use `npm test --prove` when proof generation is required
