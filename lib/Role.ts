import { Token_registryContract } from "../artifacts/js/token_registry"
import { mode } from "./Constants";

export async function setRole(adminPrivKey: string, tokenId: bigint, programAddress: string, role: number) {
    const tokenRegistryContract = new Token_registryContract({ mode, privateKey: adminPrivKey })
    const tx = await tokenRegistryContract.set_role(
        tokenId,
        programAddress,
        role
    )
    await tx.wait();
}