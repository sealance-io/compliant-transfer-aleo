export interface TransactionStatus {
    status: 'pending' | 'accepted' | 'rejected' | 'aborted' | 'timeout';
    transactionId?: string;
    blockHeight?: number;
    type?: string;
    error?: string;
  }

  export interface PollingConfig {
    initialInterval: number;    // Starting poll interval (ms)
    maxInterval: number;         // Maximum poll interval (ms)
    backoffMultiplier: number;   // Exponential backoff multiplier
    timeout: number;             // Total timeout (ms)
    maxRetries: number;          // Max retries on network errors
  }

  export class AleoTransactionTracker {
    private readonly baseUrl: string;
    
    constructor(baseUrl: string) {
      this.baseUrl = baseUrl;
    }
  
    /**
     * Track transaction status with exponential backoff and comprehensive error handling
     */
    async trackTransaction(
      transactionId: string,
      config: Partial<PollingConfig> = {}
    ): Promise<TransactionStatus> {
      const {
        initialInterval = 5000,      // Start with 5 seconds
        maxInterval = 30000,          // Cap at 30 seconds
        backoffMultiplier = 1.5,
        timeout = 300000,             // 5 minute total timeout
        maxRetries = 3
      } = config;
  
      const startTime = Date.now();
      let currentInterval = initialInterval;
      let consecutiveErrors = 0;
  
      while (Date.now() - startTime < timeout) {
        try {
          // Check if transaction is confirmed
          const status = await this.getConfirmedTransaction(transactionId);
          
          if (status) {
            // Transaction confirmed - determine final status
            const blockHeight = await this.getTransactionBlockHeight(transactionId);
            
            return {
              status: status.status === 'accepted' ? 'accepted' : 'rejected',
              transactionId: status.transaction.id,
              blockHeight,
              type: status.type
            };
          }
  
          // Check if transaction is in mempool (still pending)
          const inMempool = await this.checkMempool(transactionId);
          if (inMempool) {
            console.log(`Transaction ${transactionId} pending in mempool...`);
          }
  
          // Check if transaction was aborted (requires block scanning)
          const aborted = await this.checkIfAborted(transactionId);
          if (aborted) {
            return {
              status: 'aborted',
              transactionId,
              error: 'Transaction was aborted - both execution and fee processing failed'
            };
          }
  
          // Reset error counter on successful API call
          consecutiveErrors = 0;
  
        } catch (error) {
          consecutiveErrors++;
          
          if (consecutiveErrors >= maxRetries) {
            return {
              status: 'timeout',
              transactionId,
              error: `Failed after ${maxRetries} retries: ${error.message}`
            };
          }
  
          console.warn(`Error checking transaction (attempt ${consecutiveErrors}/${maxRetries}):`, error.message);
        }
  
        // Wait before next poll with exponential backoff
        await this.sleep(currentInterval);
        currentInterval = Math.min(currentInterval * backoffMultiplier, maxInterval);
      }
  
      return {
        status: 'timeout',
        transactionId,
        error: `Transaction not confirmed within ${timeout}ms`
      };
    }
  
    /**
     * Get confirmed transaction with retry logic
     */
    private async getConfirmedTransaction(
      transactionId: string,
      retryCount = 0
    ): Promise<any | null> {
      const maxRetries = 3;
      const retryDelay = 1000;
  
      try {
        const response = await fetch(
          `${this.baseUrl}/transaction/confirmed/${transactionId}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
  
        if (response.status === 404) {
          // Transaction not yet confirmed
          return null;
        }
  
        if (response.status === 429) {
          // Rate limited - implement exponential backoff
          if (retryCount < maxRetries) {
            const backoffDelay = retryDelay * Math.pow(2, retryCount);
            console.warn(`Rate limited, retrying in ${backoffDelay}ms...`);
            await this.sleep(backoffDelay);
            return this.getConfirmedTransaction(transactionId, retryCount + 1);
          }
          throw new Error('Rate limit exceeded after retries');
        }
  
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
  
        return await response.json();
  
      } catch (error) {
        if (retryCount < maxRetries && this.isRetriableError(error)) {
          await this.sleep(retryDelay * Math.pow(2, retryCount));
          return this.getConfirmedTransaction(transactionId, retryCount + 1);
        }
        throw error;
      }
    }
  
    /**
     * Check if transaction is in mempool
     */
    private async checkMempool(transactionId: string): Promise<boolean> {
      try {
        const response = await fetch(`${this.baseUrl}/memoryPool/transactions`);
        
        if (!response.ok) {
          return false; // Fail silently for mempool checks
        }
  
        const transactions = await response.json();
        return Array.isArray(transactions) && transactions.includes(transactionId);
  
      } catch (error) {
        console.warn('Failed to check mempool:', error.message);
        return false;
      }
    }
  
    /**
     * Check if transaction was aborted (requires scanning recent blocks)
     */
    private async checkIfAborted(transactionId: string): Promise<boolean> {
      try {
        // Get latest block height
        const latestHeight = await this.getLatestHeight();
        
        // Scan last 10 blocks for aborted transactions
        const blocksToCheck = 10;
        for (let i = 0; i < blocksToCheck; i++) {
          const height = latestHeight - i;
          const block = await this.getBlock(height);
          
          if (block?.aborted_transaction_ids?.includes(transactionId)) {
            return true;
          }
        }
  
        return false;
  
      } catch (error) {
        console.warn('Failed to check aborted status:', error.message);
        return false;
      }
    }
  
    /**
     * Get block height for a transaction
     */
    private async getTransactionBlockHeight(transactionId: string): Promise<number | undefined> {
      try {
        // Find block hash containing transaction
        const response = await fetch(`${this.baseUrl}/find/blockHash/${transactionId}`);
        
        if (!response.ok) {
          return undefined;
        }
  
        const blockHash = await response.text();
        
        // Get block details
        const blockResponse = await fetch(`${this.baseUrl}/block/${blockHash}`);
        if (!blockResponse.ok) {
          return undefined;
        }
  
        const block = await blockResponse.json();
        return block?.header?.metadata?.height;
  
      } catch (error) {
        console.warn('Failed to get block height:', error.message);
        return undefined;
      }
    }
  
    /**
     * Get latest block height
     */
    private async getLatestHeight(): Promise<number> {
      const response = await fetch(`${this.baseUrl}/latest/height`);
      if (!response.ok) {
        throw new Error('Failed to get latest height');
      }
      return parseInt(await response.text());
    }
  
    /**
     * Get block by height
     */
    private async getBlock(height: number): Promise<any> {
      const response = await fetch(`${this.baseUrl}/block/${height}`);
      if (!response.ok) {
        throw new Error(`Failed to get block ${height}`);
      }
      return await response.json();
    }
  
    /**
     * Determine if error is retriable
     */
    private isRetriableError(error: any): boolean {
      const retriableErrors = [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'NetworkError',
        'Failed to fetch'
      ];
  
      return retriableErrors.some(msg => 
        error.message?.includes(msg) || error.code?.includes(msg)
      );
    }
  
    /**
     * Sleep utility
     */
    private sleep(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }