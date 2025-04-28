import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { RawxtbrzceContract } from "../artifacts/js/rawxtbrzce";
import { RiwoxowhvaContract } from "../artifacts/js/riwoxowhva";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo1t6aat4vk4u7jq2zk5fjk2actdp64s7n6m4pmn3xnw4quxw2545qsmk2mlc";
export const COMPLIANT_THRESHOLD_TRANSFER_ADDRESS = "aleo1w9w0zz3xlxngpws8q7cw9c98den5u3jkqt2y60effkphhe3urs8q5xhdtz";
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
        tokenName: "SEALEDTOKEN_V2",
        tokenSymbol: "SEALED",
        tokenId: stringToBigInt("SEALEDTOKEN_V2"),
        programAddress: COMPLIANT_TRANSFER_ADDRESS,
        Contract: Tqxftxoicd_v2Contract,
        initMappings: false,
        requireInitialization: false,
        blockHeightWindow: 0,
    },
    threshold: {
        tokenName: "Threshold Token",
        tokenSymbol: "THRESHOLD",
        tokenId: stringToBigInt("Threshold Token"),
        programAddress: COMPLIANT_THRESHOLD_TRANSFER_ADDRESS,
        Contract: RiwoxowhvaContract,
        initMappings: true,
        requireInitialization: false,
        blockHeightWindow: 150,
    },
    timelock: {
        tokenName: "TIMELOCK_TOKEN",
        tokenSymbol: "TIMELOCK",
        tokenId: stringToBigInt("TIMELOCK"),
        programAddress: COMPLIANT_TIMELOCK_TRANSFER_ADDRESS,
        Contract: RawxtbrzceContract,
        initMappings: false,
        requireInitialization: true,
        blockHeightWindow: 0,
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
export const defaultRate = 10n;
