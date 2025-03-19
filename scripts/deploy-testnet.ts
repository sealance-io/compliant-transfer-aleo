import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import networkConfig from '../aleo-config';
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { COMPLIANT_TRANSFER_ADDRESS, ZERO_ADDRESS, mode, tokenId, tokenName, tokenSymbol } from "./Constants";
import { stringToBigInt } from "./Conversion";

const mode = ExecutionMode.SnarkExecute;
networkConfig.networks.testnet.endpoint = "https://capable.snarkos.net";

const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });
const compliantTransferContract = new TqxftxoicdContract({ mode })
const merkleTreeContract = new RediwsozfoContract({ mode });

(async () => {
    // deploy contracts
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);

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
            COMPLIANT_TRANSFER_ADDRESS
        );
        tx.wait();
    } else if (tokenMetadata.external_authorization_party !== COMPLIANT_TRANSFER_ADDRESS) {
        const tx = await tokenRegistryContract.update_token_management(
            tokenId,
            adminAddress,
            COMPLIANT_TRANSFER_ADDRESS
        )
        await tx.wait();
    }

    process.exit(0);
})();
