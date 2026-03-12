import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import networkConfig from "../aleo-config";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

export async function getLatestBlockHeight() {
  const response = (await fetch(
    `${contract.config.network.endpoint}/${contract.config.networkName}/block/height/latest`,
  )) as any;
  const latestBlockHeight = (await response.json()) as number;
  return latestBlockHeight;
}

// Helper sleep function
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitBlocks(blocks: number) {
  const startHeight = await getLatestBlockHeight();
  const targetHeight = startHeight + blocks;

  try {
    await advanceBlocks(blocks);
  } catch {}

  while (true) {
    const currentHeight = await getLatestBlockHeight();

    if (currentHeight >= targetHeight) {
      return; // Done!
    }

    // Wait a bit before checking again (adjust if needed)
    await sleep(1000);
  }
}

export async function advanceBlocks(numBlocks: number, privKey?: string): Promise<void> {
  const networkName = networkConfig.defaultNetwork;
  const endpoint = networkConfig.networks[networkName].endpoint;
  if (!privKey) {
    privKey = networkConfig.networks[networkName].accounts[0];
  }
  const apiUrl = `${endpoint}/testnet/block/create`;

  // Call the REST API to advance the ledger by N block.
  const payload = {
    private_key: privKey,
    num_blocks: numBlocks,
  };

  await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
