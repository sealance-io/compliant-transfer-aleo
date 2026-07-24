import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { stringToBigInt } from "@sealance-io/policy-engine-aleo";

import {
  BURNER_ROLE,
  MANAGER_ROLE,
  MAX_BLOCK_HEIGHT,
  MINTER_ROLE,
  MULTISIG_OP_BURN_PRIVATE,
  MULTISIG_OP_BURN_PUBLIC,
  MULTISIG_OP_MINT_PRIVATE,
  MULTISIG_OP_MINT_PUBLIC,
  MULTISIG_OP_SET_PAUSE_STATUS,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  PAUSE_ROLE,
  SETUP_TIMEOUT_MS,
  fundedAmount,
  maxSupply,
  decimals,
  zeroAddress,
  amount,
} from "../lib/Constants.js";
import { waitBlocks } from "../lib/Block.js";
import { fundWithCredits } from "../lib/Fund.js";
import { addressLiteral, asSigner, scalarLiteral } from "../lib/LiondenAdapters.js";
import { approveRequest, createWallet, initializeMultisig, multisigCommonParams, randomSalt } from "../lib/Multisig.js";
import { Leo } from "../typechain/BaseContract.js";
import { createCompliantTokenTemplate } from "../typechain/CompliantTokenTemplate.js";
import { createMultisigCore } from "../typechain/MultisigCore.js";
import {
  createMultisigTokenProxy,
  type CompliantTokenMultisigOp,
  CompliantTokenTemplate_Token as CompliantTokenTemplateTokenOutput,
  type CompliantTokenTemplate_Token,
  type PrivateCompliantTokenMultisigOp,
} from "../typechain/MultisigTokenProxy.js";
import { safeAddress } from "./utils/Accounts.js";

const tokenName = stringToBigInt("Stable Token");
const tokenSymbol = stringToBigInt("STABLE_TOKEN");

const managerWalletId = Leo.address(safeAddress());
const pauseWalletId = Leo.address(safeAddress());
const minterWalletId = Leo.address(safeAddress());
const burnerWalletId = Leo.address(safeAddress());
const proxyProgramAddress = createMultisigTokenProxy().address();

interface MultisigTokenProxyFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly signer1: SignableNamedAccount;
  readonly signer2: SignableNamedAccount;
  readonly multisig: ReturnType<typeof createMultisigCore>;
  readonly token: ReturnType<typeof createCompliantTokenTemplate>;
  readonly proxy: ReturnType<typeof createMultisigTokenProxy>;
  readonly managerWalletId: ReturnType<typeof Leo.address>;
  readonly pauseWalletId: ReturnType<typeof Leo.address>;
  readonly minterWalletId: ReturnType<typeof Leo.address>;
  readonly burnerWalletId: ReturnType<typeof Leo.address>;
  accountRecord?: CompliantTokenTemplate_Token;
  frozenAccountRecord?: CompliantTokenTemplate_Token;
}

