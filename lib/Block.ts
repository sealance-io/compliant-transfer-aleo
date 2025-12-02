import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";

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

  while (true) {
    const currentHeight = await getLatestBlockHeight();

    if (currentHeight >= targetHeight) {
      return; // Done!
    }

    // Wait a bit before checking again (adjust if needed)
    await sleep(1000);
  }
}
