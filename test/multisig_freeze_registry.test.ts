import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  ZERO_ADDRESS,
  emptyRoot,
  fundedAmount,
  NONE_ROLE,
  emptyMultisigCommonParams,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  MULTISIG_OP_UPDATE_FREEZE_LIST,
  MULTISIG_OP_UPDATE_BLOCK_WINDOW,
  MAX_BLOCK_HEIGHT,
} from "../lib/Constants";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Multisig_freezelist_registryContract } from "../artifacts/js/multisig_freezelist_registry";
import { buildTree, generateLeaves } from "@sealance-io/policy-engine-aleo";
import { Account } from "@provablehq/sdk";
import { isProgramInitialized } from "../lib/Initalize";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { approveRequest, createWallet, initializeMultisig } from "../lib/Multisig";
import { waitBlocks } from "../lib/Block";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, , frozenAccount, , , , , , , freezeListManager, , signer1, signer2] =
  contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const freezeListManagerPrivKey = contract.getPrivateKey(freezeListManager);

const freezeRegistryContract = new Multisig_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Multisig_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});
const freezeRegistryContractForFrozenAccount = new Multisig_freezelist_registryContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const freezeRegistryContractForFreezeListManager = new Multisig_freezelist_registryContract({
  mode,
  privateKey: freezeListManagerPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});

const managerWalletId = new Account().address().to_string();
const freezeListManagerWalletId = new Account().address().to_string();

let root: bigint;

