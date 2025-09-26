import { ADMIN_INDEX } from "./Constants";

export async function isProgramInitialized(program: any) {
  try {
    await program.roles(ADMIN_INDEX);
    return true;
  } catch {
    return false;
  }
}

export async function initializeProgram(contract: any, params: any[]) {
  const isInitialized = await isProgramInitialized(contract);
  if (!isInitialized) {
    const tx = await contract.initialize(...params);
    await tx.wait();
  }
}
