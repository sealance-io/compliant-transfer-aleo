import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo18t5vlckuaxxaujsl0q03lqs690cgk0zfca6lj3hpeqk5kh4zzupqtzr7j2";
export const COMPLIANT_THRESHOLD_TRANSFER_ADDRESS = "aleo14s6pc22xlf33wm62422v24equzj0s5wlsffrcl43lgfyy6wsdvgs9h6ns7";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
export const COMPLIANT_TIMELOCK_TRANSFER_ADDRESS =
  "aleo1q40dlwxfgka53c3wt5ef5k0yvf06dksgcrkdc0r20xpky0ezwqrqpzggeq";
export const TREASURE_ADDRESS=  "aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn";

export interface IPolicy {
    tokenName: string,
    tokenSymbol: string,
    tokenId: bigint,
    programAddress: string,
    Contract: any,
    initMappings: boolean,
    requireInitialization: boolean,
    blockHeightWindow: number
}

// policies specs
export const policies: {[key: string]: IPolicy} = {
    compliant: {
        tokenName: "Report",
        tokenSymbol: "REPORT",
        tokenId: stringToBigInt("SEALED_REPORT_POLICY"),
        programAddress: COMPLIANT_TRANSFER_ADDRESS,
        Contract: Sealed_report_policyContract,
        initMappings: false,
        requireInitialization: false,
        blockHeightWindow: 0,
    },
    threshold: {
        tokenName: "Threshold report",
        tokenSymbol: "THRESHOLD_REPORT",
        tokenId: stringToBigInt("SEALED_THRESHOLD_REPORT_POLICY"),
        programAddress: COMPLIANT_THRESHOLD_TRANSFER_ADDRESS,
        Contract: Sealed_threshold_report_policyContract,
        initMappings: true,
        requireInitialization: false,
        blockHeightWindow: 150,
    },
    timelock: {
        tokenName: "Timelock",
        tokenSymbol: "TIMELOCK",
        tokenId: stringToBigInt("SEALED_TIMELOCK_POLICY"),
        programAddress: COMPLIANT_TIMELOCK_TRANSFER_ADDRESS,
        Contract: Sealed_timelock_policyContract,
        initMappings: false,
        requireInitialization: true,
        blockHeightWindow: 0,
    }
}

export const THRESHOLD = 1000000000n;
export const EPOCH = 18000;

// merkle tree
export const MAX_TREE_SIZE = 16;

// testing constant
export const defaultAuthorizedUntil = 4294967295;
export const fundedAmount = 10000000000000n;
export const timeout = 10000000;
export const mode = ExecutionMode.SnarkExecute;
export const defaultRate = 10n;
