import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from '../contract/base-contract';
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/tqxftxoicd_v2";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { COMPLIANT_THRESHOLD_TRANSFER_ADDRESS, MAX_TREE_SIZE, ZERO_ADDRESS, defaultAuthorizedUntil, fundedAmount, timeout, tokenId, tokenName, tokenSymbol } from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { Compliant_threshold_transferContract } from "../artifacts/js/compliant_threshold_transfer";
import { Freeze_registryContract } from "../artifacts/js/freeze_registry";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, investigatorAddress, freezedAccount, account, recipient] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const investigatorPrivKey = contract.getPrivateKey(investigatorAddress);
const freezedAccountPrivKey = contract.getPrivateKey(freezedAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);

const tokenRegistryContract = new Token_registryContract({ mode, privateKey: adminPrivKey });
const tokenRegistryContractForAccount = new Token_registryContract({ mode, privateKey: accountPrivKey });
const compliantThresholdTransferContract = new Compliant_threshold_transferContract({ mode, privateKey: adminPrivKey });
const compliantThresholdTransferContractForAdmin = new Compliant_threshold_transferContract({ mode, privateKey: adminPrivKey });
const compliantThresholdTransferContractForAccount = new Compliant_threshold_transferContract({ mode, privateKey: accountPrivKey });
const compliantThresholdTransferContractForFreezedAccount = new Compliant_threshold_transferContract({ mode, privateKey: freezedAccountPrivKey });
const merkleTreeContract = new Rediwsozfo_v2Contract({ mode, privateKey: adminPrivKey });
const freezeRegistryContract = new Freeze_registryContract({ mode, privateKey: adminPrivKey });

const amount = 10n;
let root: bigint;

