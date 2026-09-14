/**
 * Committed, zero-dependency lockfile validator.
 *
 * Checks that every resolved URL in package-lock.json points to the npm
 * registry over HTTPS, requires integrity for resolved packages, and rejects
 * non-registry sources encoded in `version` when `resolved` is absent, except
 * for the explicitly allowed local LionDen package links used during
 * development.
 *
 * Runs as an explicit validation step before `npm ci` without bootstrapping
 * any package from the registry.
 */

import { readFileSync } from "node:fs";

const ALLOWED_PREFIX = "https://registry.npmjs.org/";
const ALLOWED_LOCAL_LIONDEN_PACKAGES = new Map([
  ["node_modules/@lionden/cli", "file:../lionden/packages/cli"],
  ["node_modules/@lionden/config", "file:../lionden/packages/config"],
  ["node_modules/@lionden/core", "file:../lionden/packages/core"],
  ["node_modules/@lionden/leo-compiler", "file:../lionden/packages/leo-compiler"],
  ["node_modules/@lionden/network", "file:../lionden/packages/network"],
  ["node_modules/@lionden/plugin-deploy", "file:../lionden/packages/plugin-deploy"],
  ["node_modules/@lionden/plugin-leo", "file:../lionden/packages/plugin-leo"],
  ["node_modules/@lionden/plugin-network", "file:../lionden/packages/plugin-network"],
  ["node_modules/@lionden/plugin-test", "file:../lionden/packages/plugin-test"],
  ["node_modules/@lionden/testing", "file:../lionden/packages/testing"],
]);
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
  const allowedLocalLiondenSource = ALLOWED_LOCAL_LIONDEN_PACKAGES.get(name);

  if (allowedLocalLiondenSource && !resolved && version === allowedLocalLiondenSource) {
    continue;
  }

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
