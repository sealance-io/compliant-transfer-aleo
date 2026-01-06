import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import {
  BURNER_ROLE,
  MINTER_ROLE,
  PAUSE_ROLE,
  MANAGER_ROLE,
  ZERO_ADDRESS,
  fundedAmount,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  MAX_BLOCK_HEIGHT,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_MINT_PRIVATE,
  MULTISIG_OP_MINT_PUBLIC,
  MULTISIG_OP_BURN_PUBLIC,
  MULTISIG_OP_SET_PAUSE_STATUS,
  MULTISIG_OP_BURN_PRIVATE,
} from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { Account } from "@provablehq/sdk";
import { decryptToken } from "../artifacts/js/leo2js/compliant_token_template";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { initializeProgram } from "../lib/Initalize";
import { waitBlocks } from "../lib/Block";
import { stringToBigInt } from "@sealance-io/policy-engine-aleo";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { approveRequest, createWallet, initializeMultisig } from "../lib/Multisig";
import { Compliant_token_templateContract } from "../artifacts/js/compliant_token_template";
import { Multisig_token_proxyContract } from "../artifacts/js/multisig_token_proxy";
import { updateAddressToRole } from "../lib/Role";
import { Token } from "../artifacts/js/types/compliant_token_template";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, , frozenAccount, account, , , , , , , , signer1, signer2] =
  contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);

const tokenContract = new Compliant_token_templateContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenContractForAdmin = new Compliant_token_templateContract({
  mode,
  privateKey: adminPrivKey,
});

const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});

const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});

const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});

const tokenProxyContract = new Multisig_token_proxyContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenProxyContractForAdmin = new Multisig_token_proxyContract({
  mode,
  privateKey: adminPrivKey,
});
const tokenProxyContractForAccount = new Multisig_token_proxyContract({
  mode,
  privateKey: accountPrivKey,
});
const tokenProxyContractForFrozenAccount = new Multisig_token_proxyContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const managerWalletId = new Account().address().to_string();
const pauseWalletId = new Account().address().to_string();
const minterWalletId = new Account().address().to_string();
const burnerWalletId = new Account().address().to_string();

const amount = 10n;

