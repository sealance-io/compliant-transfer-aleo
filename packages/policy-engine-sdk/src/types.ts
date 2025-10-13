/**
 * Merkle proof structure matching the Leo program definition
 * Contains sibling hashes and the leaf index for proof verification
 */
export interface MerkleProof {
  siblings: bigint[];
  leaf_index: number;
}

/**
 * Configuration for the PolicyEngine SDK
 */
export interface PolicyEngineConfig {
  /**
   * Aleo network endpoint (e.g., "http://localhost:3030" or "https://api.explorer.provable.com/v1")
   */
  endpoint: string;

  /**
   * Network name (e.g., "testnet", "mainnet")
   */
  network: string;

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
   * Balances speed vs server load. Higher values = faster but more load.
   * @default 10
   */
  maxConcurrency?: number;
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
