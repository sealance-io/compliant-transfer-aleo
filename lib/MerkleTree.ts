import { Field, Plaintext, Poseidon4 } from "@provablehq/sdk";
import { convertAddressToField } from "./Conversion";
import { ZERO_ADDRESS, MAX_TREE_SIZE } from "./Constants";

/**
 * Hashes two elements using Poseidon4 hash function
 * @throws {Error} If inputs are empty or invalid
 */
function hashTwoElements(el1: string, el2: string): Promise<Field> {
  if (!el1 || !el2) {
    throw new Error("Invalid inputs: elements cannot be empty");
  }
  const hasher = new Poseidon4();
  const fields = [Field.fromString(el1), Field.fromString(el2)];
  const arrayPlaintext = Plaintext.fromString(`[${fields.map(f => f.toString()).join(",")}]`);

  return hasher.hash(arrayPlaintext.toFields());
}

/**
 * Builds a Merkle tree from given leaves
 * @throws {Error} If leaves array has odd number of elements
 */
export async function buildTree(leaves: string[]): Promise<bigint[]> {
  if (leaves.length === 0) {
    throw new Error("Leaves array cannot be empty");
  }
  if (leaves.length % 2 !== 0) {
    throw new Error("Leaves array must have even number of elements");
  }

  let currentLevel = leaves;
  let tree = [...currentLevel];
  let levelSize = currentLevel.length;

  while (levelSize > 1) {
    const nextLevel = [];
    for (let i = 0; i < levelSize; i += 2) {
      const left = currentLevel[i];
      const right = currentLevel[i + 1];
      const hash = await hashTwoElements(left, right);
      nextLevel.push(hash.toString());
    }
    tree = [...tree, ...nextLevel];
    currentLevel = nextLevel;
    levelSize = currentLevel.length;
  }

  return tree.map(element => BigInt(element.slice(0, element.length - "field".length)));
}

/**
 * Converts Leo addresses to field element, sort, pad with 0field and return an array
 */
export function genLeaves(leaves: string[]): string[] {
  const maxNumLeaves = Math.floor(2 ** (MAX_TREE_SIZE - 1));

  leaves = leaves.filter(leaf => leaf !== ZERO_ADDRESS);
  let numLeaves = 0;
  if (leaves.length === 0 || leaves.length === 1) {
    numLeaves = 2;
  } else {
    numLeaves = Math.pow(2, Math.ceil(Math.log2(leaves.length)));
  }

  if (leaves.length > maxNumLeaves) {
    throw new Error("Leaves limit exceeded. Max: " + maxNumLeaves);
  }

  const leavesFields = leaves.map(leave => ({
    leave,
    field: convertAddressToField(leave),
  }));

  const sortedLeaves = leavesFields.sort((a, b) => (a.field < b.field ? -1 : 1)).map(item => item.field);

  const sortedFieldElements = sortedLeaves.map(leaf => leaf.toString() + "field");

  const fullTree = Array(Math.max(numLeaves - sortedFieldElements.length, 0)).fill("0field");

  return fullTree.concat(sortedFieldElements);
}
