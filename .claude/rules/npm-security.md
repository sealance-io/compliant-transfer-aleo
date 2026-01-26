---
alwaysApply: true
---

# npm Security

**CRITICAL:** Always use `--ignore-scripts` flag with npm commands.

```bash
npm ci --ignore-scripts
npm install --ignore-scripts
```

This is a security requirement - never run npm lifecycle scripts from untrusted packages.
