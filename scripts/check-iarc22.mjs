import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const leo = process.env.LEO_BINARY ?? "leo";
const standardDir = resolve(root, "standards/iarc22-check");

function readJson(name) {
  const path = join(standardDir, name);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read or parse standards/iarc22-check/${name}: ${error.message}`, { cause: error });
  }
}

function readStandardPin() {
  const manifest = readJson("program.json");
  if (!manifest || !Array.isArray(manifest.dependencies)) {
    throw new Error("standards/iarc22-check/program.json: dependencies must be an array");
  }
  const matches = manifest.dependencies.filter(dependency => dependency?.name === "IARC22");
  if (matches.length !== 1) {
    throw new Error(
      `standards/iarc22-check/program.json: expected exactly one IARC22 dependency, found ${matches.length}`,
    );
  }
  const dependency = matches[0];
  if (dependency.location !== "git" || !dependency.git || typeof dependency.git !== "object") {
    throw new Error("standards/iarc22-check/program.json: IARC22 must be a Git dependency with git.url and git.rev");
  }
  const { url, rev } = dependency.git;
  if (
    typeof url !== "string" ||
    !url.startsWith("https://") ||
    !URL.canParse(url) ||
    new URL(url).protocol !== "https:"
  ) {
    throw new Error("standards/iarc22-check/program.json: IARC22 git.url must be a non-empty HTTPS URL");
  }
  if (typeof rev !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(rev)) {
    throw new Error(
      "standards/iarc22-check/program.json: IARC22 git.rev must be a full immutable commit SHA, not a branch or tag",
    );
  }

  const lock = readJson("leo.lock");
  if (!lock || !Array.isArray(lock.git)) {
    throw new Error("standards/iarc22-check/leo.lock: git must be an array");
  }
  const locked = lock.git.filter(entry => entry?.name === "IARC22");
  if (locked.length !== 1) {
    throw new Error(`standards/iarc22-check/leo.lock: expected exactly one IARC22 entry, found ${locked.length}`);
  }
  if (locked[0].git !== url || locked[0].reference !== `rev=${rev}` || locked[0].commit !== rev) {
    throw new Error(
      "IARC22 manifest and leo.lock disagree on the Git URL or commit; run leo update in standards/iarc22-check and commit both files",
    );
  }
  return dependency;
}

const standardDependency = readStandardPin();
const temp = mkdtempSync(join(tmpdir(), "iarc22-conformance-"));

function run(args, options = {}) {
  const result = spawnSync(leo, ["--disable-update-check", ...args], {
    cwd: root,
    encoding: "utf8",
    // Leo prints every loaded .env entry at normal verbosity. Capture output so
    // conformance logs never disclose keys; include it only when a check fails.
    stdio: "pipe",
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`leo ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

function source(path, iface, proofType) {
  const transformed = readFileSync(resolve(root, path), "utf8")
    .replace(/\/\/ BEGIN LOCAL IARC22 INTERFACE MIRROR[\s\S]*?\/\/ END LOCAL IARC22 INTERFACE MIRROR\n/, "")
    .replace(/struct MerkleProof \{\s*siblings: \[field; 16\],\s*leaf_index: u32\s*\}\s*/, "")
    .replace(/program ([\w.]+): \w+ \{/, `program $1: IARC22::${iface} {`)
    .replace(/(?<!:)\bMerkleProof\b/g, proofType);
  return transformed;
}

function manifest(program, dependencies) {
  return {
    program,
    version: "0.1.0",
    description: "ARC-22 conformance fixture",
    license: "Apache-2.0",
    leo: "4.4.3",
    dependencies: [standardDependency, ...dependencies],
    dev_dependencies: null,
  };
}

function writePackage(name, text, dependencies) {
  const dir = join(temp, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "main.leo"), text);
  writeFileSync(join(dir, "program.json"), `${JSON.stringify(manifest(`${name}.aleo`, dependencies), null, 2)}\n`);
  copyFileSync(join(standardDir, "leo.lock"), join(dir, "leo.lock"));
  return dir;
}

try {
  const local = name => ({
    name: `${name}.aleo`,
    location: "local",
    path: resolve(root, "artifacts", ".build", `${name}.aleo`),
  });

  const registryDir = writePackage(
    "sealance_freezelist_registry",
    source(
      "programs/freezelist_registry/sealance_freezelist_registry/main.leo",
      "IARC22Freezelist",
      "IARC22::MerkleProof",
    ),
    [local("merkle_tree"), local("multisig_core")],
  );
  run(["build", "--path", registryDir]);

  const tokenSource = source("programs/token/compliant_token_template/main.leo", "IARC22", "IARC22::MerkleProof");
  const tokenDir = writePackage("compliant_token_template", tokenSource, [
    { name: "sealance_freezelist_registry.aleo", location: "local", path: registryDir },
    local("multisig_core"),
  ]);
  run(["build", "--path", tokenDir]);

  console.log("IARC22Freezelist: nominal interface conformance passed against pinned Git dependency.");
  console.log("IARC22: nominal interface conformance passed against pinned Git dependency.");

  const tokenStandard = join(tokenDir, "build", "compliant_token_template", "interfaces", "IARC22", "IARC22.json");
  const imports = join(temp, "negative-imports");
  mkdirSync(imports, { recursive: true });
  for (const name of ["multisig_core", "multisig_freezelist_registry"]) {
    copyFileSync(resolve(root, "artifacts", `${name}.aleo`, "main.aleo"), join(imports, `${name}.aleo`));
  }
  const negative = run(
    [
      "abi",
      resolve(root, "artifacts/multisig_compliant_token.aleo/main.aleo"),
      "--imports-dir",
      imports,
      "--satisfies",
      tokenStandard,
    ],
    { allowFailure: true },
  );
  if (negative.status === 0) throw new Error("negative conformance check unexpectedly passed");
  console.log("Negative control: multisig_compliant_token.aleo correctly rejected.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
