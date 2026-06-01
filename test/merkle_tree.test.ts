import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import {
  buildTree,
  convertAddressToField,
  convertFieldToAddress,
  generateLeaves,
  getLeafIndices,
  getSiblingPath,
} from "@sealance-io/policy-engine-aleo";

import { MAX_TREE_DEPTH, SETUP_TIMEOUT_MS } from "../lib/Constants.js";
import { addressLiteral, asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { createMerkleTree, type MerkleProof } from "../typechain/MerkleTree.js";
import { generateAddressesParallel, safeAddress } from "./utils/Accounts.js";

interface MerkleTreeFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly contract: ReturnType<typeof createMerkleTree>;
}

interface AddressEntry {
  readonly address: string;
  readonly field: bigint;
}

async function deployFixture() {
  const ctx = await setup();

  try {
    const deployer = ctx.named.signer("deployer");
    const contract = createMerkleTree().connect(ctx.lre);

    await ctx.deploy("merkle_tree", { noCompile: true });

    return {
      ctx,
      deployer,
      contract,
    } satisfies MerkleTreeFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

function merkleRoot(tree: bigint[]) {
  return fieldLiteral(tree[tree.length - 1]!);
}

function merkleProof(tree: bigint[], leafIndex: number): MerkleProof {
  const siblingPath = getSiblingPath(tree, leafIndex, MAX_TREE_DEPTH);
  return toMerkleProof(siblingPath);
}

function toAddressEntry(address: string): AddressEntry {
  return {
    address,
    field: convertAddressToField(address),
  };
}

function sortAddressEntries(addresses: readonly string[]) {
  return addresses.map(toAddressEntry).sort((a, b) => (a.field < b.field ? -1 : 1));
}

function generateSafeAddresses(count: number) {
  return Array.from({ length: count }, () => safeAddress());
}

function safeAddressBetween(minExclusive: bigint, maxExclusive: bigint) {
  let address = safeAddress();
  let field = convertAddressToField(address);

  while (field <= minExclusive || field >= maxExclusive) {
    address = safeAddress();
    field = convertAddressToField(address);
  }

  return address;
}

function safeAddressBelow(maxExclusive: bigint) {
  let address = safeAddress();
  let field = convertAddressToField(address);

  while (field >= maxExclusive) {
    address = safeAddress();
    field = convertAddressToField(address);
  }

  return address;
}

function safeAddressAbove(minExclusive: bigint) {
  let address = safeAddress();
  let field = convertAddressToField(address);

  while (field <= minExclusive) {
    address = safeAddress();
    field = convertAddressToField(address);
  }

  return address;
}

async function verifyInclusion(fixture: MerkleTreeFixture, addr: string, proof: MerkleProof) {
  const tx = await fixture.contract.verify_inclusion.accepted(
    {
      addr: addressLiteral(addr),
      merkle_proof: proof,
    },
    asSigner(fixture.deployer),
  );

  return tx.outputs.decrypt(fixture.deployer);
}

async function verifyNonInclusion(
  fixture: MerkleTreeFixture,
  addr: string,
  proofs: readonly [MerkleProof, MerkleProof],
) {
  const tx = await fixture.contract.verify_non_inclusion.accepted(
    {
      addr: addressLiteral(addr),
      merkle_proofs: proofs,
    },
    asSigner(fixture.deployer),
  );

  return tx.outputs.decrypt(fixture.deployer);
}

async function expectVerifyInclusionSettledToThrow(fixture: MerkleTreeFixture, addr: string, proof: MerkleProof) {
  await expect(
    fixture.contract.verify_inclusion.settled({
      addr: addressLiteral(addr),
      merkle_proof: proof,
    }),
  ).rejects.toThrow();
}

async function verifyNonInclusionFailsLocally(
  fixture: MerkleTreeFixture,
  addr: string,
  proofs: readonly [MerkleProof, MerkleProof],
) {
  await expect(
    fixture.contract.verify_non_inclusion.settled({
      addr: addressLiteral(addr),
      merkle_proofs: proofs,
    }),
  ).rejects.toThrow();
}

let state: MerkleTreeFixture | undefined;

beforeAll(async () => {
  state = await loadFixture(deployFixture);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (state) {
    await state.ctx.teardown();
  } else {
    clearFixtures();
  }
});

describe("merkle_tree program tests", () => {
  test(`small tree edge cases test, depth 1`, async () => {
    const fixture = state!;
    const depth = 1;
    const size = 2 ** depth;
    const addresses = Array(size)
      .fill(null)
      .map(() => safeAddress());
    const sortedAddresses = addresses
      .map(addr => ({
        address: addr,
        field: convertAddressToField(addr),
      }))
      .sort((a, b) => (a.field < b.field ? -1 : 1));

    const smallestAddress = safeAddressBelow(sortedAddresses[0].field);
    const betweenAddress = safeAddressBetween(sortedAddresses[0].field, sortedAddresses[size - 1].field);
    const largestAddress = safeAddressAbove(sortedAddresses[size - 1].field);

    const sortedFieldElements = sortedAddresses
      .sort((a, b) => (a.field < b.field ? -1 : 1))
      .map(item => fieldLiteral(item.field));

    const tree = buildTree(sortedFieldElements);

    const merkleProof0 = merkleProof(tree, 0);
    let root = await verifyNonInclusion(fixture, smallestAddress, [merkleProof0, merkleProof0]);
    expect(root).toBe(merkleRoot(tree));

    const merkleProof1 = merkleProof(tree, size - 1);
    root = await verifyNonInclusion(fixture, largestAddress, [merkleProof1, merkleProof1]);
    expect(root).toBe(merkleRoot(tree));

    root = await verifyNonInclusion(fixture, betweenAddress, [merkleProof0, merkleProof1]);
    expect(root).toBe(merkleRoot(tree));

    root = await verifyInclusion(fixture, sortedAddresses[0].address, merkleProof0);
    expect(root).toBe(merkleRoot(tree));
    root = await verifyInclusion(fixture, sortedAddresses[size - 1].address, merkleProof1);
    expect(root).toBe(merkleRoot(tree));
  });

  test(`all cases, depth 3`, async () => {
    const fixture = state!;
    const depth = 3;
    const size = Math.floor(2 ** (depth - 1));

    const addresses = depth > 1 ? await generateAddressesParallel(size) : Array.from({ length: size }).map(safeAddress);

    const sortedAddresses = addresses
      .map(addr => ({
        address: addr,
        field: convertAddressToField(addr),
      }))
      .sort((a, b) => (a.field < b.field ? -1 : 1));

    const smallestAddress = safeAddressBelow(sortedAddresses[0].field);

    const betweenAddress = safeAddressBetween(sortedAddresses[0].field, sortedAddresses[size - 1].field);

    const largestAddress = safeAddressAbove(sortedAddresses[size - 1].field);

    const sortedFieldElements = sortedAddresses
      .sort((a, b) => (a.field < b.field ? -1 : 1))
      .map(item => item.field.toString() + "field");

    const tree = buildTree(sortedFieldElements);
    const smallestMerkleProof = merkleProof(tree, 0);
    const largestMerkleProof = merkleProof(tree, size - 1);

    const [leftLeafIndex, rightLeafIndex] = getLeafIndices(tree, betweenAddress);
    const leftMerkleProof = merkleProof(tree, leftLeafIndex);
    const rightMerkleProof = merkleProof(tree, rightLeafIndex);
    let root = await verifyNonInclusion(fixture, betweenAddress, [leftMerkleProof, rightMerkleProof]);
    expect(root).toBe(merkleRoot(tree));

    root = await verifyInclusion(fixture, sortedAddresses[leftLeafIndex].address, leftMerkleProof);
    expect(root).toBe(merkleRoot(tree));

    root = await verifyInclusion(fixture, sortedAddresses[rightLeafIndex].address, rightMerkleProof);
    expect(root).toBe(merkleRoot(tree));

    // Verify inclusion generates incorrect root if the address is not the list
    root = await verifyInclusion(fixture, betweenAddress, {
      leaf_index: leftLeafIndex,
      siblings: [fieldLiteral(convertAddressToField(betweenAddress)), ...leftMerkleProof.siblings.slice(1)],
    });
    expect(root).not.toBe(merkleRoot(tree));

    // Verify inclusion fails if the merkle proof doesn't belong to the address
    await expectVerifyInclusionSettledToThrow(fixture, sortedAddresses[1].address, smallestMerkleProof);

    if (leftLeafIndex !== 0) {
      // the siblings indices are not adjusted
      await verifyNonInclusionFailsLocally(fixture, betweenAddress, [smallestMerkleProof, rightMerkleProof]);
    }
    if (rightLeafIndex !== size - 1) {
      // the siblings indices are not adjusted
      await verifyNonInclusionFailsLocally(fixture, betweenAddress, [leftMerkleProof, largestMerkleProof]);
    }

    // the address is not in a provided range (large)
    await verifyNonInclusionFailsLocally(fixture, largestAddress, [leftMerkleProof, rightMerkleProof]);

    //  the address is not in a provided range (smaller)
    await verifyNonInclusionFailsLocally(fixture, smallestAddress, [leftMerkleProof, rightMerkleProof]);

    // the address is in the list
    await verifyNonInclusionFailsLocally(fixture, sortedAddresses[0].address, [
      smallestMerkleProof,
      smallestMerkleProof,
    ]);

    //  invalid left path
    await verifyNonInclusionFailsLocally(fixture, betweenAddress, [
      {
        siblings: leftMerkleProof.siblings,
        leaf_index: leftMerkleProof.leaf_index > 0 ? leftMerkleProof.leaf_index - 1 : leftMerkleProof.leaf_index + 1,
      },
      rightMerkleProof,
    ]);

    //  invalid right path
    await verifyNonInclusionFailsLocally(fixture, betweenAddress, [
      leftMerkleProof,
      {
        siblings: rightMerkleProof.siblings,
        leaf_index:
          rightMerkleProof.leaf_index < size - 1 ? rightMerkleProof.leaf_index + 1 : rightMerkleProof.leaf_index - 1,
      },
    ]);

    // the most left address
    await verifyNonInclusionFailsLocally(fixture, sortedAddresses[0].address, [
      smallestMerkleProof,
      smallestMerkleProof,
    ]);
    await verifyNonInclusion(fixture, smallestAddress, [smallestMerkleProof, smallestMerkleProof]);

    // the most right address
    await verifyNonInclusionFailsLocally(fixture, sortedAddresses[size - 1].address, [
      largestMerkleProof,
      largestMerkleProof,
    ]);
    await verifyNonInclusion(fixture, largestAddress, [largestMerkleProof, largestMerkleProof]);
  });

  for (const depth of [12, 15]) {
    test(`large tree random test, depth ${depth}`, async () => {
      const fixture = state!;
      const size = Math.floor(2 ** (depth - 1));

      const addresses =
        depth > 1 ? await generateAddressesParallel(size) : Array.from({ length: size }).map(safeAddress);

      const sortedAddresses = addresses
        .map(addr => ({
          address: addr,
          field: convertAddressToField(addr),
        }))
        .sort((a, b) => (a.field < b.field ? -1 : 1));

      const smallestAddress = safeAddressBelow(sortedAddresses[0].field);

      const betweenAddress = safeAddressBetween(sortedAddresses[0].field, sortedAddresses[size - 1].field);

      const largestAddress = safeAddressAbove(sortedAddresses[size - 1].field);

      const sortedFieldElements = sortedAddresses
        .sort((a, b) => (a.field < b.field ? -1 : 1))
        .map(item => item.field.toString() + "field");

      const tree = buildTree(sortedFieldElements);
      const smallestMerkleProof = merkleProof(tree, 0);

      let root = await verifyInclusion(fixture, sortedAddresses[0].address, smallestMerkleProof);
      expect(root).toBe(merkleRoot(tree));

      root = await verifyNonInclusion(fixture, smallestAddress, [smallestMerkleProof, smallestMerkleProof]);
      expect(root).toBe(merkleRoot(tree));

      const largestMerkleProof = merkleProof(tree, size - 1);

      root = await verifyInclusion(fixture, sortedAddresses[size - 1].address, largestMerkleProof);
      expect(root).toBe(merkleRoot(tree));
      root = await verifyNonInclusion(fixture, largestAddress, [largestMerkleProof, largestMerkleProof]);
      expect(root).toBe(merkleRoot(tree));

      const [leftLeafIndex, rightLeafIndex] = getLeafIndices(tree, betweenAddress);
      const leftMerkleProof = merkleProof(tree, leftLeafIndex);
      const rightMerkleProof = merkleProof(tree, rightLeafIndex);
      root = await verifyNonInclusion(fixture, betweenAddress, [leftMerkleProof, rightMerkleProof]);
      expect(root).toBe(merkleRoot(tree));

      root = await verifyInclusion(fixture, sortedAddresses[leftLeafIndex].address, leftMerkleProof);
      expect(root).toBe(merkleRoot(tree));

      root = await verifyInclusion(fixture, sortedAddresses[rightLeafIndex].address, rightMerkleProof);
      expect(root).toBe(merkleRoot(tree));
    });
  }

  test(`test various sizes of leaves array`, async () => {
    const fixture = state!;
    const firstAddresses = sortAddressEntries(generateSafeAddresses(2));
    const middleAddress = safeAddressBetween(firstAddresses[0].field, firstAddresses[1].field);
    let leaves = generateLeaves(firstAddresses.map(item => item.address));
    let tree = buildTree(leaves);

    expect(tree).toHaveLength(3);

    let leafIndices = getLeafIndices(tree, middleAddress);
    let merkleProof0 = merkleProof(tree, leafIndices[0]);
    let merkleProof2 = merkleProof(tree, leafIndices[1]);

    let root = await verifyNonInclusion(fixture, middleAddress, [merkleProof0, merkleProof2]);
    expect(root).toBe(merkleRoot(tree));

    const secondAddresses = [firstAddresses[0].address, firstAddresses[1].address, firstAddresses[1].address];
    leaves = generateLeaves(secondAddresses);
    tree = buildTree(leaves);

    expect(tree).toHaveLength(7);

    leafIndices = getLeafIndices(tree, middleAddress);
    merkleProof0 = merkleProof(tree, leafIndices[0]);
    merkleProof2 = merkleProof(tree, leafIndices[1]);

    root = await verifyNonInclusion(fixture, middleAddress, [merkleProof0, merkleProof2]);
    expect(root).toBe(merkleRoot(tree));

    merkleProof0 = merkleProof(tree, 1);

    await verifyNonInclusionFailsLocally(fixture, middleAddress, [merkleProof0, merkleProof0]);
  });

  /**
   * Domain Separation Tests (Second Preimage Attack Prevention)
   *
   * Tests that the Merkle tree uses different hash prefixes for leaves vs internal nodes:
   * - Leaves: hash(1field, left, right)
   * - Internal nodes: hash(0field, left, right)
   *
   * This prevents an attacker from using internal node hashes as leaf values
   * or vice versa, which could allow bypassing inclusion/non-inclusion checks.
   *
   * Attack scenario: Use proofs computed from internal nodes (tree.slice(numLeaves))
   * as if they were a valid tree. Two cases:
   * 1. Boundary case (same indices): verify_non_inclusion succeeds but returns WRONG root
   * 2. Normal case (different indices): verify_non_inclusion rejects entirely
   */

  test(`second preimage attack - domain separation boundary case`, async () => {
    const fixture = state!;
    const numLeaves = 128;
    let boundaryLeaf: string | undefined;
    let boundaryIdx = 0;
    let tree: bigint[] = [];
    let internalNodesTree: bigint[] = [];
    const internalLeafCount = numLeaves / 2;

    // Retry with new addresses until we find a boundary case
    while (!boundaryLeaf) {
      const addresses = await generateAddressesParallel(numLeaves);
      const leaves = generateLeaves(addresses);
      tree = buildTree(leaves);

      internalNodesTree = tree.slice(numLeaves);
      const internalLeaves = internalNodesTree.slice(0, internalLeafCount);

      const maxInternalNode = internalLeaves.reduce((a, b) => (a > b ? a : b));
      const minInternalNode = internalLeaves.reduce((a, b) => (a < b ? a : b));

      const nonZeroLeaves = leaves.filter(l => l !== "0field");

      // Try finding leaf > all internal nodes
      boundaryLeaf = nonZeroLeaves.find(leaf => {
        const val = BigInt(leaf.slice(0, -5));
        return val > maxInternalNode;
      });
      if (boundaryLeaf) {
        boundaryIdx = internalLeafCount - 1;
        break;
      }

      // Try finding leaf < all internal nodes
      boundaryLeaf = nonZeroLeaves.find(leaf => {
        const val = BigInt(leaf.slice(0, -5));
        return val < minInternalNode;
      });
      if (boundaryLeaf) {
        boundaryIdx = 0;
        break;
      }
    }

    const expectedRoot = merkleRoot(tree);
    const targetAddress = convertFieldToAddress(boundaryLeaf!);
    const attackProof = merkleProof(internalNodesTree, boundaryIdx);

    const computedRoot = await verifyNonInclusion(fixture, targetAddress, [attackProof, attackProof]);

    // CRITICAL: verify_non_inclusion succeeds but returns WRONG root
    expect(computedRoot).not.toBe(expectedRoot);
  });

  test(`second preimage attack - domain separation normal case`, async () => {
    const fixture = state!;
    const numLeaves = 128;
    let targetAddress: string | undefined;
    let tree: bigint[] = [];
    let internalNodesTree: bigint[] = [];
    let internalLeaves: bigint[] = [];
    let leftIdx: number = 0;
    let rightIdx: number = 0;
    const internalLeafCount = numLeaves / 2;

    // Retry with new addresses until we find a normal case
    while (!targetAddress) {
      const addresses = await generateAddressesParallel(numLeaves);
      const leaves = generateLeaves(addresses);
      tree = buildTree(leaves);

      internalNodesTree = tree.slice(numLeaves);
      internalLeaves = internalNodesTree.slice(0, internalLeafCount);

      const increasingIndex = internalLeaves.findIndex((leaf, index) => {
        return (index - 1) % 2 === 1 && leaf > internalLeaves[index - 1];
      });
      if (increasingIndex === -1) {
        continue;
      }

      targetAddress = safeAddressBetween(internalLeaves[increasingIndex - 1], internalLeaves[increasingIndex]);
      rightIdx = increasingIndex;
      leftIdx = increasingIndex - 1;
    }

    const leftAttackProof = merkleProof(internalNodesTree, leftIdx);
    const rightAttackProof = merkleProof(internalNodesTree, rightIdx);

    // Normal case: different proofs for left and right
    // Contract should REJECT because domain separation breaks the proof
    await verifyNonInclusionFailsLocally(fixture, targetAddress, [leftAttackProof, rightAttackProof]);
  });
});
