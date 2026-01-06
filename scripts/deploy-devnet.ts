import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { deployIfNotDeployed } from "../lib/Deploy";
import { BaseContract } from "../contract/base-contract";
import { BLOCK_HEIGHT_WINDOW, FREEZELIST_MANAGER_ROLE, fundedAmount, policies } from "../lib/Constants";
import { registerTokenProgram } from "../lib/Token";
import { fundWithCredits } from "../lib/Fund";
import {
  setTokenRegistryRole,
  updateAddressToRole,
  updateAddressToRoleWithEmptyMultisigParams,
  updateFreezeListManagerRole,
  updateMinterRole,
} from "../lib/Role";
import { GqrfmwbtypContract } from "../artifacts/js/gqrfmwbtyp";
import { Multisig_freezelist_registryContract } from "../artifacts/js/multisig_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";
import { initializeProgram } from "../lib/Initalize";
import { Sealed_report_tokenContract } from "../artifacts/js/sealed_report_token";
import { stringToBigInt, ZERO_ADDRESS } from "@sealance-io/policy-engine-aleo";
import { Multisig_compliant_tokenContract } from "../artifacts/js/multisig_compliant_token";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { Compliant_token_templateContract } from "../artifacts/js/compliant_token_template";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });
const [deployerAddress, adminAddress, investigatorAddress, , , , , , , , freezeListManagerAddress] =
  contract.getAccounts();
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
const reportPolicyContractForAdmin = new Sealed_report_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const thresholdContract = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const thresholdContractForAdmin = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: adminPrivKey,
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
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});
const multisigFreezeRegistryContract = new Multisig_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const multisigFreezeRegistryContractForAdmin = new Multisig_freezelist_registryContract({
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
const exchangeContractForAdmin = new GqrfmwbtypContract({
  mode,
  privateKey: adminPrivKey,
});
const reportTokenContract = new Sealed_report_tokenContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportTokenContractForAdmin = new Sealed_report_tokenContract({
  mode,
  privateKey: adminPrivKey,
});
const multisigCompliantTokenContract = new Multisig_compliant_tokenContract({
  mode,
  privateKey: deployerPrivKey,
});
const multisigCompliantTokenContractForAdmin = new Multisig_compliant_tokenContract({
  mode,
  privateKey: adminPrivKey,
});
const compliantTokenContract = new Compliant_token_templateContract({
  mode,
  privateKey: deployerPrivKey,
});
const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});

(async () => {
  await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
  await fundWithCredits(deployerPrivKey, freezeListManagerAddress, fundedAmount);

  // deploy contracts
  await deployIfNotDeployed(tokenRegistryContract);
  await deployIfNotDeployed(merkleTreeContract);
  await deployIfNotDeployed(reportPolicyContract);
  await deployIfNotDeployed(multiSigContract);
  await deployIfNotDeployed(freezeRegistryContract);
  await deployIfNotDeployed(multisigFreezeRegistryContract);
  await deployIfNotDeployed(thresholdContract);
  await deployIfNotDeployed(timelockContract);
  await deployIfNotDeployed(exchangeContract);
  await deployIfNotDeployed(reportTokenContract);
  await deployIfNotDeployed(compliantTokenContract);
  await deployIfNotDeployed(multisigCompliantTokenContract);

  // register token and assign a policy contract as external_authorization_party
  await registerTokenProgram(deployerPrivKey, deployerAddress, adminAddress, policies.report);
  await registerTokenProgram(deployerPrivKey, deployerAddress, adminAddress, policies.threshold);

  await initializeProgram(reportPolicyContractForAdmin, [adminAddress, BLOCK_HEIGHT_WINDOW, investigatorAddress]);
  await initializeProgram(freezeRegistryContract, [adminAddress, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS]);
  await initializeProgram(multisigFreezeRegistryContractForAdmin, [adminAddress, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS]);
  await initializeProgram(thresholdContractForAdmin, [
    adminAddress,
    policies.threshold.blockHeightWindow,
    investigatorAddress,
  ]);
  await initializeProgram(timelockContractForAdmin, [adminAddress]);
  await initializeProgram(exchangeContractForAdmin, [adminAddress]);
  await initializeProgram(reportTokenContractForAdmin, [
    stringToBigInt("Report Token"),
    stringToBigInt("REPORT_TOKEN"),
    6,
    1000_000000000000n,
    adminAddress,
    BLOCK_HEIGHT_WINDOW,
    investigatorAddress,
  ]);
  await initializeProgram(compliantTokenContract, [
    stringToBigInt("Stable Token"),
    stringToBigInt("STABLE_TOKEN"),
    6,
    1000_000000000000n,
    adminAddress,
    ZERO_ADDRESS,
  ]);
  await initializeProgram(multisigCompliantTokenContractForAdmin, [
    stringToBigInt("Stable Token"),
    stringToBigInt("STABLE_TOKEN"),
    6,
    1000_000000000000n,
    adminAddress,
    ZERO_ADDRESS,
  ]);

  // assign exchange program to be a minter
  await setTokenRegistryRole(adminPrivKey, policies.report.tokenId, exchangeContract.address(), 1);
  await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
  await updateMinterRole(timelockContractForAdmin, exchangeContract.address());

  // Update the freeze list manager
  await updateFreezeListManagerRole(reportPolicyContractForAdmin, freezeListManagerAddress);
  await updateFreezeListManagerRole(reportTokenContractForAdmin, freezeListManagerAddress);
  await updateAddressToRole(freezeRegistryContractForAdmin, freezeListManagerAddress, FREEZELIST_MANAGER_ROLE);
  await updateAddressToRoleWithEmptyMultisigParams(
    multisigFreezeRegistryContractForAdmin,
    freezeListManagerAddress,
    FREEZELIST_MANAGER_ROLE,
  );

  process.exit(0);
})();
