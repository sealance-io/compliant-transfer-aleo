import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/sealed_report_policy";
import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZE_LIST_MANAGER_INDEX,
  INVESTIGATOR_INDEX,
  TREE_DEPTH_12,
  MINTER_ROLE,
  NONE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  SUPPLY_MANAGER_ROLE,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import { genSignature } from "../lib/Sign";

import { Account, Poseidon4, Field, Plaintext } from "@provablehq/sdk";
import { stringToBigInt } from "../lib/Conversion";
import { decryptToken } from "../artifacts/js/leo2js/ktxtgppmki";
import { Token } from "../artifacts/js/types/ktxtgppmki";
import { Ticket } from "../artifacts/js/types/ktxtgppmki";
import { decryptTicket } from "../artifacts/js/leo2js/ktxtgppmki";
import { KtxtgppmkiContract } from "../artifacts/js/ktxtgppmki";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [
  deployerAddress,
  adminAddress,
  investigatorAddress,
  frozenAccount,
  account,
  recipient,
  minter,
  burner,
  supplyManager,
  spender,
  freezeListManager,
] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const investigatorPrivKey = contract.getPrivateKey(investigatorAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);
const minterPrivKey = contract.getPrivateKey(minter);
const burnerPrivKey = contract.getPrivateKey(burner);
const supplyManagerPrivKey = contract.getPrivateKey(supplyManager);
const spenderPrivKey = contract.getPrivateKey(spender);
const freezeListManagerPrivKey = contract.getPrivateKey(freezeListManager);

const standaloneTokenContract = new KtxtgppmkiContract({
  mode,
  privateKey: deployerPrivKey,
});
const standaloneTokenContractForAdmin = new KtxtgppmkiContract({
  mode,
  privateKey: adminPrivKey,
});
const standaloneTokenContractForFreezeListManager = new KtxtgppmkiContract({
  mode,
  privateKey: freezeListManagerPrivKey,
});
const standaloneTokenContractForAccount = new KtxtgppmkiContract({
  mode,
  privateKey: accountPrivKey,
});
const standaloneTokenContractForMinter = new KtxtgppmkiContract({
  mode,
  privateKey: minterPrivKey,
});
const standaloneTokenContractForBurner = new KtxtgppmkiContract({
  mode,
  privateKey: burnerPrivKey,
});
const standaloneTokenContractForSupplyManager = new KtxtgppmkiContract({
  mode,
  privateKey: supplyManagerPrivKey,
});
const standaloneTokenContractForSpender = new KtxtgppmkiContract({
  mode,
  privateKey: spenderPrivKey,
});
const standaloneTokenContractForFrozenAccount = new KtxtgppmkiContract({
  mode,
  privateKey: frozenAccountPrivKey,
});

const amount = 10n;
let root: bigint;

