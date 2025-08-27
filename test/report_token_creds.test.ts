import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Merkle_tree12Contract } from "../artifacts/js/merkle_tree12";
import {
  ADMIN_INDEX,
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  INVESTIGATOR_INDEX,
  MAX_TREE_SIZE12,
  MINTER_ROLE,
  NONE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  SUPPLY_MANAGER_ROLE,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
  timeout,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { buildTree, genLeaves } from "../lib/MerkleTree";
import { Account } from "@provablehq/sdk";
import { Report_token_credsContract } from "../artifacts/js/report_token_creds";
import { stringToBigInt } from "../lib/Conversion";
import { decryptToken, decryptCredentials } from "../artifacts/js/leo2js/report_token_creds";
import { Token, Credentials } from "../artifacts/js/types/report_token_creds";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [
  deployerAddress,
  adminAddress,
  investigatorAddress,
  freezedAccount,
  account,
  recipient,
  minter,
  burner,
  supplyManager,
  spender,
] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const investigatorPrivKey = contract.getPrivateKey(investigatorAddress);
const freezedAccountPrivKey = contract.getPrivateKey(freezedAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);
const recipientPrivKey = contract.getPrivateKey(recipient);
const minterPrivKey = contract.getPrivateKey(minter);
const burnerPrivKey = contract.getPrivateKey(burner);
const supplyManagerPrivKey = contract.getPrivateKey(supplyManager);
const spenderPrivKey = contract.getPrivateKey(spender);

const reportTokenContract = new Report_token_credsContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportTokenContractForAdmin = new Report_token_credsContract({
  mode,
  privateKey: adminPrivKey,
});
const reportTokenContractForAccount = new Report_token_credsContract({
  mode,
  privateKey: accountPrivKey,
});

const merkleTreeContract = new Merkle_tree12Contract({
  mode,
  privateKey: deployerPrivKey,
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

describe("test sealed_report_token program", () => {
  test(
    `fund credits`,
    async () => {
      await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
     // await fundWithCredits(deployerPrivKey, freezedAccount, fundedAmount);
      await fundWithCredits(deployerPrivKey, account, fundedAmount);

     // await fundWithCredits(deployerPrivKey, minter, fundedAmount);
     // await fundWithCredits(deployerPrivKey, supplyManager, fundedAmount);
    //  await fundWithCredits(deployerPrivKey, burner, fundedAmount);
    //  await fundWithCredits(deployerPrivKey, spender, fundedAmount);
    },
    timeout,
  );

  test(
    `deploy needed programs`,
    async () => {
      await deployIfNotDeployed(merkleTreeContract);
      await deployIfNotDeployed(reportTokenContract);
    },
    timeout,
  );

  test(
    `test update_admin_address`,
    async () => {

      let tx = await reportTokenContractForAdmin.update_role(adminAddress, ADMIN_INDEX);
      await tx.wait();
      let adminRole = await reportTokenContract.roles(ADMIN_INDEX);
      expect(adminRole).toBe(adminAddress);


    },
    timeout,
  );

  test(
    `test update_investigator_address`,
    async () => {
      let tx = await reportTokenContractForAdmin.update_role(investigatorAddress, INVESTIGATOR_INDEX);
      await tx.wait();
      let investigatorRole = await reportTokenContract.roles(INVESTIGATOR_INDEX);
      expect(investigatorRole).toBe(investigatorAddress);

    },
    timeout,
  );

  let senderMerkleProof: { siblings: any[]; leaf_index: any }[];
  let recipientMerkleProof: { siblings: any[]; leaf_index: any }[];
  let freezedAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(
    `generate merkle proofs`,
    async () => {
      const leaves = genLeaves([freezedAccount]);
      const tree = buildTree(leaves);
      root = tree[tree.length - 1];
      const senderLeafIndices = getLeafIndices(tree, account);
      const recipientLeafIndices = getLeafIndices(tree, recipient);
      const freezedAccountLeafIndices = getLeafIndices(tree, freezedAccount);
      senderMerkleProof = [
        getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_SIZE12),
        getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_SIZE12),
      ];
      recipientMerkleProof = [
        getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_SIZE12),
        getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_SIZE12),
      ];
      freezedAccountMerkleProof = [
        getSiblingPath(tree, freezedAccountLeafIndices[0], MAX_TREE_SIZE12),
        getSiblingPath(tree, freezedAccountLeafIndices[1], MAX_TREE_SIZE12),
      ];
    },
    timeout,
  );

  test(
    `test initialize`,
    async () => {

      const name = stringToBigInt("Report Token");
      const symbol = stringToBigInt("REPORT_TOKEN");
      const decimals = 6;
      const maxSupply = 1000_000000000000n;

      const tx = await reportTokenContract.initialize(name, symbol, decimals, maxSupply, BLOCK_HEIGHT_WINDOW);
      await tx.wait();

      const isAccountFreezed = await reportTokenContract.freeze_list(ZERO_ADDRESS);
      const freezedAccountByIndex = await reportTokenContract.freeze_list_index(0);
      const lastIndex = await reportTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await reportTokenContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await reportTokenContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);

      expect(isAccountFreezed).toBe(false);
      expect(freezedAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

    },
    timeout,
  );

  let accountRecord: Token;
  let freezedAccountRecord: Token;
  test(
    `test mint_private`,
    async () => {

      let tx = await reportTokenContractForAdmin.mint_private(account, amount * 20n);
      const [encryptedAccountRecord] = await tx.wait();
      accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
      expect(accountRecord.amount).toBe(amount * 20n);
      expect(accountRecord.owner).toBe(account);
    },
    timeout,
  );

  test(
    `test update_freeze_list`,
    async () => {

      let tx = await reportTokenContractForAdmin.update_freeze_list(freezedAccount, true, 1, root);
      await tx.wait();
      let isAccountFreezed = await reportTokenContract.freeze_list(freezedAccount);
      let freezedAccountByIndex = await reportTokenContract.freeze_list_index(1);
      let lastIndex = await reportTokenContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFreezed).toBe(true);
      expect(freezedAccountByIndex).toBe(freezedAccount);
      expect(lastIndex).toBe(1);

    },
    timeout,
  );

  test(
    `test transfer_private`,
    async () => {

        const latestBlockHeight = await getLatestBlockHeight();

        let tx = await reportTokenContractForAccount.get_credentials(senderMerkleProof, latestBlockHeight);
        const [encryptedAccountCreds] = await tx.wait();
        let accountCreds = decryptCredentials(encryptedAccountCreds, accountPrivKey);
      // If the investigator address is wrong it's impossible to send tokens
      const rejectedTx = await reportTokenContractForAccount.transfer_private_with_creds(
        recipient,
        amount,
        accountRecord,
        accountCreds,
        recipientMerkleProof,
        ZERO_ADDRESS,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

    },
    timeout,
  );

});
