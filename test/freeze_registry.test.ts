import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from '../contract/base-contract';
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { MAX_TREE_SIZE, ZERO_ADDRESS, fundedAmount, timeout } from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { UscrpnwqsxContract } from "../artifacts/js/uscrpnwqsx";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, freezedAccount, account] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const freezedAccountPrivKey = contract.getPrivateKey(freezedAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);

const freezeRegistryContract = new UscrpnwqsxContract({ mode, privateKey: adminPrivKey });
const freezeRegistryContractForFreezedAccount = new UscrpnwqsxContract({ mode, privateKey: freezedAccountPrivKey });
const merkleTreeContract = new Rediwsozfo_v2Contract({ mode, privateKey: adminPrivKey });

let root: bigint;

describe('test freeze_registry program', () => {

  test(`fund credits`, async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezedAccount, fundedAmount);
  }, timeout)

  test(`deploy needed programs`, async () => {
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
  }, timeout);

  test(`test update_admin_address`, async () => {
    let tx = await freezeRegistryContract.update_admin_address(freezedAccount);
    await tx.wait();
    let adminRole = await freezeRegistryContract.admin(0);
    expect(adminRole).toBe(freezedAccount);

    tx = await freezeRegistryContractForFreezedAccount.update_admin_address(adminAddress);
    await tx.wait();
    adminRole = await freezeRegistryContract.admin(0);
    expect(adminRole).toBe(adminAddress);

    tx = await freezeRegistryContractForFreezedAccount.update_admin_address(freezedAccount);
    await expect(tx.wait()).rejects.toThrow();
  }, timeout);

  let adminMerkleProof;
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
    const adminLeadIndices = getLeafIndices(tree, adminAddress);
    const freezedAccountLeadIndices = getLeafIndices(tree, freezedAccount);
    adminMerkleProof = [
      getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_SIZE), 
      getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_SIZE)
    ];
    freezedAccountMerkleProof = [
      getSiblingPath(tree, freezedAccountLeadIndices[0], MAX_TREE_SIZE), 
      getSiblingPath(tree, freezedAccountLeadIndices[1], MAX_TREE_SIZE)
    ];
  }, timeout);

  test(`test update_freeze_list`, async () => {
    let rejectedTx = await freezeRegistryContractForFreezedAccount.update_freeze_list(
      adminAddress,
      true,
      0,
      root
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContract.update_freeze_list(
      freezedAccount,
      true,
      0,
      root
    );
    await tx.wait();
    let isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
    let freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);

    expect(isAccountFreezed).toBe(true);
    expect(freezedAccountByIndex).toBe(freezedAccount);

    tx = await freezeRegistryContract.update_freeze_list(
      freezedAccount,
      false,
      0,
      root
    );
    await tx.wait();
    isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
    freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);

    expect(isAccountFreezed).toBe(false);
    expect(freezedAccountByIndex).toBe(ZERO_ADDRESS);

    tx = await freezeRegistryContract.update_freeze_list(
      freezedAccount,
      true,
      0,
      root
    );
    await tx.wait();
    isAccountFreezed = await freezeRegistryContract.freeze_list(freezedAccount);
    freezedAccountByIndex = await freezeRegistryContract.freeze_list_index(0);
    expect(isAccountFreezed).toBe(true);
    expect(freezedAccountByIndex).toBe(freezedAccount);
  }, timeout);

  test(`test verify_non_inclusion_pub`, async () => {
    const rejectedTx = await freezeRegistryContract.verify_non_inclusion_pub(freezedAccount);
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await freezeRegistryContract.verify_non_inclusion_pub(adminAddress);
    await tx.wait();
  }, timeout);

  test(`test verify_non_inclusion_priv`, async () => {
    await expect(freezeRegistryContract.verify_non_inclusion_priv(freezedAccount, freezedAccountMerkleProof)).rejects.toThrow();

    const tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await tx.wait();
  }, timeout);
})