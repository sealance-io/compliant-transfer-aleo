import { Worker } from "worker_threads";
import os from "os";
import { Account } from "@provablehq/sdk";

// Leo CLI parses arguments with these suffixes as typed literals, causing it to
// reject valid Aleo addresses. Listed longest-first so the most-specific suffix
// matches first. Reachability from the bech32 charset (excludes '1','b','i','o'):
//   Reachable:   u8 (~1/1 024), u32 (~1/32 768), u64 (~1/32 768), scalar (~1/32^6)
//   Unreachable: u16, u128 (need '1')  |  i-types, field (need 'i')  |  group (needs 'o')
// Unreachable types are included for defense-in-depth.
const LEO_TYPE_SUFFIXES = [
  // unsigned integers
  "u128", "u64", "u32", "u16", "u8",
  // signed integers
  "i128", "i64", "i32", "i16", "i8",
  // other primitive types
  "scalar", "field", "group",
];

function hasDangerousSuffix(address: string): boolean {
  return LEO_TYPE_SUFFIXES.some(s => address.endsWith(s));
}

export function safeAddress(): string {
  let addr: string;
  do {
    addr = new Account().address().to_string();
  } while (hasDangerousSuffix(addr));
  return addr;
}

export function safeAccount(): Account {
  let account: Account;
  do {
    account = new Account();
  } while (hasDangerousSuffix(account.address().to_string()));
  return account;
}

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

      const DANGEROUS = ['u128','u64','u32','u16','u8','i128','i64','i32','i16','i8','scalar','field','group'];
      function isSafe(addr) {
        return !DANGEROUS.some(s => addr.endsWith(s));
      }

      const addresses = [];
      while (addresses.length < workerData.count) {
        const addr = new Account().address().to_string();
        if (!isSafe(addr)) continue;
        addresses.push(addr);

        const i = addresses.length;
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
