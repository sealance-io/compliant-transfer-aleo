import type {
  PolicyEngineConfig,
  FreezeListResult,
  NonInclusionProofOptions,
  NonInclusionWitness,
  MerkleProof,
} from "./types.js";
import { AleoAPIClient } from "./api-client.js";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "./merkle-tree.js";
import { ZERO_ADDRESS } from "./constants.js";
import { defaultLogger } from "./logger.js";

/**
 * Main SDK class for generating Merkle proofs and interacting with Aleo compliance policies
 *
 * @example
 * ```typescript
 * // Default: uses mainnet
 * const engine = new PolicyEngine();
 *
 * // Public testnet:
 * const engine = new PolicyEngine({
 *   endpoint: "https://api.explorer.provable.com/v1",
 *   network: "testnet"
 * });
 *
 * // Local devnet:
 * const engine = new PolicyEngine({
 *   endpoint: "http://localhost:3030",
 *   network: "testnet"
 * });
 *
 * // Fetch freeze list from chain
 * const freezeList = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
 *
 * // Generate non-inclusion proof for an address
 * const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
 *   programId: "sealance_freezelist_registry.aleo"
 * });
 * ```
 */
export class PolicyEngine {
  private apiClient: AleoAPIClient;
  private config: Required<PolicyEngineConfig>;

  constructor(config: PolicyEngineConfig = {}) {
    this.config = {
      endpoint: config.endpoint ?? "https://api.explorer.provable.com/v1",
      network: config.network ?? "mainnet",
      maxTreeDepth: config.maxTreeDepth ?? 15,
      maxRetries: config.maxRetries ?? 5,
      retryDelay: config.retryDelay ?? 2000,
      maxConcurrency: config.maxConcurrency ?? 10,
      logger: config.logger ?? defaultLogger,
    };
    this.apiClient = new AleoAPIClient(this.config);
  }

  /**
   * Fetches only the current Merkle root from the blockchain
   *
   * This is a lightweight operation that only queries the freeze_list_root mapping
   * without fetching the entire freeze list. Use this method to validate cached
   * freeze lists by comparing roots.
   *
   * @param programId - The program ID of the freeze list registry (required)
   * @returns The current Merkle root as BigInt
   *
   * @example
   * ```typescript
   * // Validate cache by comparing roots
   * const engine = new PolicyEngine({
   *   endpoint: "http://localhost:3030",
   *   network: "testnet"
   * });
   *
   * const currentRoot = await engine.fetchCurrentRoot("sealance_freezelist_registry.aleo");
   * if (cache.root !== currentRoot) {
   *   // Root changed - re-fetch freeze list
   *   const freezeList = await engine.fetchFreezeListFromChain(programId);
   *   cache = { addresses: freezeList.addresses, root: currentRoot };
   * }
   * ```
   */
  async fetchCurrentRoot(programId: string): Promise<bigint> {
    const rootValue = await this.apiClient.fetchMapping(programId, "freeze_list_root", "1u8");

    if (!rootValue) {
      throw new Error(`Failed to fetch freeze_list_root for program ${programId}`);
    }

    const cleanValue = rootValue.replace(/field$/i, "");
    return BigInt(cleanValue);
  }

  /**
   * Fetches the freeze list from the blockchain
   *
   * This function queries the on-chain mapping to retrieve all frozen addresses.
   * It iterates through indices until it hits a gap or reaches the maximum.
   *
   * @param programId - The program ID of the freeze list registry (required)
   * @returns Object containing the freeze list addresses and metadata
   *
   * @example
   * ```typescript
   * // Using local devnet
   * const engine = new PolicyEngine({
   *   endpoint: "http://localhost:3030",
   *   network: "testnet"
   * });
   * const result = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
   * console.log(result.addresses); // ["aleo1...", "aleo1..."]
   * console.log(result.lastIndex); // 5
   * ```
   */
  async fetchFreezeListFromChain(programId: string): Promise<FreezeListResult> {
    // Fetch last index and current root in parallel - both are mandatory
    const [lastIndexValue, currentRoot] = await Promise.all([
      this.apiClient.fetchMapping(programId, "freeze_list_last_index", "true"),
      this.fetchCurrentRoot(programId),
    ]);

    // Validate last index
    if (!lastIndexValue) {
      throw new Error(`Failed to fetch freeze_list_last_index for program ${programId}`);
    }
    const parsed = parseInt(lastIndexValue.replace("u32", ""), 10);
    if (isNaN(parsed)) {
      throw new Error(`Invalid freeze_list_last_index value: ${lastIndexValue}`);
    }
    const lastIndex = parsed;

    // Fetch addresses from index 0 to lastIndex (inclusive) with controlled parallelization
    // We expect no gaps - if any entry is missing or fails to fetch, the entire operation fails
    const freezeList = await this.fetchAddressesInBatches(programId, lastIndex);

    // Filter out ZERO_ADDRESS (used for padding in Merkle tree)
    const filteredAddresses = freezeList.filter(address => address !== ZERO_ADDRESS);

    return {
      addresses: filteredAddresses,
      lastIndex,
      currentRoot,
    };
  }

