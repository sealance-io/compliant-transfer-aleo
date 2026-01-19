# Dependabot Strategy

This document explains the rationale behind our Dependabot configuration. For implementation details, see `.github/dependabot.yml` (inline comments).

## Policy Summary

| Setting | npm | GitHub Actions |
|---------|-----|----------------|
| Schedule | Daily | Weekly (Monday) |
| Cooldown (minor) | 7 days | 21 days |
| Cooldown (patch) | 3 days | 21 days |
| Major updates | Blocked | Grouped |
| Grouping | Aggressive | All grouped |
| PR limit | 5 | 5 |

## Core Principles

1. **Security first** - Security updates bypass all cooldowns automatically
2. **Stability over speed** - Cooldowns prevent adopting buggy releases
3. **Exact versioning** - No `^` or `~` ranges; deterministic builds
4. **Aggressive grouping** - Reduce PR noise while keeping SDK deps separate
5. **Pragmatic blocking** - Patched packages (`@doko-js/*`) require manual updates

## npm Ecosystem

### Cooldown Policy (7/3 days)

Based on [empirical attack data](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns):

| Cooldown | Attacks Blocked | Our Choice |
|----------|-----------------|------------|
| 3 days | ~60% | Patches |
| 7 days | ~80% | Minor |
| 14 days | ~90% | Too conservative |

We chose GitHub's recommended defaults (7/3) to balance security with avoiding the ["stuck forever" bug](https://github.com/dependabot/dependabot-core/issues/13691) where frequently-released packages never update.

### Grouping Strategy

**Aggressive grouping** - all dependencies in a single PR, except:

| Excluded | Reason |
|----------|--------|
| `@provablehq/*` | SDK dependency - needs careful review for Aleo compatibility |
| `@scure/base` | SDK dependency - cryptographic library |
| `@doko-js/*` | Blocked entirely (custom patches) |

This reduces PR volume significantly while ensuring SDK-affecting changes get individual attention.

### Blocked Updates

- **`@doko-js/*`** - Custom patches in `/patches`; updates would break patches
- **All major versions** - Breaking changes require manual review (security updates bypass)

## GitHub Actions Ecosystem

### SHA Pinning Trade-off

We use commit SHA pinning (`@abc123...`) instead of semver tags (`@v4`):

| | Semver Tags | SHA Pinning |
|-|-------------|-------------|
| Security alerts | Yes | **No** |
| Tag hijacking protection | No | **Yes** |
| Immutability | No | **Yes** |

**Why SHA despite no security alerts?** A compromised tag can be silently updated; a SHA cannot. We compensate through:
- 21-day cooldown for community vetting
- Manual changelog review on each PR
- Weekly `zizmor` workflow audits

### Review Guidelines

Since SHA-pinned actions don't receive automatic security alerts:

| Risk Level | Actions | Review |
|------------|---------|--------|
| Lower | Official (`actions/*`, `github/*`), patch versions | Standard review |
| Higher | Third-party, major versions, write permissions | Enhanced scrutiny |

## Integration with Security Stack

Dependabot is one layer in defense-in-depth:

1. **Install** - `npm ci --ignore-scripts` (deterministic, safe)
2. **Validate** - `lockfile-lint` (registry sources, HTTPS)
3. **Scan** - `npm audit` (known vulnerabilities)
4. **Update** - Dependabot (automated with cooldowns)
5. **Review** - Human approval before merge
6. **Audit** - `zizmor` (weekly workflow security)

## When to Adjust

**Increase cooldowns if:** >10% of updates introduce bugs or excessive review burden

**Decrease cooldowns if:** Security updates delayed, dependencies falling behind, known vulnerabilities not addressed

## References

- [Dependabot Options Reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [Dependency Cooldowns Security Analysis](https://blog.yossarian.net/2025/11/21/We-should-all-be-using-dependency-cooldowns)
- [Cooldown "Stuck Forever" Bug](https://github.com/dependabot/dependabot-core/issues/13691)
- Project: `docs/NPM-SECURITY.md` for npm security model