describe("test sealed_standalone_token program", () => {
  beforeAll(async () => {

    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
    await deployIfNotDeployed(standaloneTokenContract);

  });

  test(`verify test`, async () => {
      const account = new Account({privateKey: adminPrivKey});
      const sig = account.sign(new Uint8Array(1).fill(1));
      console.log(new Uint8Array(1).fill(1));
    let tx = await standaloneTokenContractForAdmin.verify_signature(2n, sig.to_string());
    await tx.wait();

  });
/*
  test(`test update_admin_address`, async () => {
    let tx = await standaloneTokenContractForAdmin.update_role(adminAddress, ADMIN_INDEX);
    await tx.wait();
    let adminRole = await standaloneTokenContract.roles(ADMIN_INDEX);
    expect(adminRole).toBe(adminAddress);

  });

  test(`test update_investigator_address`, async () => {
    let tx = await standaloneTokenContractForAdmin.update_role(adminAddress, INVESTIGATOR_INDEX);
    await tx.wait();
    let investigatorRole = await standaloneTokenContract.roles(INVESTIGATOR_INDEX);
    expect(investigatorRole).toBe(adminAddress);

  });

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(`generate merkle proofs`, async () => {
    const leaves = genLeaves([frozenAccount]);
    const tree = buildTree(leaves);
    root = tree[tree.length - 1];
    const senderLeafIndices = getLeafIndices(tree, account);
    const recipientLeafIndices = getLeafIndices(tree, recipient);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount);
    senderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], TREE_DEPTH_12),
      getSiblingPath(tree, senderLeafIndices[1], TREE_DEPTH_12),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeafIndices[0], TREE_DEPTH_12),
      getSiblingPath(tree, frozenAccountLeafIndices[1], TREE_DEPTH_12),
    ];
  });

  test(`test initialize`, async () => {
    const name = stringToBigInt("Report Token");
    const symbol = stringToBigInt("REPORT_TOKEN");
    const decimals = 6;
    const maxSupply = 1000_000000000000n;

    const tx = await standaloneTokenContract.initialize(name, symbol, decimals, maxSupply, BLOCK_HEIGHT_WINDOW);
    await tx.wait();

    const isAccountFrozen = await standaloneTokenContract.freeze_list(ZERO_ADDRESS);
    const frozenAccountByIndex = await standaloneTokenContract.freeze_list_index(0);
    const lastIndex = await standaloneTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
    const initializedRoot = await standaloneTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const blockHeightWindow = await standaloneTokenContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);

    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(0);
    expect(initializedRoot).toBe(emptyRoot);
    expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

  });

  test(`test update_freeze_list`, async () => {
    const currentRoot = await standaloneTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    let tx = await standaloneTokenContractForAdmin.update_freeze_list(frozenAccount, true, 1, currentRoot, root);
    await tx.wait();
    let isAccountFrozen = await standaloneTokenContract.freeze_list(frozenAccount);
    let frozenAccountByIndex = await standaloneTokenContract.freeze_list_index(1);
    let lastIndex = await standaloneTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(frozenAccount);
    expect(lastIndex).toBe(1);

  });

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test(`test mint_private`, async () => {
    let tx = await standaloneTokenContractForAdmin.mint_private(account, amount * 20n);
    const [encryptedAccountRecord] = await tx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    expect(accountRecord.amount).toBe(amount * 20n);
    expect(accountRecord.owner).toBe(account);
  });

  let ticket: Ticket;
  test(`test get_ticket`, async () => {
    const tx = await standaloneTokenContractForAccount.get_ticket(senderMerkleProof);
    const [encryptedTicket] = await tx.wait();
    ticket = await decryptTicket(encryptedTicket, accountPrivKey);
    expect(ticket.owner).toBe(account);
    expect(ticket.freeze_list_root).toBe(root);
  });

  test(`test transfer_private`, async () => {

    const tx = await standaloneTokenContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
      investigatorAddress,
    );
    const [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord, encryptedCredRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    const recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  });

  test(`test transfer with ticket`, async () => {
    let transferPrivateTx = await standaloneTokenContractForAccount.transfer_private_with_ticket(
      recipient,
      amount,
      accountRecord,
      ticket,
      investigatorAddress,
    );
    let [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord, encryptedCredRecord] =
      await transferPrivateTx.wait();
    ticket = await decryptTicket(encryptedCredRecord, accountPrivKey);
    expect(ticket.owner).toBe(account);
    expect(ticket.freeze_list_root).toBe(root);
    let previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    let recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    let decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  });

    test(`test transfer with pass`, async () => {
      const currentRoot = await standaloneTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      
      const account = new Account({privateKey: accountPrivKey});

      const hasher = new Poseidon4();
      const fields = [Field.fromString("1field"), Field.fromString("2field")];
      const arrayPlaintext = Plaintext.fromString(`[${fields.map(f => f.toString()).join(",")}]`);
      const hash = hasher.hash(arrayPlaintext.toFields())

      const sig = account.sign(Field.fromString("2field"));

      let transferPrivateTx = await standaloneTokenContractForAccount.transfer_private_with_pass(
      recipient,
      amount,
      accountRecord,
      sig.to_string(),
      currentRoot,
      investigatorAddress,
    );
    let [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord] =
      await transferPrivateTx.wait();

    let previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    let recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    let decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  });
*/
});
