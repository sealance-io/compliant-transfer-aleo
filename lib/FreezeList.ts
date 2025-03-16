import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { FREEZED_ACCOUNT, ZERO_ADDRESS, mode, } from "./Constants";

const compliantTransferContract = new TqxftxoicdContract({ mode })
const merkleTreeContract = new RediwsozfoContract({ mode });

export async function AddToFreezeList(address: string, leavesLength: number) {
  const isAccountFreezed = await compliantTransferContract.freeze_list(address, false)
  if (!isAccountFreezed) {
    let addresses: string[] = [];
    let lastIndex = 0;
    for (let i = 0; addresses.length < leavesLength; i++) {
      try {
        addresses.push(await compliantTransferContract.freeze_list_index(i));
        lastIndex = i + 1;
      }
      catch {
        break;
      }
    }
    if (addresses.length === leavesLength) {
      throw new Error("Merkle tree is full, there is no place for the new freezed account");
    }
    addresses.push(address);
    addresses = addresses.concat(Array(leavesLength - addresses.length).fill(ZERO_ADDRESS));

    const sortTx = await merkleTreeContract.build_tree(addresses);
    let [tree] = await sortTx.wait();
    // Sorting addresses based on numbers array
    const sortedAddresses = addresses
      .map((address, index) => ({ address, number: tree[index] })) // Pair addresses with numbers
      .sort((a, b) => (a.number < b.number ? -1 : 1)) // Sort using BigInt comparison
      .map(item => item.address); // Extract sorted addresses
    const buildTreeTx = await merkleTreeContract.build_tree(sortedAddresses);
    [tree] = await buildTreeTx.wait();
    const root = tree[14];
    await compliantTransferContract.update_freeze_list(
      address,
      true,
      lastIndex,
      root
    );
  }
}

export function getSiblingPath(tree, leafIndex, depth) {
  let num_leaves = Math.floor((tree.length + 1) / 2);
  const siblingPath = [];

  let index = leafIndex;
  let parentIndex = num_leaves;
  siblingPath.push(tree[index]);
  let level = 1;
  while (parentIndex < tree.length) {
    let siblingIndex = (index % 2 === 0) ? index + 1 : index - 1;  // Get the sibling index
    siblingPath.push(tree[siblingIndex]);

    index = parentIndex + Math.floor(leafIndex / 2 ** level);  // Move up to the parent node
    parentIndex += Math.floor(num_leaves / 2 ** level);  // Halve the number of nodes for the next level
    level++;
  }

  while (level < depth) {
    siblingPath.push(0n);
    level++;
  }

  return { siblings: siblingPath, leaf_index: leafIndex };
}