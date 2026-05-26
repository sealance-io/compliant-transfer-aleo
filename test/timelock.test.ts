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
  SETUP_TIMEOUT_MS,
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
      (await freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX)) !== null;
    if (!isFreezeRegistryInitialized) {
      await freezeRegistry.initialize.accepted(
        {
          admin,
          blocks: BLOCK_HEIGHT_WINDOW,
        },
        asSigner(deployer),
      );
    }

    const role = (await freezeRegistry.getAddress_to_role(admin)) as number;
    if ((role & FREEZELIST_MANAGER_ROLE) !== FREEZELIST_MANAGER_ROLE) {
      await freezeRegistry.update_role.accepted(
        {
          new_address: admin,
          role: MANAGER_ROLE + FREEZELIST_MANAGER_ROLE,
        },
        asSigner(admin),
      );
    }

    const isAccountFrozen = await freezeRegistry.getFreeze_list(frozenAccount);
    if (!isAccountFrozen) {
      const currentRoot = await freezeRegistry.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      await freezeRegistry.update_freeze_list.accepted(
        {
          account: frozenAccount,
          is_frozen: true,
          frozen_index: 1,
          previous_root: currentRoot!,
          new_root: fieldLiteral(root),
        },
        asSigner(admin),
      );
    }

    await freezeRegistry.update_block_height_window.accepted(
      {
        blocks: 300,
      },
      asSigner(admin),
    );

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
}, SETUP_TIMEOUT_MS);

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
      (await fixture.timelockPolicy.getFreeze_registry_program_name(FREEZE_REGISTRY_PROGRAM_INDEX)) !== null;
    if (!isInitialized) {
      if (fixture.deployer.address !== fixture.admin.address) {
        // The caller is not the initial admin
        await fixture.timelockPolicy.initialize.rejected({ admin: fixture.admin }, asSigner(fixture.deployer));
      }

      await fixture.timelockPolicy.initialize.accepted({ admin: fixture.admin }, asSigner(fixture.admin));

      const role = await fixture.timelockPolicy.getAddress_to_role(fixture.admin);
      expect(role).toBe(MANAGER_ROLE);

      // It is possible to call to initialize only one time
      await fixture.timelockPolicy.initialize.rejected({ admin: fixture.admin }, asSigner(fixture.admin));
    }
  });

  test(`test update_role`, async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.timelockPolicy.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
      },
      asSigner(fixture.admin),
    );
    let role = await fixture.timelockPolicy.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.timelockPolicy.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: NONE_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.timelockPolicy.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.timelockPolicy.update_role.rejected(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update minter role
    await fixture.timelockPolicy.update_role.rejected(
      {
        new_address: fixture.minter,
        role: MINTER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.timelockPolicy.update_role.rejected(
      {
        new_address: fixture.admin,
        role: NONE_ROLE,
      },
      asSigner(fixture.admin),
    );

    // Manager can assign freeze list manager role
    await fixture.timelockPolicy.update_role.accepted(
      {
        new_address: fixture.minter,
        role: MINTER_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.timelockPolicy.getAddress_to_role(fixture.minter);
    expect(role).toBe(MINTER_ROLE);
  });

  test("test minting functionality", async () => {
    const fixture = state!;

    let mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.account);

    mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      {
        recipient: fixture.frozenAccount,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.frozenAccountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.frozenAccount);

    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    fixture.accountRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.frozenAccount,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.frozenAccountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.frozenAccount);
    fixture.frozenAccountRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.frozenAccount);

    // Only the minter call mint
    await fixture.timelockPolicy.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.frozenAccount),
    );
    await fixture.timelockPolicy.mint_private.rejected(
      {
        recipient: fixture.frozenAccount,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.frozenAccount),
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

  test(`test transfer_public`, async () => {
    const fixture = state!;
    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender didn't approve the program the tx will fail
    await fixture.timelockPolicy.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight + 1,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      {
        token_id: tokenIdField,
        spender: addressLiteral(policies.timelock.programAddress),
        amount,
      },
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.frozenAccountSealedRecord2!,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight + 1,
      },
      asSigner(fixture.account),
    );

    // Sending tokens to the recipient with a long timelock, should succeed
    let tx = await fixture.timelockPolicy.transfer_public.accepted(
      {
        recipient: fixture.recipient,
        amount: amount - 1n,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight + 100,
      },
      asSigner(fixture.account),
    );
    fixture.accountSealedRecord = await tx.outputs[0].decrypt(fixture.account);
    const recipientSealedRecord = await tx.outputs[1].decrypt(fixture.recipient);

    // cannot send tokens before the timelock expires
    await fixture.timelockPolicy.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount: amount - 1n,
        sealed_token: recipientSealedRecord,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.recipient),
    );

    // cannot send a different amount of tokens then in sealed token
    await fixture.timelockPolicy.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount: 1n + 1n,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    // can send the the remaining amounts
    tx = await fixture.timelockPolicy.transfer_public.accepted(
      {
        recipient: fixture.recipient,
        amount: 1n,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight + 1,
      },
      asSigner(fixture.account),
    );
    await tx.outputs[0].decrypt(fixture.account);
  });

  test(`test transfer_public_as_signer`, async () => {
    const fixture = state!;

    console.log("test transfer_public_as_signer 0");
    await fixture.timelockPolicy.mint_public.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    console.log("test transfer_public_as_signer 1");

    const mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      {
        recipient: fixture.account,
        amount,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.account);
    console.log("test transfer_public_as_signer 2");

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    console.log("test transfer_public_as_signer 3");

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_as_signer.rejected(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.frozenAccountSealedRecord!,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.frozenAccount),
    );
    console.log("test transfer_public_as_signer 4");

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_as_signer.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );
    console.log("test transfer_public_as_signer 5");
    // Integer subtraction failed on: 10u128 and 11u128
    // cannot send tokens with the smaller amount in the sealed record
    await fixture.timelockPolicy.transfer_public_as_signer.failsLocally(
      {
        recipient: fixture.recipient,
        amount: amount + 1n,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );
    console.log("test transfer_public_as_signer 6");

    await fixture.timelockPolicy.transfer_public_as_signer.accepted(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );
    console.log("test transfer_public_as_signer 7");
  });

  test.skip(`test transfer_public_to_priv`, async () => {
    const fixture = state!;

    await fixture.timelockPolicy.mint_public.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );

    const mintPublicTx = await fixture.timelockPolicy.mint_public.accepted(
      {
        recipient: fixture.account,
        amount,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPublicTx.outputs.decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender didn't approve the program the tx will fail
    await fixture.timelockPolicy.transfer_public_to_priv.rejected(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    await fixture.tokenRegistry.approve_public.accepted(
      {
        token_id: tokenIdField,
        spender: addressLiteral(policies.timelock.programAddress),
        amount,
      },
      asSigner(fixture.account),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_to_priv.rejected(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.frozenAccountSealedRecord!,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_public_to_priv.failsLocally(
      {
        recipient: fixture.frozenAccount,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        recipient_merkle_proofs: fixture.frozenAccountMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    // cannot send tokens with the smaller amount in the sealed record
    await fixture.timelockPolicy.transfer_public_to_priv.failsLocally(
      {
        recipient: fixture.recipient,
        amount: amount + 1n,
        sealed_token: fixture.accountSealedRecord!,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    const largeBlockHeight = 2 ** 32 - 1; // Max u32
    const change = 1n;
    const amountToSend = amount - change;
    const tx = await fixture.timelockPolicy.transfer_public_to_priv.accepted(
      {
        recipient: fixture.recipient,
        amount: amountToSend,
        sealed_token: fixture.accountSealedRecord!,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: largeBlockHeight,
      },
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

  test.skip(`test transfer_private`, async () => {
    const fixture = state!;

    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    fixture.accountRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 10n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    const accountRecord2 = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_private.failsLocally(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.frozenAccountSealedRecord!,
        base_token: fixture.frozenAccountRecord!,
        sender_merkle_proofs: fixture.frozenAccountMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_private.failsLocally(
      {
        recipient: fixture.frozenAccount,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        base_token: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.frozenAccountMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    const largeBlockHeight = 2 ** 32 - 1; // Max u32
    const change = 1n;
    const amountToSend = fixture.accountRecord!.amount - change;

    // cannot send amount larger than in sealed token
    await fixture.timelockPolicy.transfer_private.failsLocally(
      {
        recipient: fixture.recipient,
        amount: accountRecord2.amount + 1n,
        sealed_token: fixture.accountSealedRecord2!,
        base_token: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: largeBlockHeight,
      },
      asSigner(fixture.account),
    );

    // cannot send a different amount in base token than in sealed token
    await fixture.timelockPolicy.transfer_private.failsLocally(
      {
        recipient: fixture.recipient,
        amount: fixture.accountRecord!.amount,
        sealed_token: fixture.accountSealedRecord2!,
        base_token: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: largeBlockHeight,
      },
      asSigner(fixture.account),
    );

    let tx = await fixture.timelockPolicy.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount: amountToSend,
        sealed_token: fixture.accountSealedRecord!,
        base_token: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: largeBlockHeight,
      },
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
      {
        recipient: fixture.account,
        amount: amountToSend,
        sealed_token: recipientSealedRecord,
        base_token: recipientRecord,
        sender_merkle_proofs: fixture.recipientMerkleProof,
        recipient_merkle_proofs: fixture.senderMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.recipient),
    );

    // can send the remaining amount
    tx = await fixture.timelockPolicy.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount: change,
        sealed_token: fixture.accountSealedRecord!,
        base_token: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.recipientMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );
    await tx.outputs[0].decrypt(fixture.account);
  });

  test.skip(`test transfer_priv_to_public`, async () => {
    const fixture = state!;

    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    const accountTokenRecord2 = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    fixture.accountSealedRecord = await mintPrivateTx.outputs[0].decrypt(fixture.account);
    let accountTokenRecord = await mintPrivateTx.outputs[1]
      .match(TokenRegistry_Token.output.from("mint_private", 0))
      .decrypt(fixture.account);

    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);

    // If the sender is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_priv_to_public.failsLocally(
      {
        recipient: fixture.recipient,
        amount,
        sealed_token: fixture.frozenAccountSealedRecord!,
        base_token: fixture.frozenAccountRecord!,
        sender_merkle_proofs: fixture.frozenAccountMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.timelockPolicy.transfer_priv_to_public.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
        sealed_token: fixture.accountSealedRecord!,
        base_token: accountTokenRecord,
        sender_merkle_proofs: fixture.senderMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    // cannot send tokens with the smaller amount in the sealed record
    await fixture.timelockPolicy.transfer_priv_to_public.failsLocally(
      {
        recipient: fixture.recipient,
        amount: amount + 1n,
        sealed_token: fixture.accountSealedRecord!,
        base_token: accountTokenRecord2,
        sender_merkle_proofs: fixture.senderMerkleProof,
        lock_until: latestBlockHeight,
      },
      asSigner(fixture.account),
    );

    const largeBlockHeight = 2 ** 32 - 1; // Max u32
    const change = 1n;
    const amountToSend = accountTokenRecord.amount - change;

    let tx = await fixture.timelockPolicy.transfer_priv_to_public.accepted(
      {
        recipient: fixture.recipient,
        amount: amountToSend,
        sealed_token: fixture.accountSealedRecord!,
        base_token: accountTokenRecord,
        sender_merkle_proofs: fixture.senderMerkleProof,
        lock_until: largeBlockHeight,
      },
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

    // Send the remaining amount to account using large blockheight
    // and verify that account cannot call transfer_priv_to_public with it
    const tx2 = await fixture.timelockPolicy.transfer_private.accepted(
      {
        recipient: fixture.account,
        amount: change,
        sealed_token: fixture.accountSealedRecord!,
        base_token: accountTokenRecord,
        sender_merkle_proofs: fixture.senderMerkleProof,
        recipient_merkle_proofs: fixture.senderMerkleProof,
        lock_until: largeBlockHeight,
      },
      asSigner(fixture.account),
    );

    accountTokenRecord = await tx2.outputs[3]
      .match(TokenRegistry_Token.output.from("transfer_private", 1))
      .decrypt(fixture.account);
    fixture.accountSealedRecord = await tx2.outputs[1].decrypt(fixture.account);

    await fixture.timelockPolicy.transfer_priv_to_public.rejected(
      {
        recipient: fixture.recipient,
        amount: change,
        sealed_token: fixture.accountSealedRecord!,
        base_token: accountTokenRecord,
        sender_merkle_proofs: fixture.senderMerkleProof,
        lock_until: largeBlockHeight,
      },
      asSigner(fixture.account),
    );
  });

  test.skip(`test join`, async () => {
    const fixture = state!;

    // create new records
    const lockedUntil = Math.floor(Math.random() * 2 ** 32);
    let mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount,
        lock_until: lockedUntil,
      },
      asSigner(fixture.minter),
    );
    const lockedAccountSealedRecord = await mintPrivateTx.outputs[0].decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 2n,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    const unlockedAccountSealedRecord1 = await mintPrivateTx.outputs[0].decrypt(fixture.account);

    mintPrivateTx = await fixture.timelockPolicy.mint_private.accepted(
      {
        recipient: fixture.account,
        amount,
        lock_until: 0,
      },
      asSigner(fixture.minter),
    );
    const unlockedAccountSealedRecord2 = await mintPrivateTx.outputs[0].decrypt(fixture.account);

    let tx = await fixture.timelockPolicy.join.accepted(
      {
        sealed_token_1: unlockedAccountSealedRecord1,
        sealed_token_2: unlockedAccountSealedRecord2,
      },
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
      {
        sealed_token_1: fixture.accountSealedRecord!,
        sealed_token_2: lockedAccountSealedRecord,
      },
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
