import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import {
  buildTree,
  generateLeaves,
  getLeafIndices,
  getSiblingPath,
  stringToBigInt,
  ZERO_ADDRESS,
} from "@sealance-io/policy-engine-aleo";

import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZE_LIST_LAST_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  MINTER_ROLE,
  NONE_ROLE,
  PREVIOUS_FREEZE_LIST_ROOT_INDEX,
  emptyRoot,
  fundedAmount,
  zeroAddress,
  emptyRootField,
  SETUP_TIMEOUT_MS,
  maxSupply,
  decimals,
  amount,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { Leo } from "../typechain/BaseContract.js";
import { createSealedReportToken, type Token } from "../typechain/SealedReportToken.js";
import type { MerkleProof } from "../typechain/MerkleTree.js";
import { safeAddress } from "./utils/Accounts.js";

const tokenName = stringToBigInt("Report Token");
const tokenSymbol = stringToBigInt("REPORT_TOKEN");

interface ReportTokenFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly investigator: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly recipient: SignableNamedAccount;
  readonly minter: SignableNamedAccount;
  readonly burner: SignableNamedAccount;
  readonly supplyManager: SignableNamedAccount;
  readonly spender: SignableNamedAccount;
  readonly freezeListManager: SignableNamedAccount;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly senderMerkleProof: MerkleProof[];
  readonly recipientMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
  readonly token: ReturnType<typeof createSealedReportToken>;
  accountRecord?: Token;
  frozenAccountRecord?: Token;
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
    const minter = ctx.named.signer("minter");
    const burner = ctx.named.signer("burner");
    const supplyManager = ctx.named.signer("supplyManager");
    const spender = ctx.named.signer("spender");
    const freezeListManager = ctx.named.signer("freezeListManager");

    for (const signer of [admin, frozenAccount, account, freezeListManager, minter, supplyManager, burner, spender]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const token = createSealedReportToken().connect(ctx.lre);

    for (const program of ["multisig_core", "merkle_tree", "sealed_report_token"]) {
      await ctx.deploy(program, { noCompile: true });
    }

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;

    const senderLeafIndices = getLeafIndices(tree, account.address);
    const recipientLeafIndices = getLeafIndices(tree, recipient.address);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount.address);

    const rootField = fieldLiteral(root);
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

    return {
      ctx,
      deployer,
      admin,
      investigator,
      frozenAccount,
      account,
      recipient,
      minter,
      burner,
      supplyManager,
      spender,
      freezeListManager,
      token,
      rootField,
      senderMerkleProof,
      recipientMerkleProof,
      frozenAccountMerkleProof,
    } satisfies ReportTokenFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: ReportTokenFixture | undefined;

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

