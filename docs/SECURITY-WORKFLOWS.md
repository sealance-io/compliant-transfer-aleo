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

Job-level permissions: `contents: read` (standard), `security-events: write` (SARIF upload), `packages: read` (GHCR pulls).

### 2. Action Pinning

All actions pinned to commit SHAs:

| Action                              | SHA        | Version |
| ----------------------------------- | ---------- | ------- |
| `actions/checkout`                  | `08eba0b2` | v4.3.0  |
| `actions/setup-node`                | `49933ea5` | v4.4.0  |
| `actions/dependency-review-action`  | `3c4e3dcb` | v4.8.2  |
| `docker/login-action`               | `5e57cd11` | v3.6.0  |
| `github/codeql-action/upload-sarif` | `45c37351` | v3.31.9 |
| `zizmorcore/zizmor-action`          | `e673c391` | v0.2.0  |
| `sealance-io/setup-leo-action`      | `b30e4cc5` | v0.1.0  |

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

| Tool                       | Scope         | When          |
| -------------------------- | ------------- | ------------- |
| `npm audit`                | Full lockfile | After install |
| `dependency-review-action` | PR diff only  | PR gate       |

Blocked licenses: GPL-2.0, GPL-3.0, AGPL (incompatible with Apache-2.0).

## Action Trust Levels

| Action                         | Publisher | Trust    |
| ------------------------------ | --------- | -------- |
| `actions/*`                    | GitHub    | High     |
| `github/codeql-action`         | GitHub    | High     |
| `docker/login-action`          | Docker    | High     |
| `zizmorcore/zizmor-action`     | Zizmor    | Medium   |
| `sealance-io/setup-leo-action` | Sealance  | Internal |

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
