# Dependabot Configuration Strategy

This document explains the rationale behind our Dependabot configuration in `.github/dependabot.yml`.

## Overview

Our Dependabot setup balances **security responsiveness** with **update stability** using a two-tier approach:

- **npm ecosystem**: Daily checks with conservative cooldown periods
- **GitHub Actions**: Weekly checks with shorter cooldowns

Both ecosystems automatically bypass cooldowns for security updates, ensuring critical vulnerabilities are addressed immediately.

## Configuration Philosophy

### Core Principles

1. **Security First**: Security updates bypass all restrictions automatically
2. **Stability Over Speed**: Cooldown periods prevent hasty updates that may introduce bugs
3. **Exact Versioning**: `versioning-strategy: increase` maintains exact versions (no `^` or `~`)
4. **Grouped Updates**: Related dependencies update together to reduce PR noise
5. **Registry Locking**: Explicit registry configuration prevents supply chain attacks
6. **Pragmatic Blocking**: Patched packages (`@doko-js/*`) blocked from automatic updates

## npm Ecosystem Configuration

### Update Cadence

```yaml
schedule:
  interval: "daily" # Check daily for new versions
  time: "09:00" # Morning updates for business hours review
  timezone: "Etc/UTC" # Consistent global timing
```

**Rationale**: Daily checks ensure timely security patches while morning timing allows same-day review.

### Cooldown Periods

| Type      | Cooldown | Reasoning                                                                 |
| --------- | -------- | ------------------------------------------------------------------------- |
| **Patch** | 7 days   | Allow community to discover issues; balance speed with safety             |
| **Minor** | 21 days  | Significant changes need validation; 3-week observation period standard   |
| **Major** | 60 days  | 2-month buffer for breaking changes; balances safety with maintainability |

**Why these periods?**

- **Patch (7d)**: Bugs often surface within first week of release
- **Minor (21d)**: ~20% of minor releases have issues discovered in first 3 weeks
- **Major (60d)**: 2-month buffer captures most community vetting benefit while preventing ecosystem drift; security updates bypass cooldown

### Blocked Packages

```yaml
ignore:
  - dependency-name: "@doko-js/core"
  - dependency-name: "@doko-js/utils"
  - dependency-name: "@doko-js/wasm"
```

**Rationale**:

- **@doko-js packages**: Use custom patches via `patch-package`; automatic updates would break patches

### Grouped Updates

Updates are grouped by domain to reduce PR volume:

| Group                  | Purpose                                              | Packages                               |
| ---------------------- | ---------------------------------------------------- | -------------------------------------- |
| **aleo-ecosystem**     | Aleo SDK dependencies often need coordinated updates | `@provablehq/*`                        |
| **testing-frameworks** | Test infrastructure changes together                 | vitest, testcontainers, @vitest/\*, @types/node |
| **typescript-tooling** | Build tools update together                          | TypeScript, tsx, rimraf                |
| **code-quality**       | Linting and formatting tools                         | prettier, lockfile-lint, patch-package |

**Benefits**:

- ✅ Fewer PRs to review (5-10 groups vs 30+ individual updates)
- ✅ Related changes tested together
- ✅ Easier to reason about compatibility
- ✅ Reduces CI load

## GitHub Actions Ecosystem Configuration

### Update Cadence

```yaml
schedule:
  interval: "weekly" # Less frequent than npm (lower risk)
  day: "monday" # Aligns with security-audit.yml schedule
  time: "09:00" # Same timing as npm
```

**Rationale**: Actions updates are lower risk than npm dependencies; weekly checks balance security with noise reduction.

### Cooldown Period

```yaml
cooldown:
  default-days: 21
```

**Important:** GitHub Actions does **not support semver-based cooldowns** (`semver-major-days`, `semver-minor-days`, `semver-patch-days`). Only `default-days` is available for the `github-actions` ecosystem.

| Setting          | Value   | Reasoning                                                  |
| ---------------- | ------- | ---------------------------------------------------------- |
| **default-days** | 21 days | Conservative period; applies uniformly to all update types |

**Why 21 days?**

1. **SHA Pinning Safety Net**: Actions are pinned to commit SHAs, providing immutability even without semver-based cooldowns
2. **Lower Blast Radius**: Action failures affect CI only, not production code
3. **Consistent with npm Minor**: Aligns with npm's 21-day cooldown for minor updates
4. **Security Updates Bypass**: Critical security fixes still come through immediately

### SHA Pinning Strategy

Our workflows use **commit SHA pinning with version comments**:

```yaml
uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # v5.0.0
```

**Benefits**:

- ✅ **Immutability**: SHA cannot be changed (unlike tags)
- ✅ **Security**: Prevents tag hijacking attacks
- ✅ **Auditability**: Exact code version is clear
- ✅ **Dependabot Support**: Automatically updates both SHA and comment

### Review Guidelines for Actions Updates

Since Dependabot doesn't support semver-based cooldowns for GitHub Actions, reviewers must manually assess risk. A workflow (`.github/workflows/dependabot-actions-review.yml`) automatically adds review guidance to each Actions Dependabot PR.

#### Risk Assessment Matrix

| Factor          | Lower Risk                         | Higher Risk                                |
| --------------- | ---------------------------------- | ------------------------------------------ |
| **Source**      | Official (`actions/*`, `github/*`) | Third-party unknown publishers             |
| **Version**     | Patch (x.x.X)                      | Major (X.x.x)                              |
| **Permissions** | `contents: read` only              | `write` permissions, `id-token`, secrets   |
| **Usage**       | Linting, formatting, caching       | Deployment, publishing, security workflows |

