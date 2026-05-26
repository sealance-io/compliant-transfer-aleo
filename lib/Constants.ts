import { stringToBigInt, ZERO_ADDRESS } from "@sealance-io/policy-engine-aleo";
import { Leo } from "../typechain/BaseContract";
import { multisigCommonParams } from "./Multisig";
import { fieldLiteral, scalarLiteral } from "./LiondenAdapters";
import { Address } from "@provablehq/sdk";

// addresses
export { ZERO_ADDRESS }; // for backwards compatability
export const TREASURE_ADDRESS = "aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn";

export const BLOCK_HEIGHT_WINDOW = 300;

export interface IPolicy {
  tokenName: string;
  tokenSymbol: string;
  tokenId: bigint;
  programAddress: string;
  initMappings: boolean;
  requireInitialization: boolean;
  blockHeightWindow: number;
}
Address.fromProgramId("sealed_report_policy.aleo").to_string();
// policies specs
export const policies: { [key: string]: IPolicy } = {
  report: {
    tokenName: "Report",
    tokenSymbol: "REPORT",
    tokenId: stringToBigInt("SEALED_REPORT_POLICY"),
    programAddress: Address.fromProgramId("sealed_report_policy.aleo").to_string(),
    initMappings: false,
    requireInitialization: false,
    blockHeightWindow: BLOCK_HEIGHT_WINDOW,
  },
  threshold: {
    tokenName: "Threshold report",
    tokenSymbol: "THRESHOLD_REPORT",
    tokenId: stringToBigInt("SEALED_THRESHOLD_REPORT_POLICY"),
    programAddress: Address.fromProgramId("sealed_threshold_report_policy.aleo").to_string(),
    initMappings: true,
    requireInitialization: false,
    blockHeightWindow: BLOCK_HEIGHT_WINDOW,
  },
  timelock: {
    tokenName: "Timelock",
    tokenSymbol: "TIMELOCK",
    tokenId: stringToBigInt("SEALED_TIMELOCK_POLICY"),
    programAddress: Address.fromProgramId("sealed_timelock_policy.aleo").to_string(),
    initMappings: false,
    requireInitialization: true,
    blockHeightWindow: 0,
  },
};

// Indexes
export const CURRENT_FREEZE_LIST_ROOT_INDEX = 1;
export const PREVIOUS_FREEZE_LIST_ROOT_INDEX = 2;
export const ROOT_UPDATED_HEIGHT_INDEX = true;
export const BLOCK_HEIGHT_WINDOW_INDEX = true;
export const FREEZE_REGISTRY_PROGRAM_INDEX = true;
export const EPOCH_INDEX = true;
export const THRESHOLD_INDEX = true;
export const FREEZE_LIST_LAST_INDEX = true;

export const THRESHOLD = 1000000000n;
export const EPOCH = 8640;

export const NONE_ROLE = 0;
export const MINTER_ROLE = 1;
export const BURNER_ROLE = 2;
export const PAUSE_ROLE = 4;
export const MANAGER_ROLE = 8;
export const FREEZELIST_MANAGER_ROLE = 16;

export const MULTISIG_OP_UPDATE_WALLET_ROLE = 1;
export const MULTISIG_OP_UPDATE_ROLE = 2;
export const MULTISIG_OP_SET_PAUSE_STATUS = 3;
export const MULTISIG_OP_MINT_PUBLIC = 4;
export const MULTISIG_OP_BURN_PUBLIC = 5;
export const MULTISIG_OP_MINT_PRIVATE = 6;
export const MULTISIG_OP_BURN_PRIVATE = 7;
export const MULTISIG_OP_UPDATE_BLOCK_WINDOW = 3;
export const MULTISIG_OP_UPDATE_FREEZE_LIST = 4;

// Maximum depth of the Merkle tree used in freeze list proofs (matches Leo MAX_TREE_DEPTH).
// The MerkleProof siblings array has MAX_TREE_DEPTH + 1 elements: [leaf, sibling_1, ..., sibling_depth].
export const MAX_TREE_DEPTH = 15;

// testing constant
export const defaultAuthorizedUntil = 4294967295;
export const emptyRoot = 3642222252059314292809609689035560016959342421640560347114299934615987159853n;
export const fundedAmount = 1000000000n;
export const defaultRate = 10n;
export const zeroAddress = Leo.address(ZERO_ADDRESS);
export const emptyRootField = fieldLiteral(emptyRoot);
export const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
export const amount = 10n;
export const decimals = 6;
export const maxSupply = 1_000_000_000_000_000n;

export const emptyMultisigCommonParams = multisigCommonParams(Leo.address(ZERO_ADDRESS), 0n);

export const MAX_BLOCK_HEIGHT = 4294967295; // 2**32 - 1
