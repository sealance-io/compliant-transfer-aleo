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
   * Last populated index in the on-chain freeze list
   */
  lastIndex: number;

  /**
   * Current on-chain Merkle root of the freeze list
   */
  currentRoot: bigint;
}

/**
 * Options for generating non-inclusion proof
 */
export interface NonInclusionProofOptions {
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
 * Result of generating non-inclusion proof
 */
export interface NonInclusionWitness {
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

/**
 * Transaction type on the Aleo blockchain
 */
export type TransactionType = "execute" | "deploy" | "fee";

/**
 * Transaction status on the Aleo blockchain
 */
export type TransactionStatusType = "accepted" | "rejected" | "aborted" | "pending";

/**
 * Status of an Aleo transaction
 */
export interface TransactionStatus {
  /**
   * Current status of the transaction
   * - 'accepted': Transaction was successfully executed and included in a block
   * - 'rejected': Transaction failed but fee was consumed (type will be 'fee')
   * - 'aborted': Both execution and fee processing failed
   * - 'pending': Transaction is waiting to be included in a block
   */
  status: TransactionStatusType;

  /**
   * Type of transaction
   * - 'execute': Function execution transaction
   * - 'deploy': Program deployment transaction
   * - 'fee': Fee-only transaction (indicates rejection)
   */
  type: TransactionType;

  /**
   * Confirmed transaction ID (the ID that appears on-chain)
   */
  confirmedId: string;

  /**
   * Original unconfirmed transaction ID (if different from confirmedId)
   * This is typically set when a transaction is rejected
   */
  unconfirmedId?: string;

  /**
   * Block height where the transaction was included
   */
  blockHeight?: number;

  /**
   * Error message if the transaction failed
   */
  error?: string;
}

/**
 * Configuration options for tracking transaction status
 */
export interface TransactionTrackingOptions {
  /**
   * Maximum number of polling attempts before giving up
   * @default 60
   */
  maxAttempts?: number;

  /**
   * Delay between polling attempts in milliseconds
   * @default 5000 (5 seconds)
   */
  pollInterval?: number;

  /**
   * Overall timeout for the entire tracking operation in milliseconds
   * @default 300000 (5 minutes)
   */
  timeout?: number;

  /**
   * Timeout for individual fetch requests in milliseconds
   * @default 30000 (30 seconds)
   */
  fetchTimeout?: number;

  /**
   * Network name (optional, for logging purposes)
   * @example "testnet", "mainnet"
   */
  network?: string;

  /**
   * Custom logger for transaction tracking operations
   * @default defaultLogger (logs to console)
   *
   * @example
   * ```typescript
   * import { trackTransactionStatus, silentLogger } from "@sealance-io/policy-engine-aleo";
   *
   * // Disable logging
   * await trackTransactionStatus(txId, endpoint, { logger: silentLogger });
   *
   * // Custom logger
   * await trackTransactionStatus(txId, endpoint, {
   *   logger: (level, message, context) => {
   *     myLogger.log({ level, message, ...context });
   *   }
   * });
   * ```
   */
  logger?: import("./logger.js").Logger;
}
