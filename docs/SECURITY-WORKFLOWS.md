# GitHub Actions Security Documentation

This document outlines the security measures implemented in this repository's GitHub Actions workflows, following best practices from [Wiz.io's GitHub Actions Security Guide](https://www.wiz.io/blog/github-actions-security-guide) and automated auditing with [zizmor](https://github.com/woodruffw/zizmor).

**See Also:**

- [NPM Security Best Practices](NPM-SECURITY.md) - npm/package management security

## 🔒 Security Audit Status

All workflows pass security audits in all modes:

- ✅ **zizmor regular mode**: No findings
- ✅ **zizmor pedantic mode**: No findings
- ✅ **zizmor auditor mode**: No findings

Weekly automated security scans run via `.github/workflows/security-audit.yml`.

---

## 🛡️ Security Measures Implemented

### 1. Minimal Permissions (Principle of Least Privilege)

**Workflow-level permissions:**

```yaml
permissions: {} # no permissions by default
```

**Job-level permissions:**
Each job explicitly declares minimal required permissions:

- `contents: read` - Standard jobs (format, test, linter)
- `security-events: write` - Security audit job (for SARIF upload)
- `packages: read` - Container image pulls from GHCR
- `actions: read` - GitHub Actions runtime access

**Compliance:**

- ✅ Avoids default write permissions
- ✅ Job-level specificity prevents privilege escalation
- ✅ Documented reasons for non-standard permissions (inline comments)

---

### 2. Action Pinning (Supply Chain Security)

All third-party actions are pinned to specific commit hashes with version tags:

| Action                              | Pinned SHA                                 | Version |
| ----------------------------------- | ------------------------------------------ | ------- |
| `actions/checkout`                  | `08eba0b27e820071cde6df949e0beb9ba4906955` | v4.3.0  |
| `actions/setup-node`                | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0  |
| `actions/dependency-review-action`  | `3c4e3dcb1aa7874d2c16be7d79418e9b7efd6261` | v4.8.2  |
| `docker/login-action`               | `5e57cd118135c172c3672efd75eb46360885c0ef` | v3.6.0  |
| `github/codeql-action/upload-sarif` | `45c373516f557556c15d420e3f5e0aa3d64366bc` | v3.31.9 |
| `zizmorcore/zizmor-action`          | `e673c3917a1aef3c65c972347ed84ccd013ecda4` | v0.2.0  |
| `sealance-io/setup-leo-action`      | `b30e4cc53c73355def527d832604763e9b601fb2` | v0.1.0  |

**Compliance:**

- ✅ Protects against tag/branch manipulation attacks
- ✅ Ensures reproducible builds
- ✅ Version tags in comments maintain readability

---

### 3. Container Image Pinning

Container images are pinned to SHA256 digests:

```yaml
container:
  image: ghcr.io/sealance-io/leo-lang-ci:v3.3.1-devnode@sha256:3f55b1a8d69978e94595b56536a02bae37befbe392dfee0735c494544fb8243c
```

**Compliance:**

- ✅ Prevents tag poisoning attacks
- ✅ Guarantees immutable execution environment
- ✅ Maintains version tag for reference

---

### 4. Credential Security

**Disabled credential persistence:**

```yaml
- uses: actions/checkout@...
  with:
    persist-credentials: false
```

**Secrets management:**

- ✅ Secrets passed only to steps that need them
- ✅ Only built-in `GITHUB_TOKEN` and `secrets.github_token` used
- ✅ No use of `secrets: inherit` or `toJson(secrets)`
- ✅ Secrets scoped to specific authentication tasks (container registry, GitHub API)

---

### 5. Trigger Safety (Poisoned Pipeline Execution Prevention)

**Safe triggers only:**

- ✅ `pull_request` (safe - runs from base branch code)
- ✅ `push` to main branch only
- ✅ `schedule` for automated scans
- ✅ `workflow_dispatch` for manual triggers

**NOT USED (dangerous):**

- ❌ `pull_request_target` (PPE risk)
- ❌ `workflow_run` (PPE risk)
- ❌ Workflows on public forks

---

### 6. Command Injection Prevention

**No untrusted input in shell commands:**

- ✅ No `${{ github.event... }}` interpolation in `run:` commands
- ✅ No `${{ inputs... }}` in shell commands
- ✅ No dynamic script execution from user-controlled data

**Safe practices:**

- All `run:` commands use static scripts or npm commands
- GitHub context variables only used in action `with:` parameters (safer)

---

### 7. Environment Variable Safety

**Protected environment files:**

- ✅ No writes to `GITHUB_ENV`
- ✅ No writes to `GITHUB_PATH`
- ✅ Prevents binary poisoning and environment manipulation

---

### 8. Runner Security

**GitHub-hosted runners only:**

- ✅ Using `ubuntu-latest` (GitHub-hosted, ephemeral)
- ✅ Using official container images (isolated)
- ❌ No self-hosted runners (avoiding security risks with public repos)

---

### 9. Concurrency Control

All workflows implement concurrency limits:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

**Benefits:**

- ✅ Prevents resource exhaustion
- ✅ Cancels outdated workflow runs
- ✅ Reduces attack surface for denial-of-service

---

### 10. Dependency Management

**Two-layer vulnerability scanning:**

| Tool                       | Scope         | Database               | When          |
| -------------------------- | ------------- | ---------------------- | ------------- |
| `npm audit`                | Full lockfile | npm registry           | After install |
| `dependency-review-action` | PR diff only  | GitHub Advisory (GHSA) | PR gate       |

**Why both?**

- `npm audit`: Catches existing vulnerabilities in full dependency tree
- `dependency-review-action`: Gates PRs on NEW vulnerabilities + license compliance

**npm installation security workflow:**

```bash
# 1. Validate lockfile integrity
npm run lint:lockfile

# 2. Install with security flags
npm ci --prefer-offline --no-audit --no-fund --ignore-scripts

# 3. Scan for vulnerabilities
npm audit --audit-level=high

# 4. Controlled script execution
npm run postinstall
```

**License compliance (dependency-review-action):**

```yaml
deny-licenses: GPL-2.0-only, GPL-2.0-or-later, GPL-3.0-only, GPL-3.0-or-later, AGPL-3.0-only, AGPL-3.0-or-later
```

Blocks licenses incompatible with Apache-2.0:

- **GPL-2.0**: Incompatible due to patent clause conflicts
- **GPL-3.0**: One-way compatibility only (Apache→GPL ok, GPL→Apache not ok)
- **AGPL**: Network copyleft, incompatible

**Security benefits:**

- `npm ci`: Deterministic installation, enforces lockfile adherence
- `lockfile-lint`: Validates packages from npm registry only, HTTPS only
- `--ignore-scripts`: Prevents arbitrary code execution during install
- `npm audit`: Detects known vulnerabilities before use
- `dependency-review-action`: PR-scoped vulnerability + license gating
- Manual `postinstall`: Controlled script execution after security checks

**For complete npm security documentation, see [NPM-SECURITY.md](NPM-SECURITY.md)**

---

## 📊 Action Trust Assessment

| Action                              | Publisher | Trust Level | Verification                               |
| ----------------------------------- | --------- | ----------- | ------------------------------------------ |
| `actions/checkout`                  | GitHub    | High        | Official GitHub action                     |
| `actions/setup-node`                | GitHub    | High        | Official GitHub action                     |
| `actions/dependency-review-action`  | GitHub    | High        | Official GitHub action                     |
| `github/codeql-action/upload-sarif` | GitHub    | High        | Official GitHub action                     |
| `docker/login-action`               | Docker    | High        | Official Docker action, verified publisher |
| `zizmorcore/zizmor-action`          | Zizmor    | Medium      | Official zizmor action, security-focused   |
| `sealance-io/setup-leo-action`      | Sealance  | Internal    | Private/org action, trusted internally     |

---

## 🔄 Continuous Security Monitoring

### Automated Security Audits

**Workflow:** `.github/workflows/security-audit.yml`

**Triggers:**

- Every push/PR to main affecting workflows
- Weekly scheduled scan (Mondays at 00:00 UTC)
- Manual dispatch

**Capabilities:**

- SARIF upload to GitHub Security tab
- Inline PR annotations (up to 10)
- Pedantic mode checks on PRs
- Full audit history tracking

### Configuration

**zizmor configuration:** `.github/zizmor.yml`

- Documents security posture
- No rules disabled or ignored
- All checks active

---

## ✅ Compliance Checklist

### Wiz.io Best Practices

- [x] Read-only default workflow permissions
- [x] Action restrictions (hash-pinned)
- [x] No self-hosted runners on public repos
- [x] Secrets passed to specific steps only
- [x] No `secrets: inherit` or `toJson(secrets)`
- [x] Explicit permissions at workflow and job levels
- [x] No command injection vulnerabilities
- [x] Credential persistence disabled
- [x] No dangerous triggers (pull_request_target, workflow_run)
- [x] No GITHUB_ENV/GITHUB_PATH manipulation
- [x] Container images pinned to SHA256

### zizmor Audits (29 checks)

- [x] All audits passing in regular mode
- [x] All audits passing in pedantic mode
- [x] All audits passing in auditor mode
- [x] No findings suppressed

---

## 🔍 Security Review Process

### Before Merging Workflow Changes

1. **Automated checks:**

   - zizmor security audit runs automatically
   - SARIF results uploaded to Security tab
   - PR annotations show inline findings

2. **Manual review:**

   - Verify all actions remain hash-pinned
   - Check for new secret usage
   - Validate permission changes are minimal
   - Ensure no new dynamic code execution

3. **Testing:**
   - Verify workflow runs successfully
   - Check logs for unexpected behavior
   - Validate secrets are not leaked in logs

---

## 📚 References

- [Wiz.io GitHub Actions Security Guide](https://www.wiz.io/blog/github-actions-security-guide)
- [zizmor Documentation](https://docs.zizmor.sh/)
- [GitHub Actions Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [OSSF Scorecard](https://securityscorecards.dev/)

---

## 🚨 Incident Response

If a security issue is discovered in workflows:

1. **Immediate actions:**

   - Disable affected workflows if actively exploited
   - Rotate any exposed secrets/tokens
   - Review workflow run logs for evidence of compromise

2. **Investigation:**

   - Run `zizmor --pedantic .github/workflows/` locally
   - Review recent workflow changes in git history
   - Check Security tab for SARIF findings

3. **Remediation:**
   - Apply security fixes
   - Update this documentation
   - Consider additional preventive measures

---

**Last Updated:** 2026-01-12
**Last Security Audit:** Automated weekly via security-audit.yml
**Audit Tool:** zizmor-action v0.2.0 (runs latest zizmor)