async function initMultisigOp(
  fixture: MultisigTokenProxyFixture,
  walletId: ReturnType<typeof Leo.address>,
  multisigOp: CompliantTokenMultisigOp,
  blockExpiration: number,
) {
  const tx = await fixture.proxy.init_multisig_op.accepted(
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
  fixture: MultisigTokenProxyFixture,
  walletId: ReturnType<typeof Leo.address>,
  multisigOp: PrivateCompliantTokenMultisigOp,
  salt: bigint,
  blockExpiration: number,
) {
  const tx = await fixture.proxy.init_private_multisig_op.accepted(
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
    const frozenAccount = ctx.named.signer("frozenAccount");
    const account = ctx.named.signer("account");
    const signer1 = ctx.named.signer("signer1");
    const signer2 = ctx.named.signer("signer2");

    for (const signer of [admin, frozenAccount, account, signer1, signer2]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const multisig = createMultisigCore().connect(ctx.lre);
    const token = createCompliantTokenTemplate().connect(ctx.lre);
    const proxy = createMultisigTokenProxy().connect(ctx.lre);

    for (const program of [
      "multisig_core",
      "merkle_tree",
      "sealance_freezelist_registry",
      "compliant_token_template",
      "multisig_token_proxy",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await initializeMultisig(multisig, deployer);

    const aleoSigners = [signer1, signer2, zeroAddress, zeroAddress] as const;
    await createWallet(multisig, deployer, managerWalletId, aleoSigners);
    await createWallet(multisig, deployer, pauseWalletId, aleoSigners);
    await createWallet(multisig, deployer, minterWalletId, aleoSigners);
    await createWallet(multisig, deployer, burnerWalletId, aleoSigners);

    await token.initialize.accepted(tokenName, tokenSymbol, decimals, maxSupply, admin, asSigner(deployer));
    await token.update_role.accepted(
      proxyProgramAddress,
      MANAGER_ROLE + MINTER_ROLE + BURNER_ROLE + PAUSE_ROLE,
      asSigner(admin),
    );

    return {
      ctx,
      deployer,
      admin,
      frozenAccount,
      account,
      signer1,
      signer2,
      multisig,
      token,
      proxy,
      managerWalletId,
      pauseWalletId,
      minterWalletId,
      burnerWalletId,
    } satisfies MultisigTokenProxyFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: MultisigTokenProxyFixture | undefined;

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

describe("test multisig token proxy program", () => {
  test(`test initialize`, async () => {
    const fixture = state!;

    if (fixture.deployer.address !== fixture.admin.address) {
      // The caller is not the initial admin
      await fixture.proxy.initialize.rejected(fixture.managerWalletId, asSigner(fixture.deployer));
    }

    // The admin or the wallet ID manager has to be non zero
    await fixture.proxy.initialize.rejected(zeroAddress, asSigner(fixture.admin));

    await fixture.proxy.initialize.accepted(fixture.managerWalletId, asSigner(fixture.admin));
    const role = await fixture.proxy.mappings.walletIdToRole.get(fixture.managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // It is possible to call to initialize only one time
    await fixture.proxy.initialize.rejected(fixture.managerWalletId, asSigner(fixture.admin));
  });

  test(`test init_multisig_op`, async () => {
    const fixture = state!;

    let salt = randomSalt();
    let multisigOp: CompliantTokenMultisigOp = {
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
    let pendingRequest = await fixture.proxy.mappings.pendingRequests.get(walletSigningOpIdHash);
    expect(pendingRequest?.op).toBe(0);
    expect(pendingRequest?.user).toBe(zeroAddress);
    expect(pendingRequest?.pause_status).toBe(false);
    expect(pendingRequest?.role).toBe(0);
    expect(pendingRequest?.amount).toBe(0n);
    expect(pendingRequest?.salt).toBe(scalarLiteral(salt));

    // It's impossible to initiate a request twice
    await fixture.proxy.init_multisig_op.rejected(
      fixture.managerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    multisigOp = {
      ...multisigOp,
      salt: scalarLiteral(salt),
    };
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, 1));
    pendingRequest = await fixture.proxy.mappings.pendingRequests.get(walletSigningOpIdHash);
    expect(pendingRequest?.salt).toBe(scalarLiteral(salt));
    await waitBlocks(fixture.ctx, 1);
    // It's possible to initiate this request twice because the previous expired
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    expect(walletSigningOpIdHash).toBeDefined();
  });

  test(`test init_private_multisig_op`, async () => {
    const fixture = state!;

    let salt = randomSalt();
    const privMultisigOp: PrivateCompliantTokenMultisigOp = {
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
    let privatePendingRequest = await fixture.proxy.mappings.privatePendingRequests.get(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);

    // It's impossible to initiate a request twice
    await fixture.proxy.init_private_multisig_op.rejected(
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
    privatePendingRequest = await fixture.proxy.mappings.privatePendingRequests.get(walletSigningOpIdHash);
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

  test(`test update_wallet_id_role`, async () => {
    const fixture = state!;

    let salt = randomSalt();
    let multisigOp: CompliantTokenMultisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: fixture.pauseWalletId,
      pause_status: false,
      amount: 0n,
      role: PAUSE_ROLE,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.minterWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_wallet_id_role.accepted(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    let role = await fixture.proxy.mappings.walletIdToRole.get(fixture.pauseWalletId);
    expect(role).toBe(PAUSE_ROLE);

    // It's possible to execute the request only once
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.pauseWalletId,
      PAUSE_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
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
    await fixture.proxy.update_wallet_id_role.accepted(
      fixture.minterWalletId,
      MINTER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    role = await fixture.proxy.mappings.walletIdToRole.get(fixture.minterWalletId);
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
    await fixture.proxy.update_wallet_id_role.accepted(
      fixture.burnerWalletId,
      BURNER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    role = await fixture.proxy.mappings.walletIdToRole.get(fixture.burnerWalletId);
    expect(role).toBe(BURNER_ROLE);
  });

  test(`test update_role`, async () => {
    const fixture = state!;

    const randomAddress = addressLiteral(safeAddress());
    const randomRole = [MANAGER_ROLE, BURNER_ROLE, MINTER_ROLE, PAUSE_ROLE, MINTER_ROLE + BURNER_ROLE][
      Math.floor(Math.random() * 5)
    ]!;

    const salt = randomSalt();
    const multisigOp: CompliantTokenMultisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: randomAddress,
      pause_status: false,
      amount: 0n,
      role: randomRole,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.deployer,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.proxy.update_role.rejected(
      randomAddress,
      randomRole + 1,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_role.accepted(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    const role = await fixture.token.mappings.addressToRole.get(randomAddress);
    expect(role).toBe(randomRole);

    // It's possible to execute the request only once
    await fixture.proxy.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_role.rejected(
      randomAddress,
      randomRole,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test(`test mint_private`, async () => {
    const fixture = state!;

    const accountAddress = addressLiteral(fixture.account.address);
    const frozenAccountAddress = addressLiteral(fixture.frozenAccount.address);
    const salt = randomSalt();
    let privMultisigOp: PrivateCompliantTokenMultisigOp = {
      op: MULTISIG_OP_MINT_PRIVATE,
      user: accountAddress,
      amount: amount * 20n,
    };

    let { signingOpId } = await initPrivateMultisigOp(
      fixture,
      fixture.minterWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    );

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.mint_private.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.mint_private.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.mint_private.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.mint_private.rejected(
      fixture.deployer,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.mint_private.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    let tx = await fixture.proxy.mint_private.accepted(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );
    fixture.accountRecord = await tx.outputs[1]
      .match(CompliantTokenTemplateTokenOutput.output.from("mint_private", 1))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(amount * 20n);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    // It's possible to execute the request only once
    await fixture.proxy.mint_private.rejected(
      fixture.account,
      amount * 20n,
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
    await fixture.proxy.mint_private.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    privMultisigOp = {
      ...privMultisigOp,
      user: frozenAccountAddress,
    };
    ({ signingOpId } = await initPrivateMultisigOp(
      fixture,
      fixture.minterWalletId,
      privMultisigOp,
      salt,
      MAX_BLOCK_HEIGHT,
    ));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);
    tx = await fixture.proxy.mint_private.accepted(
      fixture.frozenAccount,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );
    fixture.frozenAccountRecord = await tx.outputs[1]
      .match(CompliantTokenTemplateTokenOutput.output.from("mint_private", 1))
      .decrypt(fixture.frozenAccount);
    expect(fixture.frozenAccountRecord.amount).toBe(amount * 20n);
    expect(fixture.frozenAccountRecord.owner).toBe(fixture.frozenAccount.address);
  });

  test(`test mint_public`, async () => {
    const fixture = state!;

    const salt = randomSalt();
    const multisigOp: CompliantTokenMultisigOp = {
      op: MULTISIG_OP_MINT_PUBLIC,
      user: addressLiteral(fixture.account.address),
      pause_status: false,
      amount: amount * 20n,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.minterWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.mint_public.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.mint_public.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.mint_public.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.mint_public.rejected(
      fixture.deployer,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.mint_public.rejected(
      fixture.account,
      amount + 1n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    const initialBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    await fixture.proxy.mint_public.accepted(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );
    const balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(initialBalance + amount * 20n);

    // It's possible to execute the request only once
    await fixture.proxy.mint_public.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.minterWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.mint_public.rejected(
      fixture.account,
      amount * 20n,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test(`test burn_public`, async () => {
    const fixture = state!;

    const previousAccountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const salt = randomSalt();
    const multisigOp: CompliantTokenMultisigOp = {
      op: MULTISIG_OP_BURN_PUBLIC,
      user: addressLiteral(fixture.account.address),
      pause_status: false,
      amount: amount,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.burnerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.burn_public.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.burnerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.burn_public.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.burn_public.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.burn_public.rejected(
      fixture.frozenAccount,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.burn_public.rejected(
      fixture.account,
      amount + 1n,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.burn_public.accepted(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );
    const balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance! - amount);

    // It's possible to execute the request only once
    await fixture.proxy.burn_public.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.burn_public.rejected(
      fixture.account,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test(`test burn_private`, async () => {
    const fixture = state!;

    const salt = randomSalt();
    const privMultisigOp: PrivateCompliantTokenMultisigOp = {
      op: MULTISIG_OP_BURN_PRIVATE,
      user: addressLiteral(fixture.account.address),
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
    await fixture.proxy.burn_private.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.burnerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.burn_private.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.account),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.burn_private.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt + 1n),
      asSigner(fixture.account),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.burn_private.rejected(
      fixture.frozenAccountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.frozenAccount),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.burn_private.rejected(
      fixture.accountRecord!,
      amount - 1n,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );

    const accountRecordBalanceBefore = fixture.accountRecord!.amount;
    const burnTx = await fixture.proxy.burn_private.accepted(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.burnerWalletId, salt),
      asSigner(fixture.account),
    );

    fixture.accountRecord = await burnTx.outputs[1]
      .match(CompliantTokenTemplateTokenOutput.output.from("burn_private", 1))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(accountRecordBalanceBefore - amount);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    // It's possible to execute the request only once
    await fixture.proxy.burn_private.rejected(
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
    await fixture.proxy.burn_private.rejected(
      fixture.accountRecord!,
      amount,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.account),
    );
  });

  test(`test pausing the contract`, async () => {
    const fixture = state!;

    let salt = randomSalt();
    let multisigOp: CompliantTokenMultisigOp = {
      op: MULTISIG_OP_SET_PAUSE_STATUS,
      user: zeroAddress,
      pause_status: true,
      amount: 0n,
      role: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the pause status doesn't match the pause status in the request the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      false,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.set_pause_status.accepted(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );
    let pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(true);

    // It's possible to execute the request only once
    await fixture.proxy.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      true,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    multisigOp = {
      ...multisigOp,
      pause_status: false,
      salt: scalarLiteral(salt),
    };

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    await fixture.proxy.set_pause_status.accepted(
      false,
      multisigCommonParams(fixture.pauseWalletId, salt),
      asSigner(fixture.deployer),
    );
    pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(false);
  });
});
