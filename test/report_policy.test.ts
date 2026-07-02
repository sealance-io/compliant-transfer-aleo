import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "@sealance-io/policy-engine-aleo";
import {
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  NONE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  ZERO_ADDRESS,
  amount,
  defaultAuthorizedUntil,
  emptyRoot,
  emptyRootField,
  fundedAmount,
  policies,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { addressLiteral, asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { registerTokenProgram } from "../lib/Token.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";
import { createSealedReportPolicy, TokenRegistry_Token } from "../typechain/SealedReportPolicy.js";
import { createTokenRegistry, type Token } from "../typechain/TokenRegistry.js";
import { safeAddress } from "./utils/Accounts.js";

const { tokenId } = policies.report;
const tokenIdField = fieldLiteral(tokenId);

interface ReportPolicyFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly investigator: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly recipient: SignableNamedAccount;
  readonly freezeListManager: SignableNamedAccount;
  readonly tokenRegistry: ReturnType<typeof createTokenRegistry>;
  readonly reportPolicy: ReturnType<typeof createSealedReportPolicy>;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly senderMerkleProof: MerkleProof[];
  readonly recipientMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
  accountRecord: Token;
  frozenAccountRecord: Token;
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
    const freezeListManager = ctx.named.signer("freezeListManager");

    for (const signer of [admin, frozenAccount, account, freezeListManager]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const tokenRegistry = createTokenRegistry().connect(ctx.lre);
    const reportPolicy = createSealedReportPolicy().connect(ctx.lre);

    for (const program of ["token_registry", "merkle_tree", "multisig_core", "sealed_report_policy"]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await registerTokenProgram(tokenRegistry, deployer, admin, policies.report);

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;
    const senderLeafIndices = getLeafIndices(tree, account.address);
    const recipientLeafIndices = getLeafIndices(tree, recipient.address);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount.address);
    const senderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    const recipientMerkleProof = [
      toMerkleProof(getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    const frozenAccountMerkleProof = [
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH)),
    ];

    await tokenRegistry.mint_public.accepted(
      tokenIdField,
      account,
      amount * 20n,
      defaultAuthorizedUntil,
      asSigner(admin),
    );
    await tokenRegistry.mint_public.accepted(
      tokenIdField,
      frozenAccount,
      amount * 20n,
      defaultAuthorizedUntil,
      asSigner(admin),
    );

    let mintPrivateTx = await tokenRegistry.mint_private.accepted(
      tokenIdField,
      account,
      amount * 20n,
      true,
      0,
      asSigner(admin),
    );
    const accountRecord = await mintPrivateTx.outputs.decrypt(account);

    mintPrivateTx = await tokenRegistry.mint_private.accepted(
      tokenIdField,
      frozenAccount,
      amount * 20n,
      true,
      0,
      asSigner(admin),
    );
    const frozenAccountRecord = await mintPrivateTx.outputs.decrypt(frozenAccount);

    return {
      ctx,
      deployer,
      admin,
      investigator,
      frozenAccount,
      account,
      recipient,
      freezeListManager,
      tokenRegistry,
      reportPolicy,
      rootField: fieldLiteral(root),
      senderMerkleProof,
      recipientMerkleProof,
      frozenAccountMerkleProof,
      accountRecord,
      frozenAccountRecord,
    } satisfies ReportPolicyFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: ReportPolicyFixture | undefined;

beforeAll(async () => {
  state = await loadFixture(deployFixture);
});

afterAll(async () => {
  if (state) {
    await state.ctx.teardown();
  } else {
    clearFixtures();
  }
});

describe("test sealed_report_policy program", () => {
  test(`test initialize`, async () => {
    const fixture = state!;

    const isFreezeRegistryInitialized =
      await fixture.reportPolicy.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
    if (!isFreezeRegistryInitialized) {
      const currentRoot = await fixture.reportPolicy.mappings.freezeListRoot.getOrUse(
        CURRENT_FREEZE_LIST_ROOT_INDEX,
        emptyRootField,
      );
      // Cannot update freeze list before initialization
      await fixture.reportPolicy.update_freeze_list.rejected(
        fixture.frozenAccount,
        true,
        1,
        currentRoot,
        fixture.rootField,
        asSigner(fixture.freezeListManager),
      );

      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.reportPolicy.initialize.rejected(
          fixture.admin,
          policies.report.blockHeightWindow,
          asSigner(fixture.deployer),
        );
      }

      await fixture.reportPolicy.initialize.accepted(
        fixture.admin,
        policies.report.blockHeightWindow,
        asSigner(fixture.admin),
      );
      const isAccountFrozen = await fixture.reportPolicy.mappings.freezeList.get(addressLiteral(ZERO_ADDRESS));
      const frozenAccountByIndex = await fixture.reportPolicy.mappings.freezeListIndex.get(0);
      const lastIndex = await fixture.reportPolicy.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await fixture.reportPolicy.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await fixture.reportPolicy.mappings.blockHeightWindow.get(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await fixture.reportPolicy.mappings.addressToRole.get(fixture.admin);

      expect(role).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRootField);
      expect(blockHeightWindow).toBe(policies.report.blockHeightWindow);

      // It is possible to call to initialize only one time
      await fixture.reportPolicy.initialize.rejected(
        fixture.admin,
        policies.report.blockHeightWindow,
        asSigner(fixture.admin),
      );
    }
  });

  test(`test update_role`, async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.reportPolicy.update_role.accepted(fixture.frozenAccount, MANAGER_ROLE, asSigner(fixture.admin));
    let role = await fixture.reportPolicy.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.reportPolicy.update_role.accepted(fixture.frozenAccount, NONE_ROLE, asSigner(fixture.admin));
    role = await fixture.reportPolicy.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.reportPolicy.update_role.rejected(
      fixture.frozenAccount,
      MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update freeze list manager role
    await fixture.reportPolicy.update_role.rejected(
      fixture.freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.reportPolicy.update_role.rejected(fixture.admin, NONE_ROLE, asSigner(fixture.admin));

    // Manager can assign freeze list manager role
    await fixture.reportPolicy.update_role.accepted(
      fixture.freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      asSigner(fixture.admin),
    );
    role = await fixture.reportPolicy.mappings.addressToRole.get(fixture.freezeListManager);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);
  });

  test(`test update_freeze_list`, async () => {
    const fixture = state!;

    const currentRoot = await fixture.reportPolicy.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the admin can call to update_freeze_list
    await fixture.reportPolicy.update_freeze_list.rejected(
      fixture.admin,
      true,
      1,
      currentRoot!,
      fixture.rootField,
      asSigner(fixture.frozenAccount),
    );

    // Cannot unfreeze an unfrozen account
    await fixture.reportPolicy.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      1,
      currentRoot!,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );

    // Cannot update the root if the previous root is incorrect
    await fixture.reportPolicy.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      1,
      fieldLiteral(0n),
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );

    await fixture.reportPolicy.update_freeze_list.accepted(
      fixture.frozenAccount,
      true,
      1,
      currentRoot!,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );
    let isAccountFrozen = await fixture.reportPolicy.mappings.freezeList.get(fixture.frozenAccount);
    let frozenAccountByIndex = await fixture.reportPolicy.mappings.freezeListIndex.get(1);
    let lastIndex = await fixture.reportPolicy.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    // Cannot unfreeze an account when the frozen list index is incorrect
    await fixture.reportPolicy.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      2,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze a frozen account
    await fixture.reportPolicy.update_freeze_list.rejected(
      fixture.frozenAccount,
      true,
      1,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );

    await fixture.reportPolicy.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.reportPolicy.mappings.freezeList.get(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.reportPolicy.mappings.freezeListIndex.get(1);
    lastIndex = await fixture.reportPolicy.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(1);

    // Also the freeze list manager can update the freeze list
    await fixture.reportPolicy.update_freeze_list.accepted(
      fixture.frozenAccount,
      true,
      1,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.reportPolicy.mappings.freezeList.get(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.reportPolicy.mappings.freezeListIndex.get(1);
    lastIndex = await fixture.reportPolicy.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    let randomAddress = addressLiteral(safeAddress());
    await fixture.reportPolicy.update_freeze_list.accepted(
      randomAddress,
      true,
      2,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.reportPolicy.mappings.freezeList.get(randomAddress);
    frozenAccountByIndex = await fixture.reportPolicy.mappings.freezeListIndex.get(2);
    lastIndex = await fixture.reportPolicy.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = addressLiteral(safeAddress());
    // Cannot freeze an account when the frozen list index is greater than the last index
    await fixture.reportPolicy.update_freeze_list.rejected(
      randomAddress,
      true,
      10,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze an account when the frozen list index is already taken
    await fixture.reportPolicy.update_freeze_list.rejected(
      randomAddress,
      true,
      2,
      fixture.rootField,
      fixture.rootField,
      asSigner(fixture.freezeListManager),
    );
  });

  test("token_registry calls should fail", async () => {
    const fixture = state!;

    await fixture.tokenRegistry.transfer_private_to_public.rejected(
      fixture.account,
      amount,
      fixture.accountRecord!,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_private.rejected(
      fixture.account,
      amount,
      fixture.accountRecord!,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_public.rejected(
      tokenIdField,
      fixture.account,
      amount,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_public_as_signer.rejected(
      tokenIdField,
      fixture.account,
      amount,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_public_to_private.rejected(
      tokenIdField,
      fixture.account,
      amount,
      true,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      fixture.account,
      amount,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_from_public.rejected(
      tokenIdField,
      fixture.account,
      fixture.account,
      amount,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_from_public_to_private.rejected(
      tokenIdField,
      fixture.account,
      fixture.account,
      amount,
      true,
      asSigner(fixture.account),
    );
  });

  test(`test update_block_height_window`, async () => {
    const fixture = state!;

    await fixture.reportPolicy.update_block_height_window.rejected(
      policies.report.blockHeightWindow,
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.update_block_height_window.accepted(
      policies.report.blockHeightWindow,
      asSigner(fixture.freezeListManager),
    );
  });

  test(`test transfer_public`, async () => {
    const fixture = state!;

    // If the sender didn't approve the program the tx will fail
    await fixture.reportPolicy.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      addressLiteral(policies.report.programAddress),
      amount,
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    await fixture.reportPolicy.transfer_public.accepted(fixture.recipient, amount, asSigner(fixture.account));
  });

  test(`test transfer_public_as_signer`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_as_signer.rejected(
      fixture.recipient,
      amount,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_as_signer.rejected(
      fixture.frozenAccount,
      amount,
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.transfer_public_as_signer.accepted(fixture.recipient, amount, asSigner(fixture.account));
  });

  test(`test transfer_public_to_priv`, async () => {
    const fixture = state!;

    // If the sender didn't approve the program the tx will fail
    await fixture.reportPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      addressLiteral(policies.report.programAddress),
      amount,
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_to_priv.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.account),
    );

    const tx = await fixture.reportPolicy.transfer_public_to_priv.accepted(
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const recipientRecord = await tx.outputs[1]
      .match(TokenRegistry_Token.output.from("transfer_from_public_to_private", 0))
      .decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);
    expect(recipientRecord.token_id).toBe(tokenIdField);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
    expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test(`test transfer_private`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_private.failsLocally(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.frozenAccountMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.frozenAccount),
    );
    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_private.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.account),
    );

    const tx = await fixture.reportPolicy.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    const recipientRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("transfer_private", 1))
      .decrypt(fixture.recipient);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(fixture.accountRecord.token_id).toBe(tokenIdField);
    expect(fixture.accountRecord.external_authorization_required).toBe(true);
    expect(fixture.accountRecord.authorized_until).toBe(0);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);
    expect(recipientRecord.token_id).toBe(tokenIdField);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
    expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test(`test transfer_priv_to_public`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_priv_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_priv_to_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );
    const tx = await fixture.reportPolicy.transfer_priv_to_public.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(fixture.accountRecord.token_id).toBe(tokenIdField);
    expect(fixture.accountRecord.external_authorization_required).toBe(true);
    expect(fixture.accountRecord.authorized_until).toBe(0);

    const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
    expect(decryptedComplianceRecord.amount).toBe(amount);
    expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
    expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test(`test old root support`, async () => {
    const fixture = state!;

    const leaves = generateLeaves([]);
    const tree = buildTree(leaves);
    expect(tree[tree.length - 1]).toBe(emptyRoot);
    const senderLeafIndices = getLeafIndices(tree, fixture.account.address);
    const recipientLeafIndices = getLeafIndices(tree, fixture.recipient.address);
    const emptyTreeSenderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    const emptyTreeRecipientMerkleProof = [
      toMerkleProof(getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    // The transaction failed because the root is mismatch
    await fixture.reportPolicy.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      emptyTreeSenderMerkleProof,
      emptyTreeRecipientMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField,
      emptyRootField,
      asSigner(fixture.freezeListManager),
    );

    const newRoot = await fixture.reportPolicy.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.reportPolicy.mappings.freezeListRoot.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    let tx = await fixture.reportPolicy.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );
    fixture.accountRecord = await tx.outputs[1]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);

    await fixture.reportPolicy.update_block_height_window.accepted(1, asSigner(fixture.freezeListManager));

    // The transaction failed because the old root is expired
    await fixture.reportPolicy.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    tx = await fixture.reportPolicy.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      emptyTreeSenderMerkleProof,
      emptyTreeRecipientMerkleProof,
      asSigner(fixture.account),
    );
    await tx.outputs[1].match(TokenRegistry_Token.output.from("prehook_private", 0)).decrypt(fixture.account);
  });
});
