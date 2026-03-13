import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import networkConfig from "../aleo-config";
import { parseBooleanEnv } from "./Env";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const IS_DEVNET = parseBooleanEnv(process.env.DEVNET, false);

class AdvanceBlocksError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AdvanceBlocksError";
  }
}

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

  if (!IS_DEVNET) {
    try {
      await advanceBlocks(blocks);
    } catch (error) {
      if (!isUnsupportedAdvanceBlocksError(error)) {
        throw error;
      }
    }
  }

  while (true) {
    const currentHeight = await getLatestBlockHeight();

    if (currentHeight >= targetHeight) {
      return; // Done!
    }

    // Wait a bit before checking again (adjust if needed)
    await sleep(1000);
  }
}

export async function advanceBlocks(numBlocks: number): Promise<void> {
  const networkName = networkConfig.defaultNetwork;
  const endpoint = networkConfig.networks[networkName].endpoint;
  const apiUrl = `${endpoint}/testnet/block/create`;

  // Call the REST API to advance the ledger by N block.
  const payload = {
    num_blocks: numBlocks,
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new AdvanceBlocksError(`advanceBlocks failed: ${response.status} ${response.statusText}`, response.status);
  }
}

function isUnsupportedAdvanceBlocksError(error: unknown): boolean {
  return error instanceof AdvanceBlocksError && (error.status === 404 || error.status === 405);
}
