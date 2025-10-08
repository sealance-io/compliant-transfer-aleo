import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";

import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  MAX_TREE_SIZE,
  MINTER_ROLE,
  NONE_ROLE,
  PAUSE_ROLE,
  MANAGER_ROLE,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import { Account } from "@provablehq/sdk";
import { stringToBigInt } from "../lib/Conversion";
import { isProgramInitialized } from "../lib/Initalize";
import { computeRoles2Addresses } from "../lib/Role";
import { decryptToken } from "../artifacts/js/leo2js/compliant_token_template";
import { Token } from "../artifacts/js/types/compliant_token_template";
import { Ticket } from "../artifacts/js/types/compliant_token_template";
import { decryptTicket } from "../artifacts/js/leo2js/compliant_token_template";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/compliant_token_template";

import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Compliant_token_templateContract } from "../artifacts/js/compliant_token_template";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";

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

const tokenContract = new Compliant_token_templateContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenContractForAdmin = new Compliant_token_templateContract({
  mode,
  privateKey: adminPrivKey,
});
const tokenContractForFreezeListManager = new Compliant_token_templateContract({
  mode,
  privateKey: freezeListManagerPrivKey,
});
const tokenContractForAccount = new Compliant_token_templateContract({
  mode,
  privateKey: accountPrivKey,
});
const tokenContractForMinter = new Compliant_token_templateContract({
  mode,
  privateKey: minterPrivKey,
});
const tokenContractForBurner = new Compliant_token_templateContract({
  mode,
  privateKey: burnerPrivKey,
});
const tokenContractForSupplyManager = new Compliant_token_templateContract({
  mode,
  privateKey: supplyManagerPrivKey,
});
const tokenContractForSpender = new Compliant_token_templateContract({
  mode,
  privateKey: spenderPrivKey,
});
const tokenContractForFrozenAccount = new Compliant_token_templateContract({
  mode,
  privateKey: frozenAccountPrivKey,
});

const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});

const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

const amount = 10n;
let root: bigint;

describe("test sealed_standalone_token program", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezeListManager, fundedAmount);

    await fundWithCredits(deployerPrivKey, minter, fundedAmount);
    await fundWithCredits(deployerPrivKey, supplyManager, fundedAmount);
    await fundWithCredits(deployerPrivKey, burner, fundedAmount);
    await fundWithCredits(deployerPrivKey, spender, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(tokenContract);
  });

