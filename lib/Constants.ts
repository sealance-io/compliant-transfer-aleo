import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo1t6aat4vk4u7jq2zk5fjk2actdp64s7n6m4pmn3xnw4quxw2545qsmk2mlc";
export const COMPLIANT_THRESHOLD_TRANSFER_ADDRESS = "aleo1crqfjftyxdty2ugd788j655clkptrfpqnqm0xdvt296dmtmm6gzst2qfkz";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
export const COMPLIANT_TIMELOCK_TRANSFER_ADDRESS =
  "aleo18g6qksdhstu4e9exg9mfgv6cdq84exx24za9c6e50hgsmg5xjsfqq5saq3";
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
        tokenName: "Sealed report policy",
        tokenSymbol: "SEALED_REPORT_POLICY",
        tokenId: stringToBigInt("SEALED_REPORT_POLICY"),
        programAddress: COMPLIANT_TRANSFER_ADDRESS,
        Contract: Sealed_report_policyContract,
        initMappings: false,
        requireInitialization: false,
        blockHeightWindow: 0,
    },
    threshold: {
        tokenName: "Sealed threshold report policy",
        tokenSymbol: "SEALED_THRESHOLD_REPORT_POLICY",
        tokenId: stringToBigInt("SEALED_THRESHOLD_REPORT_POLICY"),
        programAddress: COMPLIANT_THRESHOLD_TRANSFER_ADDRESS,
        Contract: Sealed_threshold_report_policyContract,
        initMappings: true,
        requireInitialization: false,
        blockHeightWindow: 150,
    },
    timelock: {
        tokenName: "Sealed timelock policy",
        tokenSymbol: "SEALED_TIMELOCK_POLICY",
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
