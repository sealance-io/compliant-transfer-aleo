import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateBackoff, parseRetryAfter, sleep } from "../src/fetch-utils.js";

describe("fetch-utils", () => {
  describe("calculateBackoff", () => {
    it("calculates exponential backoff for attempt 0", () => {
      const delay = calculateBackoff(0);
      // First attempt: baseDelay (2000) * 2^0 = 2000, plus jitter (0-25%)
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(2500);
    });

    it("calculates exponential backoff for attempt 1", () => {
      const delay = calculateBackoff(1);
      // Second attempt: baseDelay (2000) * 2^1 = 4000, plus jitter (0-25%)
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it("calculates exponential backoff for attempt 2", () => {
      const delay = calculateBackoff(2);
      // Third attempt: baseDelay (2000) * 2^2 = 8000, plus jitter (0-25%)
      expect(delay).toBeGreaterThanOrEqual(8000);
      expect(delay).toBeLessThanOrEqual(10000);
    });

    it("respects max delay cap (10x base delay)", () => {
      const delay = calculateBackoff(10); // Very high attempt number
      // Should cap at baseDelay * 10 = 20000, plus jitter (0-25%)
      expect(delay).toBeGreaterThanOrEqual(20000);
      expect(delay).toBeLessThanOrEqual(25000);
    });

    it("supports custom base delay", () => {
      const customBaseDelay = 1000;
      const delay = calculateBackoff(0, customBaseDelay);
      // First attempt with custom base: 1000 * 2^0 = 1000, plus jitter (0-25%)
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1250);
    });

    it("returns integer values", () => {
      const delay = calculateBackoff(1);
      expect(Number.isInteger(delay)).toBe(true);
    });

    it("includes jitter to prevent thundering herd", () => {
      // Mock Math.random to verify jitter is applied
      const originalRandom = Math.random;
      Math.random = vi.fn(() => 0.5); // 50% jitter

      try {
        const delay = calculateBackoff(0); // 2000 base
        // Expected: 2000 + (2000 * 0.25 * 0.5) = 2000 + 250 = 2250
        expect(delay).toBe(2250);
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe("parseRetryAfter", () => {
    it("returns null when Retry-After header is not present", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers(),
      });

      const result = parseRetryAfter(response);
      expect(result).toBeNull();
    });

    it("parses Retry-After header in seconds format", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers({
          "Retry-After": "120",
        }),
      });

      const result = parseRetryAfter(response);
      expect(result).toBe(120000); // 120 seconds = 120000 milliseconds
    });

    it("parses Retry-After header with small delay", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers({
          "Retry-After": "5",
        }),
      });

      const result = parseRetryAfter(response);
      expect(result).toBe(5000); // 5 seconds = 5000 milliseconds
    });

    it("parses Retry-After header in HTTP date format", () => {
      // Mock Date.now() for deterministic testing
      const originalDateNow = Date.now;
      const fixedNow = 1000000000000; // Fixed timestamp
      Date.now = vi.fn(() => fixedNow);

      try {
        // Create a date 10 seconds in the future from fixed timestamp
        const futureDate = new Date(fixedNow + 10000);

        const response = new Response(null, {
          status: 429,
          headers: new Headers({
            "Retry-After": futureDate.toUTCString(),
          }),
        });

        const result = parseRetryAfter(response);
        expect(result).toBe(10000); // Should be exactly 10000ms
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("ensures non-negative delay for dates in the past", () => {
      // Mock Date.now() for deterministic testing
      const originalDateNow = Date.now;
      const fixedNow = 1000000000000; // Fixed timestamp
      Date.now = vi.fn(() => fixedNow);

      try {
        // Create a date in the past
        const pastDate = new Date(fixedNow - 5000);

        const response = new Response(null, {
          status: 429,
          headers: new Headers({
            "Retry-After": pastDate.toUTCString(),
          }),
        });

        const result = parseRetryAfter(response);
        expect(result).toBe(0); // Math.max(0, negative) = 0
      } finally {
        Date.now = originalDateNow;
      }
    });

    it("returns null for invalid Retry-After header (not a number or date)", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers({
          "Retry-After": "invalid-value",
        }),
      });

      const result = parseRetryAfter(response);
      expect(result).toBeNull();
    });

    it("returns null for empty Retry-After header", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers({
          "Retry-After": "",
        }),
      });

      const result = parseRetryAfter(response);
      expect(result).toBeNull();
    });

    it("returns null for gibberish Retry-After header", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers({
          "Retry-After": "abc123xyz",
        }),
      });

      const result = parseRetryAfter(response);
      expect(result).toBeNull();
    });

    it("parses zero as valid seconds value", () => {
      const response = new Response(null, {
        status: 429,
        headers: new Headers({
          "Retry-After": "0",
        }),
      });

      const result = parseRetryAfter(response);
      expect(result).toBe(0);
    });
  });

  describe("sleep", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.resetAllMocks();
    });

    it("resolves after specified delay", async () => {
      const promise = sleep(1000);

      // Should not resolve immediately
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      // Advance timers by 999ms - should not resolve yet
      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);

      // Advance by 1 more ms - should resolve now
      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(resolved).toBe(true);
    });

    it("resolves immediately for zero delay", async () => {
      const promise = sleep(0);

      await vi.advanceTimersByTimeAsync(0);
      await promise;
      // Should complete without error
    });

    it("supports multiple concurrent sleep calls", async () => {
      const resolved: number[] = [];

      const promise1 = sleep(1000).then(() => resolved.push(1));
      const promise2 = sleep(2000).then(() => resolved.push(2));
      const promise3 = sleep(500).then(() => resolved.push(3));

      // After 500ms, only promise3 should resolve
      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).toEqual([3]);

      // After 1000ms total, promise1 should also resolve
      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).toEqual([3, 1]);

      // After 2000ms total, all should be resolved
      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([promise1, promise2, promise3]);
      expect(resolved).toEqual([3, 1, 2]);
    });
  });
});
