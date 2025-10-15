interface TransactionStatus {
  status: 'accepted' | 'rejected' | 'aborted' | 'pending';
  type: 'execute' | 'deploy' | 'fee';
  confirmedId: string;
  unconfirmedId?: string;
  blockHeight?: number;
  error?: string;
}

/**
 * Default timeout for individual fetch requests (30 seconds)
 */
const DEFAULT_FETCH_TIMEOUT = 30000;

/**
 * Wrapper for fetch with timeout support
 * @param url - URL to fetch
 * @param timeout - Timeout in milliseconds (default: 30 seconds)
 * @returns Promise that resolves to Response or rejects on timeout
 */
async function fetchWithTimeout(url: string, timeout: number = DEFAULT_FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms: ${url}`);
    }
    throw error;
  }
}

/**
 * Fetches the block height for a given transaction ID
 * Handles JSON-quoted responses from the API
 */
async function fetchBlockHeight(baseUrl: string, txId: string, fetchTimeout: number = DEFAULT_FETCH_TIMEOUT): Promise<number | undefined> {
  try {
    // Fetch block hash with timeout
    const blockHashResponse = await fetchWithTimeout(`${baseUrl}/find/blockHash/${txId}`, fetchTimeout);
    if (!blockHashResponse.ok) {
      return undefined;
    }

    const blockHashText = await blockHashResponse.text();
    // Handle JSON-quoted strings (API returns "hash" instead of hash)
    const blockHash = blockHashText.trim().replace(/^"|"$/g, '');

    if (!blockHash || blockHash === 'null') {
      return undefined;
    }

    // Fetch block by hash with timeout
    const blockResponse = await fetchWithTimeout(`${baseUrl}/block/${blockHash}`, fetchTimeout);
    if (!blockResponse.ok) {
      return undefined;
    }

    const block = await blockResponse.json();
    return block?.header?.metadata?.height;
  } catch (error) {
    console.warn('Could not retrieve block height:', error);
    return undefined;
  }
}

export async function trackTransactionStatus(
  txId: string,
  endpoint: string,
  options: {
    maxAttempts?: number;
    pollInterval?: number;
    timeout?: number;
    fetchTimeout?: number;
    network?: string;
  } = {}
): Promise<TransactionStatus> {
  const {
    maxAttempts = 60,
    pollInterval = 5000,
    timeout = 300000,
    fetchTimeout = DEFAULT_FETCH_TIMEOUT  } = options;

  const baseUrl = endpoint;
  const startTime = Date.now();
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    // Check timeout before attempting fetch
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > timeout) {
      throw new Error(
        `Transaction polling timeout after ${Math.floor(elapsedTime / 1000)}s ` +
        `(limit: ${Math.floor(timeout / 1000)}s, attempts: ${attempts}/${maxAttempts})`
      );
    }

    try {
      // Try to get confirmed transaction with timeout
      const response = await fetchWithTimeout(`${baseUrl}/transaction/confirmed/${txId}`, fetchTimeout);

      if (!response.ok) {
        if (response.status === 404) {
          // Transaction not yet confirmed, continue polling
          console.log(`Attempt ${attempts}/${maxAttempts}: Transaction not yet confirmed (${Math.floor((Date.now() - startTime) / 1000)}s elapsed)`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        throw new Error(`API error: ${response.status}`);
      }

      const transactionResonse = await response.json();
      const txType = transactionResonse?.transaction?.type ?? transactionResonse?.type;

      // Check if transaction was rejected by inspecting type
      if (txType === 'fee') {
        // This is a rejected transaction
        // Get the original unconfirmed transaction ID
        let unconfirmedId: string | undefined;

        try {
          const unconfirmedResponse = await fetchWithTimeout(
            `${baseUrl}/transaction/unconfirmed/${txId}`,
            fetchTimeout
          );

          if (unconfirmedResponse.ok) {
            const unconfirmedData = await unconfirmedResponse.json();
            unconfirmedId = unconfirmedData.transaction?.id;
          }
        } catch (error) {
          console.warn('Could not retrieve unconfirmed transaction ID:', error);
        }

        // Get block height
        const blockHeight = await fetchBlockHeight(baseUrl, txId, fetchTimeout);

        return {
          status: 'rejected',
          type: 'fee',
          confirmedId: txId,
          unconfirmedId,
          blockHeight,
          error: 'Transaction execution failed but fee was consumed'
        };
      } else if (txType === 'execute' || txType === 'deploy') {
        // Transaction was accepted
        const blockHeight = await fetchBlockHeight(baseUrl, txId, fetchTimeout);

        return {
          status: 'accepted',
          type: txType,
          confirmedId: txId,
          blockHeight,
        };
      }
    } catch (error: any) {
      // Log the error for debugging
      const errorMessage = error?.message || String(error);
      console.warn(`Attempt ${attempts}/${maxAttempts}: Fetch error - ${errorMessage}`);

      if (attempts >= maxAttempts) {
        throw new Error(`Failed after ${maxAttempts} attempts. Last error: ${errorMessage}`);
      }

      // If this is a timeout error, it's likely the endpoint is unresponsive
      if (errorMessage.includes('timeout')) {
        console.warn(`      Endpoint may be unresponsive. Will retry in ${pollInterval / 1000}s...`);
      }

      // Continue polling on error, but respect overall timeout
      const timeUntilTimeout = timeout - (Date.now() - startTime);
      const waitTime = Math.min(pollInterval, timeUntilTimeout);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // Exhausted max attempts without confirmation
  const elapsedTime = Date.now() - startTime;
  throw new Error(
    `Transaction status could not be determined after ${attempts} attempts ` +
    `(${Math.floor(elapsedTime / 1000)}s elapsed). Transaction may still be pending.`
  );
}