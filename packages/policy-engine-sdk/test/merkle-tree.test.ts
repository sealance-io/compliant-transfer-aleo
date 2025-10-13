import { describe, it, expect } from "vitest";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath, ZERO_ADDRESS } from "../src/merkle-tree.js";

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

describe("merkle_tree lib, generateLeaves", () => {
  it("should generate correct number of leaves from 1 leaf", () => {
    const leaves = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const result = generateLeaves(leaves);
    expect(result).toHaveLength(2);
  });

  it("should generate correct number of leaves from 2 leaves", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    ];
    const result = generateLeaves(leaves);
    expect(result).toHaveLength(2);
  });

  it("should generate correct number of leaves from 3 leaves", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    ];
    const result = generateLeaves(leaves);
    expect(result).toHaveLength(4);
  });

  it("should generate correct number of leaves from 5 leaves", () => {
    const leaves = Array(5).fill("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
    const result = generateLeaves(leaves);
    expect(result).toHaveLength(8);
  });

  it("should generate correct number of leaves from 9 leaves", () => {
    const leaves = Array(9).fill("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
    const result = generateLeaves(leaves);
    expect(result).toHaveLength(16);
  });

  it("should pad with 0field when needed", () => {
    const leaves = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const result = generateLeaves(leaves);

    expect(result).toHaveLength(2);
    expect(result.filter(x => x === "0field").length).toBe(1);
  });

  it("should sort leaves correctly", () => {
    const leaves = [
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    ];
    const result = generateLeaves(leaves);
    expect(result.length).toBe(2);
    expect(result[0]).not.toBe(result[1]);
    expect(result[0]).toBe("1295133970529764960316948294624974168921228814652993007266766481909235735940field");
  });

  it("should pad with 0field when needed", () => {
    const leaves = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const result = generateLeaves(leaves);
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
    const result = generateLeaves(leaves);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("0field");
    expect(result[1]).toBe("3501665755452795161867664882580888971213780722176652848275908626939553697821field");
  });

  it("should throw error when exceeding max tree capacity", () => {
    const maxDepth = 15;
    const maxLeaves = 2 ** (maxDepth - 1);
    const tooManyAddresses = Array(maxLeaves + 1).fill(
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    );

    expect(() => generateLeaves(tooManyAddresses, maxDepth)).toThrow("Leaves limit exceeded");
  });
});

describe("merkle_tree lib, getLeafIndices", () => {
  it("should handle address larger than all leaves in tree", () => {
    // Create a tree with a single address
    const addresses = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
    const leaves = generateLeaves(addresses, 15);
    const tree = buildTree(leaves);

    // Use an address that's larger than all addresses in the tree
    // This is generated from (2^253 - 1), the maximum valid field value
    const largeAddress = "aleo1lllllllllllllllllllllllllllllllllllllllllllllllllu0snjvma4";

    const [leftIdx, rightIdx] = getLeafIndices(tree, largeAddress);

    // When address is larger than all leaves, both indices should point to the last leaf
    expect(leftIdx).toBe(1);
    expect(rightIdx).toBe(1);
  });
});

describe("merkle_tree lib, getSiblingPath", () => {
  it("should handle odd leaf index (test sibling calculation branch)", () => {
    // Create a tree with 4 leaves
    const leaves = ["1field", "2field", "3field", "4field"];
    const tree = buildTree(leaves);

    // Get sibling path for leaf index 1 (odd index)
    // This will test the "index - 1" branch of the sibling index calculation
    const proof = getSiblingPath(tree, 1, 15);

    expect(proof).toBeDefined();
    expect(proof.leaf_index).toBe(1);
    expect(proof.siblings).toBeDefined();
    expect(proof.siblings.length).toBe(15); // Depth 15
    expect(proof.siblings[0]).toBe(2n); // The leaf itself (index 1 = "2field")
    expect(proof.siblings[1]).toBe(1n); // Its sibling (index 0 = "1field")
  });
});
