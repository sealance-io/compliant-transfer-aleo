/**
 * @sealance-io/policy-engine-aleo
 *
 * SDK for generating Merkle proofs and interacting with Aleo compliance policy programs.
 * This library provides utilities for:
 * - Building Merkle trees from freeze lists
 * - Generating non-inclusion proofs for private compliant operations
 * - Fetching freeze lists from the Aleo blockchain
 * - Converting between addresses and field elements
 *
 * @module @sealance-io/policy-engine-aleo
 */

export { PolicyEngine } from "./policy-engine.js";
export { AleoAPIClient } from "./api-client.js";
export { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "./merkle-tree.js";
export { convertAddressToField, convertFieldToAddress, stringToBigInt } from "./conversion.js";
export { defaultLogger, silentLogger } from "./logger.js";
export { trackTransactionStatus } from "./transaction-tracker.js";
export { calculateBackoff, parseRetryAfter, sleep } from "./fetch-utils.js";
export { ZERO_ADDRESS } from "./constants.js";
export type {
  MerkleProof,
  PolicyEngineConfig,
  FreezeListResult,
  NonInclusionProofOptions,
  NonInclusionWitness,
  TransactionStatus,
  TransactionStatusType,
  TransactionType,
  TransactionTrackingOptions,
} from "./types.js";
export type { Logger, LogLevel } from "./logger.js";
