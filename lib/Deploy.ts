import { BaseContract } from "../contract/base-contract";

export async function deployIfNotDeployed(contract: BaseContract) {
  let isDeployed = await contract.isDeployed();
  if (!isDeployed) {
    const tx = await contract.deploy();
    await tx.wait();
    // verifying that program has been deployed
    isDeployed = await contract.isDeployed();
    if (!isDeployed) {
      throw new Error(`deployment has failed`);
    }
  }
}
