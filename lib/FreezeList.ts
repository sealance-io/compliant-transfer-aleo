import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { FREEZE_LIST_LAST_INDEX, mode, ZERO_ADDRESS } from "./Constants";
import { buildTree, generateLeaves } from "@sealance-io/policy-engine-aleo";

// Re-export SDK functions for backward compatibility
export { getLeafIndices, getSiblingPath } from "@sealance-io/policy-engine-aleo";

const reportPolicyContract = new Sealed_report_policyContract({ mode });

export enum FreezeStatus {
  ALREADY_FROZEN,
  NEW_ENTRY,
}

export type FreezeListUpdateResult =
  | { status: FreezeStatus.ALREADY_FROZEN }
  | { status: FreezeStatus.NEW_ENTRY; frozenIndex: number; root: bigint };

export async function calculateFreezeListUpdate(
  address: string,
  leavesLength: number,
): Promise<FreezeListUpdateResult> {
  const isAccountFrozen = await reportPolicyContract.freeze_list(address, false);
  if (isAccountFrozen) {
    return { status: FreezeStatus.ALREADY_FROZEN };
  }

  let addresses: string[] = [];
  const lastIndex = await reportPolicyContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
  for (let i = 0; i <= lastIndex; i++) {
    addresses.push(await reportPolicyContract.freeze_list_index(i));
  }

  let frozenIndex = addresses.findIndex(addr => addr === ZERO_ADDRESS);
  if (frozenIndex === -1) {
    if (addresses.length === leavesLength) {
      throw new Error("Merkle tree is full, there is no place for the new frozen account");
    }
    frozenIndex = addresses.length;
    addresses.push(address);
  } else {
    addresses[frozenIndex] = address;
  }

  const leaves = generateLeaves(addresses);
  const tree = buildTree(leaves);
  const root = tree[tree.length - 1];

  return { status: FreezeStatus.NEW_ENTRY, frozenIndex, root };
}
