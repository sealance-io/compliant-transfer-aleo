interface TransactionStatus {
  status: 'accepted' | 'rejected' | 'aborted' | 'pending';
  type: 'execute' | 'deploy' | 'fee';
  confirmedId: string;
  unconfirmedId?: string;
  blockHeight?: number;
  error?: string;
}

/**
 * Fetches the block height for a given transaction ID
 * Handles JSON-quoted responses from the API
 */
async function fetchBlockHeight(baseUrl: string, txId: string): Promise<number | undefined> {
  try {
    // Fetch block hash
    const blockHashResponse = await fetch(`${baseUrl}/find/blockHash/${txId}`);
    if (!blockHashResponse.ok) {
      return undefined;
    }

    const blockHashText = await blockHashResponse.text();
    // Handle JSON-quoted strings (API returns "hash" instead of hash)
    const blockHash = blockHashText.trim().replace(/^"|"$/g, '');

    if (!blockHash || blockHash === 'null') {
      return undefined;
    }

    // Fetch block by hash
    const blockResponse = await fetch(`${baseUrl}/block/${blockHash}`);
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
    network?: string;
  } = {}
): Promise<TransactionStatus> {
  const {
    maxAttempts = 60,
    pollInterval = 5000,
    timeout = 300000,
    network = 'mainnet'
  } = options;

  const baseUrl = endpoint;
  const startTime = Date.now();
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    if (Date.now() - startTime > timeout) {
      throw new Error(`Transaction polling timeout after ${timeout}ms`);
    }

    try {
      // Try to get confirmed transaction
      const response = await fetch(`${baseUrl}/transaction/confirmed/${txId}`);
      
      if (!response.ok) {
        if (response.status === 404) {
          // Transaction not yet confirmed, continue polling
          console.log(`Attempt ${attempts}: Transaction not yet confirmed`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        throw new Error(`API error: ${response.status}`);
      }

      const transactionResonse = await response.json();

      // Check if transaction was rejected by inspecting type
      if (transactionResonse?.transaction.type === 'fee') {
        // This is a rejected transaction
        // Get the original unconfirmed transaction ID
        let unconfirmedId: string | undefined;
        
        try {
          const unconfirmedResponse = await fetch(
            `${baseUrl}/transaction/unconfirmed/${txId}`
          );
          
          if (unconfirmedResponse.ok) {
            const unconfirmedData = await unconfirmedResponse.json();
            unconfirmedId = unconfirmedData.transaction?.id;
          }
        } catch (error) {
          console.warn('Could not retrieve unconfirmed transaction ID:', error);
        }

        // Get block height
        const blockHeight = await fetchBlockHeight(baseUrl, txId);

        return {
          status: 'rejected',
          type: 'fee',
          confirmedId: txId,
          unconfirmedId,
          blockHeight,
          error: 'Transaction execution failed but fee was consumed'
        };
      } else if (transactionResonse.transaction.type === 'execute' || transactionResonse.transaction.type === 'deploy') {
        // Transaction was accepted
        const blockHeight = await fetchBlockHeight(baseUrl, txId);

        return {
          status: 'accepted',
          type: transactionResonse.type,
          confirmedId: txId,
          blockHeight,
        };
      }
    } catch (error) {
      if (attempts >= maxAttempts) {
        throw error;
      }
      // Continue polling on error
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Check if transaction was aborted
  // Note: This requires knowing a block range to check
  return {
    status: 'pending',
    type: 'execute',
    confirmedId: txId,
    error: 'Transaction status could not be determined'
  };
}