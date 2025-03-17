import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/tqxftxoicd";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { ADMIN, COMPLIANT_TRANSFER_ADDRESS, FREEZED_ACCOUNT, INVESTIGATOR, MAX_TREE_SIZE, ZERO_ADDRESS, adminPrivKey, defaultAuthorizedUntil, freezedAccountPrivKey, fundedAmount, investigatorPrivKey, timeout, tokenId } from "../lib/Constants";
import { getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";

const account = ADMIN;
const accountPrivKey = adminPrivKey;
const freezedAccount = FREEZED_ACCOUNT;
const recipient = "aleo1ashyu96tjwe63u0gtnnv8z5lhapdu4l5pjsl2kha7fv7hvz2eqxs5dz0rg"
const recipientPrivKey = process.env.ALEO_DEVNET_PRIVATE_KEY3

const mode = ExecutionMode.SnarkExecute;
const tokenRegistryContract = new Token_registryContract({ mode, privateKey: accountPrivKey });
const compliantTransferContract = new TqxftxoicdContract({ mode, privateKey: accountPrivKey })
const compliantTransferContractForFreezedAccount = new TqxftxoicdContract({ mode, privateKey: freezedAccountPrivKey });
const merkleTreeContract = new RediwsozfoContract({ mode, privateKey: accountPrivKey });

const amount = 10n;
let root: bigint;

describe('test compliant_transfer program', () => {
  test(`fund credits`, async () => {
    await fundWithCredits(account, fundedAmount);
    await fundWithCredits(freezedAccount, fundedAmount);
  }, timeout)

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
    senderMerkleProof = [getSiblingPath(tree, 6, MAX_TREE_SIZE), getSiblingPath(tree, 7, MAX_TREE_SIZE)];
    recipientMerkleProof = [getSiblingPath(tree, 7, MAX_TREE_SIZE), getSiblingPath(tree, 7, MAX_TREE_SIZE)];
    freezedAccountMerkleProof = [getSiblingPath(tree, 7, MAX_TREE_SIZE), getSiblingPath(tree, 7, MAX_TREE_SIZE)];
  }, timeout);

  test(`verify compliant_transfer address`, async () => {
    expect(compliantTransferContract.address()).toBe(COMPLIANT_TRANSFER_ADDRESS)
  }, timeout);

  test(`test update_freeze_list`, async () => {
    let rejectedTx = await compliantTransferContractForFreezedAccount.update_freeze_list(
      account,
      true,
      0,
      root
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await compliantTransferContract.update_freeze_list(
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

    tx = await compliantTransferContract.update_freeze_list(
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

    tx = await compliantTransferContract.update_freeze_list(
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
    const rejectedTx1 = await tokenRegistryContract.transfer_private_to_public(
      account,
      amount,
      accountRecord
    );
    await expect(rejectedTx1.wait()).rejects.toThrow();

    const rejectedTx2 = await tokenRegistryContract.transfer_private(
      account,
      amount,
      accountRecord
    );
    await expect(rejectedTx2.wait()).rejects.toThrow();

    const rejectedTx3 = await tokenRegistryContract.transfer_public(
      tokenId,
      account,
      amount,
    );
    await expect(rejectedTx3.wait()).rejects.toThrow();

    const rejectedTx4 = await tokenRegistryContract.transfer_public_as_signer(
      tokenId,
      account,
      amount,
    );
    await expect(rejectedTx4.wait()).rejects.toThrow();

    const rejectedTx5 = await tokenRegistryContract.transfer_public_to_private(
      tokenId,
      account,
      amount,
      true,
    );
    await expect(rejectedTx5.wait()).rejects.toThrow();

    const tx = await tokenRegistryContract.approve_public(
      tokenId,
      account,
      amount,
    );
    await tx.wait();

    const rejectedTx6 = await tokenRegistryContract.transfer_from_public(
      tokenId,
      account,
      account,
      amount
    );
    await expect(rejectedTx6.wait()).rejects.toThrow();

    const rejectedTx7 = await tokenRegistryContract.transfer_from_public_to_private(
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
    let rejectedTx = await compliantTransferContract.transfer_public(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContract.approve_public(
      tokenId,
      COMPLIANT_TRANSFER_ADDRESS,
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
    rejectedTx = await compliantTransferContract.transfer_public(
      freezedAccount,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantTransferContract.transfer_public(
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
    rejectedTx = await compliantTransferContract.transfer_public_as_signer(
      freezedAccount,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await compliantTransferContract.transfer_public_as_signer(
      recipient,
      amount
    );
    await tx.wait();
  }, timeout)

  test(`test transfer_public_to_priv`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantTransferContract.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContract.approve_public(
      tokenId,
      COMPLIANT_TRANSFER_ADDRESS,
      amount
    );
    await approvalTx.wait();

    // If the sender is freezed account it's impossible to send tokens
    rejectedTx = await compliantTransferContractForFreezedAccount.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    await expect(compliantTransferContract.transfer_public_to_priv(
      freezedAccount,
      amount,
      freezedAccountMerkleProof
    )).rejects.toThrow();

    const tx = await compliantTransferContract.transfer_public_to_priv(
      recipient,
      amount,
      recipientMerkleProof
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
    expect(decryptedComplianceRecord.owner).toBe(INVESTIGATOR);
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
      recipientMerkleProof
    )).rejects.toThrow();
    // If the recipient is freezed account it's impossible to send tokens
    await expect(compliantTransferContract.transfer_private(
      freezedAccount,
      amount,
      accountRecord,
      senderMerkleProof,
      freezedAccountMerkleProof
    )).rejects.toThrow();

    const tx = await compliantTransferContract.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      recipientMerkleProof
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
    expect(decryptedComplianceRecord.owner).toBe(INVESTIGATOR);
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
      freezedAccountMerkleProof
    )).rejects.toThrow();

    // If the recipient is freezed account it's impossible to send tokens
    let rejectedTx = await compliantTransferContract.transfer_priv_to_public(
      freezedAccount,
      amount,
      accountRecord,
      senderMerkleProof
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await compliantTransferContract.transfer_priv_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof
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
    expect(decryptedComplianceRecord.owner).toBe(INVESTIGATOR);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  }, timeout)
})