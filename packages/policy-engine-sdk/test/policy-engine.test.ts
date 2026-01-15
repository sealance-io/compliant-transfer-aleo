import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolicyEngine } from "../src/policy-engine.js";
import { ZERO_ADDRESS } from "../src/constants.js";
import { silentLogger } from "../src/logger.js";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine({
      endpoint: "http://localhost:3030",
      network: "testnet",
      maxTreeDepth: 15,
      maxRetries: 3,
      retryDelay: 100,
      maxConcurrency: 1, // Use serialized processing for predictable test mocking
      logger: silentLogger, // Suppress log noise in tests
    });

    vi.resetAllMocks();
  });

  describe("Constructor", () => {
    it("initializes with provided config", () => {
      const config = engine.getConfig();
      expect(config.endpoint).toBe("http://localhost:3030");
      expect(config.network).toBe("testnet");
      expect(config.maxTreeDepth).toBe(15);
    });

    it("applies default values", () => {
      const defaultEngine = new PolicyEngine();

      const config = defaultEngine.getConfig();
      expect(config.endpoint).toBe("https://api.explorer.provable.com/v1");
      expect(config.network).toBe("mainnet");
      expect(config.maxTreeDepth).toBe(15);
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelay).toBe(2000);
      expect(config.maxConcurrency).toBe(10);
    });
  });

  describe("buildMerkleTree", () => {
    it("builds a tree from addresses", () => {
      const addresses = [
        "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
        "aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g",
      ];

      const tree = engine.buildMerkleTree(addresses);

      expect(tree.length).toBeGreaterThan(0);
      expect(typeof tree[0]).toBe("bigint");
    });

    it("handles empty address list", () => {
      const tree = engine.buildMerkleTree([]);

      // Should still build a tree (with padding)
      expect(tree.length).toBeGreaterThan(0);
    });
  });

  describe("getMerkleRoot", () => {
    it("computes the Merkle root", () => {
      const addresses = [
        "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
        "aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g",
      ];

      const root = engine.getMerkleRoot(addresses);

      expect(typeof root).toBe("bigint");
      expect(root).toBeGreaterThan(0n);
    });

    it("produces consistent roots for same inputs", () => {
      const addresses = [
        "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
        "aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g",
      ];

      const root1 = engine.getMerkleRoot(addresses);
      const root2 = engine.getMerkleRoot(addresses);

      expect(root1).toBe(root2);
    });

    it("produces different roots for different inputs", () => {
      const addresses1 = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];
      const addresses2 = ["aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g"];

      const root1 = engine.getMerkleRoot(addresses1);
      const root2 = engine.getMerkleRoot(addresses2);

      expect(root1).not.toBe(root2);
    });
  });

  describe("fetchCurrentRoot", () => {
    it("fetches only the root from chain", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '"123456789field"',
      });

      global.fetch = mockFetch;

      const root = await engine.fetchCurrentRoot("test.aleo");

      expect(root).toBe(123456789n);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("strips field suffix correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '"999field"',
      });

      global.fetch = mockFetch;

      const root = await engine.fetchCurrentRoot("test.aleo");

      expect(root).toBe(999n);
    });

    it("handles uppercase FIELD suffix", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '"777FIELD"',
      });

      global.fetch = mockFetch;

      const root = await engine.fetchCurrentRoot("test.aleo");

      expect(root).toBe(777n);
    });

    it("throws error when root cannot be fetched", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

      global.fetch = mockFetch;

      await expect(engine.fetchCurrentRoot("test.aleo")).rejects.toThrow(
        "Failed to fetch after 3 attempts: Network error",
      );
    });

    it("throws error when root returns null", async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "null",
      });

      global.fetch = mockFetch;

      await expect(engine.fetchCurrentRoot("test.aleo")).rejects.toThrow(
        "Failed to fetch freeze_list_root for program test.aleo",
      );
    });
  });

  describe("fetchFreezeListFromChain", () => {
    it("fetches freeze list from chain", async () => {
      const mockFetch = vi
        .fn()
        // First: fetch freeze_list_last_index and freeze_list_root in parallel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"1u32"', // lastIndex = 1
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123456789field"', // currentRoot
        })
        // Then: fetch addresses from index 0 to lastIndex (inclusive)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g"',
        });

      global.fetch = mockFetch;

      const result = await engine.fetchFreezeListFromChain("test.aleo");

      expect(result.addresses.length).toBe(2);
      expect(result.addresses[0]).toBe("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
      expect(result.lastIndex).toBe(1);
      expect(result.currentRoot).toBe(123456789n);
    });

    it("throws error when freeze_list_last_index cannot be fetched", async () => {
      const mockFetch = vi
        .fn()
        // All fetches fail (simpler test - both lastIndex and root fail)
        .mockRejectedValue(new Error("Not found"));

      global.fetch = mockFetch;

      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        "Failed to fetch after 3 attempts: Not found",
      );
    });

    it("throws error when freeze_list_last_index returns null", async () => {
      const mockFetch = vi
        .fn()
        // Parallel fetches: lastIndex returns null, root succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "null",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"',
        });

      global.fetch = mockFetch;

      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        "Failed to fetch freeze_list_last_index for program test.aleo",
      );
    });

    it("throws error when freeze_list_last_index returns invalid value", async () => {
      const mockFetch = vi
        .fn()
        // Parallel fetches: lastIndex returns invalid, root succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"invalid"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"',
        });

      global.fetch = mockFetch;

      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        "Invalid freeze_list_last_index value: invalid",
      );
    });

    it("throws error when freeze_list_root cannot be fetched", async () => {
      const mockFetch = vi
        .fn()
        // All fetches fail (simpler test - both lastIndex and root fail)
        .mockRejectedValue(new Error("Root not found"));

      global.fetch = mockFetch;

      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        "Failed to fetch after 3 attempts: Root not found",
      );
    });

    it("throws error when freeze_list_root returns null", async () => {
      const mockFetch = vi
        .fn()
        // Parallel fetches: lastIndex succeeds, root returns null
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"1u32"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "null",
        });

      global.fetch = mockFetch;

      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        "Failed to fetch freeze_list_root for program test.aleo",
      );
    });

    it("throws error on gap in address list", async () => {
      const mockFetch = vi
        .fn()
        // First: fetch freeze_list_last_index and freeze_list_root in parallel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"2u32"', // lastIndex = 2
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"', // currentRoot
        })
        // Then: fetch addresses from index 0 to 2 (serialized with maxConcurrency=1)
        // Index 0 succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        // Index 1 returns null (gap in the list)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "null",
        });

      global.fetch = mockFetch;

      // Should throw error when gap is detected at index 1
      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        /Gap detected in freeze list at index 1 for program test\.aleo/,
      );
    });

    it("throws error on network failure when fetching address", async () => {
      const mockFetch = vi
        .fn()
        // First: fetch freeze_list_last_index and freeze_list_root in parallel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"2u32"', // lastIndex = 2
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"', // currentRoot
        })
        // Then: fetch addresses from index 0 to 2 (serialized with maxConcurrency=1)
        // Index 0 succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        // Index 1 fails with network error (will trigger retries)
        .mockRejectedValue(new Error("Network error"));

      global.fetch = mockFetch;

      // Should throw error when network error occurs at index 1
      await expect(engine.fetchFreezeListFromChain("test.aleo")).rejects.toThrow(
        /Failed to fetch after 3 attempts: Network error/,
      );
    });

    it("filters out ZERO_ADDRESS from results", async () => {
      const mockFetch = vi
        .fn()
        // First: fetch freeze_list_last_index and freeze_list_root in parallel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"2u32"', // lastIndex = 2
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"', // currentRoot
        })
        // Then: fetch addresses from index 0 to 2 (serialized)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => `"${ZERO_ADDRESS}"`, // ZERO_ADDRESS in freeze list
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g"',
        });

      global.fetch = mockFetch;

      const result = await engine.fetchFreezeListFromChain("test.aleo");

      // Should only have 2 addresses (ZERO_ADDRESS filtered out)
      expect(result.addresses.length).toBe(2);
      expect(result.addresses).not.toContain(ZERO_ADDRESS);
      expect(result.addresses[0]).toBe("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
      expect(result.addresses[1]).toBe("aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g");
      expect(result.currentRoot).toBe(123n);
    });

    it("fetches addresses in parallel with maxConcurrency > 1", async () => {
      // Create engine with higher concurrency for this specific test
      const parallelEngine = new PolicyEngine({
        endpoint: "http://localhost:3030",
        network: "testnet",
        maxTreeDepth: 15,
        maxRetries: 3,
        retryDelay: 100,
        maxConcurrency: 3, // Fetch 3 at a time
        logger: silentLogger, // Suppress log noise in tests
      });

      const mockFetch = vi
        .fn()
        // First: fetch freeze_list_last_index and freeze_list_root in parallel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"4u32"', // lastIndex = 4 (5 total addresses)
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"', // currentRoot
        })
        // Then: fetch addresses from index 0 to 4
        // Batch 1: indices 0, 1, 2 (parallel, order doesn't matter in mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t"',
        })
        // Batch 2: indices 3, 4 (parallel)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1ashyu96tjwe63u0gtnnv8z5lhapdu4l5pjsl2kha7fv7hvz2eqxs5dz0rg"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1ht2a9q0gsd38j0se4t9lsfulxgqrens2vgzgry3pkvs93xrrzu8s892zn7"',
        });

      global.fetch = mockFetch;

      const result = await parallelEngine.fetchFreezeListFromChain("test.aleo");

      // Should have 5 addresses
      expect(result.addresses.length).toBe(5);
      expect(result.lastIndex).toBe(4);
      expect(result.currentRoot).toBe(123n);

      // Verify all fetches were made (2 metadata + 5 addresses = 7 total)
      expect(mockFetch).toHaveBeenCalledTimes(7);
    });
  });

  describe("generateFreezeListNonInclusionProof", () => {
    it("generates proof with provided freeze list", async () => {
      const freezeList = [
        "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
        "aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g",
      ];

      const testAddress = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

      const witness = await engine.generateFreezeListNonInclusionProof(testAddress, {
        freezeList,
      });

      expect(witness.proofs.length).toBe(2);
      expect(witness.proofs[0].siblings.length).toBe(16);
      expect(witness.proofs[1].siblings.length).toBe(16);
      expect(typeof witness.root).toBe("bigint");
      expect(witness.freezeList).toEqual(freezeList);
    });

    it("fetches freeze list if not provided", async () => {
      // Mock fetch for freeze list
      const mockFetch = vi
        .fn()
        // First: fetch freeze_list_last_index and freeze_list_root in parallel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"1u32"', // lastIndex = 1
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"', // currentRoot
        })
        // Then: fetch addresses from index 0 to 1
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g"',
        });

      global.fetch = mockFetch;

      const testAddress = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

      const witness = await engine.generateFreezeListNonInclusionProof(testAddress, {
        programId: "test.aleo",
      });

      expect(witness.proofs.length).toBe(2);
      expect(witness.freezeList.length).toBeGreaterThan(0);
    });

    it("returns valid MerkleProof structure", async () => {
      const freezeList = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];

      const witness = await engine.generateFreezeListNonInclusionProof(
        "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc",
        {
          freezeList,
        },
      );

      // Check proof structure
      witness.proofs.forEach(proof => {
        expect(proof).toHaveProperty("siblings");
        expect(proof).toHaveProperty("leaf_index");
        expect(Array.isArray(proof.siblings)).toBe(true);
        expect(typeof proof.leaf_index).toBe("number");
      });
    });

    it("throws error when neither freezeList nor programId is provided", async () => {
      const testAddress = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

      await expect(engine.generateFreezeListNonInclusionProof(testAddress, {})).rejects.toThrow(
        "Either freezeList or programId must be provided in options",
      );
    });
  });

  describe("getConfig", () => {
    it("returns a copy of configuration", () => {
      const config1 = engine.getConfig();
      const config2 = engine.getConfig();

      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});
