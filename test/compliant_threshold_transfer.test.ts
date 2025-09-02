import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/sealed_report_policy";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  COMPLIANT_THRESHOLD_TRANSFER_ADDRESS,
  EPOCH,
  EPOCH_INDEX,
  FREEZE_REGISTRY_PROGRAM_INDEX,
  INVESTIGATOR_INDEX,
  MAX_TREE_SIZE,
  THRESHOLD,
  THRESHOLD_INDEX,
  defaultAuthorizedUntil,
  fundedAmount,
  policies,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { decryptTokenComplianceStateRecord } from "../artifacts/js/leo2js/sealed_threshold_report_policy";
import { getLatestBlockHeight } from "../lib/Block";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import type { Token } from "../artifacts/js/types/token_registry";
import type { TokenComplianceStateRecord } from "../artifacts/js/types/sealed_threshold_report_policy";
import { updateAdminRole } from "../lib/Role";
import { isProgramInitialized } from "../lib/Initalize";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

const { tokenId } = policies.threshold;
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
const compliantThresholdTransferContract = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantThresholdTransferContractForAdmin = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const compliantThresholdTransferContractForAccount = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: accountPrivKey,
});
const compliantThresholdTransferContractForFrozenAccount = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const compliantThresholdTransferContractForRecipient = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: recipientPrivKey,
});

const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});

const amount = 1n;
let root: bigint;

