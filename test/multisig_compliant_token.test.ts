import { AleoNetworkClient } from "@provablehq/sdk";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import {
  buildTree,
  generateLeaves,
  getLeafIndices,
  getSiblingPath,
  stringToBigInt,
} from "@sealance-io/policy-engine-aleo";
import {
  BLOCK_HEIGHT_WINDOW,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_BLOCK_HEIGHT,
  MAX_TREE_DEPTH,
  MINTER_ROLE,
  MULTISIG_OP_BURN_PRIVATE,
  MULTISIG_OP_BURN_PUBLIC,
  MULTISIG_OP_MINT_PRIVATE,
  MULTISIG_OP_MINT_PUBLIC,
  MULTISIG_OP_SET_PAUSE_STATUS,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  NONE_ROLE,
  PAUSE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  emptyRoot,
  fundedAmount,
  emptyMultisigCommonParams,
  zeroAddress,
  emptyRootField,
  SETUP_TIMEOUT_MS,
  maxSupply,
  amount,
  decimals,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { addressLiteral, asSigner, fieldLiteral, scalarLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { Leo } from "../typechain/BaseContract.js";
import {
  createMultisigCompliantToken,
  decryptComplianceRecord,
  type Credentials,
  type MerkleProof,
  type Token,
} from "../typechain/MultisigCompliantToken.js";
import { createMultisigCore } from "../typechain/MultisigCore.js";
import { createMultisigFreezelistRegistry } from "../typechain/MultisigFreezelistRegistry.js";
import { safeAccount, safeAddress } from "./utils/Accounts.js";
import { getLatestBlockHeight, waitBlocks } from "../lib/Block.js";
import { approveRequest, createWallet, initializeMultisig, multisigCommonParams, randomSalt } from "../lib/Multisig.js";

const tokenName = stringToBigInt("Stable Token");
const tokenSymbol = stringToBigInt("STABLE_TOKEN");

const managerWalletId = Leo.address(safeAddress());
const pauseWalletId = Leo.address(safeAddress());
const minterWalletId = Leo.address(safeAddress());
const burnerWalletId = Leo.address(safeAddress());

interface MultisigCompliantTokenFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly investigator: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly recipient: SignableNamedAccount;
  readonly minter: SignableNamedAccount;
  readonly burner: SignableNamedAccount;
  readonly supplyManager: SignableNamedAccount;
  readonly spender: SignableNamedAccount;
  readonly pauser: SignableNamedAccount;
  readonly signer1: SignableNamedAccount;
  readonly signer2: SignableNamedAccount;
  readonly token: ReturnType<typeof createMultisigCompliantToken>;
  readonly freezeRegistry: ReturnType<typeof createMultisigFreezelistRegistry>;
  readonly multisig: ReturnType<typeof createMultisigCore>;
  readonly managerWalletId: ReturnType<typeof Leo.address>;
  readonly pauseWalletId: ReturnType<typeof Leo.address>;
  readonly minterWalletId: ReturnType<typeof Leo.address>;
  readonly burnerWalletId: ReturnType<typeof Leo.address>;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly senderMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
  accountRecord?: Token;
  frozenAccountRecord?: Token;
  credentials?: Credentials;
  privateAccountBalance: bigint;
  startBlock: number;
}

async function initMultisigOp(
  fixture: MultisigCompliantTokenFixture,
  walletId: ReturnType<typeof Leo.address>,
  multisigOp: {
    op: number;
    user: ReturnType<typeof Leo.address>;
    pause_status: boolean;
    amount: bigint;
    role: number;
    salt: ReturnType<typeof scalarLiteral>;
  },
  blockExpiration: number,
) {
  const tx = await fixture.token.init_multisig_op.accepted(
    walletId,
    multisigOp,
    blockExpiration,
    asSigner(fixture.deployer),
  );

  return {
    signingOpId: await tx.outputs[0].decrypt(fixture.deployer),
    walletSigningOpIdHash: await tx.outputs[1].decrypt(fixture.deployer),
  };
}

async function initPrivateMultisigOp(
  fixture: MultisigCompliantTokenFixture,
  walletId: ReturnType<typeof Leo.address>,
  multisigOp: {
    op: number;
    user: ReturnType<typeof Leo.address>;
    amount: bigint;
  },
  salt: bigint,
  blockExpiration: number,
) {
  const tx = await fixture.token.init_private_multisig_op.accepted(
    walletId,
    multisigOp,
    scalarLiteral(salt),
    blockExpiration,
    asSigner(fixture.deployer),
  );

  return {
    signingOpId: await tx.outputs[0].decrypt(fixture.deployer),
    walletSigningOpIdHash: await tx.outputs[1].decrypt(fixture.deployer),
  };
}

async function deployFixture() {
  const ctx = await setup();

  try {
    const deployer = ctx.named.signer("deployer");
    const admin = ctx.named.signer("admin");
    const investigator = ctx.named.signer("investigator");
    const frozenAccount = ctx.named.signer("frozenAccount");
    const account = ctx.named.signer("account");
    const recipient = ctx.named.signer("recipient");
    const minter = ctx.named.signer("minter");
    const burner = ctx.named.signer("burner");
    const supplyManager = ctx.named.signer("supplyManager");
    const spender = ctx.named.signer("spender");
    const pauser = ctx.named.signer("pauser");
    const signer1 = ctx.named.signer("signer1");
    const signer2 = ctx.named.signer("signer2");

    for (const signer of [
      admin,
      frozenAccount,
      account,
      minter,
      burner,
      supplyManager,
      spender,
      pauser,
      signer1,
      signer2,
    ]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const token = createMultisigCompliantToken().connect(ctx.lre);
    const freezeRegistry = createMultisigFreezelistRegistry().connect(ctx.lre);
    const multisig = createMultisigCore().connect(ctx.lre);

    for (const program of [
      "merkle_tree",
      "multisig_core",
      "multisig_freezelist_registry",
      "multisig_compliant_token",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await initializeMultisig(multisig, deployer);

    const aleoSigners = [signer1, signer2, zeroAddress, zeroAddress] as const;
    await createWallet(multisig, deployer, managerWalletId, aleoSigners);
    await createWallet(multisig, deployer, pauseWalletId, aleoSigners);
    await createWallet(multisig, deployer, minterWalletId, aleoSigners);
    await createWallet(multisig, deployer, burnerWalletId, aleoSigners);

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;
    const rootField = fieldLiteral(root);
    const senderLeafIndices = getLeafIndices(tree, account.address);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount.address);
    const senderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    const frozenAccountMerkleProof = [
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH)),
    ];

    const isFreezeRegistryInitialized =
      await freezeRegistry.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
    if (!isFreezeRegistryInitialized) {
      await freezeRegistry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, zeroAddress, asSigner(admin));
    }

    const role = await freezeRegistry.mappings.addressToRole.get(admin);
    if ((role & FREEZELIST_MANAGER_ROLE) !== FREEZELIST_MANAGER_ROLE) {
      await freezeRegistry.update_role.accepted(
        admin,
        MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
        emptyMultisigCommonParams,
        asSigner(admin),
      );
    }

    const isAccountFrozen = await freezeRegistry.mappings.freezeList.getOrUse(frozenAccount, false);
    if (!isAccountFrozen) {
      await freezeRegistry.update_freeze_list.accepted(
        frozenAccount,
        true,
        1,
        emptyRootField,
        rootField,
        emptyMultisigCommonParams,
        asSigner(admin),
      );
    }

    return {
      ctx,
      deployer,
      admin,
      investigator,
      frozenAccount,
      account,
      recipient,
      minter,
      burner,
      supplyManager,
      spender,
      pauser,
      signer1,
      signer2,
      token,
      freezeRegistry,
      multisig,
      managerWalletId,
      pauseWalletId,
      minterWalletId,
      burnerWalletId,
      rootField,
      senderMerkleProof,
      frozenAccountMerkleProof,
      privateAccountBalance: 0n,
      startBlock: 0,
    } satisfies MultisigCompliantTokenFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: MultisigCompliantTokenFixture | undefined;

beforeAll(async () => {
  state = await loadFixture(deployFixture);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (state) {
    await state.ctx.teardown();
  } else {
    clearFixtures();
  }
});

describe("test multisig_compliant_token program", () => {
  test("test initialize", async () => {
    const fixture = state!;

    // The admin or the wallet ID manager has to be non zero
    await fixture.freezeRegistry.initialize.rejected(
      zeroAddress,
      BLOCK_HEIGHT_WINDOW,
      zeroAddress,
      asSigner(fixture.deployer),
    );

    if (!(await fixture.token.mappings.tokenInfo.contains(true))) {
      await fixture.token.initialize.accepted(
        tokenName,
        tokenSymbol,
        decimals,
        maxSupply,
        fixture.admin,
        fixture.managerWalletId,
        asSigner(fixture.admin),
      );

      const tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
      expect(tokenInfo.supply).toBe(0n);
      expect(tokenInfo.decimals).toBe(decimals);
      expect(tokenInfo.max_supply).toBe(maxSupply);
      expect(tokenInfo.name).toBe(tokenName);
      expect(tokenInfo.symbol).toBe(tokenSymbol);
      const role = await fixture.token.mappings.addressToRole.get(fixture.admin);
      expect(role).toBe(MANAGER_ROLE);
      const pauseStatus = await fixture.token.mappings.pause.get(true);
      expect(pauseStatus).toBe(false);

      // It is possible to call to initialize only one time
      await fixture.token.initialize.rejected(
        tokenName,
        tokenSymbol,
        decimals,
        maxSupply,
        fixture.admin,
        fixture.managerWalletId,
        asSigner(fixture.admin),
      );
    }
  });

  test("test init_multisig_op", async () => {
    const fixture = state!;

    let salt = randomSalt();
    const multisigOp = {
      op: 0,
      user: zeroAddress,
      pause_status: false,
      amount: 0n,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { walletSigningOpIdHash } = await initMultisigOp(
      fixture,
      fixture.managerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );
    let pendingRequest = await fixture.token.mappings.pendingRequests.get(walletSigningOpIdHash);
    expect(pendingRequest?.op).toBe(0);
    expect(pendingRequest?.user).toBe(zeroAddress);
    expect(pendingRequest?.pause_status).toBe(false);
    expect(pendingRequest?.role).toBe(0);
    expect(pendingRequest?.amount).toBe(0n);
    expect(pendingRequest?.salt).toBe(scalarLiteral(salt));

    // It's impossible to initiate a request twice
    await fixture.token.init_multisig_op.rejected(
      fixture.managerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    multisigOp.salt = scalarLiteral(salt);
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, 1));
    pendingRequest = await fixture.token.mappings.pendingRequests.get(walletSigningOpIdHash);
    expect(pendingRequest?.salt).toBe(scalarLiteral(salt));
    await waitBlocks(fixture.ctx, 1);
    // It's possible to initiate this request twice because the previous expired
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    expect(walletSigningOpIdHash).toBeDefined();
  });

  test("test init_private_multisig_op", async () => {
    const fixture = state!;

    let salt = randomSalt();
    const privMultisigOp = {
      op: 0,
      user: zeroAddress,
      amount: 0n,
    };

    let { walletSigningOpIdHash } = await initPrivateMultisigOp(
      fixture,
      fixture.managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );
    let privatePendingRequest = await fixture.token.mappings.privatePendingRequests.get(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);

    // It's impossible to initiate a request twice
    await fixture.token.init_private_multisig_op.rejected(
      fixture.managerWalletId,
      privMultisigOp,
      scalarLiteral(salt),
      MAX_BLOCK_HEIGHT,
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    ({ walletSigningOpIdHash } = await initPrivateMultisigOp(
      fixture,
      fixture.managerWalletId,
      privMultisigOp,
      salt,
      1,
    ));
    privatePendingRequest = await fixture.token.mappings.privatePendingRequests.get(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);
    await waitBlocks(fixture.ctx, 1);
    // It's possible to initiate this request twice because the previous expired
    ({ walletSigningOpIdHash } = await initPrivateMultisigOp(
      fixture,
      fixture.managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    ));
    expect(walletSigningOpIdHash).toBeDefined();
  });

  test("test update_wallet_id_role", async () => {
    const fixture = state!;

    // Non manager address can't update the wallet_id without multisig approval
    await fixture.token.update_wallet_id_role.rejected(
      fixture.managerWalletId,
      MULTISIG_OP_UPDATE_WALLET_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.deployer),
    );

    await fixture.token.update_wallet_id_role.accepted(
      fixture.managerWalletId,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    let role = await fixture.token.mappings.walletIdToRole.get(fixture.managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.token.update_wallet_id_role.rejected(
      fixture.managerWalletId,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, 0n),
      asSigner(fixture.admin),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.token.update_wallet_id_role.rejected(
      fixture.managerWalletId,
      MANAGER_ROLE,
      multisigCommonParams(zeroAddress, 1n),
      asSigner(fixture.admin),
    );

    let salt = randomSalt();
    let multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: fixture.pauseWalletId,
      pause_status: false,
      amount: 0n,
      role: PAUSE_ROLE,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.token.update_wallet_id_role.rejected(
      fixture.minterWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.token.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.token.update_wallet_id_role.accepted(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    role = await fixture.token.mappings.walletIdToRole.get(fixture.pauseWalletId);
    expect(role).toBe(PAUSE_ROLE);

    // It's possible to execute the request only once
    await fixture.token.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: fixture.minterWalletId,
      pause_status: false,
      amount: 0n,
      role: MINTER_ROLE,
      salt: scalarLiteral(salt),
    };

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);
    await fixture.token.update_wallet_id_role.accepted(
      fixture.minterWalletId,
      MINTER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    role = await fixture.token.mappings.walletIdToRole.get(fixture.minterWalletId);
    expect(role).toBe(MINTER_ROLE);

    salt = randomSalt();
    multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: fixture.burnerWalletId,
      pause_status: false,
      amount: 0n,
      role: BURNER_ROLE,
      salt: scalarLiteral(salt),
    };

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);
    await fixture.token.update_wallet_id_role.accepted(
      fixture.burnerWalletId,
      BURNER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    role = await fixture.token.mappings.walletIdToRole.get(fixture.burnerWalletId);
    expect(role).toBe(BURNER_ROLE);
  });

  test("test update_role", async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.token.update_role.accepted(
      fixture.frozenAccount,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    let role = await fixture.token.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.token.update_role.accepted(
      fixture.frozenAccount,
      NONE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.token.update_role.rejected(
      fixture.frozenAccount,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update minter role
    await fixture.token.update_role.rejected(
      fixture.minter,
      MINTER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.account),
    );

    // Non admin user cannot update burner role
    await fixture.token.update_role.rejected(
      fixture.burner,
      BURNER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.account),
    );

    // Non admin user cannot update supply manager role
    await fixture.token.update_role.rejected(
      fixture.supplyManager,
      MINTER_ROLE + BURNER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.account),
    );

    // Non admin user cannot update none role
    await fixture.token.update_role.rejected(
      fixture.account,
      NONE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.account),
    );

    // Non admin user cannot update pause role
    await fixture.token.update_role.rejected(
      fixture.account,
      PAUSE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.account),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.token.update_role.rejected(
      fixture.admin,
      NONE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );

    // Manager can assign minter, burner, manager, pauser and supply manager roles
    await fixture.token.update_role.accepted(
      fixture.minter,
      MINTER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.minter);
    expect(role).toBe(MINTER_ROLE);

    await fixture.token.update_role.accepted(
      fixture.burner,
      BURNER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.burner);
    expect(role).toBe(BURNER_ROLE);

    await fixture.token.update_role.accepted(
      fixture.supplyManager,
      MINTER_ROLE + BURNER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);

    await fixture.token.update_role.accepted(
      fixture.account,
      NONE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.account);
    expect(role).toBe(NONE_ROLE);

    await fixture.token.update_role.accepted(
      fixture.pauser,
      PAUSE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.pauser);
    expect(role).toBe(PAUSE_ROLE);

    await fixture.token.update_role.accepted(
      fixture.admin,
      MANAGER_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.admin);
    expect(role).toBe(MANAGER_ROLE);

    const randomAddress = addressLiteral(safeAddress());
    const randomRole = [MANAGER_ROLE, BURNER_ROLE, MINTER_ROLE, PAUSE_ROLE, MINTER_ROLE + BURNER_ROLE][
      Math.floor(Math.random() * 5)
    ]!;

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, 0n),
      asSigner(fixture.admin),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(zeroAddress, 1n),
      asSigner(fixture.admin),
    );

    const salt = randomSalt();
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: randomAddress,
      pause_status: false,
      amount: 0n,
      role: randomRole,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.token.update_role.rejected(
      fixture.deployer,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole + 1,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.token.update_role.accepted(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    role = await fixture.token.mappings.addressToRole.get(randomAddress);
    expect(role).toBe(randomRole);

    // It's possible to execute the request only once
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test("test mint_private", async () => {
    const fixture = state!;

    fixture.startBlock = await getLatestBlockHeight(fixture.ctx);

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    // a regular user cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.account));
    // a burner cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.burner));
    // an admin cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.admin));

    let tx = await fixture.token.mint_private.accepted(fixture.frozenAccount, amount * 20n, asSigner(fixture.minter));
    fixture.frozenAccountRecord = await tx.outputs[1].decrypt(fixture.frozenAccount);
    expect(fixture.frozenAccountRecord.amount).toBe(amount * 20n);
    expect(fixture.frozenAccountRecord.owner).toBe(fixture.frozenAccount.address);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount * 20n);

    tx = await fixture.token.mint_private.accepted(fixture.account, amount * 20n, asSigner(fixture.supplyManager));
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(amount * 20n);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount * 40n);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount * 20n);
    expect(complianceRecord.sender).toBe(zeroAddress);
    expect(complianceRecord.recipient).toBe(fixture.account.address);

    fixture.privateAccountBalance += amount * 20n;
  });

  test("test mint_private_multisig", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    const randomAccount = safeAccount();
    const randomPrivKey = randomAccount.privateKey().to_string();
    const randomAddress = addressLiteral(randomAccount.address().to_string());
    const salt = randomSalt();
    const privMultisigOp = {
      op: MULTISIG_OP_MINT_PRIVATE,
      user: randomAddress,
      amount,
    };

    let { signingOpId } = await initPrivateMultisigOp(
      fixture,
      fixture.minterWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.mint_private_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.mint_private_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.mint_private_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.token.mint_private_multisig.rejected(
      fixture.deployer,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.token.mint_private_multisig.rejected(
      randomAddress,
      amount + 1n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    const tx = await fixture.token.mint_private_multisig.accepted(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );
    const randomAccountRecord = await tx.outputs[1].decrypt(randomPrivKey);
    expect(randomAccountRecord.amount).toBe(amount);
    expect(randomAccountRecord.owner).toBe(randomAddress);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount);

    const complianceRandomRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRandomRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRandomRecord.amount).toBe(amount);
    expect(complianceRandomRecord.sender).toBe(zeroAddress);
    expect(complianceRandomRecord.recipient).toBe(randomAddress);

    // It's possible to execute the request only once
    await fixture.token.mint_private_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initPrivateMultisigOp(
      fixture,
      fixture.managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    ));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.mint_private_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test("test mint_public", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    // a regular user cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.account));
    // a burner cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.burner));
    // an admin cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.admin));

    await fixture.token.mint_public.accepted(fixture.frozenAccount, amount * 20n, asSigner(fixture.minter));
    let balance = await fixture.token.mappings.balances.get(fixture.frozenAccount);
    expect(balance).toBe(amount * 20n);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount * 20n);

    await fixture.token.mint_public.accepted(fixture.account, amount * 20n, asSigner(fixture.supplyManager));
    balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(amount * 20n);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount * 40n);
  });

  test("test mint_public_multisig", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    const randomAddress = addressLiteral(safeAddress());
    const salt = randomSalt();
    const multisigOp = {
      op: MULTISIG_OP_MINT_PUBLIC,
      user: randomAddress,
      pause_status: false,
      amount,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.minterWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.mint_public_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.mint_public_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.mint_public_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.token.mint_public_multisig.rejected(
      fixture.deployer,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.token.mint_public_multisig.rejected(
      randomAddress,
      amount + 1n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.token.mint_public_multisig.accepted(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );
    const balance = await fixture.token.mappings.balances.get(randomAddress);
    expect(balance).toBe(amount);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount);

    // It's possible to execute the request only once
    await fixture.token.mint_public_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.mint_public_multisig.rejected(
      randomAddress,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test("test burn_public", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    // A regular user cannot burn public assets
    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.account));

    // A minter user cannot burn public assets
    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.minter));

    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.admin));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    await fixture.token.burn_public.accepted(fixture.account, amount, asSigner(fixture.burner));
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply - tokenInfo!.supply).toBe(amount);

    await fixture.token.burn_public.accepted(fixture.account, amount, asSigner(fixture.supplyManager));
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply - tokenInfo!.supply).toBe(amount * 2n);

    const balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount * 2n);
  });

  test("test burn_public_multisig", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;
    const previousAccountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const salt = randomSalt();
    const multisigOp = {
      op: MULTISIG_OP_BURN_PUBLIC,
      user: addressLiteral(fixture.account),
      pause_status: false,
      amount,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.burnerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.burn_public_multisig.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.burnerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.burn_public_multisig.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.burn_public_multisig.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.token.burn_public_multisig.rejected(
      fixture.frozenAccount,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.token.burn_public_multisig.rejected(
      fixture.account,
      amount + 1n,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.token.burn_public_multisig.accepted(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply - tokenInfo!.supply).toBe(amount);
    const balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount);

    // It's possible to execute the request only once
    await fixture.token.burn_public_multisig.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.burn_public_multisig.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test("test burn_private", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    // A user that doesn't have a burner role cannot burn private assets
    await fixture.token.burn_private.rejected(fixture.accountRecord!, amount, asSigner(fixture.account));

    let mintTx = await fixture.token.mint_private.accepted(fixture.burner, amount, asSigner(fixture.minter));
    let burnerRecord = await mintTx.outputs[1].decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(amount);
    expect(burnerRecord.owner).toBe(fixture.burner.address);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount);

    let burnTx = await fixture.token.burn_private.accepted(burnerRecord, amount, asSigner(fixture.burner));
    burnerRecord = await burnTx.outputs[1].decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(0n);
    expect(burnerRecord.owner).toBe(fixture.burner.address);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply).toBe(tokenInfo!.supply);

    const complianceRecord = await burnTx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.burner.address);
    expect(complianceRecord.recipient).toBe(zeroAddress);

    // check that MINTER_ROLE+BURNER_ROLE can burn private assets
    mintTx = await fixture.token.mint_private.accepted(fixture.supplyManager, amount, asSigner(fixture.minter));
    let supplyManagerRecord = await mintTx.outputs[1].decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(amount);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount);

    burnTx = await fixture.token.burn_private.accepted(supplyManagerRecord, amount, asSigner(fixture.supplyManager));
    supplyManagerRecord = await burnTx.outputs[1].decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(0n);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply).toBe(tokenInfo!.supply);
  });

  test("test burn_private_multisig", async () => {
    const fixture = state!;

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const supply = tokenInfo!.supply;

    // check multisig support
    const salt = randomSalt();
    const privMultisigOp = {
      op: MULTISIG_OP_BURN_PRIVATE,
      user: addressLiteral(fixture.account),
      amount,
    };

    let { signingOpId } = await initPrivateMultisigOp(
      fixture,
      fixture.burnerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.burnerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.account),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt + 1n),
      asSigner(fixture.account),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.token.burn_private_multisig.rejected(
      fixture.frozenAccountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.frozenAccount),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      amount - 1n,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );

    const accountRecordBalanceBefore = fixture.accountRecord!.amount;
    const burnTx = await fixture.token.burn_private_multisig.accepted(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );
    fixture.accountRecord = await burnTx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(accountRecordBalanceBefore - amount);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply - tokenInfo!.supply).toBe(amount);
    fixture.privateAccountBalance -= amount;

    // It's possible to execute the request only once
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );

    ({ signingOpId } = await initPrivateMultisigOp(
      fixture,
      fixture.managerWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    ));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.account),
    );
  });

  test("test transfer_public", async () => {
    const fixture = state!;
    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    // If the sender is frozen account it's IMPOSSIBLE to send tokens
    await fixture.token.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's IMPOSSIBLE to send tokens
    await fixture.token.transfer_public.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    await fixture.token.transfer_public.accepted(fixture.recipient, amount, asSigner(fixture.account));

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test transfer_public_as_signer", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_as_signer.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's IMPOSSIBLE to send tokens
    await fixture.token.transfer_public.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    await fixture.token.transfer_public_as_signer.accepted(fixture.recipient, amount, asSigner(fixture.account));

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test transfer_from_public", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.unapprove_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    // approve the spender
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.frozenAccount));

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public.rejected(
      fixture.frozenAccount,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.frozenAccount,
      amount,
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    await fixture.token.transfer_from_public.accepted(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test transfer_from_public_to_private", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.unapprove_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    // approve the spender
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.frozenAccount));

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.frozenAccount,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    const tx = await fixture.token.transfer_from_public_to_private.accepted(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );
    const recipientRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_public_to_private", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_to_private.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    const tx = await fixture.token.transfer_public_to_private.accepted(
      fixture.recipient,
      amount,
      asSigner(fixture.account),
    );
    const recipientRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_private", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_private.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    const tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    const recipientRecord = await tx.outputs[2].decrypt(fixture.recipient);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test("test transfer_priv_to_public", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    const tx = await fixture.token.transfer_private_to_public.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test get_credentials", async () => {
    const fixture = state!;

    // It's impossible to get the credentials record with an invalid merkle proof
    await fixture.token.get_credentials.failsLocally(fixture.frozenAccountMerkleProof, asSigner(fixture.frozenAccount));

    const randomAddress = safeAddress();
    const leaves = generateLeaves([randomAddress]);
    const tree = buildTree(leaves);
    const senderLeafIndices = getLeafIndices(tree, fixture.account.address);
    const IncorrectSenderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];

    // If the root doesn't match the on-chain root the transaction will be rejected
    await fixture.token.get_credentials.rejected(IncorrectSenderMerkleProof, asSigner(fixture.account));

    const tx = await fixture.token.get_credentials.accepted(fixture.senderMerkleProof, asSigner(fixture.account));
    fixture.credentials = await tx.outputs.decrypt(fixture.account);
    expect(fixture.credentials.owner).toBe(fixture.account.address);
    expect(fixture.credentials.freeze_list_root).toBe(fixture.rootField);
  });

  test("test transfer with credentials", async () => {
    const fixture = state!;
    const fakeRootField = fieldLiteral(1n);

    let transferPrivateTx = await fixture.token.transfer_private_with_creds.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;
    let complianceRecord = await transferPrivateTx.outputs[0].decrypt(fixture.investigator);
    let encryptedSenderRecord = await transferPrivateTx.outputs[1].decrypt(fixture.account);
    let encryptedRecipientRecord = await transferPrivateTx.outputs[2].decrypt(fixture.recipient);
    let encryptedCredRecord = await transferPrivateTx.outputs[3].decrypt(fixture.account);
    fixture.credentials = encryptedCredRecord;
    expect(fixture.credentials.owner).toBe(fixture.account.address);
    expect(fixture.credentials.freeze_list_root).toBe(fixture.rootField);
    let previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = encryptedSenderRecord;
    let recipientRecord = encryptedRecipientRecord;
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    // Update the root to make the old credentials expired
    await fixture.freezeRegistry.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField,
      fakeRootField,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    await fixture.freezeRegistry.update_block_height_window.accepted(
      1,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );

    await fixture.token.transfer_private_with_creds.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );

    // bring back the old root
    await fixture.freezeRegistry.update_freeze_list.accepted(
      fixture.frozenAccount,
      true,
      1,
      fakeRootField,
      fixture.rootField,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    await fixture.freezeRegistry.update_block_height_window.accepted(
      BLOCK_HEIGHT_WINDOW,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );

    transferPrivateTx = await fixture.token.transfer_private_with_creds.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;
    complianceRecord = await transferPrivateTx.outputs[0].decrypt(fixture.investigator);
    encryptedSenderRecord = await transferPrivateTx.outputs[1].decrypt(fixture.account);
    encryptedRecipientRecord = await transferPrivateTx.outputs[2].decrypt(fixture.recipient);
    encryptedCredRecord = await transferPrivateTx.outputs[3].decrypt(fixture.account);
    fixture.credentials = encryptedCredRecord;
    expect(fixture.credentials.owner).toBe(fixture.account.address);
    expect(fixture.credentials.freeze_list_root).toBe(fixture.rootField);
    previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = encryptedSenderRecord;
    recipientRecord = encryptedRecipientRecord;
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test("test pausing the contract", async () => {
    const fixture = state!;

    // Only the pauser can pause the program
    await fixture.token.set_pause_status.rejected(true, emptyMultisigCommonParams, asSigner(fixture.admin));

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // pause the contract
    await fixture.token.set_pause_status.accepted(true, emptyMultisigCommonParams, asSigner(fixture.pauser));
    let pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(true);

    // verify that all the functionalities are paused
    await fixture.token.mint_public.rejected(fixture.recipient, amount, asSigner(fixture.minter));

    await fixture.token.mint_private.rejected(fixture.recipient, amount, asSigner(fixture.minter));

    await fixture.token.burn_public.rejected(fixture.recipient, amount, asSigner(fixture.burner));

    await fixture.token.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.token.transfer_public_as_signer.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.token.approve_public.rejected(fixture.spender, amount, asSigner(fixture.account));

    await fixture.token.unapprove_public.rejected(fixture.spender, amount, asSigner(fixture.account));

    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.transfer_public_to_private.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.token.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.token.transfer_private_to_public.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.token.transfer_private_with_creds.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );

    // unpause the contract
    await fixture.token.set_pause_status.accepted(false, emptyMultisigCommonParams, asSigner(fixture.pauser));
    pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(false);

    //verify that the functionalities are back (one is enough)
    await fixture.token.transfer_public.accepted(fixture.recipient, amount, asSigner(fixture.account));

    // Even though the caller is a pauser, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.managerWalletId, 0n),
      asSigner(fixture.burner),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(zeroAddress, 1n),
      asSigner(fixture.burner),
    );

    let salt = randomSalt();
    const multisigOp = {
      op: MULTISIG_OP_SET_PAUSE_STATUS,
      user: zeroAddress,
      pause_status: true,
      amount: 0n,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the pause status doesn't match the pause status in the request the transaction will fail
    await fixture.token.set_pause_status.rejected(
      false,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.token.set_pause_status.accepted(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );
    pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(true);

    // It's possible to execute the request only once
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.token.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    multisigOp.pause_status = false;
    multisigOp.salt = scalarLiteral(salt);

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    await fixture.token.set_pause_status.accepted(
      false,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );
    pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(false);
  });

  test("calculate private balance", async () => {
    const fixture = state!;
    const networkClient = new AleoNetworkClient(fixture.ctx.connection.endpoint);
    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    let calculatedAccountBalance = 0n;
    let calculatedBurnerBalance = 0n;
    while (latestBlockHeight > fixture.startBlock) {
      const endBlock = Math.min(fixture.startBlock + 50, latestBlockHeight);
      const blockRange = await networkClient.getBlockRange(fixture.startBlock, endBlock);
      fixture.startBlock += 50;
      for (const block of blockRange) {
        if (!block.transactions || block.transactions.length === 0) {
          // Skip empty blocks
          continue;
        }
        for (const tx of block.transactions) {
          if (!tx.transaction?.execution?.transitions) continue;
          for (const transition of tx.transaction.execution.transitions ?? []) {
            if (
              transition.program === "multisig_compliant_token.aleo" &&
              transition.outputs &&
              transition.outputs[0].type === "record"
            ) {
              try {
                const complianceRecord = await decryptComplianceRecord(
                  transition.outputs[0].value,
                  fixture.investigator.privateKey,
                );
                const { recipient, sender, amount: transferredAmount } = complianceRecord;
                if (
                  sender === fixture.account.address &&
                  !["transfer_from_public_to_private", "transfer_public_to_private"].includes(transition.function)
                ) {
                  calculatedAccountBalance -= transferredAmount;
                }
                if (recipient === fixture.account.address && transition.function !== "transfer_private_to_public") {
                  calculatedAccountBalance += transferredAmount;
                }
                if (
                  sender === fixture.burner.address &&
                  !["transfer_from_public_to_private", "transfer_public_to_private"].includes(transition.function)
                ) {
                  calculatedBurnerBalance -= transferredAmount;
                }
                if (recipient === fixture.burner.address && transition.function !== "transfer_private_to_public") {
                  calculatedBurnerBalance += transferredAmount;
                }
              } catch {}
            }
          }
        }
      }
    }
    expect(calculatedAccountBalance).toBe(fixture.privateAccountBalance);
    expect(calculatedBurnerBalance).toBe(0n);
  });

  test("test expired multisig requests", async () => {
    const fixture = state!;

    const randomWalletId = addressLiteral(safeAddress());
    await createWallet(
      fixture.multisig,
      fixture.deployer,
      randomWalletId,
      [fixture.deployer, zeroAddress, zeroAddress, zeroAddress],
      1,
    );
    await fixture.token.update_wallet_id_role.accepted(
      randomWalletId,
      MANAGER_ROLE + MINTER_ROLE + BURNER_ROLE + PAUSE_ROLE,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );
    const salt = randomSalt();
    const multisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: zeroAddress,
      pause_status: false,
      amount: 0n,
      role: 0,
      salt: scalarLiteral(salt),
    };
    let { walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1);
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.update_wallet_id_role.rejected(
      zeroAddress,
      0,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.deployer),
    );

    multisigOp.op = MULTISIG_OP_UPDATE_ROLE;
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1));
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.update_role.rejected(
      zeroAddress,
      0,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.deployer),
    );

    multisigOp.op = MULTISIG_OP_MINT_PUBLIC;
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1));
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.mint_public_multisig.rejected(
      zeroAddress,
      0n,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.deployer),
    );

    multisigOp.op = MULTISIG_OP_BURN_PUBLIC;
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1));
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.burn_public_multisig.rejected(
      zeroAddress,
      0n,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.deployer),
    );

    multisigOp.op = MULTISIG_OP_SET_PAUSE_STATUS;
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1));
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.set_pause_status.rejected(
      false,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.deployer),
    );

    const privMultisigOp = {
      op: MULTISIG_OP_MINT_PRIVATE,
      amount: 1n,
      user: addressLiteral(fixture.account),
    };
    ({ walletSigningOpIdHash } = await initPrivateMultisigOp(fixture, randomWalletId, privMultisigOp, salt, 1));
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.mint_private_multisig.rejected(
      fixture.account,
      1n,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.deployer),
    );

    privMultisigOp.op = MULTISIG_OP_BURN_PRIVATE;
    ({ walletSigningOpIdHash } = await initPrivateMultisigOp(fixture, randomWalletId, privMultisigOp, salt, 1));
    await waitBlocks(fixture.ctx, 1);
    await fixture.token.burn_private_multisig.rejected(
      fixture.accountRecord!,
      1n,
      multisigCommonParams(randomWalletId, salt),
      asSigner(fixture.account),
    );
  });

  test("test old root support", async () => {
    const fixture = state!;

    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);

    const senderLeafIndices = getLeafIndices(tree, fixture.account.address);
    const emptyTreeSenderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];

    // The transaction failed because the root is mismatch
    await fixture.token.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      emptyTreeSenderMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.freezeRegistry.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField,
      emptyRootField,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );

    const newRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    let tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);

    await fixture.freezeRegistry.update_block_height_window.accepted(
      1,
      emptyMultisigCommonParams,
      asSigner(fixture.admin),
    );

    // The transaction failed because the old root is expired
    await fixture.token.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      emptyTreeSenderMerkleProof,
      asSigner(fixture.account),
    );
    await tx.outputs[1].decrypt(fixture.account);
  });
});
