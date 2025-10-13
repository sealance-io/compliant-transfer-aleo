/**
 * Merkle proof structure matching the Leo program definition
 * Contains sibling hashes and the leaf index for proof verification
 */
export interface MerkleProof {
  siblings: bigint[];
  leaf_index: number;
}

import type { Logger } from "./logger.js";

/**
 * Configuration for the PolicyEngine SDK
 */
export interface PolicyEngineConfig {
  /**
   * Aleo network endpoint
   * @default "https://api.explorer.provable.com/v1"
   * @example "http://localhost:3030" - Local devnet
   * @example "https://api.explorer.provable.com/v1" - Public mainnet/testnet
   */
  endpoint?: string;

  /**
   * Network name
   * @default "mainnet"
   * @example "testnet" - Public testnet (use with endpoint: "https://api.explorer.provable.com/v1")
   * @example "mainnet" - Public mainnet (use with endpoint: "https://api.explorer.provable.com/v1")
   */
  network?: string;

  /**
   * Maximum depth of the Merkle tree (must match MAX_TREE_DEPTH in merkle_tree.leo)
   * @default 15
   */
  maxTreeDepth?: number;

  /**
   * Number of retry attempts for API calls
   * @default 5
   */
  maxRetries?: number;

  /**
   * Delay between retry attempts in milliseconds
   * @default 2000
   */
  retryDelay?: number;

  /**
   * Maximum number of concurrent HTTP requests when fetching freeze list
   *
   * Trade-offs:
   * - Higher values (10-20): Faster fetching, more server load
   * - Lower values (1-5): Slower but safer, easier debugging
   * - Set to 1: Serialized processing, simplest behavior
   *
   * @default 10
   */
  maxConcurrency?: number;

  /**
   * Custom logger for SDK operations
   *
   * @default defaultLogger (logs to console)
   *
   * @example
   * ```typescript
   * // Disable all logs (useful for production or testing)
   * import { silentLogger } from "@sealance-io/policy-engine-aleo";
   * const engine = new PolicyEngine({ ..., logger: silentLogger });
   *
   * // Custom logger integration
   * const engine = new PolicyEngine({
   *   ...,
   *   logger: (level, message, context) => {
   *     myAppLogger.log({ level, message, ...context });
   *   }
   * });
   * ```
   */
  logger?: Logger;
}

/**
 * Result of fetching freeze list from chain
 */
export interface FreezeListResult {
  /**
   * Array of frozen addresses
   */
  addresses: string[];

  /**
   * Last index in the freeze list
   */
  lastIndex: number;

  /**
   * Current Merkle root of the freeze list
   */
  currentRoot: bigint;
}

/**
 * Options for generating transfer witness
 */
export interface TransferWitnessOptions {
  /**
   * The freeze list addresses (if already fetched)
   * If not provided, programId must be specified to fetch from chain
   */
  freezeList?: string[];

  /**
   * Program ID of the freeze list registry
   * Required when freezeList is not provided
   */
  programId?: string;
}

/**
 * Result of generating transfer witness
 */
export interface TransferWitness {
  /**
   * Array of two Merkle proofs for non-inclusion verification
   */
  proofs: [MerkleProof, MerkleProof];

  /**
   * The Merkle root used for the proofs
   */
  root: bigint;

  /**
   * The freeze list used to generate the proofs
   */
  freezeList: string[];
}
