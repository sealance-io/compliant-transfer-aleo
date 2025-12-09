import { ExecutionMode } from "@doko-js/core";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { MAX_TREE_DEPTH } from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { deployIfNotDeployed } from "../lib/Deploy";
import {
  buildTree,
  convertAddressToField,
  convertFieldToAddress,
  generateLeaves,
} from "@sealance-io/policy-engine-aleo";
import { Account } from "@provablehq/sdk";
import { generateAddressesParallel } from "./utils/Accounts";

const mode = ExecutionMode.SnarkExecute;
const contract = new Merkle_treeContract({ mode });

describe("merkle_tree program tests", () => {
  beforeAll(async () => {
    await deployIfNotDeployed(contract);
  });

  test(`small tree edge cases test, depth 1`, async () => {
    const depth = 1;
    const size = 2 ** depth;
    const addresses = Array(size)
      .fill(null)
      .map(() => new Account().address().to_string());
    const sortedAddresses = addresses
      .map(addr => ({
        address: addr,
        field: convertAddressToField(addr),
      }))
      .sort((a, b) => (a.field < b.field ? -1 : 1));

    const smallestAddress = sortedAddresses[0].address;
    const smallestField = sortedAddresses[0].field;
    const largestAddress = sortedAddresses[size - 1].address;
    const largestField = sortedAddresses[size - 1].field;

    // Generate a new address that's guaranteed to be larger than the smallest and smaller than the largest
    let newAddress = smallestAddress;
    while (convertAddressToField(newAddress) <= smallestField || convertAddressToField(newAddress) >= largestField) {
      newAddress = new Account().address().to_string();
    }

    sortedAddresses[0] = {
      address: newAddress,
      field: convertAddressToField(newAddress),
    };
    // Generate a new address that's guaranteed to be larger than the smallest and smaller than the largest
    newAddress = largestAddress;
    while (convertAddressToField(newAddress) <= smallestField || convertAddressToField(newAddress) >= largestField) {
      newAddress = new Account().address().to_string();
    }
    sortedAddresses[size - 1] = {
      address: newAddress,
      field: convertAddressToField(newAddress),
    };
    const sortedFieldElements = sortedAddresses
      .sort((a, b) => (a.field < b.field ? -1 : 1))
      .map(item => item.field.toString() + "field");

    const tree = buildTree(sortedFieldElements);

    const merkleProof = getSiblingPath(tree, 0, MAX_TREE_DEPTH);
    let tx = await contract.verify_non_inclusion(smallestAddress, [merkleProof, merkleProof]);
    let [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    const merkleProof1 = getSiblingPath(tree, size - 1, MAX_TREE_DEPTH);
    tx = await contract.verify_non_inclusion(largestAddress, [merkleProof1, merkleProof1]);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    tx = await contract.verify_inclusion(sortedAddresses[0].address, merkleProof);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
    tx = await contract.verify_inclusion(sortedAddresses[size - 1].address, merkleProof1);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
  });

  test(`large tree edge cases test, depth 12`, async () => {
    const depth = 12;
    const size = Math.floor(2 ** (depth - 1));
    const addresses = await generateAddressesParallel(size);

    const sortedAddresses = addresses
      .map(addr => ({
        address: addr,
        field: convertAddressToField(addr),
      }))
      .sort((a, b) => (a.field < b.field ? -1 : 1));

    const smallestAddress = sortedAddresses[0].address;
    const largestAddress = sortedAddresses[size - 1].address;

    // Generate a new address that's guaranteed to be larger than the smallest
    let newAddress = smallestAddress;
    while (convertAddressToField(newAddress) <= sortedAddresses[0].field) {
      newAddress = new Account().address().to_string();
    }

    sortedAddresses[0] = {
      address: newAddress,
      field: convertAddressToField(newAddress),
    };

    // Generate a new address that's guaranteed to be smaller than the largest
    newAddress = largestAddress;
    while (convertAddressToField(newAddress) >= sortedAddresses[size - 1].field) {
      newAddress = new Account().address().to_string();
    }

    sortedAddresses[size - 1] = {
      address: newAddress,
      field: convertAddressToField(newAddress),
    };

    const sortedFieldElements = sortedAddresses
      .sort((a, b) => (a.field < b.field ? -1 : 1))
      .map(item => item.field.toString() + "field");

    const tree = buildTree(sortedFieldElements);
    const merkleProof = getSiblingPath(tree, 0, MAX_TREE_DEPTH);

    let tx = await contract.verify_non_inclusion(smallestAddress, [merkleProof, merkleProof]);
    let [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    const merkleProof1 = getSiblingPath(tree, size - 1, MAX_TREE_DEPTH);

    tx = await contract.verify_non_inclusion(largestAddress, [merkleProof1, merkleProof1]);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    tx = await contract.verify_inclusion(sortedAddresses[0].address, merkleProof);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    tx = await contract.verify_inclusion(sortedAddresses[size - 1].address, merkleProof1);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
  });

  test(`large tree random test, depth 12`, async () => {
    const depth = 12;
    const size = Math.floor(2 ** (depth - 1));
    const addresses = await generateAddressesParallel(size);

    const sortedAddresses = generateLeaves(addresses, depth);
    const tree = buildTree(sortedAddresses);

    const checkedAddress = new Account().address().to_string();
    const [leftLeafIndex, rightLeafIndex] = getLeafIndices(tree, checkedAddress);

    const merkleProof0 = getSiblingPath(tree, leftLeafIndex, MAX_TREE_DEPTH);
    const merkleProof1 = getSiblingPath(tree, rightLeafIndex, MAX_TREE_DEPTH);

    let tx = await contract.verify_non_inclusion(checkedAddress, [merkleProof0, merkleProof1]);
    let [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    tx = await contract.verify_inclusion(convertFieldToAddress(sortedAddresses[leftLeafIndex]), merkleProof0);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
    tx = await contract.verify_inclusion(convertFieldToAddress(sortedAddresses[rightLeafIndex]), merkleProof1);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
  });

  test(`large tree random test, depth 15`, async () => {
    const depth = 15;
    const size = Math.floor(2 ** (depth - 1));
    const addresses = await generateAddressesParallel(size);

    const sortedAddresses = generateLeaves(addresses, depth);
    const tree = buildTree(sortedAddresses);

    const checkedAddress = new Account().address().to_string();
    const [leftLeafIndex, rightLeafIndex] = getLeafIndices(tree, checkedAddress);

    const merkleProof0 = getSiblingPath(tree, leftLeafIndex, MAX_TREE_DEPTH);
    const merkleProof1 = getSiblingPath(tree, rightLeafIndex, MAX_TREE_DEPTH);

    let tx = await contract.verify_non_inclusion(checkedAddress, [merkleProof0, merkleProof1]);
    let [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
  });

  test(`all cases, depth 3`, async () => {
    const leaves = generateLeaves([
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
      "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
      "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
      "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
      "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
      "aleo18khmhg2nehxxsm6km43ah7qdudjkjw7mgpsfya9vvzx3vlq9hyxs8vzdds",
      "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
    ]);
    const tree = buildTree(leaves);

    const merkleProof0 = getSiblingPath(tree, 0, MAX_TREE_DEPTH);
    const merkleProof2 = getSiblingPath(tree, 2, MAX_TREE_DEPTH);
    const merkleProof3 = getSiblingPath(tree, 3, MAX_TREE_DEPTH);
    const merkleProof4 = getSiblingPath(tree, 4, MAX_TREE_DEPTH);
    const merkleProof7 = getSiblingPath(tree, 7, MAX_TREE_DEPTH);

    let tx = await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [
      merkleProof2,
      merkleProof3,
    ]);
    let [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    tx = await contract.verify_inclusion(convertFieldToAddress(leaves[2]), merkleProof2);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);
    tx = await contract.verify_inclusion(convertFieldToAddress(leaves[3]), merkleProof3);
    [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    // Verify inclusion generates incorrect root if the address is not the list
    tx = await contract.verify_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", {
      leaf_index: 2,
      siblings: [
        convertAddressToField("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"),
        ...merkleProof2.siblings.slice(1),
      ],
    });
    [root] = await tx.wait();
    expect(root).not.toBe(tree[tree.length - 1]);

    // Verify inclusion fails if the merkle proof doesn't belong to the address
    await expect(contract.verify_inclusion(convertFieldToAddress(leaves[1]), merkleProof2)).rejects.toThrow();

    // the siblings indices are not adjusted
    await expect(
      contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [
        merkleProof2,
        merkleProof4,
      ]),
    ).rejects.toThrow();

    // the address is in the list
    await expect(
      contract.verify_non_inclusion("aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps", [
        merkleProof2,
        merkleProof3,
      ]),
    ).rejects.toThrow();

    // the address is not in a provided range (large)
    await expect(
      contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [
        merkleProof2,
        merkleProof3,
      ]),
    ).rejects.toThrow();

    //  the address is not in a provided range (smaller)
    await expect(
      contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [
        merkleProof2,
        merkleProof3,
      ]),
    ).rejects.toThrow();

    //  invalid left path
    await expect(
      contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [
        { siblings: merkleProof2.siblings, leaf_index: 1 },
        merkleProof4,
      ]),
    ).rejects.toThrow();

    //  invalid right path
    await expect(
      contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [
        merkleProof2,
        { siblings: merkleProof3.siblings, leaf_index: 1 },
      ]),
    ).rejects.toThrow();

    // the most left address
    await expect(
      contract.verify_non_inclusion("aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps", [
        merkleProof0,
        merkleProof0,
      ]),
    ).rejects.toThrow();
    await contract.verify_non_inclusion("aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t", [
      merkleProof0,
      merkleProof0,
    ]);

    // the most right address
    await expect(
      contract.verify_non_inclusion("aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9", [
        merkleProof7,
        merkleProof7,
      ]),
    ).rejects.toThrow();
    await contract.verify_non_inclusion("aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t", [
      merkleProof7,
      merkleProof7,
    ]);
  });

  test(`test various sizes of leaves array`, async () => {
    let leaves = generateLeaves([
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
    ]);
    let tree = buildTree(leaves);

    expect(tree).toHaveLength(3);

    let leafIndices = getLeafIndices(tree, "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
    let merkleProof0 = getSiblingPath(tree, leafIndices[0], MAX_TREE_DEPTH);
    let merkleProof2 = getSiblingPath(tree, leafIndices[1], MAX_TREE_DEPTH);

    let tx = await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [
      merkleProof0,
      merkleProof2,
    ]);
    const [root] = await tx.wait();
    expect(root).toBe(tree[tree.length - 1]);

    leaves = generateLeaves([
      "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
      "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
      "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
    ]);
    tree = buildTree(leaves);

    expect(tree).toHaveLength(7);

    leafIndices = getLeafIndices(tree, "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
    merkleProof0 = getSiblingPath(tree, leafIndices[0], MAX_TREE_DEPTH);
    merkleProof2 = getSiblingPath(tree, leafIndices[1], MAX_TREE_DEPTH);

    tx = await contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [
      merkleProof0,
      merkleProof2,
    ]);
    const [root1] = await tx.wait();
    expect(root1).toBe(tree[tree.length - 1]);

    merkleProof0 = getSiblingPath(tree, 1, MAX_TREE_DEPTH);

    await expect(
      contract.verify_non_inclusion("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px", [
        merkleProof0,
        merkleProof0,
      ]),
    ).rejects.toThrow();
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

    const expectedRoot = tree[tree.length - 1];
    const targetAddress = convertFieldToAddress(boundaryLeaf);
    const attackProof = getSiblingPath(internalNodesTree, boundaryIdx, MAX_TREE_DEPTH);

    const tx = await contract.verify_non_inclusion(targetAddress, [attackProof, attackProof]);
    const [computedRoot] = await tx.wait();

    // CRITICAL: verify_non_inclusion succeeds but returns WRONG root
    expect(computedRoot).not.toBe(expectedRoot);
  });

  test(`second preimage attack - domain separation normal case`, async () => {
    const numLeaves = 128;
    let normalLeaf: string | undefined;
    let tree: bigint[] = [];
    let internalNodesTree: bigint[] = [];
    let internalLeaves: bigint[] = [];
    const internalLeafCount = numLeaves / 2;

    // Retry with new addresses until we find a normal case
    while (!normalLeaf) {
      const addresses = await generateAddressesParallel(numLeaves);
      const leaves = generateLeaves(addresses);
      tree = buildTree(leaves);

      internalNodesTree = tree.slice(numLeaves);
      internalLeaves = internalNodesTree.slice(0, internalLeafCount);

      const maxInternalNode = internalLeaves.reduce((a, b) => (a > b ? a : b));
      const minInternalNode = internalLeaves.reduce((a, b) => (a < b ? a : b));

      const nonZeroLeaves = leaves.filter(l => l !== "0field");

      // Find leaf between min and max internal nodes
      normalLeaf = nonZeroLeaves.find(leaf => {
        const val = BigInt(leaf.slice(0, -5));
        return val > minInternalNode && val < maxInternalNode;
      });
    }

    const targetAddress = convertFieldToAddress(normalLeaf);
    const targetField = convertAddressToField(targetAddress);

    // Find adjacent internal node positions where target falls between
    const rightIdx = internalLeaves.findIndex(node => targetField <= node);
    const leftIdx = rightIdx - 1;

    const leftAttackProof = getSiblingPath(internalNodesTree, leftIdx, MAX_TREE_DEPTH);
    const rightAttackProof = getSiblingPath(internalNodesTree, rightIdx, MAX_TREE_DEPTH);

    // Normal case: different proofs for left and right
    // Contract should REJECT because domain separation breaks the proof
    await expect(contract.verify_non_inclusion(targetAddress, [leftAttackProof, rightAttackProof])).rejects.toThrow();
  });
});