describe("test sealed_report_token program", () => {
  test("test initialize", async () => {
    const fixture = state!;
    const initializeArgs = {
      name: tokenName,
      symbol: tokenSymbol,
      decimals,
      max_supply: maxSupply,
      admin: fixture.admin,
      blocks: BLOCK_HEIGHT_WINDOW,
    };

    const currentRoot = await fixture.token.mappings.freezeListRoot.getOrUse(
      CURRENT_FREEZE_LIST_ROOT_INDEX,
      emptyRootField,
    );
    // Cannot update freeze list before initialization
    await fixture.token.update_freeze_list.rejected(
      fixture.frozenAccount,
      true,
      1,
      currentRoot!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    if (fixture.deployer.address !== fixture.admin.address) {
      // The caller is not the initial admin
      await fixture.token.initialize.rejected(
        tokenName,
        tokenSymbol,
        decimals,
        maxSupply,
        fixture.admin,
        BLOCK_HEIGHT_WINDOW,
        asSigner(fixture.deployer),
      );
    }

    await fixture.token.initialize.accepted(
      tokenName,
      tokenSymbol,
      decimals,
      maxSupply,
      fixture.admin,
      BLOCK_HEIGHT_WINDOW,
      asSigner(fixture.admin),
    );

    const initializedTokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    const isAccountFrozen = await fixture.token.mappings.freezeList.get(zeroAddress);
    const frozenAccountByIndex = await fixture.token.mappings.freezeListIndex.get(0);
    const lastIndex = await fixture.token.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);
    const initializedRoot = await fixture.token.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const blockHeightWindow = await fixture.token.mappings.blockHeightWindow.get(BLOCK_HEIGHT_WINDOW_INDEX);
    const role = await fixture.token.mappings.addressToRole.get(fixture.admin);

    expect(initializedTokenInfo.supply).toBe(0n);
    expect(initializedTokenInfo.decimals).toBe(decimals);
    expect(initializedTokenInfo.max_supply).toBe(maxSupply);
    expect(initializedTokenInfo.name).toBe(tokenName);
    expect(initializedTokenInfo.symbol).toBe(tokenSymbol);
    expect(role).toBe(MANAGER_ROLE);
    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(0);
    expect(initializedRoot).toBe(emptyRootField);
    expect(blockHeightWindow).toBe(BLOCK_HEIGHT_WINDOW);

    // It is possible to call to initialize only one time
    await fixture.token.initialize.rejected(
      tokenName,
      tokenSymbol,
      decimals,
      maxSupply,
      fixture.admin,
      BLOCK_HEIGHT_WINDOW,
      asSigner(fixture.admin),
    );
  });

  test("test update_role", async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.token.update_role.accepted(fixture.frozenAccount, MANAGER_ROLE, asSigner(fixture.admin));
    let role = await fixture.token.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.token.update_role.accepted(fixture.frozenAccount, NONE_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.token.update_role.rejected(fixture.frozenAccount, MANAGER_ROLE, asSigner(fixture.frozenAccount));

    // Non admin user cannot update minter role
    await fixture.token.update_role.rejected(fixture.minter, MINTER_ROLE, asSigner(fixture.frozenAccount));

    // Non admin user cannot update burner role
    await fixture.token.update_role.rejected(fixture.burner, BURNER_ROLE, asSigner(fixture.frozenAccount));

    // Non admin user cannot update freeze list manager role
    await fixture.token.update_role.rejected(
      fixture.freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      asSigner(fixture.frozenAccount),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.token.update_role.rejected(fixture.admin, NONE_ROLE, asSigner(fixture.admin));

    // Manager can assign burner, minter, supply manager, and freeze list manager role
    await fixture.token.update_role.accepted(
      fixture.freezeListManager,
      FREEZELIST_MANAGER_ROLE,
      asSigner(fixture.admin),
    );
    role = await fixture.token.mappings.addressToRole.get(fixture.freezeListManager);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);

    await fixture.token.update_role.accepted(fixture.minter, MINTER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.minter);
    expect(role).toBe(MINTER_ROLE);

    await fixture.token.update_role.accepted(fixture.burner, BURNER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.burner);
    expect(role).toBe(BURNER_ROLE);

    await fixture.token.update_role.accepted(fixture.supplyManager, MINTER_ROLE + BURNER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);
  });

  test("test mint_private", async () => {
    const fixture = state!;

    // a regular user cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.account));

    // a burner cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.burner));

    let tx = await fixture.token.mint_private.accepted(fixture.account, amount * 20n, asSigner(fixture.minter));
    fixture.accountRecord = await tx.outputs.decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(amount * 20n);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    tx = await fixture.token.mint_private.accepted(
      fixture.frozenAccount,
      amount * 20n,
      asSigner(fixture.supplyManager),
    );
    fixture.frozenAccountRecord = await tx.outputs.decrypt(fixture.frozenAccount);
    expect(fixture.frozenAccountRecord.amount).toBe(amount * 20n);
    expect(fixture.frozenAccountRecord.owner).toBe(fixture.frozenAccount.address);
  });

  test("test mint_public", async () => {
    const fixture = state!;

    // a regular user cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.account));

    // a burner cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.burner));

    await fixture.token.mint_public.accepted(fixture.account, amount * 20n, asSigner(fixture.minter));
    let balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(amount * 20n);

    await fixture.token.mint_public.accepted(fixture.frozenAccount, amount * 20n, asSigner(fixture.minter));
    balance = await fixture.token.mappings.balances.get(fixture.frozenAccount);
    expect(balance).toBe(amount * 20n);

    await fixture.token.mint_public.accepted(fixture.account, amount * 20n, asSigner(fixture.supplyManager));
    balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(amount * 40n);
  });

  test("test burn_private", async () => {
    const fixture = state!;

    // A user that is not burner, supply manager, or admin  cannot burn private assets
    await fixture.token.burn_private.rejected(fixture.accountRecord!, amount, asSigner(fixture.account));

    let mintTx = await fixture.token.mint_private.accepted(fixture.burner, amount, asSigner(fixture.minter));
    let burnerRecord = await mintTx.outputs.decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(amount);
    expect(burnerRecord.owner).toBe(fixture.burner.address);

    let burnTx = await fixture.token.burn_private.accepted(burnerRecord, amount, asSigner(fixture.burner));
    burnerRecord = await burnTx.outputs.decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(0n);
    expect(burnerRecord.owner).toBe(fixture.burner.address);

    mintTx = await fixture.token.mint_private.accepted(fixture.supplyManager, amount, asSigner(fixture.minter));
    let supplyManagerRecord = await mintTx.outputs.decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(amount);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);

    burnTx = await fixture.token.burn_private.accepted(supplyManagerRecord, amount, asSigner(fixture.supplyManager));
    supplyManagerRecord = await burnTx.outputs.decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(0n);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);
  });

  test("test burn_public", async () => {
    const fixture = state!;

    // A regular user cannot burn public assets
    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.account));

    // A minter user cannot burn public assets
    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.minter));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    await fixture.token.burn_public.accepted(fixture.account, amount, asSigner(fixture.burner));
    let balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount);

    await fixture.token.burn_public.accepted(fixture.account, amount, asSigner(fixture.supplyManager));
    balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount * 2n);
  });

  test("test update_freeze_list", async () => {
    const fixture = state!;
    const currentRoot = await fixture.token.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the admin can call to update_freeze_list
    await fixture.token.update_freeze_list.rejected(
      fixture.admin,
      true,
      1,
      currentRoot!,
      fixture.rootField!,
      asSigner(fixture.frozenAccount),
    );

    // Cannot unfreeze an unfrozen account
    await fixture.token.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      1,
      currentRoot!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    // Cannot update the root if the previous root is incorrect
    await fixture.token.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      1,
      fieldLiteral(0n),
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    await fixture.token.update_freeze_list.accepted(
      fixture.frozenAccount,
      true,
      1,
      currentRoot!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
    let isAccountFrozen = await fixture.token.mappings.freezeList.get(fixture.frozenAccount);
    let frozenAccountByIndex = await fixture.token.mappings.freezeListIndex.get(1);
    let lastIndex = await fixture.token.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    // Cannot unfreeze an account when the frozen list index is incorrect
    await fixture.token.update_freeze_list.rejected(
      fixture.frozenAccount,
      false,
      2,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze a frozen account
    await fixture.token.update_freeze_list.rejected(
      fixture.frozenAccount,
      true,
      1,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    await fixture.token.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.token.mappings.freezeList.get(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.token.mappings.freezeListIndex.get(1);
    lastIndex = await fixture.token.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(1);

    await fixture.token.update_freeze_list.accepted(
      fixture.frozenAccount,
      true,
      1,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.token.mappings.freezeList.get(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.token.mappings.freezeListIndex.get(1);
    lastIndex = await fixture.token.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    let randomAddress = Leo.address(safeAddress());
    await fixture.token.update_freeze_list.accepted(
      randomAddress,
      true,
      2,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.token.mappings.freezeList.get(randomAddress);
    frozenAccountByIndex = await fixture.token.mappings.freezeListIndex.get(2);
    lastIndex = await fixture.token.mappings.freezeListLastIndex.get(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = Leo.address(safeAddress());
    // Cannot freeze an account when the frozen list index is greater than the last index
    await fixture.token.update_freeze_list.rejected(
      randomAddress,
      true,
      10,
      fixture.rootField!,
      fixture.rootField!,
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze an account when the frozen list index is already taken
    await fixture.token.update_freeze_list.rejected(
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

    await fixture.token.update_block_height_window.rejected(BLOCK_HEIGHT_WINDOW, asSigner(fixture.account));

    await fixture.token.update_block_height_window.accepted(BLOCK_HEIGHT_WINDOW, asSigner(fixture.freezeListManager));
  });

  test("test transfer_public", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_public.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    await fixture.token.transfer_public.accepted(fixture.recipient, amount, asSigner(fixture.account));

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);

    // test transfer to yourself
    await fixture.token.transfer_public.accepted(fixture.account, amount, asSigner(fixture.account));
    expect(accountPublicBalance).toBe(await fixture.token.mappings.balances.get(fixture.account));
  });

  test("test transfer_public_as_signer", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_as_signer.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_as_signer.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    await fixture.token.transfer_public_as_signer.accepted(fixture.recipient, amount, asSigner(fixture.account));

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);

    // test transfer to yourself
    await fixture.token.transfer_public_as_signer.accepted(fixture.account, amount, asSigner(fixture.account));
    expect(accountPublicBalance).toBe(await fixture.token.mappings.balances.get(fixture.account));
  });

  test("test transfer_from_public", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.unapprove_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    // approve the spender
    await fixture.token.approve_public.accepted(fixture.spender, amount * 2n, asSigner(fixture.account));
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.frozenAccount));

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public.rejected(
      fixture.frozenAccount,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.frozenAccount,
      amount,
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    await fixture.token.transfer_from_public.accepted(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);

    // test transfer to yourself
    await fixture.token.transfer_from_public.accepted(
      fixture.account,
      fixture.account,
      amount,
      asSigner(fixture.spender),
    );
    expect(accountPublicBalance).toBe(await fixture.token.mappings.balances.get(fixture.account));
  });

  test("test transfer_from_public_to_private", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof!,
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.unapprove_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof!,
      asSigner(fixture.spender),
    );

    // approve the spender
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.frozenAccount));

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.frozenAccount,
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof!,
      asSigner(fixture.spender),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public_to_private.failsLocally(
      fixture.account,
      fixture.frozenAccount,
      amount,
      fixture.frozenAccountMerkleProof!,
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    const tx = await fixture.token.transfer_from_public_to_private.accepted(
      fixture.account,
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof!,
      asSigner(fixture.spender),
    );
    const recipientRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_public_to_priv", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_to_private.rejected(
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof!,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_to_private.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.frozenAccountMerkleProof!,
      asSigner(fixture.account),
    );

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    const tx = await fixture.token.transfer_public_to_private.accepted(
      fixture.recipient,
      amount,
      fixture.recipientMerkleProof!,
      asSigner(fixture.account),
    );
    const recipientRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_private", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_private.failsLocally(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.frozenAccountMerkleProof!,
      fixture.recipientMerkleProof!,
      asSigner(fixture.frozenAccount),
    );
    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_private.failsLocally(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof!,
      fixture.frozenAccountMerkleProof!,
      asSigner(fixture.account),
    );

    const tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof!,
      fixture.recipientMerkleProof!,
      asSigner(fixture.account),
    );

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    const recipientRecord = await tx.outputs[2].decrypt(fixture.recipient);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test("test transfer_priv_to_public", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof!,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof!,
      asSigner(fixture.account),
    );

    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    const tx = await fixture.token.transfer_private_to_public.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof!,
      asSigner(fixture.account),
    );

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.investigator);
    expect(complianceRecord.owner).toBe(fixture.investigator.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test old root support", async () => {
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
    await fixture.token.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      emptyTreeSenderMerkleProof,
      emptyTreeRecipientMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.token.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField!,
      emptyRootField,
      asSigner(fixture.freezeListManager),
    );

    const newRoot = await fixture.token.mappings.freezeListRoot.get(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.token.mappings.freezeListRoot.get(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    let tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof!,
      fixture.recipientMerkleProof!,
      asSigner(fixture.account),
    );
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);

    await fixture.token.update_block_height_window.accepted(1, asSigner(fixture.freezeListManager));

    // The transaction failed because the old root is expired
    await fixture.token.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof!,
      fixture.recipientMerkleProof!,
      asSigner(fixture.account),
    );

    tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      emptyTreeSenderMerkleProof,
      emptyTreeRecipientMerkleProof,
      asSigner(fixture.account),
    );
    await tx.outputs[1].decrypt(fixture.account);
  });
});
