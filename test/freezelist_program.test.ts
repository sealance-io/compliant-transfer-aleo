import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
  NONE_ROLE,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { buildTree, generateLeaves } from "@sealance-io/policy-engine-aleo";
import { Account } from "@provablehq/sdk";
import { isProgramInitialized } from "../lib/Initalize";
import { Freezelist_programContract } from "../artifacts/js/freezelist_program";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, , frozenAccount, , , , , , , freezeListManager] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const freezeListManagerPrivKey = contract.getPrivateKey(freezeListManager);

const freezeRegistryContract = new Freezelist_programContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Freezelist_programContract({
  mode,
  privateKey: adminPrivKey,
});
const freezeRegistryContractForFrozenAccount = new Freezelist_programContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const freezeRegistryContractForFreezeListManager = new Freezelist_programContract({
  mode,
  privateKey: freezeListManagerPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});

let root: bigint;

describe("test freeze_registry program", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezeListManager, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(multiSigContract);
    await deployIfNotDeployed(freezeRegistryContract);
  });

  let adminMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(`generate merkle proofs`, async () => {
    const leaves = generateLeaves([frozenAccount]);
    const tree = buildTree(leaves);
    root = tree[tree.length - 1];
    const adminLeadIndices = getLeafIndices(tree, adminAddress);
    const frozenAccountLeadIndices = getLeafIndices(tree, frozenAccount);
    adminMerkleProof = [
      getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_DEPTH),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeadIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, frozenAccountLeadIndices[1], MAX_TREE_DEPTH),
    ];
  });

  test(`test initialize`, async () => {
    const isFreezeRegistryInitialized = await isProgramInitialized(freezeRegistryContract);
    if (!isFreezeRegistryInitialized) {
      // Cannot update freeze list before initialization
      let rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, 0n, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      if (deployerAddress !== adminAddress) {
        // The caller is not the initial admin
        rejectedTx = await freezeRegistryContractForAdmin.initialize(adminAddress, BLOCK_HEIGHT_WINDOW);
        await expect(rejectedTx.wait()).rejects.toThrow();
      }

      const tx = await freezeRegistryContract.initialize(adminAddress, BLOCK_HEIGHT_WINDOW);
      await tx.wait();
      const isAccountFrozen = await freezeRegistryContract.freeze_list(ZERO_ADDRESS);
      const frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(0);
      const lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await freezeRegistryContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await freezeRegistryContract.address_to_role(adminAddress);

      expect(role).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
    }

    // It is possible to call to initialize only one time
    const rejectedTx = await freezeRegistryContract.initialize(adminAddress, BLOCK_HEIGHT_WINDOW);
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_manager_address`, async () => {
    // Manager cannot unassign himself from being a manager
    let rejectedTx = await freezeRegistryContractForAdmin.update_role(adminAddress, NONE_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContractForAdmin.update_role(frozenAccount, MANAGER_ROLE);
    await tx.wait();

    let role = await freezeRegistryContract.address_to_role(frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    tx = await freezeRegistryContractForAdmin.update_role(frozenAccount, NONE_ROLE);
    await tx.wait();
    role = await freezeRegistryContract.address_to_role(frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Only the manager can update the roles
    tx = await freezeRegistryContractForFrozenAccount.update_role(frozenAccount, MANAGER_ROLE);
    await expect(tx.wait()).rejects.toThrow();
  });

  test(`test update_freeze_list_manager`, async () => {
    let tx = await freezeRegistryContractForAdmin.update_role(freezeListManager, FREEZELIST_MANAGER_ROLE);
    await tx.wait();
    const freezeListManagerRole = await freezeRegistryContract.address_to_role(freezeListManager);
    expect(freezeListManagerRole).toBe(FREEZELIST_MANAGER_ROLE);

    tx = await freezeRegistryContractForFrozenAccount.update_role(frozenAccount, FREEZELIST_MANAGER_ROLE);
    await expect(tx.wait()).rejects.toThrow();
  });

  test(`test update_freeze_list`, async () => {
    const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the manager can call to update_freeze_list
    let rejectedTx = await freezeRegistryContractForFrozenAccount.update_freeze_list(
      adminAddress,
      true,
      1,
      currentRoot,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot update the root if the previous root is incorrect
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(frozenAccount, false, 1, 0n, root);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount, false);
    if (!isAccountFrozen) {
      // Cannot unfreeze an unfrozen account
      rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
        frozenAccount,
        false,
        1,
        currentRoot,
        root,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
        frozenAccount,
        true,
        1,
        currentRoot,
        root,
      );
      await tx.wait();
      isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
      let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);
    }

    // Cannot unfreeze an account when the frozen list index is incorrect
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      false,
      2,
      root,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot freeze a frozen account
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      true,
      1,
      root,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let randomAddress = new Account().address().to_string();
    let tx = await freezeRegistryContractForFreezeListManager.update_freeze_list(randomAddress, true, 2, root, root);
    await tx.wait();
    isAccountFrozen = await freezeRegistryContract.freeze_list(randomAddress);
    let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(2);
    let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = new Account().address().to_string();
    // Cannot freeze an account when the frozen list index is greater than the last index
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      10,
      root,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // Cannot freeze an account when the frozen list index is already taken
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      2,
      root,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_block_height_window`, async () => {
    const rejectedTx = await freezeRegistryContractForFrozenAccount.update_block_height_window(BLOCK_HEIGHT_WINDOW);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await freezeRegistryContractForFreezeListManager.update_block_height_window(BLOCK_HEIGHT_WINDOW);
    await tx.wait();
  });

  test(`test verify_non_inclusion_pub`, async () => {
    const rejectedTx = await freezeRegistryContract.verify_non_inclusion_pub(frozenAccount);
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await freezeRegistryContract.verify_non_inclusion_pub(adminAddress);
    await tx.wait();
  });

  test(`test verify_non_inclusion_priv`, async () => {
    await expect(
      freezeRegistryContract.verify_non_inclusion_priv(frozenAccount, frozenAccountMerkleProof),
    ).rejects.toThrow();

    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);

    const adminLeadIndices = getLeafIndices(tree, adminAddress);
    const emptyTreeAdminMerkleProof = [
      getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_DEPTH),
    ];
    // The transaction failed because the root is mismatch
    let rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, emptyTreeAdminMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await tx.wait();

    const updateFreezeListTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      false,
      1,
      root,
      emptyRoot,
    );
    await updateFreezeListTx.wait();

    const newRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await freezeRegistryContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(root);
    expect(newRoot).toBe(emptyRoot);

    // The transaction succeed because the old root is match
    tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await tx.wait();

    const updateBlockHeightWindowTx = await freezeRegistryContractForFreezeListManager.update_block_height_window(1);
    await updateBlockHeightWindowTx.wait();

    // The transaction failed because the old root is expired
    rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, emptyTreeAdminMerkleProof);
    await tx.wait();
  });
});
