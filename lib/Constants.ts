import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";

// addresses
export const SEALED_REPORT_POLICY_ADDRESS = "aleo18t5vlckuaxxaujsl0q03lqs690cgk0zfca6lj3hpeqk5kh4zzupqtzr7j2";
export const SEALED_THRESHOLD_POLICY_ADDRESS = "aleo14s6pc22xlf33wm62422v24equzj0s5wlsffrcl43lgfyy6wsdvgs9h6ns7";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
export const SEALED_TIMELOCK_POLICY_ADDRESS = "aleo1q40dlwxfgka53c3wt5ef5k0yvf06dksgcrkdc0r20xpky0ezwqrqpzggeq";
export const TREASURE_ADDRESS = "aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn";

export const BLOCK_HEIGHT_WINDOW = 300;

export interface IPolicy {
  tokenName: string;
  tokenSymbol: string;
  tokenId: bigint;
  programAddress: string;
  Contract: any;
  initMappings: boolean;
  requireInitialization: boolean;
  blockHeightWindow: number;
}

// policies specs
export const policies: { [key: string]: IPolicy } = {
  report: {
    tokenName: "Report",
    tokenSymbol: "REPORT",
    tokenId: stringToBigInt("SEALED_REPORT_POLICY"),
    programAddress: SEALED_REPORT_POLICY_ADDRESS,
    Contract: Sealed_report_policyContract,
    initMappings: false,
    requireInitialization: false,
    blockHeightWindow: BLOCK_HEIGHT_WINDOW,
  },
  threshold: {
    tokenName: "Threshold report",
    tokenSymbol: "THRESHOLD_REPORT",
    tokenId: stringToBigInt("SEALED_THRESHOLD_REPORT_POLICY"),
    programAddress: SEALED_THRESHOLD_POLICY_ADDRESS,
    Contract: Sealed_threshold_report_policyContract,
    initMappings: true,
    requireInitialization: false,
    blockHeightWindow: BLOCK_HEIGHT_WINDOW,
  },
  timelock: {
    tokenName: "Timelock",
    tokenSymbol: "TIMELOCK",
    tokenId: stringToBigInt("SEALED_TIMELOCK_POLICY"),
    programAddress: SEALED_TIMELOCK_POLICY_ADDRESS,
    Contract: Sealed_timelock_policyContract,
    initMappings: false,
    requireInitialization: true,
    blockHeightWindow: 0,
  },
};

// Indexes
export const ADMIN_INDEX = 1;
export const INVESTIGATOR_INDEX = 2;
export const MINTER_INDEX = 3;
export const FREEZE_LIST_MANAGER_INDEX = 4;
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
export const maxRoles = 16;
export const maxAddressesPerRole = 8;
// merkle tree
export const MAX_TREE_SIZE = 16;
export const TREE_DEPTH_12 = 13;

// testing constant
export const defaultAuthorizedUntil = 4294967295;
export const emptyRoot = 3642222252059314292809609689035560016959342421640560347114299934615987159853n;
export const fundedAmount = 10000000000000n;
export const mode = ExecutionMode.SnarkExecute;
export const defaultRate = 10n;
