import { BaseContract } from "../contract/base-contract";

export async function deployIfNotDeployed(contract: BaseContract) {
  const isDeployed = await contract.isDeployed();
  if (!isDeployed) {
    const tx = await contract.deploy();
    await tx.wait();
  }
}