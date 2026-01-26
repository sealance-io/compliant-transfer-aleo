---
globs:
  - "packages/**"
---

# SDK Development

See @packages/policy-engine-sdk/AGENTS.md for complete SDK guide.

**Critical constraints:**

- Install from root only - never `npm install` in subdirectories
- Add changeset for any SDK change: `npx changeset`
- ESM only - no CommonJS
