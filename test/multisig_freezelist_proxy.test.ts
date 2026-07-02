import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";

import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_BLOCK_HEIGHT,
  MULTISIG_OP_UPDATE_BLOCK_WINDOW,
  MULTISIG_OP_UPDATE_FREEZE_LIST,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  emptyMultisigCommonParams,
  fundedAmount,
  zeroAddress,
  SETUP_TIMEOUT_MS,
} from "../lib/Constants.js";
import { waitBlocks } from "../lib/Block.js";
import { fundWithCredits } from "../lib/Fund.js";
import { asSigner, fieldLiteral, scalarLiteral } from "../lib/LiondenAdapters.js";
import { approveRequest, createWallet, initializeMultisig, multisigCommonParams, randomSalt } from "../lib/Multisig.js";
import { Leo } from "../typechain/BaseContract.js";
import { createMultisigCore } from "../typechain/MultisigCore.js";
import { createMultisigFreezelistProxy, type FreezeRegistryMultisigOp } from "../typechain/MultisigFreezelistProxy.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import { safeAddress } from "./utils/Accounts.js";

const managerWalletId = Leo.address(safeAddress());
const freezeListManagerWalletId = Leo.address(safeAddress());
const proxyProgramAddress = createMultisigFreezelistProxy().address();
const rootField = fieldLiteral(1n);

interface MultisigFreezelistProxyFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly freezeListManager: SignableNamedAccount;
  readonly signer1: SignableNamedAccount;
  readonly signer2: SignableNamedAccount;
  readonly multisig: ReturnType<typeof createMultisigCore>;
  readonly freezeRegistry: ReturnType<typeof createSealanceFreezelistRegistry>;
  readonly proxy: ReturnType<typeof createMultisigFreezelistProxy>;
  readonly managerWalletId: ReturnType<typeof Leo.address>;
  readonly freezeListManagerWalletId: ReturnType<typeof Leo.address>;
}