describe("test multisig freeze registry program", () => {
  beforeAll(async () => {
    // Deploy the multisig programs
    await deployIfNotDeployed(multiSigContract);
    // Create the wallets
    await initializeMultisig();
    await createWallet(managerWalletId);
    await createWallet(freezeListManagerWalletId);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);

    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezeListManager, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer1, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer2, fundedAmount);
  });

  let adminMerkleProof: { siblings: any[]; leaf_index: any }[];
  let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];
  test(`generate merkle proofs`, async () => {
    const leaves = generateLeaves([frozenAccount]);
    const tree = buildTree(leaves);
    root = tree[tree.length - 1];
    const adminLeadIndices = getLeafIndices(tree, adminAddress);
    const frozenAccountLeadIndices = getLeafIndices(tree, frozenAccount);
    adminMerkleProof = [
      getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_DEPTH),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeadIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, frozenAccountLeadIndices[1], MAX_TREE_DEPTH),
    ];
  });

  test(`test initialize`, async () => {
    const isFreezeRegistryInitialized = await isProgramInitialized(freezeRegistryContract);
    if (!isFreezeRegistryInitialized) {
      // Cannot update freeze list before initialization
      let rejectedTx = await freezeRegistryContractForAdmin.update_freeze_list(
        frozenAccount,
        true,
        1,
        0n,
        root,
        emptyMultisigCommonParams,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      if (deployerAddress !== adminAddress) {
        // The caller is not the initial admin
        rejectedTx = await freezeRegistryContract.initialize(adminAddress, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS);
        await expect(rejectedTx.wait()).rejects.toThrow();
      }

      // The admin or the wallet ID manager has to be non zero
      rejectedTx = await freezeRegistryContract.initialize(ZERO_ADDRESS, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await freezeRegistryContractForAdmin.initialize(adminAddress, BLOCK_HEIGHT_WINDOW, managerWalletId);
      await tx.wait();
      const isAccountFrozen = await freezeRegistryContract.freeze_list(ZERO_ADDRESS);
      const frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(0);
      const lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await freezeRegistryContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await freezeRegistryContract.address_to_role(adminAddress);
      const walletIdRole = await freezeRegistryContract.wallet_id_to_role(managerWalletId);

      expect(role).toBe(MANAGER_ROLE);
      expect(walletIdRole).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRoot);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
    }

    // It is possible to call to initialize only one time
    const rejectedTx = await freezeRegistryContractForAdmin.initialize(
      adminAddress,
      BLOCK_HEIGHT_WINDOW,
      managerWalletId,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test init_multi_sig`, async () => {
    let salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: 0,
      user: ZERO_ADDRESS,
      is_frozen: false,
      frozen_index: 0,
      previous_root: 0n,
      new_root: 0n,
      role: 0,
      blocks: 0,
      salt: salt,
    };

    let tx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [, walletSigningOpIdHash] = await tx.wait();
    let pendingRequest = await freezeRegistryContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.op).toBe(0);
    expect(pendingRequest.user).toBe(ZERO_ADDRESS);
    expect(pendingRequest.is_frozen).toBe(false);
    expect(pendingRequest.frozen_index).toBe(0);
    expect(pendingRequest.previous_root).toBe(0n);
    expect(pendingRequest.new_root).toBe(0n);
    expect(pendingRequest.role).toBe(0);
    expect(pendingRequest.blocks).toBe(0);
    expect(pendingRequest.salt).toBe(salt);

    // It's impossible to initiate a request twice
    const rejectedTx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp.salt = salt;
    tx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, 1);
    [, walletSigningOpIdHash] = await tx.wait();
    pendingRequest = await freezeRegistryContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.salt).toBe(salt);
    await waitBlocks(1);
    // It's possible to initiate this request twice because the previous expired
    tx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [, walletSigningOpIdHash] = await tx.wait();
  });

  test(`test update_wallet_id_role`, async () => {
    // Non manager address can't update the wallet_id without multisig approval
    let rejectedTx = await freezeRegistryContractForFrozenAccount.update_wallet_id_role(
      managerWalletId,
      MULTISIG_OP_UPDATE_WALLET_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContractForAdmin.update_wallet_id_role(
      managerWalletId,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await tx.wait();
    let role = await freezeRegistryContract.wallet_id_to_role(managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    rejectedTx = await freezeRegistryContractForAdmin.update_wallet_id_role(managerWalletId, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt: 0n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await freezeRegistryContractForAdmin.update_wallet_id_role(managerWalletId, MANAGER_ROLE, {
      wallet_id: ZERO_ADDRESS,
      salt: 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: freezeListManagerWalletId,
      is_frozen: false,
      frozen_index: 0,
      previous_root: 0n,
      new_root: 0n,
      role: FREEZELIST_MANAGER_ROLE,
      blocks: 0,
      salt,
    };

    let initMultiSigTx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: managerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: managerWalletId,
        salt: salt + 1n,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(freezeListManager, FREEZELIST_MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(freezeListManagerWalletId, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await freezeRegistryContract.update_wallet_id_role(freezeListManagerWalletId, FREEZELIST_MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await freezeRegistryContract.wallet_id_to_role(freezeListManagerWalletId);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: managerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await freezeRegistryContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(freezeListManagerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test multisig support in update_role`, async () => {
    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    let rejectedTx = await freezeRegistryContractForAdmin.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt: 0n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await freezeRegistryContractForAdmin.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: ZERO_ADDRESS,
      salt: 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: adminAddress,
      is_frozen: false,
      frozen_index: 0,
      previous_root: 0n,
      new_root: 0n,
      role: MANAGER_ROLE,
      blocks: 0,
      salt,
    };

    let initMultiSigTx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await freezeRegistryContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_role(deployerAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_role(adminAddress, FREEZELIST_MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await freezeRegistryContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    const role = await freezeRegistryContract.address_to_role(adminAddress);
    expect(role).toBe(MANAGER_ROLE);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await freezeRegistryContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(freezeListManagerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_manager_address`, async () => {
    // Manager cannot unassign himself from being a manager
    let rejectedTx = await freezeRegistryContractForAdmin.update_role(
      adminAddress,
      NONE_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContractForAdmin.update_role(frozenAccount, MANAGER_ROLE, emptyMultisigCommonParams);
    await tx.wait();

    let role = await freezeRegistryContract.address_to_role(frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    tx = await freezeRegistryContractForAdmin.update_role(frozenAccount, NONE_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await freezeRegistryContract.address_to_role(frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Only the manager can update the roles
    tx = await freezeRegistryContractForFrozenAccount.update_role(
      frozenAccount,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(tx.wait()).rejects.toThrow();
  });

  test(`test update_freeze_list_manager`, async () => {
    let tx = await freezeRegistryContractForAdmin.update_role(
      freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await tx.wait();
    const freezeListManagerRole = await freezeRegistryContract.address_to_role(freezeListManager);
    expect(freezeListManagerRole).toBe(FREEZELIST_MANAGER_ROLE);

    tx = await freezeRegistryContractForFrozenAccount.update_role(
      frozenAccount,
      FREEZELIST_MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(tx.wait()).rejects.toThrow();
  });

  test(`test update_freeze_list`, async () => {
    const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the manager can call to update_freeze_list
    let rejectedTx = await freezeRegistryContractForFrozenAccount.update_freeze_list(
      adminAddress,
      true,
      1,
      currentRoot,
      root,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot update the root if the previous root is incorrect
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      false,
      1,
      0n,
      root,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount, false);
    if (!isAccountFrozen) {
      // Cannot unfreeze an unfrozen account
      rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
        frozenAccount,
        false,
        1,
        currentRoot,
        root,
        emptyMultisigCommonParams,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      let tx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
        frozenAccount,
        true,
        1,
        currentRoot,
        root,
        emptyMultisigCommonParams,
      );
      await tx.wait();
      isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
      let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);
    }

    // Cannot unfreeze an account when the frozen list index is incorrect
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      false,
      2,
      root,
      root,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Cannot freeze a frozen account
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      true,
      1,
      root,
      root,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let randomAddress = new Account().address().to_string();
    let tx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      2,
      root,
      root,
      emptyMultisigCommonParams,
    );
    await tx.wait();
    isAccountFrozen = await freezeRegistryContract.freeze_list(randomAddress);
    let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(2);
    let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = new Account().address().to_string();
    // Cannot freeze an account when the frozen list index is greater than the last index
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      10,
      root,
      root,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // Cannot freeze an account when the frozen list index is already taken
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      2,
      root,
      root,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    randomAddress = new Account().address().to_string();

    // Even though the caller is a freeze list manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      3,
      root,
      root,
      {
        wallet_id: managerWalletId,
        salt: 0n,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      randomAddress,
      true,
      3,
      root,
      root,
      {
        wallet_id: ZERO_ADDRESS,
        salt: 1n,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_FREEZE_LIST,
      user: randomAddress,
      is_frozen: true,
      frozen_index: 3,
      previous_root: root,
      new_root: root,
      role: 0,
      blocks: 0,
      salt,
    };

    let initMultiSigTx = await freezeRegistryContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, root, root, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(freezeListManagerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, root, root, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, root, root, {
      wallet_id: freezeListManagerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(
      new Account().address().to_string(),
      true,
      3,
      root,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the is_frozen doesn't match the is_frozen in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, false, 3, root, root, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the frozen_index doesn't match the frozen_index in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 2, root, root, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the previous_root doesn't match the previous_root in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, 0n, root, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the new_root doesn't match the new_root in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, root, 0n, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, root, root, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await tx.wait();
    const isFrozen = await freezeRegistryContract.freeze_list(randomAddress);
    expect(isFrozen).toBe(true);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, true, 3, root, root, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    multisigOp.is_frozen = false;
    initMultiSigTx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryContract.update_freeze_list(randomAddress, false, 3, root, root, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_block_height_window`, async () => {
    let rejectedTx = await freezeRegistryContractForFrozenAccount.update_block_height_window(
      BLOCK_HEIGHT_WINDOW,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContractForFreezeListManager.update_block_height_window(
      BLOCK_HEIGHT_WINDOW,
      emptyMultisigCommonParams,
    );
    await tx.wait();

    // Even though the caller is a freeze list manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: managerWalletId,
      salt: 0n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await freezeRegistryContractForFreezeListManager.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: ZERO_ADDRESS,
      salt: 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_BLOCK_WINDOW,
      user: ZERO_ADDRESS,
      is_frozen: false,
      frozen_index: 0,
      previous_root: 0n,
      new_root: 0n,
      role: 0,
      blocks: BLOCK_HEIGHT_WINDOW,
      salt,
    };

    let initMultiSigTx = await freezeRegistryContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await freezeRegistryContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(freezeListManagerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the block height window doesn't match the block height window in the request the transaction will fail
    rejectedTx = await freezeRegistryContract.update_block_height_window(0, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await freezeRegistryContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await tx.wait();
    const blockHeightWindow = await freezeRegistryContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
    expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await freezeRegistryContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test verify_non_inclusion_pub`, async () => {
    const rejectedTx = await freezeRegistryContract.verify_non_inclusion_pub(frozenAccount);
    await expect(rejectedTx.wait()).rejects.toThrow();
    const tx = await freezeRegistryContract.verify_non_inclusion_pub(adminAddress);
    await tx.wait();
  });

  test(`test verify_non_inclusion_priv`, async () => {
    await expect(
      freezeRegistryContract.verify_non_inclusion_priv(frozenAccount, frozenAccountMerkleProof),
    ).rejects.toThrow();

    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);

    const adminLeadIndices = getLeafIndices(tree, adminAddress);
    const emptyTreeAdminMerkleProof = [
      getSiblingPath(tree, adminLeadIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, adminLeadIndices[1], MAX_TREE_DEPTH),
    ];
    // The transaction failed because the root is mismatch
    let rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, emptyTreeAdminMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await tx.wait();

    const updateFreezeListTx = await freezeRegistryContractForFreezeListManager.update_freeze_list(
      frozenAccount,
      false,
      1,
      root,
      emptyRoot,
      emptyMultisigCommonParams,
    );
    await updateFreezeListTx.wait();

    const newRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await freezeRegistryContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(root);
    expect(newRoot).toBe(emptyRoot);

    // The transaction succeed because the old root is match
    tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await tx.wait();

    const updateBlockHeightWindowTx = await freezeRegistryContractForFreezeListManager.update_block_height_window(
      1,
      emptyMultisigCommonParams,
    );
    await updateBlockHeightWindowTx.wait();

    // The transaction failed because the old root is expired
    rejectedTx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, adminMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await freezeRegistryContract.verify_non_inclusion_priv(adminAddress, emptyTreeAdminMerkleProof);
    await tx.wait();
  });

  test(`test expired multisig requests`, async () => {
    const randomWalletId = new Account().address().to_string();
    await createWallet(randomWalletId, 1, [deployerAddress, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);
    const updateWalletTx = await freezeRegistryContractForAdmin.update_wallet_id_role(
      randomWalletId,
      MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await updateWalletTx.wait();
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: 0,
      user: ZERO_ADDRESS,
      is_frozen: false,
      frozen_index: 0,
      previous_root: 0n,
      new_root: 0n,
      role: 0,
      blocks: 0,
      salt: salt,
    };
    let initMultiSigTx = await freezeRegistryContract.init_multisig_op(randomWalletId, multisigOp, 1);
    let [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateWalletIdTX = await freezeRegistryContract.update_wallet_id_role(ZERO_ADDRESS, 0, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateWalletIdTX.wait()).rejects.toThrow();

    multisigOp.op = MULTISIG_OP_UPDATE_ROLE;
    initMultiSigTx = await freezeRegistryContract.init_multisig_op(randomWalletId, multisigOp, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateRoleTX = await freezeRegistryContract.update_role(ZERO_ADDRESS, 0, { salt, wallet_id: randomWalletId });
    await expect(updateRoleTX.wait()).rejects.toThrow();

    multisigOp.op = MULTISIG_OP_UPDATE_BLOCK_WINDOW;
    initMultiSigTx = await freezeRegistryContract.init_multisig_op(randomWalletId, multisigOp, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateBurnPublicTX = await freezeRegistryContract.update_block_height_window(0, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateBurnPublicTX.wait()).rejects.toThrow();
  });
});
