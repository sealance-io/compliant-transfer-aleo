import type { PolicyEngineConfig } from "./types.js";
import type { Logger } from "./logger.js";
import { defaultLogger } from "./logger.js";

/**
 * API client for interacting with Aleo node endpoints
 */
export class AleoAPIClient {
  private config: Required<PolicyEngineConfig>;
  private logger: Logger;

  constructor(config: Required<PolicyEngineConfig>) {
    this.config = config;
    this.logger = config.logger ?? defaultLogger;
  }

  /**
   * Fetches a mapping value from an Aleo program
   *
   * @param programId - The program ID (e.g., "sealance_freezelist_registry.aleo")
   * @param mappingName - The mapping name (e.g., "freeze_list_index")
   * @param key - The mapping key (e.g., "0u32")
   * @returns The mapping value or null if not found
   */
  async fetchMapping(programId: string, mappingName: string, key: string): Promise<string | null> {
    const url = `${this.config.endpoint}/${this.config.network}/program/${programId}/mapping/${mappingName}/${key}`;

    return this.fetchWithRetries(url);
  }

  /**
   * Fetches a value from the Aleo node with retry logic and rate limiting
   *
   * Implements best practices:
   * - Exponential backoff with jitter to avoid thundering herd
   * - Specific handling for 429 (Too Many Requests) responses
   * - Respects Retry-After headers from server
   * - Only retries on transient errors (5xx, 429, network errors)
   *
   * @param url - The URL to fetch
   * @returns The response data or null if not found
   * @throws Error if all retries fail or on non-retryable errors (4xx except 429)
   */
  private async fetchWithRetries(url: string): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        if (response.status === 404) {
          return null; // Not found, not an error
        }

        // Handle rate limiting (429) - always retry with backoff
        if (response.status === 429) {
          const retryAfter = this.parseRetryAfter(response);
          const delay = retryAfter ?? this.calculateBackoff(attempt);

          this.logger("debug", "Rate limited, retrying with backoff", {
            status: 429,
            delayMs: delay,
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
          });

          if (attempt < this.config.maxRetries - 1) {
            await this.sleep(delay);
            continue;
          }

          throw new Error(`Rate limited: Too many requests after ${this.config.maxRetries} attempts`);
        }

        // Don't retry on client errors (except 429)
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Retry on server errors (5xx)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const rawText = await response.text();

        // Handle empty responses
        if (!rawText || rawText.trim().length === 0) {
          return null;
        }

        // Aleo API returns JSON-encoded strings, so we need to parse them
        // The response is typically: "value" (with quotes)
        let data = rawText.trim();

        // Try to parse as JSON first (handles quoted strings)
        try {
          const parsed = JSON.parse(data);
          // If successfully parsed, use the parsed value
          data = typeof parsed === "string" ? parsed : String(parsed);
        } catch {
          // If JSON parsing fails, use the raw trimmed data
          // This handles cases where the API returns unquoted values
        }

        // Additional check for null values
        if (data === "null" || data === null) {
          return null;
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry client errors (they're included in the error from response handling above)
        const errorMessage = lastError.message.toLowerCase();
        if (errorMessage.includes("http 4") && !errorMessage.includes("429")) {
          throw lastError;
        }

        // Retry on network errors and 5xx errors with exponential backoff
        if (attempt < this.config.maxRetries - 1) {
          const delay = this.calculateBackoff(attempt);
          this.logger("debug", "Request failed, retrying with exponential backoff", {
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            delayMs: delay,
            error: lastError.message,
          });
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Failed to fetch after ${this.config.maxRetries} attempts: ${lastError?.message}`);
  }

  /**
   * Calculates exponential backoff with jitter
   *
   * Formula: min(baseDelay * 2^attempt, maxDelay) + jitter
   * Jitter is random value between 0 and 25% of the delay
   *
   * @param attempt - Current attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  private calculateBackoff(attempt: number): number {
    const baseDelay = this.config.retryDelay;
    const maxDelay = baseDelay * 10; // Cap at 10x base delay

    // Exponential backoff: 2^attempt * baseDelay
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // Add jitter (0-25% of delay) to avoid thundering herd
    const jitter = exponentialDelay * 0.25 * Math.random();

    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Parses Retry-After header from response
   *
   * Supports both formats:
   * - Retry-After: 120 (delay in seconds)
   * - Retry-After: Wed, 21 Oct 2015 07:28:00 GMT (HTTP date)
   *
   * @param response - Fetch response object
   * @returns Delay in milliseconds, or null if header not present/invalid
   */
  private parseRetryAfter(response: Response): number | null {
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
   * Helper to sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets the configuration
   */
  getConfig(): Required<PolicyEngineConfig> {
    return { ...this.config };
  }
}
