# SDK Release Process

Release workflow for `@sealance-io/policy-engine-aleo`, managed with [Changesets](https://github.com/changesets/changesets) and published by GitHub Actions via [npm OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers/) (no stored npm tokens, automatic provenance, reviewer approval required).

**Maintainers/admins:** environment setup, emergency procedures (rollback, deprecate, unpublish, manual publish), troubleshooting, and workflow internals live in [RELEASE-OPERATIONS.md](RELEASE-OPERATIONS.md).

## Release Flow

```
1. PR with changeset merged to main
2. sdk-release-version.yml creates/updates the "Version Packages" PR
   (authored by sealance-public-signer[bot], so pull_request CI runs normally)
3. Maintainer reviews and merges the release PR
4. sdk-release-publish.yml runs a runtime dependency audit, then pauses for
   npm-publish environment approval
5. Package published to npm (OIDC, provenance) and GitHub Release created
```

Multiple merged changesets accumulate in the "Version Packages" PR until a maintainer merges it.

---

## Adding a Changeset

```bash
npx changeset          # select @sealance-io/policy-engine-aleo, bump type, summary
npx changeset status   # preview pending version changes
```

This creates `.changeset/<random-name>.md`; commit it with your PR:

```markdown
---
"@sealance-io/policy-engine-aleo": minor
---

Add support for custom Merkle tree depth configuration
```

- Write the summary for users reading the CHANGELOG.
- You may edit the summary or bump type, or delete the file. Don't rename it or create it by hand.
- Add one changeset per logically separate user-facing change (each becomes its own CHANGELOG entry), not one per commit.
- Forgot one? Nothing breaks and nothing releases. Add it later in a follow-up PR containing only the changeset.

### Bump Type

| Change Type                  | Bump Type | Example                                |
| ---------------------------- | --------- | -------------------------------------- |
| Bug fix                      | `patch`   | Fix incorrect proof generation         |
| SDK `README.md` update       | `patch`   | Fix typos, update usage                |
| Dependency update (minor)    | `patch`   | Update compatible dependencies         |
| New feature                  | `minor`   | Add new API method                     |
| Deprecation                  | `minor`   | Mark old method as deprecated          |
| Breaking change              | `major`   | Change function signature, remove API  |
| Dependency update (breaking) | `major`   | Update to incompatible @provablehq/sdk |

### When NOT to Add a Changeset

**Rule of thumb**: if the change doesn't affect what users `npm install`, it doesn't need a changeset. Skip for:

- Test-only changes, CI/workflow changes, dev tooling (ESLint, TypeScript config)
- Internal refactoring with no public API impact
- Non-SDK files: Leo programs, recipes, scripts, root-level docs
- SDK files that don't ship to npm: `API.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md` (auto-generated), `examples/`, `test/`

Only `package.json`, `dist/`, `README.md`, and `LICENSE` ship (`files` in `packages/policy-engine-sdk/package.json`). Changes to published `package.json` metadata (`exports`, `engines`, dependencies, etc.) need a changeset.

---

## Pre-release Versions (Alpha/Beta/RC)

```bash
npx changeset pre enter alpha   # or beta / rc; creates .changeset/pre.json (commit it)
npx changeset                   # add changesets as usual
# Merge to main → Version PR yields 1.0.0-alpha.0, then 1.0.0-alpha.1, ...

npx changeset pre exit          # when ready for stable; next Version PR yields 1.0.0
```

Pre-release mode persists until exited. Pre-releases go through the same approval gates, are marked as pre-release on GitHub, and publish to a dist-tag chosen by `sdk-release-publish.yml`, so they never become the default install:

| Version Pattern | Dist-tag | Install Command                                     |
| --------------- | -------- | --------------------------------------------------- |
| `1.0.0`         | `latest` | `npm install @sealance-io/policy-engine-aleo`       |
| `1.0.0-alpha.0` | `alpha`  | `npm install @sealance-io/policy-engine-aleo@alpha` |
| `1.0.0-beta.0`  | `beta`   | `npm install @sealance-io/policy-engine-aleo@beta`  |
| `1.0.0-rc.0`    | `rc`     | `npm install @sealance-io/policy-engine-aleo@rc`    |
| `1.0.0-foo.0`   | `next`   | `npm install @sealance-io/policy-engine-aleo@next`  |

---

## Blocked or Failed Releases

If the runtime audit blocks a release (high/critical vulnerabilities in the SDK's runtime dependency tree), or the publish workflow was broken at merge time: fix it, merge to `main`, then manually dispatch `sdk-release-publish.yml` on `main`. The `npm-publish` approval still applies. Re-runs are idempotent. See [RELEASE-OPERATIONS.md](RELEASE-OPERATIONS.md#troubleshooting).

## Verification

After release, check:

1. **npm**: https://www.npmjs.com/package/@sealance-io/policy-engine-aleo (correct version, provenance badge)
2. **GitHub Releases**: https://github.com/sealance-io/compliant-transfer-aleo/releases
3. **Provenance**: `npm audit signatures` in a project using the package

---

**Last Updated**: 2026-09-30
