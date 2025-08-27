import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { decryptComplianceRecord } from "../artifacts/js/leo2js/sealed_report_policy";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  INVESTIGATOR_INDEX,
  MAX_TREE_SIZE,
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
import { Account } from "@provablehq/sdk";
import { Sealed_report_tokenContract } from "../artifacts/js/sealed_report_token";
import { stringToBigInt } from "../lib/Conversion";
import { decryptToken } from "../artifacts/js/leo2js/sealed_report_token";
import { Token } from "../artifacts/js/types/sealed_report_token";

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

const reportTokenContract = new Sealed_report_tokenContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportTokenContractForAdmin = new Sealed_report_tokenContract({
  mode,
  privateKey: adminPrivKey,
});
const reportTokenContractForAccount = new Sealed_report_tokenContract({
  mode,
  privateKey: accountPrivKey,
});
const reportTokenContractForMinter = new Sealed_report_tokenContract({
  mode,
  privateKey: minterPrivKey,
});
const reportTokenContractForBurner = new Sealed_report_tokenContract({
  mode,
  privateKey: burnerPrivKey,
});
const reportTokenContractForSupplyManager = new Sealed_report_tokenContract({
  mode,
  privateKey: supplyManagerPrivKey,
});
const reportTokenContractForSpender = new Sealed_report_tokenContract({
  mode,
  privateKey: spenderPrivKey,
});
const reportTokenContractForFrozenAccount = new Sealed_report_tokenContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

const amount = 10n;
let root: bigint;

