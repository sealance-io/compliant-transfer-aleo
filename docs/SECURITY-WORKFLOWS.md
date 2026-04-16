# GitHub Actions Security

Security measures following [Wiz.io's GitHub Actions Security Guide](https://www.wiz.io/blog/github-actions-security-guide), audited with [zizmor](https://github.com/woodruffw/zizmor).

**Related:** [NPM-SECURITY.md](NPM-SECURITY.md) for package management security.

## Audit Status

All workflows pass zizmor audits (regular, pedantic, auditor modes). Weekly scans run via `security-audit.yml`.

## Security Measures

### 1. Minimal Permissions

```yaml
permissions: {} # workflow-level default
```

Job-level permissions: `contents: read` (standard), `security-events: write` (SARIF upload), `packages: read` (GHCR pulls), `pull-requests: write` (dependency-review PR comment).

### 2. Action Pinning

All actions pinned to commit SHAs:

| Action                             | SHA        | Version |
| ---------------------------------- | ---------- | ------- |
| `actions/checkout`                 | `de0fac2e` | v6.0.2  |
| `actions/create-github-app-token`  | `f8d387b6` | v3.0.0  |
| `actions/dependency-review-action` | `2031cfc0` | v4.9.0  |
| `actions/github-script`            | `ed597411` | v8.0.0  |
| `actions/setup-node`               | `53b83947` | v6.3.0  |
| `changesets/action`                | `6a0a831f` | v1.7.0  |
| `sealance-io/setup-leo-action`     | `4491779e` | v1.1.0  |
| `zizmorcore/zizmor-action`         | `71321a20` | v0.5.2  |

### 3. Container Image Pinning

Images pinned to SHA256 digests to prevent tag poisoning.

### 4. Credential Security

- `persist-credentials: false` on checkout
- Secrets passed only to steps that need them
- No `secrets: inherit` or `toJson(secrets)`

### 5. Safe Triggers Only

| Used                                                    | Avoided (PPE risk)                    |
| ------------------------------------------------------- | ------------------------------------- |
| `pull_request`, `push`, `schedule`, `workflow_dispatch` | `pull_request_target`, `workflow_run` |

### 6. Injection Prevention

- No `${{ github.event... }}` or `${{ inputs... }}` in `run:` commands
- No writes to `GITHUB_ENV` or `GITHUB_PATH`

### 7. Runner Security

GitHub-hosted runners only (`ubuntu-latest`). No self-hosted runners.

### 8. Concurrency Control

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### 9. Dependency Scanning

| Tool                                       | Scope             | When         |
| ------------------------------------------ | ----------------- | ------------ |
| `dependency-review-action`                 | PR diff only      | PR gate      |
| `npm audit` (SDK workspace, omit dev+peer) | Runtime deps only | Publish gate |
| `npm audit`                                | Full lockfile     | Local only   |

Blocked licenses: GPL-2.0, GPL-3.0, AGPL (checked manually via `npm run lint:licenses`; dependency-review license checking planned).

## Action Trust Levels

| Action                         | Publisher  | Trust    |
| ------------------------------ | ---------- | -------- |
| `actions/*`                    | GitHub     | High     |
| `changesets/action`            | Changesets | Medium   |
| `zizmorcore/zizmor-action`     | Zizmor     | Medium   |
| `sealance-io/setup-leo-action` | Sealance   | Internal |

## Security Review Checklist

Before merging workflow changes:

1. zizmor audit passes (automated)
2. Actions remain hash-pinned
3. Permission changes are minimal
4. No new dynamic code execution
5. Secrets not leaked in logs

## Incident Response

1. Disable affected workflows if actively exploited
2. Rotate exposed secrets/tokens
3. Run `zizmor --pedantic .github/workflows/` locally
4. Apply fixes and update documentation

## References

- [Wiz.io GitHub Actions Security Guide](https://www.wiz.io/blog/github-actions-security-guide)
- [zizmor Documentation](https://docs.zizmor.sh/)
- [GitHub Actions Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
