import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { buildTree, generateLeaves, getLeafIndices, getSiblingPath } from "@sealance-io/policy-engine-aleo";

import {
  BLOCK_HEIGHT_WINDOW,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_REGISTRY_PROGRAM_INDEX,
  FREEZELIST_MANAGER_ROLE,
  fundedAmount,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  MINTER_ROLE,
  NONE_ROLE,
  policies,
} from "../lib/Constants.js";
import { getLatestBlockHeight } from "../lib/Block.js";
import { fundWithCredits } from "../lib/Fund.js";
import { addressLiteral, asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";
import {
  createSealedTimelockPolicy,
  TokenRegistry_Token,
  type CompliantToken,
} from "../typechain/SealedTimelockPolicy.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import { createTokenRegistry, type Token } from "../typechain/TokenRegistry.js";

const amount = 10n;
const tokenIdField = fieldLiteral(policies.timelock.tokenId);

interface TimelockFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly recipient: SignableNamedAccount;
  readonly minter: SignableNamedAccount;
  readonly tokenRegistry: ReturnType<typeof createTokenRegistry>;
  readonly timelockPolicy: ReturnType<typeof createSealedTimelockPolicy>;
  readonly freezeRegistry: ReturnType<typeof createSealanceFreezelistRegistry>;
  readonly senderMerkleProof: MerkleProof[];
  readonly recipientMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
  accountRecord?: Token;
  accountSealedRecord?: CompliantToken;
  accountSealedRecord2?: CompliantToken;
  frozenAccountRecord?: Token;
  frozenAccountSealedRecord?: CompliantToken;
  frozenAccountSealedRecord2?: CompliantToken;
}

