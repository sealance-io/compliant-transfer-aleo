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
  fundedAmount,
  MAX_TREE_DEPTH,
  emptyMultisigCommonParams,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  MAX_BLOCK_HEIGHT,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_MINT_PRIVATE,
  MULTISIG_OP_MINT_PUBLIC,
  MULTISIG_OP_BURN_PUBLIC,
  MULTISIG_OP_SET_PAUSE_STATUS,
  MULTISIG_OP_BURN_PRIVATE,
  emptyRoot,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
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
import { Compliant_token_templateContract } from "../artifacts/js/compliant_token_template";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { isProgramInitialized } from "../lib/Initalize";
import { getLatestBlockHeight, waitBlocks } from "../lib/Block";
import { buildTree, generateLeaves, stringToBigInt } from "@sealance-io/policy-engine-aleo";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { approveRequest, createWallet, initializeMultisig } from "../lib/Multisig";

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
  ,
  pauser,
  signer1,
  signer2,
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

const managerWalletId = new Account().address().to_string();
const pauseWalletId = new Account().address().to_string();
const minterWalletId = new Account().address().to_string();
const burnerWalletId = new Account().address().to_string();

const amount = 10n;
let root: bigint;

describe("test compliant_token_template program", () => {
  beforeAll(async () => {
    // Deploy the multisig programs
    await deployIfNotDeployed(multiSigContract);
    // Create the wallets
    await initializeMultisig();
    await createWallet(managerWalletId);
    await createWallet(pauseWalletId);
    await createWallet(minterWalletId);
    await createWallet(burnerWalletId);

    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);

    await fundWithCredits(deployerPrivKey, minter, fundedAmount);
    await fundWithCredits(deployerPrivKey, supplyManager, fundedAmount);
    await fundWithCredits(deployerPrivKey, burner, fundedAmount);
    await fundWithCredits(deployerPrivKey, spender, fundedAmount);
    await fundWithCredits(deployerPrivKey, pauser, fundedAmount);

    await fundWithCredits(deployerPrivKey, signer1, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer2, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
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

      // The admin or the wallet ID manager has to be non zero
      let rejectedTx = await freezeRegistryContract.initialize(ZERO_ADDRESS, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await tokenContractForAdmin.initialize(
        name,
        symbol,
        decimals,
        maxSupply,
        adminAddress,
        managerWalletId,
      );
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
      rejectedTx = await tokenContractForAdmin.initialize(
        name,
        symbol,
        decimals,
        maxSupply,
        adminAddress,
        managerWalletId,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();
    }

    const isFreezeRegistryInitialized = await isProgramInitialized(freezeRegistryContract);
    if (!isFreezeRegistryInitialized) {
      const tx = await freezeRegistryContractForAdmin.initialize(adminAddress, BLOCK_HEIGHT_WINDOW, ZERO_ADDRESS);
      await tx.wait();
    }

    const role = await freezeRegistryContract.address_to_role(adminAddress, NONE_ROLE);
    if ((role & FREEZELIST_MANAGER_ROLE) !== FREEZELIST_MANAGER_ROLE) {
      let tx = await freezeRegistryContractForAdmin.update_role(
        adminAddress,
        MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
        emptyMultisigCommonParams,
      );
      await tx.wait();
      const role = await freezeRegistryContract.address_to_role(adminAddress);
      expect(role).toBe(MANAGER_ROLE + FREEZELIST_MANAGER_ROLE);
    }

    const isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount, false);
    if (!isAccountFrozen) {
      const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      let tx = await freezeRegistryContractForAdmin.update_freeze_list(
        frozenAccount,
        true,
        1,
        currentRoot,
        root,
        emptyMultisigCommonParams,
      );
      await tx.wait();
      let isAccountFrozen = await freezeRegistryContract.freeze_list(frozenAccount);
      let frozenAccountByIndex = await freezeRegistryContract.freeze_list_index(1);
      let lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(frozenAccount);
      expect(lastIndex).toBe(1);
    }
  });

  test(`test init_multisig_op`, async () => {
    let salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: 0,
      user: ZERO_ADDRESS,
      pause_status: false,
      amount: 0n,
      role: 0,
      salt,
    };

    let tx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [, walletSigningOpIdHash] = await tx.wait();
    let pendingRequest = await tokenContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.op).toBe(0);
    expect(pendingRequest.user).toBe(ZERO_ADDRESS);
    expect(pendingRequest.pause_status).toBe(false);
    expect(pendingRequest.role).toBe(0);
    expect(pendingRequest.amount).toBe(0n);
    expect(pendingRequest.salt).toBe(salt);

    // It's impossible to initiate a request twice
    const rejectedTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp.salt = salt;
    tx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, 1);
    [, walletSigningOpIdHash] = await tx.wait();
    pendingRequest = await tokenContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.salt).toBe(salt);
    await waitBlocks(1);
    // It's possible to initiate this request twice because the previous expired
    tx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [, walletSigningOpIdHash] = await tx.wait();
  });

  test(`test init_private_multisig_op`, async () => {
    let salt = BigInt(Math.floor(Math.random() * 100000));
    const privMultisigOp = {
      op: 0,
      user: ZERO_ADDRESS,
      amount: 0n,
    };

    let tx = await tokenContract.init_private_multisig_op(managerWalletId, privMultisigOp, salt, MAX_BLOCK_HEIGHT);
    let [, walletSigningOpIdHash] = await tx.wait();
    let privatePendingRequest = await tokenContract.private_pending_requests(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);

    // It's impossible to initiate a request twice
    const rejectedTx = await tokenContract.init_private_multisig_op(
      managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    tx = await tokenContract.init_private_multisig_op(managerWalletId, privMultisigOp, salt, 1);
    [, walletSigningOpIdHash] = await tx.wait();
    privatePendingRequest = await tokenContract.private_pending_requests(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);
    // It's possible to initiate this request twice because the previous expired
    tx = await tokenContract.init_private_multisig_op(managerWalletId, privMultisigOp, salt, MAX_BLOCK_HEIGHT);
    [, walletSigningOpIdHash] = await tx.wait();
  });

  test(`test update_wallet_id_role`, async () => {
    // Non manager address can't update the wallet_id without multisig approval
    let rejectedTx = await tokenContract.update_wallet_id_role(
      managerWalletId,
      MULTISIG_OP_UPDATE_WALLET_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenContractForAdmin.update_wallet_id_role(
      managerWalletId,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await tx.wait();
    let role = await tokenContract.wallet_id_to_role(managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    rejectedTx = await tokenContractForAdmin.update_wallet_id_role(managerWalletId, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt: 0n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await tokenContractForAdmin.update_wallet_id_role(managerWalletId, MANAGER_ROLE, {
      wallet_id: ZERO_ADDRESS,
      salt: 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let salt = BigInt(Math.floor(Math.random() * 100000));
    let multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: pauseWalletId,
      pause_status: false,
      amount: 0n,
      role: PAUSE_ROLE,
      salt,
    };

    let initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await tokenContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenContract.update_wallet_id_role(minterWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await tokenContract.update_wallet_id_role(pauseWalletId, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await tokenContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await tokenContract.wallet_id_to_role(pauseWalletId);
    expect(role).toBe(PAUSE_ROLE);

    // It's possible to execute the request only once
    rejectedTx = await tokenContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: minterWalletId,
      pause_status: false,
      amount: 0n,
      role: MINTER_ROLE,
      salt,
    };

    initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);
    tx = await tokenContract.update_wallet_id_role(minterWalletId, MINTER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await tokenContract.wallet_id_to_role(minterWalletId);
    expect(role).toBe(MINTER_ROLE);

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: burnerWalletId,
      pause_status: false,
      amount: 0n,
      role: BURNER_ROLE,
      salt,
    };

    initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);
    tx = await tokenContract.update_wallet_id_role(burnerWalletId, BURNER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await tokenContract.wallet_id_to_role(burnerWalletId);
    expect(role).toBe(BURNER_ROLE);
  });

  test(`test update_role`, async () => {
    // Manager can assign role
    let tx = await tokenContractForAdmin.update_role(frozenAccount, MANAGER_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    let role = await tokenContract.address_to_role(frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    tx = await tokenContractForAdmin.update_role(frozenAccount, NONE_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    let rejectedTx = await tokenContractForFrozenAccount.update_role(
      frozenAccount,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update minter role
    rejectedTx = await tokenContractForAccount.update_role(minter, MINTER_ROLE, emptyMultisigCommonParams);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update burner role
    rejectedTx = await tokenContractForAccount.update_role(burner, BURNER_ROLE, emptyMultisigCommonParams);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update supply manager role
    rejectedTx = await tokenContractForAccount.update_role(
      supplyManager,
      MINTER_ROLE + BURNER_ROLE,
      emptyMultisigCommonParams,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update none role
    rejectedTx = await tokenContractForAccount.update_role(account, NONE_ROLE, emptyMultisigCommonParams);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Non admin user cannot update pause role
    rejectedTx = await tokenContractForAccount.update_role(account, PAUSE_ROLE, emptyMultisigCommonParams);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager cannot unassign himself from being a manager
    rejectedTx = await tokenContractForAdmin.update_role(adminAddress, NONE_ROLE, emptyMultisigCommonParams);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Manager can assign minter, burner, manager, pauser and supply manager roles
    tx = await tokenContractForAdmin.update_role(minter, MINTER_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(minter);
    expect(role).toBe(MINTER_ROLE);

    tx = await tokenContractForAdmin.update_role(burner, BURNER_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(burner);
    expect(role).toBe(BURNER_ROLE);

    tx = await tokenContractForAdmin.update_role(supplyManager, MINTER_ROLE + BURNER_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);

    tx = await tokenContractForAdmin.update_role(account, NONE_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(account);
    expect(role).toBe(NONE_ROLE);

    tx = await tokenContractForAdmin.update_role(pauser, PAUSE_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(pauser);
    expect(role).toBe(PAUSE_ROLE);

    tx = await tokenContractForAdmin.update_role(adminAddress, MANAGER_ROLE, emptyMultisigCommonParams);
    await tx.wait();
    role = await tokenContract.address_to_role(adminAddress);
    expect(role).toBe(MANAGER_ROLE);

    const randomAddress = new Account().address().to_string();
    const randomRole = [MANAGER_ROLE, BURNER_ROLE, MINTER_ROLE, PAUSE_ROLE, MINTER_ROLE + BURNER_ROLE][
      Math.floor(Math.random() * 5)
    ];

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    rejectedTx = await tokenContractForAdmin.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt: 0n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await tokenContractForAdmin.update_role(randomAddress, randomRole, {
      wallet_id: ZERO_ADDRESS,
      salt: 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: randomAddress,
      pause_status: false,
      amount: 0n,
      role: randomRole,
      salt,
    };

    let initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await tokenContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContract.update_role(randomAddress, randomRole, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenContract.update_role(deployerAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await tokenContract.update_role(randomAddress, randomRole + 1, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await tokenContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await tokenContract.address_to_role(randomAddress);
    expect(role).toBe(randomRole);

    // It's possible to execute the request only once
    rejectedTx = await tokenContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContract.update_role(randomAddress, randomRole, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
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

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount * 20n);
    expect(decryptedComplianceRecord.sender).toBe(ZERO_ADDRESS);
    expect(decryptedComplianceRecord.recipient).toBe(account);

    privateAccountBalance += amount * 20n;
  });

  test(`test mint_private_multisig`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

    const randomAccount = new Account();
    const randomPrivKey = randomAccount.privateKey().to_string();
    const randomAddress = randomAccount.address().to_string();
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const privMultisigOp = {
      op: MULTISIG_OP_MINT_PRIVATE,
      user: randomAddress,
      amount: amount,
    };

    let initMultiSigTx = await tokenContract.init_private_multisig_op(
      minterWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenContract.mint_private_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(minterWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContract.mint_private_multisig(randomAddress, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContract.mint_private_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenContract.mint_private_multisig(deployerAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenContract.mint_private_multisig(randomAddress, amount + 1n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenContract.mint_private_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await tx.wait();
    const [complianceRandomRecord, encryptedRandomRecord] = await tx.wait();
    const randomAccountRecord = decryptToken(encryptedRandomRecord, randomPrivKey);
    expect(randomAccountRecord.amount).toBe(amount);
    expect(randomAccountRecord.owner).toBe(randomAddress);

    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount);

    const decryptedRandomComplianceRecord = decryptComplianceRecord(complianceRandomRecord, investigatorPrivKey);
    expect(decryptedRandomComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedRandomComplianceRecord.amount).toBe(amount);
    expect(decryptedRandomComplianceRecord.sender).toBe(ZERO_ADDRESS);
    expect(decryptedRandomComplianceRecord.recipient).toBe(randomAddress);

    // It's possible to execute the request only once
    rejectedTx = await tokenContract.mint_private_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_private_multisig_op(
      managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContract.mint_private_multisig(randomAddress, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
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

  test(`test mint_public_multisig`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

    const randomAddress = new Account().address().to_string();
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_MINT_PUBLIC,
      user: randomAddress,
      pause_status: false,
      amount: amount,
      role: 0,
      salt,
    };

    let initMultiSigTx = await tokenContract.init_multisig_op(minterWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenContract.mint_public_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(minterWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContract.mint_public_multisig(randomAddress, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContract.mint_public_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenContract.mint_public_multisig(deployerAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenContract.mint_public_multisig(randomAddress, amount + 1n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenContract.mint_public_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await tx.wait();
    const balance = await tokenContract.balances(randomAddress);
    expect(balance).toBe(amount);
    tokenInfo = await tokenContract.token_info(true);
    expect(tokenInfo.supply - supply).toBe(amount);

    // It's possible to execute the request only once
    rejectedTx = await tokenContract.mint_public_multisig(randomAddress, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContract.mint_public_multisig(randomAddress, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
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

  test(`test burn_public_multisig`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;
    const previousAccountPublicBalance = await tokenContract.balances(account);
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_BURN_PUBLIC,
      user: account,
      pause_status: false,
      amount: amount,
      role: 0,
      salt,
    };

    let initMultiSigTx = await tokenContract.init_multisig_op(burnerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenContract.burn_public_multisig(account, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(burnerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContract.burn_public_multisig(account, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContract.burn_public_multisig(account, amount, {
      wallet_id: burnerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenContract.burn_public_multisig(frozenAccount, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenContract.burn_public_multisig(account, amount + 1n, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenContract.burn_public_multisig(account, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await tx.wait();
    tokenInfo = await tokenContract.token_info(true);
    expect(supply - tokenInfo.supply).toBe(amount);
    const balance = await tokenContract.balances(account);
    expect(balance).toBe(previousAccountPublicBalance - amount);

    // It's possible to execute the request only once
    rejectedTx = await tokenContract.burn_public_multisig(account, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContract.burn_public_multisig(account, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
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

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecordFromBurning, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
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

  test(`test burn_private_multisig`, async () => {
    let tokenInfo = await tokenContract.token_info(true);
    const supply = tokenInfo.supply;

    // check multisig support
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const privMultisigOp = {
      op: MULTISIG_OP_BURN_PRIVATE,
      user: account,
      amount: amount,
    };

    let initMultiSigTx = await tokenContract.init_private_multisig_op(
      burnerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(burnerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenContractForFrozenAccount.burn_private_multisig(frozenAccountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount - 1n, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const accountRecordBalanceBefore = accountRecord.amount;
    const burnTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    const [, encryptedAccountRecord] = await burnTx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);
    expect(accountRecord.amount).toBe(accountRecordBalanceBefore - amount);
    expect(accountRecord.owner).toBe(account);
    tokenInfo = await tokenContract.token_info(true);
    expect(supply - tokenInfo.supply).toBe(amount);
    privateAccountBalance -= amount;

    // It's possible to execute the request only once
    rejectedTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_private_multisig_op(
      managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContractForAccount.burn_private_multisig(accountRecord, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
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
    let rejectedTx = await tokenContractForFrozenAccount.transfer_public_to_private(recipient, amount);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const previousAccountPublicBalance = await tokenContract.balances(account);

    const tx = await tokenContractForAccount.transfer_public_to_private(recipient, amount);
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

    const decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
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

    let decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
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
      emptyMultisigCommonParams,
    );
    await updateFreezeListTx.wait();
    let updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(
      1,
      emptyMultisigCommonParams,
    );
    await updateBlockHeightWindowTx.wait();

    let rejectedTransferPrivateTx = await tokenContractForAccount.transfer_private_with_creds(
      recipient,
      amount,
      accountRecord,
      credentials,
    );
    await expect(rejectedTransferPrivateTx.wait()).rejects.toThrow();

    // bring back the old root
    updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(
      frozenAccount,
      true,
      1,
      1n,
      root,
      emptyMultisigCommonParams,
    );
    await updateFreezeListTx.wait();
    updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(
      BLOCK_HEIGHT_WINDOW,
      emptyMultisigCommonParams,
    );
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

    decryptedComplianceRecord = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
    expect(decryptedComplianceRecord.owner).toBe(investigatorAddress);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(account);
    expect(decryptedComplianceRecord.recipient).toBe(recipient);
  });

  test(`test pausing the contract`, async () => {
    // Only the pauser can pause the program
    let rejectedTx = await tokenContractForAdmin.set_pause_status(true, emptyMultisigCommonParams);
    await expect(rejectedTx.wait()).rejects.toThrow();

    let approveTx = await tokenContractForAccount.approve_public(spender, amount);
    await approveTx.wait();

    // pause the contract
    let pauseTx = await tokenContractForPauser.set_pause_status(true, emptyMultisigCommonParams);
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
    pauseTx = await tokenContractForPauser.set_pause_status(false, emptyMultisigCommonParams);
    await pauseTx.wait();
    pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(false);

    //verify that the functionalities are back (one is enough)
    publicTx = await tokenContractForAccount.transfer_public(recipient, amount);
    await publicTx.wait();

    // Even though the caller is a pauser, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    rejectedTx = await tokenContractForBurner.set_pause_status(true, {
      wallet_id: managerWalletId,
      salt: 0n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    rejectedTx = await tokenContractForBurner.set_pause_status(true, {
      wallet_id: ZERO_ADDRESS,
      salt: 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_SET_PAUSE_STATUS,
      user: ZERO_ADDRESS,
      pause_status: true,
      amount: 0n,
      role: 0,
      salt,
    };

    let initMultiSigTx = await tokenContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    rejectedTx = await tokenContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(pauseWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenContract.set_pause_status(true, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the pause status doesn't match the pause status in the request the transaction will fail
    rejectedTx = await tokenContract.set_pause_status(false, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt,
    });
    await tx.wait();
    pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(true);

    // It's possible to execute the request only once
    rejectedTx = await tokenContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenContract.set_pause_status(true, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp.pause_status = false;
    multisigOp.salt = salt;

    initMultiSigTx = await tokenContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(pauseWalletId, signingOpId);

    tx = await tokenContract.set_pause_status(false, {
      wallet_id: pauseWalletId,
      salt,
    });
    await tx.wait();
    pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(false);
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
                const { recipient, sender, amount } = decryptComplianceRecord(complianceRecord, investigatorPrivKey);
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

  test(`test expired multisig requests`, async () => {
    const randomWalletId = new Account().address().to_string();
    await createWallet(randomWalletId, 1, [deployerAddress, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS]);
    const updateWalletTx = await tokenContractForAdmin.update_wallet_id_role(
      randomWalletId,
      MANAGER_ROLE + MINTER_ROLE + BURNER_ROLE + PAUSE_ROLE,
      emptyMultisigCommonParams,
    );
    await updateWalletTx.wait();
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: ZERO_ADDRESS,
      pause_status: false,
      amount: 0n,
      role: 0,
      salt,
    };
    let initMultiSigTx = await tokenContract.init_multisig_op(randomWalletId, multisigOp, 1);
    let [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateWalletIdTX = await tokenContract.update_wallet_id_role(ZERO_ADDRESS, 0, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateWalletIdTX.wait()).rejects.toThrow();

    multisigOp.op = MULTISIG_OP_UPDATE_ROLE;
    initMultiSigTx = await tokenContract.init_multisig_op(randomWalletId, multisigOp, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateRoleTX = await tokenContract.update_role(ZERO_ADDRESS, 0, { salt, wallet_id: randomWalletId });
    await expect(updateRoleTX.wait()).rejects.toThrow();

    multisigOp.op = MULTISIG_OP_MINT_PUBLIC;
    initMultiSigTx = await tokenContract.init_multisig_op(randomWalletId, multisigOp, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateMintPublicTX = await tokenContract.mint_public_multisig(ZERO_ADDRESS, 0n, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateMintPublicTX.wait()).rejects.toThrow();

    multisigOp.op = MULTISIG_OP_BURN_PUBLIC;
    initMultiSigTx = await tokenContract.init_multisig_op(randomWalletId, multisigOp, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateBurnPublicTX = await tokenContract.burn_public_multisig(ZERO_ADDRESS, 0n, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateBurnPublicTX.wait()).rejects.toThrow();

    multisigOp.op = MULTISIG_OP_SET_PAUSE_STATUS;
    initMultiSigTx = await tokenContract.init_multisig_op(randomWalletId, multisigOp, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updatePausePublicTX = await tokenContract.set_pause_status(false, { salt, wallet_id: randomWalletId });
    await expect(updatePausePublicTX.wait()).rejects.toThrow();

    const privMultisigOp = {
      op: MULTISIG_OP_MINT_PRIVATE,
      amount: 1n,
      user: account,
    };
    initMultiSigTx = await tokenContract.init_private_multisig_op(randomWalletId, privMultisigOp, salt, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateMintPrivateTX = await tokenContract.mint_private_multisig(account, 1n, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateMintPrivateTX.wait()).rejects.toThrow();

    privMultisigOp.op = MULTISIG_OP_BURN_PRIVATE;
    initMultiSigTx = await tokenContract.init_private_multisig_op(randomWalletId, privMultisigOp, salt, 1);
    [, wallet_signing_op_id_hash] = await initMultiSigTx.wait();
    await multiSigContract.completed_signing_ops(wallet_signing_op_id_hash);
    await waitBlocks(1);
    const updateBurnPrivateTX = await tokenContractForAccount.burn_private_multisig(accountRecord, 1n, {
      salt,
      wallet_id: randomWalletId,
    });
    await expect(updateBurnPrivateTX.wait()).rejects.toThrow();
  });

  test(`test old root support`, async () => {
    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);

    const senderLeafIndices = getLeafIndices(tree, account);
    const emptyTreeSenderMerkleProof = [
      getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH),
    ];
    // The transaction failed because the root is mismatch
    let rejectedTx = await tokenContractForAccount.transfer_private(
      recipient,
      amount,
      accountRecord,
      emptyTreeSenderMerkleProof,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    const updateFreezeListTx = await freezeRegistryContractForAdmin.update_freeze_list(
      frozenAccount,
      false,
      1,
      root,
      emptyRoot, // fake root
      emptyMultisigCommonParams,
    );
    await updateFreezeListTx.wait();

    const newRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await freezeRegistryContract.freeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(root);
    expect(newRoot).toBe(emptyRoot);

    // The transaction succeed because the old root is match
    let tx = await tokenContractForAccount.transfer_private(recipient, amount, accountRecord, senderMerkleProof);
    const [, encryptedAccountRecord] = await tx.wait();
    accountRecord = decryptToken(encryptedAccountRecord, accountPrivKey);

    const updateBlockHeightWindowTx = await freezeRegistryContractForAdmin.update_block_height_window(
      1,
      emptyMultisigCommonParams,
    );
    await updateBlockHeightWindowTx.wait();

    // The transaction failed because the old root is expired
    rejectedTx = await tokenContractForAccount.transfer_private(recipient, amount, accountRecord, senderMerkleProof);
    await expect(rejectedTx.wait()).rejects.toThrow();

    tx = await tokenContractForAccount.transfer_private(recipient, amount, accountRecord, emptyTreeSenderMerkleProof);
    await tx.wait();
  });
});
