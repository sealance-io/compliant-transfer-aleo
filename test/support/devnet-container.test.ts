import { describe, expect, test } from "vitest";

import { parseConsensusVersion } from "./devnet-container.js";

// Pure unit test — no chain, no container. Nightly's devnet matrix only fans out
// the top-level test/*.test.ts integration files, so this runs in devnode CI only.
describe("parseConsensusVersion", () => {
  test("accepts a bare number", () => {
    expect(parseConsensusVersion(17)).toBe(17);
  });

  test("accepts a bare numeric string", () => {
    expect(parseConsensusVersion("17")).toBe(17);
  });

  test.each(["result", "consensus_version", "version"])("accepts an object with %s", key => {
    expect(parseConsensusVersion({ [key]: 17 })).toBe(17);
    expect(parseConsensusVersion({ [key]: "17" })).toBe(17);
  });

  test("prefers result over the other object keys", () => {
    expect(parseConsensusVersion({ result: 17, consensus_version: 3, version: 1 })).toBe(17);
  });

  test("parses zero rather than treating it as absent", () => {
    expect(parseConsensusVersion(0)).toBe(0);
    expect(parseConsensusVersion({ result: 0 })).toBe(0);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["an array", [17]],
    ["a boolean", true],
    ["a non-numeric string", "not-a-version"],
    ["a nested object value", { result: { value: 17 } }],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("returns undefined for %s", (_label, input) => {
    expect(parseConsensusVersion(input)).toBeUndefined();
  });

  // parseInt would read every one of these as a valid version, turning a payload
  // we do not understand into a readiness signal.
  test.each([
    ["a numeric prefix", "16junk"],
    ["a trailing unit", "16 blocks"],
    ["a decimal string", "16.5"],
    ["a decimal number", 16.5],
    ["hex", "0x10"],
    ["a signed string", "-16"],
    ["a plus-signed string", "+16"],
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a nested numeric prefix", { result: "16junk" }],
  ])("rejects %s", (_label, input) => {
    expect(parseConsensusVersion(input)).toBeUndefined();
  });

  // A digit string can pass the pattern and still be unrepresentable. Overflow to
  // Infinity is the dangerous one: it compares >= every target, so it would read
  // as "ready" instantly.
  test.each([
    ["a digit string that overflows to Infinity", "9".repeat(400)],
    ["a digit string past Number.MAX_SAFE_INTEGER", "9007199254740993"],
    ["a number past Number.MAX_SAFE_INTEGER", 9007199254740993],
    ["Number.MAX_VALUE", Number.MAX_VALUE],
  ])("rejects %s", (_label, input) => {
    expect(parseConsensusVersion(input)).toBeUndefined();
  });

  test("accepts the largest exactly representable integer", () => {
    expect(parseConsensusVersion(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("tolerates surrounding whitespace on an otherwise clean value", () => {
    expect(parseConsensusVersion(" 16\n")).toBe(16);
  });
});
