import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { Compliant_threshold_transferContract } from "../artifacts/js/compliant_threshold_transfer";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo1t6aat4vk4u7jq2zk5fjk2actdp64s7n6m4pmn3xnw4quxw2545qsmk2mlc";
export const COMPLIANT_THRESHOLD_TRANSFER_ADDRESS = "aleo1f03a508uvg5fskrmzqfqyvvzd58989m2fhd02ef99qnkt85whs8q3kfjev";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
export const COMPLIANT_TIMELOCK_TRANSFER_ADDRESS =
  "aleo18n84jzwgx8xsd6jkn2adncmqez73fn0xq9njuwjn66r40yf3uszsvr3wn5";

export interface IPolicy {
    tokenName: string,
    tokenSymbol: string,
    tokenId: bigint,
    programAddress: string,
    Contract: any,
    initMappings: boolean
}
// policies specs
export const policies: {[key: string]: IPolicy} = {
    compliant: {
        tokenName: "SEALEDTOKEN_V2",
        tokenSymbol: "SEALED",
        tokenId: stringToBigInt("SEALEDTOKEN_V2"),
        programAddress: COMPLIANT_TRANSFER_ADDRESS,
        Contract: Tqxftxoicd_v2Contract,
        initMappings: false,
    },
    threshold: {
        tokenName: "Threshold Token",
        tokenSymbol: "THRESHOLD",
        tokenId: stringToBigInt("Threshold Token"),
        programAddress: COMPLIANT_THRESHOLD_TRANSFER_ADDRESS,
        Contract: Compliant_threshold_transferContract,
        initMappings: true,
    }
}

export const THRESHOLD = 1000000n;
export const EPOCH = 1800;

// merkle tree
export const MAX_TREE_SIZE = 16;

// testing constant
export const defaultAuthorizedUntil = 4294967295;
export const fundedAmount = 10000000000000n;
export const timeout = 10000000;
export const mode = ExecutionMode.SnarkExecute;
