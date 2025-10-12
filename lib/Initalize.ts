import { ADMIN_INDEX, CURRENT_FREEZE_LIST_ROOT_INDEX, MANAGER_ROLE } from "./Constants";

export async function isProgramInitialized(program: any) {
  try { 
    await program.roles(ADMIN_INDEX); 
    return true; 
  } catch {}

  try { 
    await program.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX); 
    return true; 
  } catch {}

  try { 
    await program.token_info(true); 
    return true; 
  } catch {}

  return false;
}

export async function initializeProgram(contract: any, params: any[]) {
  const isInitialized = await isProgramInitialized(contract);
  if (!isInitialized) {
    const tx = await contract.initialize(...params);
    await tx.wait();
  }
}
