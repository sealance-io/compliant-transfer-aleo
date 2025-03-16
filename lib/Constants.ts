import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
export const INVESTIGATOR = "aleo1y3ftuud75cwspnsx9w85sw4z0pdcrxpgnsxtz2re4q0vupw9mg8szhm06m";
export const ADMIN = "aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn"
export const FREEZED_ACCOUNT = "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t"

// private keys
export const investigatorPrivKey = process.env.ALEO_DEVNET_PRIVATE_KEY4;
export const adminPrivKey = process.env.ALEO_PRIVATE_KEY
export const freezedAccountPrivKey = process.env.ALEO_DEVNET_PRIVATE_KEY2

// token specs
export const tokenName = "SEALEDTOKEN";
export const tokenSymbol = "SEALED";
export const tokenId = stringToBigInt(tokenName);

// merkle tree
export const MAX_TREE_SIZE = 16;

// testing constant
export const defaultAuthorizedUntil = 4294967295;
export const fundedAmount = 10000000000000n;
export const timeout = 10000000;
export const mode = ExecutionMode.SnarkExecute;