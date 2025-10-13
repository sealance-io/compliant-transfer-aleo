import { describe, it, expect, vi, beforeEach } from "vitest";
import { PolicyEngine } from "../src/policy-engine.js";
import { ZERO_ADDRESS } from "../src/merkle-tree.js";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine({
      endpoint: "http://localhost:3030",
      network: "testnet",
      maxTreeDepth: 15,
      leavesLength: 16384,
      maxRetries: 3,
      retryDelay: 100,
    });

    vi.restoreAllMocks();
  });

  describe("Constructor", () => {
    it("initializes with provided config", () => {
      const config = engine.getConfig();
      expect(config.endpoint).toBe("http://localhost:3030");
      expect(config.network).toBe("testnet");
      expect(config.maxTreeDepth).toBe(15);
      expect(config.leavesLength).toBe(16384);
    });

    it("applies default values", () => {
      const defaultEngine = new PolicyEngine({
        endpoint: "http://localhost:3030",
        network: "testnet",
      });

      const config = defaultEngine.getConfig();
      expect(config.maxTreeDepth).toBe(15);
      expect(config.leavesLength).toBe(16384);
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelay).toBe(2000);
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

  describe("fetchFreezeListFromChain", () => {
    it("fetches freeze list from chain", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"', // JSON-quoted
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g"', // JSON-quoted
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"1u32"', // JSON-quoted
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123456789field"', // JSON-quoted
        });

      global.fetch = mockFetch;

      const result = await engine.fetchFreezeListFromChain("test.aleo");

      expect(result.addresses.length).toBe(2);
      expect(result.addresses[0]).toBe("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
      expect(result.lastIndex).toBe(1);
      expect(result.currentRoot).toBe(123456789n);
    });

    it("stops at first gap in freeze list", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockRejectedValueOnce(new Error("Network error"));

      global.fetch = mockFetch;

      const result = await engine.fetchFreezeListFromChain("test.aleo");

      expect(result.addresses.length).toBe(1);
    });

    it("handles null response in freeze list", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "null", // API returns null
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      global.fetch = mockFetch;

      const result = await engine.fetchFreezeListFromChain("test.aleo");

      // Should stop at null response
      expect(result.addresses.length).toBe(1);
    });

    it("filters out ZERO_ADDRESS from results", async () => {
      const mockFetch = vi
        .fn()
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
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"2u32"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"',
        });

      global.fetch = mockFetch;

      const result = await engine.fetchFreezeListFromChain("test.aleo");

      // Should only have 2 addresses (ZERO_ADDRESS filtered out)
      expect(result.addresses.length).toBe(2);
      expect(result.addresses).not.toContain(ZERO_ADDRESS);
      expect(result.addresses[0]).toBe("aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px");
      expect(result.addresses[1]).toBe("aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g");
    });
  });

  describe("generateNonInclusionProof", () => {
    it("generates proof with provided freeze list", async () => {
      const freezeList = [
        "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
        "aleo1vdtmskehryujt4347hn5990fl9a9v9psezp7eqfmd7a66mjaeugq0m5w0g",
      ];

      const testAddress = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

      const witness = await engine.generateNonInclusionProof(testAddress, {
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
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"0u32"',
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"123field"',
        });

      global.fetch = mockFetch;

      const testAddress = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

      const witness = await engine.generateNonInclusionProof(testAddress, {
        programId: "test.aleo",
      });

      expect(witness.proofs.length).toBe(2);
      expect(witness.freezeList.length).toBeGreaterThan(0);
    });

    it("returns valid MerkleProof structure", async () => {
      const freezeList = ["aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px"];

      const witness = await engine.generateNonInclusionProof(
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

      await expect(engine.generateNonInclusionProof(testAddress, {})).rejects.toThrow(
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
