import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { BLOCK_HEIGHT_WINDOW, fundedAmount } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { getProgramEdition, upgradeProgram } from "../lib/Upgrade";
import { initializeProgram } from "../lib/Initalize";
import { Sealed_report_tokenContract } from "../artifacts/js/sealed_report_token";
import { stringToBigInt } from "../lib/Conversion";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, investigatorAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
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
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

describe("test upgradeability", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(reportTokenContract);

    await initializeProgram(freezeRegistryContractForAdmin, [adminAddress, BLOCK_HEIGHT_WINDOW]);
    await initializeProgram(reportTokenContractForAdmin, [
      stringToBigInt("Report Token"),
      stringToBigInt("REPORT_TOKEN"),
      6,
      1000_000000000000n,
      adminAddress,
      BLOCK_HEIGHT_WINDOW,
      investigatorAddress,
    ]);
  });

  test(`test upgrades`, async () => {
    // It shouldn't be possible to upgrade the merkle_Tree program
    const merkleTreeEditionBefore = await getProgramEdition("merkle_tree");
    let isUpgradeSuccessful = await upgradeProgram("merkle_tree", adminPrivKey);
    const merkleTreeEditionAfter = await getProgramEdition("merkle_tree");
    expect(isUpgradeSuccessful).toBe(false);
    expect(merkleTreeEditionBefore).toBe(merkleTreeEditionAfter);

    // Only upgrade address can upgrade
    let freezeRegistryEditionBefore = await getProgramEdition("sealance_freezelist_registry");
    isUpgradeSuccessful = await upgradeProgram("sealance_freezelist_registry", deployerPrivKey);
    let freezeRegistryTreeEditionAfter = await getProgramEdition("sealance_freezelist_registry");
    expect(isUpgradeSuccessful).toBe(true);
    expect(freezeRegistryEditionBefore + 1).toBe(freezeRegistryTreeEditionAfter);
    freezeRegistryEditionBefore = await getProgramEdition("sealance_freezelist_registry");
    isUpgradeSuccessful = await upgradeProgram("sealance_freezelist_registry", adminPrivKey);
    freezeRegistryTreeEditionAfter = await getProgramEdition("sealance_freezelist_registry");
    expect(isUpgradeSuccessful).toBe(false);
    expect(freezeRegistryEditionBefore).toBe(freezeRegistryTreeEditionAfter);

    // Only the admin can upgrade
    let reportTokenEditionBefore = await getProgramEdition("sealed_report_token");
    isUpgradeSuccessful = await upgradeProgram("sealance_freezelist_registry", adminPrivKey);
    let reportTokenEditionAfter = await getProgramEdition("sealed_report_token");
    expect(isUpgradeSuccessful).toBe(true);
    expect(reportTokenEditionBefore + 1).toBe(reportTokenEditionAfter);
    reportTokenEditionBefore = await getProgramEdition("sealed_report_token");
    isUpgradeSuccessful = await upgradeProgram("sealance_freezelist_registry", deployerPrivKey);
    reportTokenEditionAfter = await getProgramEdition("sealed_report_token");
    expect(isUpgradeSuccessful).toBe(false);
    expect(reportTokenEditionBefore).toBe(reportTokenEditionAfter);
  });
});
