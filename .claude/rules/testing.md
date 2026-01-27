---
paths:
  - "test/**/*.test.ts"
  - "vitest.*.ts"
---

# Testing

See @docs/TESTING.md for complete testing guide.

**Critical constraints:**

- Tests run sequentially (shared devnet state)
- Use devnet for stable testing: `DEVNET=true npm test` (current default)
- Use devnode for fast iteration: `DEVNET=false npm test` (experimental, will become default when stable)
