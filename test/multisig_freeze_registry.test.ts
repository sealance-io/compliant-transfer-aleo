import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "@sealance-io/policy-engine-aleo";
import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_BLOCK_HEIGHT,
  MAX_TREE_DEPTH,
  MULTISIG_OP_UPDATE_BLOCK_WINDOW,
  MULTISIG_OP_UPDATE_FREEZE_LIST,
  MULTISIG_OP_UPDATE_ROLE,
  MULTISIG_OP_UPDATE_WALLET_ROLE,
  NONE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  emptyMultisigCommonParams,
  emptyRoot,
  fundedAmount,
  zeroAddress,
  emptyRootField,
  SETUP_TIMEOUT_MS,
} from "../lib/Constants.js";
import { waitBlocks } from "../lib/Block.js";
import { fundWithCredits } from "../lib/Fund.js";
import { asSigner, fieldLiteral, scalarLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { approveRequest, createWallet, initializeMultisig, multisigCommonParams, randomSalt } from "../lib/Multisig.js";
import { Leo } from "../typechain/BaseContract.js";
import { createMultisigCore } from "../typechain/MultisigCore.js";
import {
  createMultisigFreezelistRegistry,
  type FreezeRegistryMultisigOp,
} from "../typechain/MultisigFreezelistRegistry.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";
import { safeAddress } from "./utils/Accounts.js";

const managerWalletId = Leo.address(safeAddress());
const freezeListManagerWalletId = Leo.address(safeAddress());

interface MultisigFreezeRegistryFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly freezeListManager: SignableNamedAccount;
  readonly signer1: SignableNamedAccount;
  readonly signer2: SignableNamedAccount;
  readonly freezeRegistry: ReturnType<typeof createMultisigFreezelistRegistry>;
  readonly multisig: ReturnType<typeof createMultisigCore>;
  readonly managerWalletId: ReturnType<typeof Leo.address>;
  readonly freezeListManagerWalletId: ReturnType<typeof Leo.address>;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly adminMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
}

