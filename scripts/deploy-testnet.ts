import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { policies } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";
import { Compliant_threshold_transferContract } from "../artifacts/js/compliant_threshold_transfer";

const mode = ExecutionMode.SnarkExecute;

const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);

const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });
const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode })
const compliantThresholdTransferContract = new Compliant_threshold_transferContract({ mode })
const merkleTreeContract = new Rediwsozfo_v2Contract({ mode });

(async () => {
    // deploy contracts
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);
    await deployIfNotDeployed(compliantThresholdTransferContract);

    // register token and assign compliant transfer contract as external_authorization_party
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminAddress, investigatorAddress, policies.compliant);
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminAddress, investigatorAddress, policies.threshold);

    process.exit(0);
})();
