import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { MAX_TREE_SIZE, ZERO_ADDRESS, fundedAmount, timeout } from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { buildTree, genLeaves } from "../lib/MerkleTree";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, freezedAccount, account] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const freezedAccountPrivKey = contract.getPrivateKey(freezedAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});

const freezeRegistryContractForFreezedAccount = new Sealance_freezelist_registryContract({
  mode,
  privateKey: freezedAccountPrivKey,
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
      await fundWithCredits(deployerPrivKey, freezedAccount, fundedAmount);
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
      let tx = await freezeRegistryContractForAdmin.update_admin_address(freezedAccount);
      await tx.wait();
      let adminRole = await freezeRegistryContract.admin(0);
      expect(adminRole).toBe(freezedAccount);

      tx = await freezeRegistryContractForFreezedAccount.update_admin_address(adminAddress);
      await tx.wait();
      adminRole = await freezeRegistryContract.admin(0);
      expect(adminRole).toBe(adminAddress);

      tx = await freezeRegistryContractForFreezedAccount.update_admin_address(freezedAccount);
      await expect(tx.wait()).rejects.toThrow();
    },
    timeout,
  );

  let adminMerkleProof;
  let freezedAccountMerkleProof;
  test(
    `generate merkle proofs`,
    async () => {
      const leaves = genLeaves([freezedAccount]);
      const tree = await buildTree(leaves);
      root = tree[tree.length - 1];
      const adminLeadIndices = getLeafIndices(tree, adminAddress);
      const freezedAccountLeadIndices = getLeafIndices(tree, freezedAccount);
      adminMerkleProof = [
        getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_SIZE),
      ];
      freezedAccountMerkleProof = [
        getSiblingPath(tree, freezedAccountLeadIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, freezedAccountLeadIndices[1], MAX_TREE_SIZE),
      ];
    },
    timeout,
  );

  test(
    `test update_freeze_list`,
    async () => {
      let rejectedTx = await freezeRegistryContractForFreezedAccount.update_freeze_list(adminAddress, true, 0, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await freezeRegistryContractForAdmin.update_freeze_list(freezedAccount, true, 0, root);
      await tx.wait();
      let isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
      let freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);

      expect(isAccountFreezed).toBe(true);
      expect(freezedAccountByIndex).toBe(freezedAccount);

      tx = await freezeRegistryContractForAdmin.update_freeze_list(freezedAccount, false, 0, root);
      await tx.wait();
      isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
      freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);

      expect(isAccountFreezed).toBe(false);
      expect(freezedAccountByIndex).toBe(ZERO_ADDRESS);

      tx = await freezeRegistryContractForAdmin.update_freeze_list(freezedAccount, true, 0, root);
      await tx.wait();
      isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
      freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);
      expect(isAccountFreezed).toBe(true);
      expect(freezedAccountByIndex).toBe(freezedAccount);
    },
    timeout,
  );
  test(
    `test update_block_height_window`,
    async () => {
      const rejectedTx = await freezeRegistryContractForFreezedAccount.update_block_height_window(300);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await freezeRegistryContractForAdmin.update_block_height_window(300);
      await tx.wait();
    },
    timeout,
  );

  test(
    `test verify_non_inclusion_pub`,
    async () => {
      const rejectedTx = await freezeRegistryContract.verify_non_inclusion_pub(freezedAccount);
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
        freezeRegistryContract.verify_non_inclusion_priv(freezedAccount, freezedAccountMerkleProof),
      ).rejects.toThrow();

      let tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
      await tx.wait();

      const updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(
        freezedAccount,
        false,
        0,
        1n, // fake root
      );
      await updateFreezeListTx.wait();

      const newRoot = await freezeRegistryContract.freeze_list_root(0);
      const oldRoot = await freezeRegistryContract.freeze_list_root(1);
      expect(oldRoot).toBe(root);
      expect(newRoot).toBe(1n);

      // The transaction succeed because the old root is match
      tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
      await tx.wait();

      const updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(1);
      await updateBlockHeightWindowTx.wait();

      // The transaction failed because the old root is expired
      const rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );
});