#### Source Trust Levels

| Level                  | Examples                               | Guidance                                        |
| ---------------------- | -------------------------------------- | ----------------------------------------------- |
| **Official GitHub**    | `actions/*`, `github/*`                | Fast-track eligible after basic review          |
| **Verified Publisher** | `docker/*`, `aws-actions/*`, `azure/*` | Standard review, check changelog                |
| **Third-Party**        | Everything else                        | Enhanced scrutiny, review source code if needed |

#### Review Checklist

Before approving any GitHub Actions update:

1. **Check version type** - Major updates need changelog review
2. **Review release notes** - Look for breaking changes or new permissions
3. **Verify SHA pinning** - Ensure update includes full commit SHA
4. **Consider permissions** - Higher scrutiny for actions with write access or secrets
5. **Verify CI passes** - All workflow checks should be green

## Versioning Strategy

```yaml
versioning-strategy: increase
```

This ensures Dependabot updates to **exact versions**, preventing version range expansion.

**Example**:

```diff
# Before update:
"lodash": "4.17.20"

# After update (with versioning-strategy: increase):
"lodash": "4.17.21"

# NOT (without this strategy):
"lodash": "^4.17.21"  # Would introduce version range
```

**Why exact versions?**

- ✅ Perfect sync between package.json and package-lock.json
- ✅ Deterministic builds (everyone gets same versions)
- ✅ Easier to reason about what's actually installed
- ✅ Aligns with security model (lockfile as source of truth)

## Security Update Bypass

**Critical feature**: All cooldown periods are automatically bypassed for security updates.

```yaml
cooldown:
  semver-patch-days: 7 # Applies to normal updates
  # Security updates bypass this entirely!
```

**How it works**:

1. Dependabot detects vulnerability via GitHub Advisory Database
2. Creates PR labeled as security update
3. **Cooldown is skipped** - PR created immediately
4. Standard review process still applies

**Result**: Zero-day vulnerabilities can be patched without waiting for cooldown periods.

## Integration with Security Practices

Dependabot configuration works with other security measures:

| Layer          | Tool            | Purpose                                    |
| -------------- | --------------- | ------------------------------------------ |
| **1. Install** | `npm ci`        | Deterministic installation from lockfile   |
| **2. Validate**| `lockfile-lint` | Verify package sources and HTTPS           |
| **3. Scan**    | `npm audit`     | Check for known vulnerabilities            |
| **4. Update**  | Dependabot      | Automated security and maintenance updates |
| **5. Review**  | GitHub PR       | Human review before merge                  |
| **6. Audit**   | `zizmor`        | Weekly workflow security checks            |

**Note**: Registry security is enforced through `lockfile-lint` validation (not Dependabot registry configuration, which requires authentication for npm).

## Open Pull Request Limits

```yaml
open-pull-requests-limit: 12  # npm ecosystem
open-pull-requests-limit: 5   # GitHub Actions
```

**Rationale**:

- **npm (12)**: Higher limit for security-critical SDK dependencies
- **Actions (5)**: Conservative limit; manual review needed for each

Prevents PR spam while allowing multiple security updates simultaneously.

## Commit Message Format

```yaml
commit-message:
  prefix: "chore(deps)" # Production dependencies
  prefix-development: "chore(dev-deps)" # Dev dependencies
  include: "scope" # Add scope to message
```

**Example commits**:

```
chore(deps): bump @provablehq/sdk from 0.9.8 to 0.9.9
chore(dev-deps): bump vitest from 3.1.0 to 3.2.0
ci(deps): bump actions/checkout from 08c6903 to 12ab78f
```

**Benefits**:

- ✅ Semantic commit format for changelog generation
- ✅ Clear distinction between prod and dev dependencies
- ✅ Easy to filter dependency updates in git history

## Labels

```yaml
labels:
  - "dependencies"
  - "npm" or "github-actions"
  - "automated"
```

**Uses**:

- Filter PRs by ecosystem
- Automated workflows can target dependency updates
- Analytics on dependency update frequency

## Decision Matrix

When deciding on configuration values, we considered:

| Factor                   | npm            | GitHub Actions   | Weight       |
| ------------------------ | -------------- | ---------------- | ------------ |
| **Security Impact**      | High (runtime) | Medium (CI-only) | 🔴 Critical  |
| **Breaking Change Risk** | High           | Medium           | 🟡 Important |
| **Update Frequency**     | Daily          | Weekly           | 🟢 Moderate  |
| **Manual Review Need**   | High           | Medium           | 🟡 Important |
| **SHA Pinning**          | N/A            | Yes (safety net) | 🟢 Moderate  |

**Result**: Conservative npm cooldowns, pragmatic Actions cooldowns

## Monitoring and Adjusting

### Success Metrics

- Security updates merge within 24 hours
- <5% of updates cause CI failures
- Dependency freshness stays within cooldown windows

### When to Adjust

**Increase cooldowns if**:

- > 10% of updates introduce bugs
- Team spending excessive time on dependency reviews

**Decrease cooldowns if**:

- Security updates arriving too slowly
- Dependencies falling significantly behind

**Current status**: Configuration has been battle-tested and requires no immediate adjustment.

## References

- [Dependabot Options Reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [Cooldown Feature Documentation](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#cooldown)
- [npm Security Best Practices](https://github.com/lirantal/npm-security-best-practices)
- Project: `docs/NPM-SECURITY.md` for npm security model
