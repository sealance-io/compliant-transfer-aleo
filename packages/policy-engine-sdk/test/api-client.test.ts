import { describe, it, expect, vi, beforeEach } from "vitest";
import { AleoAPIClient } from "../src/api-client.js";

describe("AleoAPIClient", () => {
  let client: AleoAPIClient;

  beforeEach(() => {
    client = new AleoAPIClient({
      endpoint: "http://localhost:3030",
      network: "testnet",
      maxRetries: 3,
      retryDelay: 100, // Short delay for tests
    });

    // Clear all mocks
    vi.restoreAllMocks();
  });

  describe("Constructor", () => {
    it("initializes with provided config", () => {
      const config = client.getConfig();
      expect(config.endpoint).toBe("http://localhost:3030");
      expect(config.network).toBe("testnet");
      expect(config.maxRetries).toBe(3);
      expect(config.retryDelay).toBe(100);
    });

    it("applies default values for optional config", () => {
      const defaultClient = new AleoAPIClient({
        endpoint: "http://localhost:3030",
        network: "testnet",
      });

      const config = defaultClient.getConfig();
      expect(config.maxTreeDepth).toBe(15);
      expect(config.maxRetries).toBe(5);
      expect(config.retryDelay).toBe(2000);
    });
  });

  describe("fetchMapping", () => {
    it("constructs correct URL for mapping fetch", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "aleo1test",
      });
      global.fetch = mockFetch;

      await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3030/testnet/program/test.aleo/mapping/mapping_name/0u32",
      );
    });

    it("returns null for 404 responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await client.fetchMapping("test.aleo", "mapping_name", "999u32");

      expect(result).toBeNull();
    });

    it("trims whitespace from response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "  aleo1test  \n",
      });

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("aleo1test");
    });

    it("handles JSON-quoted responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '"aleo1test"', // JSON-quoted string
      });

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("aleo1test"); // Should strip quotes
    });

    it("handles field values with suffix", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '"123456789field"', // JSON-quoted field
      });

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("123456789field");
    });

    it("handles null string response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "null",
      });

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBeNull();
    });

    it("handles empty response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "",
      });

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBeNull();
    });

    it("retries on network errors", async () => {
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "success",
        });

      global.fetch = mockFetch;

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("success");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("throws error after max retries", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(client.fetchMapping("test.aleo", "mapping_name", "0u32")).rejects.toThrow(
        /Failed to fetch after 3 attempts/,
      );
    });

    it("throws error for non-404 HTTP errors", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.fetchMapping("test.aleo", "mapping_name", "0u32")).rejects.toThrow(/HTTP 500/);
    });
  });

  describe("getConfig", () => {
    it("returns a copy of the configuration", () => {
      const config1 = client.getConfig();
      const config2 = client.getConfig();

      // Should return different objects
      expect(config1).not.toBe(config2);

      // But with same values
      expect(config1).toEqual(config2);
    });
  });

  describe("Retry Logic", () => {
    it("waits between retries", async () => {
      const startTime = Date.now();

      global.fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error("Error 1"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "success",
        });

      await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      const elapsed = Date.now() - startTime;

      // Should have waited at least retryDelay (100ms)
      expect(elapsed).toBeGreaterThanOrEqual(100);
    }, 10000);

    it("does not wait on last retry", async () => {
      const maxRetries = 2;
      const clientWithFewRetries = new AleoAPIClient({
        endpoint: "http://localhost:3030",
        network: "testnet",
        maxRetries,
        retryDelay: 1000, // Long delay
      });

      const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
      global.fetch = mockFetch;

      const startTime = Date.now();

      try {
        await clientWithFewRetries.fetchMapping("test.aleo", "mapping_name", "0u32");
      } catch {
        // Expected to fail
      }

      const elapsed = Date.now() - startTime;

      // Should not wait after last retry
      // Total time should be less than maxRetries * retryDelay
      expect(elapsed).toBeLessThan(maxRetries * 1000);
    }, 10000);
  });
});
