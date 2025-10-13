import type { PolicyEngineConfig } from "./types.js";

/**
 * API client for interacting with Aleo node endpoints
 */
export class AleoAPIClient {
  private config: Required<PolicyEngineConfig>;

  constructor(config: PolicyEngineConfig) {
    this.config = {
      endpoint: config.endpoint,
      network: config.network,
      maxTreeDepth: config.maxTreeDepth ?? 15,
      maxRetries: config.maxRetries ?? 5,
      retryDelay: config.retryDelay ?? 2000,
    };
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
   * Fetches a value from the Aleo node with retry logic
   *
   * @param url - The URL to fetch
   * @returns The response data or null if not found
   * @throws Error if all retries fail
   */
  private async fetchWithRetries(url: string): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(url);

        if (response.status === 404) {
          return null; // Not found, not an error
        }

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

        // Don't retry if this is the last attempt
        if (attempt < this.config.maxRetries - 1) {
          await this.sleep(this.config.retryDelay);
        }
      }
    }

    throw new Error(`Failed to fetch after ${this.config.maxRetries} attempts: ${lastError?.message}`);
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
