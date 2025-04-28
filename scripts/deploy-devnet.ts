import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from '../contract/base-contract';
import { fundedAmount, policies } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";
import { fundWithCredits } from "../lib/Fund";
import { setTimelockPolicyRole, setTokenRegistryRole } from "../lib/Role";
import { GqrfmwbtykContract } from "../artifacts/js/gqrfmwbtyk";
import { UscrpnwqsxContract } from "../artifacts/js/uscrpnwqsx";
import { RawxtbrzceContract } from "../artifacts/js/rawxtbrzce";
import { RiwoxowhvaContract } from "../artifacts/js/riwoxowhva";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const tokenRegistryContract = new Token_registryContract({ mode, privateKey: deployerPrivKey });
const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode, privateKey: deployerPrivKey })
const compliantThresholdTransferContract = new RiwoxowhvaContract({ mode, privateKey: deployerPrivKey });
const compliantTimelockTransferContract = new RawxtbrzceContract({ mode, privateKey: deployerPrivKey })
const freezeRegistryContract = new UscrpnwqsxContract({ mode, privateKey: deployerPrivKey })
const merkleTreeContract = new Rediwsozfo_v2Contract({ mode, privateKey: deployerPrivKey });
const exchangeContract = new GqrfmwbtykContract({ mode, privateKey: deployerPrivKey });

(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);

    // deploy contracts
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(compliantThresholdTransferContract);
    await deployIfNotDeployed(compliantTimelockTransferContract);
    await deployIfNotDeployed(exchangeContract);

    // register token and assign compliant transfer contract as external_authorization_party
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.compliant);
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.threshold);
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.timelock);

    // assign exchange program to be a minter
    await setTokenRegistryRole(adminPrivKey, policies.compliant.tokenId, exchangeContract.address(), 1);
    await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
    await setTimelockPolicyRole(adminPrivKey, exchangeContract.address(), 2);

    const updateFreezeRegistryAdmin = await freezeRegistryContract.update_admin_address(adminAddress);
    await updateFreezeRegistryAdmin.wait();
    const updateExchangeAdmin = await exchangeContract.update_admin(adminAddress);
    await updateExchangeAdmin.wait();
    
    
    process.exit(0);
})();
