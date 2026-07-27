import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "@sealance-io/policy-engine-aleo";

import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  EPOCH,
  EPOCH_INDEX,
  FREEZE_REGISTRY_PROGRAM_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  NONE_ROLE,
  THRESHOLD,
  THRESHOLD_INDEX,
  defaultAuthorizedUntil,
  fundedAmount,
  policies,
} from "../lib/Constants.js";
import { getLatestBlockHeight } from "../lib/Block.js";
import { fundWithCredits } from "../lib/Fund.js";
import { addressLiteral, asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { registerTokenProgram } from "../lib/Token.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";
import {
  createSealedThresholdReportPolicy,
  TokenRegistry_Token,
  type TokenComplianceStateRecord,
} from "../typechain/SealedThresholdReportPolicy.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import { createTokenRegistry, type Token } from "../typechain/TokenRegistry.js";

const { tokenId } = policies.threshold;
const tokenIdField = fieldLiteral(tokenId);
const amount = 1n;

interface ThresholdFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly investigator: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly recipient: SignableNamedAccount;
  readonly tokenRegistry: ReturnType<typeof createTokenRegistry>;
  readonly thresholdPolicy: ReturnType<typeof createSealedThresholdReportPolicy>;
  readonly freezeRegistry: ReturnType<typeof createSealanceFreezelistRegistry>;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly senderMerkleProof: MerkleProof[];
  readonly recipientMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
  accountRecord: Token;
  frozenAccountRecord: Token;
  accountStateRecord?: TokenComplianceStateRecord;
  frozenAccountStateRecord?: TokenComplianceStateRecord;
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

    for (const signer of [admin, frozenAccount, account, recipient]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const tokenRegistry = createTokenRegistry().connect(ctx.lre);
    const thresholdPolicy = createSealedThresholdReportPolicy().connect(ctx.lre);
    const freezeRegistry = createSealanceFreezelistRegistry().connect(ctx.lre);

    for (const program of [
      "token_registry",
      "merkle_tree",
      "multisig_core",
      "sealance_freezelist_registry",
      "sealed_threshold_report_policy",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await registerTokenProgram(tokenRegistry, deployer, admin, policies.threshold);

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;
    const rootField = fieldLiteral(root);
    const senderLeafIndices = getLeafIndices(tree, account.address);
    const recipientLeafIndices = getLeafIndices(tree, recipient.address);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount.address);

    const isFreezeRegistryInitialized =
      await freezeRegistry.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX);
    if (!isFreezeRegistryInitialized) {
      await freezeRegistry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, asSigner(deployer));
    }

    const role = await freezeRegistry.mappings.addressToRole.get(admin);
    if ((role & FREEZELIST_MANAGER_ROLE) !== FREEZELIST_MANAGER_ROLE) {
      await freezeRegistry.update_role.accepted(admin, MANAGER_ROLE + FREEZELIST_MANAGER_ROLE, asSigner(admin));
    }

    const isAccountFrozen = await freezeRegistry.mappings.freezeList.getOrUse(frozenAccount, false);
    if (!isAccountFrozen) {
      const currentRoot = await freezeRegistry.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
      await freezeRegistry.update_freeze_list.accepted(
        frozenAccount,
        true,
        1,
        currentRoot!,
        rootField,
        asSigner(admin),
      );
    }

    await freezeRegistry.update_block_height_window.accepted(300, asSigner(admin));

    await tokenRegistry.mint_public.accepted(
      tokenIdField,
      account,
      amount * 20n + THRESHOLD,
      defaultAuthorizedUntil,
      asSigner(admin),
    );
    await tokenRegistry.mint_public.accepted(
      tokenIdField,
      frozenAccount,
      amount * 20n + THRESHOLD,
      defaultAuthorizedUntil,
      asSigner(admin),
    );

    let mintPrivateTx = await tokenRegistry.mint_private.accepted(
      tokenIdField,
      account,
      amount * 20n + THRESHOLD,
      true,
      0,
      asSigner(admin),
    );
    const accountRecord = await mintPrivateTx.outputs.decrypt(account);

    mintPrivateTx = await tokenRegistry.mint_private.accepted(
      tokenIdField,
      frozenAccount,
      amount * 20n + THRESHOLD,
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
      tokenRegistry,
      thresholdPolicy,
      freezeRegistry,
      rootField,
      senderMerkleProof: [
        toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
        toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
      ],
      recipientMerkleProof: [
        toMerkleProof(getSiblingPath(tree, recipientLeafIndices[0], MAX_TREE_DEPTH)),
        toMerkleProof(getSiblingPath(tree, recipientLeafIndices[1], MAX_TREE_DEPTH)),
      ],
      frozenAccountMerkleProof: [
        toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH)),
        toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH)),
      ],
      accountRecord,
      frozenAccountRecord,
    } satisfies ThresholdFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: ThresholdFixture | undefined;

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

