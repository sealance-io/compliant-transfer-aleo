# npm Security

Security practices based on [Liran Tal's npm Security Best Practices](https://github.com/lirantal/npm-security-best-practices).

## Security Measures

### 1. Deterministic Installation

```bash
npm ci --prefer-offline --ignore-scripts --no-audit --no-fund
```

- Enforces strict lockfile adherence
- Aborts if `package.json` / `package-lock.json` are out of sync
- Clean `node_modules` state on each install

### 2. Post-Install Script Protection

```bash
npm ci --ignore-scripts      # Install without running scripts
npm run postinstall          # Controlled execution after validation
```

**Why not `.npmrc` with `ignore-scripts=true`?** Our `preinstall` hook validates the lockfile and `postinstall` applies required patches. CI uses explicit flags; local dev benefits from automatic execution after validation.

### 3. Lockfile Validation

```bash
npm run lint:lockfile
# or: npx lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https
```

Validates: npm registry only, HTTPS enforcement, SHA-512 integrity hashes.

### 4. Vulnerability Scanning

| Environment | Command                            | Threshold |
| ----------- | ---------------------------------- | --------- |
| CI          | `npm audit --audit-level=high`     | High+     |
| Local       | `npm audit --audit-level=moderate` | Moderate+ |

## CI Workflow

```yaml
- run: npx lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https
- run: npm ci --prefer-offline --ignore-scripts --no-audit --no-fund
- run: npm audit --audit-level=high
- run: npm run postinstall
```

## Attack Prevention

| Attack                 | Prevention                                    |
| ---------------------- | --------------------------------------------- |
| Malicious post-install | `--ignore-scripts` blocks automatic execution |
| Lockfile poisoning     | `lockfile-lint` validates registry URLs       |
| Dependency confusion   | Lockfile validation + registry restrictions   |
| Compromised update     | Lockfile pinning + `npm audit` + PR review    |

## Dependabot Cooldowns

| Update Type | Cooldown | Rationale                                 |
| ----------- | -------- | ----------------------------------------- |
| Patch       | 3 days   | Allow community to discover issues        |
| Minor       | 7 days   | Longer validation for significant changes |
| Major       | Blocked  | Manual review required                    |

Security updates bypass all cooldowns. See `.github/dependabot.yml` and `docs/DEPENDABOT-STRATEGY.md`.

## Tooling Status

| Tool                       | Purpose                    | Status  |
| -------------------------- | -------------------------- | ------- |
| `npm ci`                   | Deterministic installation | Active  |
| `--ignore-scripts`         | Block post-install scripts | Active  |
| `lockfile-lint`            | Lockfile validation        | Active  |
| `npm audit`                | Vulnerability scanning     | Active  |
| `dependency-review-action` | PR vuln + license gating   | Active  |
| `zizmor`                   | Workflow security          | Active  |
| Dependabot                 | Automated updates          | Active  |
| npm provenance             | Build attestations         | Planned |
| OIDC publishing            | Token-less publishing      | Planned |

## Incident Response

1. Review `npm audit` output and check if affected version is in lockfile
2. Update to patched version or remove dependency
3. Run `lockfile-lint` to verify clean state
4. Document and adjust practices as needed

## References

- [npm Security Best Practices](https://github.com/lirantal/npm-security-best-practices)
- [lockfile-lint](https://github.com/lirantal/lockfile-lint)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
