import { Token_registryContract } from "../artifacts/js/token_registry";
import { ZERO_ADDRESS, mode, tokenId, tokenName, tokenSymbol } from "./Constants";
import { stringToBigInt } from "./Conversion";

export async function initializeTokenProgram(deployerPrivKey: any, deployerAddress: string, adminAddress: string, policyAddress: string) {
    const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });

    // register token and assign compliant transfer contract as external_authorization_party
    const tokenMetadata = await tokenRegistryContract.registered_tokens(
        tokenId,
        {
            token_id: 0n,
            name: 0n,
            symbol: 0n,
            decimals: 0,
            supply: 0n,
            max_supply: 0n,
            admin: ZERO_ADDRESS,
            external_authorization_required: false,
            external_authorization_party: ZERO_ADDRESS
        }
    );
    if (tokenMetadata.token_id === 0n) {
        const tx = await tokenRegistryContract.register_token(
            tokenId, // tokenId
            stringToBigInt(tokenName), // tokenId
            stringToBigInt(tokenSymbol), // name
            6, // decimals
            1000_000000000000n, // max supply
            true,
            policyAddress
        );
        await tx.wait();
        if (deployerAddress !== adminAddress) {
            const tx = await tokenRegistryContract.update_token_management(
                tokenId,
                adminAddress,
                policyAddress
            )
            await tx.wait();
        }
    } else if (tokenMetadata.external_authorization_party !== policyAddress) {
        // if the admin is not the deployer and the admin is already the admin this call will not work
        const tx = await tokenRegistryContract.update_token_management(
            tokenId,
            adminAddress,
            policyAddress
        )
        await tx.wait();
    }

    // const adminRole = await compliantTransferContract.roles(1, ZERO_ADDRESS);
    // if (adminRole === ZERO_ADDRESS) {
    //     const tx = await compliantTransferContract.update_admin_address(deployerAddress);
    //     await tx.wait();
    // }

    // const investigatorRole = await compliantTransferContract.roles(2, ZERO_ADDRESS);
    // if (investigatorRole === ZERO_ADDRESS) {
    //     const tx = await compliantTransferContract.update_investigator_address(investigatorAddress);
    //     await tx.wait();
    // }

    // if (adminRole === ZERO_ADDRESS) {
    //     const tx = await compliantTransferContract.update_admin_address(adminAddress);
    //     await tx.wait();
    // }

}
