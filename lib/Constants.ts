import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

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