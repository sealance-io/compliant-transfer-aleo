import { describe, it, expect, vi, beforeEach } from "vitest";
import { AleoAPIClient } from "../src/api-client.js";
import { silentLogger } from "../src/logger.js";

describe("AleoAPIClient", () => {
  let client: AleoAPIClient;

  beforeEach(() => {
    client = new AleoAPIClient({
      endpoint: "http://localhost:3030",
      network: "testnet",
      maxTreeDepth: 15,
      maxRetries: 3,
      retryDelay: 100, // Short delay for tests
      maxConcurrency: 10,
      logger: silentLogger, // Suppress log noise in tests
    });

    // Clear all mocks
    vi.restoreAllMocks();
  });

  describe("Constructor", () => {
    it("initializes with provided config", () => {
      const config = client.getConfig();
      expect(config.endpoint).toBe("http://localhost:3030");
      expect(config.network).toBe("testnet");
      expect(config.maxTreeDepth).toBe(15);
      expect(config.maxRetries).toBe(3);
      expect(config.retryDelay).toBe(100);
      expect(config.maxConcurrency).toBe(10);
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
        maxTreeDepth: 15,
        maxRetries,
        retryDelay: 1000, // Long delay
        maxConcurrency: 10,
        logger: silentLogger,
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

  describe("Rate Limiting", () => {
    it("handles 429 rate limit with retry", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = ((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout;

      try {
        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: new Headers(),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => '"success"',
          });

        global.fetch = mockFetch;

        const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

        expect(result).toBe("success");
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // Should have used exponential backoff (baseDelay + jitter)
        expect(delays.length).toBe(1);
        expect(delays[0]).toBeGreaterThanOrEqual(100); // baseDelay
        expect(delays[0]).toBeLessThanOrEqual(125); // baseDelay + 25% jitter
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    }, 10000);

    it("respects Retry-After header in seconds format", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to capture the delay value instead of relying on wall-clock time
      global.setTimeout = ((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout;

      try {
        const retryAfterSeconds = 1; // 1 second

        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: new Headers({
              "Retry-After": String(retryAfterSeconds),
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => '"success"',
          });

        global.fetch = mockFetch;

        await client.fetchMapping("test.aleo", "mapping_name", "0u32");

        // Check that the parsed delay matches the Retry-After header
        expect(delays.length).toBe(1);
        expect(delays[0]).toBe(1000); // Should be exactly 1 second (1000ms)
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    }, 10000);

    it("respects Retry-After header in HTTP date format", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to capture the delay value instead of relying on wall-clock time
      global.setTimeout = ((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout;

      try {
        // Use a fixed future timestamp to avoid timing issues
        const retryDelayMs = 5000; // 5 seconds in the future
        const fixedFutureTime = Date.now() + retryDelayMs;
        const futureDate = new Date(fixedFutureTime);

        const mockFetch = vi
          .fn()
          .mockResolvedValueOnce({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
            headers: new Headers({
              "Retry-After": futureDate.toUTCString(),
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => '"success"',
          });

        global.fetch = mockFetch;

        await client.fetchMapping("test.aleo", "mapping_name", "0u32");

        // Check that the parsed delay is approximately correct
        // The delay will be less than 5000ms due to execution time between setting the date and parsing it
        expect(delays.length).toBe(1);
        expect(delays[0]).toBeGreaterThanOrEqual(4000); // Should be ~5000ms, allow up to 1s execution time
        expect(delays[0]).toBeLessThanOrEqual(5000); // Should not exceed the original delay
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    }, 10000);

    it("throws error after max retries on 429", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers(),
      });

      global.fetch = mockFetch;

      await expect(client.fetchMapping("test.aleo", "mapping_name", "0u32")).rejects.toThrow(
        /Rate limited: Too many requests after 3 attempts/,
      );

      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 10000);

    it("does not retry on 400 client error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      global.fetch = mockFetch;

      await expect(client.fetchMapping("test.aleo", "mapping_name", "0u32")).rejects.toThrow(/HTTP 400/);

      // Should not retry - only called once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 401 client error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      global.fetch = mockFetch;

      await expect(client.fetchMapping("test.aleo", "mapping_name", "0u32")).rejects.toThrow(/HTTP 401/);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 403 client error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      global.fetch = mockFetch;

      await expect(client.fetchMapping("test.aleo", "mapping_name", "0u32")).rejects.toThrow(/HTTP 403/);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries on 500 server error", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"success"',
        });

      global.fetch = mockFetch;

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("success");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it("retries on 502 server error", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"success"',
        });

      global.fetch = mockFetch;

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("success");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it("retries on 503 server error", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => '"success"',
        });

      global.fetch = mockFetch;

      const result = await client.fetchMapping("test.aleo", "mapping_name", "0u32");

      expect(result).toBe("success");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it("uses exponential backoff on retries", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to capture delay durations
      global.setTimeout = ((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout;

      try {
        const mockFetch = vi
          .fn()
          .mockRejectedValueOnce(new Error("Network error"))
          .mockRejectedValueOnce(new Error("Network error"))
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => '"success"',
          });

        global.fetch = mockFetch;

        await client.fetchMapping("test.aleo", "mapping_name", "0u32");

        // Should have 2 delays (for 2 retries)
        expect(delays.length).toBe(2);

        // Second delay should be greater than first (exponential backoff)
        expect(delays[1]).toBeGreaterThan(delays[0]);

        // Verify exponential growth (allowing for jitter)
        // First delay: baseDelay (100ms) + jitter (0-25ms)
        expect(delays[0]).toBeGreaterThanOrEqual(100);
        expect(delays[0]).toBeLessThanOrEqual(125);

        // Second delay: baseDelay * 2 (200ms) + jitter (0-50ms)
        expect(delays[1]).toBeGreaterThanOrEqual(200);
        expect(delays[1]).toBeLessThanOrEqual(250);
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    }, 10000);

    it("caps exponential backoff at max delay", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = ((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout;

      try {
        // Use a client with many retries to test the cap
        const clientWithManyRetries = new AleoAPIClient({
          endpoint: "http://localhost:3030",
          network: "testnet",
          maxTreeDepth: 15,
          maxRetries: 10,
          retryDelay: 100,
          maxConcurrency: 10,
          logger: silentLogger,
        });

        const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
        global.fetch = mockFetch;

        try {
          await clientWithManyRetries.fetchMapping("test.aleo", "mapping_name", "0u32");
        } catch {
          // Expected to fail
        }

        // All delays should be <= maxDelay (retryDelay * 10 + 25% jitter)
        const maxAllowedDelay = 100 * 10 * 1.25; // 1250ms
        delays.forEach(delay => {
          expect(delay).toBeLessThanOrEqual(maxAllowedDelay);
        });

        // Later delays should be capped at maxDelay
        const laterDelays = delays.slice(5); // Check delays after 5 retries
        laterDelays.forEach(delay => {
          // Should be at or near the cap
          expect(delay).toBeGreaterThanOrEqual(1000); // maxDelay = 1000ms
          expect(delay).toBeLessThanOrEqual(1250); // maxDelay + jitter
        });
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    }, 30000);

    it("applies jitter to prevent thundering herd", async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = ((callback: () => void, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(callback, delay);
      }) as typeof setTimeout;

      try {
        // Run multiple trials to ensure jitter is applied (it's random)
        const trials = 5;
        let hasJitter = false;

        for (let i = 0; i < trials; i++) {
          const mockFetch = vi
            .fn()
            .mockRejectedValueOnce(new Error("Network error"))
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              text: async () => '"success"',
            });

          global.fetch = mockFetch;

          await client.fetchMapping("test.aleo", "mapping_name", "0u32");

          // Check if this trial has jitter (delay != exactly baseDelay)
          const baseDelay = 100;
          const trialDelay = delays[delays.length - 1];

          if (trialDelay !== baseDelay) {
            hasJitter = true;
            break;
          }
        }

        // At least one trial should have jitter (very high probability with 5 trials)
        expect(hasJitter).toBe(true);

        // All delays should be within jitter range (0-25% of exponential delay)
        const baseDelay = 100;
        delays.forEach(delay => {
          expect(delay).toBeGreaterThanOrEqual(baseDelay);
          expect(delay).toBeLessThanOrEqual(baseDelay * 1.25);
        });
      } finally {
        global.setTimeout = originalSetTimeout;
      }
    }, 10000);
  });
});
