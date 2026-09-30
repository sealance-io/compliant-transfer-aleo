import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLeoFailure, isInterfaceMismatchDiagnostic, sanitizeLeoOutput } from "./check-iarc22-output.mjs";

test("redacts unknown .env assignment names without losing compiler diagnostics", () => {
  const message = formatLeoFailure(["build", "--path", "fixture"], {
    status: 1,
    stdout: "FUTURE_SETTING=example-value\n",
    stderr: "error: expected field, found u32\n",
  });
  assert.doesNotMatch(message, /example-value|FUTURE_SETTING=/);
  assert.match(message, /expected field, found u32/);
  assert.match(message, /leo --disable-update-check -q build --path fixture failed \(exit status 1\)/);
});

test("redacts private-key-shaped tokens even outside assignment lines", () => {
  const synthetic = `APrivateKey1${"x".repeat(48)}`;
  const message = formatLeoFailure(["abi", "fixture.aleo"], {
    status: 2,
    stdout: "",
    stderr: `error: invalid value ${synthetic}`,
  });
  assert.doesNotMatch(message, new RegExp(synthetic));
  assert.match(message, /\[redacted private key\]/);
  assert.match(message, /exit status 2/);
});

test("accepts only an explicit interface-mismatch diagnostic for the negative control", () => {
  assert.equal(isInterfaceMismatchDiagnostic("IARC22: program does not satisfy interface"), true);
  assert.equal(isInterfaceMismatchDiagnostic("iarc22: PROGRAM DOES NOT SATISFY interface"), true);
  assert.equal(isInterfaceMismatchDiagnostic("error: dependency does not satisfy version requirements"), false);
  assert.equal(isInterfaceMismatchDiagnostic("OtherInterface: program does not satisfy interface"), false);
  assert.equal(isInterfaceMismatchDiagnostic("error: IARC22 dependency is missing"), false);
  assert.equal(isInterfaceMismatchDiagnostic("error: missing import merkle_tree.aleo"), false);
  assert.equal(isInterfaceMismatchDiagnostic("error: malformed artifact"), false);
  assert.equal(sanitizeLeoOutput("DIFFERENT_NAME=hidden"), "[redacted environment assignment]");
});
