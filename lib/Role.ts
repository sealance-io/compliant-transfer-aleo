import { Token_registryContract } from "../artifacts/js/token_registry";
import { ADMIN_INDEX, INVESTIGATOR_INDEX, MINTER_INDEX, ZERO_ADDRESS, mode, maxAddressesPerRole, maxRoles } from "./Constants";

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

export async function computeRoles2Addresses(contract: any, address: string, role: number): Promise<string[][]> {
  const newRole2Addresses: string[][] = [];
  let role2Address: string[] = [];
  
  for(let i=0; i<maxRoles; i++) {
    // Get a list of addresses for each role
    role2Address = await contract.role_to_addresses(2**i, [ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);
    
    // Remove address if it exists in any role
    let addrIndex = role2Address.findIndex(addr => addr === address);
    if (addrIndex != -1) {
        role2Address[addrIndex] = ZERO_ADDRESS;
    }
    
    if (role & (2**i)) {
      let index = role2Address.findIndex(addr => addr === ZERO_ADDRESS);
      if (index == -1) {
        throw new Error("Addresses per role limit exceeded. Max: " + maxAddressesPerRole);
      }
      if (!role2Address.includes(address)) {
        role2Address[index] = address;
      }
    }
    newRole2Addresses.push(role2Address);
  }

  return newRole2Addresses;
  
}
