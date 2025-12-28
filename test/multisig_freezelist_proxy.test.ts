import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  ZERO_ADDRESS,
  fundedAmount,
  emptyMultisigCommonParams,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  MULTISIG_OP_UPDATE_FREEZE_LIST,
  MULTISIG_OP_UPDATE_BLOCK_WINDOW,
  MAX_BLOCK_HEIGHT,
  FREEZE_LIST_LAST_INDEX,
} from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Account } from "@provablehq/sdk";
import { initializeProgram, isProgramInitialized } from "../lib/Initalize";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { approveRequest, createWallet, initializeMultisig } from "../lib/Multisig";
import { waitBlocks } from "../lib/Block";
import { Freezelist_programContract } from "../artifacts/js/freezelist_program";
import { Multisig_freezelist_proxyContract } from "../artifacts/js/multisig_freezelist_proxy";
import { updateAddressToRole } from "../lib/Role";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, , frozenAccount, , , , , , , freezeListManager, , signer1, signer2] =
  contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);

const freezeRegistryContract = new Freezelist_programContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Freezelist_programContract({
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

const freezeRegistryProxyContract = new Multisig_freezelist_proxyContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryProxyContractForAdmin = new Multisig_freezelist_proxyContract({
  mode,
  privateKey: adminPrivKey,
});

const managerWalletId = new Account().address().to_string();
const freezeListManagerWalletId = new Account().address().to_string();

const root = 1n;

describe("test multisig_freezelist_proxy program", () => {
  beforeAll(async () => {
    // Deploy the multisig programs
    await deployIfNotDeployed(multiSigContract);
    // Create the wallets
    await initializeMultisig();
    await createWallet(managerWalletId);
    await createWallet(freezeListManagerWalletId);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(freezeRegistryProxyContract);

    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, freezeListManager, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer1, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer2, fundedAmount);

    await initializeProgram(freezeRegistryContract, [adminAddress, BLOCK_HEIGHT_WINDOW]);
    await updateAddressToRole(
      freezeRegistryContractForAdmin,
      freezeRegistryProxyContract.address(),
      MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
    );
  });

  test(`test initialize`, async () => {
    const isProxyInitialized = await isProgramInitialized(freezeRegistryProxyContract);
    if (!isProxyInitialized) {
      // Cannot update freeze list before initialization
      let rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
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
        rejectedTx = await freezeRegistryProxyContract.initialize(managerWalletId);
        await expect(rejectedTx.wait()).rejects.toThrow();
      }

      // The wallet ID manager has to be non zero
      rejectedTx = await freezeRegistryProxyContractForAdmin.initialize(ZERO_ADDRESS);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await freezeRegistryProxyContractForAdmin.initialize(managerWalletId);
      await tx.wait();
      const role = await freezeRegistryProxyContractForAdmin.wallet_id_to_role(managerWalletId);
      expect(role).toBe(MANAGER_ROLE);
    }

    // It is possible to call to initialize only one time
    const rejectedTx = await freezeRegistryProxyContractForAdmin.initialize(managerWalletId);
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

    let tx = await freezeRegistryProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [, walletSigningOpIdHash] = await tx.wait();
    let pendingRequest = await freezeRegistryProxyContract.pending_requests(walletSigningOpIdHash);
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
    const rejectedTx = await freezeRegistryProxyContract.init_multisig_op(
      managerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp.salt = salt;
    tx = await freezeRegistryProxyContract.init_multisig_op(managerWalletId, multisigOp, 1);
    [, walletSigningOpIdHash] = await tx.wait();
    pendingRequest = await freezeRegistryProxyContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.salt).toBe(salt);
    await waitBlocks(1);
    // It's possible to initiate this request twice because the previous expired
    tx = await freezeRegistryProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [, walletSigningOpIdHash] = await tx.wait();
  });

  test(`test update_wallet_id_role`, async () => {
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

    let initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(
      managerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(
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
    rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: managerWalletId,
        salt: salt + 1n,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(freezeListManager, FREEZELIST_MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(freezeListManagerWalletId, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await freezeRegistryProxyContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: managerWalletId,
        salt,
      },
    );
    await tx.wait();
    const role = await freezeRegistryProxyContract.wallet_id_to_role(freezeListManagerWalletId);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(
      freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      {
        wallet_id: managerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(freezeListManagerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_wallet_id_role(
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

    let initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(
      managerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await freezeRegistryProxyContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_role(deployerAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_role(adminAddress, FREEZELIST_MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await freezeRegistryProxyContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    const role = await freezeRegistryContract.address_to_role(adminAddress);
    expect(role).toBe(MANAGER_ROLE);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryProxyContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(freezeListManagerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_role(adminAddress, MANAGER_ROLE, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_freeze_list`, async () => {
    const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
    const randomAddress = new Account().address().to_string();

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_FREEZE_LIST,
      user: randomAddress,
      is_frozen: true,
      frozen_index: lastIndex + 1,
      previous_root: currentRoot,
      new_root: root,
      role: 0,
      blocks: 0,
      salt,
    };

    let initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(freezeListManagerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: managerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt: salt + 1n,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      new Account().address().to_string(),
      true,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the is_frozen doesn't match the is_frozen in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      false,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the frozen_index doesn't match the frozen_index in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index - 1,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the previous_root doesn't match the previous_root in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      0n,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If the new_root doesn't match the new_root in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      root,
      0n,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await tx.wait();
    const isFrozen = await freezeRegistryContract.freeze_list(randomAddress);
    expect(isFrozen).toBe(true);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(
      randomAddress,
      true,
      multisigOp.frozen_index,
      currentRoot,
      root,
      {
        wallet_id: freezeListManagerWalletId,
        salt,
      },
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    multisigOp.is_frozen = false;
    multisigOp.previous_root = root;
    initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_freeze_list(randomAddress, false, 3, root, root, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_block_height_window`, async () => {
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

    let initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(
      freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await freezeRegistryProxyContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(freezeListManagerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the block height window doesn't match the block height window in the request the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_block_height_window(0, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await freezeRegistryProxyContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await tx.wait();
    const blockHeightWindow = await freezeRegistryContract.block_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
    expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

    // It's possible to execute the request only once
    rejectedTx = await freezeRegistryProxyContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: freezeListManagerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await freezeRegistryProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await freezeRegistryProxyContract.update_block_height_window(BLOCK_HEIGHT_WINDOW, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });
});
