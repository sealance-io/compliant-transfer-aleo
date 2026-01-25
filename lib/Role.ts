import { Token_registryContract } from "../artifacts/js/token_registry";
import { ZERO_ADDRESS, emptyMultisigCommonParams, mode } from "./Constants";

export async function setTokenRegistryRole(privateKey: string, tokenId: bigint, address: string, role: number) {
  const tokenRegistryContract = new Token_registryContract({
    mode,
    privateKey,
  });
  const tx = await tokenRegistryContract.set_role(tokenId, address, role);
  await tx.wait();
}

export async function updateAddressToRole(contract: any, address: string, role: number) {
  const tx = await contract.update_role(address, role);
  await tx.wait();
}

export async function updateAddressToRoleWithEmptyMultisigParams(contract: any, address: string, role: number) {
  const tx = await contract.update_role(address, role, emptyMultisigCommonParams);
  await tx.wait();
}