describe('test compliant_threshold_transfer program', () => {
  test(`fund credits`, async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezedAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
  }, timeout)

  test(`deploy needed programs`, async () => {
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(compliantThresholdTransferContract);
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminAddress, COMPLIANT_THRESHOLD_TRANSFER_ADDRESS);
  }, timeout);

  test(`test init_freeze_registry_name`, async () => {
    const tx = await compliantThresholdTransferContractForAdmin.init_freeze_registry_name();
    await tx.wait();
    const freezeRegistryName = await compliantThresholdTransferContract.freeze_registry_program_name(0);
    expect(freezeRegistryName).toBe(1);
  }, timeout);

  test(`test update_admin_address`, async () => {
    let tx = await compliantThresholdTransferContractForAdmin.update_admin_address(freezedAccount);
    await tx.wait();
    let adminRole = await compliantThresholdTransferContract.roles(1);
    expect(adminRole).toBe(freezedAccount);

    tx = await compliantThresholdTransferContractForFreezedAccount.update_admin_address(adminAddress);
    await tx.wait();
    adminRole = await compliantThresholdTransferContract.roles(1);
    expect(adminRole).toBe(adminAddress);

    tx = await compliantThresholdTransferContractForFreezedAccount.update_admin_address(freezedAccount);
    await expect(tx.wait()).rejects.toThrow();
  }, timeout);

  test(`test update_investigator_address`, async () => {
    let tx = await compliantThresholdTransferContractForAdmin.update_investigator_address(freezedAccount);
    await tx.wait()
    let investigatorRole = await compliantThresholdTransferContract.roles(2);
    expect(investigatorRole).toBe(freezedAccount);

    tx = await compliantThresholdTransferContractForAdmin.update_investigator_address(investigatorAddress);
    await tx.wait()
    investigatorRole = await compliantThresholdTransferContract.roles(2);
    expect(investigatorRole).toBe(investigatorAddress);

    let rejectedTx = await compliantThresholdTransferContractForFreezedAccount.update_investigator_address(freezedAccount);
    await expect(rejectedTx.wait()).rejects.toThrow();
  
  }, timeout);


  let accountRecord;
  let freezedAccountRecord;
  test('fund tokens', async () => {
    let mintPublicTx = await tokenRegistryContract.mint_public(
      tokenId,
      account,
      amount * 20n,
      defaultAuthorizedUntil
    );
    await mintPublicTx.wait();
    mintPublicTx = await tokenRegistryContract.mint_public(
      tokenId,
      freezedAccount,
      amount * 20n,
      defaultAuthorizedUntil
    );
    await mintPublicTx.wait();

    let mintPrivateTx = await tokenRegistryContract.mint_private(
      tokenId,
      account,
      amount * 20n,
      true,
      0
    );
    const [encryptedAccountRecord] = await mintPrivateTx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);

    mintPrivateTx = await tokenRegistryContract.mint_private(
      tokenId,
      freezedAccount,
      amount * 20n,
      true,
      0
    );
    const [encryptedFreezedAccountRecord] = await mintPrivateTx.wait();
    freezedAccountRecord = decryptToken(encryptedFreezedAccountRecord, freezedAccountPrivKey);
  }, timeout)

  let senderMerkleProof;
  let recipientMerkleProof;
  let freezedAccountMerkleProof;
  test(`generate merkle proofs`, async () => {
    const tx = await merkleTreeContract.build_tree([
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      freezedAccount,
    ]);
    const [tree] = await tx.wait();
    root = tree[14];
    const senderLeafIndices = getLeafIndices(tree, account);
    const recipientLeafIndices = getLeafIndices(tree, recipient);
    const freezedAccountLeafIndices = getLeafIndices(tree, freezedAccount);
    senderMerkleProof = [getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE), getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE)];
    recipientMerkleProof = [getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_SIZE), getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_SIZE)];
    freezedAccountMerkleProof = [getSiblingPath(tree, freezedAccountLeafIndices[0], MAX_TREE_SIZE), getSiblingPath(tree, freezedAccountLeafIndices[1], MAX_TREE_SIZE)];
  }, timeout);

  test(`verify compliant_transfer address`, async () => {
    expect(compliantThresholdTransferContract.address()).toBe(COMPLIANT_THRESHOLD_TRANSFER_ADDRESS)
  }, timeout);

  test(`freeze registry setup`, async () => {
    const tx = await freezeRegistryContract.update_admin_address(adminAddress);
    await tx.wait();
    let adminRole = await freezeRegistryContract.admin(0);
    expect(adminRole).toBe(adminAddress);

    const tx2 = await freezeRegistryContract.update_freeze_list(
      freezedAccount,
      true,
      0,
      root
    );
    await tx2.wait();
    let isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
    let freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);

    expect(isAccountFreezed).toBe(true);
    expect(freezedAccountByIndex).toBe(freezedAccount);
  }, timeout);

  test('token_registry calls should fail', async () => {
    const rejectedTx1 = await tokenRegistryContractForAccount.transfer_private_to_public(
      account,
      amount,
      accountRecord
    );
    await expect(rejectedTx1.wait()).rejects.toThrow();

    const rejectedTx2 = await tokenRegistryContractForAccount.transfer_private(
      account,
      amount,
      accountRecord
    );
    await expect(rejectedTx2.wait()).rejects.toThrow();

    const rejectedTx3 = await tokenRegistryContractForAccount.transfer_public(
      tokenId,
      account,
      amount,
    );
    await expect(rejectedTx3.wait()).rejects.toThrow();

    const rejectedTx4 = await tokenRegistryContractForAccount.transfer_public_as_signer(
      tokenId,
      account,
      amount,
    );
    await expect(rejectedTx4.wait()).rejects.toThrow();

    const rejectedTx5 = await tokenRegistryContractForAccount.transfer_public_to_private(
      tokenId,
      account,
      amount,
      true,
    );
    await expect(rejectedTx5.wait()).rejects.toThrow();

    const tx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      account,
      amount,
    );
    await tx.wait();

    const rejectedTx6 = await tokenRegistryContractForAccount.transfer_from_public(
      tokenId,
      account,
      account,
      amount
    );
    await expect(rejectedTx6.wait()).rejects.toThrow();

    const rejectedTx7 = await tokenRegistryContractForAccount.transfer_from_public_to_private(
      tokenId,
      account,
      account,
      amount,
      true
    );
    await expect(rejectedTx7.wait()).rejects.toThrow();
  }, timeout)

  test(`test transfer_public`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      compliantThresholdTransferContract.address(),
      amount
    );
    await approvalTx.wait();

    // If the sender is freezed account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForFreezedAccount.transfer_public(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public(
      freezedAccount,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantThresholdTransferContractForAccount.transfer_public(
      recipient,
      amount
    );
    await tx.wait();
  }, timeout)

  test(`test transfer_public_as_signer`, async () => {
    // If the sender is freezed account it's impossible to send tokens
    let rejectedTx = await compliantThresholdTransferContractForFreezedAccount.transfer_public_as_signer(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      freezedAccount,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantThresholdTransferContractForAccount.transfer_public_as_signer(
      recipient,
      amount
    );
    await tx.wait();
  }, timeout)

  test(`test transfer_public_to_priv`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantThresholdTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
      investigatorAddress
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      compliantThresholdTransferContract.address(),
      amount
    );
    await approvalTx.wait();

    // If the sender is freezed account it's impossible to send tokens
    rejectedTx = await compliantThresholdTransferContractForFreezedAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
      investigatorAddress
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    await expect(compliantThresholdTransferContractForAccount.transfer_public_to_priv(
      freezedAccount,
      amount,
      freezedAccountMerkleProof,
      investigatorAddress
    )).rejects.toThrow();

    const tx = await compliantThresholdTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
      investigatorAddress
    );

    const [complianceRecord] = await tx.wait();
    const tokenRecord = (tx as any).transaction.execution.transitions[6].outputs[0].value;

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
  }, timeout);

  test(`test transfer_private`, async () => {
    // If the sender is freezed account it's impossible to send tokens
    await expect(compliantThresholdTransferContractForFreezedAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      freezedAccountMerkleProof,
      recipientMerkleProof,
      investigatorAddress
    )).rejects.toThrow();
    // If the recipient is freezed account it's impossible to send tokens
    await expect(compliantThresholdTransferContractForAccount.transfer_private(
      freezedAccount,
      amount,
      accountRecord,
      senderMerkleProof,
      freezedAccountMerkleProof,
      investigatorAddress
    )).rejects.toThrow();

    const tx = await compliantThresholdTransferContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      recipientMerkleProof,
      investigatorAddress
    );
    const [complianceRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[4].outputs[0].value, accountPrivKey);
    const recipientRecord = decryptToken((tx as any).transaction.execution.transitions[5].outputs[1].value, recipientPrivKey);
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
  }, timeout)

  test(`test transfer_priv_to_public`, async () => {
    // If the sender is freezed account it's impossible to send tokens
    await expect(compliantThresholdTransferContractForFreezedAccount.transfer_priv_to_public(
      recipient,
      amount,
      freezedAccountRecord,
      freezedAccountMerkleProof,
      investigatorAddress
    )).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    let rejectedTx = await compliantThresholdTransferContractForAccount.transfer_priv_to_public(
      freezedAccount,
      amount,
      accountRecord,
      senderMerkleProof,
      investigatorAddress
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await compliantThresholdTransferContractForAccount.transfer_priv_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      investigatorAddress
    );
    const [complianceRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[3].outputs[0].value, accountPrivKey);
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
  }, timeout)
})