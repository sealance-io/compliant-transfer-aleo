import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from "../contract/base-contract";
import { policies } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";
import { setTimelockPolicyRole, setTokenRegistryRole } from "../lib/Role";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { GqrfmwbtypContract } from "../artifacts/js/gqrfmwbtyp";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";

const mode = ExecutionMode.SnarkExecute;

const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const tokenRegistryContract = new Token_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantTransferContract = new Sealed_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantThresholdTransferContract = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantTimelockTransferContract = new Sealed_timelock_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const exchangeContract = new GqrfmwbtypContract({
  mode,
  privateKey: deployerPrivKey,
});

(async () => {
  // deploy contracts
  await deployIfNotDeployed(tokenRegistryContract);
  await deployIfNotDeployed(merkleTreeContract);
  await deployIfNotDeployed(compliantTransferContract);
  await deployIfNotDeployed(freezeRegistryContract);
  await deployIfNotDeployed(compliantThresholdTransferContract);
  await deployIfNotDeployed(compliantTimelockTransferContract);
  await deployIfNotDeployed(exchangeContract);

  // register token and assign compliant transfer contract as external_authorization_party
  await initializeTokenProgram(
    deployerPrivKey,
    deployerAddress,
    adminPrivKey,
    adminAddress,
    investigatorAddress,
    policies.compliant,
  );
  await initializeTokenProgram(
    deployerPrivKey,
    deployerAddress,
    adminPrivKey,
    adminAddress,
    investigatorAddress,
    policies.threshold,
  );
  await initializeTokenProgram(
    deployerPrivKey,
    deployerAddress,
    adminPrivKey,
    adminAddress,
    investigatorAddress,
    policies.timelock,
  );

  // assign exchange program to be a minter
  await setTokenRegistryRole(adminPrivKey, policies.compliant.tokenId, exchangeContract.address(), 1);
  await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
  await setTimelockPolicyRole(adminPrivKey, exchangeContract.address(), 2);

  const updateFreezeRegistryAdmin = await freezeRegistryContract.update_admin_address(adminAddress);
  await updateFreezeRegistryAdmin.wait();
  const updateBlockHeightWindow = await freezeRegistryContractForAdmin.update_block_height_window(300);
  await updateBlockHeightWindow.wait();
  const updateExchangeAdmin = await exchangeContract.update_admin(adminAddress);
  await updateExchangeAdmin.wait();

  process.exit(0);
})();