async function initMultisigOp(
  fixture: MultisigFreezeRegistryFixture,
  walletId: ReturnType<typeof Leo.address>,
  multisigOp: FreezeRegistryMultisigOp,
  blockExpiration: number,
) {
  const tx = await fixture.freezeRegistry.init_multisig_op.accepted(
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

    const freezeRegistry = createMultisigFreezelistRegistry().connect(ctx.lre);
    const multisig = createMultisigCore().connect(ctx.lre);

    for (const program of ["multisig_core", "merkle_tree", "multisig_freezelist_registry"]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await initializeMultisig(multisig, deployer);

    const aleoSigners = [signer1, signer2, zeroAddress, zeroAddress] as const;
    await createWallet(multisig, deployer, managerWalletId, aleoSigners);
    await createWallet(multisig, deployer, freezeListManagerWalletId, aleoSigners);

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;
    const rootField = fieldLiteral(root);

    const adminLeafIndices = getLeafIndices(tree, admin.address);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount.address);
    const adminMerkleProof = [
      toMerkleProof(getSiblingPath(tree, adminLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, adminLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    const frozenAccountMerkleProof = [
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH)),
    ];

    return {
      ctx,
      deployer,
      admin,
      frozenAccount,
      freezeListManager,
      signer1,
      signer2,
      freezeRegistry,
      multisig,
      managerWalletId,
      freezeListManagerWalletId,
      rootField,
      adminMerkleProof,
      frozenAccountMerkleProof,
    } satisfies MultisigFreezeRegistryFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: MultisigFreezeRegistryFixture | undefined;

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

describe("test multisig freeze registry program", () => {
  test("test initialize", async () => {
    const fixture = state!;
    const isFreezeRegistryInitialized =
      (await fixture.freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) !== null;

    if (!isFreezeRegistryInitialized) {
      const currentRoot =
        (await fixture.freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) || emptyRootField;
      // Cannot update freeze list before initialization
      await fixture.freezeRegistry.update_freeze_list.rejected(
        {
          account: fixture.frozenAccount,
          is_frozen: true,
          frozen_index: 1,
          previous_root: currentRoot,
          new_root: fixture.rootField!,
          multisig_common_params: emptyMultisigCommonParams,
        },
        asSigner(fixture.admin),
      );

      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.freezeRegistry.initialize.rejected(
          {
            admin: fixture.admin,
            blocks: BLOCK_HEIGHT_WINDOW,
            manager_wallet_id: zeroAddress,
          },
          asSigner(fixture.deployer),
        );
      }

      // The admin or the wallet ID manager has to be non zero
      await fixture.freezeRegistry.initialize.rejected(
        {
          admin: zeroAddress,
          blocks: BLOCK_HEIGHT_WINDOW,
          manager_wallet_id: zeroAddress,
        },
        asSigner(fixture.admin),
      );

      await fixture.freezeRegistry.initialize.accepted(
        {
          admin: fixture.admin,
          blocks: BLOCK_HEIGHT_WINDOW,
          manager_wallet_id: fixture.managerWalletId,
        },
        asSigner(fixture.admin),
      );
      const isAccountFrozen = await fixture.freezeRegistry.getFreeze_list(zeroAddress);
      const frozenAccountByIndex = await fixture.freezeRegistry.getFreeze_list_index(0);
      const lastIndex = await fixture.freezeRegistry.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await fixture.freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await fixture.freezeRegistry.getBlock_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await fixture.freezeRegistry.getAddress_to_role(fixture.admin);
      const walletIdRole = await fixture.freezeRegistry.getWallet_id_to_role(fixture.managerWalletId);

      expect(role).toBe(MANAGER_ROLE);
      expect(walletIdRole).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(zeroAddress);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRootField);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
    }

    // It is possible to call to initialize only one time
    await fixture.freezeRegistry.initialize.rejected(
      {
        admin: fixture.admin,
        blocks: BLOCK_HEIGHT_WINDOW,
        manager_wallet_id: fixture.managerWalletId,
      },
      asSigner(fixture.admin),
    );
  });

  test("test init_multi_sig", async () => {
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
    let pendingRequest = await fixture.freezeRegistry.getPending_requests(walletSigningOpIdHash);
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
    await fixture.freezeRegistry.init_multisig_op.rejected(
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
    pendingRequest = await fixture.freezeRegistry.getPending_requests(walletSigningOpIdHash);
    expect(pendingRequest?.salt).toBe(scalarLiteral(salt));
    await waitBlocks(fixture.ctx, 1);
    // It's possible to initiate this request twice because the previous expired
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    expect(walletSigningOpIdHash).toBeDefined();
  });

  test("test update_wallet_id_role", async () => {
    const fixture = state!;

    // Non manager address can't update the wallet_id without multisig approval
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.managerWalletId,
        role: MULTISIG_OP_UPDATE_WALLET_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.frozenAccount),
    );

    await fixture.freezeRegistry.update_wallet_id_role.accepted(
      {
        target_wallet_id: fixture.managerWalletId,
        role: MANAGER_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.admin),
    );
    let role = await fixture.freezeRegistry.getWallet_id_to_role(fixture.managerWalletId);
    expect(role).toBe(MANAGER_ROLE);

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.managerWalletId,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, 0n),
      },
      asSigner(fixture.admin),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.managerWalletId,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(zeroAddress, 1n),
      },
      asSigner(fixture.admin),
    );

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
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id is incorrect the transaction will fail
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManager,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_wallet_id_role.accepted(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    role = await fixture.freezeRegistry.getWallet_id_to_role(fixture.freezeListManagerWalletId);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);

    // It's possible to execute the request only once
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
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
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: fixture.freezeListManagerWalletId,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
  });

  test("test multisig support in update_role", async () => {
    const fixture = state!;

    // Even though the caller is a manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, 0n),
      },
      asSigner(fixture.admin),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(zeroAddress, 1n),
      },
      asSigner(fixture.admin),
    );

    const salt = randomSalt();
    const multisigOp: FreezeRegistryMultisigOp = {
      op: MULTISIG_OP_UPDATE_ROLE,
      user: Leo.address(fixture.admin),
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
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);
    // If the wallet_id is incorrect the transaction will fail
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.deployer,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the role doesn't match the role in the request the transaction will fail
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_role.accepted(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    const role = await fixture.freezeRegistry.getAddress_to_role(fixture.admin);
    expect(role).toBe(MANAGER_ROLE);

    // It's possible to execute the request only once
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
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
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: MANAGER_ROLE,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
  });

  test("test update_manager_address", async () => {
    const fixture = state!;

    // Manager cannot unassign himself from being a manager
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.admin,
        role: NONE_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.admin),
    );

    await fixture.freezeRegistry.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.admin),
    );
    let role = await fixture.freezeRegistry.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    await fixture.freezeRegistry.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: NONE_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.freezeRegistry.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Only the manager can update the roles
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.frozenAccount),
    );
  });

  test("test update_freeze_list_manager", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.update_role.accepted(
      {
        new_address: fixture.freezeListManager,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.admin),
    );
    const freezeListManagerRole = await fixture.freezeRegistry.getAddress_to_role(fixture.freezeListManager);
    expect(freezeListManagerRole).toBe(FREEZELIST_MANAGER_ROLE);

    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: fixture.frozenAccount,
        role: FREEZELIST_MANAGER_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.frozenAccount),
    );
  });

  test("test update_freeze_list", async () => {
    const fixture = state!;
    const currentRoot = await fixture.freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the manager can call to update_freeze_list
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: fixture.admin,
        is_frozen: true,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.frozenAccount),
    );

    // Cannot update the root if the previous root is incorrect
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fieldLiteral(0n),
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    let isAccountFrozen = (await fixture.freezeRegistry.getFreeze_list(fixture.frozenAccount)) ?? false;
    if (!isAccountFrozen) {
      // Cannot unfreeze an unfrozen account
      await fixture.freezeRegistry.update_freeze_list.rejected(
        {
          account: fixture.frozenAccount,
          is_frozen: false,
          frozen_index: 1,
          previous_root: currentRoot!,
          new_root: fixture.rootField!,
          multisig_common_params: emptyMultisigCommonParams,
        },
        asSigner(fixture.freezeListManager),
      );

      await fixture.freezeRegistry.update_freeze_list.accepted(
        {
          account: fixture.frozenAccount,
          is_frozen: true,
          frozen_index: 1,
          previous_root: currentRoot!,
          new_root: fixture.rootField!,
          multisig_common_params: emptyMultisigCommonParams,
        },
        asSigner(fixture.freezeListManager),
      );
      isAccountFrozen = (await fixture.freezeRegistry.getFreeze_list(fixture.frozenAccount)) as boolean;
      let frozenAccountByIndex = await fixture.freezeRegistry.getFreeze_list_index(1);
      let lastIndex = await fixture.freezeRegistry.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
      expect(lastIndex).toBe(1);
    }

    // Cannot unfreeze an account when the frozen list index is incorrect
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze a frozen account
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    let randomAddress = Leo.address(safeAddress());
    await fixture.freezeRegistry.update_freeze_list.accepted(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = (await fixture.freezeRegistry.getFreeze_list(randomAddress)) as boolean;
    let frozenAccountByIndex = await fixture.freezeRegistry.getFreeze_list_index(2);
    let lastIndex = await fixture.freezeRegistry.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = Leo.address(safeAddress());
    // Cannot freeze an account when the frozen list index is greater than the last index
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 10,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );
    // Cannot freeze an account when the frozen list index is already taken
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    randomAddress = Leo.address(safeAddress());

    // Even though the caller is a freeze list manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, 0n),
      },
      asSigner(fixture.freezeListManager),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(zeroAddress, 1n),
      },
      asSigner(fixture.freezeListManager),
    );

    const salt = randomSalt();
    let multisigOp: FreezeRegistryMultisigOp = {
      op: MULTISIG_OP_UPDATE_FREEZE_LIST,
      user: randomAddress,
      is_frozen: true,
      frozen_index: 3,
      previous_root: fixture.rootField!,
      new_root: fixture.rootField!,
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
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(
      fixture.ctx,
      [fixture.signer1, fixture.signer2],
      fixture.freezeListManagerWalletId,
      signingOpId,
    );
    // If the wallet_id is incorrect the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the address doesn't match the address in the request the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: Leo.address(safeAddress()),
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    // If the is_frozen doesn't match the is_frozen in the request the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: false,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    // If the frozen_index doesn't match the frozen_index in the request the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    // If the previous_root doesn't match the previous_root in the request the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fieldLiteral(0n),
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    // If the new_root doesn't match the new_root in the request the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fieldLiteral(0n),
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_freeze_list.accepted(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    const isFrozen = await fixture.freezeRegistry.getFreeze_list(randomAddress);
    expect(isFrozen).toBe(true);

    // It's possible to execute the request only once
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    multisigOp = {
      ...multisigOp,
      is_frozen: false,
    };
    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.freezeRegistry.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: false,
        frozen_index: 3,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
  });

  test("test update_block_height_window", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.frozenAccount),
    );

    await fixture.freezeRegistry.update_block_height_window.accepted(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    // Even though the caller is a freeze list manager, a non-ZERO wallet_id triggers a multisig check,
    // which fails because no such request exists.
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, 0n),
      },
      asSigner(fixture.freezeListManager),
    );
    // If wallet_id is ZERO_ADDRESS but salt is non-zero, the transaction fails.
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(zeroAddress, 1n),
      },
      asSigner(fixture.freezeListManager),
    );

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
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await approveRequest(
      fixture.ctx,
      [fixture.signer1, fixture.signer2],
      fixture.freezeListManagerWalletId,
      signingOpId,
    );

    // If the wallet_id is incorrect the transaction will fail
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    // If the salt is incorrect the transaction will fail
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt + 1n),
      },
      asSigner(fixture.deployer),
    );

    // If the block height window doesn't match the block height window in the request the transaction will fail
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: 0,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_block_height_window.accepted(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
    const blockHeightWindow = await fixture.freezeRegistry.getBlock_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
    expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

    // It's possible to execute the request only once
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.freezeListManagerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    ({ signingOpId } = await initMultisigOp(fixture, fixture.managerWalletId, multisigOp, MAX_BLOCK_HEIGHT));
    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.managerWalletId, signingOpId);

    // If the wallet_id doesn't allow to update the wallet_id role the transaction will fail
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
        multisig_common_params: multisigCommonParams(fixture.managerWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
  });

  test("test verify_non_inclusion_pub", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.verify_non_inclusion_pub.rejected(
      {
        account: fixture.frozenAccount,
      },
      asSigner(fixture.deployer),
    );
    await fixture.freezeRegistry.verify_non_inclusion_pub.accepted(
      {
        account: fixture.admin,
      },
      asSigner(fixture.deployer),
    );
  });

  test("test verify_non_inclusion_priv", async () => {
    const fixture = state!;

    await expect(
      fixture.freezeRegistry.verify_non_inclusion_priv.settled(
        {
          account: fixture.frozenAccount,
          merkle_proof: fixture.frozenAccountMerkleProof!,
        },
        asSigner(fixture.deployer),
      ),
    ).rejects.toThrow();

    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);

    const adminLeafIndices = getLeafIndices(tree, fixture.admin.address);
    const emptyTreeAdminMerkleProof = [
      toMerkleProof(getSiblingPath(tree, adminLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, adminLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    // The transaction failed because the root is mismatch
    await fixture.freezeRegistry.verify_non_inclusion_priv.rejected(
      {
        account: fixture.admin,
        merkle_proof: emptyTreeAdminMerkleProof,
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.verify_non_inclusion_priv.accepted(
      {
        account: fixture.admin,
        merkle_proof: fixture.adminMerkleProof!,
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fixture.rootField!,
        new_root: emptyRootField,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    const newRoot = await fixture.freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.freezeRegistry.getFreeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    await fixture.freezeRegistry.verify_non_inclusion_priv.accepted(
      {
        account: fixture.admin,
        merkle_proof: fixture.adminMerkleProof!,
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_block_height_window.accepted(
      {
        blocks: 1,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.freezeListManager),
    );

    // The transaction failed because the old root is expired
    await fixture.freezeRegistry.verify_non_inclusion_priv.rejected(
      {
        account: fixture.admin,
        merkle_proof: fixture.adminMerkleProof!,
      },
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.verify_non_inclusion_priv.accepted(
      {
        account: fixture.admin,
        merkle_proof: emptyTreeAdminMerkleProof,
      },
      asSigner(fixture.deployer),
    );
  });

  test("test expired multisig requests", async () => {
    const fixture = state!;
    const randomWalletId = Leo.address(safeAddress());
    await createWallet(
      fixture.multisig,
      fixture.deployer,
      randomWalletId,
      [Leo.address(fixture.deployer), zeroAddress, zeroAddress, zeroAddress],
      1,
    );
    await fixture.freezeRegistry.update_wallet_id_role.accepted(
      {
        target_wallet_id: randomWalletId,
        role: MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
        multisig_common_params: emptyMultisigCommonParams,
      },
      asSigner(fixture.admin),
    );

    const salt = randomSalt();
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

    let { walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1);
    await fixture.multisig.getCompleted_signing_ops(walletSigningOpIdHash);
    await waitBlocks(fixture.ctx, 1);
    await fixture.freezeRegistry.update_wallet_id_role.rejected(
      {
        target_wallet_id: zeroAddress,
        role: 0,
        multisig_common_params: multisigCommonParams(randomWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    multisigOp = {
      ...multisigOp,
      op: MULTISIG_OP_UPDATE_ROLE,
    };
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1));
    await fixture.multisig.getCompleted_signing_ops(walletSigningOpIdHash);
    await waitBlocks(fixture.ctx, 1);
    await fixture.freezeRegistry.update_role.rejected(
      {
        new_address: zeroAddress,
        role: 0,
        multisig_common_params: multisigCommonParams(randomWalletId, salt),
      },
      asSigner(fixture.deployer),
    );

    multisigOp = {
      ...multisigOp,
      op: MULTISIG_OP_UPDATE_BLOCK_WINDOW,
    };
    ({ walletSigningOpIdHash } = await initMultisigOp(fixture, randomWalletId, multisigOp, 1));
    await fixture.multisig.getCompleted_signing_ops(walletSigningOpIdHash);
    await waitBlocks(fixture.ctx, 1);
    await fixture.freezeRegistry.update_block_height_window.rejected(
      {
        blocks: 0,
        multisig_common_params: multisigCommonParams(randomWalletId, salt),
      },
      asSigner(fixture.deployer),
    );
  });
});
