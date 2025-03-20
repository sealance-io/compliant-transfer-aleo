import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { mode } from "./Constants";
import { initializeTokenProgram } from "../lib/Token";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress] = contract.getAccounts();
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
    await initializeTokenProgram();

    process.exit(0);
})();
