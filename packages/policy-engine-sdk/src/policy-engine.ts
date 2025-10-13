import type {
  PolicyEngineConfig,
  FreezeListResult,
  TransferWitnessOptions,
  TransferWitness,
  MerkleProof,
} from "./types.js";
import { AleoAPIClient } from "./api-client.js";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath, ZERO_ADDRESS } from "./merkle-tree.js";

/**
 * Main SDK class for generating Merkle proofs and interacting with Aleo compliance policies
 *
 * @example
 * ```typescript
 * const engine = new PolicyEngine({
 *   endpoint: "http://localhost:3030",
 *   network: "testnet"
 * });
 *
 * // Fetch freeze list from chain
 * const freezeList = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
 *
 * // Generate non-inclusion proof for an address
 * const witness = await engine.generateNonInclusionProof("aleo1...", {
 *   programId: "sealance_freezelist_registry.aleo"
 * });
 * ```
 */
export class PolicyEngine {
  private apiClient: AleoAPIClient;
  private config: Required<PolicyEngineConfig>;

  constructor(config: PolicyEngineConfig) {
    this.config = {
      endpoint: config.endpoint,
      network: config.network,
      maxTreeDepth: config.maxTreeDepth ?? 15,
      leavesLength: config.leavesLength ?? 2 ** 14,
      maxRetries: config.maxRetries ?? 5,
      retryDelay: config.retryDelay ?? 2000,
    };
    this.apiClient = new AleoAPIClient(this.config);
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
   * const result = await engine.fetchFreezeListFromChain("sealance_freezelist_registry.aleo");
   * console.log(result.addresses); // ["aleo1...", "aleo1..."]
   * console.log(result.lastIndex); // 5
   * ```
   */
  async fetchFreezeListFromChain(programId: string): Promise<FreezeListResult> {
    const freezeList: string[] = [];
    const maxAttempts = this.config.leavesLength;

    // Fetch addresses until we hit a gap or reach the maximum
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const frozenAccount = await this.apiClient.fetchMapping(programId, "freeze_list_index", `${i}u32`);

        if (!frozenAccount) {
          // No more entries in the mapping
          break;
        }

        freezeList[i] = frozenAccount;
      } catch (error) {
        // Break on error - the mapping might have gaps
        console.debug(`No entry at index ${i}`, error);
        break;
      }
    }

    // Try to fetch the last index from the mapping
    let lastIndex = freezeList.length > 0 ? freezeList.length - 1 : 0;
    try {
      const lastIndexValue = await this.apiClient.fetchMapping(programId, "freeze_list_last_index", "true");
      if (lastIndexValue) {
        const parsed = parseInt(lastIndexValue.replace("u32", ""), 10);
        if (!isNaN(parsed)) {
          lastIndex = parsed;
        }
      }
    } catch (error) {
      console.debug("Could not fetch freeze_list_last_index", error);
    }

    // Try to fetch the current root
    let currentRoot: bigint | undefined;
    try {
      const rootValue = await this.apiClient.fetchMapping(programId, "freeze_list_root", "1u8");
      if (rootValue) {
        // Remove "field" suffix if present
        const cleanValue = rootValue.replace(/field$/i, "");
        currentRoot = BigInt(cleanValue);
      }
    } catch (error) {
      console.debug("Could not fetch current root", error);
    }

    // Filter out ZERO_ADDRESS (used for padding in Merkle tree)
    const filteredAddresses = freezeList.filter(address => address !== ZERO_ADDRESS);

    return {
      addresses: filteredAddresses,
      lastIndex,
      currentRoot,
    };
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
   * const witness = await engine.generateNonInclusionProof("aleo1...", {
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
  async generateNonInclusionProof(address: string, options: TransferWitnessOptions = {}): Promise<TransferWitness> {
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
