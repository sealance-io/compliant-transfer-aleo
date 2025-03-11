import { ExecutionMode } from "@doko-js/core";

import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/tqxftxoicd";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { RediwsozfoContract } from "../artifacts/js/rediwsozfo";
import { getSiblingPath } from "./merkle_tree.test";
import { TqxftxoicdContract } from "../artifacts/js/tqxftxoicd";
import { CreditsContract } from "../artifacts/js/credits";

const mode = ExecutionMode.SnarkExecute;
const tokenRegistryContract = new Token_registryContract({ mode, privateKey: process.env.ALEO_PRIVATE_KEY });
const compliantTransferContract = new TqxftxoicdContract({ mode, privateKey: process.env.ALEO_PRIVATE_KEY })
const compliantTransferContractForFreezedAccount = new TqxftxoicdContract({ mode, privateKey: process.env.ALEO_DEVNET_PRIVATE_KEY2 });
const merkleTreeContract = new RediwsozfoContract({ mode });
const creditsContract = new CreditsContract({ mode });


const PROGRAM_ADDRESS = "aleo10ha27yxrya7d7lf0eg5p3hqcafm8k6nj00pvgeuxuqmvhqpst5xsdh2ft4";
const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";
const INVESTIGATOR = "aleo1y3ftuud75cwspnsx9w85sw4z0pdcrxpgnsxtz2re4q0vupw9mg8szhm06m";
const investigatorPrivKey = process.env.ALEO_DEVNET_PRIVATE_KEY4;

const account = "aleo1lwa86hr7qx99d7e3dcyv2s7wt9g8rmd6qxzm5zprad0c4ejynsqqvaxysn"
const accountPrivKey = process.env.ALEO_PRIVATE_KEY
const freezedAccount = "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t"
const freezedAccountPrivKey = process.env.ALEO_DEVNET_PRIVATE_KEY2
const recipient = "aleo1ashyu96tjwe63u0gtnnv8z5lhapdu4l5pjsl2kha7fv7hvz2eqxs5dz0rg"
const recipientPrivKey = process.env.ALEO_DEVNET_PRIVATE_KEY3

const amount = 10n;
const defaultAuthorizedUntil = 4294967295;
const faucetAmount = 100000n;
const fundedAmount = 10000000000000n;

const tokenName = "SEALEDTOKEN";
const tokenSymbol = "SEALED";

const tokenId = stringToBigInt(tokenName);

let root: bigint;

function stringToBigInt(asciiString) {
  let bigIntValue = 0n;
  for (let i = 0; i < asciiString.length; i++) {
    bigIntValue = (bigIntValue << 8n) + BigInt(asciiString.charCodeAt(i));
  }
  return bigIntValue;
}

describe('test compliant_transfer program', () => {
  test(`fund account`, async () => {
    let tx = await creditsContract.transfer_public(account, fundedAmount);
    await tx.wait();
    tx = await creditsContract.transfer_public(freezedAccount, fundedAmount);
    await tx.wait();
  }, 10000000)

  let accountRecord;
  let freezedAccountRecord;
  test('token_registry setup', async () => {
    let tx = await tokenRegistryContract.deploy();
    await tx.wait();

    tx = await tokenRegistryContract.register_token(
      tokenId, // tokenId
      stringToBigInt(tokenName), // tokenId
      stringToBigInt(tokenSymbol), // name
      6, // decimals
      1000_000000000000n, // max supply
      true,
      PROGRAM_ADDRESS
    );
    await tx.wait();
    tx = await tokenRegistryContract.set_role(
      tokenId,
      PROGRAM_ADDRESS,
      3, // SUPPLY_MANAGER_ROLE
    );
    await tx.wait();

    // fund account and freezed account
    tx = await tokenRegistryContract.mint_public(
      tokenId,
      account,
      amount * 20n,
      defaultAuthorizedUntil
    );
    await tx.wait();
    tx = await tokenRegistryContract.mint_public(
      tokenId,
      freezedAccount,
      amount * 20n,
      defaultAuthorizedUntil
    );
    await tx.wait();
    tx = await tokenRegistryContract.mint_private(
      tokenId,
      account,
      amount * 20n,
      true,
      0
    );

    const [encryptedAccountRecord] = await tx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    tx = await tokenRegistryContract.mint_private(
      tokenId,
      freezedAccount,
      amount * 20n,
      true,
      0
    );
    const [encryptedFreezedAccountRecord] = await tx.wait();
    freezedAccountRecord = decryptToken(encryptedFreezedAccountRecord, freezedAccountPrivKey);
  }, 10000000)

  let senderMerkleProof;
  let recipientMerkleProof;
  let freezedAccountMerkleProof;

  test(`merkle_tree setup`, async () => {
    let tx = await merkleTreeContract.deploy();
    await tx.wait();

    tx = await merkleTreeContract.build_tree([
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
    senderMerkleProof = [getSiblingPath(tree, 6), getSiblingPath(tree, 7)];
    recipientMerkleProof = [getSiblingPath(tree, 7), getSiblingPath(tree, 7)];
    freezedAccountMerkleProof = [getSiblingPath(tree, 7), getSiblingPath(tree, 7)];
  }, 10000000);

  test(`deploy compliant_transfer`, async () => {
    const tx = await compliantTransferContract.deploy();
    await tx.wait();
    console.log(compliantTransferContract.address())
    expect(compliantTransferContract.address()).toBe(PROGRAM_ADDRESS)
  }, 10000000);

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
  }, 10000000);

  test('test demo_faucet', async () => {
    let tx = await compliantTransferContractForFreezedAccount.demo_faucet();
    const [complianceRecord] = await tx.wait();
    const tokenRecord = (tx as any).transaction.execution.transitions[1].outputs[0].value;
    const accountRecord = decryptToken(tokenRecord, freezedAccountPrivKey);
    expect(accountRecord.owner).toBe(freezedAccount);
    expect(accountRecord.amount).toBe(faucetAmount);
    expect(accountRecord.token_id).toBe(tokenId);
    expect(accountRecord.external_authorization_required).toBe(true);
    expect(accountRecord.authorized_until).toBe(0);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(INVESTIGATOR);
    expect(decryptedComplianceRecord.amount).toBe(faucetAmount);
    expect(decryptedComplianceRecord.sender).toBe(ZERO_ADDRESS);
    expect(decryptedComplianceRecord.recipient).toBe(freezedAccount);

    // Each user can call to this function only one time
    let rejectedTx = await compliantTransferContractForFreezedAccount.demo_faucet();
    await expect(rejectedTx.wait()).rejects.toThrow();
  }, 10000000)

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
  }, 10000000)

  test(`test transfer_public`, async () => {
    // If the sender didn't approve the program the tx will fail
    let rejectedTx = await compliantTransferContract.transfer_public(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const approvalTx = await tokenRegistryContract.approve_public(
      tokenId,
      PROGRAM_ADDRESS,
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
  }, 10000000)

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
  }, 10000000)

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
      PROGRAM_ADDRESS,
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
  }, 10000000);

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
  }, 10000000)

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
  }, 10000000)
})