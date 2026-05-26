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
import { createSealedReportToken, type Token, type TokenInfo } from "../typechain/SealedReportToken.js";
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

    const currentRoot = await fixture.token.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    // Cannot update freeze list before initialization
    await fixture.token.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );

    if (fixture.deployer.address !== fixture.admin.address) {
      // The caller is not the initial admin
      await fixture.token.initialize.rejected(initializeArgs, asSigner(fixture.deployer));
    }

    await fixture.token.initialize.accepted(initializeArgs, asSigner(fixture.admin));

    const initializedTokenInfo = (await fixture.token.getToken_info(true)) as TokenInfo;
    const isAccountFrozen = await fixture.token.getFreeze_list(zeroAddress);
    const frozenAccountByIndex = await fixture.token.getFreeze_list_index(0);
    const lastIndex = await fixture.token.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);
    const initializedRoot = await fixture.token.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const blockHeightWindow = await fixture.token.getBlock_height_window(BLOCK_HEIGHT_WINDOW_INDEX);
    const role = await fixture.token.getAddress_to_role(fixture.admin);

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
    await fixture.token.initialize.rejected(initializeArgs, asSigner(fixture.admin));
  });

  test("test update_role", async () => {
    const fixture = state!;

    // Manager can assign role
    await fixture.token.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
      },
      asSigner(fixture.admin),
    );
    let role = await fixture.token.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(MANAGER_ROLE);

    // Manager can remove role
    await fixture.token.update_role.accepted(
      {
        new_address: fixture.frozenAccount,
        role: NONE_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.token.getAddress_to_role(fixture.frozenAccount);
    expect(role).toBe(NONE_ROLE);

    // Non manager cannot assign role
    await fixture.token.update_role.rejected(
      {
        new_address: fixture.frozenAccount,
        role: MANAGER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update minter role
    await fixture.token.update_role.rejected(
      {
        new_address: fixture.minter,
        role: MINTER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update burner role
    await fixture.token.update_role.rejected(
      {
        new_address: fixture.burner,
        role: BURNER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Non admin user cannot update freeze list manager role
    await fixture.token.update_role.rejected(
      {
        new_address: fixture.freezeListManager,
        role: FREEZELIST_MANAGER_ROLE,
      },
      asSigner(fixture.frozenAccount),
    );

    // Manager cannot unassign himself from being a manager
    await fixture.token.update_role.rejected(
      {
        new_address: fixture.admin,
        role: NONE_ROLE,
      },
      asSigner(fixture.admin),
    );

    // Manager can assign burner, minter, supply manager, and freeze list manager role
    await fixture.token.update_role.accepted(
      {
        new_address: fixture.freezeListManager,
        role: FREEZELIST_MANAGER_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.token.getAddress_to_role(fixture.freezeListManager);
    expect(role).toBe(FREEZELIST_MANAGER_ROLE);

    await fixture.token.update_role.accepted(
      {
        new_address: fixture.minter,
        role: MINTER_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.token.getAddress_to_role(fixture.minter);
    expect(role).toBe(MINTER_ROLE);

    await fixture.token.update_role.accepted(
      {
        new_address: fixture.burner,
        role: BURNER_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.token.getAddress_to_role(fixture.burner);
    expect(role).toBe(BURNER_ROLE);

    await fixture.token.update_role.accepted(
      {
        new_address: fixture.supplyManager,
        role: MINTER_ROLE + BURNER_ROLE,
      },
      asSigner(fixture.admin),
    );
    role = await fixture.token.getAddress_to_role(fixture.supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);
  });

  test("test mint_private", async () => {
    const fixture = state!;

    // a regular user cannot mint private assets
    await fixture.token.mint_private.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
      },
      asSigner(fixture.account),
    );

    // a burner cannot mint private assets
    await fixture.token.mint_private.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
      },
      asSigner(fixture.burner),
    );

    let tx = await fixture.token.mint_private.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
      },
      asSigner(fixture.minter),
    );
    fixture.accountRecord = await tx.outputs.decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(amount * 20n);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    tx = await fixture.token.mint_private.accepted(
      {
        recipient: fixture.frozenAccount,
        amount: amount * 20n,
      },
      asSigner(fixture.supplyManager),
    );
    fixture.frozenAccountRecord = await tx.outputs.decrypt(fixture.frozenAccount);
    expect(fixture.frozenAccountRecord.amount).toBe(amount * 20n);
    expect(fixture.frozenAccountRecord.owner).toBe(fixture.frozenAccount.address);
  });

  test("test mint_public", async () => {
    const fixture = state!;

    // a regular user cannot mint public assets
    await fixture.token.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
      },
      asSigner(fixture.account),
    );

    // a burner cannot mint public assets
    await fixture.token.mint_public.rejected(
      {
        recipient: fixture.account,
        amount: amount * 20n,
      },
      asSigner(fixture.burner),
    );

    await fixture.token.mint_public.accepted(
      {
        recipient: fixture.account,
        amount: amount * 20n,
      },
      asSigner(fixture.minter),
    );
    let balance = await fixture.token.getBalances(fixture.account);
    expect(balance).toBe(amount * 20n);

    await fixture.token.mint_public.accepted(
      {
        recipient: fixture.frozenAccount,
        amount: amount * 20n,
      },
      asSigner(fixture.supplyManager),
    );
    balance = await fixture.token.getBalances(fixture.frozenAccount);
    expect(balance).toBe(amount * 20n);
  });

  test("test burn_private", async () => {
    const fixture = state!;

    // A user that is not burner, supply manager, or admin  cannot burn private assets
    await fixture.token.burn_private.rejected(
      {
        input_record: fixture.accountRecord!,
        amount,
      },
      asSigner(fixture.account),
    );

    let mintTx = await fixture.token.mint_private.accepted(
      {
        recipient: fixture.burner,
        amount,
      },
      asSigner(fixture.minter),
    );
    let burnerRecord = await mintTx.outputs.decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(amount);
    expect(burnerRecord.owner).toBe(fixture.burner.address);

    let burnTx = await fixture.token.burn_private.accepted(
      {
        input_record: burnerRecord,
        amount,
      },
      asSigner(fixture.burner),
    );
    burnerRecord = await burnTx.outputs.decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(0n);
    expect(burnerRecord.owner).toBe(fixture.burner.address);

    mintTx = await fixture.token.mint_private.accepted(
      {
        recipient: fixture.supplyManager,
        amount,
      },
      asSigner(fixture.minter),
    );
    let supplyManagerRecord = await mintTx.outputs.decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(amount);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);

    burnTx = await fixture.token.burn_private.accepted(
      {
        input_record: supplyManagerRecord,
        amount,
      },
      asSigner(fixture.supplyManager),
    );
    supplyManagerRecord = await burnTx.outputs.decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(0n);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);
  });

  test("test burn_public", async () => {
    const fixture = state!;

    // A regular user cannot burn public assets
    await fixture.token.burn_public.rejected(
      {
        owner: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );

    // A minter user cannot burn public assets
    await fixture.token.burn_public.rejected(
      {
        owner: fixture.account,
        amount,
      },
      asSigner(fixture.minter),
    );

    const previousAccountPublicBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;

    await fixture.token.burn_public.accepted(
      {
        owner: fixture.account,
        amount,
      },
      asSigner(fixture.burner),
    );
    let balance = await fixture.token.getBalances(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount);

    await fixture.token.burn_public.accepted(
      {
        owner: fixture.account,
        amount,
      },
      asSigner(fixture.supplyManager),
    );
    balance = await fixture.token.getBalances(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount * 2n);
  });

  test("test update_freeze_list", async () => {
    const fixture = state!;
    const currentRoot = await fixture.token.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);

    // Only the admin can call to update_freeze_list
    await fixture.token.update_freeze_list.rejected(
      {
        account: fixture.admin,
        is_frozen: true,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.frozenAccount),
    );

    // Cannot unfreeze an unfrozen account
    await fixture.token.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot update the root if the previous root is incorrect
    await fixture.token.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fieldLiteral(0n),
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );

    await fixture.token.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: currentRoot!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );
    let isAccountFrozen = await fixture.token.getFreeze_list(fixture.frozenAccount);
    let frozenAccountByIndex = await fixture.token.getFreeze_list_index(1);
    let lastIndex = await fixture.token.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    // Cannot unfreeze an account when the frozen list index is incorrect
    await fixture.token.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze a frozen account
    await fixture.token.update_freeze_list.rejected(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );

    await fixture.token.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.token.getFreeze_list(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.token.getFreeze_list_index(1);
    lastIndex = await fixture.token.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(false);
    expect(frozenAccountByIndex).toBe(ZERO_ADDRESS);
    expect(lastIndex).toBe(1);

    await fixture.token.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: true,
        frozen_index: 1,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.token.getFreeze_list(fixture.frozenAccount);
    frozenAccountByIndex = await fixture.token.getFreeze_list_index(1);
    lastIndex = await fixture.token.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(fixture.frozenAccount.address);
    expect(lastIndex).toBe(1);

    let randomAddress = Leo.address(safeAddress());
    await fixture.token.update_freeze_list.accepted(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );
    isAccountFrozen = await fixture.token.getFreeze_list(randomAddress);
    frozenAccountByIndex = await fixture.token.getFreeze_list_index(2);
    lastIndex = await fixture.token.getFreeze_list_last_index(FREEZE_LIST_LAST_INDEX);

    expect(isAccountFrozen).toBe(true);
    expect(frozenAccountByIndex).toBe(randomAddress);
    expect(lastIndex).toBe(2);

    randomAddress = Leo.address(safeAddress());
    // Cannot freeze an account when the frozen list index is greater than the last index
    await fixture.token.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 10,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );

    // Cannot freeze an account when the frozen list index is already taken
    await fixture.token.update_freeze_list.rejected(
      {
        account: randomAddress,
        is_frozen: true,
        frozen_index: 2,
        previous_root: fixture.rootField!,
        new_root: fixture.rootField!,
      },
      asSigner(fixture.freezeListManager),
    );
  });

  test("test update_block_height_window", async () => {
    const fixture = state!;

    await fixture.token.update_block_height_window.rejected(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
      },
      asSigner(fixture.account),
    );

    await fixture.token.update_block_height_window.accepted(
      {
        blocks: BLOCK_HEIGHT_WINDOW,
      },
      asSigner(fixture.freezeListManager),
    );
  });

  test("test transfer_public", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public.rejected(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_public.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
      },
      asSigner(fixture.account),
    );

    const previousAccountPublicBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;
    const previousRecipientPublicBalance = (await fixture.token.getBalances(fixture.recipient)) ?? 0n;

    await fixture.token.transfer_public.accepted(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.account),
    );

    const accountPublicBalance = await fixture.token.getBalances(fixture.account);
    const recipientPublicBalance = await fixture.token.getBalances(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);

    // test transfer to yourself
    await fixture.token.transfer_public.accepted(
      {
        recipient: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );
    expect(accountPublicBalance).toBe(await fixture.token.getBalances(fixture.account));
  });

  test("test transfer_public_as_signer", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_as_signer.rejected(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_as_signer.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
      },
      asSigner(fixture.account),
    );

    const previousAccountPublicBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;
    const previousRecipientPublicBalance = (await fixture.token.getBalances(fixture.recipient)) ?? 0n;

    await fixture.token.transfer_public_as_signer.accepted(
      {
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.account),
    );

    const accountPublicBalance = await fixture.token.getBalances(fixture.account);
    const recipientPublicBalance = await fixture.token.getBalances(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);

    // test transfer to yourself
    await fixture.token.transfer_public_as_signer.accepted(
      {
        recipient: fixture.account,
        amount,
      },
      asSigner(fixture.account),
    );
    expect(accountPublicBalance).toBe(await fixture.token.getBalances(fixture.account));
  });

  test("test transfer_from_public", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public.rejected(
      {
        owner: fixture.account,
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.account),
    );
    await fixture.token.unapprove_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.account),
    );

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public.rejected(
      {
        owner: fixture.account,
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.spender),
    );

    // approve the spender
    await fixture.token.approve_public.accepted(
      {
        spender: fixture.spender,
        amount: amount * 2n,
      },
      asSigner(fixture.account),
    );
    await fixture.token.approve_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public.rejected(
      {
        owner: fixture.frozenAccount,
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.spender),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public.rejected(
      {
        owner: fixture.account,
        recipient: fixture.frozenAccount,
        amount,
      },
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;
    const previousRecipientPublicBalance = (await fixture.token.getBalances(fixture.recipient)) ?? 0n;

    await fixture.token.transfer_from_public.accepted(
      {
        owner: fixture.account,
        recipient: fixture.recipient,
        amount,
      },
      asSigner(fixture.spender),
    );

    const accountPublicBalance = await fixture.token.getBalances(fixture.account);
    const recipientPublicBalance = await fixture.token.getBalances(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);

    // test transfer to yourself
    await fixture.token.transfer_from_public.accepted(
      {
        owner: fixture.account,
        recipient: fixture.account,
        amount,
      },
      asSigner(fixture.spender),
    );
    expect(accountPublicBalance).toBe(await fixture.token.getBalances(fixture.account));
  });

  test("test transfer_from_public_to_private", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      {
        owner: fixture.account,
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.account),
    );
    await fixture.token.unapprove_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.account),
    );

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      {
        owner: fixture.account,
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.spender),
    );

    // approve the spender
    await fixture.token.approve_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.account),
    );
    await fixture.token.approve_public.accepted(
      {
        spender: fixture.spender,
        amount,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public_to_private.rejected(
      {
        owner: fixture.frozenAccount,
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.spender),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public_to_private.failsLocally(
      {
        owner: fixture.account,
        recipient: fixture.frozenAccount,
        amount,
        recipient_merkle_proofs: fixture.frozenAccountMerkleProof!,
      },
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;

    const tx = await fixture.token.transfer_from_public_to_private.accepted(
      {
        owner: fixture.account,
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
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

    const accountPublicBalance = await fixture.token.getBalances(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_public_to_priv", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_to_private.rejected(
      {
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_to_private.failsLocally(
      {
        recipient: fixture.frozenAccount,
        amount,
        recipient_merkle_proofs: fixture.frozenAccountMerkleProof!,
      },
      asSigner(fixture.account),
    );

    const previousAccountPublicBalance = (await fixture.token.getBalances(fixture.account)) ?? 0n;

    const tx = await fixture.token.transfer_public_to_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
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

    const accountPublicBalance = await fixture.token.getBalances(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_private", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    (await fixture.token.transfer_private.failsLocally(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.frozenAccountMerkleProof!,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.frozenAccount),
    ),
      // If the recipient is frozen account it's impossible to send tokens
      await fixture.token.transfer_private.failsLocally(
        {
          recipient: fixture.frozenAccount,
          amount,
          input_record: fixture.accountRecord!,
          sender_merkle_proofs: fixture.senderMerkleProof!,
          recipient_merkle_proofs: fixture.frozenAccountMerkleProof!,
        },
        asSigner(fixture.account),
      ));

    const tx = await fixture.token.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof!,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
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
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.frozenAccountRecord!,
        sender_merkle_proofs: fixture.frozenAccountMerkleProof!,
      },
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.rejected(
      {
        recipient: fixture.frozenAccount,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof!,
      },
      asSigner(fixture.account),
    );

    const previousRecipientPublicBalance = (await fixture.token.getBalances(fixture.recipient)) ?? 0n;

    const tx = await fixture.token.transfer_private_to_public.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof!,
      },
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

    const recipientPublicBalance = await fixture.token.getBalances(fixture.recipient);
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
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: emptyTreeSenderMerkleProof,
        recipient_merkle_proofs: emptyTreeRecipientMerkleProof,
      },
      asSigner(fixture.account),
    );

    await fixture.token.update_freeze_list.accepted(
      {
        account: fixture.frozenAccount,
        is_frozen: false,
        frozen_index: 1,
        previous_root: fixture.rootField!,
        new_root: emptyRootField, // fake root
      },
      asSigner(fixture.freezeListManager),
    );

    const newRoot = await fixture.token.getFreeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
    const oldRoot = await fixture.token.getFreeze_list_root(PREVIOUS_FREEZE_LIST_ROOT_INDEX);
    expect(oldRoot).toBe(fixture.rootField);
    expect(newRoot).toBe(emptyRootField);

    // The transaction succeed because the old root is match
    let tx = await fixture.token.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof!,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.account),
    );
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);

    await fixture.token.update_block_height_window.accepted(
      {
        blocks: 1,
      },
      asSigner(fixture.freezeListManager),
    );

    // The transaction failed because the old root is expired
    await fixture.token.transfer_private.rejected(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: fixture.senderMerkleProof!,
        recipient_merkle_proofs: fixture.recipientMerkleProof!,
      },
      asSigner(fixture.account),
    );

    tx = await fixture.token.transfer_private.accepted(
      {
        recipient: fixture.recipient,
        amount,
        input_record: fixture.accountRecord!,
        sender_merkle_proofs: emptyTreeSenderMerkleProof,
        recipient_merkle_proofs: emptyTreeRecipientMerkleProof,
      },
      asSigner(fixture.account),
    );
    await tx.outputs[1].decrypt(fixture.account);
  });
});
