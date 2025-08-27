import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { ADMIN_INDEX, fundedAmount } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { getProgramEdition, upgradeProgram } from "../lib/Upgrade";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

describe("test compliant_transfer program", () => {

  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
  });

  test(
    `test upgrades`,
    async () => {
      // It shouldn't be possible to upgrade the merkle_Tree program
      const merkleTreeEditionBefore = await getProgramEdition("merkle_tree");
      let isUpgradeSuccessful = await upgradeProgram("merkle_tree", adminPrivKey);
      const merkleTreeEditionAfter = await getProgramEdition("merkle_tree");
      expect(isUpgradeSuccessful).toBe(false);
      expect(merkleTreeEditionBefore).toBe(merkleTreeEditionAfter);

      let freezeRegistryEditionBefore = await getProgramEdition("sealance_freezelist_registry");
      isUpgradeSuccessful = await upgradeProgram("sealance_freezelist_registry", adminPrivKey);
      let freezeRegistryTreeEditionAfter = await getProgramEdition("sealance_freezelist_registry");
      expect(isUpgradeSuccessful).toBe(true);
      expect(freezeRegistryEditionBefore + 1).toBe(freezeRegistryTreeEditionAfter);

      const admin = await freezeRegistryContract.roles(ADMIN_INDEX, deployerAddress);
      if (admin !== adminAddress) {
        const tx = await freezeRegistryContract.update_role(adminAddress, ADMIN_INDEX);
        await tx.wait();
      }
      // only the admin should be able to upgrade freeze registry program
      freezeRegistryEditionBefore = await getProgramEdition("sealance_freezelist_registry");
      isUpgradeSuccessful = await upgradeProgram("sealance_freezelist_registry", deployerPrivKey);
      freezeRegistryTreeEditionAfter = await getProgramEdition("sealance_freezelist_registry");
      expect(isUpgradeSuccessful).toBe(false);
      expect(freezeRegistryEditionBefore).toBe(freezeRegistryTreeEditionAfter);
    },
  );
});
