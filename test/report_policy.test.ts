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
      {
        token_id: tokenIdField,
        recipient: account,
        amount: amount * 20n,
        authorized_until: defaultAuthorizedUntil,
      },
      asSigner(admin),
    );
    await tokenRegistry.mint_public.accepted(
      {
        token_id: tokenIdField,
        recipient: frozenAccount,
        amount: amount * 20n,
        authorized_until: defaultAuthorizedUntil,
      },
      asSigner(admin),
    );

    let mintPrivateTx = await tokenRegistry.mint_private.accepted(
      {
        token_id: tokenIdField,
        recipient: account,
        amount: amount * 20n,
        external_authorization_required: true,
        authorized_until: 0,
      },
      asSigner(admin),
    );
    const accountRecord = await mintPrivateTx.outputs.decrypt(account);

    mintPrivateTx = await tokenRegistry.mint_private.accepted(
      {
        token_id: tokenIdField,
        recipient: frozenAccount,
        amount: amount * 20n,
        external_authorization_required: true,
        authorized_until: 0,
      },
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
      (await fixture.reportPolicy.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) !== null;
    if (!isFreezeRegistryInitialized) {
      const currentRoot =
        (await fixture.reportPolicy.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) || emptyRootField;
      // Cannot update freeze list before initialization
      await fixture.reportPolicy.update_freeze_list.rejected(
        {
          account: fixture.frozenAccount,
          is_frozen: true,
          frozen_index: 1,
          previous_root: currentRoot,
          new_root: fixture.rootField,
        },
        asSigner(fixture.freezeListManager),
      );

      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.reportPolicy.initialize.rejected(
          {
            admin: fixture.admin,
            blocks: policies.report.blockHeightWindow,
          },
          asSigner(fixture.deployer),
        );
      }

      await fixture.reportPolicy.initialize.accepted(
        {
          admin: fixture.admin,
          blocks: policies.report.blockHeightWindow,
        },
        asSigner(fixture.admin),
      );
      const isAccountFrozen = await fixture.reportPolicy.getFreeze_list(addressLiteral(ZERO_ADDRESS));
      const frozenAccountByIndex = await fixture.reportPolicy.getFreeze_list_index(0);
      const lastIndex = await fixture.reportPolicy.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const initializedRoot = await fixture.reportPolicy.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const blockHeightWindow = await fixture.reportPolicy.getBlock_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
      const role = await fixture.reportPolicy.getAddress_to_role(fixture.admin);

      expect(role).toBe(MANAGER_ROLE);
      expect(isAccountFrozen).toBe(false);
      expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
      expect(lastIndex).toBe(0);
      expect(initializedRoot).toBe(emptyRootField);
      expect(blockHeightWindow).toBe(policies.report.blockHeightWindow);

      // It is possible to call to initialize only one time
      await fixture.reportPolicy.initialize.rejected(
        {
          admin: fixture.admin,
          blocks: policies.report.blockHeightWindow,
        },
        asSigner(fixture.admin),
      );
    }
  });

  test(`test update_role`, async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.reportPolicy.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
      },
      asSigner(fixture.admin),
    );
    let role = await fixture.reportPolicy.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.reportPolicy.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: NONE_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.reportPolicy.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.reportPolicy.update_role.rejected(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update freeze list manager role
    await fixture.reportPolicy.update_role.rejected(
      {
        new_address: fixture.freezeListManager,
        role: FREEZELIST_MANAGER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.reportPolicy.update_role.rejected(
      {
        new_address: fixture.admin,
        role: NONE_ROLE,
      },
      asSigner(fixture.admin),
    );

    // Manager can assign freeze list manager role
    await fixture.reportPolicy.update_role.accepted(
      {
        new_address: fixture.freezeListManager,
        role: FREEZELIST_MANAGER_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.reportPolicy.getAddress_to_role(fixture.freezeListManager);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);
  });

  test(`test update_freeze_list`, async () => {
    const fixture = state!;

    const currentRoot = await fixture.reportPolicy.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the admin can call to update_freeze_list
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: fixture.admin,
        is_frozen: true,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField,
      },
      asSigner(fixture.frozenAccount),
    );

    // Cannot unfreeze an unfrozen account
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot update the root if the previous root is incorrect
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fieldLiteral(0n),
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );

    await fixture.reportPolicy.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );
    let isAccountFrozen = await fixture.reportPolicy.getFreeze_list(fixture.frozenAccount);
    let frozenAccountByIndex = await fixture.reportPolicy.getFreeze_list_index(1);
    let lastIndex = await fixture.reportPolicy.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    // Cannot unfreeze an account when the frozen list index is incorrect
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 2,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze a frozen account
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );

    await fixture.reportPolicy.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.reportPolicy.getFreeze_list(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.reportPolicy.getFreeze_list_index(1);
    lastIndex = await fixture.reportPolicy.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(1);

    // Also the freeze list manager can update the freeze list
    await fixture.reportPolicy.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.reportPolicy.getFreeze_list(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.reportPolicy.getFreeze_list_index(1);
    lastIndex = await fixture.reportPolicy.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    let randomAddress = addressLiteral(safeAddress());
    await fixture.reportPolicy.update_freeze_list.accepted(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.reportPolicy.getFreeze_list(randomAddress);
    frozenAccountByIndex = await fixture.reportPolicy.getFreeze_list_index(2);
    lastIndex = await fixture.reportPolicy.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = addressLiteral(safeAddress());
    // Cannot freeze an account when the frozen list index is greater than the last index
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 10,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze an account when the frozen list index is already taken
    await fixture.reportPolicy.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField,
        new_root: fixture.rootField,
      },
      asSigner(fixture.freezeListManager),
    );
  });

  test("token_registry calls should fail", async () => {
    const fixture = state!;

    await fixture.tokenRegistry.transfer_private_to_public.rejected(
      {
        recipient: fixture.account,
        amount,
        input_record: fixture.accountRecord!,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_private.rejected(
      {
        recipient: fixture.account,
        amount,
        input_record: fixture.accountRecord!,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_public.rejected(
      {
        token_id: tokenIdField,
        recipient: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_public_as_signer.rejected(
      {
        token_id: tokenIdField,
        recipient: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_public_to_private.rejected(
      {
        token_id: tokenIdField,
        recipient: fixture.account,
        amount,
        external_authorization_required: true,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      {
        token_id: tokenIdField,
        spender: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_from_public.rejected(
      {
        token_id: tokenIdField,
        owner: fixture.account,
        recipient: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.transfer_from_public_to_private.rejected(
      {
        token_id: tokenIdField,
        owner: fixture.account,
        recipient: fixture.account,
        amount,
        external_authorization_required: true,
      },
      asSigner(fixture.account),
    );
  });

  test(`test update_block_height_window`, async () => {
    const fixture = state!;

    await fixture.reportPolicy.update_block_height_window.rejected(
      {
        blocks: policies.report.blockHeightWindow,
      },
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.update_block_height_window.accepted(
      {
        blocks: policies.report.blockHeightWindow,
      },
      asSigner(fixture.freezeListManager),
    );
  });

  test(`test transfer_public`, async () => {
    const fixture = state!;

    // If the sender didn't approve the program the tx will fail
    await fixture.reportPolicy.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      {
        token_id: tokenIdField,
        spender: addressLiteral(policies.report.programAddress),
        amount,
      },
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.transfer_public.accepted(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.account),
    );
  });

  test(`test transfer_public_as_signer`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_as_signer.rejected(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_as_signer.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
      },
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.transfer_public_as_signer.accepted(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.account),
    );
  });

  test(`test transfer_public_to_priv`, async () => {
    const fixture = state!;

    // If the sender didn't approve the program the tx will fail
    await fixture.reportPolicy.transfer_public_to_priv.rejected(
      {
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      {
        token_id: tokenIdField,
        spender: addressLiteral(policies.report.programAddress),
        amount,
      },
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_public_to_priv.rejected(
      {
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await expect(
      fixture.reportPolicy.transfer_public_to_priv.settled(
        {
          recipient: fixture.frozenAccount,
          amount,
          recipient_merkle_proofs: fixture.frozenAccountMerkleProof,
        },
        asSigner(fixture.account),
      ),
    ).rejects.toThrow();

    const tx = await fixture.reportPolicy.transfer_public_to_priv.accepted(
      {
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
      },
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
    await expect(
      fixture.reportPolicy.transfer_private.settled(
        {
          recipient: fixture.recipient,
          amount,
          input_record: fixture.accountRecord!,
          sender_merkle_proofs: fixture.frozenAccountMerkleProof,
          recipient_merkle_proofs: fixture.recipientMerkleProof,
        },
        asSigner(fixture.frozenAccount),
      ),
    ).rejects.toThrow();
    // If the recipient is frozen account it's impossible to send tokens
    await expect(
      fixture.reportPolicy.transfer_private.settled(
        {
          recipient: fixture.frozenAccount,
          amount,
          input_record: fixture.accountRecord!,
          sender_merkle_proofs: fixture.senderMerkleProof,
          recipient_merkle_proofs: fixture.frozenAccountMerkleProof,
        },
        asSigner(fixture.account),
      ),
    ).rejects.toThrow();

    const tx = await fixture.reportPolicy.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
      },
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
    await expect(
      fixture.reportPolicy.transfer_priv_to_public.settled(
        {
          recipient: fixture.recipient,
          amount,
          input_record: fixture.frozenAccountRecord!,
          sender_merkle_proofs: fixture.frozenAccountMerkleProof,
        },
        asSigner(fixture.frozenAccount),
      ),
    ).rejects.toThrow();

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.reportPolicy.transfer_priv_to_public.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
      },
      asSigner(fixture.account),
    );
    const tx = await fixture.reportPolicy.transfer_priv_to_public.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
      },
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
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: emptyTreeSenderMerkleProof,
        recipient_merkle_proofs: emptyTreeRecipientMerkleProof,
      },
      asSigner(fixture.account),
    );

    await fixture.reportPolicy.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fixture.rootField,
        new_root: emptyRootField,
      },
      asSigner(fixture.freezeListManager),
    );

    const newRoot = await fixture.reportPolicy.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.reportPolicy.getFreeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    let tx = await fixture.reportPolicy.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
      },
      asSigner(fixture.account),
    );
    fixture.accountRecord = await tx.outputs[1]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);

    await fixture.reportPolicy.update_block_height_window.accepted(
      {
        blocks: 1,
      },
      asSigner(fixture.freezeListManager),
    );

    // The transaction failed because the old root is expired
    await fixture.reportPolicy.transfer_private.rejected(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
      },
      asSigner(fixture.account),
    );

    tx = await fixture.reportPolicy.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: emptyTreeSenderMerkleProof,
        recipient_merkle_proofs: emptyTreeRecipientMerkleProof,
      },
      asSigner(fixture.account),
    );
    await tx.outputs[1].match(TokenRegistry_Token.output.from("prehook_private", 0)).decrypt(fixture.account);
  });
});
