import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from "../contract/base-contract";
import { fundedAmount, policies } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";
import { fundWithCredits } from "../lib/Fund";
import { setTokenRegistryRole, updateAdminRole, updateMinterRole } from "../lib/Role";
import { GqrfmwbtypContract } from "../artifacts/js/gqrfmwbtyp";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";
import { initializeFreezeList } from "../lib/FreezeList";

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
const compliantTimelockTransferContractForAdmin = new Sealed_timelock_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
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

  // initialize freeze list
  await initializeFreezeList(compliantTransferContract);
  await initializeFreezeList(freezeRegistryContract);

  // assign exchange program to be a minter
  await setTokenRegistryRole(adminPrivKey, policies.compliant.tokenId, exchangeContract.address(), 1);
  await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
  await updateMinterRole(compliantTimelockTransferContractForAdmin, exchangeContract.address());

  // update the admin
  await updateAdminRole(freezeRegistryContractForAdmin, adminAddress);
  await updateAdminRole(exchangeContract, adminAddress);

  process.exit(0);
})();
