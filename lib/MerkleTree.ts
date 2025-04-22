import { Field, Plaintext, Poseidon4 } from "@provablehq/sdk";
import { convertAddressToField } from "./Conversion";

function hashTwoElements(el1: string, el2: string) {
    const hasher = new Poseidon4();
    const fields = [
      Field.fromString(el1),
      Field.fromString(el2)
    ];
    const arrayPlaintext = Plaintext.fromString(`[${fields.map(f => f.toString()).join(',')}]`);
    
    return hasher.hash(arrayPlaintext.toFields());
  }
  
  export async function buildTree(leaves: string[]) {
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
    
    const treeBN = tree.map(element => {
        return BigInt(element.slice(0, element.length - "field".length));
    });
  
    return treeBN;
  }
  
  export function genLeaves(leaves, depth) {
    let num_leaves = Math.floor(2**depth);
  
    const leaveFields = leaves.map(leave => ({
      leave,
      field: convertAddressToField(leave),
  }));
  
    const sortedLeaves = leaveFields
    .sort((a, b) => (a.field < b.field ? -1 : 1))
    .map(item => item.field);
  
    const sortedFieldElements = sortedLeaves.map(leaf => {
      return leaf.toString() + "field";
    })
  
    const fullTree = Array(Math.max(num_leaves - sortedFieldElements.length, 0)).fill("0field");
  
    return fullTree.concat(sortedFieldElements);
  }