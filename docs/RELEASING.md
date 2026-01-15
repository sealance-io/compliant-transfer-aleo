# SDK Release Process

This document describes the release workflow for `@sealance-io/policy-engine-aleo`.

## Overview

Releases are managed using [Changesets](https://github.com/changesets/changesets) and published automatically via GitHub Actions with [npm OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers/).

**Key Features:**

- Tokenless publishing via OIDC (no npm tokens stored in secrets)
- Automatic provenance attestation
- Required reviewer approval before publish
- Robust publishing with retry logic and verification
- Idempotent releases (safe to re-run workflows)
- Documented emergency procedures (rollback, deprecate, unpublish)

## Release Flow

```
1. Developer makes changes
         ↓
2. Developer adds changeset
         ↓
3. PR merged to main
         ↓
4. Versioning workflow creates "Version Packages" PR
         ↓
5. Maintainer reviews and merges release PR
         ↓
6. Admin approves deployment (GitHub environment protection)
         ↓
7. Package published to npm (OIDC) and GitHub Packages
         ↓
8. GitHub Release created automatically
```

---

## Adding a Changeset

When you make a change that should be released, add a changeset:

```bash
npx changeset
```

Follow the prompts:

1. **Select packages**: Choose `@sealance-io/policy-engine-aleo`
2. **Select bump type**:
   - `patch` - Bug fixes, documentation
   - `minor` - New features (backwards compatible)
   - `major` - Breaking changes
3. **Summary**: Write a brief description of the change

This creates a markdown file in `.changeset/` that will be consumed during release.

### Example Changeset

```markdown
---
"@sealance-io/policy-engine-aleo": minor
---

Add support for custom Merkle tree depth configuration
```

### When to Add Changesets

| Change Type                  | Bump Type | Example                                |
| ---------------------------- | --------- | -------------------------------------- |
| Bug fix                      | `patch`   | Fix incorrect proof generation         |
| Documentation                | `patch`   | Update README, fix typos               |
| New feature                  | `minor`   | Add new API method                     |
| Deprecation                  | `minor`   | Mark old method as deprecated          |
| Breaking change              | `major`   | Change function signature, remove API  |
| Dependency update (breaking) | `major`   | Update to incompatible @provablehq/sdk |
| Dependency update (minor)    | `patch`   | Update compatible dependencies         |

### When NOT to Add Changesets

Not all changes require a release. Skip changesets for:

- **Test-only changes**: Adding/fixing tests without SDK code changes
- **CI/workflow changes**: GitHub Actions, dependabot config
- **Internal refactoring**: Code reorganization with no public API impact
- **Development tooling**: ESLint config, TypeScript config changes
- **Non-SDK files**: Leo programs, deployment scripts, root-level docs
- **Internal SDK docs**: `DEVELOPMENT.md`, `QUICK_START.md` (don't ship to npm)

**Rule of thumb**: If the change doesn't affect what users `npm install`, it doesn't need a changeset.

**Note on SDK markdown files:**

| File             | Ships to npm? | Needs changeset?       |
| ---------------- | ------------- | ---------------------- |
| `README.md`      | ✅ Yes        | ✅ Yes (patch)         |
| `CHANGELOG.md`   | ✅ Yes (auto) | ❌ No (auto-generated) |
| `DEVELOPMENT.md` | ❌ No         | ❌ No                  |
| `QUICK_START.md` | ❌ No         | ❌ No                  |

---

## Developer Workflow (Feature Branches)

This section explains the day-to-day workflow for contributing SDK changes.

### Step-by-Step: Feature Branch to Release

```bash
# 1. Create feature branch
git switch -b feat/add-custom-tree-depth

# 2. Make your changes to the SDK
#    Edit files in packages/policy-engine-sdk/src/

# 3. Add a changeset (do this BEFORE or WITH your PR)
npx changeset
# → Select @sealance-io/policy-engine-aleo
# → Select bump type (patch/minor/major)
# → Write a summary of your change

# 4. Commit everything including the changeset file
git add .
git commit -m "feat: add custom Merkle tree depth configuration"

# 5. Push and create PR
git push -u origin feat/add-custom-tree-depth
# Create PR via GitHub UI or CLI
```

### What Happens Next

```
Your PR (with changeset)
         ↓
    Code review
         ↓
    PR merged to main
         ↓
    Versioning workflow runs automatically
         ↓
    "Version Packages" PR created/updated
         ↓
    (Your changeset is now queued for release)
```

Multiple PRs with changesets accumulate in the "Version Packages" PR until a maintainer decides to release.

### Changeset Files Explained

When you run `npx changeset`, it creates a file like:

```
.changeset/purple-lions-dance.md
```

The filename is randomly generated (adjective-noun-verb). The content looks like:

```markdown
---
"@sealance-io/policy-engine-aleo": minor
---

Add support for custom Merkle tree depth configuration
```

**You can:**

- Edit the summary text before committing
- Edit the bump type if you reconsider
- Delete the file if you decide not to release this change

**You should NOT:**

- Rename the file (the random name prevents merge conflicts)
- Create files manually (use `npx changeset` to ensure correct format)

### Multiple Changesets Per PR

Add multiple changesets when your PR contains **logically separate changes** that users would want to see as distinct CHANGELOG entries:

```bash
# First changeset for the new feature
npx changeset
# → minor: "Add custom tree depth configuration"

# Second changeset for a bug fix discovered during development
npx changeset
# → patch: "Fix edge case in proof verification"
```

Both will appear as separate entries in the CHANGELOG.

**Don't** add multiple changesets for parts of the same feature—one changeset per logical user-facing change.

### Forgot to Add a Changeset?

If you merge a PR without a changeset:

- **Nothing breaks** - the PR merges normally
- **No release happens** - changes wait until someone adds a changeset
- **You can add it later** - create a follow-up PR with just the changeset

To add a changeset for already-merged changes:

```bash
git switch main
git pull
git switch -b chore/add-missing-changeset
npx changeset
# Describe the change that was already merged
git add .changeset/
git commit -m "chore: add changeset for <feature>"
git push -u origin chore/add-missing-changeset
# Create PR
```

### PR Review Checklist

When reviewing PRs that modify the SDK:

- [ ] Does it include a changeset? (if it should be released)
- [ ] Is the bump type appropriate? (patch/minor/major)
- [ ] Is the changeset summary clear for users reading the CHANGELOG?
- [ ] If no changeset, is that intentional? (test-only, internal, etc.)

---

## Release Workflows

### Normal Release (Automated)

1. **Version PR Created**: When changesets exist on `main`, the `sdk-release-version.yml` workflow creates a "Version Packages" PR

2. **Review & Merge**: Maintainer reviews the version bumps and CHANGELOG updates, then merges

3. **Approval Required**: When the release PR is merged, the `sdk-release-publish.yml` workflow runs but pauses for admin approval (GitHub environment protection)

4. **Publish**: After approval:
   - Package is published to npm.js via OIDC (with provenance and retry logic)
   - Publication is verified by checking npm registry
   - Package is published to GitHub Packages (non-blocking - failures don't stop the release)
   - GitHub Release is created with tag (idempotent - safe to re-run)

### Pre-release Versions (Alpha/Beta/RC)

Changesets has built-in pre-release mode for publishing alpha, beta, and release candidate versions.

#### Enter Pre-release Mode

```bash
# Start a pre-release series (choose one)
npx changeset pre enter alpha   # For alpha releases (1.0.0-alpha.0)
npx changeset pre enter beta    # For beta releases (1.0.0-beta.0)
npx changeset pre enter rc      # For release candidates (1.0.0-rc.0)
```

This creates `.changeset/pre.json` to track pre-release state.

#### Make Changes and Add Changesets

```bash
# Work on features/fixes as normal
# Add changesets for your changes
npx changeset
```

#### Version and Release

When the versioning workflow runs (or manually):

```bash
npx changeset version  # Creates 1.0.0-alpha.0, then 1.0.0-alpha.1, etc.
```

The publish workflow automatically:

- Detects pre-release versions (contains `-`)
- Publishes with appropriate dist-tag (`alpha`, `beta`, `rc`, or `next`)
- Marks GitHub Release as pre-release

#### Exit Pre-release Mode

When ready to release stable:

```bash
npx changeset pre exit  # Removes pre-release mode
npx changeset version   # Next version will be stable (1.0.0)
```

#### Dist-tag Behavior

| Version Pattern | Dist-tag | Install Command                                     |
| --------------- | -------- | --------------------------------------------------- |
| `1.0.0`         | `latest` | `npm install @sealance-io/policy-engine-aleo`       |
| `1.0.0-alpha.0` | `alpha`  | `npm install @sealance-io/policy-engine-aleo@alpha` |
| `1.0.0-beta.0`  | `beta`   | `npm install @sealance-io/policy-engine-aleo@beta`  |
| `1.0.0-rc.0`    | `rc`     | `npm install @sealance-io/policy-engine-aleo@rc`    |
| `1.0.0-foo.0`   | `next`   | `npm install @sealance-io/policy-engine-aleo@next`  |

#### Example: Full Pre-release Cycle

```bash
# 1. Enter alpha mode
npx changeset pre enter alpha

# 2. Add changeset for new feature
npx changeset
# Select: @sealance-io/policy-engine-aleo
# Select: minor
# Summary: Add new API method

# 3. Push to main → Version PR created with 1.0.0-alpha.0

# 4. Merge Version PR → Published to npm with @alpha tag

# 5. Continue development, add more changesets
npx changeset
# ... more changes ...

# 6. Push → Next Version PR has 1.0.0-alpha.1

# 7. When ready for stable release
npx changeset pre exit

# 8. Push → Version PR created with 1.0.0 (stable)
```

#### Important Notes

- Pre-release mode is **persistent** until explicitly exited
- The `.changeset/pre.json` file must be committed
- Pre-releases still require the same approval gates as stable releases
- Users must explicitly opt-in to pre-releases (`@alpha`, `@beta`, etc.)

---

## Emergency Procedures

This section covers manual procedures for emergency situations. All emergency actions require **two-person approval** (get another admin involved).

### Manual Publish (When Workflow is Broken)

Use only when the automated workflow is broken and cannot be fixed quickly.

```bash
# 1. Clone and checkout main
git clone https://github.com/sealance-io/compliant-transfer-aleo.git
cd compliant-transfer-aleo

# 2. Install and build
npm ci
npm run build --workspace=@sealance-io/policy-engine-aleo

# 3. Login to npm (requires 2FA)
npm login

# 4. Publish (will prompt for OTP)
npm publish --workspace=@sealance-io/policy-engine-aleo

# 5. Verify
npm view @sealance-io/policy-engine-aleo version
```

**Post-publish:**

- Create GitHub Release manually
- Document the incident
- Fix the broken workflow

### Rollback to Previous Version

If a bad version was published and you need to make a previous version the default:

```bash
# Check current dist-tags
npm dist-tag ls @sealance-io/policy-engine-aleo

# Move "latest" tag to a known good version
npm dist-tag add @sealance-io/policy-engine-aleo@<good-version> latest

# Example: rollback from 1.2.3 to 1.2.2
npm dist-tag add @sealance-io/policy-engine-aleo@1.2.2 latest
```

**Note:** This doesn't remove the bad version - users who explicitly request it can still install it. Consider deprecation as well.

### Deprecate a Bad Version

Warn users away from a problematic version without removing it:

```bash
# Deprecate with a message
npm deprecate @sealance-io/policy-engine-aleo@<bad-version> "Security issue, upgrade to <good-version>"

# Example
npm deprecate @sealance-io/policy-engine-aleo@1.2.3 "Critical bug in Merkle proof generation, upgrade to 1.2.4"
```

Users will see a warning when installing the deprecated version.

### Unpublish a Version (Last Resort)

Remove a version entirely. **Use with extreme caution.**

```bash
npm unpublish @sealance-io/policy-engine-aleo@<version>
```

**Limitations:**

- Only works within **72 hours** of publish
- Only works if the package has **fewer than 300 downloads/week**
- Cannot unpublish if other packages depend on that exact version
- Leaves a "hole" in version history (can't reuse that version number)

**When to unpublish:**

- Accidentally published secrets/credentials
- Severe security vulnerability with no workaround
- Published completely broken/corrupt package

**Prefer deprecation + new version** over unpublish in most cases.

### Emergency Checklist

For any emergency action:

- [ ] Get second admin approval (two-person rule)
- [ ] Document the issue and reason for emergency action
- [ ] Perform the action
- [ ] Verify the result
- [ ] Communicate to users if needed (GitHub issue, README update)
- [ ] Create post-incident report
- [ ] Fix root cause to prevent recurrence

---

## GitHub Environment Configuration

### `npm-publish` Environment (Critical)

This is the primary security gate for npm publishing. Configure at:
`Repository Settings → Environments → npm-publish`

| Setting                   | Value                | Rationale                                       |
| ------------------------- | -------------------- | ----------------------------------------------- |
| **Required reviewers**    | 2+ repository admins | Enforces two-person rule                        |
| **Prevent self-review**   | ✅ Enabled           | Person who triggered can't approve themselves   |
| **Allow admin bypass**    | ❌ Disabled          | Use break-glass workflow for emergencies        |
| **Deployment branches**   | `main` only          | Prevents publishing from feature branches/forks |
| **Wait timer** (optional) | 0-5 minutes          | Cooling-off period before deployment proceeds   |

**Why disable admin bypass?**

- Maintains two-person rule even for admins
- If an admin account is compromised, attacker still can't publish alone
- Break-glass workflow provides audited emergency path
- Bypass would allow silent malicious publishes

### `github-packages` Environment (Secondary)

Less critical since GitHub Packages is non-blocking. Configure at:
`Repository Settings → Environments → github-packages`

| Setting                 | Value       | Rationale                    |
| ----------------------- | ----------- | ---------------------------- |
| **Required reviewers**  | None        | Non-blocking job, low risk   |
| **Deployment branches** | `main` only | Consistency with npm-publish |

**Why no required reviewers?**

- GitHub Packages is secondary (npm is primary)
- Publishing is non-blocking (`continue-on-error: true`)
- Failure just means GitHub Packages is out of sync
- Adding reviewers would require two approval gates

### How Approval Works

When the publish workflow runs:

1. `publish-npm` job starts and sees `environment: npm-publish`
2. Job **pauses** before any steps execute
3. GitHub notifies required reviewers via email/UI
4. Reviewer opens Actions → clicks "Review deployments"
5. Reviewer can inspect the changes and approve or reject
6. If approved → job proceeds with publishing
7. If rejected → job fails, nothing is published

### Branch Protection Impact

Setting `Deployment branches: main only` ensures:

| Scenario                   | Result                     |
| -------------------------- | -------------------------- |
| Workflow on `main`         | ✅ Can request environment |
| Workflow on feature branch | ❌ Blocked                 |
| Workflow from fork PR      | ❌ Blocked                 |
| Compromised PR workflow    | ❌ Blocked                 |

This prevents attackers from triggering publishes via malicious PRs or compromised feature branches.

---

## npm Trusted Publisher Configuration

Configure on npmjs.com:

1. Go to: https://www.npmjs.com/package/@sealance-io/policy-engine-aleo/access
2. Add trusted publisher with:
   - **Organization**: `sealance-io`
   - **Repository**: `compliant-transfer-aleo`
   - **Workflow**: `sdk-release-publish.yml`
   - **Environment**: `npm-publish`

---

## Verification

After release, verify:

1. **npm**: https://www.npmjs.com/package/@sealance-io/policy-engine-aleo
   - Check version is correct
   - Check provenance badge appears

2. **GitHub Packages**: https://github.com/sealance-io/compliant-transfer-aleo/packages

3. **GitHub Releases**: https://github.com/sealance-io/compliant-transfer-aleo/releases

4. **Provenance**: Run `npm audit signatures` in a project using the package

---

## Troubleshooting

### "Version Packages" PR Not Created

- Ensure changesets exist in `.changeset/` (not just README.md)
- Check `sdk-release-version.yml` workflow ran successfully
- Verify paths filter includes your changes

### OIDC Publish Failed (404)

- Verify trusted publisher config on npmjs.com exactly matches:
  - Org: `sealance-io`
  - Repo: `compliant-transfer-aleo`
  - Workflow: `sdk-release-publish.yml`
  - Environment: `npm-publish`
- Check npm CLI version is 11.5.1+ (bundled with Node 24)

### Approval Not Requested

- Verify `npm-publish` environment exists with required reviewers
- Check the workflow uses `environment: npm-publish`

### Provenance Not Generated

- This requires public repository (private repos don't generate provenance)
- Verify `id-token: write` permission is set in the publish job

### Workflow Re-run After Partial Failure

The workflow is designed to be idempotent. If a re-run is needed:

- npm publish will fail if package version already exists (expected - means it succeeded previously)
- GitHub tag/release creation will skip if already exists
- Check the `Release Status` job for the actual outcome

### GitHub Packages Failed But Release Succeeded

This is expected behavior. GitHub Packages is non-blocking:

- npm is the primary registry - users can install from there
- Check the warning in the workflow logs for details
- Manually publish to GitHub Packages later if needed

---

## Scripts Reference

```bash
# Add a changeset
npx changeset

# Preview version changes (dry-run)
npm run version

# Manual release (not recommended - use workflows)
npm run release
```

---

## Robustness Features

The release workflow includes several robustness features to handle transient failures:

### Dry-run Validation

Before actual publishing, the workflow runs `npm publish --dry-run` to validate:

- Package contents and structure are correct
- Version doesn't already exist on the registry
- Package.json configuration is valid
- Files included/excluded match expectations

This catches configuration errors early without any risk of publishing a broken package.

### Retry Logic

npm publish retries up to 3 times with 30-second backoff between attempts. This handles transient network issues or npm registry slowdowns.

### Pre-release Dist-tags

The workflow automatically detects pre-release versions and publishes with appropriate dist-tags:

- `1.0.0-alpha.X` → published with `--tag alpha`
- `1.0.0-beta.X` → published with `--tag beta`
- `1.0.0-rc.X` → published with `--tag rc`
- Other pre-releases → published with `--tag next`
- Stable versions → published to `latest` (default)

This ensures pre-releases don't accidentally become the default install.

### Post-Publish Verification

After publishing, the workflow verifies the package is available on npm by running `npm view`. This catches rare cases where publish appears to succeed but the package isn't immediately available.

### Non-Blocking GitHub Packages

GitHub Packages publishing is non-blocking (`continue-on-error: true`). If it fails:

- The release still succeeds (npm is the primary registry)
- A warning is logged
- Users can still install from npm

### Idempotent Releases

The GitHub Release creation handles re-runs gracefully:

- If the tag already exists, it continues without error
- If the release already exists, it continues without error
- This allows safe workflow re-runs after partial failures

### Release Detection

The publish workflow detects release PRs by checking the source branch name (`changeset-release/main`), which is more robust than PR title matching since the branch name is deterministic and set by changesets.

---

## Security Notes

1. **No stored npm tokens**: OIDC eliminates long-lived tokens entirely
2. **Provenance**: Every publish includes cryptographic proof of build origin
3. **Two-person rule**: Emergency procedures require second admin approval
4. **Environment protection**: Publishing requires reviewer approval via GitHub environments
5. **Cache disabled**: Release workflows disable npm caching to prevent cache poisoning attacks
6. **Fresh downloads**: Dependencies are downloaded fresh from npm registry during releases
7. **Branch restrictions**: Only workflows on `main` can trigger publishing

---

**Last Updated**: 2026-01-12
