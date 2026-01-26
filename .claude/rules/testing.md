---
globs:
  - "test/**"
  - "vitest.*.ts"
---

# Testing

See @docs/TESTING.md for complete testing guide.

**Critical constraints:**

- Tests run sequentially (shared devnet state)
- Use devnode mode for fast iteration: `npm test`
- Use devnet for full validation: `DEVNET=true npm test`
