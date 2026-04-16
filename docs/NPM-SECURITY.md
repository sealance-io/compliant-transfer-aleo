# npm Security

Security practices based on [Liran Tal's npm Security Best Practices](https://github.com/lirantal/npm-security-best-practices).

## Security Measures

### 1. Deterministic Installation

```bash
npm ci --prefer-offline --ignore-scripts --allow-git=none --no-audit --no-fund
```

- Enforces strict lockfile adherence
- Blocks git dependency fetches during install
- Aborts if `package.json` / `package-lock.json` are out of sync
- Clean `node_modules` state on each install

### 2. Post-Install Script Protection

```bash
npm ci --ignore-scripts --allow-git=none  # Install without running scripts
npm run postinstall          # Controlled execution after validation
```

**Why not `.npmrc` with `ignore-scripts=true`?** This repo treats lockfile validation as an explicit step (`npm run lint:lockfile`) and applies patches via an explicit `npm run postinstall` after install. CI and any `npm ci --ignore-scripts` flow must run those commands directly because lifecycle scripts are skipped.

### 3. Lockfile Validation

```bash
npm run lint:lockfile
# or: node scripts/validate-lockfile.mjs
```

Committed validator with no registry bootstrap. Validates: npm registry only,
HTTPS enforcement, integrity presence for resolved packages, and rejection of
git/file/tarball fallback sources when `resolved` is absent.

### 4. Vulnerability Scanning

| Environment  | Command                                    | Threshold |
| ------------ | ------------------------------------------ | --------- |
| CI (PR)      | `dependency-review-action`                 | High+     |
| CI (publish) | `npm audit` (SDK workspace, omit dev+peer) | High+     |
| Local        | `npm audit --audit-level=moderate`         | Moderate+ |

## CI Workflow

```yaml
- run: node scripts/validate-lockfile.mjs
- run: npm ci --prefer-offline --ignore-scripts --allow-git=none --no-audit --no-fund
- run: npm run postinstall
```

## Attack Prevention

| Attack                   | Prevention                                                |
| ------------------------ | --------------------------------------------------------- |
| Malicious post-install   | `--ignore-scripts` blocks automatic execution             |
| Lockfile poisoning       | Committed validator enforces registry-only URLs + HTTPS   |
| Git dependency injection | `--allow-git=none` blocks git fetches during install      |
| Dependency confusion     | Lockfile validation + install policy restrictions         |
| Compromised update       | Lockfile pinning + `dependency-review-action` + PR review |

## Dependabot Cooldowns

| Update Type | Cooldown | Rationale                                 |
| ----------- | -------- | ----------------------------------------- |
| Patch       | 3 days   | Allow community to discover issues        |
| Minor       | 7 days   | Longer validation for significant changes |
| Major       | Blocked  | Manual review required                    |

Security updates bypass all cooldowns. See `.github/dependabot.yml` and `docs/DEPENDABOT-STRATEGY.md`.

## Tooling Status

| Tool                            | Purpose                      | Status               |
| ------------------------------- | ---------------------------- | -------------------- |
| `npm ci`                        | Deterministic installation   | Active               |
| `--ignore-scripts`              | Block post-install scripts   | Active               |
| `--allow-git=none`              | Block git dependency fetches | Active               |
| `scripts/validate-lockfile.mjs` | Lockfile validation          | Active               |
| `npm audit`                     | Vulnerability scanning       | Publish gate + local |
| `dependency-review-action`      | PR vulnerability gating      | Active               |
| `zizmor`                        | Workflow security            | Active               |
| Dependabot                      | Automated updates            | Active               |
| npm provenance                  | Build attestations           | Planned              |
| OIDC publishing                 | Token-less publishing        | Planned              |

## Incident Response

1. Review `npm audit` output and check if affected version is in lockfile
2. Update to patched version or remove dependency
3. Run `npm run lint:lockfile` to verify clean state
4. Document and adjust practices as needed

## References

- [npm Security Best Practices](https://github.com/lirantal/npm-security-best-practices)
- [npm `allow-git`](https://docs.npmjs.com/cli/v11/using-npm/config#allow-git)
- [npm `package-lock.json`](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
