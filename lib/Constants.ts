import { ExecutionMode } from "@doko-js/core";
import { stringToBigInt } from "./Conversion";

export const ALEO_TESTNET_API = "https://capable.snarkos.net";

// addresses
export const COMPLIANT_TRANSFER_ADDRESS = "aleo1x3hrdn4gttc9dnfd2cyz6ss3tlfuev27w3hnwclgpw0vw93nf58sz4h8uh";
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

// token specs
export const tokenName = "SEALEDTOKEN_V2";
export const tokenSymbol = "SEALED";
export const tokenId = stringToBigInt(tokenName);

// merkle tree
export const MAX_TREE_SIZE = 4;

// testing constant
export const defaultAuthorizedUntil = 4294967295;
export const fundedAmount = 10000000000000n;
export const timeout = 10000000;
export const mode = ExecutionMode.SnarkExecute;