import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  MINTER_ROLE,
  NONE_ROLE,
  PAUSE_ROLE,
  MANAGER_ROLE,
  FREEZELIST_MANAGER_ROLE,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
  MAX_TREE_DEPTH,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Account, AleoNetworkClient } from "@provablehq/sdk";
import { decryptToken } from "../artifacts/js/leo2js/compliant_token_template";
import { Token } from "../artifacts/js/types/compliant_token_template";
import { Credentials } from "../artifacts/js/types/compliant_token_template";
import { decryptCredentials } from "../artifacts/js/leo2js/compliant_token_template";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/compliant_token_template";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { isProgramInitialized } from "../lib/Initalize";
import { getLatestBlockHeight } from "../lib/Block";
import { buildTree, generateLeaves, stringToBigInt } from "@sealance-io/policy-engine-aleo";
import { Compliant_token_templateContract } from "../artifacts/js/compliant_token_template";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [
  deployerAddress,
  adminAddress,
  ,
  frozenAccount,
  account,
  recipient,
  minter,
  burner,
  supplyManager,
  spender,
  freezeListManager,
  pauser,
] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);
const minterPrivKey = contract.getPrivateKey(minter);
const burnerPrivKey = contract.getPrivateKey(burner);
const supplyManagerPrivKey = contract.getPrivateKey(supplyManager);
const spenderPrivKey = contract.getPrivateKey(spender);
const pauserPrivateKey = contract.getPrivateKey(pauser);

