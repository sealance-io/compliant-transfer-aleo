import { Token_registryContract } from "../artifacts/js/token_registry";
import { ADMIN_INDEX, INVESTIGATOR_INDEX, MINTER_INDEX, ZERO_ADDRESS, mode } from "./Constants";

export async function setTokenRegistryRole(privateKey: string, tokenId: bigint, address: string, role: number) {
  const tokenRegistryContract = new Token_registryContract({
    mode,
    privateKey,
  });
  const tx = await tokenRegistryContract.set_role(tokenId, address, role);
  await tx.wait();
}

export async function updateAdminRole(contract: any, address: string) {
  const adminRole = await contract.roles(ADMIN_INDEX, ZERO_ADDRESS);
  if (adminRole !== address) {
    const tx = await contract.update_role(address, ADMIN_INDEX);
    await tx.wait();
  }
}

export async function updateInvestigatorRole(contract: any, address: string) {
  const investigatorRole = await contract.roles(INVESTIGATOR_INDEX, ZERO_ADDRESS);
  if (investigatorRole !== address) {
    const tx = await contract.update_role(address, INVESTIGATOR_INDEX);
    await tx.wait();
  }
}

export async function updateMinterRole(contract: any, address: string) {
  const minterRole = await contract.roles(MINTER_INDEX, ZERO_ADDRESS);
  if (minterRole !== address) {
    const tx = await contract.update_role(address, MINTER_INDEX);
    await tx.wait();
  }
}

export async function updateRole(contract: any, address: string, role: number) {
  const tx = await contract.update_role(address, role);
  await tx.wait();
}
