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
export { buildTree, genLeaves, getLeafIndices, getSiblingPath, ZERO_ADDRESS } from "./merkle-tree.js";
export { convertAddressToField, convertFieldToAddress, stringToBigInt } from "./conversion.js";
export type {
  MerkleProof,
  PolicyEngineConfig,
  FreezeListResult,
  TransferWitnessOptions,
  TransferWitness,
} from "./types.js";
