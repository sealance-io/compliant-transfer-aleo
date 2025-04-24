import { ExecutionMode } from "@doko-js/core";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { MAX_TREE_SIZE, timeout } from "../lib/Constants";
import { getSiblingPath } from "../lib/FreezeList";
import { deployIfNotDeployed } from "../lib/Deploy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import { Account } from "@provablehq/sdk";
import { convertAddressToField } from "../lib/Conversion";

const mode = ExecutionMode.SnarkExecute;
const contract = new Rediwsozfo_v2Contract({ mode });

describe("merkle_tree lib, buildTree", () => {
  it("should build a valid tree with 2 leaves", async () => {
    const leaves = ["1field", "2field"];
    const tree = await buildTree(leaves);
    expect(tree).toHaveLength(3);
  });

  it("should build a valid tree with 4 leaves", async () => {
    const leaves = ["1field", "2field", "3field", "4field"];
    const tree = await buildTree(leaves);
    expect(tree).toHaveLength(7);
  });

  it("should throw error for empty leaves", async () => {
    try {
      await buildTree([]);
      fail("Should have thrown error");
    } catch (e) {
      expect(e.message).toBe("Leaves array cannot be empty");
    }
  });

  it("should throw error for odd number of leaves", async () => {
    try {
      await buildTree(["1field", "2field", "3field"]);
      fail("Should have thrown error");
    } catch (e) {
      expect(e.message).toBe("Leaves array must have even number of elements");
    }
  });
});

describe("merkle_tree lib, genLeaves", () => {
  it("should generate correct number of leaves for given depth", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    ];
    const depth = 2;
    const result = genLeaves(leaves, depth);
    expect(result).toHaveLength(4);
  });

  it("should pad with 0field when needed", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    ];
    const depth = 2;
    const result = genLeaves(leaves, depth);
    expect(result).toHaveLength(4);
    expect(result.filter((x) => x === "0field").length).toBe(3);
  });

  it("should sort leaves correctly", () => {
    const leaves = [
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    ];
    const depth = 1;
    const result = genLeaves(leaves, depth);
    expect(result.length).toBe(2);
    expect(result[0]).not.toBe(result[1]);
    expect(result[0]).toBe(
      "1295133970529764960316948294624974168921228814652993007266766481909235735940field",
    );
  });
  it("should fail if the input array is large", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
      "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
    ];
    const depth = 1;

    try {
      genLeaves(leaves, depth);
      fail("Should have thrown error");
    } catch (e) {
      expect(e.message).toBe("Leaves limit exceeded. Max: 2");
    }
  });
  it("should pad with 0field when needed", () => {
    const leaves = [
      "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
    ];
    const depth = 2;
    const result = genLeaves(leaves, depth);
    expect(result).toHaveLength(4);
    expect(result.filter((x) => x === "0field").length).toBe(3);
  });
});

