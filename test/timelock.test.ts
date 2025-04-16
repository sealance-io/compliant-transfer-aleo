import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptCompliantToken } from "../artifacts/js/leo2js/compliant_timelock_transfer";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";

import {
  MAX_TREE_SIZE,
  ZERO_ADDRESS,
  COMPLIANT_TIMELOCK_TRANSFER_ADDRESS,
  fundedAmount,
  timeout,
  tokenName,
  tokenSymbol,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Compliant_timelock_transferContract } from "../artifacts/js/compliant_timelock_transfer";
import { Freeze_registryContract } from "../artifacts/js/freeze_registry";
import { stringToBigInt } from "../lib/Conversion";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, _, freezedAccount, account, recipient] =
  contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const freezedAccountPrivKey = contract.getPrivateKey(freezedAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);

const tokenRegistryContract = new Token_registryContract({
  mode,
  privateKey: adminPrivKey,
});
const tokenRegistryContractForAccount = new Token_registryContract({
  mode,
  privateKey: accountPrivKey,
});
const timelockContract = new Compliant_timelock_transferContract({
  mode,
  privateKey: adminPrivKey,
});
const timelockContractForAdmin = new Compliant_timelock_transferContract({
  mode,
  privateKey: adminPrivKey,
});
const timelockContractForAccount = new Compliant_timelock_transferContract({
  mode,
  privateKey: accountPrivKey,
});
const timelockContractForRecipient = new Compliant_timelock_transferContract({
  mode,
  privateKey: recipientPrivKey,
});
const timelockContractForFreezedAccount =
  new Compliant_timelock_transferContract({
    mode,
    privateKey: freezedAccountPrivKey,
  });
const merkleTreeContract = new Rediwsozfo_v2Contract({
  mode,
  privateKey: adminPrivKey,
});
const freezeRegistryContract = new Freeze_registryContract({
  mode,
  privateKey: adminPrivKey,
});

const amount = 10n;
let root: bigint;
let tokenId = stringToBigInt("SEALED_TIMELOCK_TOKEN");

async function getLatestBlockHeight() {
  const response = (await fetch(
    `${contract.config.network.endpoint}/${contract.config.networkName}/block/height/latest`,
  )) as any;
  const latestBlockHeight = (await response.json()) as number;
  return latestBlockHeight;
}

let accountRecord, accountTokenRecord;
let accountSealedRecord, accountSealedRecord2;
let freezedAccountRecord;
let freezedAccountSealedRecord, freezedAccountSealedRecord2;
let recipientSealedRecord;
let senderMerkleProof;
let recipientMerkleProof;
let freezedAccountMerkleProof;

