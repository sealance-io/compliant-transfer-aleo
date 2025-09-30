import { Worker } from "worker_threads";
import os from "os";

export async function generateAddressesParallel(
  totalCount: number,
  options: {
    onProgress?: (current: number, total: number) => void;
    maxWorkers?: number;
  } = {},
): Promise<string[]> {
  const { onProgress, maxWorkers = os.cpus().length } = options;

  // Use inline worker code to avoid file resolution issues
  const workerCode = `
    const { workerData, parentPort } = require('worker_threads');
    
    // Dynamic import for ESM module
    (async () => {
      const { Account } = await import('@provablehq/sdk');
      
      const addresses = [];
      for (let i = 0; i < workerData.count; i++) {
        const account = new Account();
        addresses.push(account.address().to_string());
        
        if (i % 100 === 0) {
          parentPort.postMessage({
            type: 'progress',
            current: i,
            total: workerData.count
          });
        }
      }
      
      parentPort.postMessage({
        type: 'complete',
        addresses
      });
    })().catch(err => {
      parentPort.postMessage({
        type: 'error',
        error: err.message
      });
    });
  `;

  // arbitrary heuristics for selecting number of workers
  const numWorkers = Math.min(maxWorkers, Math.max(1, Math.min(os.cpus().length, Math.ceil(totalCount / 1000))));

  const chunkSize = Math.ceil(totalCount / numWorkers);

  const workerPromises = Array.from({ length: numWorkers }, (_, i) => {
    return new Promise<string[]>((resolve, reject) => {
      const count = Math.min(chunkSize, totalCount - i * chunkSize);
      if (count <= 0) {
        resolve([]);
        return;
      }

      const worker = new Worker(workerCode, {
        eval: true,
        workerData: {
          start: i * chunkSize,
          count,
        },
      });

      let addresses: string[] = [];

      worker.on("message", (msg: any) => {
        if (msg.type === "complete") {
          addresses = msg.addresses;
          resolve(addresses);
        } else if (msg.type === "progress" && onProgress) {
          onProgress(i * chunkSize + msg.current, totalCount);
        } else if (msg.type === "error") {
          reject(new Error(msg.error));
        }
      });

      worker.on("error", reject);

      worker.on("exit", code => {
        if (code !== 0 && addresses.length === 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  });

  const results = await Promise.all(workerPromises);
  return results.flat();
}
