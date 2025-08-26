import { BLOCK_HEIGHT_WINDOW, CURRENT_FREEZE_LIST_ROOT_INDEX } from "./Constants";

export async function isProgramInitialized(program: any) {
  try {
    await program.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    return true;
  } catch {
    return false;
  }
}

export async function initializeFreezeListAndTokenDetails(
  contract: any,
  name: bigint,
  symbol: bigint,
  decimals: number,
  maxSupply: bigint,
) {
  const isInitialized = await isProgramInitialized(contract);
  if (!isInitialized) {
    const tx = await contract.initialize(name, symbol, decimals, maxSupply, BLOCK_HEIGHT_WINDOW);
    await tx.wait();
  }
}

export async function initializeFreezeList(contract: any) {
  const isInitialized = await isProgramInitialized(contract);
  if (!isInitialized) {
    const tx = await contract.initialize(BLOCK_HEIGHT_WINDOW);
    await tx.wait();
  }
}