describe("test compliant_timelock_transfer program", () => {
  test(
    `fund credits`,
    async () => {
      await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
      await fundWithCredits(deployerPrivKey, freezedAccount, fundedAmount);
      await fundWithCredits(deployerPrivKey, account, fundedAmount);
    },
    timeout,
  );

  test(
    `deploy needed programs`,
    async () => {
      await deployIfNotDeployed(tokenRegistryContract);
      await deployIfNotDeployed(merkleTreeContract);
      await deployIfNotDeployed(freezeRegistryContract);
      await deployIfNotDeployed(timelockContract);

      // NOTE: use Nadav's policies struct and initializeTokenProgram()
      const tokenMetadata = await tokenRegistryContract.registered_tokens(
        tokenId,
        {
          token_id: 0n,
          name: 0n,
          symbol: 0n,
          decimals: 0,
          supply: 0n,
          max_supply: 0n,
          admin: ZERO_ADDRESS,
          external_authorization_required: false,
          external_authorization_party: ZERO_ADDRESS,
        },
      );
      if (tokenMetadata.token_id === 0n) {
        const tx = await tokenRegistryContract.register_token(
          tokenId,
          stringToBigInt(tokenName),
          stringToBigInt(tokenSymbol),
          6,
          1000_000000000000n,
          true,
          timelockContract.address(),
        );
        await tx.wait();
      }

      const tx = await tokenRegistryContract.update_token_management(
        tokenId,
        adminAddress,
        timelockContract.address(),
      );
      await tx.wait();

      // NOTE: should we do initialize() and have the program being the admin instead?
      const setRoleTx = await tokenRegistryContract.set_role(
        tokenId,
        timelockContract.address(),
        1, // minter_role
      );
      await setRoleTx.wait();
    },
    timeout,
  );

  test(
    `test update_admin_address`,
    async () => {
      let tx = await timelockContract.update_admin_address(freezedAccount);
      await tx.wait();
      let adminRole = await timelockContract.roles(1);
      expect(adminRole).toBe(freezedAccount);

      tx =
        await timelockContractForFreezedAccount.update_admin_address(
          adminAddress,
        );
      await tx.wait();
      adminRole = await timelockContract.roles(1);
      expect(adminRole).toBe(adminAddress);

      tx =
        await timelockContractForFreezedAccount.update_admin_address(
          freezedAccount,
        );
      await expect(tx.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    `test init_freeze_registry_name`,
    async () => {
      const tx = await timelockContractForAdmin.init_freeze_registry_name();
      await tx.wait();
      const freezeRegistryName =
        await timelockContract.freeze_registry_program_name(0);
      expect(freezeRegistryName).toBe(531934507715736310883939492834865785n);
    },
    timeout,
  );

  test(
    "fund tokens",
    async () => {
      let mintPublicTx = await timelockContractForAdmin.mint_public(
        account,
        amount * 20n,
        0,
      );
      const [encryptedAccountSealedRecord] = await mintPublicTx.wait();
      accountSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord,
        accountPrivKey,
      );

      mintPublicTx = await timelockContractForAdmin.mint_public(
        freezedAccount,
        amount * 20n,
        0,
      );
      const [encryptedFreezedAccountSealedRecord] = await mintPublicTx.wait();
      freezedAccountSealedRecord = decryptCompliantToken(
        encryptedFreezedAccountSealedRecord,
        freezedAccountPrivKey,
      );

      let mintPrivateTx = await timelockContractForAdmin.mint_private(
        account,
        amount * 20n,
        0,
      );
      await mintPrivateTx.wait();
      accountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0]
          .value,
        accountPrivKey,
      );
      accountRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0]
          .value,
        accountPrivKey,
      );

      mintPrivateTx = await timelockContractForAdmin.mint_private(
        freezedAccount,
        amount * 20n,
        0,
      );
      await mintPrivateTx.wait();
      freezedAccountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0]
          .value,
        freezedAccountPrivKey,
      );
      freezedAccountRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0]
          .value,
        freezedAccountPrivKey,
      );
    },
    timeout,
  );

  test(
    `generate merkle proofs`,
    async () => {
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
      senderMerkleProof = [
        getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE),
      ];
      recipientMerkleProof = [
        getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_SIZE),
      ];
      freezedAccountMerkleProof = [
        getSiblingPath(tree, freezedAccountLeafIndices[0], MAX_TREE_SIZE),
        getSiblingPath(tree, freezedAccountLeafIndices[1], MAX_TREE_SIZE),
      ];
    },
    timeout,
  );

  test(
    `verify compliant_transfer address`,
    async () => {
      expect(timelockContract.address()).toBe(
        COMPLIANT_TIMELOCK_TRANSFER_ADDRESS,
      );
    },
    timeout,
  );

  test(
    `freeze registry setup`,
    async () => {
      const tx =
        await freezeRegistryContract.update_admin_address(adminAddress);
      await tx.wait();
      let adminRole = await freezeRegistryContract.admin(0);
      expect(adminRole).toBe(adminAddress);

      const tx2 = await freezeRegistryContract.update_freeze_list(
        freezedAccount,
        true,
        0,
        root,
      );
      await tx2.wait();
      let isAccountFreezed =
        await freezeRegistryContract.freeze_list(freezedAccount);
      let freezedAccountByIndex =
        await freezeRegistryContract.freeze_list_index(0);

      expect(isAccountFreezed).toBe(true);
      expect(freezedAccountByIndex).toBe(freezedAccount);
    },
    timeout,
  );

  test(
    "token_registry calls should fail",
    async () => {
      const rejectedTx1 =
        await tokenRegistryContractForAccount.transfer_private_to_public(
          account,
          amount,
          accountRecord,
        );
      await expect(rejectedTx1.wait()).rejects.toThrow();

      const rejectedTx2 =
        await tokenRegistryContractForAccount.transfer_private(
          account,
          amount,
          accountRecord,
        );
      await expect(rejectedTx2.wait()).rejects.toThrow();

      const rejectedTx3 = await tokenRegistryContractForAccount.transfer_public(
        tokenId,
        account,
        amount,
      );
      await expect(rejectedTx3.wait()).rejects.toThrow();

      const rejectedTx4 =
        await tokenRegistryContractForAccount.transfer_public_as_signer(
          tokenId,
          account,
          amount,
        );
      await expect(rejectedTx4.wait()).rejects.toThrow();

      const rejectedTx5 =
        await tokenRegistryContractForAccount.transfer_public_to_private(
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

      const rejectedTx6 =
        await tokenRegistryContractForAccount.transfer_from_public(
          tokenId,
          account,
          account,
          amount,
        );
      await expect(rejectedTx6.wait()).rejects.toThrow();

      const rejectedTx7 =
        await tokenRegistryContractForAccount.transfer_from_public_to_private(
          tokenId,
          account,
          account,
          amount,
          true,
        );
      await expect(rejectedTx7.wait()).rejects.toThrow();
    },
    timeout,
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
        tokenId,
        timelockContract.address(),
        amount,
      );
      await approvalTx.wait();

      // If the sender is freezed account it's impossible to send tokens
      rejectedTx = await timelockContractForFreezedAccount.transfer_public(
        recipient,
        amount,
        freezedAccountSealedRecord2,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is freezed account it's impossible to send tokens
      rejectedTx = await timelockContractForAccount.transfer_public(
        freezedAccount,
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
      const [encryptedAccountSealedRecord, encryptedAccountSealedRecord2] =
        await tx.wait();
      accountSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord,
        accountPrivKey,
      );
      recipientSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord2,
        recipientPrivKey,
      );

      // cannot send tokens before the timelock expires
      tx = await timelockContractForRecipient.transfer_public(
        recipient,
        amount - 1n,
        recipientSealedRecord,
        latestBlockHeight,
      );

      // cannot send a different amount of tokens then in sealed token
      tx = await timelockContractForAccount.transfer_public(
        recipient,
        1n + 1n,
        accountSealedRecord,
        latestBlockHeight,
      );
      await expect(tx.wait()).rejects.toThrow();

      // can send the the remaining amounts
      tx = await timelockContractForAccount.transfer_public(
        recipient,
        1n,
        accountSealedRecord,
        latestBlockHeight + 1,
      );
      await tx.wait();

      // NOTE: how to test a different tokenID?
    },
    timeout,
  );

  test(
    `test transfer_public_as_signer`,
    async () => {
      let mintPublicTx = await timelockContractForAdmin.mint_public(
        account,
        amount * 20n,
        0,
      );
      await mintPublicTx.wait();
      
      mintPublicTx = await timelockContractForAdmin.mint_public(
        account,
        amount,
        0,
      );
      const [encryptedAccountSealedRecord] = await mintPublicTx.wait();
      accountSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord,
        accountPrivKey,
      );

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender is freezed account it's impossible to send tokens
      let rejectedTx =
        await timelockContractForFreezedAccount.transfer_public_as_signer(
          recipient,
          amount,
          freezedAccountSealedRecord,
          latestBlockHeight,
        );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is freezed account it's impossible to send tokens
      rejectedTx = await timelockContractForAccount.transfer_public_as_signer(
        freezedAccount,
        amount,
        accountSealedRecord,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // cannot send tokens with the smaller amount in the sealed record
      await expect(timelockContractForAccount.transfer_public_as_signer(
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
    timeout,
  );

  test(
    `test transfer_public_to_priv`,
    async () => {
      let mintPublicTx = await timelockContractForAdmin.mint_public(
        account,
        amount * 20n,
        0,
      );
      
      mintPublicTx = await timelockContractForAdmin.mint_public(
        account,
        amount,
        0,
      );
      const [encryptedAccountSealedRecord] = await mintPublicTx.wait();
      accountSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord,
        accountPrivKey,
      );

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender didn't approve the program the tx will fail
      let rejectedTx = await timelockContractForAccount.transfer_public_to_priv(
        recipient,
        amount,
        recipientMerkleProof,
        accountSealedRecord,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      const approvalTx = await tokenRegistryContractForAccount.approve_public(
        tokenId,
        timelockContract.address(),
        amount,
      );
      await approvalTx.wait();

      // If the sender is freezed account it's impossible to send tokens
      rejectedTx =
        await timelockContractForFreezedAccount.transfer_public_to_priv(
          recipient,
          amount,
          recipientMerkleProof,
          freezedAccountSealedRecord,
          latestBlockHeight,
        );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // If the recipient is freezed account it's impossible to send tokens
      await expect(
        timelockContractForAccount.transfer_public_to_priv(
          freezedAccount,
          amount,
          freezedAccountMerkleProof,
          accountSealedRecord,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      // cannot send tokens with the smaller amount in the sealed record
      await expect(
        timelockContractForAccount.transfer_public_to_priv(
          recipient,
          amount + 1n,
          recipientMerkleProof,
          accountSealedRecord,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      const largeBlockHeight = latestBlockHeight + 100;
      const change = 1n;
      const amountToSend = amount - change;
      const tx = await timelockContractForAccount.transfer_public_to_priv(
        recipient,
        amountToSend,
        recipientMerkleProof,
        accountSealedRecord,
        largeBlockHeight,
      );

      const [
        encryptedAccountChangeSealedRecord,
        encryptedRecipientSealedRecord,
      ] = await tx.wait();
      const tokenRecord = (tx as any).transaction.execution.transitions[6]
        .outputs[0].value;
      const recipientRecord = decryptToken(tokenRecord, recipientPrivKey);
      expect(recipientRecord.owner).toBe(recipient);
      expect(recipientRecord.amount).toBe(amountToSend);
      expect(recipientRecord.token_id).toBe(tokenId);
      expect(recipientRecord.external_authorization_required).toBe(true);
      expect(recipientRecord.authorized_until).toBe(0);

      accountSealedRecord = decryptCompliantToken(
        encryptedAccountChangeSealedRecord,
        accountPrivKey,
      );
      expect(accountSealedRecord.owner).toBe(account);
      expect(accountSealedRecord.amount).toBe(change);
      expect(accountSealedRecord.locked_until).toBe(0);

      const recipientSealedRecord = decryptCompliantToken(
        encryptedRecipientSealedRecord,
        recipientPrivKey,
      );
      expect(recipientSealedRecord.owner).toBe(recipient);
      expect(recipientSealedRecord.amount).toBe(amountToSend);
      expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);
    },
    timeout,
  );

  test(
    `test transfer_private`,
    async () => {
      let mintPrivateTx = await timelockContractForAdmin.mint_private(
        account,
        amount * 20n,
        0,
      );
      await mintPrivateTx.wait();
      accountSealedRecord = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0]
          .value,
        accountPrivKey,
      );
      accountRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0]
          .value,
        accountPrivKey,
      );

      mintPrivateTx = await timelockContractForAdmin.mint_private(
        account,
        amount * 10n,
        0,
      );
      await mintPrivateTx.wait();
      accountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0]
          .value,
        accountPrivKey,
      );
      const accountRecord2 = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0]
          .value,
        accountPrivKey,
      );

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender is freezed account it's impossible to send tokens
      await expect(
        timelockContractForFreezedAccount.transfer_private(
          recipient,
          amount,
          freezedAccountSealedRecord,
          freezedAccountRecord,
          freezedAccountMerkleProof,
          recipientMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      // If the recipient is freezed account it's impossible to send tokens
      await expect(
        timelockContractForAccount.transfer_private(
          freezedAccount,
          amount,
          accountSealedRecord,
          accountRecord,
          senderMerkleProof,
          freezedAccountMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      const largeBlockHeight = latestBlockHeight + 100;
      const change = 1n;
      const amountToSend = accountRecord.amount - change;

      // cannot send amount larger than in sealed token
      await expect(timelockContractForAccount.transfer_private(
          recipient,
          accountRecord2.amount + 1n,
          accountSealedRecord2,
          accountRecord,
          senderMerkleProof,
          recipientMerkleProof,
          largeBlockHeight
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
      const [encryptedAccountSealedRecord, encryptedRecipientSealedRecord] =
        await tx.wait();

      accountRecord = decryptToken(
        (tx as any).transaction.execution.transitions[4].outputs[0].value,
        accountPrivKey,
      );
      expect(accountRecord.owner).toBe(account);
      expect(accountRecord.amount).toBe(change);
      expect(accountRecord.token_id).toBe(tokenId);
      expect(accountRecord.external_authorization_required).toBe(true);
      expect(accountRecord.authorized_until).toBe(0);

      const recipientRecord = decryptToken(
        (tx as any).transaction.execution.transitions[5].outputs[1].value,
        recipientPrivKey,
      );
      expect(recipientRecord.owner).toBe(recipient);
      expect(recipientRecord.amount).toBe(amountToSend);
      expect(recipientRecord.token_id).toBe(tokenId);
      expect(recipientRecord.external_authorization_required).toBe(true);
      expect(recipientRecord.authorized_until).toBe(0);

      accountSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord,
        accountPrivKey,
      );
      expect(accountSealedRecord.owner).toBe(account);
      expect(accountSealedRecord.amount).toBe(change);
      expect(accountSealedRecord.locked_until).toBe(0);

      const recipientSealedRecord = decryptCompliantToken(
        encryptedRecipientSealedRecord,
        recipientPrivKey,
      );
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
    timeout,
  );

  test(
    `test transfer_priv_to_public`,
    async () => {
      let mintPrivateTx = await timelockContractForAdmin.mint_private(
        account,
        amount * 20n,
        0,
      );
      await mintPrivateTx.wait();
      accountSealedRecord2 = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0]
          .value,
        accountPrivKey,
      );
      const accountTokenRecord2 = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0]
          .value,
        accountPrivKey,
      );

      mintPrivateTx = await timelockContractForAdmin.mint_private(
        account,
        amount,
        0,
      );
      await mintPrivateTx.wait();

      accountSealedRecord = decryptCompliantToken(
        (mintPrivateTx as any).transaction.execution.transitions[1].outputs[0]
          .value,
        accountPrivKey,
      );
      accountTokenRecord = decryptToken(
        (mintPrivateTx as any).transaction.execution.transitions[0].outputs[0]
          .value,
        accountPrivKey,
      );

      const latestBlockHeight = await getLatestBlockHeight();

      // If the sender is freezed account it's impossible to send tokens
      await expect(
        timelockContractForFreezedAccount.transfer_priv_to_public(
          recipient,
          amount,
          freezedAccountSealedRecord,
          freezedAccountRecord,
          freezedAccountMerkleProof,
          latestBlockHeight,
        ),
      ).rejects.toThrow();

      // If the recipient is freezed account it's impossible to send tokens
      let rejectedTx = await timelockContractForAccount.transfer_priv_to_public(
        freezedAccount,
        amount,
        accountSealedRecord,
        accountTokenRecord,
        senderMerkleProof,
        latestBlockHeight,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      // cannot send tokens with the smaller amount in the sealed record
      await expect(timelockContractForAccount.transfer_priv_to_public(
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
      const [
        encryptedAccountChangeSealedRecord,
        encryptedRecipientSealedRecord,
      ] = await tx.wait();

      accountTokenRecord = decryptToken(
        (tx as any).transaction.execution.transitions[3].outputs[0].value,
        accountPrivKey,
      );
      expect(accountTokenRecord.owner).toBe(account);
      expect(accountTokenRecord.amount).toBe(change);
      expect(accountTokenRecord.token_id).toBe(tokenId);
      expect(accountTokenRecord.external_authorization_required).toBe(true);
      expect(accountTokenRecord.authorized_until).toBe(0);

      accountSealedRecord = decryptCompliantToken(
        encryptedAccountChangeSealedRecord,
        accountPrivKey,
      );
      expect(accountSealedRecord.owner).toBe(account);
      expect(accountSealedRecord.amount).toBe(change);
      expect(accountSealedRecord.locked_until).toBe(0);

      const recipientSealedRecord = decryptCompliantToken(
        encryptedRecipientSealedRecord,
        recipientPrivKey,
      );
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
      const [
        encryptedEmptySealedRecord,
        encryptedAccountSealedRecord,
      ] = await tx2.wait();

      accountTokenRecord = decryptToken(
        (tx2 as any).transaction.execution.transitions[5].outputs[1].value,
        accountPrivKey,
      );

      accountSealedRecord = decryptCompliantToken(
        encryptedAccountSealedRecord,
        accountPrivKey,
      );
      
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
    timeout,
  );
});
