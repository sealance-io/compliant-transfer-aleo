import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from "../contract/base-contract";
import { fundedAmount, policies } from "../lib/Constants";
import { initializeTokenProgram } from "../lib/Token";
import { fundWithCredits } from "../lib/Fund";
import { setTokenRegistryRole, updateAdminRole, updateInvestigatorRole, updateMinterRole } from "../lib/Role";
import { GqrfmwbtypContract } from "../artifacts/js/gqrfmwbtyp";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";
import { initializeFreezeList, initializeFreezeListAndTokenDetails } from "../lib/Initalize";
import { Sealed_report_tokenContract } from "../artifacts/js/sealed_report_token";
import { stringToBigInt } from "../lib/Conversion";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const tokenRegistryContract = new Token_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportPolicyContract = new Sealed_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const thresholdContract = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const timelockContract = new Sealed_timelock_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const timelockContractForAdmin = new Sealed_timelock_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const freezeRegistryContract = new Sealance_freezelist_registryContract({
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
const reportTokenContract = new Sealed_report_tokenContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportTokenContractForAdmin = new Sealed_report_tokenContract({
  mode,
  privateKey: adminPrivKey,
});

(async () => {
  await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);

  // deploy contracts
  await deployIfNotDeployed(tokenRegistryContract);
  await deployIfNotDeployed(merkleTreeContract);
  await deployIfNotDeployed(reportPolicyContract);
  await deployIfNotDeployed(freezeRegistryContract);
  await deployIfNotDeployed(thresholdContract);
  await deployIfNotDeployed(timelockContract);
  await deployIfNotDeployed(exchangeContract);
  await deployIfNotDeployed(reportTokenContract);

  // register token and assign compliant transfer contract as external_authorization_party
  await initializeTokenProgram(
    deployerPrivKey,
    deployerAddress,
    adminPrivKey,
    adminAddress,
    investigatorAddress,
    policies.report,
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
  await initializeFreezeList(reportPolicyContract);
  await initializeFreezeList(freezeRegistryContract);
  await initializeFreezeListAndTokenDetails(
    reportTokenContract,
    stringToBigInt("Report Token"),
    stringToBigInt("REPORT_TOKEN"),
    6,
    1000_000000000000n,
  );

  // update the admin
  await updateAdminRole(freezeRegistryContract, adminAddress);
  await updateAdminRole(exchangeContract, adminAddress);
  await updateAdminRole(reportTokenContract, adminAddress);

  // update the investigator
  await updateInvestigatorRole(reportTokenContractForAdmin, investigatorAddress);

  // assign exchange program to be a minter
  await setTokenRegistryRole(adminPrivKey, policies.report.tokenId, exchangeContract.address(), 1);
  await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
  await updateMinterRole(timelockContractForAdmin, exchangeContract.address());

  process.exit(0);
})();
