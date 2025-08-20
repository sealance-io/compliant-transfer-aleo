import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  MAX_TREE_SIZE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
  timeout,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import { Account } from "@provablehq/sdk";
import { isProgramInitialized } from "../lib/Initalize";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, frozenAccount, account] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});

const freezeRegistryContractForFrozenAccount = new Sealance_freezelist_registryContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

let root: bigint;

describe("test freeze_registry program", () => {
  test(
    `fund credits`,
    async () => {
      await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
      await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    },
    timeout,
  );

  test(
    `deploy needed programs`,
    async () => {
      await deployIfNotDeployed(merkleTreeContract);
      await deployIfNotDeployed(freezeRegistryContract);
    },
    timeout,
  );

  test(
    `test update_admin_address`,
    async () => {
      let tx = await freezeRegistryContractForAdmin.update_role(frozenAccount, ADMIN_INDEX);
      await tx.wait();
      let adminRole = await freezeRegistryContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(frozenAccount);

      tx = await freezeRegistryContractForFrozenAccount.update_role(adminAddress, ADMIN_INDEX);
      await tx.wait();
      adminRole = await freezeRegistryContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(adminAddress);

      tx = await freezeRegistryContractForFrozenAccount.update_role(frozenAccount, ADMIN_INDEX);
      await expect(tx.wait()).rejects.toThrow();
    },
    timeout,
  );

  let adminMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(
    `generate merkle proofs`,
    async () => {
      const leaves = genLeaves([frozenAccount]);
      const tree = buildTree(leaves);
      root = tree[tree.length - 1];
      const adminLeadIndices = getLeafIndices(tree, adminAddress);
      const frozenAccountLeadIndices = getLeafIndices(tree, frozenAccount);
      adminMerkleProof = [
        getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_SIZE),
      ];
      frozenAccountMerkleProof = [
        getSiblingPath(tree, frozenAccountLeadIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, frozenAccountLeadIndices[1], MAX_TREE_SIZE),
      ];
    },
    timeout,
  );

  test(
    `test initialize`,
    async () => {
      const isFreezeRegistryInitialized = await isProgramInitialized(freezeRegistryContract);
      if (!isFreezeRegistryInitialized) {
        // Cannot update freeze list before initialization
        const rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, 0n, root);
        await expect(rejectedTx.wait()).rejects.toThrow();

        const tx = await freezeRegistryContract.initialize(BLOCK_HEIGHT_WINDOW);
        await tx.wait();
        const isAccountFrozen = await freezeRegistryContract.freeze_list(ZERO_ADDRESS);
        const frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(0);
        const lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
        const initializedRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
        const blockHeightWindow = await freezeRegistryContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);

        expect(isAccountFrozen).toBe(false);
        expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
        expect(lastIndex).toBe(0);
        expect(initializedRoot).toBe(emptyRoot);
        expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
      }

      // It is possible to call to initialize only one time
      const rejectedTx = await freezeRegistryContract.initialize(BLOCK_HEIGHT_WINDOW);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    `test update_freeze_list`,
    async () => {
      const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

      // Only the admin can call to update_freeze_list
      let rejectedTx = await freezeRegistryContractForFrozenAccount.update_freeze_list(
        adminAddress,
        true,
        1,
        currentRoot,
        root,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot update the root if the previous root is incorrect
      rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, false, 1, 0n, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount, false);
      if (!isAccountFrozen) {
        // Cannot unfreeze an unfrozen account
        rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(
          frozenAccount,
          false,
          1,
          currentRoot,
          root,
        );
        await expect(rejectedTx.wait()).rejects.toThrow();

        let tx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, currentRoot, root);
        await tx.wait();
        isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
        let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
        let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

        expect(isAccountFrozen).toBe(true);
        expect(frozenAccountByIndex).toBe(frozenAccount);
        expect(lastIndex).toBe(1);
      }

      // Cannot unfreeze an account when the frozen list index is incorrect
      rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, false, 2, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot freeze a frozen account
      rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, false, 1, root, root);
      await tx.wait();
      isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
      let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(1);

      tx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, root, root);
      await tx.wait();
      isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
      lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);

      let randomAddress = new Account().address().to_string();
      tx = await freezeRegistryContractForAdmin.update_freeze_list(randomAddress, true, 2, root, root);
      await tx.wait();
      isAccountFrozen = await freezeRegistryContract.freeze_list(randomAddress);
      frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(2);
      lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(randomAddress);
      expect(lastIndex).toBe(2);

      randomAddress = new Account().address().to_string();
      // Cannot freeze an account when the frozen list index is greater than the last index
      rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(randomAddress, true, 10, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();
      // Cannot freeze an account when the frozen list index is already taken
      rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(randomAddress, true, 2, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );
  test(
    `test update_block_height_window`,
    async () => {
      const rejectedTx = await freezeRegistryContractForFrozenAccount.update_block_height_window(BLOCK_HEIGHT_WINDOW);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await freezeRegistryContractForAdmin.update_block_height_window(BLOCK_HEIGHT_WINDOW);
      await tx.wait();
    },
    timeout,
  );

  test(
    `test verify_non_inclusion_pub`,
    async () => {
      const rejectedTx = await freezeRegistryContract.verify_non_inclusion_pub(frozenAccount);
      await expect(rejectedTx.wait()).rejects.toThrow();
      const tx = await freezeRegistryContract.verify_non_inclusion_pub(adminAddress);
      await tx.wait();
    },
    timeout,
  );

  test(
    `test verify_non_inclusion_priv`,
    async () => {
      await expect(
        freezeRegistryContract.verify_non_inclusion_priv(frozenAccount, frozenAccountMerkleProof),
      ).rejects.toThrow();

      const leaves = genLeaves([]);
      const tree = buildTree(leaves);
      const adminLeadIndices = getLeafIndices(tree, adminAddress);
      const IncorrectAdminMerkleProof = [
        getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_SIZE),
      ];
      // The transaction failed because the root is mismatch
      let rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, IncorrectAdminMerkleProof);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
      await tx.wait();

      const updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(
        frozenAccount,
        false,
        1,
        root,
        1n, // fake root
      );
      await updateFreezeListTx.wait();

      const newRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const oldRoot = await freezeRegistryContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
      expect(oldRoot).toBe(root);
      expect(newRoot).toBe(1n);

      // The transaction succeed because the old root is match
      tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
      await tx.wait();

      const updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(1);
      await updateBlockHeightWindowTx.wait();

      // The transaction failed because the old root is expired
      rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );
});