/*
  test(`test update_investigator_address`, async () => {
    let tx = await standaloneTokenContractForAdmin.update_role(frozenAccount, INVESTIGATOR_INDEX);
    await tx.wait();
    let investigatorRole = await standaloneTokenContract.roles(INVESTIGATOR_INDEX);
    expect(investigatorRole).toBe(frozenAccount);

    tx = await standaloneTokenContractForAdmin.update_role(investigatorAddress, INVESTIGATOR_INDEX);
    await tx.wait();
    investigatorRole = await standaloneTokenContract.roles(INVESTIGATOR_INDEX);
    expect(investigatorRole).toBe(investigatorAddress);

    const rejectedTx = await standaloneTokenContractForFrozenAccount.update_role(frozenAccount, INVESTIGATOR_INDEX);
    await expect(rejectedTx.wait()).rejects.toThrow();
  });
*/

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
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_SIZE),
      getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_SIZE),
    ];
  });

  test(`test initialize `, async () => {
    const isTokenInitialized = await isProgramInitialized(tokenContract);
    if (!isTokenInitialized) {
        const name = stringToBigInt("Stable Token");
        const symbol = stringToBigInt("STABLE_TOKEN");
        const decimals = 6;
        const maxSupply = 1000_000000000000n;

        const tx = await tokenContract.initialize(name, symbol, decimals, maxSupply, adminAddress);
        await tx.wait();

        // It is possible to call to initialize only one time
        let rejectedTx = await tokenContract.initialize(name, symbol, decimals, maxSupply, adminAddress);
        await expect(rejectedTx.wait()).rejects.toThrow();
    }


    const isFreezeRegistryInitialized = await isProgramInitialized(freezeRegistryContract);
    if (!isFreezeRegistryInitialized) {
      const tx = await freezeRegistryContract.initialize(adminAddress, BLOCK_HEIGHT_WINDOW);
      await tx.wait();
      const isAccountFrozen = await freezeRegistryContract.freeze_list(ZERO_ADDRESS);
      const frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(0);
      const lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await freezeRegistryContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
      const admin = await freezeRegistryContract.roles(ADMIN_INDEX);

      expect(admin).toBe(adminAddress);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
    }

  });

  test(`test update_freeze_list`, async () => {
    const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    let tx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, currentRoot, root);
    await tx.wait();
    let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
    let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
    let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(frozenAccount);
    expect(lastIndex).toBe(1);
  });

  test(`test update_roles`, async () => {
    // Manager can assign role
    let newRole2Addresses = await computeRoles2Addresses(tokenContract, frozenAccount, MANAGER_ROLE)
    let tx = await tokenContractForAdmin.update_role(frozenAccount, MANAGER_ROLE, newRole2Addresses);
    await tx.wait();
    let role = await tokenContract.address_to_role(frozenAccount);
    expect(role).toBe(MANAGER_ROLE);
    let roleArray = await tokenContract.role_to_addresses(MANAGER_ROLE);
    expect(roleArray).toStrictEqual([adminAddress, frozenAccount, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);
    
    // Manager can remove role
    newRole2Addresses = await computeRoles2Addresses(tokenContract, frozenAccount, NONE_ROLE)
    tx = await tokenContractForAdmin.update_role(frozenAccount, NONE_ROLE, newRole2Addresses);
    await tx.wait();
    role = await tokenContract.address_to_role(frozenAccount);
    expect(role).toBe(NONE_ROLE);
    roleArray = await tokenContract.role_to_addresses(MANAGER_ROLE);
    expect(roleArray).toStrictEqual([adminAddress, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);

    // Non manager cannot assign role
    newRole2Addresses = await computeRoles2Addresses(tokenContract, frozenAccount, MANAGER_ROLE)
    let rejectedTx = await tokenContractForFrozenAccount.update_role(frozenAccount, MANAGER_ROLE, newRole2Addresses);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update minter role
    newRole2Addresses = await computeRoles2Addresses(tokenContract, minter, MINTER_ROLE)
    rejectedTx = await tokenContractForAccount.update_role(minter, MINTER_ROLE, newRole2Addresses);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update burner role
    newRole2Addresses = await computeRoles2Addresses(tokenContract, burner, BURNER_ROLE)
    rejectedTx = await tokenContractForAccount.update_role(burner, BURNER_ROLE, newRole2Addresses);
    await expect(rejectedTx.wait()).rejects.toThrow();
    
    // Non admin user cannot update supply manager role
    newRole2Addresses = await computeRoles2Addresses(tokenContract, burner, MINTER_ROLE + BURNER_ROLE)
    rejectedTx = await tokenContractForAccount.update_role(supplyManager, MINTER_ROLE + BURNER_ROLE, newRole2Addresses);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update none role
    newRole2Addresses = await computeRoles2Addresses(tokenContract, account, NONE_ROLE)
    rejectedTx = await tokenContractForAccount.update_role(account, NONE_ROLE, newRole2Addresses);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager can assign minter, burner and supply manager roles
    newRole2Addresses = await computeRoles2Addresses(tokenContract, minter, MINTER_ROLE)
    tx = await tokenContractForAdmin.update_role(minter, MINTER_ROLE, newRole2Addresses);
    await tx.wait();
    role = await tokenContract.address_to_role(minter);
    expect(role).toBe(MINTER_ROLE);
    roleArray = await tokenContract.role_to_addresses(MINTER_ROLE);
    expect(roleArray).contain(minter)
    
    newRole2Addresses = await computeRoles2Addresses(tokenContract, burner, BURNER_ROLE)
    tx = await tokenContractForAdmin.update_role(burner, BURNER_ROLE, newRole2Addresses);
    await tx.wait();
    role = await tokenContract.address_to_role(burner);
    expect(role).toBe(BURNER_ROLE);
    roleArray = await tokenContract.role_to_addresses(BURNER_ROLE);
    expect(roleArray).contain(burner)

    newRole2Addresses = await computeRoles2Addresses(tokenContract, supplyManager, MINTER_ROLE + BURNER_ROLE)
    tx = await tokenContractForAdmin.update_role(supplyManager, MINTER_ROLE + BURNER_ROLE, newRole2Addresses);
    await tx.wait();
    role = await tokenContract.address_to_role(supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);
    roleArray = await tokenContract.role_to_addresses(MINTER_ROLE);
    expect(roleArray).contain(supplyManager);
    roleArray = await tokenContract.role_to_addresses(BURNER_ROLE);
    expect(roleArray).contain(supplyManager)

    newRole2Addresses = await computeRoles2Addresses(tokenContract, account, NONE_ROLE)
    tx = await tokenContractForAdmin.update_role(account, NONE_ROLE, newRole2Addresses);
    await tx.wait();
    role = await tokenContract.address_to_role(account);
    expect(role).toBe(NONE_ROLE);
  });

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test(`test mint_private`, async () => {
    // a regular user cannot mint private assets
    let rejectedTx = await tokenContractForAccount.mint_private(account, amount * 20n);
    await expect(rejectedTx.wait()).rejects.toThrow();
    // a burner cannot mint private assets
    rejectedTx = await tokenContractForBurner.mint_private(account, amount * 20n);
    await expect(rejectedTx.wait()).rejects.toThrow();
    // an admin cannot mint private assets
    rejectedTx = await tokenContractForAdmin.mint_private(account, amount * 20n);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenContractForMinter.mint_private(frozenAccount, amount * 20n);
    const [encryptedFrozenAccountRecord] = await tx.wait();
    frozenAccountRecord = decryptToken(encryptedFrozenAccountRecord, frozenAccountPrivKey);
    expect(frozenAccountRecord.amount).toBe(amount * 20n);
    expect(frozenAccountRecord.owner).toBe(frozenAccount);

    tx = await tokenContractForSupplyManager.mint_private(account, amount * 20n);
    const [encryptedAccountRecord] = await tx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    expect(accountRecord.amount).toBe(amount * 20n);
    expect(accountRecord.owner).toBe(account);

    tx = await tokenContractForSupplyManager.mint_private(account, amount * 20n);
    await tx.wait();
  });

  test(`test mint_public`, async () => {
    // a regular user cannot mint public assets
    let rejectedTx = await tokenContractForAccount.mint_public(account, amount * 20n);
    await expect(rejectedTx.wait()).rejects.toThrow();
    // a burner cannot mint public assets
    rejectedTx = await tokenContractForBurner.mint_public(account, amount * 20n);
    await expect(rejectedTx.wait()).rejects.toThrow();
    // an admin cannot mint public assets
    rejectedTx = await tokenContractForAdmin.mint_public(account, amount * 20n);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenContractForMinter.mint_public(frozenAccount, amount * 20n);
    await tx.wait();
    let balance = await tokenContract.balances(frozenAccount);
    expect(balance).toBe(amount * 20n);

    tx = await tokenContractForSupplyManager.mint_public(account, amount * 20n);
    await tx.wait();
    balance = await tokenContract.balances(account);
    expect(balance).toBe(amount * 20n);
  });

  test(`test burn_public`, async () => {
    // A regular user cannot burn public assets
    let rejectedTx = await tokenContractForAccount.burn_public(account, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // A minter user cannot burn public assets
    rejectedTx = await tokenContractForMinter.burn_public(account, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    rejectedTx = await tokenContractForAdmin.burn_public(account, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);
    let tx = await tokenContractForBurner.burn_public(account, amount);
    await tx.wait();

    tx = await tokenContractForSupplyManager.burn_public(account, amount);
    await tx.wait();
    
    let balance = await tokenContract.balances(account);
    expect(balance).toBe(previousAccountPublicBalance - amount * 2n);

  });

  test(`test burn_private`, async () => {
    // A user that is not burner, supply manager, or admin  cannot burn private assets
    let rejectedTx = await tokenContractForAccount.burn_private(accountRecord, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let mintTx = await tokenContractForAdmin.mint_private(adminAddress, amount);
    let [encryptedAdminRecord] = await mintTx.wait();
    let adminRecord = decryptToken(encryptedAdminRecord, adminPrivKey);
    expect(adminRecord.amount).toBe(amount);
    expect(adminRecord.owner).toBe(adminAddress);
    let burnTx = await tokenContractForAdmin.burn_private(adminRecord, amount);
    [encryptedAdminRecord] = await burnTx.wait();
    adminRecord = decryptToken(encryptedAdminRecord, adminPrivKey);
    expect(adminRecord.amount).toBe(0n);
    expect(adminRecord.owner).toBe(adminAddress);

    mintTx = await tokenContractForAdmin.mint_private(burner, amount);
    let [encryptedBurnerRecord] = await mintTx.wait();
    let burnerRecord = decryptToken(encryptedBurnerRecord, burnerPrivKey);
    expect(burnerRecord.amount).toBe(amount);
    expect(burnerRecord.owner).toBe(burner);
    burnTx = await tokenContractForBurner.burn_private(burnerRecord, amount);
    [encryptedBurnerRecord] = await burnTx.wait();
    burnerRecord = decryptToken(encryptedBurnerRecord, burnerPrivKey);
    expect(burnerRecord.amount).toBe(0n);
    expect(burnerRecord.owner).toBe(burner);

    mintTx = await tokenContractForAdmin.mint_private(supplyManager, amount);
    let [encryptedSupplyManager] = await mintTx.wait();
    let supplyManagerRecord = decryptToken(encryptedSupplyManager, supplyManagerPrivKey);
    expect(supplyManagerRecord.amount).toBe(amount);
    expect(supplyManagerRecord.owner).toBe(supplyManager);
    burnTx = await tokenContractForSupplyManager.burn_private(supplyManagerRecord, amount);
    [encryptedSupplyManager] = await burnTx.wait();
    supplyManagerRecord = decryptToken(encryptedSupplyManager, supplyManagerPrivKey);
    expect(supplyManagerRecord.amount).toBe(0n);
    expect(supplyManagerRecord.owner).toBe(supplyManager);
  });

  test(`test transfer_public`, async () => {

    const previousAccountPublicBalance = await tokenContract.balances(account);
    const previousRecipientPublicBalance = await tokenContract.balances(recipient, 0n);

    // If the sender is frozen account it's IMPOSSIBLE to send tokens
    let rejectedTx = await tokenContractForFrozenAccount.transfer_public(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's IMPOSSIBLE to send tokens
    rejectedTx = await tokenContractForAccount.transfer_public(frozenAccount, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();


    let tx = await tokenContractForAccount.transfer_public(recipient, amount);
    await tx.wait();

    const accountPublicBalance = await tokenContract.balances(account);
    const recipientPublicBalance = await tokenContract.balances(recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test(`test transfer_public_as_signer`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    let rejectedTx = await tokenContractForFrozenAccount.transfer_public_as_signer(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's IMPOSSIBLE to send tokens
    rejectedTx = await tokenContractForAccount.transfer_public(frozenAccount, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);
    const previousRecipientPublicBalance = await tokenContract.balances(recipient, 0n);

    const tx = await tokenContractForAccount.transfer_public_as_signer(recipient, amount);
    await tx.wait();

    const accountPublicBalance = await tokenContract.balances(account);
    const recipientPublicBalance = await tokenContract.balances(recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test(`test transfer_from_public`, async () => {
    // If the sender didn't approve the spender the transaction will fail
    let rejectedTx = await tokenContractForSpender.transfer_from_public(account, recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();
    let unapproveTx = await tokenContractForAccount.unapprove_public(spender, amount);
    await unapproveTx.wait();

    // If the sender approve and then unapprove the spender the transaction will fail
    rejectedTx = await tokenContractForSpender.transfer_from_public(account, recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // approve the spender
    approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();
    approveTx = await tokenContractForFrozenAccount.approve_public(spender, amount);
    await approveTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await tokenContractForSpender.transfer_from_public(frozenAccount, recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    rejectedTx = await tokenContractForSpender.transfer_from_public(account, frozenAccount, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);
    const previousRecipientPublicBalance = await tokenContract.balances(recipient, 0n);

    const tx = await tokenContractForSpender.transfer_from_public(account, recipient, amount);
    await tx.wait();

    const accountPublicBalance = await tokenContract.balances(account);
    const recipientPublicBalance = await tokenContract.balances(recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test(`test transfer_from_public_to_private`, async () => {
    // If the sender didn't approve the spender the transaction will fail
    let rejectedTx = await tokenContractForSpender.transfer_from_public_to_private(
      account,
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();
    let unapproveTx = await tokenContractForAccount.unapprove_public(spender, amount);
    await unapproveTx.wait();

    // If the sender approve and then unapprove the spender the transaction will fail
    rejectedTx = await tokenContractForSpender.transfer_from_public_to_private(
      account,
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // approve the spender
    approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();
    approveTx = await tokenContractForFrozenAccount.approve_public(spender, amount);
    await approveTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await tokenContractForSpender.transfer_from_public_to_private(
      frozenAccount,
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);

    const tx = await tokenContractForSpender.transfer_from_public_to_private(
      account,
      recipient,
      amount
    );
    const [complianceRecord, encryptedRecipientRecord] = await tx.wait();
    const recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    const accountPublicBalance = await tokenContract.balances(account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test(`test transfer_public_to_priv`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    let rejectedTx = await tokenContractForFrozenAccount.transfer_public_to_private(
      recipient,
      amount
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);

    const tx = await tokenContractForAccount.transfer_public_to_private(
      recipient,
      amount
    );
    const [complianceRecord, tokenRecord] = await tx.wait();
    const recipientRecord = decryptToken(tokenRecord, recipientPrivKey);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    const accountPublicBalance = await tokenContract.balances(account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test(`test transfer_private`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      tokenContractForFrozenAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        frozenAccountMerkleProof,
      ),
    ).rejects.toThrow();

    const tx = await tokenContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
    );
    const [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord] = await tx.wait();

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

  test(`test transfer_priv_to_public`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      tokenContractForFrozenAccount.transfer_private_to_public(
        recipient,
        amount,
        frozenAccountRecord,
        frozenAccountMerkleProof,
      ),
    ).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    let rejectedTx = await tokenContractForAccount.transfer_private_to_public(
      frozenAccount,
      amount,
      accountRecord,
      senderMerkleProof    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousRecipientPublicBalance = await tokenContract.balances(recipient, 0n);

    const tx = await tokenContractForAccount.transfer_private_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
    );
    const [complianceRecord, encryptedAccountRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    const recipientPublicBalance = await tokenContract.balances(recipient);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  let ticket: Ticket;
  test(`test get_ticket`, async () => {
    // It's impossible to get the credentials record with an invalid merkle proof
    await expect(tokenContractForFrozenAccount.get_ticket(frozenAccountMerkleProof)).rejects.toThrow();

    const randomAddress = new Account().address().to_string();
    const leaves = genLeaves([randomAddress]);
    const tree = buildTree(leaves);
    const senderLeafIndices = getLeafIndices(tree, account);
    const IncorrectSenderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE),
    ];

    // If the root doesn't match the on-chain root the transaction will be rejected
    const rejectedTx = await tokenContractForAccount.get_ticket(IncorrectSenderMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenContractForAccount.get_ticket(senderMerkleProof);
    const [encryptedTicket] = await tx.wait();
    ticket = await decryptTicket(encryptedTicket, accountPrivKey);
    expect(ticket.owner).toBe(account);
    expect(ticket.freeze_list_root).toBe(root);
  });

  test(`test transfer with ticket`, async () => {

    let transferPrivateTx = await tokenContractForAccount.transfer_private_with_ticket(
      recipient,
      amount,
      accountRecord,
      ticket,
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


    // Update the root to make the old ticket expired
    let updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(
      frozenAccount,
      false,
      1,
      root,
      1n, // fake root
    );
    await updateFreezeListTx.wait();
    let updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(1);
    await updateBlockHeightWindowTx.wait();

    let rejectedTransferPrivateTx = await tokenContractForAccount.transfer_private_with_ticket(
      recipient,
      amount,
      accountRecord,
      ticket,
    );
    await expect(rejectedTransferPrivateTx.wait()).rejects.toThrow();


    // bring back the old root
    updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, 1n, root);
    await updateFreezeListTx.wait();
    updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(BLOCK_HEIGHT_WINDOW);
    await updateBlockHeightWindowTx.wait();

    transferPrivateTx = await tokenContractForAccount.transfer_private_with_ticket(
      recipient,
      amount,
      accountRecord,
      ticket    );
    [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord, encryptedCredRecord] =
      await transferPrivateTx.wait();
    ticket = await decryptTicket(encryptedCredRecord, accountPrivKey);
    expect(ticket.owner).toBe(account);
    expect(ticket.freeze_list_root).toBe(root);
    previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

  });

  test(`test pausing the contract`, async () => {

    // ensure the contract is unpaused
    let pause_status = await tokenContractForAdmin.pause(true);
    if (pause_status == true) {
      let pauseTx = await tokenContractForAdmin.pause_transfers(false);
      await pauseTx.wait();
    }

    // initial minting to ensure the account has enough balance
    let mintPrivateTx = await tokenContractForMinter.mint_private(account, amount * 20n);
    const [encryptedAccountRecord] = await mintPrivateTx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);

    const getTicketTx = await tokenContractForAccount.get_ticket(senderMerkleProof);
    const [encryptedTicket] = await getTicketTx.wait();
    let ticket = await decryptTicket(encryptedTicket, accountPrivKey);

    let mintTx = await tokenContractForSupplyManager.mint_public(account, amount * 20n);
    await mintTx.wait();

    let approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();

    let newRole2Addresses = await computeRoles2Addresses(tokenContract, adminAddress, MANAGER_ROLE + PAUSE_ROLE)
    let tx = await tokenContractForAdmin.update_role(adminAddress, MANAGER_ROLE + PAUSE_ROLE, newRole2Addresses);
    await tx.wait();
    let role = await tokenContract.address_to_role(adminAddress);
    expect(role).toBe(MANAGER_ROLE + PAUSE_ROLE);
    let roleArray = await tokenContract.role_to_addresses(MANAGER_ROLE);
    expect(roleArray).contain(adminAddress);
    roleArray = await tokenContract.role_to_addresses(PAUSE_ROLE);
    expect(roleArray).contain(adminAddress);

    // pause the contract
    pause_status = await tokenContractForAdmin.pause(true);
    expect(pause_status).toBe(false);
    let pauseTx = await tokenContractForAdmin.pause_transfers(true);
    await pauseTx.wait();
    pause_status = await tokenContractForAdmin.pause(true);
    expect(pause_status).toBe(true);

    // verify that all the functionalities are paused
    mintTx = await tokenContractForMinter.mint_public(recipient, amount);
    await expect(mintTx.wait()).rejects.toThrow();

    mintPrivateTx = await tokenContractForMinter.mint_private(recipient, amount);
    await expect(mintPrivateTx.wait()).rejects.toThrow();

    let burnTx = await tokenContractForBurner.burn_public(recipient, amount);
    await expect(burnTx.wait()).rejects.toThrow();
    
    let publicTx = await tokenContractForAccount.transfer_public(recipient, amount);
    await expect(publicTx.wait()).rejects.toThrow();

    let publicAsSignerTx = await tokenContractForAccount.transfer_public_as_signer(recipient, amount);
    await expect(publicAsSignerTx.wait()).rejects.toThrow();
    
    approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await expect(approveTx.wait()).rejects.toThrow();

    let unapproveTx = await tokenContractForAccount.unapprove_public(spender, amount);
    await expect(unapproveTx.wait()).rejects.toThrow();

    const fromPublicTx = await tokenContractForSpender.transfer_from_public(account, recipient, amount);
    await expect(fromPublicTx.wait()).rejects.toThrow();

    const fromPublicToPrivateTx = await tokenContractForSpender.transfer_from_public_to_private(
      account,
      recipient,
      amount
    );
    await expect(fromPublicToPrivateTx.wait()).rejects.toThrow();

    const publicToPrivate = await tokenContractForAccount.transfer_public_to_private(
      recipient,
      amount
    );
    await expect(publicToPrivate.wait()).rejects.toThrow();

    const privateTx = await tokenContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
    );
    await expect(privateTx.wait()).rejects.toThrow();

    const privateToPublic = await tokenContractForAccount.transfer_private_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
    );
    await expect(privateToPublic.wait()).rejects.toThrow();


    let privateWithTicketTx = await tokenContractForAccount.transfer_private_with_ticket(
      recipient,
      amount,
      accountRecord,
      ticket,
    );
    await expect(privateWithTicketTx.wait()).rejects.toThrow();

    // unpause the contract
    pauseTx = await tokenContractForAdmin.pause_transfers(false);
    await pauseTx.wait();
    pause_status = await tokenContractForAdmin.pause(true);
    expect(pause_status).toBe(false);

    //verify that the functionalities are back (one is enough)
    publicTx = await tokenContractForAccount.transfer_public(recipient, amount);
    await publicTx.wait();
  });

});