describe("test compliant_threshold_transfer program", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
    await fundWithCredits(deployerPrivKey, recipient, fundedAmount);

    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(compliantThresholdTransferContract);
    await initializeTokenProgram(
      deployerPrivKey,
      deployerAddress,
      adminPrivKey,
      adminAddress,
      investigatorAddress,
      policies.threshold,
    );
  });

  test(`test init_mappings`, async () => {
    const tx = await compliantThresholdTransferContractForAdmin.init_mappings();
    await tx.wait();
    const freezeRegistryName =
      await compliantThresholdTransferContract.freeze_registry_program_name(FREEZE_REGISTRY_PROGRAM_INDEX);
    expect(freezeRegistryName).toBe(531934507715736310883939492834865785n);
    const epoch = await compliantThresholdTransferContract.epoch(EPOCH_INDEX);
    expect(epoch).toBe(EPOCH);
    const threshold = await compliantThresholdTransferContract.threshold(THRESHOLD_INDEX);
    expect(threshold).toBe(THRESHOLD);
  });

  test(`test update_admin_address`, async () => {
    let tx = await compliantThresholdTransferContractForAdmin.update_role(frozenAccount, ADMIN_INDEX);
    await tx.wait();
    let adminRole = await compliantThresholdTransferContract.roles(ADMIN_INDEX);
    expect(adminRole).toBe(frozenAccount);

    tx = await compliantThresholdTransferContractForFrozenAccount.update_role(adminAddress, ADMIN_INDEX);
    await tx.wait();
    adminRole = await compliantThresholdTransferContract.roles(ADMIN_INDEX);
    expect(adminRole).toBe(adminAddress);

    tx = await compliantThresholdTransferContractForFrozenAccount.update_role(frozenAccount, ADMIN_INDEX);
    await expect(tx.wait()).rejects.toThrow();
  });

  test(`test update_investigator_address`, async () => {
    let tx = await compliantThresholdTransferContractForAdmin.update_role(frozenAccount, INVESTIGATOR_INDEX);
    await tx.wait();
    let investigatorRole = await compliantThresholdTransferContract.roles(INVESTIGATOR_INDEX);
    expect(investigatorRole).toBe(frozenAccount);

    tx = await compliantThresholdTransferContractForAdmin.update_role(investigatorAddress, INVESTIGATOR_INDEX);
    await tx.wait();
    investigatorRole = await compliantThresholdTransferContract.roles(INVESTIGATOR_INDEX);
    expect(investigatorRole).toBe(investigatorAddress);

    const rejectedTx = await compliantThresholdTransferContractForFrozenAccount.update_role(
      frozenAccount,
      INVESTIGATOR_INDEX,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_block_height_window`, async () => {
    // only the admin can call update the block height window
    const rejectedTx = await compliantThresholdTransferContractForFrozenAccount.update_block_height_window(
      policies.threshold.blockHeightWindow,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantThresholdTransferContractForAdmin.update_block_height_window(
      policies.threshold.blockHeightWindow,
    );
    await tx.wait();

    const blockHeightWindow = await compliantThresholdTransferContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
    expect(blockHeightWindow).toBe(policies.threshold.blockHeightWindow);
  });

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test("fund tokens", async () => {
    let mintPublicTx = await tokenRegistryContractForAdmin.mint_public(
      tokenId,
      account,
      amount * 20n + THRESHOLD,
      defaultAuthorizedUntil,
    );
    await mintPublicTx.wait();
    mintPublicTx = await tokenRegistryContractForAdmin.mint_public(
      tokenId,
      frozenAccount,
      amount * 20n + THRESHOLD,
      defaultAuthorizedUntil,
    );
    await mintPublicTx.wait();

    let mintPrivateTx = await tokenRegistryContractForAdmin.mint_private(
      tokenId,
      account,
      amount * 20n + THRESHOLD,
      true,
      0,
    );
    const [encryptedAccountRecord] = await mintPrivateTx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);

    mintPrivateTx = await tokenRegistryContractForAdmin.mint_private(
      tokenId,
      frozenAccount,
      amount * 20n + THRESHOLD,
      true,
      0,
    );
    const [encryptedFrozenAccountRecord] = await mintPrivateTx.wait();
    frozenAccountRecord = decryptToken(encryptedFrozenAccountRecord, frozenAccountPrivKey);
  });

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let recipientMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(`generate merkle proofs`, async () => {
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
  });

  test(`verify compliant_transfer address`, async () => {
    expect(compliantThresholdTransferContract.address()).toBe(COMPLIANT_THRESHOLD_TRANSFER_ADDRESS);
  });

  test(`freeze registry setup`, async () => {
    const isFreezeRegistryInitialized = await isProgramInitialized(freezeRegistryContract);
    if (!isFreezeRegistryInitialized) {
      const tx1 = await freezeRegistryContract.initialize(BLOCK_HEIGHT_WINDOW);
      await tx1.wait();
    }

    await updateAdminRole(freezeRegistryContractForAdmin, adminAddress);

    let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount, false);
    if (!isAccountFrozen) {
      const tx2 = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 0, root);
      await tx2.wait();
      const isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      const frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(0);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
    }

    const tx3 = await freezeRegistryContractForAdmin.update_block_height_window(300);
    await tx3.wait();
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

  let accountStateRecord: TokenComplianceStateRecord;
  let frozenAccountStateRecord: TokenComplianceStateRecord;
  test(`test signup`, async () => {
    const isAccountSigned = await compliantThresholdTransferContractForAccount.owned_state_record(account, false);
    expect(isAccountSigned).toBe(false);
    const isFrozenAccountSigned = await compliantThresholdTransferContractForAccount.owned_state_record(
      frozenAccount,
      false,
    );
    expect(isFrozenAccountSigned).toBe(false);
    let tx = await compliantThresholdTransferContractForAccount.signup();
    const [encryptedAccountStateRecord] = await tx.wait();
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountStateRecord, accountPrivKey);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(0n);
    expect(accountStateRecord.latest_block_height).toBe(0);
    tx = await compliantThresholdTransferContractForFrozenAccount.signup();
    const [encryptedFrozenAccountStateRecord] = await tx.wait();
    frozenAccountStateRecord = decryptTokenComplianceStateRecord(
      encryptedFrozenAccountStateRecord,
      frozenAccountPrivKey,
    );
    expect(frozenAccountStateRecord.owner).toBe(frozenAccount);
    expect(frozenAccountStateRecord.cumulative_amount_per_epoch).toBe(0n);
    expect(frozenAccountStateRecord.latest_block_height).toBe(0);

    // If the user have already signed the tx will fail
    tx = await compliantThresholdTransferContractForAccount.signup();
    await expect(tx.wait()).rejects.toThrow();
  });

  test(`test signup_and_transfer_private function`, async () => {
    let isAccountSigned = await compliantThresholdTransferContract.owned_state_record(recipient, false);
    expect(isAccountSigned).toBe(false);

    const mintPrivateTx = await tokenRegistryContractForAdmin.mint_private(tokenId, recipient, 2n * amount, true, 0);
    const [encryptedRecipientRecord] = await mintPrivateTx.wait();
    let recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);

    const latestBlockHeight = await getLatestBlockHeight();
    const tx = await compliantThresholdTransferContractForRecipient.signup_and_transfer_private(
      account,
      amount,
      recipientRecord,
      latestBlockHeight,
      senderMerkleProof,
      investigatorAddress,
    );
    const [complianceRecord, encryptedRecipientStateRecord] = await tx.wait();

    isAccountSigned = await compliantThresholdTransferContract.owned_state_record(recipient, false);
    expect(isAccountSigned).toBe(true);

    const recipientStateRecord = decryptTokenComplianceStateRecord(encryptedRecipientStateRecord, recipientPrivKey);
    expect(recipientStateRecord.owner).toBe(recipient);
    expect(recipientStateRecord.cumulative_amount_per_epoch).toBe(amount);
    expect(recipientStateRecord.latest_block_height).toBe(latestBlockHeight);

    const previousAmount = recipientRecord.amount;

    recipientRecord = decryptToken((tx as any).transaction.execution.transitions[3].outputs[0].value, recipientPrivKey);
    const accountRecord = decryptToken(
      (tx as any).transaction.execution.transitions[4].outputs[1].value,
      accountPrivKey,
    );

    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(amount);
    expect(accountRecord.token_id).toBe(tokenId);
    expect(accountRecord.external_authorization_required).toBe(true);
    expect(accountRecord.authorized_until).toBe(0);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.token_id).toBe(tokenId);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    if (recipientStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(recipient);
      expect(decryptedComplianceRecord.recipient).toBe(account);
    } else {
      expect(() => decryptComplianceRecord(complianceRecord, investigatorPrivKey)).toThrow();
    }

    // If the user have already signed the tx will fail
    const tx2 = await compliantThresholdTransferContractForRecipient.signup();
    await expect(tx2.wait()).rejects.toThrow();

    const tx3 = await compliantThresholdTransferContractForRecipient.signup_and_transfer_private(
      account,
      amount,
      recipientRecord,
      latestBlockHeight,
      senderMerkleProof,
      investigatorAddress,
    );
    await expect(tx3.wait()).rejects.toThrow();
  });

  test(`test state record behavior`, async () => {
    const latestBlockHeight1 = await getLatestBlockHeight();
    let transferPublicTx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      recipient,
      amount,
      accountStateRecord,
      latestBlockHeight1,
    );
    const [encryptedAccountRecord1] = await transferPublicTx.wait();
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord1, accountPrivKey);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(amount);
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight1);

    const latestBlockHeight2 = await getLatestBlockHeight();
    let transferPrivateTx = await compliantThresholdTransferContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      accountStateRecord,
      latestBlockHeight2,
      senderMerkleProof,
      recipientMerkleProof,
      investigatorAddress,
    );
    const [complianceRecord1, encryptedAccountRecord2] = await transferPrivateTx.wait();
    expect(() => decryptComplianceRecord(complianceRecord1, investigatorPrivKey)).toThrow();

    accountRecord = decryptToken(
      (transferPrivateTx as any).transaction.execution.transitions[4].outputs[0].value,
      accountPrivKey,
    );
    let isTheSameEpoch = Math.floor(latestBlockHeight2 / EPOCH) === Math.floor(latestBlockHeight1 / EPOCH);
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord2, accountPrivKey);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(isTheSameEpoch ? amount * 2n : amount);
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight2);

    let updateBlockHeightWindowTx = await compliantThresholdTransferContractForAdmin.update_block_height_window(0);
    await updateBlockHeightWindowTx.wait();

    // the transaction will reject because the estimated block height is too low
    transferPublicTx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      recipient,
      amount,
      accountStateRecord,
      latestBlockHeight2 + 1,
    );
    await expect(transferPublicTx.wait()).rejects.toThrow();

    updateBlockHeightWindowTx = await compliantThresholdTransferContractForAdmin.update_block_height_window(
      policies.threshold.blockHeightWindow,
    );
    await updateBlockHeightWindowTx.wait();

    const latestBlockHeight3 = await getLatestBlockHeight();
    transferPrivateTx = await compliantThresholdTransferContractForAccount.transfer_private(
      recipient,
      THRESHOLD + amount,
      accountRecord,
      accountStateRecord,
      latestBlockHeight3,
      senderMerkleProof,
      recipientMerkleProof,
      investigatorAddress,
    );
    const [complianceRecord2, encryptedAccountRecord3] = await transferPrivateTx.wait();
    accountRecord = decryptToken(
      (transferPrivateTx as any).transaction.execution.transitions[4].outputs[0].value,
      accountPrivKey,
    );

    isTheSameEpoch = Math.floor(latestBlockHeight3 / EPOCH) === Math.floor(latestBlockHeight2 / EPOCH);
    const previousCumulativeAmount = accountStateRecord.cumulative_amount_per_epoch;
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord3, accountPrivKey);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? previousCumulativeAmount + THRESHOLD + amount : THRESHOLD + amount,
    );
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight3);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord2, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(THRESHOLD + amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  });

  test(`test transfer_public`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public(
      recipient,
      amount,
      accountStateRecord,
      await getLatestBlockHeight(),
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      compliantThresholdTransferContract.address(),
      amount,
    );

    await approvalTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForFrozenAccount.transfer_public(
      recipient,
      amount,
      frozenAccountStateRecord,
      await getLatestBlockHeight(),
    );

    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public(
      frozenAccount,
      amount,
      accountStateRecord,
      await getLatestBlockHeight(),
    );

    // If the estimated block height is too low the transaction will fail
    await expect(
      compliantThresholdTransferContractForAccount.transfer_public(account, amount, accountStateRecord, 0),
    ).rejects.toThrow();

    // If the estimated block height is too high the transaction will fail
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public(
      account,
      amount,
      accountStateRecord,
      (await getLatestBlockHeight()) + 50,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const latestBlockHeight = await getLatestBlockHeight();
    const tx = await compliantThresholdTransferContractForAccount.transfer_public(
      recipient,
      amount,
      accountStateRecord,
      latestBlockHeight,
    );
    const [encryptedAccountRecord] = await tx.wait();
    const latestBlockHeightBefore = accountStateRecord.latest_block_height;
    const cumulativeAmountBefore = accountStateRecord.cumulative_amount_per_epoch;
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord, accountPrivKey);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight);
  });

  test(`test transfer_public_as_signer`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    let rejectedTx = await compliantThresholdTransferContractForFrozenAccount.transfer_public_as_signer(
      recipient,
      amount,
      frozenAccountStateRecord,
      await getLatestBlockHeight(),
    );

    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      frozenAccount,
      amount,
      accountStateRecord,
      await getLatestBlockHeight(),
    );

    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the estimated block height is too low the transaction will fail
    await expect(
      compliantThresholdTransferContractForAccount.transfer_public_as_signer(account, amount, accountStateRecord, 0),
    ).rejects.toThrow();

    // If the estimated block height is too high the transaction will fail
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      account,
      amount,
      accountStateRecord,
      (await getLatestBlockHeight()) + 50,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const latestBlockHeight = await getLatestBlockHeight();
    const tx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      recipient,
      amount,
      accountStateRecord,
      latestBlockHeight,
    );
    const [encryptedAccountRecord] = await tx.wait();
    const latestBlockHeightBefore = accountStateRecord.latest_block_height;
    const cumulativeAmountBefore = accountStateRecord.cumulative_amount_per_epoch;
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord, accountPrivKey);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight);
  });

  test(`test transfer_public_to_priv`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      accountStateRecord,
      await getLatestBlockHeight(),
      recipientMerkleProof,
      investigatorAddress,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      compliantThresholdTransferContract.address(),
      amount,
    );

    await approvalTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForFrozenAccount.transfer_public_to_priv(
      recipient,
      amount,
      frozenAccountStateRecord,
      await getLatestBlockHeight(),
      recipientMerkleProof,
      investigatorAddress,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    await expect(
      compliantThresholdTransferContractForAccount.transfer_public_to_priv(
        frozenAccount,
        amount,
        accountStateRecord,
        await getLatestBlockHeight(),
        frozenAccountMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();

    // If the estimated block height is too low the transaction will fail
    await expect(
      compliantThresholdTransferContractForAccount.transfer_public_to_priv(
        recipient,
        amount,
        accountStateRecord,
        0,
        frozenAccountMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();

    // If the estimated block height is too high the transaction will fail
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      accountStateRecord,
      (await getLatestBlockHeight()) + 50,
      recipientMerkleProof,
      investigatorAddress,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const latestBlockHeight = await getLatestBlockHeight();
    const tx = await compliantThresholdTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      accountStateRecord,
      latestBlockHeight,
      recipientMerkleProof,
      investigatorAddress,
    );

    const [complianceRecord, encryptedAccountRecord] = await tx.wait();

    const latestBlockHeightBefore = accountStateRecord.latest_block_height;
    const cumulativeAmountBefore = accountStateRecord.cumulative_amount_per_epoch;
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord, accountPrivKey);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight);

    const tokenRecord = (tx as any).transaction.execution.transitions[6].outputs[0].value;
    const recipientRecord = decryptToken(tokenRecord, recipientPrivKey);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);
    expect(recipientRecord.token_id).toBe(tokenId);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    if (accountStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(account);
      expect(decryptedComplianceRecord.recipient).toBe(recipient);
    } else {
      expect(() => decryptComplianceRecord(complianceRecord, investigatorPrivKey)).toThrow();
    }
  });

  test(`test transfer_private`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      compliantThresholdTransferContractForFrozenAccount.transfer_private(
        recipient,
        amount,
        frozenAccountRecord,
        frozenAccountStateRecord,
        await getLatestBlockHeight(),
        frozenAccountMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();
    // If the recipient is frozen account it's impossible to send tokens
    await expect(
      compliantThresholdTransferContractForAccount.transfer_private(
        frozenAccount,
        amount,
        accountRecord,
        accountStateRecord,
        await getLatestBlockHeight(),
        senderMerkleProof,
        frozenAccountMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();

    // If the estimated block height is too low the transaction will fail
    await expect(
      compliantThresholdTransferContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        accountStateRecord,
        0,
        senderMerkleProof,
        frozenAccountMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();

    // If the estimated block height is too high the transaction will fail
    const rejectedTx = await compliantThresholdTransferContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      accountStateRecord,
      (await getLatestBlockHeight()) + 50,
      senderMerkleProof,
      recipientMerkleProof,
      investigatorAddress,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const latestBlockHeight = await getLatestBlockHeight();
    const tx = await compliantThresholdTransferContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      accountStateRecord,
      latestBlockHeight,
      senderMerkleProof,
      recipientMerkleProof,
      investigatorAddress,
    );
    const [complianceRecord, encryptedAccountRecord] = await tx.wait();

    const latestBlockHeightBefore = accountStateRecord.latest_block_height;
    const cumulativeAmountBefore = accountStateRecord.cumulative_amount_per_epoch;
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord, accountPrivKey);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight);

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[4].outputs[0].value, accountPrivKey);
    const recipientRecord = decryptToken(
      (tx as any).transaction.execution.transitions[5].outputs[1].value,
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

    if (accountStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(account);
      expect(decryptedComplianceRecord.recipient).toBe(recipient);
    } else {
      expect(() => decryptComplianceRecord(complianceRecord, investigatorPrivKey)).toThrow();
    }
  });

  test(`test transfer_priv_to_public`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      compliantThresholdTransferContractForFrozenAccount.transfer_priv_to_public(
        recipient,
        amount,
        frozenAccountRecord,
        accountStateRecord,
        await getLatestBlockHeight(),
        frozenAccountMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    let rejectedTx = await compliantThresholdTransferContractForAccount.transfer_priv_to_public(
      frozenAccount,
      amount,
      accountRecord,
      accountStateRecord,
      await getLatestBlockHeight(),
      senderMerkleProof,
      investigatorAddress,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the estimated block height is too low the transaction will fail
    await expect(
      compliantThresholdTransferContractForAccount.transfer_priv_to_public(
        recipient,
        amount,
        accountRecord,
        accountStateRecord,
        0,
        senderMerkleProof,
        investigatorAddress,
      ),
    ).rejects.toThrow();

    // If the estimated block height is too high the transaction will fail
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_priv_to_public(
      recipient,
      amount,
      accountRecord,
      accountStateRecord,
      (await getLatestBlockHeight()) + 50,
      senderMerkleProof,
      investigatorAddress,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const latestBlockHeight = await getLatestBlockHeight();
    const tx = await compliantThresholdTransferContractForAccount.transfer_priv_to_public(
      recipient,
      amount,
      accountRecord,
      accountStateRecord,
      latestBlockHeight,
      senderMerkleProof,
      investigatorAddress,
    );
    const [complianceRecord, encryptedAccountRecord] = await tx.wait();

    const latestBlockHeightBefore = accountStateRecord.latest_block_height;
    const cumulativeAmountBefore = accountStateRecord.cumulative_amount_per_epoch;
    accountStateRecord = decryptTokenComplianceStateRecord(encryptedAccountRecord, accountPrivKey);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(accountStateRecord.owner).toBe(account);
    expect(accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(accountStateRecord.latest_block_height).toBe(latestBlockHeight);

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[3].outputs[0].value, accountPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(accountRecord.token_id).toBe(tokenId);
    expect(accountRecord.external_authorization_required).toBe(true);
    expect(accountRecord.authorized_until).toBe(0);

    if (accountStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
      expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(account);
      expect(decryptedComplianceRecord.recipient).toBe(recipient);
    } else {
      expect(() => decryptComplianceRecord(complianceRecord, investigatorPrivKey)).toThrow();
    }
  });
});
