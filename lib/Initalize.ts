import { CURRENT_FREEZE_LIST_ROOT_INDEX } from "./Constants";

export async function isProgramInitialized(program: any) {
  try {
    await program.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    return true;
  } catch {
    return false;
  }
}
