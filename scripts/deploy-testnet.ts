import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import networkConfig from '../aleo-config';
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { ALEO_TESTNET_API } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";

const mode = ExecutionMode.SnarkExecute;
networkConfig.networks.testnet.endpoint = ALEO_TESTNET_API;

const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });
const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode })
const merkleTreeContract = new Rediwsozfo_v2Contract({ mode });

(async () => {
    // deploy contracts
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);

    // register token and assign compliant transfer contract as external_authorization_party
    await initializeTokenProgram(deployerAddress, deployerAddress, adminAddress, investigatorAddress);

    process.exit(0);
})();