describe("test sealed_report_token program", () => {

  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);

    await fundWithCredits(deployerPrivKey, minter, fundedAmount);
    await fundWithCredits(deployerPrivKey, supplyManager, fundedAmount);
    await fundWithCredits(deployerPrivKey, burner, fundedAmount);
    await fundWithCredits(deployerPrivKey, spender, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(reportTokenContract);
  });

  test(
    `test update_admin_address`,
    async () => {
      let tx = await reportTokenContractForAdmin.update_role(frozenAccount, ADMIN_INDEX);
      await tx.wait();
      let adminRole = await reportTokenContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(frozenAccount);

      tx = await reportTokenContractForFrozenAccount.update_role(adminAddress, ADMIN_INDEX);
      await tx.wait();
      adminRole = await reportTokenContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(adminAddress);

      tx = await reportTokenContractForFrozenAccount.update_role(frozenAccount, ADMIN_INDEX);
      await expect(tx.wait()).rejects.toThrow();
    },
  );

  test(
    `test update_investigator_address`,
    async () => {
      let tx = await reportTokenContractForAdmin.update_role(frozenAccount, INVESTIGATOR_INDEX);
      await tx.wait();
      let investigatorRole = await reportTokenContract.roles(INVESTIGATOR_INDEX);
      expect(investigatorRole).toBe(frozenAccount);

      tx = await reportTokenContractForAdmin.update_role(investigatorAddress, INVESTIGATOR_INDEX);
      await tx.wait();
      investigatorRole = await reportTokenContract.roles(INVESTIGATOR_INDEX);
      expect(investigatorRole).toBe(investigatorAddress);

      const rejectedTx = await reportTokenContractForFrozenAccount.update_role(frozenAccount, INVESTIGATOR_INDEX);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
  );

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let recipientMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(
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
  );

  test(
    `test initialize`,
    async () => {
      // Cannot update freeze list before initialization
      let rejectedTx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, true, 1, 0n, root);
      await expect(rejectedTx.wait()).rejects.toThrow();
      const name = stringToBigInt("Report Token");
      const symbol = stringToBigInt("REPORT_TOKEN");
      const decimals = 6;
      const maxSupply = 1000_000000000000n;

      const tx = await reportTokenContract.initialize(name, symbol, decimals, maxSupply, BLOCK_HEIGHT_WINDOW);
      await tx.wait();

      const isAccountFrozen = await reportTokenContract.freeze_list(ZERO_ADDRESS);
      const frozenAccountByIndex = await reportTokenContract.freeze_list_index(0);
      const lastIndex = await reportTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await reportTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await reportTokenContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);

      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

      // It is possible to call to initialize only one time
      rejectedTx = await reportTokenContract.initialize(name, symbol, decimals, maxSupply, BLOCK_HEIGHT_WINDOW);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
  );

  test(
    `test update_supply_role`,
    async () => {
      // Non admin user cannot update minter role
      let rejectedTx = await reportTokenContractForAccount.update_supply_role(minter, MINTER_ROLE);
      await expect(rejectedTx.wait()).rejects.toThrow();
      // Non admin user cannot update burner role
      rejectedTx = await reportTokenContractForAccount.update_supply_role(burner, BURNER_ROLE);
      await expect(rejectedTx.wait()).rejects.toThrow();
      // Non admin user cannot update supply manager role
      rejectedTx = await reportTokenContractForAccount.update_supply_role(supplyManager, SUPPLY_MANAGER_ROLE);
      await expect(rejectedTx.wait()).rejects.toThrow();
      // Non admin user cannot update none role
      rejectedTx = await reportTokenContractForAccount.update_supply_role(account, SUPPLY_MANAGER_ROLE);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await reportTokenContractForAdmin.update_supply_role(minter, MINTER_ROLE);
      await tx.wait();
      let role = await reportTokenContract.supply_roles(minter);
      expect(role).toBe(MINTER_ROLE);

      tx = await reportTokenContractForAdmin.update_supply_role(burner, BURNER_ROLE);
      await tx.wait();
      role = await reportTokenContract.supply_roles(burner);
      expect(role).toBe(BURNER_ROLE);

      tx = await reportTokenContractForAdmin.update_supply_role(supplyManager, SUPPLY_MANAGER_ROLE);
      await tx.wait();
      role = await reportTokenContract.supply_roles(supplyManager);
      expect(role).toBe(SUPPLY_MANAGER_ROLE);

      tx = await reportTokenContractForAdmin.update_supply_role(account, NONE_ROLE);
      await tx.wait();
      role = await reportTokenContract.supply_roles(account);
      expect(role).toBe(NONE_ROLE);
    },
  );

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test(
    `test mint_private`,
    async () => {
      // a regular user cannot mint private assets
      let rejectedTx = await reportTokenContractForAccount.mint_private(account, amount * 20n);
      await expect(rejectedTx.wait()).rejects.toThrow();
      // a burner cannot mint private assets
      rejectedTx = await reportTokenContractForBurner.mint_private(account, amount * 20n);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await reportTokenContractForAdmin.mint_private(account, amount * 20n);
      const [encryptedAccountRecord] = await tx.wait();
      accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
      expect(accountRecord.amount).toBe(amount * 20n);
      expect(accountRecord.owner).toBe(account);

      tx = await reportTokenContractForMinter.mint_private(frozenAccount, amount * 20n);
      const [encryptedFrozenAccountRecord] = await tx.wait();
      frozenAccountRecord = decryptToken(encryptedFrozenAccountRecord, frozenAccountPrivKey);
      expect(frozenAccountRecord.amount).toBe(amount * 20n);
      expect(frozenAccountRecord.owner).toBe(frozenAccount);

      tx = await reportTokenContractForSupplyManager.mint_private(account, amount * 20n);
      await tx.wait();
    },
  );

  test(
    `test mint_public`,
    async () => {
      // a regular user cannot mint public assets
      let rejectedTx = await reportTokenContractForAccount.mint_public(account, amount * 20n);
      await expect(rejectedTx.wait()).rejects.toThrow();
      // a burner cannot mint public assets
      rejectedTx = await reportTokenContractForBurner.mint_public(account, amount * 20n);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await reportTokenContractForAdmin.mint_public(account, amount * 20n);
      await tx.wait();
      let balance = await reportTokenContract.balances(account);
      expect(balance).toBe(amount * 20n);

      tx = await reportTokenContractForMinter.mint_public(frozenAccount, amount * 20n);
      await tx.wait();
      balance = await reportTokenContract.balances(frozenAccount);
      expect(balance).toBe(amount * 20n);

      tx = await reportTokenContractForSupplyManager.mint_public(account, amount * 20n);
      await tx.wait();
      balance = await reportTokenContract.balances(account);
      expect(balance).toBe(amount * 40n);
    },
  );

  test(
    `test burn_private`,
    async () => {
      // A user that is not burner, supply manager, or admin  cannot burn private assets
      let rejectedTx = await reportTokenContractForAccount.burn_private(accountRecord, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let mintTx = await reportTokenContractForAdmin.mint_private(adminAddress, amount);
      let [encryptedAdminRecord] = await mintTx.wait();
      let adminRecord = decryptToken(encryptedAdminRecord, adminPrivKey);
      expect(adminRecord.amount).toBe(amount);
      expect(adminRecord.owner).toBe(adminAddress);
      let burnTx = await reportTokenContractForAdmin.burn_private(adminRecord, amount);
      [encryptedAdminRecord] = await burnTx.wait();
      adminRecord = decryptToken(encryptedAdminRecord, adminPrivKey);
      expect(adminRecord.amount).toBe(0n);
      expect(adminRecord.owner).toBe(adminAddress);

      mintTx = await reportTokenContractForAdmin.mint_private(burner, amount);
      let [encryptedBurnerRecord] = await mintTx.wait();
      let burnerRecord = decryptToken(encryptedBurnerRecord, burnerPrivKey);
      expect(burnerRecord.amount).toBe(amount);
      expect(burnerRecord.owner).toBe(burner);
      burnTx = await reportTokenContractForBurner.burn_private(burnerRecord, amount);
      [encryptedBurnerRecord] = await burnTx.wait();
      burnerRecord = decryptToken(encryptedBurnerRecord, burnerPrivKey);
      expect(burnerRecord.amount).toBe(0n);
      expect(burnerRecord.owner).toBe(burner);

      mintTx = await reportTokenContractForAdmin.mint_private(supplyManager, amount);
      let [encryptedSupplyManager] = await mintTx.wait();
      let supplyManagerRecord = decryptToken(encryptedSupplyManager, supplyManagerPrivKey);
      expect(supplyManagerRecord.amount).toBe(amount);
      expect(supplyManagerRecord.owner).toBe(supplyManager);
      burnTx = await reportTokenContractForSupplyManager.burn_private(supplyManagerRecord, amount);
      [encryptedSupplyManager] = await burnTx.wait();
      supplyManagerRecord = decryptToken(encryptedSupplyManager, supplyManagerPrivKey);
      expect(supplyManagerRecord.amount).toBe(0n);
      expect(supplyManagerRecord.owner).toBe(supplyManager);
    },
  );

  test(
    `test burn_public`,
    async () => {
      // A regular user cannot burn public assets
      let rejectedTx = await reportTokenContractForAccount.burn_public(account, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // A minter user cannot burn public assets
      rejectedTx = await reportTokenContractForMinter.burn_public(account, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousAccountPublicBalance = await reportTokenContract.balances(account);
      let tx = await reportTokenContractForAdmin.burn_public(account, amount);
      await tx.wait();
      let balance = await reportTokenContract.balances(account);
      expect(balance).toBe(previousAccountPublicBalance - amount);

      tx = await reportTokenContractForBurner.burn_public(account, amount);
      await tx.wait();
      balance = await reportTokenContract.balances(account);
      expect(balance).toBe(previousAccountPublicBalance - amount * 2n);

      tx = await reportTokenContractForSupplyManager.burn_public(account, amount);
      await tx.wait();
      balance = await reportTokenContract.balances(account);
      expect(balance).toBe(previousAccountPublicBalance - amount * 3n);
    },
  );

  test(
    `test update_freeze_list`,
    async () => {
      const currentRoot = await reportTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

      // Only the admin can call to update_freeze_list
      let rejectedTx = await reportTokenContractForFrozenAccount.update_freeze_list(
        adminAddress,
        true,
        1,
        currentRoot,
        root,
      );

      // Cannot unfreeze an unfrozen account
      rejectedTx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, false, 1, currentRoot, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot update the root if the previous root is incorrect
      rejectedTx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, false, 1, 0n, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, true, 1, currentRoot, root);
      await tx.wait();
      let isAccountFrozen = await reportTokenContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await reportTokenContract.freeze_list_index(1);
      let lastIndex = await reportTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);

      // Cannot unfreeze an account when the frozen list index is incorrect
      rejectedTx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, false, 2, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot freeze a frozen account
      rejectedTx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, true, 1, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      tx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, false, 1, root, root);
      await tx.wait();
      isAccountFrozen = await reportTokenContract.freeze_list(frozenAccount);
      frozenAccountByIndex = await reportTokenContract.freeze_list_index(1);
      lastIndex = await reportTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(1);

      tx = await reportTokenContractForAdmin.update_freeze_list(frozenAccount, true, 1, root, root);
      await tx.wait();
      isAccountFrozen = await reportTokenContract.freeze_list(frozenAccount);
      frozenAccountByIndex = await reportTokenContract.freeze_list_index(1);
      lastIndex = await reportTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);

      let randomAddress = new Account().address().to_string();
      tx = await reportTokenContractForAdmin.update_freeze_list(randomAddress, true, 2, root, root);
      await tx.wait();
      isAccountFrozen = await reportTokenContractForAdmin.freeze_list(randomAddress);
      frozenAccountByIndex = await reportTokenContractForAdmin.freeze_list_index(2);
      lastIndex = await reportTokenContractForAdmin.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(randomAddress);
      expect(lastIndex).toBe(2);

      randomAddress = new Account().address().to_string();
      // Cannot freeze an account when the frozen list index is greater than the last index
      rejectedTx = await reportTokenContractForAdmin.update_freeze_list(randomAddress, true, 10, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Cannot freeze an account when the frozen list index is already taken
      rejectedTx = await reportTokenContractForAdmin.update_freeze_list(randomAddress, true, 2, root, root);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
  );

  test(
    `test update_block_height_window`,
    async () => {
      const rejectedTx = await reportTokenContractForAccount.update_block_height_window(BLOCK_HEIGHT_WINDOW);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await reportTokenContractForAdmin.update_block_height_window(BLOCK_HEIGHT_WINDOW);
      await tx.wait();
    },
  );

  test(
    `test transfer_public`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      let rejectedTx = await reportTokenContractForFrozenAccount.transfer_public(recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await reportTokenContractForAccount.transfer_public(frozenAccount, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousAccountPublicBalance = await reportTokenContract.balances(account);
      const previousRecipientPublicBalance = await reportTokenContract.balances(recipient, 0n);

      const tx = await reportTokenContractForAccount.transfer_public(recipient, amount);
      await tx.wait();

      const accountPublicBalance = await reportTokenContract.balances(account);
      const recipientPublicBalance = await reportTokenContract.balances(recipient);
      expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
      expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
    },
  );

  test(
    `test transfer_public_as_signer`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      let rejectedTx = await reportTokenContractForFrozenAccount.transfer_public_as_signer(recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await reportTokenContractForAccount.transfer_public_as_signer(frozenAccount, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousAccountPublicBalance = await reportTokenContract.balances(account);
      const previousRecipientPublicBalance = await reportTokenContract.balances(recipient, 0n);

      const tx = await reportTokenContractForAccount.transfer_public_as_signer(recipient, amount);
      await tx.wait();

      const accountPublicBalance = await reportTokenContract.balances(account);
      const recipientPublicBalance = await reportTokenContract.balances(recipient);
      expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
      expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
    },
  );

  test(
    `test transfer_from_public`,
    async () => {
      // If the sender didn't approve the spender the transaction will fail
      let rejectedTx = await reportTokenContractForSpender.transfer_from_public(account, recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      let approveTx = await reportTokenContractForAccount.approve_public(spender, amount);
      await approveTx.wait();
      let unapproveTx = await reportTokenContractForAccount.unapprove_public(spender, amount);
      await unapproveTx.wait();

      // If the sender approve and then unapprove the spender the transaction will fail
      rejectedTx = await reportTokenContractForSpender.transfer_from_public(account, recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // approve the spender
      approveTx = await reportTokenContractForAccount.approve_public(spender, amount);
      await approveTx.wait();
      approveTx = await reportTokenContractForFrozenAccount.approve_public(spender, amount);
      await approveTx.wait();

      // If the sender is frozen account it's impossible to send tokens
      rejectedTx = await reportTokenContractForSpender.transfer_from_public(frozenAccount, recipient, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await reportTokenContractForSpender.transfer_from_public(account, frozenAccount, amount);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousAccountPublicBalance = await reportTokenContract.balances(account);
      const previousRecipientPublicBalance = await reportTokenContract.balances(recipient, 0n);

      const tx = await reportTokenContractForSpender.transfer_from_public(account, recipient, amount);
      await tx.wait();

      const accountPublicBalance = await reportTokenContract.balances(account);
      const recipientPublicBalance = await reportTokenContract.balances(recipient);
      expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
      expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
    },
  );

  test(
    `test transfer_from_public_to_private`,
    async () => {
      // If the sender didn't approve the spender the transaction will fail
      let rejectedTx = await reportTokenContractForSpender.transfer_from_public_to_private(
        account,
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      let approveTx = await reportTokenContractForAccount.approve_public(spender, amount);
      await approveTx.wait();
      let unapproveTx = await reportTokenContractForAccount.unapprove_public(spender, amount);
      await unapproveTx.wait();

      // If the sender approve and then unapprove the spender the transaction will fail
      rejectedTx = await reportTokenContractForSpender.transfer_from_public_to_private(
        account,
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // approve the spender
      approveTx = await reportTokenContractForAccount.approve_public(spender, amount);
      await approveTx.wait();
      approveTx = await reportTokenContractForFrozenAccount.approve_public(spender, amount);
      await approveTx.wait();

      // If the sender is frozen account it's impossible to send tokens
      rejectedTx = await reportTokenContractForSpender.transfer_from_public_to_private(
        frozenAccount,
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      await expect(
        reportTokenContractForSpender.transfer_from_public_to_private(
          account,
          frozenAccount,
          amount,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      // If the investigator address is wrong it's impossible to send tokens
      rejectedTx = await reportTokenContractForSpender.transfer_from_public_to_private(
        account,
        recipient,
        amount,
        recipientMerkleProof,
        ZERO_ADDRESS,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousAccountPublicBalance = await reportTokenContract.balances(account);

      const tx = await reportTokenContractForSpender.transfer_from_public_to_private(
        account,
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
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

      const accountPublicBalance = await reportTokenContract.balances(account);
      expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    },
  );

  test(
    `test transfer_public_to_priv`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      let rejectedTx = await reportTokenContractForFrozenAccount.transfer_public_to_private(
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      await expect(
        reportTokenContractForAccount.transfer_public_to_private(
          frozenAccount,
          amount,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      // If the investigator address is wrong it's impossible to send tokens
      rejectedTx = await reportTokenContractForAccount.transfer_public_to_private(
        recipient,
        amount,
        recipientMerkleProof,
        ZERO_ADDRESS,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousAccountPublicBalance = await reportTokenContract.balances(account);

      const tx = await reportTokenContractForAccount.transfer_public_to_private(
        recipient,
        amount,
        recipientMerkleProof,
        investigatorAddress,
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

      const accountPublicBalance = await reportTokenContract.balances(account);
      expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    },
  );

  test(
    `test transfer_private`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      await expect(
        reportTokenContractForFrozenAccount.transfer_private(
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
        reportTokenContractForAccount.transfer_private(
          frozenAccount,
          amount,
          accountRecord,
          senderMerkleProof,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      // If the investigator address is wrong it's impossible to send tokens
      const rejectedTx = await reportTokenContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        ZERO_ADDRESS,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await reportTokenContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
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
    },
  );

  test(
    `test transfer_priv_to_public`,
    async () => {
      // If the sender is frozen account it's impossible to send tokens
      await expect(
        reportTokenContractForFrozenAccount.transfer_private_to_public(
          recipient,
          amount,
          frozenAccountRecord,
          frozenAccountMerkleProof,
          investigatorAddress,
        ),
      ).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      let rejectedTx = await reportTokenContractForAccount.transfer_private_to_public(
        frozenAccount,
        amount,
        accountRecord,
        senderMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the investigator address is wrong it's impossible to send tokens
      rejectedTx = await reportTokenContractForAccount.transfer_private_to_public(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        ZERO_ADDRESS,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const previousRecipientPublicBalance = await reportTokenContract.balances(recipient, 0n);

      const tx = await reportTokenContractForAccount.transfer_private_to_public(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        investigatorAddress,
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

      const recipientPublicBalance = await reportTokenContract.balances(recipient);
      expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
    },
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
      let rejectedTx = await reportTokenContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        IncorrectSenderMerkleProof,
        IncorrectRecipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const updateFreezeListTx = await reportTokenContractForAdmin.update_freeze_list(
        frozenAccount,
        false,
        1,
        root,
        1n, // fake root
      );
      await updateFreezeListTx.wait();

      const newRoot = await reportTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const oldRoot = await reportTokenContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
      expect(oldRoot).toBe(root);
      expect(newRoot).toBe(1n);

      // The transaction succeed because the old root is match
      const tx = await reportTokenContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
      );
      const [, encryptedAccountRecord] = await tx.wait();
      accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);

      const updateBlockHeightWindowTx = await reportTokenContractForAdmin.update_block_height_window(1);
      await updateBlockHeightWindowTx.wait();

      // The transaction failed because the old root is expired
      rejectedTx = await reportTokenContractForAccount.transfer_private(
        recipient,
        amount,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        investigatorAddress,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
  );
});
