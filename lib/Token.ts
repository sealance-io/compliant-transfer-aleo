import { BaseContract } from '../contract/base-contract';
import { Token_registryContract } from "../artifacts/js/token_registry";
import { ZERO_ADDRESS, mode, tokenId, tokenName, tokenSymbol } from "./Constants";
import { stringToBigInt } from "./Conversion";
import { Tqxftxoicd_v2_1Contract } from '../artifacts/js/tqxftxoicd_v2_1';

const contract = new BaseContract({ mode });

// ToDo: Library should not depend on specific env variables.
// Find a better way to handle addresses and keys.  
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

export async function initializeTokenProgram() {
    const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });
    const compliantTransferContract = new Tqxftxoicd_v2_1Contract({ mode, privateKey: deployerPrivKey });

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
            compliantTransferContract.address()
        );
        tx.wait();
    } else if (tokenMetadata.external_authorization_party !== compliantTransferContract.address()) {
        const tx = await tokenRegistryContract.update_token_management(
            tokenId,
            adminAddress,
            compliantTransferContract.address()
        )
        await tx.wait();
    }

    let adminRole = await compliantTransferContract.roles(1, ZERO_ADDRESS);
    if (adminRole === ZERO_ADDRESS) {
        let tx = await compliantTransferContract.update_admin_address(deployerAddress);
        await tx.wait();
    }

    let investigatorRole = await compliantTransferContract.roles(2, ZERO_ADDRESS);
    if (investigatorRole === ZERO_ADDRESS) {
        let tx = await compliantTransferContract.update_investigator_address(investigatorAddress);
        await tx.wait();
    }

    if (adminRole === ZERO_ADDRESS) {
        let tx = await compliantTransferContract.update_admin_address(adminAddress);
        await tx.wait();
    }

}
