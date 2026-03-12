import { CURRENT_FREEZE_LIST_ROOT_INDEX } from "./Constants";

export async function isProgramInitialized(program: any) {
  // freeze-list programs: sealance_freezelist_registry, multisig_freezelist_registry, sealed_report_policy, sealed_report_token
  try {
    await program.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    return true;
  } catch {}
  // token programs: compliant_token, multisig_compliant_token, sealed_report_token
  try {
    await program.token_info(true);
    return true;
  } catch {}
  // proxy programs: multisig_token_proxy, multisig_freezelist_proxy, exchange_demo
  try {
    await program.initialized(true);
    return true;
  } catch {}
  // policy programs: sealed_threshold_report_policy, sealed_timelock_policy
  try {
    await program.freeze_registry_program_name(true);
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
