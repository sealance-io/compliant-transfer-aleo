/**
 * Transaction tracking utilities for Aleo blockchain
 * @module transaction-tracker
 */

import type { TransactionStatus, TransactionTrackingOptions } from "./types.js";
import type { Logger } from "./logger.js";
import { defaultLogger } from "./logger.js";
import { calculateBackoff, parseRetryAfter, sleep } from "./fetch-utils.js";

/**
 * Default timeout for individual fetch requests (30 seconds)
 */
const DEFAULT_FETCH_TIMEOUT = 30000;

/**
 * Default base delay for retry backoff (2 seconds)
 */
const DEFAULT_RETRY_DELAY = 2000;

/**
 * Wrapper for fetch with timeout and retry support
 * Handles rate limiting, transient errors, and respects Retry-After headers
 */
async function fetchWithRetries(
  url: string,
  options: {
    timeout?: number;
    maxRetries?: number;
    logger?: Logger;
  } = {},
): Promise<Response> {
  const { timeout = DEFAULT_FETCH_TIMEOUT, maxRetries = 3, logger = defaultLogger } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        // Handle rate limiting (429) - always retry with backoff
        if (response.status === 429) {
          const retryAfter = parseRetryAfter(response);
          const delay = retryAfter ?? calculateBackoff(attempt, DEFAULT_RETRY_DELAY);

          logger("debug", "Rate limited, retrying with backoff", {
            status: 429,
            delayMs: delay,
            attempt: attempt + 1,
            maxRetries,
            url,
          });

          if (attempt < maxRetries - 1) {
            await sleep(delay);
            continue;
          }

          throw new Error(`Rate limited: Too many requests after ${maxRetries} attempts`);
        }

        // Don't retry on client errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 404) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Retry on server errors (5xx)
        if (response.status >= 500) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
          throw new Error(`Request timeout after ${timeout}ms: ${url}`);
        }
        throw error;
      }
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry client errors (4xx except 429 and 404)
      const errorMessage = lastError.message.toLowerCase();
      if (errorMessage.includes("http 4") && !errorMessage.includes("429") && !errorMessage.includes("404")) {
        throw lastError;
      }

      // Retry on network errors and 5xx errors with exponential backoff
      if (attempt < maxRetries - 1) {
        const delay = calculateBackoff(attempt, DEFAULT_RETRY_DELAY);
        logger("debug", "Request failed, retrying with exponential backoff", {
          attempt: attempt + 1,
          maxRetries,
          delayMs: delay,
          error: lastError.message,
          url,
        });
        await sleep(delay);
      }
    }
  }

  throw new Error(`Failed to fetch after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Fetches the block height for a given transaction ID
 * Handles JSON-quoted responses from the API
 */
async function fetchBlockHeight(
  baseUrl: string,
  txId: string,
  options: {
    fetchTimeout?: number;
    logger?: Logger;
  } = {},
): Promise<number | undefined> {
  const { fetchTimeout = DEFAULT_FETCH_TIMEOUT, logger = defaultLogger } = options;

  try {
    // Fetch block hash with retries
    const blockHashResponse = await fetchWithRetries(`${baseUrl}/find/blockHash/${txId}`, {
      timeout: fetchTimeout,
      maxRetries: 3,
      logger,
    });

    if (!blockHashResponse.ok) {
      return undefined;
    }

    const blockHashText = await blockHashResponse.text();
    // Handle JSON-quoted strings (API returns "hash" instead of hash)
    const blockHash = blockHashText.trim().replace(/^"|"$/g, "");

    if (!blockHash || blockHash === "null") {
      return undefined;
    }

    // Fetch block by hash with retries
    const blockResponse = await fetchWithRetries(`${baseUrl}/block/${blockHash}`, {
      timeout: fetchTimeout,
      maxRetries: 3,
      logger,
    });

    if (!blockResponse.ok) {
      return undefined;
    }

    const block = (await blockResponse.json()) as any;
    return block?.header?.metadata?.height as number | undefined;
  } catch (error) {
    logger("warn", "Could not retrieve block height", { error, txId });
    return undefined;
  }
}

/**
 * Tracks the status of an Aleo transaction until it's confirmed or times out
 *
 * This function polls the Aleo network API to monitor transaction status.
 * It handles both successful and failed transactions, including:
 * - Accepted transactions (execute/deploy)
 * - Rejected transactions (fee-only)
 * - Pending transactions (not yet confirmed)
 *
 * @param txId - Transaction ID to track
 * @param endpoint - Aleo network API endpoint (e.g., "http://localhost:3030/testnet" or "https://api.explorer.provable.com/v1/testnet")
 * @param options - Configuration options for tracking behavior
 * @returns Promise that resolves to transaction status
 * @throws Error if transaction tracking times out or fails
 *
 * @example
 * ```typescript
 * import { trackTransactionStatus } from "@sealance-io/policy-engine-aleo";
 *
 * // Track with default settings (5 minutes timeout)
 * const status = await trackTransactionStatus(
 *   txId,
 *   "http://localhost:3030/testnet"
 * );
 *
 * // Track with custom timeout and polling interval
 * const status = await trackTransactionStatus(
 *   txId,
 *   "https://api.explorer.provable.com/v1/testnet",
 *   {
 *     timeout: 600000, // 10 minutes
 *     pollInterval: 10000, // 10 seconds
 *     fetchTimeout: 30000, // 30 seconds per request
 *     maxAttempts: 60
 *   }
 * );
 *
 * // Check status
 * if (status.status === "accepted") {
 *   console.log(`Transaction confirmed in block ${status.blockHeight}`);
 * } else if (status.status === "rejected") {
 *   console.error(`Transaction failed: ${status.error}`);
 * }
 * ```
 */
export async function trackTransactionStatus(
  txId: string,
  endpoint: string,
  options: TransactionTrackingOptions = {},
): Promise<TransactionStatus> {
  const {
    maxAttempts = 60,
    pollInterval = 5000,
    timeout = 300000,
    fetchTimeout = DEFAULT_FETCH_TIMEOUT,
    logger = defaultLogger,
  } = options;

  const baseUrl = endpoint;
  const startTime = Date.now();
  let attempts = 0;

  logger("info", "Starting transaction tracking", {
    txId,
    endpoint,
    maxAttempts,
    pollInterval,
    timeout,
  });

  while (attempts < maxAttempts) {
    attempts++;

    // Check timeout before attempting fetch
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > timeout) {
      const errorMsg =
        `Transaction polling timeout after ${Math.floor(elapsedTime / 1000)}s ` +
        `(limit: ${Math.floor(timeout / 1000)}s, attempts: ${attempts}/${maxAttempts})`;
      logger("error", errorMsg, { txId, attempts, maxAttempts, elapsedTime });
      throw new Error(errorMsg);
    }

    try {
      // Try to get confirmed transaction with retries
      const response = await fetchWithRetries(`${baseUrl}/transaction/confirmed/${txId}`, {
        timeout: fetchTimeout,
        maxRetries: 3,
        logger,
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Transaction not yet confirmed, continue polling
          logger("debug", "Transaction not yet confirmed", {
            attempt: attempts,
            maxAttempts,
            elapsedSeconds: Math.floor(elapsedTime / 1000),
            txId,
          });
          await sleep(pollInterval);
          continue;
        }
        throw new Error(`API error: ${response.status}`);
      }

      const transactionResonse = (await response.json()) as any;
      const txType = transactionResonse?.transaction?.type ?? transactionResonse?.type;

      // Check if transaction was rejected by inspecting type
      if (txType === "fee") {
        logger("warn", "Transaction rejected (fee-only transaction)", { txId, txType });

        // This is a rejected transaction
        // Get the original unconfirmed transaction ID
        let unconfirmedId: string | undefined;

        try {
          const unconfirmedResponse = await fetchWithRetries(`${baseUrl}/transaction/unconfirmed/${txId}`, {
            timeout: fetchTimeout,
            maxRetries: 3,
            logger,
          });

          if (unconfirmedResponse.ok) {
            const unconfirmedData = (await unconfirmedResponse.json()) as any;
            unconfirmedId = unconfirmedData.transaction?.id;
          }
        } catch (error) {
          logger("warn", "Could not retrieve unconfirmed transaction ID", { error, txId });
        }

        // Get block height
        const blockHeight = await fetchBlockHeight(baseUrl, txId, { fetchTimeout, logger });

        logger("info", "Transaction tracking complete (rejected)", {
          txId,
          status: "rejected",
          blockHeight,
          attempts,
        });

        return {
          status: "rejected",
          type: "fee",
          confirmedId: txId,
          unconfirmedId,
          blockHeight,
          error: "Transaction execution failed but fee was consumed",
        };
      } else if (txType === "execute" || txType === "deploy") {
        logger("info", "Transaction accepted", { txId, txType });

        // Transaction was accepted
        const blockHeight = await fetchBlockHeight(baseUrl, txId, { fetchTimeout, logger });

        logger("info", "Transaction tracking complete (accepted)", {
          txId,
          status: "accepted",
          type: txType,
          blockHeight,
          attempts,
        });

        return {
          status: "accepted",
          type: txType,
          confirmedId: txId,
          blockHeight,
        };
      }
    } catch (error: any) {
      // Log the error for debugging
      const errorMessage = error?.message || String(error);
      logger("debug", "Fetch error during transaction tracking", {
        attempt: attempts,
        maxAttempts,
        error: errorMessage,
        txId,
      });

      if (attempts >= maxAttempts) {
        const errorMsg = `Failed after ${maxAttempts} attempts. Last error: ${errorMessage}`;
        logger("error", errorMsg, { txId, attempts, maxAttempts });
        throw new Error(errorMsg);
      }

      // If this is a timeout error, it's likely the endpoint is unresponsive
      if (errorMessage.includes("timeout")) {
        logger("warn", "Endpoint may be unresponsive, will retry", {
          txId,
          attempt: attempts,
          retryDelay: pollInterval / 1000,
        });
      }

      // Continue polling on error, but respect overall timeout
      const timeUntilTimeout = timeout - (Date.now() - startTime);
      const waitTime = Math.min(pollInterval, timeUntilTimeout);

      if (waitTime > 0) {
        await sleep(waitTime);
      }
    }
  }

  // Exhausted max attempts without confirmation
  const elapsedTime = Date.now() - startTime;
  const errorMsg =
    `Transaction status could not be determined after ${attempts} attempts ` +
    `(${Math.floor(elapsedTime / 1000)}s elapsed). Transaction may still be pending.`;

  logger("error", errorMsg, { txId, attempts, maxAttempts, elapsedTime });
  throw new Error(errorMsg);
}