async function deployFixture() {
  const ctx = await setup();

  try {
    const deployer = ctx.named.signer("deployer");
    const admin = ctx.named.signer("admin");
    const frozenAccount = ctx.named.signer("frozenAccount");
    const account = ctx.named.signer("account");
    const recipient = ctx.named.signer("recipient");
    const minter = ctx.named.signer("minter");

    for (const signer of [admin, frozenAccount, account, recipient, minter]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const tokenRegistry = createTokenRegistry().connect(ctx.lre);
    const timelockPolicy = createSealedTimelockPolicy().connect(ctx.lre);
    const freezeRegistry = createSealanceFreezelistRegistry().connect(ctx.lre);

    for (const program of [
      "token_registry",
      "merkle_tree",
      "multisig_core",
      "sealance_freezelist_registry",
      "sealed_timelock_policy",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;
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
        fieldLiteral(root),
        asSigner(admin),
      );
    }

    await freezeRegistry.update_block_height_window.accepted(300, asSigner(admin));

    return {
      ctx,
      deployer,
      admin,
      frozenAccount,
      account,
      recipient,
      minter,
      tokenRegistry,
      timelockPolicy,
      freezeRegistry,
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
    } satisfies TimelockFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: TimelockFixture | undefined;

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

describe("test sealed_timelock_policy program", () => {
  test(`test initialize`, async () => {
    const fixture = state!;

    const isInitialized =
      await fixture.timelockPolicy.mappings.freezeRegistryProgramName.contains(FREEZE_REGISTRY_PROGRAM_INDEX);
    if (!isInitialized) {
      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.timelockPolicy.initialize.rejected(fixture.admin, asSigner(fixture.deployer));
      }

      await fixture.timelockPolicy.initialize.accepted(fixture.admin, asSigner(fixture.admin));

      const role = await fixture.timelockPolicy.mappings.addressToRole.get(fixture.admin);
      expect(role).toBe(MANAGER_ROLE);

      // It is possible to call to initialize only one time
      await fixture.timelockPolicy.initialize.rejected(fixture.admin, asSigner(fixture.admin));
    }
  });

  test(`test update_role`, async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.timelockPolicy.update_role.accepted(fixture.frozenAccount, MANAGER_ROLE, asSigner(fixture.admin));
    let role = await fixture.timelockPolicy.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.timelockPolicy.update_role.accepted(fixture.frozenAccount, NONE_ROLE, asSigner(fixture.admin));
    role = await fixture.timelockPolicy.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.timelockPolicy.update_role.rejected(
      fixture.frozenAccount,
      MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update minter role
    await fixture.timelockPolicy.update_role.rejected(fixture.minter, MINTER_ROLE, asSigner(fixture.frozenAccount));

    // Manager cannot unassign himself from being a manager
    await fixture.timelockPolicy.update_role.rejected(fixture.admin, NONE_ROLE, asSigner(fixture.admin));

    // Manager can assign freeze list manager role
    await fixture.timelockPolicy.update_role.accepted(fixture.minter, MINTER_ROLE, asSigner(fixture.admin));
    role = await fixture.timelockPolicy.mappings.addressToRole.get(fixture.minter);
    expect(role).toBe(MINTER_ROLE);
  });

  test("test minting functionality", async () => {
    const fixture = state!;

    let mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      fixture.account,
      amount * 20n,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.account);

    mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      fixture.frozenAccount,
      amount * 20n,
      0,
      asSigner(fixture.minter),
    );
    fixture.frozenAccountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.frozenAccount);

    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount * 20n,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    fixture.accountRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.frozenAccount,
      amount * 20n,
      0,
      asSigner(fixture.minter),
    );
    fixture.frozenAccountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.frozenAccount);
    fixture.frozenAccountRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.frozenAccount);

    // Only the minter call mint
    await fixture.timelockPolicy.mint_public.rejected(
      fixture.account,
      amount * 20n,
      0,
      asSigner(fixture.frozenAccount),
    );
    await fixture.timelockPolicy.mint_private.rejected(
      fixture.frozenAccount,
      amount * 20n,
      0,
      asSigner(fixture.frozenAccount),
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

  test(`test transfer_public`, async () => {
    const fixture = state!;
    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender didn't approve the program the tx will fail
    await fixture.timelockPolicy.transfer_public.rejected(
      fixture.recipient,
      amount,
      fixture.accountSealedRecord!,
      latestBlockHeight + 1,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      addressLiteral(policies.timelock.programAddress),
      amount,
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public.rejected(
      fixture.recipient,
      amount,
      fixture.frozenAccountSealedRecord2!,
      latestBlockHeight,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountSealedRecord!,
      latestBlockHeight + 1,
      asSigner(fixture.account),
    );

    // cannot send more tokens than the sealed record amount
    await fixture.timelockPolicy.transfer_public.failsLocally(
      fixture.recipient,
      fixture.accountSealedRecord!.amount + 1n,
      fixture.accountSealedRecord!,
      latestBlockHeight + 100,
      asSigner(fixture.account),
    );

    // Sending tokens to the recipient with a long timelock, should succeed
    let tx = await fixture.timelockPolicy.transfer_public.accepted(
      fixture.recipient,
      amount - 1n,
      fixture.accountSealedRecord!,
      latestBlockHeight + 100,
      asSigner(fixture.account),
    );
    fixture.accountSealedRecord = await tx.outputs[0].decrypt(fixture.account);
    const recipientSealedRecord = await tx.outputs[1].decrypt(fixture.recipient);

    // cannot send tokens before the timelock expires
    await fixture.timelockPolicy.transfer_public.rejected(
      fixture.recipient,
      amount - 1n,
      recipientSealedRecord,
      latestBlockHeight,
      asSigner(fixture.recipient),
    );

    // cannot send a different amount of tokens then in sealed token
    await fixture.timelockPolicy.transfer_public.rejected(
      fixture.recipient,
      1n + 1n,
      fixture.accountSealedRecord!,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    // can send the the remaining amounts
    tx = await fixture.timelockPolicy.transfer_public.accepted(
      fixture.recipient,
      1n,
      fixture.accountSealedRecord!,
      latestBlockHeight + 1,
      asSigner(fixture.account),
    );
    await tx.outputs[0].decrypt(fixture.account);
  });

  test(`test transfer_public_as_signer`, async () => {
    const fixture = state!;

    await fixture.timelockPolicy.mint_public.accepted(fixture.account, amount * 20n, 0, asSigner(fixture.minter));

    const mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      fixture.account,
      amount,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_as_signer.rejected(
      fixture.recipient,
      amount,
      fixture.frozenAccountSealedRecord!,
      latestBlockHeight,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_as_signer.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountSealedRecord!,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    // cannot send more tokens than the sealed record amount
    await fixture.timelockPolicy.transfer_public.failsLocally(
      fixture.recipient,
      fixture.accountSealedRecord!.amount + 1n,
      fixture.accountSealedRecord!,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    await fixture.timelockPolicy.transfer_public_as_signer.accepted(
      fixture.recipient,
      amount,
      fixture.accountSealedRecord!,
      latestBlockHeight,
      asSigner(fixture.account),
    );
  });

  test(`test transfer_public_to_priv`, async () => {
    const fixture = state!;

    await fixture.timelockPolicy.mint_public.accepted(fixture.account, amount * 20n, 0, asSigner(fixture.minter));

    const mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      fixture.account,
      amount,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender didn't approve the program the tx will fail
    await fixture.timelockPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.accountSealedRecord!,
      fixture.recipientMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      tokenIdField,
      addressLiteral(policies.timelock.programAddress),
      amount,
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_to_priv.rejected(
      fixture.recipient,
      amount,
      fixture.frozenAccountSealedRecord!,
      fixture.recipientMerkleProof,
      latestBlockHeight,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_to_priv.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.accountSealedRecord!,
      fixture.frozenAccountMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    // cannot send more tokens than the sealed record amount
    await fixture.timelockPolicy.transfer_public_to_priv.failsLocally(
      fixture.recipient,
      amount + 1n,
      fixture.accountSealedRecord!,
      fixture.recipientMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    const largeBlockHeight = 2 ** 32 - 1; // Max u32
    const change = 1n;
    const amountToSend = amount - change;
    const tx = await fixture.timelockPolicy.transfer_public_to_priv.accepted(
      fixture.recipient,
      amountToSend,
      fixture.accountSealedRecord!,
      fixture.recipientMerkleProof,
      largeBlockHeight,
      asSigner(fixture.account),
    );

    const recipientRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("transfer_from_public_to_private", 0))
      .decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amountToSend);
    expect(recipientRecord.token_id).toBe(tokenIdField);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    fixture.accountSealedRecord = await tx.outputs[0].decrypt(fixture.account);
    expect(fixture.accountSealedRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountSealedRecord.amount).toBe(change);
    expect(fixture.accountSealedRecord.locked_until).toBe(0);

    const recipientSealedRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientSealedRecord.owner).toBe(fixture.recipient.address);
    expect(recipientSealedRecord.amount).toBe(amountToSend);
    expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);
  });

  test(`test transfer_private`, async () => {
    const fixture = state!;

    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount * 20n,
      0,
      asSigner(fixture.minter),
    );

    fixture.accountSealedRecord = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    fixture.accountRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount * 10n,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    const accountRecord2 = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_private.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountSealedRecord!,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      fixture.recipientMerkleProof,
      latestBlockHeight,
      asSigner(fixture.frozenAccount),
    );
    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_private.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.accountSealedRecord!,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.frozenAccountMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    const largeBlockHeight = 2 ** 32 - 1; // Max u32
    const change = 1n;
    const amountToSend = fixture.accountRecord!.amount - change;

    // cannot send more tokens than the sealed record amount
    await fixture.timelockPolicy.transfer_private.failsLocally(
      fixture.recipient,
      fixture.accountSealedRecord2.amount + 1n,
      fixture.accountSealedRecord2!,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      largeBlockHeight,
      asSigner(fixture.account),
    );

    let tx = await fixture.timelockPolicy.transfer_private.accepted(
      fixture.recipient,
      amountToSend,
      fixture.accountSealedRecord!,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      largeBlockHeight,
      asSigner(fixture.account),
    );

    fixture.accountRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(change);
    expect(fixture.accountRecord.token_id).toBe(tokenIdField);
    expect(fixture.accountRecord.external_authorization_required).toBe(true);
    expect(fixture.accountRecord.authorized_until).toBe(0);

    const recipientRecord = await tx.outputs[3]
      .match(TokenRegistry_Token.output.from("transfer_private", 1))
      .decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amountToSend);
    expect(recipientRecord.token_id).toBe(tokenIdField);
    expect(recipientRecord.external_authorization_required).toBe(true);
    expect(recipientRecord.authorized_until).toBe(0);

    fixture.accountSealedRecord = await tx.outputs[0].decrypt(fixture.account);
    expect(fixture.accountSealedRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountSealedRecord.amount).toBe(change);
    expect(fixture.accountSealedRecord.locked_until).toBe(0);

    const recipientSealedRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientSealedRecord.owner).toBe(fixture.recipient.address);
    expect(recipientSealedRecord.amount).toBe(amountToSend);
    expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);

    // cannot send tokens before the timelock expires
    await fixture.timelockPolicy.transfer_private.rejected(
      fixture.account,
      amountToSend,
      recipientSealedRecord,
      recipientRecord,
      fixture.recipientMerkleProof,
      fixture.senderMerkleProof,
      latestBlockHeight,
      asSigner(fixture.recipient),
    );

    // can send the remaining amount
    tx = await fixture.timelockPolicy.transfer_private.accepted(
      fixture.recipient,
      change,
      fixture.accountSealedRecord!,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      fixture.recipientMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );
  });

  test(`test transfer_priv_to_public`, async () => {
    const fixture = state!;

    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount * 20n,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    const accountTokenRecord2 = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount,
      0,
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    let accountTokenRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_priv_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountSealedRecord!,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      latestBlockHeight,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_priv_to_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountSealedRecord!,
      accountTokenRecord,
      fixture.senderMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    // cannot send more tokens than the sealed record amount
    await fixture.timelockPolicy.transfer_priv_to_public.failsLocally(
      fixture.recipient,
      amount + 1n,
      fixture.accountSealedRecord!,
      accountTokenRecord2,
      fixture.senderMerkleProof,
      latestBlockHeight,
      asSigner(fixture.account),
    );

    const largeBlockHeight = 2 ** 32 - 1; // Max u32
    const change = 1n;
    const amountToSend = accountTokenRecord.amount - change;

    let tx = await fixture.timelockPolicy.transfer_priv_to_public.accepted(
      fixture.recipient,
      amountToSend,
      fixture.accountSealedRecord!,
      accountTokenRecord,
      fixture.senderMerkleProof,
      largeBlockHeight,
      asSigner(fixture.account),
    );

    accountTokenRecord = await tx.outputs[2]
      .match(TokenRegistry_Token.output.from("prehook_private", 0))
      .decrypt(fixture.account);
    expect(accountTokenRecord.owner).toBe(fixture.account.address);
    expect(accountTokenRecord.amount).toBe(change);
    expect(accountTokenRecord.token_id).toBe(tokenIdField);
    expect(accountTokenRecord.external_authorization_required).toBe(true);
    expect(accountTokenRecord.authorized_until).toBe(0);

    fixture.accountSealedRecord = await tx.outputs[0].decrypt(fixture.account);
    expect(fixture.accountSealedRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountSealedRecord.amount).toBe(change);
    expect(fixture.accountSealedRecord.locked_until).toBe(0);

    const recipientSealedRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientSealedRecord.owner).toBe(fixture.recipient.address);
    expect(recipientSealedRecord.amount).toBe(amountToSend);
    expect(recipientSealedRecord.locked_until).toBe(largeBlockHeight);

    // Send the remaining amount to account using large block height
    // and verify that account cannot call transfer_priv_to_public with it
    const tx2 = await fixture.timelockPolicy.transfer_private.accepted(
      fixture.account,
      change,
      fixture.accountSealedRecord!,
      accountTokenRecord,
      fixture.senderMerkleProof,
      fixture.senderMerkleProof,
      largeBlockHeight,
      asSigner(fixture.account),
    );

    accountTokenRecord = await tx2.outputs[3]
      .match(TokenRegistry_Token.output.from("transfer_private", 1))
      .decrypt(fixture.account);
    fixture.accountSealedRecord = await tx2.outputs[1].decrypt(fixture.account);

    await fixture.timelockPolicy.transfer_priv_to_public.rejected(
      fixture.recipient,
      change,
      fixture.accountSealedRecord!,
      accountTokenRecord,
      fixture.senderMerkleProof,
      largeBlockHeight,
      asSigner(fixture.account),
    );
  });

  test(`test join`, async () => {
    const fixture = state!;

    // create new records
    const lockedUntil = Math.floor(Math.random() * 2 ** 32);
    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount,
      lockedUntil,
      asSigner(fixture.minter),
    );
    const lockedAccountSealedRecord = await mintPrivateTx.outputs[0].decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount * 2n,
      0,
      asSigner(fixture.minter),
    );
    const unlockedAccountSealedRecord1 = await mintPrivateTx.outputs[0].decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      fixture.account,
      amount,
      0,
      asSigner(fixture.minter),
    );
    const unlockedAccountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);

    let tx = await fixture.timelockPolicy.join.accepted(
      unlockedAccountSealedRecord1,
      unlockedAccountSealedRecord2,
      asSigner(fixture.account),
    );
    fixture.accountSealedRecord = await tx.outputs.decrypt(fixture.account);
    expect(fixture.accountSealedRecord.owner).toBe(unlockedAccountSealedRecord1.owner);
    expect(fixture.accountSealedRecord.owner).toBe(unlockedAccountSealedRecord2.owner);
    expect(fixture.accountSealedRecord.amount).toBe(
      unlockedAccountSealedRecord1.amount + unlockedAccountSealedRecord2.amount,
    );
    expect(fixture.accountSealedRecord.locked_until).toBe(0);

    tx = await fixture.timelockPolicy.join.accepted(
      fixture.accountSealedRecord!,
      lockedAccountSealedRecord,
      asSigner(fixture.account),
    );
    fixture.accountSealedRecord = await tx.outputs.decrypt(fixture.account);
    expect(fixture.accountSealedRecord.owner).toBe(unlockedAccountSealedRecord1.owner);
    expect(fixture.accountSealedRecord.owner).toBe(lockedAccountSealedRecord.owner);
    expect(fixture.accountSealedRecord.amount).toBe(
      unlockedAccountSealedRecord1.amount + unlockedAccountSealedRecord2.amount + lockedAccountSealedRecord.amount,
    );
    expect(fixture.accountSealedRecord.locked_until).toBe(lockedAccountSealedRecord.locked_until);
  });
});