describe("test multisig token proxy program", () => {
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

    await fundWithCredits(deployerPrivKey, signer1, fundedAmount);
    await fundWithCredits(deployerPrivKey, signer2, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(tokenContract);
    await deployIfNotDeployed(tokenProxyContract);

    const name = stringToBigInt("Stable Token");
    const symbol = stringToBigInt("STABLE_TOKEN");
    const decimals = 6;
    const maxSupply = 1000_000000000000n;

    await initializeProgram(tokenContract, [name, symbol, decimals, maxSupply, adminAddress, managerWalletId]);
    await updateAddressToRole(
      tokenContractForAdmin,
      tokenProxyContract.address(),
      MANAGER_ROLE + MINTER_ROLE + BURNER_ROLE + PAUSE_ROLE,
    );
  });

  test(`test initialize`, async () => {
    // The caller is not the initial admin
    let rejectedTx = await tokenProxyContract.initialize(managerWalletId);
    await expect(rejectedTx.wait()).rejects.toThrow();

    // The admin or the wallet ID manager has to be non zero
    rejectedTx = await tokenProxyContractForAdmin.initialize(ZERO_ADDRESS);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenProxyContractForAdmin.initialize(managerWalletId);
    await tx.wait();
    const role = await tokenProxyContract.wallet_id_to_role(managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // It is possible to call to initialize only one time
    rejectedTx = await tokenProxyContractForAdmin.initialize(managerWalletId);
    await expect(rejectedTx.wait()).rejects.toThrow();
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

    let tx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [, walletSigningOpIdHash] = await tx.wait();
    let pendingRequest = await tokenProxyContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.op).toBe(0);
    expect(pendingRequest.user).toBe(ZERO_ADDRESS);
    expect(pendingRequest.pause_status).toBe(false);
    expect(pendingRequest.role).toBe(0);
    expect(pendingRequest.amount).toBe(0n);
    expect(pendingRequest.salt).toBe(salt);

    // It's impossible to initiate a request twice
    const rejectedTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp.salt = salt;
    tx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, 1);
    [, walletSigningOpIdHash] = await tx.wait();
    pendingRequest = await tokenProxyContract.pending_requests(walletSigningOpIdHash);
    expect(pendingRequest.salt).toBe(salt);
    await waitBlocks(1);
    // It's possible to initiate this request twice because the previous expired
    tx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [, walletSigningOpIdHash] = await tx.wait();
  });

  test(`test init_private_multisig_op`, async () => {
    let salt = BigInt(Math.floor(Math.random() * 100000));
    const privMultisigOp = {
      op: 0,
      user: ZERO_ADDRESS,
      amount: 0n,
    };

    let tx = await tokenProxyContract.init_private_multisig_op(managerWalletId, privMultisigOp, salt, MAX_BLOCK_HEIGHT);
    let [, walletSigningOpIdHash] = await tx.wait();
    let privatePendingRequest = await tokenProxyContract.private_pending_requests(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);

    // It's impossible to initiate a request twice
    const rejectedTx = await tokenProxyContract.init_private_multisig_op(
      managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    tx = await tokenProxyContract.init_private_multisig_op(managerWalletId, privMultisigOp, salt, 1);
    [, walletSigningOpIdHash] = await tx.wait();
    privatePendingRequest = await tokenProxyContract.private_pending_requests(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);
    // It's possible to initiate this request twice because the previous expired
    tx = await tokenProxyContract.init_private_multisig_op(managerWalletId, privMultisigOp, salt, MAX_BLOCK_HEIGHT);
    [, walletSigningOpIdHash] = await tx.wait();
  });

  test(`test update_wallet_id_role`, async () => {
    let salt = BigInt(Math.floor(Math.random() * 100000));
    let multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: pauseWalletId,
      pause_status: false,
      amount: 0n,
      role: PAUSE_ROLE,
      salt,
    };

    let initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenProxyContract.update_wallet_id_role(minterWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, MANAGER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    let role = await tokenProxyContract.wallet_id_to_role(pauseWalletId);
    expect(role).toBe(PAUSE_ROLE);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContract.update_wallet_id_role(pauseWalletId, PAUSE_ROLE, {
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

    initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);
    tx = await tokenProxyContract.update_wallet_id_role(minterWalletId, MINTER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await tokenProxyContract.wallet_id_to_role(minterWalletId);
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

    initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);
    tx = await tokenProxyContract.update_wallet_id_role(burnerWalletId, BURNER_ROLE, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    role = await tokenProxyContract.wallet_id_to_role(burnerWalletId);
    expect(role).toBe(BURNER_ROLE);
  });

  test(`test update_role`, async () => {
    const randomAddress = new Account().address().to_string();
    const randomRole = [MANAGER_ROLE, BURNER_ROLE, MINTER_ROLE, PAUSE_ROLE, MINTER_ROLE + BURNER_ROLE][
      Math.floor(Math.random() * 5)
    ];

    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: randomAddress,
      pause_status: false,
      amount: 0n,
      role: randomRole,
      salt,
    };

    let initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.update_role(randomAddress, randomRole, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenProxyContract.update_role(deployerAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the role doesn't match the role in the request the transaction will fail
    rejectedTx = await tokenProxyContract.update_role(randomAddress, randomRole + 1, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenProxyContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await tx.wait();
    const role = await tokenContract.address_to_role(randomAddress);
    expect(role).toBe(randomRole);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContract.update_role(randomAddress, randomRole, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContract.update_role(randomAddress, randomRole, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  let accountRecord: Token;
  let frozenAccountRecord: Token;
  test(`test mint_private`, async () => {
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const privMultisigOp = {
      op: MULTISIG_OP_MINT_PRIVATE,
      user: account,
      amount: amount * 20n,
    };

    let initMultiSigTx = await tokenProxyContract.init_private_multisig_op(
      minterWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContract.mint_private(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(minterWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.mint_private(account, amount * 20n, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.mint_private(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenProxyContract.mint_private(deployerAddress, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenProxyContract.mint_private(account, amount, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenProxyContract.mint_private(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await tx.wait();
    console.log((tx as any).transaction.execution.transitions[0].outputs);
    accountRecord = decryptToken((tx as any).transaction.execution.transitions[0].outputs[1].value, accountPrivKey);
    console.log({ accountRecord });
    expect(accountRecord.amount).toBe(amount * 20n);
    expect(accountRecord.owner).toBe(account);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContract.mint_private(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_private_multisig_op(
      managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContract.mint_private(account, amount * 20n, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    privMultisigOp.user = frozenAccount;
    initMultiSigTx = await tokenProxyContract.init_private_multisig_op(
      minterWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(minterWalletId, signingOpId);
    tx = await tokenProxyContract.mint_private(frozenAccount, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await tx.wait();
    console.log((tx as any).transaction.execution.transitions[0].outputs);
    frozenAccountRecord = decryptToken(
      (tx as any).transaction.execution.transitions[0].outputs[1].value,
      frozenAccountPrivKey,
    );
    expect(frozenAccountRecord.amount).toBe(amount * 20n);
    expect(frozenAccountRecord.owner).toBe(frozenAccount);
  });

  test(`test mint_public`, async () => {
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_MINT_PUBLIC,
      user: account,
      pause_status: false,
      amount: amount * 20n,
      role: 0,
      salt,
    };

    let initMultiSigTx = await tokenProxyContract.init_multisig_op(minterWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContract.mint_public(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(minterWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.mint_public(account, amount * 20n, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.mint_public(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenProxyContract.mint_public(deployerAddress, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenProxyContract.mint_public(account, amount + 1n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenProxyContract.mint_public(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await tx.wait();
    const balance = await tokenContract.balances(account);
    expect(balance).toBe(amount * 20n);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContract.mint_public(account, amount * 20n, {
      wallet_id: minterWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContract.mint_public(account, amount * 20n, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test burn_public`, async () => {
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

    let initMultiSigTx = await tokenProxyContract.init_multisig_op(burnerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContract.burn_public(account, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(burnerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.burn_public(account, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.burn_public(account, amount, {
      wallet_id: burnerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenProxyContract.burn_public(frozenAccount, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenProxyContract.burn_public(account, amount + 1n, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await tokenProxyContract.burn_public(account, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await tx.wait();
    const balance = await tokenContract.balances(account);
    expect(balance).toBe(previousAccountPublicBalance - amount);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContract.burn_public(account, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContract.burn_public(account, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test burn_private`, async () => {
    // check multisig support
    const salt = BigInt(Math.floor(Math.random() * 100000));
    const privMultisigOp = {
      op: MULTISIG_OP_BURN_PRIVATE,
      user: account,
      amount: amount,
    };

    let initMultiSigTx = await tokenProxyContract.init_private_multisig_op(
      burnerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(burnerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the address doesn't match the address in the request the transaction will fail
    rejectedTx = await tokenProxyContractForFrozenAccount.burn_private(frozenAccountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the amount doesn't match the amount in the request the transaction will fail
    rejectedTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount - 1n, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    const accountRecordBalanceBefore = accountRecord.amount;
    const burnTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await burnTx.wait();
    console.log((burnTx as any).transaction.execution.transitions[0].outputs);

    accountRecord = decryptToken((burnTx as any).transaction.execution.transitions[0].outputs[1].value, accountPrivKey);
    expect(accountRecord.amount).toBe(accountRecordBalanceBefore - amount);
    expect(accountRecord.owner).toBe(account);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount, {
      wallet_id: burnerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_private_multisig_op(
      managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContractForAccount.burn_private(accountRecord, amount, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test pausing the contract`, async () => {
    let salt = BigInt(Math.floor(Math.random() * 100000));
    const multisigOp = {
      op: MULTISIG_OP_SET_PAUSE_STATUS,
      user: ZERO_ADDRESS,
      pause_status: true,
      amount: 0n,
      role: 0,
      salt,
    };

    let initMultiSigTx = await tokenProxyContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    let [signingOpId] = await initMultiSigTx.wait();

    // If the request wasn't approved yet the transaction will fail
    let rejectedTx = await tokenProxyContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    await approveRequest(pauseWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.set_pause_status(true, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the salt is incorrect the transaction will fail
    rejectedTx = await tokenProxyContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt: salt + 1n,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    // If the pause status doesn't match the pause status in the request the transaction will fail
    rejectedTx = await tokenProxyContract.set_pause_status(false, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    let tx = await tokenProxyContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt,
    });
    await tx.wait();
    let pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(true);

    // It's possible to execute the request only once
    rejectedTx = await tokenProxyContract.set_pause_status(true, {
      wallet_id: pauseWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    initMultiSigTx = await tokenProxyContract.init_multisig_op(managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    rejectedTx = await tokenProxyContract.set_pause_status(true, {
      wallet_id: managerWalletId,
      salt,
    });
    await expect(rejectedTx.wait()).rejects.toThrow();

    salt = BigInt(Math.floor(Math.random() * 100000));
    multisigOp.pause_status = false;
    multisigOp.salt = salt;

    initMultiSigTx = await tokenProxyContract.init_multisig_op(pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);
    [signingOpId] = await initMultiSigTx.wait();
    await approveRequest(pauseWalletId, signingOpId);

    tx = await tokenProxyContract.set_pause_status(false, {
      wallet_id: pauseWalletId,
      salt,
    });
    await tx.wait();
    pauseStatus = await tokenContract.pause(true);
    expect(pauseStatus).toBe(false);
  });
});
