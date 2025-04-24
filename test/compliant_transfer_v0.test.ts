import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from '../contract/base-contract';
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/tqxftxoicd_v2";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { COMPLIANT_TRANSFER_ADDRESS, MAX_TREE_SIZE, ZERO_ADDRESS, defaultAuthorizedUntil, fundedAmount, policies, timeout } from "../lib/Constants";
import { getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { buildTree, genLeaves } from "../lib/MerkleTree";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

const { tokenId } = policies.compliant

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
const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode, privateKey: adminPrivKey });
const compliantTransferContractForAdmin = new Tqxftxoicd_v2Contract({ mode, privateKey: adminPrivKey });
const compliantTransferContractForAccount = new Tqxftxoicd_v2Contract({ mode, privateKey: accountPrivKey });
const compliantTransferContractForFreezedAccount = new Tqxftxoicd_v2Contract({ mode, privateKey: freezedAccountPrivKey });
const merkleTreeContract = new Rediwsozfo_v2Contract({ mode, privateKey: adminPrivKey });

const amount = 10n;
let root: bigint;

describe('test compliant_transfer program', () => {
  test(`fund credits`, async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezedAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
  }, timeout)

  test(`deploy needed programs`, async () => {
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);
    
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.compliant);

  }, timeout);

  test(`test update_admin_address`, async () => {
    let tx = await compliantTransferContractForAdmin.update_admin_address(freezedAccount);
    await tx.wait();
    let adminRole = await compliantTransferContract.roles(1);
    expect(adminRole).toBe(freezedAccount);

    tx = await compliantTransferContractForFreezedAccount.update_admin_address(adminAddress);
    await tx.wait();
    adminRole = await compliantTransferContract.roles(1);
    expect(adminRole).toBe(adminAddress);

    tx = await compliantTransferContractForFreezedAccount.update_admin_address(freezedAccount);
    await expect(tx.wait()).rejects.toThrow();
  }, timeout);

  test(`test update_investigator_address`, async () => {
    let tx = await compliantTransferContractForAdmin.update_investigator_address(freezedAccount);
    await tx.wait()
    let investigatorRole = await compliantTransferContract.roles(2);
    expect(investigatorRole).toBe(freezedAccount);

    tx = await compliantTransferContractForAdmin.update_investigator_address(investigatorAddress);
    await tx.wait()
    investigatorRole = await compliantTransferContract.roles(2);
    expect(investigatorRole).toBe(investigatorAddress);

    let rejectedTx = await compliantTransferContractForFreezedAccount.update_investigator_address(freezedAccount);
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
    const leaves = genLeaves([freezedAccount])
    const tree = await buildTree(leaves);
    root = tree[14];
    senderMerkleProof = [getSiblingPath(tree, 6, MAX_TREE_SIZE), getSiblingPath(tree, 7, MAX_TREE_SIZE)];
    recipientMerkleProof = [getSiblingPath(tree, 7, MAX_TREE_SIZE), getSiblingPath(tree, 7, MAX_TREE_SIZE)];
    freezedAccountMerkleProof = [getSiblingPath(tree, 7, MAX_TREE_SIZE), getSiblingPath(tree, 7, MAX_TREE_SIZE)];
  }, timeout);

  test(`verify compliant_transfer address`, async () => {
    expect(compliantTransferContract.address()).toBe(COMPLIANT_TRANSFER_ADDRESS)
  }, timeout);

  test(`test update_freeze_list`, async () => {
    let rejectedTx = await compliantTransferContractForFreezedAccount.update_freeze_list(
      adminAddress,
      true,
      0,
      root
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await compliantTransferContractForAdmin.update_freeze_list(
      freezedAccount,
      true,
      0,
      root
    );
    await tx.wait();
    let isAccountFreezed = await compliantTransferContract.freeze_list(freezedAccount);
    let freezedAccountByIndex = await compliantTransferContract.freeze_list_index(0);

    expect(isAccountFreezed).toBe(true);
    expect(freezedAccountByIndex).toBe(freezedAccount);

    tx = await compliantTransferContractForAdmin.update_freeze_list(
      freezedAccount,
      false,
      0,
      root
    );
    await tx.wait();
    isAccountFreezed = await compliantTransferContract.freeze_list(freezedAccount);
    freezedAccountByIndex = await compliantTransferContract.freeze_list_index(0);

    expect(isAccountFreezed).toBe(false);
    expect(freezedAccountByIndex).toBe(ZERO_ADDRESS);

    tx = await compliantTransferContractForAdmin.update_freeze_list(
      freezedAccount,
      true,
      0,
      root
    );
    await tx.wait();
    isAccountFreezed = await compliantTransferContract.freeze_list(freezedAccount);
    freezedAccountByIndex = await compliantTransferContract.freeze_list_index(0);
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
    let rejectedTx = await compliantTransferContractForAccount.transfer_public(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      compliantTransferContract.address(),
      amount
    );
    await approvalTx.wait();

    // If the sender is freezed account it's impossible to send tokens
    rejectedTx = await compliantTransferContractForFreezedAccount.transfer_public(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    rejectedTx = await compliantTransferContractForAccount.transfer_public(
      freezedAccount,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantTransferContractForAccount.transfer_public(
      recipient,
      amount
    );
    await tx.wait();
  }, timeout)

  test(`test transfer_public_as_signer`, async () => {
    // If the sender is freezed account it's impossible to send tokens
    let rejectedTx = await compliantTransferContractForFreezedAccount.transfer_public_as_signer(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    rejectedTx = await compliantTransferContractForAccount.transfer_public_as_signer(
      freezedAccount,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantTransferContractForAccount.transfer_public_as_signer(
      recipient,
      amount
    );
    await tx.wait();
  }, timeout)

  test(`test transfer_public_to_priv`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
      investigatorAddress
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContractForAccount.approve_public(
      tokenId,
      compliantTransferContract.address(),
      amount
    );
    await approvalTx.wait();

    // If the sender is freezed account it's impossible to send tokens
    rejectedTx = await compliantTransferContractForFreezedAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
      investigatorAddress
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    await expect(compliantTransferContractForAccount.transfer_public_to_priv(
      freezedAccount,
      amount,
      freezedAccountMerkleProof,
      investigatorAddress
    )).rejects.toThrow();

    const tx = await compliantTransferContractForAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof,
      investigatorAddress
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
  }, timeout);

  test(`test transfer_private`, async () => {
    // If the sender is freezed account it's impossible to send tokens
    await expect(compliantTransferContractForFreezedAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      freezedAccountMerkleProof,
      recipientMerkleProof,
      investigatorAddress
    )).rejects.toThrow();
    // If the recipient is freezed account it's impossible to send tokens
    await expect(compliantTransferContractForAccount.transfer_private(
      freezedAccount,
      amount,
      accountRecord,
      senderMerkleProof,
      freezedAccountMerkleProof,
      investigatorAddress
    )).rejects.toThrow();

    const tx = await compliantTransferContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      recipientMerkleProof,
      investigatorAddress
    );
    const [complianceRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[2].outputs[0].value, accountPrivKey);
    const recipientRecord = decryptToken((tx as any).transaction.execution.transitions[3].outputs[1].value, recipientPrivKey);
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
    await expect(compliantTransferContractForFreezedAccount.transfer_priv_to_public(
      recipient,
      amount,
      freezedAccountRecord,
      freezedAccountMerkleProof,
      investigatorAddress
    )).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    let rejectedTx = await compliantTransferContractForAccount.transfer_priv_to_public(
      freezedAccount,
      amount,
      accountRecord,
      senderMerkleProof,
      investigatorAddress
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await compliantTransferContractForAccount.transfer_priv_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      investigatorAddress
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
  }, timeout)
})