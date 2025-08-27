import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/sealed_report_policy";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW_INDEX,
  COMPLIANT_TRANSFER_ADDRESS,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  INVESTIGATOR_INDEX,
  MAX_TREE_SIZE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  ZERO_ADDRESS,
  defaultAuthorizedUntil,
  emptyRoot,
  fundedAmount,
  policies,
  timeout,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import type { Token } from "../artifacts/js/types/token_registry";
import { Account } from "@provablehq/sdk";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

const { tokenId } = policies.compliant;

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, investigatorAddress, frozenAccount, account, recipient] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const investigatorPrivKey = contract.getPrivateKey(investigatorAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);

const tokenRegistryContract = new Token_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenRegistryContractForAdmin = new Token_registryContract({
  mode,
  privateKey: adminPrivKey,
});
const tokenRegistryContractForAccount = new Token_registryContract({
  mode,
  privateKey: accountPrivKey,
});
const compliantTransferContract = new Sealed_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantTransferContractForAdmin = new Sealed_report_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const compliantTransferContractForAccount = new Sealed_report_policyContract({
  mode,
  privateKey: accountPrivKey,
});
const compliantTransferContractForFrozenAccount = new Sealed_report_policyContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

const amount = 10n;
let root: bigint;

describe("test compliant_transfer program", () => {
  test(
    `fund credits`,
    async () => {
      await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
      await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
      await fundWithCredits(deployerPrivKey, account, fundedAmount);
    },
    timeout,
  );

  test(
    `deploy needed programs`,
    async () => {
      await deployIfNotDeployed(tokenRegistryContract);
      await deployIfNotDeployed(merkleTreeContract);
      //await deployIfNotDeployed(compliantTransferContract);

      /*const tx = await tokenRegistryContract.register_token(
              1n, // tokenId
              1n, // tokenId
              0n, // name
              6, // decimals
              1000_000000000000n, // max supply
              false,
              ZERO_ADDRESS,
            );
      await tx.wait();*/


      /*await initializeTokenProgram(
        deployerPrivKey,
        deployerAddress,
        adminPrivKey,
        adminAddress,
        investigatorAddress,
        policies.compliant,
      );*/
    },
    timeout,
  );
/*
  test(
    `test update_admin_address`,
    async () => {
      let tx = await compliantTransferContractForAdmin.update_role(frozenAccount, ADMIN_INDEX);
      await tx.wait();
      let adminRole = await compliantTransferContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(frozenAccount);

      tx = await compliantTransferContractForFrozenAccount.update_role(adminAddress, ADMIN_INDEX);
      await tx.wait();
      adminRole = await compliantTransferContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(adminAddress);

      tx = await compliantTransferContractForFrozenAccount.update_role(frozenAccount, ADMIN_INDEX);
      await expect(tx.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    `test update_investigator_address`,
    async () => {
      let tx = await compliantTransferContractForAdmin.update_role(frozenAccount, INVESTIGATOR_INDEX);
      await tx.wait();
      let investigatorRole = await compliantTransferContract.roles(INVESTIGATOR_INDEX);
      expect(investigatorRole).toBe(frozenAccount);

      tx = await compliantTransferContractForAdmin.update_role(investigatorAddress, INVESTIGATOR_INDEX);
      await tx.wait();
      investigatorRole = await compliantTransferContract.roles(INVESTIGATOR_INDEX);
      expect(investigatorRole).toBe(investigatorAddress);

      const rejectedTx = await compliantTransferContractForFrozenAccount.update_role(frozenAccount, INVESTIGATOR_INDEX);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );
*/
  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test(
    "fund tokens",
    async () => {
   /*   let mintPublicTx = await tokenRegistryContractForAdmin.mint_public(
        tokenId,
        account,
        amount * 20n,
        defaultAuthorizedUntil,
      );
      await mintPublicTx.wait();
      mintPublicTx = await tokenRegistryContractForAdmin.mint_public(
        tokenId,
        frozenAccount,
        amount * 20n,
        defaultAuthorizedUntil,
      );
      await mintPublicTx.wait();*/

      let mintPrivateTx = await tokenRegistryContract.mint_private(1n, adminAddress, amount * 20n, false, 0);
      const [encryptedAccountRecord] = await mintPrivateTx.wait();
      accountRecord = decryptToken(encryptedAccountRecord, adminPrivKey);

      let transferPrivateTx = await tokenRegistryContractForAdmin.transfer_private(account, amount * 20n, accountRecord);
      const [encryptedAccountRecord2] = await transferPrivateTx.wait();
      accountRecord = decryptToken(encryptedAccountRecord2, accountPrivKey);


     /* mintPrivateTx = await tokenRegistryContractForAdmin.mint_private(tokenId, frozenAccount, amount * 20n, true, 0);
      const [encryptedFrozenAccountRecord] = await mintPrivateTx.wait();
      frozenAccountRecord = decryptToken(encryptedFrozenAccountRecord, frozenAccountPrivKey);*/
    },
    timeout,
  );

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let recipientMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
/*  test(
    `generate merkle proofs`,
    async () => {
      const leaves = genLeaves([frozenAccount]);
      const tree = buildTree(leaves);
      root = tree[tree.length - 1];
      const senderLeafIndices = getLeafIndices(tree, account);
      const recipientLeafIndices = getLeafIndices(tree, recipient);
      const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount);
      senderMerkleProof = [
        getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE),
      ];
      recipientMerkleProof = [
        getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_SIZE),
      ];
      frozenAccountMerkleProof = [
        getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_SIZE),
      ];
    },
    timeout,
  );

  test(
    `verify compliant_transfer address`,
    async () => {
      expect(compliantTransferContract.address()).toBe(COMPLIANT_TRANSFER_ADDRESS);
    },
    timeout,
  );

  test(
    `test initialize`,
    async () => {
      // Cannot update freeze list before initialization
      let rejectedTx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, true, 1, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await compliantTransferContract.initialize(policies.compliant.blockHeightWindow);
      await tx.wait();
      const isAccountFrozen = await compliantTransferContract.freeze_list(ZERO_ADDRESS);
      const frozenAccountByIndex = await compliantTransferContract.freeze_list_index(0);
      const lastIndex = await compliantTransferContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await compliantTransferContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await compliantTransferContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);

      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(policies.compliant.blockHeightWindow);

      // It is possible to call to initialize only one time
      rejectedTx = await compliantTransferContract.initialize(policies.compliant.blockHeightWindow);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    `test update_freeze_list`,
    async () => {
      // Only the admin can call to update_freeze_list
      let rejectedTx = await compliantTransferContractForFrozenAccount.update_freeze_list(adminAddress, true, 1, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot unfreeze an unfrozen account
      rejectedTx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, false, 1, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, true, 1, root);
      await tx.wait();
      let isAccountFrozen = await compliantTransferContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await compliantTransferContract.freeze_list_index(1);
      let lastIndex = await compliantTransferContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);

      // Cannot unfreeze an account when the frozen list index is incorrect
      rejectedTx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, false, 2, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot freeze a frozen account
      rejectedTx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, true, 1, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      tx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, false, 1, root);
      await tx.wait();
      isAccountFrozen = await compliantTransferContract.freeze_list(frozenAccount);
      frozenAccountByIndex = await compliantTransferContract.freeze_list_index(1);
      lastIndex = await compliantTransferContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(1);

      tx = await compliantTransferContractForAdmin.update_freeze_list(frozenAccount, true, 1, root);
      await tx.wait();
      isAccountFrozen = await compliantTransferContract.freeze_list(frozenAccount);
      frozenAccountByIndex = await compliantTransferContract.freeze_list_index(1);
      lastIndex = await compliantTransferContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);

      let randomAddress = new Account().address().to_string();
      tx = await compliantTransferContractForAdmin.update_freeze_list(randomAddress, true, 2, root);
      await tx.wait();
      isAccountFrozen = await compliantTransferContractForAdmin.freeze_list(randomAddress);
      frozenAccountByIndex = await compliantTransferContractForAdmin.freeze_list_index(2);
      lastIndex = await compliantTransferContractForAdmin.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(randomAddress);
      expect(lastIndex).toBe(2);

      randomAddress = new Account().address().to_string();
      // Cannot freeze an account when the frozen list index is greater than the last index
      rejectedTx = await compliantTransferContractForAdmin.update_freeze_list(randomAddress, true, 10, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot freeze an account when the frozen list index is already taken
      rejectedTx = await compliantTransferContractForAdmin.update_freeze_list(randomAddress, true, 2, root);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    "token_registry calls should fail",
    async () => {
      const rejectedTx1 = await tokenRegistryContractForAccount.transfer_private_to_public(
        account,
        amount,
        accountRecord,
      );
      await expect(rejectedTx1.wait()).rejects.toThrow();

      const rejectedTx2 = await tokenRegistryContractForAccount.transfer_private(account, amount, accountRecord);
      await expect(rejectedTx2.wait()).rejects.toThrow();

      const rejectedTx3 = await tokenRegistryContractForAccount.transfer_public(tokenId, account, amount);
      await expect(rejectedTx3.wait()).rejects.toThrow();

      const rejectedTx4 = await tokenRegistryContractForAccount.transfer_public_as_signer(tokenId, account, amount);
      await expect(rejectedTx4.wait()).rejects.toThrow();

      const rejectedTx5 = await tokenRegistryContractForAccount.transfer_public_to_private(
        tokenId,
        account,
        amount,
        true,
      );
      await expect(rejectedTx5.wait()).rejects.toThrow();

      const tx = await tokenRegistryContractForAccount.approve_public(tokenId, account, amount);
      await tx.wait();

      const rejectedTx6 = await tokenRegistryContractForAccount.transfer_from_public(tokenId, account, account, amount);
      await expect(rejectedTx6.wait()).rejects.toThrow();

      const rejectedTx7 = await tokenRegistryContractForAccount.transfer_from_public_to_private(
        tokenId,
        account,
        account,
        amount,
        true,
      );
      await expect(rejectedTx7.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    `test update_block_height_window`,
    async () => {
      const rejectedTx = await compliantTransferContractForAccount.update_block_height_window(
        policies.compliant.blockHeightWindow,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await compliantTransferContractForAdmin.update_block_height_window(
        policies.compliant.blockHeightWindow,
      );
      await tx.wait();
    },
    timeout,
  );

  test(
    `test transfer_public`,
    async () => {
      // If the sender didn't approve the program the tx will fail
      let rejectedTx = await compliantTransferContractForAccount.transfer_public(recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const approvalTx = await tokenRegistryContractForAccount.approve_public(
        tokenId,
        compliantTransferContract.address(),
        amount,
      );
      await approvalTx.wait();

      // If the sender is frozen account it's impossible to send tokens
      rejectedTx = await compliantTransferContractForFrozenAccount.transfer_public(recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await compliantTransferContractForAccount.transfer_public(frozenAccount, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await compliantTransferContractForAccount.transfer_public(recipient, amount);
      await tx.wait();
    },
    timeout,
  );

  test(
    `test transfer_public_as_signer`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      let rejectedTx = await compliantTransferContractForFrozenAccount.transfer_public_as_signer(recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await compliantTransferContractForAccount.transfer_public_as_signer(frozenAccount, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await compliantTransferContractForAccount.transfer_public_as_signer(recipient, amount);

      await tx.wait();
    },
    timeout,
  );

  test(
    `test transfer_public_to_priv`,
    async () => {
      // If the sender didn't approve the program the tx will fail
      let rejectedTx = await compliantTransferContractForAccount.transfer_public_to_priv(
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const approvalTx = await tokenRegistryContractForAccount.approve_public(
        tokenId,
        compliantTransferContract.address(),
        amount,
      );
      await approvalTx.wait();

      // If the sender is frozen account it's impossible to send tokens
      rejectedTx = await compliantTransferContractForFrozenAccount.transfer_public_to_priv(
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      await expect(
        compliantTransferContractForAccount.transfer_public_to_priv(
          frozenAccount,
          amount,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      const tx = await compliantTransferContractForAccount.transfer_public_to_priv(
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      const [complianceRecord] = await tx.wait();
      const tokenRecord = (tx as any).transaction.execution.transitions[4].outputs[0].value;

      const recipientRecord = decryptToken(tokenRecord, recipientPrivKey);
      expect(recipientRecord.owner).toBe(recipient);
      expect(recipientRecord.amount).toBe(amount);
      expect(recipientRecord.token_id).toBe(tokenId);
      expect(recipientRecord.external_authorization_required).toBe(true);
      expect(recipientRecord.authorized_until).toBe(0);

      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(account);
      expect(decryptedComplianceRecord.recipient).toBe(recipient);
    },
    timeout,
  );

  test(
    `test transfer_private`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      await expect(
        compliantTransferContractForFrozenAccount.transfer_private(
          recipient,
          amount,
          accountRecord,
          frozenAccountMerkleProof,
          recipientMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();
      // If the recipient is frozen account it's impossible to send tokens
      await expect(
        compliantTransferContractForAccount.transfer_private(
          frozenAccount,
          amount,
          accountRecord,
          senderMerkleProof,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      const tx = await compliantTransferContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
      );
      const [complianceRecord] = await tx.wait();

      const previousAmount = accountRecord.amount;
      accountRecord = decryptToken((tx as any).transaction.execution.transitions[2].outputs[0].value, accountPrivKey);
      const recipientRecord = decryptToken(
        (tx as any).transaction.execution.transitions[3].outputs[1].value,
        recipientPrivKey,
      );
      expect(accountRecord.owner).toBe(account);
      expect(accountRecord.amount).toBe(previousAmount - amount);
      expect(accountRecord.token_id).toBe(tokenId);
      expect(accountRecord.external_authorization_required).toBe(true);
      expect(accountRecord.authorized_until).toBe(0);
      expect(recipientRecord.owner).toBe(recipient);
      expect(recipientRecord.amount).toBe(amount);
      expect(recipientRecord.token_id).toBe(tokenId);
      expect(recipientRecord.external_authorization_required).toBe(true);
      expect(recipientRecord.authorized_until).toBe(0);

      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(account);
      expect(decryptedComplianceRecord.recipient).toBe(recipient);
    },
    timeout,
  );

  test(
    `test transfer_priv_to_public`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      await expect(
        compliantTransferContractForFrozenAccount.transfer_priv_to_public(
          recipient,
          amount,
          frozenAccountRecord,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      const rejectedTx = await compliantTransferContractForAccount.transfer_priv_to_public(
        frozenAccount,
        amount,
        accountRecord,
        senderMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();
      const tx = await compliantTransferContractForAccount.transfer_priv_to_public(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        investigatorAddress,
      );
      const [complianceRecord] = await tx.wait();

      const previousAmount = accountRecord.amount;
      accountRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0].value, accountPrivKey);
      expect(accountRecord.owner).toBe(account);
      expect(accountRecord.amount).toBe(previousAmount - amount);
      expect(accountRecord.token_id).toBe(tokenId);
      expect(accountRecord.external_authorization_required).toBe(true);
      expect(accountRecord.authorized_until).toBe(0);

      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(account);
      expect(decryptedComplianceRecord.recipient).toBe(recipient);
    },
    timeout,
  );

  test(
    `test old root support`,
    async () => {
      const leaves = genLeaves([]);
      const tree = buildTree(leaves);
      const senderLeafIndices = getLeafIndices(tree, account);
      const recipientLeafIndices = getLeafIndices(tree, recipient);
      const IncorrectSenderMerkleProof = [
        getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE),
      ];
      const IncorrectRecipientMerkleProof = [
        getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_SIZE),
      ];
      // The transaction failed because the root is mismatch
      let rejectedTx = await compliantTransferContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        IncorrectSenderMerkleProof,
        IncorrectRecipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const updateFreezeListTx = await compliantTransferContractForAdmin.update_freeze_list(
        frozenAccount,
        false,
        1,
        1n, // fake root
      );
      await updateFreezeListTx.wait();

      const newRoot = await compliantTransferContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const oldRoot = await compliantTransferContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
      expect(oldRoot).toBe(root);
      expect(newRoot).toBe(1n);

      // The transaction succeed because the old root is match
      const tx = await compliantTransferContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
      );
      await tx.wait();
      accountRecord = decryptToken((tx as any).transaction.execution.transitions[2].outputs[0].value, accountPrivKey);

      const updateBlockHeightWindowTx = await compliantTransferContractForAdmin.update_block_height_window(1);
      await updateBlockHeightWindowTx.wait();

      // The transaction failed because the old root is expired
      rejectedTx = await compliantTransferContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );*/
});