async function initMultisigOp(
  fixture: MultisigFreezelistProxyFixture,
  walletId: ReturnType<typeof Leo.address>,
  multisigOp: FreezeRegistryMultisigOp,
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

async function deployFixture() {
  const ctx = await setup();

  try {
    const deployer = ctx.named.signer("deployer");
    const admin = ctx.named.signer("admin");
    const frozenAccount = ctx.named.signer("frozenAccount");
    const freezeListManager = ctx.named.signer("freezeListManager");
    const signer1 = ctx.named.signer("signer1");
    const signer2 = ctx.named.signer("signer2");

    for (const signer of [admin, frozenAccount, freezeListManager, signer1, signer2]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const multisig = createMultisigCore().connect(ctx.lre);
    const freezeRegistry = createSealanceFreezelistRegistry().connect(ctx.lre);
    const proxy = createMultisigFreezelistProxy().connect(ctx.lre);

    for (const program of [
      "multisig_core",
      "merkle_tree",
      "sealance_freezelist_registry",
      "multisig_freezelist_proxy",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await initializeMultisig(multisig, deployer);

    const aleoSigners = [signer1, signer2, zeroAddress, zeroAddress] as const;
    await createWallet(multisig, deployer, managerWalletId, aleoSigners);
    await createWallet(multisig, deployer, freezeListManagerWalletId, aleoSigners);

    await freezeRegistry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, asSigner(deployer));
    await freezeRegistry.update_role.accepted(
      proxyProgramAddress,
      MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
      asSigner(admin),
    );

    return {
      ctx,
      deployer,
      admin,
      frozenAccount,
      freezeListManager,
      signer1,
      signer2,
      multisig,
      freezeRegistry,
      proxy,
      managerWalletId,
      freezeListManagerWalletId,
    } satisfies MultisigFreezelistProxyFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: MultisigFreezelistProxyFixture | undefined;

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

describe("test multisig_freezelist_proxy program", () => {
  test(`test initialize`, async () => {
    const fixture = state!;
    const isProxyInitialized = await fixture.proxy.mappings.initialized.contains(true);

    if (!isProxyInitialized) {
      const currentRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
      // Cannot update freeze list before initialization
      await fixture.proxy.update_freeze_list.rejected(
        fixture.frozenAccount,
        true,
        1,
        currentRoot,
        rootField,
        emptyMultisigCommonParams,
        asSigner(fixture.deployer),
      );

      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.proxy.initialize.rejected(fixture.managerWalletId, asSigner(fixture.deployer));
      }

      // The wallet ID manager has to be non zero
      await fixture.proxy.initialize.rejected(zeroAddress, asSigner(fixture.admin));

      await fixture.proxy.initialize.accepted(fixture.managerWalletId, asSigner(fixture.admin));
      const role = await fixture.proxy.mappings.walletIdToRole.get(fixture.managerWalletId);
      expect(role).toBe(MANAGER_ROLE);
    }

    // It is possible to call to initialize only one time
    await fixture.proxy.initialize.rejected(fixture.managerWalletId, asSigner(fixture.admin));
  });

  test(`test init_multi_sig`, async () => {
    const fixture = state!;

    let salt = randomSalt();
    let multisigOp: FreezeRegistryMultisigOp = {
      op: 0,
      user: zeroAddress,
      is_frozen: false,
      frozen_index: 0,
      previous_root: fieldLiteral(0n),
      new_root: fieldLiteral(0n),
      role: 0,
      blocks: 0,
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
    expect(pendingRequest?.is_frozen).toBe(false);
    expect(pendingRequest?.frozen_index).toBe(0);
    expect(pendingRequest?.previous_root).toBe(fieldLiteral(0n));
    expect(pendingRequest?.new_root).toBe(fieldLiteral(0n));
    expect(pendingRequest?.role).toBe(0);
    expect(pendingRequest?.blocks).toBe(0);
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
  });

  test(`test update_wallet_id_role`, async () => {
    const fixture = state!;
    const salt = randomSalt();
    const multisigOp: FreezeRegistryMultisigOp = {
      op: MULTISIG_OP_UPDATE_WALLET_ROLE,
      user: fixture.freezeListManagerWalletId,
      is_frozen: false,
      frozen_index: 0,
      previous_root: fieldLiteral(0n),
      new_root: fieldLiteral(0n),
      role: FREEZELIST_MANAGER_ROLE,
      blocks: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManagerWalletId,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_wallet_id_role.accepted(
      fixture.freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    const role = await fixture.proxy.mappings.walletIdToRole.get(fixture.freezeListManagerWalletId);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);

    // It's possible to execute the request only once
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.freezeListManagerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(
      fixture.ctx,
      [fixture.signer1, fixture.signer2],
      fixture.freezeListManagerWalletId,
      signingOpId,
    );

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_wallet_id_role.rejected(
      fixture.freezeListManagerWalletId,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test(`test update_role`, async () => {
    const fixture = state!;
    const salt = randomSalt();
    const multisigOp: FreezeRegistryMultisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: Leo.address(fixture.admin.address),
      is_frozen: false,
      frozen_index: 0,
      previous_root: fieldLiteral(0n),
      new_root: fieldLiteral(0n),
      role: MANAGER_ROLE,
      blocks: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT);

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.admin,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.admin,
      MANAGER_ROLE,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.admin,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.deployer,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.admin,
      FREEZELIST_MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_role.accepted(
      fixture.admin,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
    const role = await fixture.freezeRegistry.mappings.addressToRole.get(fixture.admin);
    expect(role).toBe(MANAGER_ROLE);

    // It's possible to execute the request only once
    await fixture.proxy.update_role.rejected(
      fixture.admin,
      MANAGER_ROLE,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.freezeListManagerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(
      fixture.ctx,
      [fixture.signer1, fixture.signer2],
      fixture.freezeListManagerWalletId,
      signingOpId,
    );

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_role.rejected(
      fixture.admin,
      MANAGER_ROLE,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test(`test update_freeze_list`, async () => {
    const fixture = state!;
    const currentRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const lastIndex = await fixture.freezeRegistry.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);
    const randomAddress = safeAddress();

    const salt = randomSalt();
    let multisigOp: FreezeRegistryMultisigOp = {
      op: MULTISIG_OP_UPDATE_FREEZE_LIST,
      user: Leo.address(randomAddress),
      is_frozen: true,
      frozen_index: (lastIndex ?? 0) + 1,
      previous_root: currentRoot!,
      new_root: rootField,
      role: 0,
      blocks: 0,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(
      fixture,
      fixture.freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(
      fixture.ctx,
      [fixture.signer1, fixture.signer2],
      fixture.freezeListManagerWalletId,
      signingOpId,
    );
    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(safeAddress()),
      true,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
    // If the is_frozen doesn't match the is_frozen in the request the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      false,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
    // If the frozen_index doesn't match the frozen_index in the request the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index - 1,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
    // If the previous_root doesn't match the previous_root in the request the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      fieldLiteral(0n),
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
    // If the new_root doesn't match the new_root in the request the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      rootField,
      fieldLiteral(0n),
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_freeze_list.accepted(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
    const isFrozen = await fixture.freezeRegistry.mappings.freezeList.get(Leo.address(randomAddress));
    expect(isFrozen).toBe(true);

    // It's possible to execute the request only once
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      true,
      multisigOp.frozen_index,
      currentRoot!,
      rootField,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    multisigOp = {
      ...multisigOp,
      is_frozen: false,
      previous_root: rootField,
    };
    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_freeze_list.rejected(
      Leo.address(randomAddress),
      false,
      3,
      rootField,
      rootField,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });

  test(`test update_block_height_window`, async () => {
    const fixture = state!;
    const salt = randomSalt();
    const multisigOp: FreezeRegistryMultisigOp = {
      op: MULTISIG_OP_UPDATE_BLOCK_WINDOW,
      user: zeroAddress,
      is_frozen: false,
      frozen_index: 0,
      previous_root: fieldLiteral(0n),
      new_root: fieldLiteral(0n),
      role: 0,
      blocks: BLOCK_HEIGHT_WINDOW,
      salt: scalarLiteral(salt),
    };

    let { signingOpId } = await initMultisigOp(
      fixture,
      fixture.freezeListManagerWalletId,
      multisigOp,
      MAX_BLOCK_HEIGHT,
    );

    // If the request wasn't approved yet the transaction will fail
    await fixture.proxy.update_block_height_window.rejected(
      BLOCK_HEIGHT_WINDOW,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await approveRequest(
      fixture.ctx,
      [fixture.signer1, fixture.signer2],
      fixture.freezeListManagerWalletId,
      signingOpId,
    );

    // If the wallet_id is incorrect the transaction will fail
    await fixture.proxy.update_block_height_window.rejected(
      BLOCK_HEIGHT_WINDOW,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.proxy.update_block_height_window.rejected(
      BLOCK_HEIGHT_WINDOW,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt + 1n),
      asSigner(fixture.deployer),
    );

    // If the block height window doesn't match the block height window in the request the transaction will fail
    await fixture.proxy.update_block_height_window.rejected(
      0,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    await fixture.proxy.update_block_height_window.accepted(
      BLOCK_HEIGHT_WINDOW,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );
    const blockHeightWindow = await fixture.freezeRegistry.mappings.blockHeightWindow.get(BLOCK_HEIGHT_WINDOW_INDEX);
    expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

    // It's possible to execute the request only once
    await fixture.proxy.update_block_height_window.rejected(
      BLOCK_HEIGHT_WINDOW,
      multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.proxy.update_block_height_window.rejected(
      BLOCK_HEIGHT_WINDOW,
      multisigCommonParams(fixture.managerWalletId, salt),
      asSigner(fixture.deployer),
    );
  });
});