  /**
   * Fetches addresses from freeze list mapping in parallel batches
   *
   * Uses controlled concurrency to balance speed and server load.
   * Implements batching strategy where we process `maxConcurrency` requests
   * at a time to avoid overwhelming the server.
   *
   * @param programId - The program ID
   * @param lastIndex - Last index to fetch (inclusive, starting from 0)
   * @returns Array of addresses indexed from 0 to lastIndex
   * @throws Error if any address is missing (gap) or fails to fetch
   *
   * @private
   */
  private async fetchAddressesInBatches(programId: string, lastIndex: number): Promise<string[]> {
    const totalCount = lastIndex + 1; // Indices are 0-based
    const concurrency = this.config.maxConcurrency;
    const results: string[] = new Array(totalCount);

    // Process indices in batches of size `maxConcurrency`
    for (let batchStart = 0; batchStart < totalCount; batchStart += concurrency) {
      const batchEnd = Math.min(batchStart + concurrency, totalCount);

      // Create promises for all indices in current batch
      const batchPromises: Promise<{ index: number; address: string | null }>[] = [];

      for (let i = batchStart; i < batchEnd; i++) {
        const index = i;
        const promise = this.apiClient
          .fetchMapping(programId, "freeze_list_index", `${index}u32`)
          .then(address => ({ index, address }));
        batchPromises.push(promise);
      }

      // Wait for all requests in current batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Validate results and populate the results array
      for (const { index, address } of batchResults) {
        if (!address) {
          throw new Error(
            `Gap detected in freeze list at index ${index} for program ${programId}. ` +
              `Expected continuous entries from 0 to ${lastIndex}.`,
          );
        }
        results[index] = address;
      }
    }

    return results;
  }

  /**
   * Generates a transfer witness (non-inclusion proof) for an address
   *
   * This function generates two Merkle proofs that prove the address is NOT
   * in the freeze list. The proofs consist of the two adjacent leaves that
   * surround the target address in the sorted Merkle tree.
   *
   * @param address - The Aleo address to generate proof for
   * @param options - Options for witness generation
   * @returns Transfer witness containing two Merkle proofs and the root
   *
   * @example
   * ```typescript
   * // Using local devnet
   * const engine = new PolicyEngine({
   *   endpoint: "http://localhost:3030",
   *   network: "testnet"
   * });
   * const witness = await engine.generateFreezeListNonInclusionProof("aleo1...", {
   *   programId: "sealance_freezelist_registry.aleo"
   * });
   *
   * // Use the witness in a transaction
   * const tx = await contract.transfer_private(
   *   recipient,
   *   amount,
   *   inputRecord,
   *   witness.proofs[0],
   *   witness.proofs[1],
   *   investigatorAddress
   * );
   * ```
   */
  async generateFreezeListNonInclusionProof(
    address: string,
    options: NonInclusionProofOptions = {},
  ): Promise<NonInclusionWitness> {
    // Fetch freeze list if not provided
    let freezeList: string[];
    if (options.freezeList) {
      freezeList = options.freezeList;
    } else {
      if (!options.programId) {
        throw new Error("Either freezeList or programId must be provided in options");
      }
      const result = await this.fetchFreezeListFromChain(options.programId);
      freezeList = result.addresses;
    }

    // Generate leaves and build tree
    const leaves = generateLeaves(freezeList, this.config.maxTreeDepth);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1];

    // Get the leaf indices for non-inclusion proof
    const [leftLeafIndex, rightLeafIndex] = getLeafIndices(tree, address);

    // Generate sibling paths
    const leftProof = getSiblingPath(tree, leftLeafIndex, this.config.maxTreeDepth + 1);
    const rightProof = getSiblingPath(tree, rightLeafIndex, this.config.maxTreeDepth + 1);

    const proofs: [MerkleProof, MerkleProof] = [
      {
        siblings: leftProof.siblings,
        leaf_index: leftProof.leaf_index,
      },
      {
        siblings: rightProof.siblings,
        leaf_index: rightProof.leaf_index,
      },
    ];

    return {
      proofs,
      root,
      freezeList,
    };
  }

  /**
   * Utility: Build a Merkle tree from addresses
   *
   * @param addresses - Array of Aleo addresses
   * @returns The complete Merkle tree as array of BigInts
   */
  buildMerkleTree(addresses: string[]): bigint[] {
    const leaves = generateLeaves(addresses, this.config.maxTreeDepth);
    return buildTree(leaves);
  }

  /**
   * Utility: Get the Merkle root from a list of addresses
   *
   * @param addresses - Array of Aleo addresses
   * @returns The Merkle root as BigInt
   */
  getMerkleRoot(addresses: string[]): bigint {
    const tree = this.buildMerkleTree(addresses);
    return tree[tree.length - 1];
  }

  /**
   * Gets the current configuration
   */
  getConfig(): Required<PolicyEngineConfig> {
    return { ...this.config };
  }
}
