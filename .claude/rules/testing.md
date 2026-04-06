---
paths:
  - "test/**/*.test.ts"
  - "vitest.*.ts"
---

# Testing

See @docs/TESTING.md for complete testing guide.

**Critical constraints:**

- Tests run sequentially (shared chain state)
- Use devnode for fast iteration: `npm test` (default and recommended)
- Use devnet for full-network testing: `DEVNET=true npm test`
