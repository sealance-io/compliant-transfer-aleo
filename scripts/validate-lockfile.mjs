/**
 * Committed, zero-dependency lockfile validator.
 *
 * Checks that every resolved URL in package-lock.json points to the npm
 * registry over HTTPS, requires integrity for resolved packages, and rejects
 * non-registry sources encoded in `version` when `resolved` is absent.
 *
 * Runs as an explicit validation step before `npm ci` without bootstrapping
 * any package from the registry.
 */

import { readFileSync } from "node:fs";

const ALLOWED_PREFIX = "https://registry.npmjs.org/";
const SEMVER_REGEXP =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const raw = readFileSync("package-lock.json", "utf8");
const lock = JSON.parse(raw);

if (!lock.lockfileVersion || lock.lockfileVersion < 2) {
  console.error(`Lockfile version ${lock.lockfileVersion ?? "missing"} is unsupported (requires >= 2)`);
  process.exit(1);
}

const packages = lock.packages ?? {};
const violations = [];

for (const [name, info] of Object.entries(packages)) {
  // Skip root package and workspace links
  if (!name || info.link) continue;

  const { resolved, integrity, version } = info;

  // Validate resolved URL if present.
  if (resolved) {
    if (!resolved.startsWith(ALLOWED_PREFIX)) {
      violations.push(`${name}: resolved URL not on npm registry: ${resolved}`);
    }
  }

  // When resolved is absent, version may encode a non-registry source
  // (tarball URL, git URL, file: path, etc.). Only valid semver versions
  // are safe — reject anything else to match the repo's registry-only policy.
  if (!resolved && version && !SEMVER_REGEXP.test(version)) {
    violations.push(`${name}: non-registry source in version: ${version}`);
  }

  if (resolved && !integrity) {
    violations.push(`${name}: missing integrity hash`);
  }
}

if (violations.length > 0) {
  console.error("Lockfile validation failed:\n");
  for (const v of violations) {
    console.error(`  ✗ ${v}`);
  }
  console.error(`\n${violations.length} violation(s) found.`);
  process.exit(1);
}

console.log(`Lockfile OK: ${Object.keys(packages).length} packages validated.`);
