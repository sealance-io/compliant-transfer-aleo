import { describe, it, expect } from "vitest";
import { buildTree, genLeaves, ZERO_ADDRESS } from "../src/merkle-tree.js";

describe("merkle_tree lib, buildTree", () => {
  it("should build a valid tree with 2 leaves", async () => {
    const leaves = ["1field", "2field"];
    const tree = buildTree(leaves);
    expect(tree).toHaveLength(3);
  });

  it("should build a valid tree with 4 leaves", async () => {
    const leaves = ["1field", "2field", "3field", "4field"];
    const tree = buildTree(leaves);
    expect(tree).toHaveLength(7);
  });

  it("should throw error for empty leaves", async () => {
    expect(() => buildTree([])).toThrow(`Leaves array cannot be empty`);
  });

  it("should throw error for odd number of leaves", async () => {
    expect(() => buildTree(["1field", "2field", "3field"])).toThrow(`Leaves array must have even number of elements`);
  });
});

describe("merkle_tree lib, genLeaves", () => {
  it("should generate correct number of leaves from 1 leaf", () => {
    const leaves = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const result = genLeaves(leaves);
    expect(result).toHaveLength(2);
  });

  it("should generate correct number of leaves from 2 leaves", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    ];
    const result = genLeaves(leaves);
    expect(result).toHaveLength(2);
  });

  it("should generate correct number of leaves from 3 leaves", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    ];
    const result = genLeaves(leaves);
    expect(result).toHaveLength(4);
  });

  it("should generate correct number of leaves from 5 leaves", () => {
    const leaves = Array(5).fill("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
    const result = genLeaves(leaves);
    expect(result).toHaveLength(8);
  });

  it("should generate correct number of leaves from 9 leaves", () => {
    const leaves = Array(9).fill("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
    const result = genLeaves(leaves);
    expect(result).toHaveLength(16);
  });

  it("should pad with 0field when needed", () => {
    const leaves = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const result = genLeaves(leaves);

    expect(result).toHaveLength(2);
    expect(result.filter(x => x === "0field").length).toBe(1);
  });

  it("should sort leaves correctly", () => {
    const leaves = [
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    ];
    const result = genLeaves(leaves);
    expect(result.length).toBe(2);
    expect(result[0]).not.toBe(result[1]);
    expect(result[0]).toBe("1295133970529764960316948294624974168921228814652993007266766481909235735940field");
  });

  it("should pad with 0field when needed", () => {
    const leaves = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const result = genLeaves(leaves);
    expect(result).toHaveLength(2);
    expect(result.filter(x => x === "0field").length).toBe(1);
  });

  it("should filter ZERO_ADDRESS", () => {
    const leaves = [
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    ];
    const depth = 1;
    const result = genLeaves(leaves);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("0field");
    expect(result[1]).toBe("3501665755452795161867664882580888971213780722176652848275908626939553697821field");
  });
});
