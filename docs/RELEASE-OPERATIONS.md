# SDK Release Operations

Maintainer/admin reference for `@sealance-io/policy-engine-aleo` releases: configuration, emergency procedures, troubleshooting, and workflow internals. For the contributor workflow (changesets, pre-releases), see [RELEASING.md](RELEASING.md).

## Workflow Internals

- **Release detection**: `sdk-release-publish.yml` runs on `push` to `main` (so it satisfies the `main`-only environment rule) and only publishes if the pushed commit's merged PR came from `changeset-release/main`. Maintainers can also dispatch it manually on `main` for recovery; environment approval still applies.
- **Runtime audit**: runs before the approval gate; high/critical vulnerabilities in the SDK's runtime dependencies block the release.
- **Retry**: `npm publish` retries up to 3 times with 30s backoff.
- **Idempotent**: publish skips if `npm view` shows the version already exists; tag/release creation skips if it already exists. Re-running after a partial failure is safe. Check the `Release Status` job for the actual outcome.
- **Security**: no stored npm tokens (OIDC), provenance on every publish, npm cache disabled in release workflows (cache poisoning), fresh dependency downloads, and only workflows on `main` can request the protected environment.

---

## GitHub Environment Configuration

### `npm-publish` (Critical)

Primary security gate for publishing. `Repository Settings → Environments → npm-publish`

| Setting                   | Value                | Rationale                                                       |
| ------------------------- | -------------------- | --------------------------------------------------------------- |
| **Required reviewers**    | 2+ repository admins | Enforces two-person rule                                        |
| **Prevent self-review**   | ✅ Enabled           | Person who triggered can't approve themselves                   |
| **Allow admin bypass**    | ❌ Disabled          | A compromised admin account can't publish alone                 |
| **Deployment branches**   | `main` only          | Blocks feature branches, fork PRs, and compromised PR workflows |
| **Wait timer** (optional) | 0-5 minutes          | Cooling-off period before deployment proceeds                   |

The `publish-npm` job pauses before any steps run; reviewers approve or reject via Actions → "Review deployments". Rejection fails the job without publishing.

### `release-automation` (Versioning)

Used by the `version` job in `sdk-release-version.yml`. `Repository Settings → Environments → release-automation`

| Setting                 | Value       | Rationale                                         |
| ----------------------- | ----------- | ------------------------------------------------- |
| **Required reviewers**  | None        | Job runs automatically on every push to `main`    |
| **Deployment branches** | `main` only | Keeps the environment secret away from other refs |

- Secret `SEALANCE_PUBLIC_SIGNER_APP_PRIVATE_KEY`: GitHub App PEM key (stored in this environment)
- Variable `SEALANCE_PUBLIC_SIGNER_APP_ID`: org-level Actions variable (not a secret)

A GitHub App is used instead of `GITHUB_TOKEN` because PRs created with `GITHUB_TOKEN` don't trigger `pull_request` CI. The `sealance-public-signer` bot identity lets CI run on the release PR.

### npm Trusted Publisher

At https://www.npmjs.com/package/@sealance-io/policy-engine-aleo/access, the trusted publisher must be:

- **Organization**: `sealance-io`
- **Repository**: `compliant-transfer-aleo`
- **Workflow**: `sdk-release-publish.yml`
- **Environment**: `npm-publish`

---

## Troubleshooting

### "Version Packages" PR Not Created

- Ensure changesets exist in `.changeset/` (not just `README.md`)
- Check `sdk-release-version.yml` ran successfully and its `paths` filter includes your changes
- Verify `release-automation` exists, has no required reviewers (they block automated jobs), and allows `main`
- Verify `SEALANCE_PUBLIC_SIGNER_APP_ID` (org variable) and `SEALANCE_PUBLIC_SIGNER_APP_PRIVATE_KEY` (environment secret) are set

### OIDC Publish Failed (404)

- Verify the trusted publisher config above matches exactly
- Check npm CLI is 11.5.1+ (bundled with Node 24)

### Approval Not Requested

- Verify `npm-publish` exists with required reviewers and the job uses `environment: npm-publish`
- Verify the run was triggered by `push` to `main`, not a `pull_request` ref such as `refs/pull/<n>/merge`

### Provenance Not Generated

- Requires a public repository
- Verify `id-token: write` is set on the publish job

### Re-run After Failure

Re-runs are idempotent (see above). If the run failed before approval because the workflow itself was misconfigured, merge the fix, then `workflow_dispatch` `sdk-release-publish.yml` from `main`.

---

## Emergency Procedures

All emergency actions require **two-person approval** (involve another admin). Checklist:

- [ ] Get second admin approval
- [ ] Document the issue and reason
- [ ] Perform and verify the action
- [ ] Communicate to users if needed (GitHub issue, README update)
- [ ] Write a post-incident report and fix the root cause

### Manual Publish (Workflow Broken)

Only when the automated workflow is broken and can't be fixed quickly:

```bash
git clone https://github.com/sealance-io/compliant-transfer-aleo.git
cd compliant-transfer-aleo
npm run lint:lockfile
npm ci --ignore-scripts --allow-git=none
npm run build --workspace=@sealance-io/policy-engine-aleo
npm login                                                 # requires 2FA
npm publish --workspace=@sealance-io/policy-engine-aleo   # prompts for OTP
npm view @sealance-io/policy-engine-aleo version
```

Afterwards: create the GitHub Release manually and fix the workflow.

### Rollback (Move `latest`)

```bash
npm dist-tag ls @sealance-io/policy-engine-aleo
npm dist-tag add @sealance-io/policy-engine-aleo@<good-version> latest
```

The bad version stays installable by explicit version; deprecate it as well.

### Deprecate a Bad Version

```bash
npm deprecate @sealance-io/policy-engine-aleo@<bad-version> "Critical bug in Merkle proof generation, upgrade to <good-version>"
```

### Unpublish (Last Resort)

```bash
npm unpublish @sealance-io/policy-engine-aleo@<version>
```

Only for leaked secrets/credentials, severe vulnerabilities with no workaround, or a corrupt package. Prefer deprecation plus a new version. Eligibility depends on the package's age, dependents, weekly downloads, and number of owners; see npm's [unpublish policy](https://docs.npmjs.com/policies/unpublish/). An unpublished version number can never be reused.

---

## Release Automation Backlog

- [ ] Add a PR CI guard for semantic changes to `dependencies` or
      `peerDependencies` in `packages/policy-engine-sdk/package.json`, compared with
      the PR base. Require a new or updated, valid changeset that names
      `@sealance-io/policy-engine-aleo`; an unrelated changeset must not satisfy it.
      Ignore formatting-only changes and changes limited to `devDependencies`.
      Handle automated version PRs explicitly, since they consume changesets; scope
      any exemption to the verified release automation rather than a branch name alone.
      Cover missing, unrelated, and valid changesets, dependency additions/removals,
      peer dependency changes, and the automated version PR path in tests.

---

**Last Updated**: 2026-09-30
