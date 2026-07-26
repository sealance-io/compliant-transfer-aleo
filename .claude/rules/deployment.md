---
paths:
  - "scripts/**/*.ts"
  - "recipes/**/*.ts"
---

# Deployment

See @docs/DEVELOPMENT.md for deployment and upgrade details.

**Critical constraints:**

- Devnode: `npm run deploy:devnode`
- Testnet: `npm run deploy:testnet`
- Compile programs with LionDen: `npm run compile`
- Upgrade one program with `lionden recipe --file recipes/upgrade.ts --network devnode --program <program-name>`
- Use a program name from `/programs` without the `.aleo` suffix. For example, `--program merkle_tree` upgrades the `merkle_tree` program.
