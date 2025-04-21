import { Compliant_timelock_transferContract } from "../artifacts/js/compliant_timelock_transfer";
import { Token_registryContract } from "../artifacts/js/token_registry"
import { ZERO_ADDRESS, mode } from "./Constants";

export async function setTokenRegistryRole(privateKey: string, tokenId: bigint, address: string, role: number) {
    const tokenRegistryContract = new Token_registryContract({ mode, privateKey })
    const tx = await tokenRegistryContract.set_role(
        tokenId,
        address,
        role
    )
    await tx.wait();
}

export async function setTimelockPolicyRole(privateKey: string, address: string, role: number) {
    const timelockContract = new Compliant_timelock_transferContract({ mode, privateKey });
    const onchainRole = await timelockContract.roles(address, 0);
    if (onchainRole !== role) {
        const tx = await timelockContract.update_roles(address, role)
        await tx.wait();
    }
}


export async function updateAdminRole(privateKey: string, Contract: any, address: string) {
    const contract = new Contract({ mode, privateKey });
    const adminRole = await contract.roles(1, ZERO_ADDRESS);
    if (adminRole !== address) {
        const tx = await contract.update_admin_address(address);
        await tx.wait();
    }
}

export async function updateInvestigatorRole(privateKey: string, Contract: any, address: string) {
    const contract = new Contract({ mode, privateKey });
    const investigatorRole = await contract.roles(2, ZERO_ADDRESS);
    if (investigatorRole !== address) {
        const tx = await contract.update_investigator_address(address);
        await tx.wait();
    }
}