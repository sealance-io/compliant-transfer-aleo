import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { fundedAmount } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";
import { fundWithCredits } from "../lib/Fund";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });
const compliantTransferContract = new TqxftxoicdContract({ mode })
const merkleTreeContract = new RediwsozfoContract({ mode });

(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);

    // deploy contracts
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);

    // register token and assign compliant transfer contract as external_authorization_party
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminAddress, investigatorAddress);

    process.exit(0);
})();
