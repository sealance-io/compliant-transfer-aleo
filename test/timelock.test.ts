import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptCompliantToken } from "../artifacts/js/leo2js/sealed_timelock_policy";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";

import {
  MAX_TREE_SIZE,
  ZERO_ADDRESS,
  COMPLIANT_TIMELOCK_TRANSFER_ADDRESS,
  fundedAmount,
  policies,
  ADMIN_INDEX,
  MINTER_INDEX,
  BLOCK_HEIGHT_WINDOW,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import type { Token } from "../artifacts/js/types/token_registry";
import type { CompliantToken } from "../artifacts/js/types/sealed_timelock_policy";
import { updateAdminRole } from "../lib/Role";
import { isProgramInitialized } from "../lib/Initalize";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, _, frozenAccount, account, recipient] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);

const tokenRegistryContract = new Token_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenRegistryContractForAccount = new Token_registryContract({
  mode,
  privateKey: accountPrivKey,
});
const timelockContract = new Sealed_timelock_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const timelockContractForAdmin = new Sealed_timelock_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const timelockContractForAccount = new Sealed_timelock_policyContract({
  mode,
  privateKey: accountPrivKey,
});
const timelockContractForRecipient = new Sealed_timelock_policyContract({
  mode,
  privateKey: recipientPrivKey,
});
const timelockContractForFrozenAccount = new Sealed_timelock_policyContract({
  mode,
  privateKey: frozenAccountPrivKey,
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

const amount = 10n;
let root: bigint;

async function getLatestBlockHeight() {
  const response = (await fetch(
    `${contract.config.network.endpoint}/${contract.config.networkName}/block/height/latest`,
  )) as any;
  const latestBlockHeight = (await response.json()) as number;
  return latestBlockHeight;
}

let accountRecord: Token, accountTokenRecord;
let accountSealedRecord: CompliantToken, accountSealedRecord2;
let frozenAccountRecord: Token;
let frozenAccountSealedRecord: CompliantToken, frozenAccountSealedRecord2: CompliantToken;
let recipientSealedRecord;
let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
let recipientMerkleProof: { siblings: any[]; leaf_index: any }[];
let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];

describe("test compliant_timelock_transfer program", () => {

  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
    await fundWithCredits(deployerPrivKey, recipient, fundedAmount);

    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(timelockContract);

    await initializeTokenProgram(
      deployerPrivKey,
      deployerAddress,
      adminPrivKey,
      adminAddress,
      ZERO_ADDRESS,
      policies.timelock,
    );
  });

  test(
    `test update_roles`,
    async () => {
      const onChainAdmin = await timelockContract.roles(ADMIN_INDEX);
      expect(onChainAdmin).toBe(adminAddress);

      let tx = await timelockContractForFrozenAccount.update_role(adminAddress, ADMIN_INDEX);
      await expect(tx.wait()).rejects.toThrow();

      tx = await timelockContractForAdmin.update_role(recipient, MINTER_INDEX);
      await tx.wait();
    },
  );

  test(
    "fund tokens",
    async () => {
      let mintPublicTx = await timelockContractForAdmin.mint_public(account, amount * 20n, 0);
      const [encryptedAccountSealedRecord] = await mintPublicTx.wait();
      accountSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord, accountPrivKey);

      mintPublicTx = await timelockContractForAdmin.mint_public(frozenAccount, amount * 20n, 0);
      const [encryptedFrozenAccountSealedRecord] = await mintPublicTx.wait();
      frozenAccountSealedRecord = decryptCompliantToken(encryptedFrozenAccountSealedRecord, frozenAccountPrivKey);

      let mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount * 20n, 0);
      await mintPrivateTx.wait();
      accountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0].value,
        accountPrivKey,
      );
      accountRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0].value,
        accountPrivKey,
      );

      mintPrivateTx = await timelockContractForAdmin.mint_private(frozenAccount, amount * 20n, 0);
      await mintPrivateTx.wait();
      frozenAccountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0].value,
        frozenAccountPrivKey,
      );
      frozenAccountRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0].value,
        frozenAccountPrivKey,
      );

      // recipient is a minter, verify that they can call mint
      mintPublicTx = await timelockContractForRecipient.mint_public(account, amount * 20n, 0);
      await mintPublicTx.wait();
      mintPrivateTx = await timelockContractForRecipient.mint_private(frozenAccount, amount * 20n, 0);
      await mintPrivateTx.wait();

      // frozen account cannot call mint
      const rejectedTx = await timelockContractForFrozenAccount.mint_public(account, amount * 20n, 0);
      await expect(rejectedTx.wait()).rejects.toThrow();
      const rejectedTx2 = await timelockContractForFrozenAccount.mint_private(frozenAccount, amount * 20n, 0);
      await expect(rejectedTx2.wait()).rejects.toThrow();
    },
  );

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
    `verify compliant_transfer address`,
    async () => {
      expect(timelockContract.address()).toBe(COMPLIANT_TIMELOCK_TRANSFER_ADDRESS);
    },
  );

  test(
    `freeze registry setup`,
    async () => {
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
    },
  );

  test(
    "token_registry calls should fail",
    async () => {
      const rejectedTx1 = await tokenRegistryContractForAccount.transfer_private_to_public(
        account,
        amount,
        accountRecord,
      );
      await expect(rejectedTx1.wait()).rejects.toThrow();

      const rejectedTx2 = await tokenRegistryContractForAccount.transfer_private(account, amount, accountRecord);
      await expect(rejectedTx2.wait()).rejects.toThrow();

      const rejectedTx3 = await tokenRegistryContractForAccount.transfer_public(
        policies.timelock.tokenId,
        account,
        amount,
      );
      await expect(rejectedTx3.wait()).rejects.toThrow();

      const rejectedTx4 = await tokenRegistryContractForAccount.transfer_public_as_signer(
        policies.timelock.tokenId,
        account,
        amount,
      );
      await expect(rejectedTx4.wait()).rejects.toThrow();

      const rejectedTx5 = await tokenRegistryContractForAccount.transfer_public_to_private(
        policies.timelock.tokenId,
        account,
        amount,
        true,
      );
      await expect(rejectedTx5.wait()).rejects.toThrow();

      const tx = await tokenRegistryContractForAccount.approve_public(policies.timelock.tokenId, account, amount);
      await tx.wait();

      const rejectedTx6 = await tokenRegistryContractForAccount.transfer_from_public(
        policies.timelock.tokenId,
        account,
        account,
        amount,
      );
      await expect(rejectedTx6.wait()).rejects.toThrow();

      const rejectedTx7 = await tokenRegistryContractForAccount.transfer_from_public_to_private(
        policies.timelock.tokenId,
        account,
        account,
        amount,
        true,
      );
      await expect(rejectedTx7.wait()).rejects.toThrow();
    },
  );

  test(
    `test transfer_public`,
    async () => {
      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender didn't approve the program the tx will fail
      let rejectedTx = await timelockContractForAccount.transfer_public(
        recipient,
        amount,
        accountSealedRecord,
        latestBlockHeight + 1,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const approvalTx = await tokenRegistryContractForAccount.approve_public(
        policies.timelock.tokenId,
        timelockContract.address(),
        amount,
      );
      await approvalTx.wait();

      // If the sender is frozen account it's impossible to send tokens
      rejectedTx = await timelockContractForFrozenAccount.transfer_public(
        recipient,
        amount,
        frozenAccountSealedRecord2,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await timelockContractForAccount.transfer_public(
        frozenAccount,
        amount,
        accountSealedRecord,
        latestBlockHeight + 1,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // Sending tokens to the recipient with a long timelock, should succeed
      let tx = await timelockContractForAccount.transfer_public(
        recipient,
        amount - 1n,
        accountSealedRecord,
        latestBlockHeight + 100,
      );
      const [encryptedAccountSealedRecord, encryptedAccountSealedRecord2] = await tx.wait();
      accountSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord, accountPrivKey);
      recipientSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord2, recipientPrivKey);

      // cannot send tokens before the timelock expires
      tx = await timelockContractForRecipient.transfer_public(
        recipient,
        amount - 1n,
        recipientSealedRecord,
        latestBlockHeight,
      );
      await expect(tx.wait()).rejects.toThrow();

      // cannot send a different amount of tokens then in sealed token
      tx = await timelockContractForAccount.transfer_public(recipient, 1n + 1n, accountSealedRecord, latestBlockHeight);
      await expect(tx.wait()).rejects.toThrow();

      // can send the the remaining amounts
      tx = await timelockContractForAccount.transfer_public(recipient, 1n, accountSealedRecord, latestBlockHeight + 1);
      await tx.wait();
    },
  );

  test(
    `test transfer_public_as_signer`,
    async () => {
      let mintPublicTx = await timelockContractForAdmin.mint_public(account, amount * 20n, 0);
      await mintPublicTx.wait();

      mintPublicTx = await timelockContractForAdmin.mint_public(account, amount, 0);
      const [encryptedAccountSealedRecord] = await mintPublicTx.wait();
      accountSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord, accountPrivKey);

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender is frozen account it's impossible to send tokens
      let rejectedTx = await timelockContractForFrozenAccount.transfer_public_as_signer(
        recipient,
        amount,
        frozenAccountSealedRecord,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      rejectedTx = await timelockContractForAccount.transfer_public_as_signer(
        frozenAccount,
        amount,
        accountSealedRecord,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // cannot send tokens with the smaller amount in the sealed record
      await expect(
        timelockContractForAccount.transfer_public_as_signer(
          recipient,
          amount + 1n,
          accountSealedRecord,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      const tx = await timelockContractForAccount.transfer_public_as_signer(
        recipient,
        amount,
        accountSealedRecord,
        latestBlockHeight,
      );
      await tx.wait();
    },
  );

  test(
    `test transfer_public_to_priv`,
    async () => {
      let mintPublicTx = await timelockContractForAdmin.mint_public(account, amount * 20n, 0);

      mintPublicTx = await timelockContractForAdmin.mint_public(account, amount, 0);
      const [encryptedAccountSealedRecord] = await mintPublicTx.wait();
      accountSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord, accountPrivKey);

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender didn't approve the program the tx will fail
      let rejectedTx = await timelockContractForAccount.transfer_public_to_priv(
        recipient,
        amount,
        accountSealedRecord,
        recipientMerkleProof,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const approvalTx = await tokenRegistryContractForAccount.approve_public(
        policies.timelock.tokenId,
        timelockContract.address(),
        amount,
      );
      await approvalTx.wait();

      // If the sender is frozen account it's impossible to send tokens
      rejectedTx = await timelockContractForFrozenAccount.transfer_public_to_priv(
        recipient,
        amount,
        frozenAccountSealedRecord,
        recipientMerkleProof,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      await expect(
        timelockContractForAccount.transfer_public_to_priv(
          frozenAccount,
          amount,
          accountSealedRecord,
          frozenAccountMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      // cannot send tokens with the smaller amount in the sealed record
      await expect(
        timelockContractForAccount.transfer_public_to_priv(
          recipient,
          amount + 1n,
          accountSealedRecord,
          recipientMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      const largeBlockHeight = latestBlockHeight + 100;
      const change = 1n;
      const amountToSend = amount - change;
      const tx = await timelockContractForAccount.transfer_public_to_priv(
        recipient,
        amountToSend,
        accountSealedRecord,
        recipientMerkleProof,
        largeBlockHeight,
      );

      const [encryptedAccountChangeSealedRecord, encryptedRecipientSealedRecord] = await tx.wait();
      const tokenRecord = (tx as any).transaction.execution.transitions[6].outputs[0].value;
      const recipientRecord = decryptToken(tokenRecord, recipientPrivKey);
      expect(recipientRecord.owner).toBe(recipient);
      expect(recipientRecord.amount).toBe(amountToSend);
      expect(recipientRecord.token_id).toBe(policies.timelock.tokenId);
      expect(recipientRecord.external_authorization_required).toBe(true);
      expect(recipientRecord.authorized_until).toBe(0);

      accountSealedRecord = decryptCompliantToken(encryptedAccountChangeSealedRecord, accountPrivKey);
      expect(accountSealedRecord.owner).toBe(account);
      expect(accountSealedRecord.amount).toBe(change);
      expect(accountSealedRecord.locked_until).toBe(0);

      const recipientSealedRecord = decryptCompliantToken(encryptedRecipientSealedRecord, recipientPrivKey);
      expect(recipientSealedRecord.owner).toBe(recipient);
      expect(recipientSealedRecord.amount).toBe(amountToSend);
      expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);
    },
  );

  test(
    `test transfer_private`,
    async () => {
      let mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount * 20n, 0);
      await mintPrivateTx.wait();
      accountSealedRecord = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0].value,
        accountPrivKey,
      );
      accountRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0].value,
        accountPrivKey,
      );

      mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount * 10n, 0);
      await mintPrivateTx.wait();
      accountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0].value,
        accountPrivKey,
      );
      const accountRecord2 = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0].value,
        accountPrivKey,
      );

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender is frozen account it's impossible to send tokens
      await expect(
        timelockContractForFrozenAccount.transfer_private(
          recipient,
          amount,
          frozenAccountSealedRecord,
          frozenAccountRecord,
          frozenAccountMerkleProof,
          recipientMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      await expect(
        timelockContractForAccount.transfer_private(
          frozenAccount,
          amount,
          accountSealedRecord,
          accountRecord,
          senderMerkleProof,
          frozenAccountMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      const largeBlockHeight = latestBlockHeight + 100;
      const change = 1n;
      const amountToSend = accountRecord.amount - change;

      // cannot send amount larger than in sealed token
      await expect(
        timelockContractForAccount.transfer_private(
          recipient,
          accountRecord2.amount + 1n,
          accountSealedRecord2,
          accountRecord,
          senderMerkleProof,
          recipientMerkleProof,
          largeBlockHeight,
        ),
      ).rejects.toThrow();

      // cannot send a different amount in base token than in sealed token
      await expect(
        timelockContractForAccount.transfer_private(
          recipient,
          accountRecord.amount,
          accountSealedRecord2,
          accountRecord,
          senderMerkleProof,
          recipientMerkleProof,
          largeBlockHeight,
        ),
      ).rejects.toThrow();

      let tx = await timelockContractForAccount.transfer_private(
        recipient,
        amountToSend,
        accountSealedRecord,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        largeBlockHeight,
      );
      const [encryptedAccountSealedRecord, encryptedRecipientSealedRecord] = await tx.wait();

      accountRecord = decryptToken((tx as any).transaction.execution.transitions[4].outputs[0].value, accountPrivKey);
      expect(accountRecord.owner).toBe(account);
      expect(accountRecord.amount).toBe(change);
      expect(accountRecord.token_id).toBe(policies.timelock.tokenId);
      expect(accountRecord.external_authorization_required).toBe(true);
      expect(accountRecord.authorized_until).toBe(0);

      const recipientRecord = decryptToken(
        (tx as any).transaction.execution.transitions[5].outputs[1].value,
        recipientPrivKey,
      );
      expect(recipientRecord.owner).toBe(recipient);
      expect(recipientRecord.amount).toBe(amountToSend);
      expect(recipientRecord.token_id).toBe(policies.timelock.tokenId);
      expect(recipientRecord.external_authorization_required).toBe(true);
      expect(recipientRecord.authorized_until).toBe(0);

      accountSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord, accountPrivKey);
      expect(accountSealedRecord.owner).toBe(account);
      expect(accountSealedRecord.amount).toBe(change);
      expect(accountSealedRecord.locked_until).toBe(0);

      const recipientSealedRecord = decryptCompliantToken(encryptedRecipientSealedRecord, recipientPrivKey);
      expect(recipientSealedRecord.owner).toBe(recipient);
      expect(recipientSealedRecord.amount).toBe(amountToSend);
      expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);

      // cannot send tokens before the timelock expires
      tx = await timelockContractForRecipient.transfer_private(
        account,
        amountToSend,
        recipientSealedRecord,
        recipientRecord,
        recipientMerkleProof,
        senderMerkleProof,
        latestBlockHeight,
      );
      await expect(tx.wait()).rejects.toThrow();

      // can send the remaining amount
      tx = await timelockContractForAccount.transfer_private(
        recipient,
        change,
        accountSealedRecord,
        accountRecord,
        senderMerkleProof,
        recipientMerkleProof,
        latestBlockHeight,
      );
      await tx.wait();
    },
  );

  test(
    `test transfer_priv_to_public`,
    async () => {
      let mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount * 20n, 0);
      await mintPrivateTx.wait();
      accountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0].value,
        accountPrivKey,
      );
      const accountTokenRecord2 = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0].value,
        accountPrivKey,
      );

      mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount, 0);
      await mintPrivateTx.wait();

      accountSealedRecord = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0].value,
        accountPrivKey,
      );
      accountTokenRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0].value,
        accountPrivKey,
      );

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender is frozen account it's impossible to send tokens
      await expect(
        timelockContractForFrozenAccount.transfer_priv_to_public(
          recipient,
          amount,
          frozenAccountSealedRecord,
          frozenAccountRecord,
          frozenAccountMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      // If the recipient is frozen account it's impossible to send tokens
      let rejectedTx = await timelockContractForAccount.transfer_priv_to_public(
        frozenAccount,
        amount,
        accountSealedRecord,
        accountTokenRecord,
        senderMerkleProof,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // cannot send tokens with the smaller amount in the sealed record
      await expect(
        timelockContractForAccount.transfer_priv_to_public(
          recipient,
          amount + 1n,
          accountSealedRecord,
          accountTokenRecord2,
          senderMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      const largeBlockHeight = latestBlockHeight + 100;
      const change = 1n;
      const amountToSend = accountTokenRecord.amount - change;

      let tx = await timelockContractForAccount.transfer_priv_to_public(
        recipient,
        amountToSend,
        accountSealedRecord,
        accountTokenRecord,
        senderMerkleProof,
        largeBlockHeight,
      );
      const [encryptedAccountChangeSealedRecord, encryptedRecipientSealedRecord] = await tx.wait();

      accountTokenRecord = decryptToken(
        (tx as any).transaction.execution.transitions[3].outputs[0].value,
        accountPrivKey,
      );
      expect(accountTokenRecord.owner).toBe(account);
      expect(accountTokenRecord.amount).toBe(change);
      expect(accountTokenRecord.token_id).toBe(policies.timelock.tokenId);
      expect(accountTokenRecord.external_authorization_required).toBe(true);
      expect(accountTokenRecord.authorized_until).toBe(0);

      accountSealedRecord = decryptCompliantToken(encryptedAccountChangeSealedRecord, accountPrivKey);
      expect(accountSealedRecord.owner).toBe(account);
      expect(accountSealedRecord.amount).toBe(change);
      expect(accountSealedRecord.locked_until).toBe(0);

      const recipientSealedRecord = decryptCompliantToken(encryptedRecipientSealedRecord, recipientPrivKey);
      expect(recipientSealedRecord.owner).toBe(recipient);
      expect(recipientSealedRecord.amount).toBe(amountToSend);
      expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);

      // Send the remaining amount to account using large blockheight
      // and verify that account cannot call transfer_priv_to_public with it
      const tx2 = await timelockContractForAccount.transfer_private(
        account,
        change,
        accountSealedRecord,
        accountTokenRecord,
        senderMerkleProof,
        senderMerkleProof,
        largeBlockHeight,
      );
      const [, encryptedAccountSealedRecord] = await tx2.wait();

      accountTokenRecord = decryptToken(
        (tx2 as any).transaction.execution.transitions[5].outputs[1].value,
        accountPrivKey,
      );

      accountSealedRecord = decryptCompliantToken(encryptedAccountSealedRecord, accountPrivKey);

      rejectedTx = await timelockContractForAccount.transfer_priv_to_public(
        recipient,
        change,
        accountSealedRecord,
        accountTokenRecord,
        senderMerkleProof,
        largeBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
  );

  test(
    `test join`,
    async () => {
      // create new records
      const lockedUntil = Math.floor(Math.random() * 2 ** 32);
      let mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount, lockedUntil);
      const [encryptedLockedSealedRecord] = await mintPrivateTx.wait();
      const lockedAccountSealedRecord = decryptCompliantToken(encryptedLockedSealedRecord, accountPrivKey);
      mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount * 2n, 0);
      let [encryptedUnlockedSealedRecord] = await mintPrivateTx.wait();
      const unlockedAccountSealedRecord1 = decryptCompliantToken(encryptedUnlockedSealedRecord, accountPrivKey);
      mintPrivateTx = await timelockContractForAdmin.mint_private(account, amount, 0);
      [encryptedUnlockedSealedRecord] = await mintPrivateTx.wait();
      const unlockedAccountSealedRecord2 = decryptCompliantToken(encryptedUnlockedSealedRecord, accountPrivKey);

      let tx = await timelockContractForAccount.join(unlockedAccountSealedRecord1, unlockedAccountSealedRecord2);
      let [encryptedSealedRecord] = await tx.wait();
      accountSealedRecord = decryptCompliantToken(encryptedSealedRecord, accountPrivKey);
      expect(accountSealedRecord.owner).toBe(unlockedAccountSealedRecord1.owner);
      expect(accountSealedRecord.owner).toBe(unlockedAccountSealedRecord2.owner);
      expect(accountSealedRecord.amount).toBe(
        unlockedAccountSealedRecord1.amount + unlockedAccountSealedRecord2.amount,
      );
      expect(accountSealedRecord.locked_until).toBe(0);

      tx = await timelockContractForAccount.join(accountSealedRecord, lockedAccountSealedRecord);
      [encryptedSealedRecord] = await tx.wait();
      accountSealedRecord = decryptCompliantToken(encryptedSealedRecord, accountPrivKey);
      expect(accountSealedRecord.owner).toBe(unlockedAccountSealedRecord1.owner);
      expect(accountSealedRecord.owner).toBe(lockedAccountSealedRecord.owner);
      expect(accountSealedRecord.amount).toBe(
        unlockedAccountSealedRecord1.amount + unlockedAccountSealedRecord2.amount + lockedAccountSealedRecord.amount,
      );
      expect(accountSealedRecord.locked_until).toBe(lockedAccountSealedRecord.locked_until);
    },
  );
});