describe("merkle_tree program tests", () => {
  test(
    `deploy program`,
    async () => {
      await deployIfNotDeployed(contract);
    },
    timeout,
  );

  test(
    `large tree edge cases test, depth 12`,
    async () => {
      const depth = 12;
      const size = 2 ** depth;
      const addresses = Array(size)
        .fill(null)
        .map(() => new Account().address().to_string());

      const sortedAddresses = addresses
        .map((addr) => ({
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
      while (
        convertAddressToField(newAddress) >= sortedAddresses[size - 1].field
      ) {
        newAddress = new Account().address().to_string();
      }

      sortedAddresses[size - 1] = {
        address: newAddress,
        field: convertAddressToField(newAddress),
      };

      const sortedFieldElements = sortedAddresses
        .sort((a, b) => (a.field < b.field ? -1 : 1))
        .map((item) => item.field.toString() + "field");

      const tree = await buildTree(sortedFieldElements);
      const merkleProof = getSiblingPath(tree, 0, MAX_TREE_SIZE);

      await contract.verify_non_inclusion(smallestAddress, [
        merkleProof,
        merkleProof,
      ]);

      const merkleProof1 = getSiblingPath(tree, size - 1, MAX_TREE_SIZE);

      await contract.verify_non_inclusion(largestAddress, [
        merkleProof1,
        merkleProof1,
      ]);
    },
    timeout,
  );

  test(
    `large tree random test, depth 12`,
    async () => {
      const depth = 12;
      const size = 2 ** depth;
      const addresses = Array(size)
        .fill(null)
        .map(() => new Account().address().to_string());

      const sortedAddresses = await genLeaves(addresses, depth);
      const tree = await buildTree(sortedAddresses);

      const checkedAddress = new Account().address().to_string();
      const checkedField =
        convertAddressToField(checkedAddress).toString() + "field";
      const checkedBint = BigInt(checkedField.slice(0, -"field".length));

      let leftLeafIndex: number;
      let rightLeafIndex: number;

      if (checkedBint < tree[0]) {
        leftLeafIndex = rightLeafIndex = 0;
      } else if (checkedBint > tree[size - 1]) {
        leftLeafIndex = rightLeafIndex = size - 1;
      } else {
        for (let i = 0; i < sortedAddresses.length - 1; i++) {
          if (checkedBint > tree[i] && checkedBint < tree[i + 1]) {
            leftLeafIndex = i;
            rightLeafIndex = i + 1;
            break;
          }
        }
      }

      const merkleProof0 = getSiblingPath(tree, leftLeafIndex, MAX_TREE_SIZE);
      const merkleProof1 = getSiblingPath(tree, rightLeafIndex, MAX_TREE_SIZE);

      await contract.verify_non_inclusion(checkedAddress, [
        merkleProof0,
        merkleProof1,
      ]);
    },
    timeout,
  );

  test(
    `all cases, depth 3`,
    async () => {
      const leaves = await genLeaves(
        [
          "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
          "aleo104ur4csap6qp3fguddw3mn7f6ddpfkn4clqzzkyjhxmw5j46xsrse6vt5f",
          "aleo194vjp7nt6pwgpruw3kz5fk5kvj9ur6sg2f4k84fqu6cpgq5xhvrs7emymc",
          "aleo1wkyn0ax8nhftfxn0hkx8kgh46yxqla7tzd6z77jhcf5wne6z3c9qnxl2l4",
          "aleo1g3n6k74jx5zzxndnxjzvpgt0zwce93lz00305lycyvayfyyqwqxqxlq7ma",
          "aleo1tjkv7vquk6yldxz53ecwsy5csnun43rfaknpkjc97v5223dlnyxsglv7nm",
          "aleo18khmhg2nehxxsm6km43ah7qdudjkjw7mgpsfya9vvzx3vlq9hyxs8vzdds",
          "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
        ],
        3,
      );
      const tree = await buildTree(leaves);

      const merkleProof0 = getSiblingPath(tree, 0, MAX_TREE_SIZE);
      const merkleProof2 = getSiblingPath(tree, 2, MAX_TREE_SIZE);
      const merkleProof3 = getSiblingPath(tree, 3, MAX_TREE_SIZE);
      const merkleProof4 = getSiblingPath(tree, 4, MAX_TREE_SIZE);
      const merkleProof7 = getSiblingPath(tree, 7, MAX_TREE_SIZE);

      await contract.verify_non_inclusion(
        "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
        [merkleProof2, merkleProof3],
      );

      // the siblings indices are not adjusted
      await expect(
        contract.verify_non_inclusion(
          "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
          [merkleProof2, merkleProof4],
        ),
      ).rejects.toThrow();

      // the address is in the list
      await expect(
        contract.verify_non_inclusion(
          "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
          [merkleProof2, merkleProof3],
        ),
      ).rejects.toThrow();

      // the address is not in a provided range (large)
      await expect(
        contract.verify_non_inclusion(
          "aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t",
          [merkleProof2, merkleProof3],
        ),
      ).rejects.toThrow();

      //  the address is not in a provided range (smaller)
      await expect(
        contract.verify_non_inclusion(
          "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
          [merkleProof2, merkleProof3],
        ),
      ).rejects.toThrow();

      //  invalid left path
      await expect(
        contract.verify_non_inclusion(
          "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
          [{ siblings: merkleProof2.siblings, leaf_index: 1 }, merkleProof4],
        ),
      ).rejects.toThrow();

      //  invalid right path
      await expect(
        contract.verify_non_inclusion(
          "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
          [merkleProof2, { siblings: merkleProof3.siblings, leaf_index: 1 }],
        ),
      ).rejects.toThrow();

      // the most left address
      await expect(
        contract.verify_non_inclusion(
          "aleo193cgzzpr5lcwq6rmzq4l2ctg5f4mznead080mclfgrc0e5k0w5pstfdfps",
          [merkleProof0, merkleProof0],
        ),
      ).rejects.toThrow();
      await contract.verify_non_inclusion(
        "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
        [merkleProof0, merkleProof0],
      );

      // the most right address
      await expect(
        contract.verify_non_inclusion(
          "aleo17mp7lz72e7zhvzyj8u2szrts2r98vz37sd6z9w500s99aaq4sq8s34vgv9",
          [merkleProof7, merkleProof7],
        ),
      ).rejects.toThrow();
      await contract.verify_non_inclusion(
        "aleo16k94hj5nsgxpgnnk9u6580kskgucqdadzekmlmvccp25frwd8qgqvn9p9t",
        [merkleProof7, merkleProof7],
      );
    },
    timeout,
  );
});
