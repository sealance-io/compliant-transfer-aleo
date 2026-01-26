import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { BLOCK_HEIGHT_WINDOW, fundedAmount, MAX_BLOCK_HEIGHT } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { getDeployedProgramChecksum, getProgramEdition, upgradeProgram } from "../lib/Upgrade";
import { initializeProgram } from "../lib/Initalize";
import { ZERO_ADDRESS } from "@sealance-io/policy-engine-aleo";
import { approveRequest, createWallet, initializeMultisig } from "../lib/Multisig";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { Multisig_freezelist_registryContract } from "../artifacts/js/multisig_freezelist_registry";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, , , , , , , , , , , signer1, signer2] = contract.getAccounts();

const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const freezeRegistryContract = new Multisig_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Multisig_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});

describe("test upgradeability", () => {
  beforeAll(async () => {
    // Deploy the multisig programs
    await deployIfNotDeployed(multiSigContract);

    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer1, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer2, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);

    await initializeProgram(freezeRegistryContractForAdmin, [adminAddress, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS]);

    // Create the wallets
    await initializeMultisig();
    await createWallet(freezeRegistryContract.address());
  });

  test(`test upgrades`, async () => {
    // It shouldn't be possible to upgrade the merkle_Tree program
    const merkleTreeEditionBefore = await getProgramEdition("merkle_tree");
    let isUpgradeSuccessful = await upgradeProgram("merkle_tree", adminPrivKey);
    const merkleTreeEditionAfter = await getProgramEdition("merkle_tree");
    expect(isUpgradeSuccessful).toBe(false);
    expect(merkleTreeEditionBefore).toBe(merkleTreeEditionAfter);

    // Only The multisig can upgrade the freeze registry program
    // upgrade by a multisig request
    let freezeRegistryEditionBefore = await getProgramEdition("multisig_freezelist_registry");
    const checksum = await getDeployedProgramChecksum("multisig_freezelist_registry");
    const getSigningOpIdForDeployTx = await freezeRegistryContract.get_signing_op_id_for_deploy(
      checksum,
      freezeRegistryEditionBefore + 1,
    );
    const [signingOpId] = await getSigningOpIdForDeployTx.wait();
    const tx = await multiSigContract.initiate_signing_op(
      freezeRegistryContract.address(),
      signingOpId,
      MAX_BLOCK_HEIGHT,
    );
    await tx.wait();
    // The upgrade fail because the multisig request is not approved yet
    isUpgradeSuccessful = await upgradeProgram("multisig_freezelist_registry", adminPrivKey);
    let freezeRegistryTreeEditionAfter = await getProgramEdition("multisig_freezelist_registry");
    expect(isUpgradeSuccessful).toBe(false);
    expect(freezeRegistryEditionBefore).toBe(freezeRegistryTreeEditionAfter);

    await approveRequest(freezeRegistryContract.address(), signingOpId);

    isUpgradeSuccessful = await upgradeProgram("multisig_freezelist_registry", adminPrivKey);
    freezeRegistryTreeEditionAfter = await getProgramEdition("multisig_freezelist_registry");
    expect(isUpgradeSuccessful).toBe(true);
    expect(freezeRegistryEditionBefore + 1).toBe(freezeRegistryTreeEditionAfter);
  });
});
