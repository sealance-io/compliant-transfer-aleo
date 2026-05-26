import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { Address } from "@provablehq/sdk";
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
const proxyProgramAddress = Address.fromProgramId("multisig_token_proxy.aleo").to_string();

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
    {
      wallet_id: walletId,
      multisig_op: multisigOp,
      block_expiration: blockExpiration,
    },
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
    {
      wallet_id: walletId,
      multisig_op: multisigOp,
      salt: scalarLiteral(salt),
      block_expiration: blockExpiration,
    },
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

    await token.initialize.accepted(
      {
        name: tokenName,
        symbol: tokenSymbol,
        decimals,
        max_supply: maxSupply,
        admin,
      },
      asSigner(deployer),
    );
    await token.update_role.accepted(
      {
        new_address: proxyProgramAddress,
        role: MANAGER_ROLE + MINTER_ROLE + BURNER_ROLE + PAUSE_ROLE,
      },
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
      await fixture.proxy.initialize.rejected(
        {
          manager_wallet_id: fixture.managerWalletId,
        },
        asSigner(fixture.deployer),
      );
    }

    // The admin or the wallet ID manager has to be non zero
    await fixture.proxy.initialize.rejected(
      {
        manager_wallet_id: zeroAddress,
      },
      asSigner(fixture.admin),
    );

    await fixture.proxy.initialize.accepted(
      {
        manager_wallet_id: fixture.managerWalletId,
      },
      asSigner(fixture.admin),
    );
    const role = await fixture.proxy.getWallet_id_to_role(fixture.managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // It is possible to call to initialize only one time
    await fixture.proxy.initialize.rejected(
      {
        manager_wallet_id: fixture.managerWalletId,
      },
      asSigner(fixture.admin),
    );
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
    let pendingRequest = await fixture.proxy.getPending_requests(walletSigningOpIdHash);
    expect(pendingRequest?.op).toBe(0);
    expect(pendingRequest?.user).toBe(zeroAddress);
    expect(pendingRequest?.pause_status).toBe(false);
    expect(pendingRequest?.role).toBe(0);
    expect(pendingRequest?.amount).toBe(0n);
    expect(pendingRequest?.salt).toBe(scalarLiteral(salt));

    // It's impossible to initiate a request twice
    await fixture.proxy.init_multisig_op.rejected(
      {
        wallet_id: fixture.managerWalletId,
        multisig_op: multisigOp,
        block_expiration: MAX_BLOCK_HEIGHT,
      },
      asSigner(fixture.deployer),
    );

    salt = randomSalt();
    multisigOp = {
      ...multisigOp,
      salt: scalarLiteral(salt),
    };
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, 1));
    pendingRequest = await fixture.proxy.getPending_requests(walletSigningOpIdHash);
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
    let privatePendingRequest = await fixture.proxy.getPrivate_pending_requests(walletSigningOpIdHash);
    expect(privatePendingRequest).toBe(true);

    // It's impossible to initiate a request twice
    await fixture.proxy.init_private_multisig_op.rejected(
      {
        wallet_id: fixture.managerWalletId,
        multisig_op: privMultisigOp,
        salt: scalarLiteral(salt),
        block_expiration: MAX_BLOCK_HEIGHT,
      },
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
    privatePendingRequest = await fixture.proxy.getPrivate_pending_requests(walletSigningOpIdHash);
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
      {
        target_wallet_id: fixture.pauseWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.pauseWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.pauseWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.minterWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.pauseWalletId,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_wallet_id_role.accepted(
      {
        target_wallet_id: fixture.pauseWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    let role = await fixture.proxy.getWallet_id_to_role(fixture.pauseWalletId);
    expect(role).toBe(PAUSE_ROLE);

    // It's possible to execute the request only once
    await fixture.proxy.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.pauseWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.pauseWalletId,
        role: PAUSE_ROLE,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
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
      {
        target_wallet_id: fixture.minterWalletId,
        role: MINTER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    role = await fixture.proxy.getWallet_id_to_role(fixture.minterWalletId);
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
      {
        target_wallet_id: fixture.burnerWalletId,
        role: BURNER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    role = await fixture.proxy.getWallet_id_to_role(fixture.burnerWalletId);
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
      {
        new_address: randomAddress,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_role.rejected(
      {
        new_address: randomAddress,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_role.rejected(
      {
        new_address: randomAddress,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_role.rejected(
      {
        new_address: fixture.deployer,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.proxy.update_role.rejected(
      {
        new_address: randomAddress,
        role: randomRole + 1,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_role.accepted(
      {
        new_address: randomAddress,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    const role = await fixture.token.getAddress_to_role(randomAddress);
    expect(role).toBe(randomRole);

    // It's possible to execute the request only once
    await fixture.proxy.update_role.rejected(
      {
        new_address: randomAddress,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.pauseWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_role.rejected(
      {
        new_address: randomAddress,
        role: randomRole,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
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
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.mint_private.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.mint_private.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.mint_private.rejected(
      {
        recipient: fixture.deployer,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.mint_private.rejected(
      {
        recipient: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    let tx = await fixture.proxy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    fixture.accountRecord = await tx.outputs[1]
      .match(CompliantTokenTemplateTokenOutput.output.from("mint_private", 1))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(amount * 20n);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    // It's possible to execute the request only once
    await fixture.proxy.mint_private.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
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
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
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
      {
        recipient: fixture.frozenAccount,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
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
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.minterWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.mint_public.rejected(
      {
        recipient: fixture.deployer,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount + 1n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    const initialBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;

    await fixture.proxy.mint_public.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    const balance = await fixture.token.getBalances(fixture.account);
    expect(balance).toBe(initialBalance + amount * 20n);

    // It's possible to execute the request only once
    await fixture.proxy.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.minterWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
  });

  test(`test burn_public`, async () => {
    const fixture = state!;

    const previousAccountPublicBalance = await fixture.token.getBalances(fixture.account);
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
      {
        owner: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.burnerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.burn_public.rejected(
      {
        owner: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.burn_public.rejected(
      {
        owner: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.burn_public.rejected(
      {
        owner: fixture.frozenAccount,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.burn_public.rejected(
      {
        owner: fixture.account,
        amount: amount + 1n,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.proxy.burn_public.accepted(
      {
        owner: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    const balance = await fixture.token.getBalances(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance! - amount);

    // It's possible to execute the request only once
    await fixture.proxy.burn_public.rejected(
      {
        owner: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.burn_public.rejected(
      {
        owner: fixture.account,
        amount,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
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
      {
        input_record: fixture.accountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.account),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.burnerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.burn_private.rejected(
      {
        input_record: fixture.accountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.account),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.burn_private.rejected(
      {
        input_record: fixture.accountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt + 1n),
      },
      asSigner(fixture.account),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.burn_private.rejected(
      {
        input_record: fixture.frozenAccountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.frozenAccount),
    );

    // If the amount doesn't match the amount in the request the transaction will fail
    await fixture.proxy.burn_private.rejected(
      {
        input_record: fixture.accountRecord!,
        amount: amount - 1n,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.account),
    );

    const accountRecordBalanceBefore = fixture.accountRecord!.amount;
    const burnTx = await fixture.proxy.burn_private.accepted(
      {
        input_record: fixture.accountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
      asSigner(fixture.account),
    );

    fixture.accountRecord = await burnTx.outputs[1]
      .match(CompliantTokenTemplateTokenOutput.output.from("burn_private", 1))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(accountRecordBalanceBefore - amount);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    // It's possible to execute the request only once
    await fixture.proxy.burn_private.rejected(
      {
        input_record: fixture.accountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.burnerWalletId, salt),
      },
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
      {
        input_record: fixture.accountRecord!,
        amount,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
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
      {
        pause_status: true,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.pauseWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      {
        pause_status: true,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      {
        pause_status: true,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the pause status doesn't match the pause status in the request the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      {
        pause_status: false,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.proxy.set_pause_status.accepted(
      {
        pause_status: true,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    let pauseStatus = await fixture.token.getPause(true);
    expect(pauseStatus).toBe(true);

    // It's possible to execute the request only once
    await fixture.proxy.set_pause_status.rejected(
      {
        pause_status: true,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.set_pause_status.rejected(
      {
        pause_status: true,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
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
      {
        pause_status: false,
        multisig_common_params: multisigCommonParams(fixture.pauseWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    pauseStatus = await fixture.token.getPause(true);
    expect(pauseStatus).toBe(false);
  });
});
