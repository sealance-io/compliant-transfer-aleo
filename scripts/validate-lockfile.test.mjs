/**
 * Self-contained tests for validate-lockfile.mjs.
 * No test framework needed — uses Node.js built-in assert.
 *
 * Run: node scripts/validate-lockfile.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "validate-lockfile.mjs");

function run(lockfileContent) {
  // Each test gets an isolated temp directory so the real lockfile is never
  // modified, even if the process exits unexpectedly.
  const dir = mkdtempSync(join(tmpdir(), "validate-lockfile-"));
  const path = join(dir, "package-lock.json");

  try {
    writeFileSync(path, JSON.stringify(lockfileContent, null, 2));
    const output = execFileSync("node", [SCRIPT], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (err) {
    return {
      exitCode: err.status,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Test 1: Current lockfile passes validation ─────────────────────────────
console.log("Test 1: Current lockfile passes validation...");
const result1 = execFileSync("node", [SCRIPT], {
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
});
assert.match(result1, /Lockfile OK/);
console.log("  PASS");

// ─── Test 2: Rejects non-npm registry URL ───────────────────────────────────
console.log("Test 2: Rejects non-npm registry URL...");
const result2 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/evil-pkg": {
      resolved: "https://evil.example.com/evil-pkg-1.0.0.tgz",
      integrity: "sha512-abc123==",
    },
  },
});
assert.equal(result2.exitCode, 1);
assert.match(result2.stderr, /not on npm registry/);
assert.match(result2.stderr, /evil\.example\.com/);
console.log("  PASS");

// ─── Test 3: Rejects missing integrity hash ─────────────────────────────────
console.log("Test 3: Rejects missing integrity hash...");
const result3 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/no-integrity": {
      resolved: "https://registry.npmjs.org/no-integrity/-/no-integrity-1.0.0.tgz",
    },
  },
});
assert.equal(result3.exitCode, 1);
assert.match(result3.stderr, /missing integrity/);
console.log("  PASS");

// ─── Test 4: Skips root package and workspace links ─────────────────────────
console.log("Test 4: Skips root package and workspace links...");
const result4 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "my-monorepo", version: "1.0.0" },
    "packages/my-sdk": { link: true },
    "node_modules/valid-pkg": {
      resolved: "https://registry.npmjs.org/valid-pkg/-/valid-pkg-1.0.0.tgz",
      integrity: "sha512-validhash==",
    },
  },
});
assert.equal(result4.exitCode, 0);
assert.match(result4.stdout, /Lockfile OK/);
console.log("  PASS");

// ─── Test 5: Rejects unsupported lockfile version ───────────────────────────
console.log("Test 5: Rejects unsupported lockfile version...");
const result5 = run({
  lockfileVersion: 1,
  packages: {},
});
assert.equal(result5.exitCode, 1);
assert.match(result5.stderr, /unsupported/);
console.log("  PASS");

// ─── Test 6: Reports multiple violations ────────────────────────────────────
console.log("Test 6: Reports multiple violations...");
const result6 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/bad-url": {
      resolved: "http://registry.npmjs.org/bad-url/-/bad-url-1.0.0.tgz",
      integrity: "sha512-abc==",
    },
    "node_modules/no-hash": {
      resolved: "https://registry.npmjs.org/no-hash/-/no-hash-1.0.0.tgz",
    },
  },
});
assert.equal(result6.exitCode, 1);
assert.match(result6.stderr, /2 violation/);
console.log("  PASS");

// ─── Test 7: Rejects tarball URL in version field (no resolved) ─────────────
console.log("Test 7: Rejects tarball URL in version field when resolved is absent...");
const result7 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/evil-tarball": {
      version: "http://evil.example.com/evil-tarball-1.0.0.tgz",
    },
  },
});
assert.equal(result7.exitCode, 1);
assert.match(result7.stderr, /non-registry source/);
console.log("  PASS");

// ─── Test 8: Rejects git URL in version field ──────────────────────────────
console.log("Test 8: Rejects git URL in version field...");
const result8 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/git-dep": {
      version: "git+https://github.com/attacker/repo.git#main",
    },
  },
});
assert.equal(result8.exitCode, 1);
assert.match(result8.stderr, /non-registry source/);
console.log("  PASS");

// ─── Test 9: Allows semver version string (not a URL) ──────────────────────
console.log("Test 9: Allows normal semver version without resolved (bundled dep)...");
const result9 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/bundled-dep": {
      version: "1.2.3",
    },
  },
});
assert.equal(result9.exitCode, 0);
assert.match(result9.stdout, /Lockfile OK/);
console.log("  PASS");

// ─── Test 10: Rejects file: path in version field ──────────────────────────
console.log("Test 10: Rejects file: path in version field...");
const result10 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/local-evil": {
      version: "file:../evil.tgz",
    },
  },
});
assert.equal(result10.exitCode, 1);
assert.match(result10.stderr, /non-registry source/);
assert.match(result10.stderr, /file:\.\.\/evil\.tgz/);
console.log("  PASS");

// ─── Test 11: Allows semver with pre-release/build metadata ────────────────
console.log("Test 11: Allows semver with pre-release metadata...");
const result11 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/prerelease-dep": {
      version: "2.0.0-beta.1+build.123",
    },
  },
});
assert.equal(result11.exitCode, 0);
assert.match(result11.stdout, /Lockfile OK/);
console.log("  PASS");

// ─── Test 12: Rejects semver-like string with trailing path ─────────────────
console.log("Test 12: Rejects semver-like string with trailing non-semver content...");
const result12 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/tricky-dep": {
      version: "1.0.0 || file:../evil.tgz",
    },
  },
});
assert.equal(result12.exitCode, 1);
assert.match(result12.stderr, /non-registry source/);
console.log("  PASS");

// ─── Test 13: Rejects semver with leading zeros ─────────────────────────────
console.log("Test 13: Rejects semver with leading zeros...");
const result13 = run({
  lockfileVersion: 3,
  packages: {
    "": { name: "test-root" },
    "node_modules/leading-zero-dep": {
      version: "01.2.3",
    },
  },
});
assert.equal(result13.exitCode, 1);
assert.match(result13.stderr, /non-registry source/);
console.log("  PASS");

console.log("\nAll tests passed.");