describe("test sealed_threshold_policy program", () => {
  test(`test initialize`, async () => {
    const fixture = state!;
    const isInitialized =
      await fixture.thresholdPolicy.mappings.freezeRegistryProgramName.contains(FREEZE_REGISTRY_PROGRAM_INDEX);
    if (!isInitialized) {
      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.thresholdPolicy.initialize.rejected(
          fixture.admin,
          policies.threshold.blockHeightWindow,
          asSigner(fixture.deployer),
        );
      }

      await fixture.thresholdPolicy.initialize.accepted(
        fixture.admin,
        policies.threshold.blockHeightWindow,
        asSigner(fixture.admin),
      );

      const role = await fixture.thresholdPolicy.mappings.addressToRole.get(fixture.admin);
      expect(role).toBe(MANAGER_ROLE);
      const freezeRegistryName =
        await fixture.thresholdPolicy.mappings.freezeRegistryProgramName.get(FREEZE_REGISTRY_PROGRAM_INDEX);
      expect(freezeRegistryName).toBe(531934507715736310883939492834865785n);
      const epoch = await fixture.thresholdPolicy.mappings.epoch.get(EPOCH_INDEX);
      expect(epoch).toBe(EPOCH);
      const threshold = await fixture.thresholdPolicy.mappings.threshold.get(THRESHOLD_INDEX);
      expect(threshold).toBe(THRESHOLD);
      // It is possible to call to initialize only one time
      await fixture.thresholdPolicy.initialize.rejected(
        fixture.admin,
        policies.threshold.blockHeightWindow,
        asSigner(fixture.admin),
      );
    }
  });

  test(`test update_role`, async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.thresholdPolicy.update_role.accepted(fixture.frozenAccount, MANAGER_ROLE, asSigner(fixture.admin));
    let role = await fixture.thresholdPolicy.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.thresholdPolicy.update_role.accepted(fixture.frozenAccount, NONE_ROLE, asSigner(fixture.admin));
    role = await fixture.thresholdPolicy.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.thresholdPolicy.update_role.rejected(
      fixture.frozenAccount,
      MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.thresholdPolicy.update_role.rejected(fixture.admin, NONE_ROLE, asSigner(fixture.admin));
  });

  test(`test update_block_height_window`, async () => {
    const fixture = state!;

    // only the admin can call update the block height window
    await fixture.thresholdPolicy.update_block_height_window.rejected(
      policies.threshold.blockHeightWindow,
      asSigner(fixture.frozenAccount),
    );

    await fixture.thresholdPolicy.update_block_height_window.accepted(
      policies.threshold.blockHeightWindow,
      asSigner(fixture.admin),
    );

    const blockHeightWindow = await fixture.thresholdPolicy.mappings.blockHeightWindow.get(BLOCK_HEIGHT_WINDOW_INDEX);
    expect(blockHeightWindow).toBe(policies.threshold.blockHeightWindow);
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

  test(`test signup`, async () => {
    const fixture = state!;

    const isAccountSigned = await fixture.thresholdPolicy.mappings.ownedStateRecord.getOrUse(fixture.account, false);
    expect(isAccountSigned).toBe(false);
    const isFrozenAccountSigned = await fixture.thresholdPolicy.mappings.ownedStateRecord.getOrUse(
      fixture.frozenAccount,
      false,
    );
    expect(isFrozenAccountSigned).toBe(false);
    let tx = await fixture.thresholdPolicy.signup.accepted(asSigner(fixture.account));
    fixture.accountStateRecord = await tx.outputs.decrypt(fixture.account);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(0n);
    expect(fixture.accountStateRecord.latest_block_height).toBe(0);
    tx = await fixture.thresholdPolicy.signup.accepted(asSigner(fixture.frozenAccount));
    fixture.frozenAccountStateRecord = await tx.outputs.decrypt(fixture.frozenAccount);
    expect(fixture.frozenAccountStateRecord.owner).toBe(fixture.frozenAccount.address);
    expect(fixture.frozenAccountStateRecord.cumulative_amount_per_epoch).toBe(0n);
    expect(fixture.frozenAccountStateRecord.latest_block_height).toBe(0);

    // If the user have already signed the tx will fail
    await fixture.thresholdPolicy.signup.rejected(asSigner(fixture.account));
  });

  test(`test signup_and_transfer_private function`, async () => {
    const fixture = state!;

    let isAccountSigned = await fixture.thresholdPolicy.mappings.ownedStateRecord.getOrUse(fixture.recipient, false);
    expect(isAccountSigned).toBe(false);

    const mintPrivateTx = await fixture.tokenRegistry.mint_private.accepted(
      tokenIdField,
      fixture.recipient,
      2n * amount,
      true,
      0,
      asSigner(fixture.admin),
    );
    let recipientRecord = await mintPrivateTx.outputs.decrypt(fixture.recipient);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    const tx = await fixture.thresholdPolicy.signup_and_transfer_private.accepted(
      fixture.account,
      amount,
      recipientRecord,
      latestBlockHeight,
      fixture.senderMerkleProof,
      asSigner(fixture.recipient),
    );

    isAccountSigned = await fixture.thresholdPolicy.mappings.ownedStateRecord.get(fixture.recipient);
    expect(isAccountSigned).toBe(true);

    const recipientStateRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientStateRecord.owner).toBe(fixture.recipient.address);
    expect(recipientStateRecord.cumulative_amount_per_epoch).toBe(amount);
    expect(recipientStateRecord.latest_block_height).toBe(latestBlockHeight);

    const previousAmount = recipientRecord.amount;

    recipientRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.recipient);
    const accountRecord = await tx.outputs[3]
      .match(TokenRegistry_Token.output.from("transfer_private", 1))
      .decrypt(fixture.account);

    expect(accountRecord.owner).toBe(fixture.account.address);
    expect(accountRecord.amount).toBe(amount);
    expect(accountRecord.token_id).toBe(tokenIdField);
    expect(accountRecord.external_authorization_required).toBe(true);
    expect(accountRecord.authorized_until).toBe(0);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.token_id).toBe(tokenIdField);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    if (recipientStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
      expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(fixture.recipient.address);
      expect(decryptedComplianceRecord.recipient).toBe(fixture.account.address);
    } else {
      await expect(tx.outputs[0].decrypt(fixture.investigator)).rejects.toThrow();
    }

    // If the user have already signed the tx will fail
    await fixture.thresholdPolicy.signup.rejected(asSigner(fixture.recipient));

    await fixture.thresholdPolicy.signup_and_transfer_private.rejected(
      fixture.account,
      amount,
      recipientRecord,
      latestBlockHeight,
      fixture.senderMerkleProof,
      asSigner(fixture.recipient),
    );
  });

  test(`test state record behavior`, async () => {
    const fixture = state!;

    const latestBlockHeight1 = await getLatestBlockHeight(fixture.ctx);
    let transferPublicTx = await fixture.thresholdPolicy.transfer_public_as_signer.accepted(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      latestBlockHeight1,
      asSigner(fixture.account),
    );
    fixture.accountStateRecord = await transferPublicTx.outputs.decrypt(fixture.account);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(amount);
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight1);

    const latestBlockHeight2 = await getLatestBlockHeight(fixture.ctx);
    let transferPrivateTx = await fixture.thresholdPolicy.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord,
      latestBlockHeight2,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );
    await expect(transferPrivateTx.outputs[0].decrypt(fixture.investigator)).rejects.toThrow();

    fixture.accountRecord = await transferPrivateTx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    let isTheSameEpoch = Math.floor(latestBlockHeight2 / EPOCH) === Math.floor(latestBlockHeight1 / EPOCH);
    fixture.accountStateRecord = await transferPrivateTx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(isTheSameEpoch ? amount * 2n : amount);
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight2);

    await fixture.thresholdPolicy.update_block_height_window.accepted(0, asSigner(fixture.admin));

    // the transaction will reject because the estimated block height is too low
    await fixture.thresholdPolicy.transfer_public_as_signer.rejected(
      fixture.recipient,
      amount,
      fixture.accountStateRecord,
      latestBlockHeight2 + 1,
      asSigner(fixture.account),
    );

    await fixture.thresholdPolicy.update_block_height_window.accepted(
      policies.threshold.blockHeightWindow,
      asSigner(fixture.admin),
    );

    const latestBlockHeight3 = await getLatestBlockHeight(fixture.ctx);
    transferPrivateTx = await fixture.thresholdPolicy.transfer_private.accepted(
      fixture.recipient,
      THRESHOLD + amount,
      fixture.accountRecord!,
      fixture.accountStateRecord,
      latestBlockHeight3,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );
    const decryptedComplianceRecord = await transferPrivateTx.outputs[0].decrypt(fixture.investigator);
    fixture.accountRecord = await transferPrivateTx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);

    isTheSameEpoch = Math.floor(latestBlockHeight3 / EPOCH) === Math.floor(latestBlockHeight2 / EPOCH);
    const previousCumulativeAmount = fixture.accountStateRecord.cumulative_amount_per_epoch;
    fixture.accountStateRecord = await transferPrivateTx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? previousCumulativeAmount + THRESHOLD + amount : THRESHOLD + amount,
    );
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight3);

    expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
    expect(decryptedComplianceRecord.amount).toBe(THRESHOLD + amount);
    expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
    expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test(`test transfer_public`, async () => {
    const fixture = state!;

    // If the sender didn't approve the program the tx will fail
    await fixture.thresholdPolicy.transfer_public.rejected(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      asSigner(fixture.account),
    );

    const approvalTx = await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      addressLiteral(policies.threshold.programAddress),
      amount,
      asSigner(fixture.account),
    );

    void approvalTx;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_public.rejected(
      fixture.recipient,
      amount,
      fixture.frozenAccountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      asSigner(fixture.account),
    );

    // If the estimated block height is too low the transaction will fail
    await fixture.thresholdPolicy.transfer_public.failsLocally(
      fixture.account,
      amount,
      fixture.accountStateRecord!,
      0,
      asSigner(fixture.account),
    );

    // If the estimated block height is too high the transaction will fail
    await fixture.thresholdPolicy.transfer_public.rejected(
      fixture.account,
      amount,
      fixture.accountStateRecord!,
      2 ** 32 - 1,
      asSigner(fixture.account),
    );

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    const tx = await fixture.thresholdPolicy.transfer_public.accepted(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      latestBlockHeight,
      asSigner(fixture.account),
    );
    const latestBlockHeightBefore = fixture.accountStateRecord!.latest_block_height;
    const cumulativeAmountBefore = fixture.accountStateRecord!.cumulative_amount_per_epoch;
    fixture.accountStateRecord = await tx.outputs.decrypt(fixture.account);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight);
  });

  test(`test transfer_public_as_signer`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_public_as_signer.rejected(
      fixture.recipient,
      amount,
      fixture.frozenAccountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_public_as_signer.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      asSigner(fixture.account),
    );

    // If the estimated block height is too low the transaction will fail
    await fixture.thresholdPolicy.transfer_public_as_signer.failsLocally(
      fixture.account,
      amount,
      fixture.accountStateRecord!,
      0,
      asSigner(fixture.account),
    );
    // If the estimated block height is too high the transaction will fail
    await fixture.thresholdPolicy.transfer_public_as_signer.rejected(
      fixture.account,
      amount,
      fixture.accountStateRecord!,
      2 ** 32 - 1,
      asSigner(fixture.account),
    );

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    const tx = await fixture.thresholdPolicy.transfer_public_as_signer.accepted(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      latestBlockHeight,
      asSigner(fixture.account),
    );
    const latestBlockHeightBefore = fixture.accountStateRecord!.latest_block_height;
    const cumulativeAmountBefore = fixture.accountStateRecord!.cumulative_amount_per_epoch;
    fixture.accountStateRecord = await tx.outputs.decrypt(fixture.account);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight);
  });

  test(`test transfer_public_to_priv`, async () => {
    const fixture = state!;

    // If the sender didn't approve the program the tx will fail
    await fixture.thresholdPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const approvalTx = await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      addressLiteral(policies.threshold.programAddress),
      amount,
      asSigner(fixture.account),
    );

    void approvalTx;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.frozenAccountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.recipientMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_public_to_priv.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.account),
    );

    // If the estimated block height is too low the transaction will fail
    await fixture.thresholdPolicy.transfer_public_to_priv.failsLocally(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      0,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.account),
    );

    // If the estimated block height is too high the transaction will fail
    await fixture.thresholdPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      2 ** 32 - 1,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    const tx = await fixture.thresholdPolicy.transfer_public_to_priv.accepted(
      fixture.recipient,
      amount,
      fixture.accountStateRecord!,
      latestBlockHeight,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const latestBlockHeightBefore = fixture.accountStateRecord!.latest_block_height;
    const cumulativeAmountBefore = fixture.accountStateRecord!.cumulative_amount_per_epoch;
    fixture.accountStateRecord = await tx.outputs[1].decrypt(fixture.account);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight);

    const recipientRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("transfer_from_public_to_private", 0))
      .decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);
    expect(recipientRecord.token_id).toBe(tokenIdField);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    if (fixture.accountStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
      expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
      expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
    } else {
      await expect(tx.outputs[0].decrypt(fixture.investigator)).rejects.toThrow();
    }
  });

  test(`test transfer_private`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_private.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.frozenAccountMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.frozenAccount),
    );
    // If the recipient is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_private.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.senderMerkleProof,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.account),
    );

    // If the estimated block height is too low the transaction will fail
    await fixture.thresholdPolicy.transfer_private.failsLocally(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      0,
      fixture.senderMerkleProof,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.account),
    );

    // If the estimated block height is too high the transaction will fail
    await fixture.thresholdPolicy.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      2 ** 32 - 1,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    const tx = await fixture.thresholdPolicy.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      latestBlockHeight,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      asSigner(fixture.account),
    );

    const latestBlockHeightBefore = fixture.accountStateRecord!.latest_block_height;
    const cumulativeAmountBefore = fixture.accountStateRecord!.cumulative_amount_per_epoch;
    fixture.accountStateRecord = await tx.outputs[1].decrypt(fixture.account);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight);

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    const recipientRecord = await tx.outputs[3]
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

    if (fixture.accountStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
      expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
      expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
    } else {
      await expect(tx.outputs[0].decrypt(fixture.investigator)).rejects.toThrow();
    }
  });

  test(`test transfer_priv_to_public`, async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_priv_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.thresholdPolicy.transfer_priv_to_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      await getLatestBlockHeight(fixture.ctx),
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    // If the estimated block height is too low the transaction will fail
    await fixture.thresholdPolicy.transfer_priv_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      0,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    // If the estimated block height is too high the transaction will fail
    await fixture.thresholdPolicy.transfer_priv_to_public.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      2 ** 32 - 1,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    const tx = await fixture.thresholdPolicy.transfer_priv_to_public.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.accountStateRecord!,
      latestBlockHeight,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    const latestBlockHeightBefore = fixture.accountStateRecord!.latest_block_height;
    const cumulativeAmountBefore = fixture.accountStateRecord!.cumulative_amount_per_epoch;
    fixture.accountStateRecord = await tx.outputs[1].decrypt(fixture.account);
    const isTheSameEpoch = Math.floor(latestBlockHeight / EPOCH) === Math.floor(latestBlockHeightBefore / EPOCH);
    expect(fixture.accountStateRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountStateRecord.cumulative_amount_per_epoch).toBe(
      isTheSameEpoch ? cumulativeAmountBefore + amount : amount,
    );
    expect(fixture.accountStateRecord.latest_block_height).toBe(latestBlockHeight);

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(fixture.accountRecord.token_id).toBe(tokenIdField);
    expect(fixture.accountRecord.external_authorization_required).toBe(true);
    expect(fixture.accountRecord.authorized_until).toBe(0);

    if (fixture.accountStateRecord.cumulative_amount_per_epoch > THRESHOLD) {
      const decryptedComplianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
      expect(decryptedComplianceRecord.owner).toBe(fixture.investigator.address);
      expect(decryptedComplianceRecord.amount).toBe(amount);
      expect(decryptedComplianceRecord.sender).toBe(fixture.account.address);
      expect(decryptedComplianceRecord.recipient).toBe(fixture.recipient.address);
    } else {
      await expect(tx.outputs[0].decrypt(fixture.investigator)).rejects.toThrow();
    }
  });
});