const tokenContract = new Compliant_token_templateContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenContractForAdmin = new Compliant_token_templateContract({
  mode,
  privateKey: adminPrivKey,
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
const tokenContractForPauser = new Compliant_token_templateContract({
  mode,
  privateKey: pauserPrivateKey,
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
const multiSigContract = new Multisig_coreContract({
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
    await fundWithCredits(deployerPrivKey, pauser, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(multiSigContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(tokenContract);
  });

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(`generate merkle proofs`, async () => {
    const leaves = generateLeaves([frozenAccount]);
    const tree = buildTree(leaves);
    root = tree[tree.length - 1];
    const senderLeafIndices = getLeafIndices(tree, account);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount);
    senderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH),
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
      const tokenInfo = await tokenContract.token_info(true);
      expect(tokenInfo.supply).toBe(0n);
      expect(tokenInfo.decimals).toBe(decimals);
      expect(tokenInfo.max_supply).toBe(maxSupply);
      expect(tokenInfo.name).toBe(name);
      expect(tokenInfo.symbol).toBe(symbol);
      const role = await tokenContract.address_to_role(adminAddress);
      expect(role).toBe(MANAGER_ROLE);
      const pauseStatus = await tokenContract.pause(true);
      expect(pauseStatus).toBe(false);

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
      const role = await freezeRegistryContract.address_to_role(adminAddress);

      expect(role).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
    }

    const role = await freezeRegistryContract.address_to_role(adminAddress, NONE_ROLE);
    if ((role & FREEZELIST_MANAGER_ROLE) !== FREEZELIST_MANAGER_ROLE) {
      let tx = await freezeRegistryContractForAdmin.update_role(adminAddress, MANAGER_ROLE + FREEZELIST_MANAGER_ROLE);
      await tx.wait();
      const role = await freezeRegistryContract.address_to_role(adminAddress);
      expect(role).toBe(MANAGER_ROLE + FREEZELIST_MANAGER_ROLE);
    }

    const isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount, false);
    if (!isAccountFrozen) {
      const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      let tx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, currentRoot, root);
      await tx.wait();
      let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
      let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);
    }
  });

  test(`test update_roles`, async () => {
    // Manager can assign role
    let tx = await tokenContractForAdmin.update_role(frozenAccount, MANAGER_ROLE);
    await tx.wait();
    let role = await tokenContract.address_to_role(frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    tx = await tokenContractForAdmin.update_role(frozenAccount, NONE_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    let rejectedTx = await tokenContractForFrozenAccount.update_role(frozenAccount, MANAGER_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update minter role
    rejectedTx = await tokenContractForAccount.update_role(minter, MINTER_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update burner role
    rejectedTx = await tokenContractForAccount.update_role(burner, BURNER_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update supply manager role
    rejectedTx = await tokenContractForAccount.update_role(supplyManager, MINTER_ROLE + BURNER_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update none role
    rejectedTx = await tokenContractForAccount.update_role(account, NONE_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update pause role
    rejectedTx = await tokenContractForAccount.update_role(account, PAUSE_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager cannot unassign himself from being a manager
    rejectedTx = await tokenContractForAdmin.update_role(adminAddress, NONE_ROLE);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager can assign minter, burner, manager, pauser and supply manager roles
    tx = await tokenContractForAdmin.update_role(minter, MINTER_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(minter);
    expect(role).toBe(MINTER_ROLE);

    tx = await tokenContractForAdmin.update_role(burner, BURNER_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(burner);
    expect(role).toBe(BURNER_ROLE);

    tx = await tokenContractForAdmin.update_role(supplyManager, MINTER_ROLE + BURNER_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);

    tx = await tokenContractForAdmin.update_role(account, NONE_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(account);
    expect(role).toBe(NONE_ROLE);

    tx = await tokenContractForAdmin.update_role(pauser, PAUSE_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(pauser);
    expect(role).toBe(PAUSE_ROLE);

    tx = await tokenContractForAdmin.update_role(adminAddress, MANAGER_ROLE);
    await tx.wait();
    role = await tokenContract.address_to_role(adminAddress);
    expect(role).toBe(MANAGER_ROLE);
  });

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  let privateAccountBalance = 0n;
  let startBlock = 0;
  test(`test mint_private`, async () => {
    startBlock = await getLatestBlockHeight();

    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

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
    const [, encryptedFrozenAccountRecord] = await tx.wait();
    frozenAccountRecord = decryptToken(encryptedFrozenAccountRecord, frozenAccountPrivKey);
    expect(frozenAccountRecord.amount).toBe(amount * 20n);
    expect(frozenAccountRecord.owner).toBe(frozenAccount);

    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount * 20n);

    tx = await tokenContractForSupplyManager.mint_private(account, amount * 20n);
    const [complianceRecord, encryptedAccountRecord] = await tx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    expect(accountRecord.amount).toBe(amount * 20n);
    expect(accountRecord.owner).toBe(account);

    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount * 40n);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount * 20n);
    expect(decryptedComplianceRecord.sender).toBe(ZERO_ADDRESS);
    expect(decryptedComplianceRecord.recipient).toBe(account);

    privateAccountBalance += amount * 20n;
  });

  test(`test mint_public`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

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
    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount * 20n);

    tx = await tokenContractForSupplyManager.mint_public(account, amount * 20n);
    await tx.wait();
    balance = await tokenContract.balances(account);
    expect(balance).toBe(amount * 20n);
    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount * 40n);
  });

  test(`test burn_public`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

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
    tokenInfo = await tokenContract.token_info(true);
    expect(supply - tokenInfo.supply).toBe(amount);

    tx = await tokenContractForSupplyManager.burn_public(account, amount);
    await tx.wait();
    tokenInfo = await tokenContract.token_info(true);
    expect(supply - tokenInfo.supply).toBe(amount * 2n);

    let balance = await tokenContract.balances(account);
    expect(balance).toBe(previousAccountPublicBalance - amount * 2n);
  });

  test(`test burn_private`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

    // A user that doesn't have a burner role cannot burn private assets
    let rejectedTx = await tokenContractForAccount.burn_private(accountRecord, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let mintTx = await tokenContractForMinter.mint_private(burner, amount);
    let [, encryptedAdminRecord] = await mintTx.wait();
    let adminRecord = decryptToken(encryptedAdminRecord, burnerPrivKey);
    expect(adminRecord.amount).toBe(amount);
    expect(adminRecord.owner).toBe(burner);
    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount);

    let burnTx = await tokenContractForBurner.burn_private(adminRecord, amount);
    let [complianceRecordFromBurning, encryptedAdminRecordFromBurning] = await burnTx.wait();
    adminRecord = decryptToken(encryptedAdminRecordFromBurning, burnerPrivKey);
    expect(adminRecord.amount).toBe(0n);
    expect(adminRecord.owner).toBe(burner);
    tokenInfo = await tokenContract.token_info(true);
    expect(supply).toBe(tokenInfo.supply);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecordFromBurning, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(burner);
    expect(decryptedComplianceRecord.recipient).toBe(ZERO_ADDRESS);

    // check that MINTER_ROLE+BURNER_ROLE can burn private assets
    mintTx = await tokenContractForMinter.mint_private(supplyManager, amount);
    let [, encryptedSupplyManager] = await mintTx.wait();
    let supplyManagerRecord = decryptToken(encryptedSupplyManager, supplyManagerPrivKey);
    expect(supplyManagerRecord.amount).toBe(amount);
    expect(supplyManagerRecord.owner).toBe(supplyManager);
    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount);

    burnTx = await tokenContractForSupplyManager.burn_private(supplyManagerRecord, amount);
    [, encryptedSupplyManager] = await burnTx.wait();
    supplyManagerRecord = decryptToken(encryptedSupplyManager, supplyManagerPrivKey);
    expect(supplyManagerRecord.amount).toBe(0n);
    expect(supplyManagerRecord.owner).toBe(supplyManager);
    tokenInfo = await tokenContract.token_info(true);
    expect(supply).toBe(tokenInfo.supply);
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
    let rejectedTx = await tokenContractForSpender.transfer_from_public_to_private(account, recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();
    let unapproveTx = await tokenContractForAccount.unapprove_public(spender, amount);
    await unapproveTx.wait();

    // If the sender approve and then unapprove the spender the transaction will fail
    rejectedTx = await tokenContractForSpender.transfer_from_public_to_private(account, recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // approve the spender
    approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();
    approveTx = await tokenContractForFrozenAccount.approve_public(spender, amount);
    await approveTx.wait();

    // If the sender is frozen account it's impossible to send tokens
    rejectedTx = await tokenContractForSpender.transfer_from_public_to_private(frozenAccount, recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);

    const tx = await tokenContractForSpender.transfer_from_public_to_private(account, recipient, amount);
    const [complianceRecord, encryptedRecipientRecord] = await tx.wait();
    const recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    const accountPublicBalance = await tokenContract.balances(account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test(`test transfer_public_to_priv`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    let rejectedTx = await tokenContractForFrozenAccount.transfer_public_to_private(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);

    const tx = await tokenContractForAccount.transfer_public_to_private(recipient, amount);
    const [complianceRecord, tokenRecord] = await tx.wait();
    const recipientRecord = decryptToken(tokenRecord, recipientPrivKey);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    const accountPublicBalance = await tokenContract.balances(account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test(`test transfer_private`, async () => {
    // If the sender is frozen account it's impossible to send tokens
    await expect(
      tokenContractForFrozenAccount.transfer_private(recipient, amount, accountRecord, frozenAccountMerkleProof),
    ).rejects.toThrow();

    const tx = await tokenContractForAccount.transfer_private(recipient, amount, accountRecord, senderMerkleProof);
    privateAccountBalance -= amount;
    const [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    const recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
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
      senderMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousRecipientPublicBalance = await tokenContract.balances(recipient, 0n);

    const tx = await tokenContractForAccount.transfer_private_to_public(
      recipient,
      amount,
      accountRecord,
      senderMerkleProof,
    );
    privateAccountBalance -= amount;
    const [complianceRecord, encryptedAccountRecord] = await tx.wait();

    const previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    const recipientPublicBalance = await tokenContract.balances(recipient);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  let credentials: Credentials;
  test(`test get_credentials`, async () => {
    // It's impossible to get the credentials record with an invalid merkle proof
    await expect(tokenContractForFrozenAccount.get_credentials(frozenAccountMerkleProof)).rejects.toThrow();

    const randomAddress = new Account().address().to_string();
    const leaves = generateLeaves([randomAddress]);
    const tree = buildTree(leaves);
    const senderLeafIndices = getLeafIndices(tree, account);
    const IncorrectSenderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH),
    ];

    // If the root doesn't match the on-chain root the transaction will be rejected
    const rejectedTx = await tokenContractForAccount.get_credentials(IncorrectSenderMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenContractForAccount.get_credentials(senderMerkleProof);
    const [encryptedTicket] = await tx.wait();
    credentials = await decryptCredentials(encryptedTicket, accountPrivKey);
    expect(credentials.owner).toBe(account);
    expect(credentials.freeze_list_root).toBe(root);
  });

  test(`test transfer with credentials`, async () => {
    let transferPrivateTx = await tokenContractForAccount.transfer_private_with_creds(
      recipient,
      amount,
      accountRecord,
      credentials,
    );
    privateAccountBalance -= amount;
    let [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord, encryptedCredRecord] =
      await transferPrivateTx.wait();
    credentials = await decryptCredentials(encryptedCredRecord, accountPrivKey);
    expect(credentials.owner).toBe(account);
    expect(credentials.freeze_list_root).toBe(root);
    let previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    let recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    let decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);

    // Update the root to make the old credentials expired
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

    let rejectedTransferPrivateTx = await tokenContractForAccount.transfer_private_with_creds(
      recipient,
      amount,
      accountRecord,
      credentials,
    );
    await expect(rejectedTransferPrivateTx.wait()).rejects.toThrow();

    // bring back the old root
    updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(frozenAccount, true, 1, 1n, root);
    await updateFreezeListTx.wait();
    updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(BLOCK_HEIGHT_WINDOW);
    await updateBlockHeightWindowTx.wait();

    transferPrivateTx = await tokenContractForAccount.transfer_private_with_creds(
      recipient,
      amount,
      accountRecord,
      credentials,
    );
    privateAccountBalance -= amount;
    [complianceRecord, encryptedSenderRecord, encryptedRecipientRecord, encryptedCredRecord] =
      await transferPrivateTx.wait();
    credentials = await decryptCredentials(encryptedCredRecord, accountPrivKey);
    expect(credentials.owner).toBe(account);
    expect(credentials.freeze_list_root).toBe(root);
    previousAmount = accountRecord.amount;
    accountRecord = decryptToken(encryptedSenderRecord, accountPrivKey);
    recipientRecord = decryptToken(encryptedRecipientRecord, recipientPrivKey);
    expect(accountRecord.owner).toBe(account);
    expect(accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(recipient);
    expect(recipientRecord.amount).toBe(amount);

    decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, deployerPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(deployerAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  });

  test(`test pausing the contract`, async () => {
    // Only the pauser can pause the program
    const rejectedTx = await tokenContractForAdmin.set_pause_status(true);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();

    // pause the contract
    let pauseTx = await tokenContractForPauser.set_pause_status(true);
    await pauseTx.wait();
    let pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(true);

    // verify that all the functionalities are paused
    const mintTx = await tokenContractForMinter.mint_public(recipient, amount);
    await expect(mintTx.wait()).rejects.toThrow();

    const mintPrivateTx = await tokenContractForMinter.mint_private(recipient, amount);
    await expect(mintPrivateTx.wait()).rejects.toThrow();

    const burnTx = await tokenContractForBurner.burn_public(recipient, amount);
    await expect(burnTx.wait()).rejects.toThrow();

    let publicTx = await tokenContractForAccount.transfer_public(recipient, amount);
    await expect(publicTx.wait()).rejects.toThrow();

    const publicAsSignerTx = await tokenContractForAccount.transfer_public_as_signer(recipient, amount);
    await expect(publicAsSignerTx.wait()).rejects.toThrow();

    approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await expect(approveTx.wait()).rejects.toThrow();

    const unapproveTx = await tokenContractForAccount.unapprove_public(spender, amount);
    await expect(unapproveTx.wait()).rejects.toThrow();

    const fromPublicTx = await tokenContractForSpender.transfer_from_public(account, recipient, amount);
    await expect(fromPublicTx.wait()).rejects.toThrow();

    const fromPublicToPrivateTx = await tokenContractForSpender.transfer_from_public_to_private(
      account,
      recipient,
      amount,
    );
    await expect(fromPublicToPrivateTx.wait()).rejects.toThrow();

    const publicToPrivate = await tokenContractForAccount.transfer_public_to_private(recipient, amount);
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

    let privateWithTicketTx = await tokenContractForAccount.transfer_private_with_creds(
      recipient,
      amount,
      accountRecord,
      credentials,
    );
    await expect(privateWithTicketTx.wait()).rejects.toThrow();

    // unpause the contract
    pauseTx = await tokenContractForPauser.set_pause_status(false);
    await pauseTx.wait();
    pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(false);

    //verify that the functionalities are back (one is enough)
    publicTx = await tokenContractForAccount.transfer_public(recipient, amount);
    await publicTx.wait();
  });

  test(`calculate private balance`, async () => {
    const networkClient = new AleoNetworkClient(contract.config.network.endpoint);
    const latestBlockHeight = await getLatestBlockHeight();
    let calculatedAccountBalance = 0n;
    let calculatedBurnerBalance = 0n;
    while (latestBlockHeight > startBlock) {
      const endBlock = Math.min(startBlock + 50, latestBlockHeight);
      const blockRange = await networkClient.getBlockRange(startBlock, endBlock);
      startBlock += 50;
      for (const block of blockRange) {
        if (!block.transactions || block.transactions.length === 0) {
          // Skip empty blocks
          continue;
        }
        for (const tx of block.transactions) {
          if (!tx.transaction?.execution?.transitions) continue;
          for (const transition of tx.transaction?.execution?.transitions ?? []) {
            if (
              transition.program === "compliant_token_template.aleo" &&
              transition.outputs &&
              transition.outputs[0].type === "record"
            ) {
              try {
                const complianceRecord = transition.outputs[0].value;
                const { recipient, sender, amount } = decryptComplianceRecord(complianceRecord, deployerPrivKey);
                if (
                  sender === account &&
                  !["transfer_from_public_to_private", "transfer_public_to_private"].includes(transition.function)
                ) {
                  calculatedAccountBalance -= amount;
                }
                if (recipient === account && transition.function !== "transfer_private_to_public") {
                  calculatedAccountBalance += amount;
                }
                if (
                  sender === burner &&
                  !["transfer_from_public_to_private", "transfer_public_to_private"].includes(transition.function)
                ) {
                  calculatedBurnerBalance -= amount;
                }
                if (recipient === burner && transition.function !== "transfer_private_to_public") {
                  calculatedBurnerBalance += amount;
                }
              } catch {}
            }
          }
        }
      }
    }
    expect(calculatedAccountBalance).toBe(privateAccountBalance);
    expect(calculatedBurnerBalance).toBe(0n);
  });
});
