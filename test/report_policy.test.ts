import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/sealed_report_policy";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import {
  BLOCK_HEIGHT_WINDOW_INDEX,
  SEALED_REPORT_POLICY_ADDRESS,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  MAX_TREE_DEPTH,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  ZERO_ADDRESS,
  defaultAuthorizedUntil,
  emptyRoot,
  fundedAmount,
  policies,
  MANAGER_ROLE,
  NONE_ROLE,
  FREEZELIST_MANAGER_ROLE,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { registerTokenProgram } from "../lib/Token";
import { buildTree, generateLeaves } from "@sealance-io/policy-engine-aleo";
import type { Token } from "../artifacts/js/types/token_registry";
import { Account } from "@provablehq/sdk";
import { isProgramInitialized } from "../lib/Initalize";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

const { tokenId } = policies.report;

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [
  deployerAddress,
  adminAddress,
  investigatorAddress,
  frozenAccount,
  account,
  recipient,
  ,
  ,
  ,
  ,
  freezeListManager,
] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const investigatorPrivKey = contract.getPrivateKey(investigatorAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);
const freezeListManagerPrivKey = contract.getPrivateKey(freezeListManager);

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
const reportPolicyContract = new Sealed_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportPolicyContractForAdmin = new Sealed_report_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const reportPolicyContractForAccount = new Sealed_report_policyContract({
  mode,
  privateKey: accountPrivKey,
});
const reportPolicyContractForFrozenAccount = new Sealed_report_policyContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const reportPolicyContractForFreezeListManager = new Sealed_report_policyContract({
  mode,
  privateKey: freezeListManagerPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

const amount = 10n;
let root: bigint;

describe("test sealed_report_policy program", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezeListManager, fundedAmount);

    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(reportPolicyContract);

    await registerTokenProgram(deployerPrivKey, deployerAddress, adminAddress, policies.report);
  });

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test("fund tokens", async () => {
    let mintPublicTx = await tokenRegistryContractForAdmin.mint_public(
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
    await mintPublicTx.wait();

    let mintPrivateTx = await tokenRegistryContractForAdmin.mint_private(tokenId, account, amount * 20n, true, 0);
    const [encryptedAccountRecord] = await mintPrivateTx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);

    mintPrivateTx = await tokenRegistryContractForAdmin.mint_private(tokenId, frozenAccount, amount * 20n, true, 0);
    const [encryptedFrozenAccountRecord] = await mintPrivateTx.wait();
    frozenAccountRecord = decryptToken(encryptedFrozenAccountRecord, frozenAccountPrivKey);
  });

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let recipientMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(`generate merkle proofs`, async () => {
    const leaves = generateLeaves([frozenAccount]);
    const tree = buildTree(leaves);
    root = tree[tree.length - 1];
    const senderLeafIndices = getLeafIndices(tree, account);
    const recipientLeafIndices = getLeafIndices(tree, recipient);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount);
    senderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH),
    ];
    recipientMerkleProof = [
      getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_DEPTH),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH),
    ];
  });
  test(`verify sealed_report_policy address`, async () => {
    expect(reportPolicyContract.address()).toBe(SEALED_REPORT_POLICY_ADDRESS);
  });

  test(`test initialize`, async () => {
    const isFreezeRegistryInitialized = await isProgramInitialized(reportPolicyContract);
    if (!isFreezeRegistryInitialized) {
      // Cannot update freeze list before initialization
      let rejectedTx = await reportPolicyContractForAdmin.update_freeze_list(frozenAccount, true, 1, 0n, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      if (deployerAddress !== adminAddress) {
        // The caller is not the initial admin
        rejectedTx = await reportPolicyContract.initialize(adminAddress, policies.report.blockHeightWindow);
        await expect(rejectedTx.wait()).rejects.toThrow();
      }

      const tx = await reportPolicyContractForAdmin.initialize(adminAddress, policies.report.blockHeightWindow);
      await tx.wait();
      const isAccountFrozen = await reportPolicyContract.freeze_list(ZERO_ADDRESS);
      const frozenAccountByIndex = await reportPolicyContract.freeze_list_index(0);
      const lastIndex = await reportPolicyContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await reportPolicyContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await reportPolicyContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await reportPolicyContract.address_to_role(adminAddress);

      expect(role).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(policies.report.blockHeightWindow);

      // It is possible to call to initialize only one time
      rejectedTx = await reportPolicyContractForAdmin.initialize(adminAddress, policies.report.blockHeightWindow);
      await expect(rejectedTx.wait()).rejects.toThrow();
    }
  });

  test(`test update_role`, async () => {
    // Manager can assign role
    let tx = await reportPolicyContractForAdmin.update_role(frozenAccount, MANAGER_ROLE);
    await tx.wait();
    let role = await reportPolicyContract.address_to_role(frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    tx = await reportPolicyContractForAdmin.update_role(frozenAccount, NONE_ROLE);
    await tx.wait();
    role = await reportPolicyContract.address_to_role(frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    let rejectedTx = await reportPolicyContractForFrozenAccount.update_role(frozenAccount, MANAGER_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update freeze list manager role
    rejectedTx = await reportPolicyContractForFrozenAccount.update_role(freezeListManager, FREEZELIST_MANAGER_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager cannot unassign himself from being a manager
    rejectedTx = await reportPolicyContractForAdmin.update_role(adminAddress, NONE_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager can assign freeze list manager role
    tx = await reportPolicyContractForAdmin.update_role(freezeListManager, FREEZELIST_MANAGER_ROLE);
    await tx.wait();
    role = await reportPolicyContract.address_to_role(freezeListManager);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);
  });

  test(`test update_freeze_list`, async () => {
    const currentRoot = await reportPolicyContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the admin can call to update_freeze_list
    let rejectedTx = await reportPolicyContractForFrozenAccount.update_freeze_list(
      adminAddress,
      true,
      1,
      currentRoot,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot unfreeze an unfrozen account
    rejectedTx = await reportPolicyContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      false,
      1,
      currentRoot,
      root,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot update the root if the previous root is incorrect
    rejectedTx = await reportPolicyContractForFreezeListManager.update_freeze_list(frozenAccount, false, 1, 0n, root);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await reportPolicyContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      true,
      1,
      currentRoot,
      root,
    );
    await tx.wait();
    let isAccountFrozen = await reportPolicyContract.freeze_list(frozenAccount);
    let frozenAccountByIndex = await reportPolicyContract.freeze_list_index(1);
    let lastIndex = await reportPolicyContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(frozenAccount);
    expect(lastIndex).toBe(1);

    // Cannot unfreeze an account when the frozen list index is incorrect
    rejectedTx = await reportPolicyContractForFreezeListManager.update_freeze_list(frozenAccount, false, 2, root, root);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot freeze a frozen account
    rejectedTx = await reportPolicyContractForFreezeListManager.update_freeze_list(frozenAccount, true, 1, root, root);
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await reportPolicyContractForFreezeListManager.update_freeze_list(frozenAccount, false, 1, root, root);
    await tx.wait();
    isAccountFrozen = await reportPolicyContract.freeze_list(frozenAccount);
    frozenAccountByIndex = await reportPolicyContract.freeze_list_index(1);
    lastIndex = await reportPolicyContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(1);

    let randomAddress = new Account().address().to_string();
    tx = await reportPolicyContractForFreezeListManager.update_freeze_list(randomAddress, true, 1, root, root);
    await tx.wait();
    isAccountFrozen = await reportPolicyContract.freeze_list(randomAddress);
    frozenAccountByIndex = await reportPolicyContract.freeze_list_index(1);
    lastIndex = await reportPolicyContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = new Account().address().to_string();
    // Cannot freeze an account when the frozen list index is greater than the last index
    rejectedTx = await reportPolicyContractForFreezeListManager.update_freeze_list(randomAddress, true, 10, root, root);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot freeze an account when the frozen list index is already taken
    rejectedTx = await reportPolicyContractForFreezeListManager.update_freeze_list(randomAddress, true, 1, root, root);
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test("token_registry calls should fail", async () => {
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
  });

  test(`test update_block_height_window`, async () => {
    const rejectedTx = await reportPolicyContractForAccount.update_block_height_window(
      policies.report.blockHeightWindow,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await reportPolicyContractForFreezeListManager.update_block_height_window(
      policies.report.blockHeightWindow,
    );
    await tx.wait();
  });

  test(`test transfer_public`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await reportPolicyContractForAccount.transfer_public(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      reportPolicyContract.address(),
      amount,
    );
    await approvalTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await reportPolicyContractForFrozenAccount.transfer_public(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    rejectedTx = await reportPolicyContractForAccount.transfer_public(frozenAccount, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await reportPolicyContractForAccount.transfer_public(recipient, amount);
    await tx.wait();
  });

  test(`test transfer_public_as_signer`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    let rejectedTx = await reportPolicyContractForFrozenAccount.transfer_public_as_signer(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    rejectedTx = await reportPolicyContractForAccount.transfer_public_as_signer(frozenAccount, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await reportPolicyContractForAccount.transfer_public_as_signer(recipient, amount);

    await tx.wait();
  });

  test(`test transfer_public_to_priv`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await reportPolicyContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      reportPolicyContract.address(),
      amount,
    );
    await approvalTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await reportPolicyContractForFrozenAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    await expect(
      reportPolicyContractForAccount.transfer_public_to_priv(frozenAccount, amount, frozenAccountMerkleProof),
    ).rejects.toThrow();

    const tx = await reportPolicyContractForAccount.transfer_public_to_priv(recipient, amount, recipientMerkleProof);
    const [complianceRecord] = await tx.wait();
    const tokenRecord = (tx as any).transaction.execution.transitions[2].outputs[0].value;

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
  });

  test(`test transfer_private`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      reportPolicyContractForFrozenAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        frozenAccountMerkleProof,
        recipientMerkleProof,
      ),
    ).rejects.toThrow();
    // If the recipient is frozen account it's impossible to send tokens
    await expect(
      reportPolicyContractForAccount.transfer_private(
        frozenAccount,
        amount,
        accountRecord,
        senderMerkleProof,
        frozenAccountMerkleProof,
      ),
    ).rejects.toThrow();

    const tx = await reportPolicyContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      recipientMerkleProof,
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
  });

  test(`test transfer_priv_to_public`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      reportPolicyContractForFrozenAccount.transfer_priv_to_public(
        recipient,
        amount,
        frozenAccountRecord,
        frozenAccountMerkleProof,
      ),
    ).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    const rejectedTx = await reportPolicyContractForAccount.transfer_priv_to_public(
      frozenAccount,
      amount,
      accountRecord,
      senderMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await reportPolicyContractForAccount.transfer_priv_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
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
  });

  test(`test old root support`, async () => {
    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);
    const senderLeafIndices = getLeafIndices(tree, account);
    const recipientLeafIndices = getLeafIndices(tree, recipient);
    const emptyTreeSenderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH),
    ];
    const emptyTreeRecipientMerkleProof = [
      getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_DEPTH),
    ];
    // The transaction failed because the root is mismatch
    let rejectedTx = await reportPolicyContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      emptyTreeSenderMerkleProof,
      emptyTreeRecipientMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const updateFreezeListTx = await reportPolicyContractForAdmin.update_freeze_list(
      frozenAccount,
      false,
      1,
      root,
      emptyRoot,
    );
    await updateFreezeListTx.wait();

    const newRoot = await reportPolicyContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await reportPolicyContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(root);
    expect(newRoot).toBe(emptyRoot);

    // The transaction succeed because the old root is match
    let tx = await reportPolicyContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      recipientMerkleProof,
    );
    await tx.wait();
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[2].outputs[0].value, accountPrivKey);

    const updateBlockHeightWindowTx = await reportPolicyContractForAdmin.update_block_height_window(1);
    await updateBlockHeightWindowTx.wait();

    // The transaction failed because the old root is expired
    rejectedTx = await reportPolicyContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      recipientMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await reportPolicyContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      emptyTreeSenderMerkleProof,
      emptyTreeRecipientMerkleProof,
    );
    await tx.wait();
  });
});
