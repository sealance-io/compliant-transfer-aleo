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
  MAX_TREE_DEPTH,
  NONE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  emptyRoot,
  fundedAmount,
  zeroAddress,
  emptyRootField,
  SETUP_TIMEOUT_MS,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { Leo } from "../typechain/BaseContract.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";
import { safeAddress } from "./utils/Accounts.js";
interface FreezeRegistryFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly freezeListManager: SignableNamedAccount;
  readonly freezeRegistry: ReturnType<typeof createSealanceFreezelistRegistry>;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly adminMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
}

async function deployFixture() {
  const ctx = await setup();

  try {
    const deployer = ctx.named.signer("deployer");
    const admin = ctx.named.signer("admin");
    const frozenAccount = ctx.named.signer("frozenAccount");
    const freezeListManager = ctx.named.signer("freezeListManager");

    for (const signer of [admin, frozenAccount, freezeListManager]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const freezeRegistry = createSealanceFreezelistRegistry().connect(ctx.lre);

    for (const program of ["merkle_tree", "multisig_core", "sealance_freezelist_registry"]) {
      await ctx.deploy(program, { noCompile: true });
    }

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
      freezeRegistry,
      rootField,
      adminMerkleProof,
      frozenAccountMerkleProof,
    } satisfies FreezeRegistryFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: FreezeRegistryFixture | undefined;

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

describe("test freeze registry program", () => {
  test("test initialize", async () => {
    const fixture = state!;
    const isFreezeRegistryInitialized =
      await fixture.freezeRegistry.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);

    if (!isFreezeRegistryInitialized) {
      // Cannot update freeze list before initialization
      await fixture.freezeRegistry.update_freeze_list.rejected(
        fixture.frozenAccount,
        true,
        1,
        fieldLiteral(0n),
        fixture.rootField!,
        asSigner(fixture.admin),
      );

      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.freezeRegistry.initialize.rejected(fixture.admin, BLOCK_HEIGHT_WINDOW, asSigner(fixture.admin));
      }

      await fixture.freezeRegistry.initialize.accepted(fixture.admin, BLOCK_HEIGHT_WINDOW, asSigner(fixture.deployer));

      const isAccountFrozen = await fixture.freezeRegistry.mappings.freezeList.get(zeroAddress);
      const frozenAccountByIndex = await fixture.freezeRegistry.mappings.freezeListIndex.get(0);
      const lastIndex = await fixture.freezeRegistry.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await fixture.freezeRegistry.mappings.blockHeightWindow.get(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await fixture.freezeRegistry.mappings.addressToRole.get(fixture.admin);

      expect(role).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(zeroAddress);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRootField);
      expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);
    }

    // It is possible to call to initialize only one time
    await fixture.freezeRegistry.initialize.rejected(fixture.admin, BLOCK_HEIGHT_WINDOW, asSigner(fixture.deployer));
  });

  test("test update_manager_address", async () => {
    const fixture = state!;

    // Manager cannot unassign himself from being a manager
    await fixture.freezeRegistry.update_role.rejected(fixture.admin, NONE_ROLE, asSigner(fixture.admin));

    await fixture.freezeRegistry.update_role.accepted(fixture.frozenAccount, MANAGER_ROLE, asSigner(fixture.admin));

    let role = await fixture.freezeRegistry.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    await fixture.freezeRegistry.update_role.accepted(fixture.frozenAccount, NONE_ROLE, asSigner(fixture.admin));
    role = await fixture.freezeRegistry.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Only the manager can update the roles
    await fixture.freezeRegistry.update_role.rejected(
      fixture.frozenAccount,
      MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );
  });

  test("test update_freeze_list_manager", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.update_role.accepted(
      fixture.freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      asSigner(fixture.admin),
    );
    const freezeListManagerRole = await fixture.freezeRegistry.mappings.addressToRole.get(fixture.freezeListManager);
    expect(freezeListManagerRole).toBe(FREEZELIST_MANAGER_ROLE);

    await fixture.freezeRegistry.update_role.rejected(
      fixture.frozenAccount,
      FREEZELIST_MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );
  });

  test("test update_freeze_list", async () => {
    const fixture = state!;
    const currentRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the manager can call to update_freeze_list
    await fixture.freezeRegistry.update_freeze_list.rejected(
      fixture.admin,
      true,
      1,
      currentRoot!,
      fixture.rootField!,
      asSigner(fixture.frozenAccount),
    );

    // Cannot update the root if the previous root is incorrect
    await fixture.freezeRegistry.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      1,
      fieldLiteral(0n),
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    let isAccountFrozen = await fixture.freezeRegistry.mappings.freezeList.getOrUse(fixture.frozenAccount, false);
    if (!isAccountFrozen) {
      // Cannot unfreeze an unfrozen account
      await fixture.freezeRegistry.update_freeze_list.rejected(
        fixture.frozenAccount,
        false,
        1,
        currentRoot!,
        fixture.rootField!,
        asSigner(fixture.freezeListManager),
      );

      await fixture.freezeRegistry.update_freeze_list.accepted(
        fixture.frozenAccount,
        true,
        1,
        currentRoot!,
        fixture.rootField!,
        asSigner(fixture.freezeListManager),
      );
      isAccountFrozen = await fixture.freezeRegistry.mappings.freezeList.get(fixture.frozenAccount);
      let frozenAccountByIndex = await fixture.freezeRegistry.mappings.freezeListIndex.get(1);
      let lastIndex = await fixture.freezeRegistry.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

      expect(isAccountFrozen).toBe(true);
      expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
      expect(lastIndex).toBe(1);
    }

    // Cannot unfreeze an account when the frozen list index is incorrect
    await fixture.freezeRegistry.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      2,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze a frozen account
    await fixture.freezeRegistry.update_freeze_list.rejected(
      fixture.frozenAccount,
      true,
      1,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    let randomAddress = Leo.address(safeAddress());
    await fixture.freezeRegistry.update_freeze_list.accepted(
      randomAddress,
      true,
      2,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.freezeRegistry.mappings.freezeList.get(randomAddress);
    let frozenAccountByIndex = await fixture.freezeRegistry.mappings.freezeListIndex.get(2);
    let lastIndex = await fixture.freezeRegistry.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = Leo.address(safeAddress());
    // Cannot freeze an account when the frozen list index is greater than the last index
    await fixture.freezeRegistry.update_freeze_list.rejected(
      randomAddress,
      true,
      10,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
    // Cannot freeze an account when the frozen list index is already taken
    await fixture.freezeRegistry.update_freeze_list.rejected(
      randomAddress,
      true,
      2,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
  });

  test("test update_block_height_window", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.update_block_height_window.rejected(
      BLOCK_HEIGHT_WINDOW,
      asSigner(fixture.frozenAccount),
    );

    await fixture.freezeRegistry.update_block_height_window.accepted(
      BLOCK_HEIGHT_WINDOW,
      asSigner(fixture.freezeListManager),
    );
  });

  test("test verify_non_inclusion_pub", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.verify_non_inclusion_pub.rejected(fixture.frozenAccount, asSigner(fixture.deployer));
    await fixture.freezeRegistry.verify_non_inclusion_pub.accepted(fixture.admin, asSigner(fixture.deployer));
  });

  test("test verify_non_inclusion_priv", async () => {
    const fixture = state!;

    await fixture.freezeRegistry.verify_non_inclusion_priv.failsLocally(
      fixture.frozenAccount,
      fixture.frozenAccountMerkleProof!,
      asSigner(fixture.deployer),
    );

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
      fixture.admin,
      emptyTreeAdminMerkleProof,
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.verify_non_inclusion_priv.accepted(
      fixture.admin,
      fixture.adminMerkleProof!,
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField!,
      emptyRootField,
      asSigner(fixture.freezeListManager),
    );

    const newRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.freezeRegistry.mappings.freezeListRoot.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    await fixture.freezeRegistry.verify_non_inclusion_priv.accepted(
      fixture.admin,
      fixture.adminMerkleProof!,
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.update_block_height_window.accepted(1, asSigner(fixture.freezeListManager));

    // The transaction failed because the old root is expired
    await fixture.freezeRegistry.verify_non_inclusion_priv.rejected(
      fixture.admin,
      fixture.adminMerkleProof!,
      asSigner(fixture.deployer),
    );

    await fixture.freezeRegistry.verify_non_inclusion_priv.accepted(
      fixture.admin,
      emptyTreeAdminMerkleProof,
      asSigner(fixture.deployer),
    );
  });
});
