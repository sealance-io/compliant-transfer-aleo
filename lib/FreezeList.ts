import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { mode } from "./Constants";
import { convertAddressToField } from "./Conversion";
import { buildTree, genLeaves } from "./MerkleTree";

const compliantTransferContract = new Sealed_report_policyContract({ mode });

export enum FreezeStatus {
  ALREADY_FROZEN,
  NEW_ENTRY
}

export type FreezeListUpdateResult = 
  | { status: FreezeStatus.ALREADY_FROZEN }
  | { status: FreezeStatus.NEW_ENTRY, lastIndex: number, root: bigint }

  export async function calculateFreezeListUpdate(
    address: string, 
    leavesLength: number
  ): Promise<FreezeListUpdateResult> {
  const isAccountFreezed = await compliantTransferContract.freeze_list(address, false);
  if (isAccountFreezed) {
    return { status: FreezeStatus.ALREADY_FROZEN }
  }

  let addresses: string[] = [];
  let lastIndex = 0;
  for (let i = 0; addresses.length < leavesLength; i++) {
    try {
      addresses.push(await compliantTransferContract.freeze_list_index(i));
      lastIndex = i + 1;
    } catch {
      break;
    }
  }
  if (addresses.length === leavesLength) {
    throw new Error("Merkle tree is full, there is no place for the new freezed account");
  }
  addresses.push(address);
  const leaves = genLeaves(addresses);
  const tree = buildTree(leaves);
  const root = tree[tree.length - 1];

  return { status: FreezeStatus.NEW_ENTRY, lastIndex, root };
}

export function getLeafIndices(merkleTree: bigint[], address: string): [number, number] {
  const num_leaves = Math.floor((merkleTree.length + 1) / 2);
  const addressBigInt = convertAddressToField(address);
  const leaves = merkleTree.slice(0, num_leaves);
  let rightLeafIndex = leaves.findIndex((leaf: bigint) => addressBigInt <= leaf);
  let leftLeafIndex = rightLeafIndex - 1;
  if (rightLeafIndex === -1) {
    rightLeafIndex = leaves.length - 1;
    leftLeafIndex = leaves.length - 1;
  }
  if (rightLeafIndex === 0) {
    leftLeafIndex = 0;
  }
  return [leftLeafIndex, rightLeafIndex];
}

export function getSiblingPath(tree: string | any[], leafIndex: number, depth: number): { siblings: any[]; leaf_index: number; } {
  let num_leaves = Math.floor((tree.length + 1) / 2);
  const siblingPath = [];

  let index = leafIndex;
  let parentIndex = num_leaves;
  siblingPath.push(tree[index]);
  let level = 1;
  while (parentIndex < tree.length) {
    let siblingIndex = index % 2 === 0 ? index + 1 : index - 1; // Get the sibling index
    siblingPath.push(tree[siblingIndex]);

    index = parentIndex + Math.floor(leafIndex / 2 ** level); // Move up to the parent node
    parentIndex += Math.floor(num_leaves / 2 ** level); // Halve the number of nodes for the next level
    level++;
  }

  while (level < depth) {
    siblingPath.push(0n);
    level++;
  }

  return { siblings: siblingPath, leaf_index: leafIndex };
}
