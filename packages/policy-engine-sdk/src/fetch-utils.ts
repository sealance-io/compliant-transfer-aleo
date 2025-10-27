/**
 * Shared utilities for HTTP fetch operations with retry logic and rate limiting
 * @module fetch-utils
 */

/**
 * Calculates exponential backoff delay with jitter
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay) + jitter
 * Jitter is a random value between 0 and 25% of the delay to avoid thundering herd
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 2000ms)
 * @returns Delay in milliseconds
 *
 * @example
 * ```typescript
 * const delay = calculateBackoff(0); // ~2000ms
 * const delay2 = calculateBackoff(1); // ~4000ms
 * const delay3 = calculateBackoff(2); // ~8000ms
 * const delay4 = calculateBackoff(3, 1000); // ~8000ms (custom baseDelay)
 * ```
 */
export function calculateBackoff(attempt: number, baseDelay: number = 2000): number {
  const maxDelay = baseDelay * 10; // Cap at 10x base delay

  // Exponential backoff: 2^attempt * baseDelay
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

  // Add jitter (0-25% of delay) to avoid thundering herd
  const jitter = exponentialDelay * 0.25 * Math.random();

  return Math.floor(exponentialDelay + jitter);
}

/**
 * Parses Retry-After header from HTTP response
 *
 * Supports both HTTP-date and delay-seconds formats per RFC 7231:
 * - Retry-After: 120 (delay in seconds)
 * - Retry-After: Wed, 21 Oct 2015 07:28:00 GMT (HTTP date)
 *
 * @param response - Fetch Response object
 * @returns Delay in milliseconds, or null if header not present/invalid
 *
 * @example
 * ```typescript
 * const response = await fetch(url);
 * if (response.status === 429) {
 *   const retryDelay = parseRetryAfter(response);
 *   if (retryDelay) {
 *     await sleep(retryDelay);
 *   }
 * }
 * ```
 */
export function parseRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) {
    return null;
  }

  // Try parsing as seconds (numeric format)
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000; // Convert to milliseconds
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delay = date.getTime() - Date.now();
    return Math.max(0, delay); // Ensure non-negative
  }

  return null;
}

/**
 * Helper function to sleep/delay execution for a given duration
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the specified delay
 *
 * @example
 * ```typescript
 * console.log('Starting...');
 * await sleep(2000); // Wait 2 seconds
 * console.log('Done waiting');
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
