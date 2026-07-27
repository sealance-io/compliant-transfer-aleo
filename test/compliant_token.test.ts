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
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  MINTER_ROLE,
  NONE_ROLE,
  PAUSE_ROLE,
  amount,
  decimals,
  emptyRootField,
  fundedAmount,
  maxSupply,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import {
  createCompliantTokenTemplate,
  decryptComplianceRecord,
  type Credentials,
  type MerkleProof,
  type Token,
} from "../typechain/CompliantTokenTemplate.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import { AleoNetworkClient } from "@provablehq/sdk";
import { getLatestBlockHeight } from "../lib/Block.js";

const tokenName = stringToBigInt("Stable Token");
const tokenSymbol = stringToBigInt("STABLE_TOKEN");
const fakeRootField = fieldLiteral(1n);

interface CompliantTokenFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly frozenAccount: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly recipient: SignableNamedAccount;
  readonly minter: SignableNamedAccount;
  readonly burner: SignableNamedAccount;
  readonly supplyManager: SignableNamedAccount;
  readonly spender: SignableNamedAccount;
  readonly freezeListManager: SignableNamedAccount;
  readonly pauser: SignableNamedAccount;
  readonly token: ReturnType<typeof createCompliantTokenTemplate>;
  readonly freezeRegistry: ReturnType<typeof createSealanceFreezelistRegistry>;
  readonly rootField: ReturnType<typeof fieldLiteral>;
  readonly senderMerkleProof: MerkleProof[];
  readonly frozenAccountMerkleProof: MerkleProof[];
  accountRecord?: Token;
  frozenAccountRecord?: Token;
  credentials?: Credentials;
  privateAccountBalance: bigint;
  startBlock: number;
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
    const burner = ctx.named.signer("burner");
    const supplyManager = ctx.named.signer("supplyManager");
    const spender = ctx.named.signer("spender");
    const freezeListManager = ctx.named.signer("freezeListManager");
    const pauser = ctx.named.signer("pauser");

    for (const signer of [
      admin,
      frozenAccount,
      account,
      freezeListManager,
      minter,
      burner,
      supplyManager,
      spender,
      pauser,
    ]) {
      await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
    }

    const token = createCompliantTokenTemplate().connect(ctx.lre);
    const freezeRegistry = createSealanceFreezelistRegistry().connect(ctx.lre);

    for (const program of [
      "merkle_tree",
      "multisig_core",
      "sealance_freezelist_registry",
      "compliant_token_template",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    const leaves = generateLeaves([frozenAccount.address]);
    const tree = buildTree(leaves);
    const root = tree[tree.length - 1]!;
    const rootField = fieldLiteral(root);
    const senderLeafIndices = getLeafIndices(tree, account.address);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount.address);
    const senderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];
    const frozenAccountMerkleProof = [
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH)),
    ];

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
      await freezeRegistry.update_freeze_list.accepted(
        frozenAccount,
        true,
        1,
        emptyRootField,
        rootField,
        asSigner(admin),
      );
    }

    return {
      ctx,
      deployer,
      admin,
      frozenAccount,
      account,
      recipient,
      minter,
      burner,
      supplyManager,
      spender,
      freezeListManager,
      pauser,
      token,
      freezeRegistry,
      rootField,
      senderMerkleProof,
      frozenAccountMerkleProof,
      privateAccountBalance: 0n,
      startBlock: 0,
    } satisfies CompliantTokenFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: CompliantTokenFixture | undefined;

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

describe("test compliant token program", () => {
  test("test initialize", async () => {
    const fixture = state!;
    if (!(await fixture.token.mappings.tokenInfo.contains(true))) {
      await fixture.token.initialize.accepted(
        tokenName,
        tokenSymbol,
        decimals,
        maxSupply,
        fixture.admin,
        asSigner(fixture.deployer),
      );

      const tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
      expect(tokenInfo.supply).toBe(0n);
      expect(tokenInfo.decimals).toBe(decimals);
      expect(tokenInfo.max_supply).toBe(maxSupply);
      expect(tokenInfo.name).toBe(tokenName);
      expect(tokenInfo.symbol).toBe(tokenSymbol);
      const role = await fixture.token.mappings.addressToRole.get(fixture.admin);
      expect(role).toBe(MANAGER_ROLE);
      const pauseStatus = await fixture.token.mappings.pause.get(true);
      expect(pauseStatus).toBe(false);

      // It is possible to call to initialize only one time
      await fixture.token.initialize.rejected(
        tokenName,
        tokenSymbol,
        decimals,
        maxSupply,
        fixture.admin,
        asSigner(fixture.deployer),
      );
    }
  });

  test("test update_roles", async () => {
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
    await fixture.token.update_role.rejected(fixture.minter, MINTER_ROLE, asSigner(fixture.account));

    // Non admin user cannot update burner role
    await fixture.token.update_role.rejected(fixture.burner, BURNER_ROLE, asSigner(fixture.account));

    // Non admin user cannot update supply manager role
    await fixture.token.update_role.rejected(
      fixture.supplyManager,
      MINTER_ROLE + BURNER_ROLE,
      asSigner(fixture.account),
    );

    // Non admin user cannot update none role
    await fixture.token.update_role.rejected(fixture.account, NONE_ROLE, asSigner(fixture.account));

    // Non admin user cannot update pause role
    await fixture.token.update_role.rejected(fixture.account, PAUSE_ROLE, asSigner(fixture.account));

    // Manager cannot unassign himself from being a manager
    await fixture.token.update_role.rejected(fixture.admin, NONE_ROLE, asSigner(fixture.admin));

    // Manager can assign minter, burner, manager, pauser and supply manager roles
    await fixture.token.update_role.accepted(fixture.minter, MINTER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.minter);
    expect(role).toBe(MINTER_ROLE);

    await fixture.token.update_role.accepted(fixture.burner, BURNER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.burner);
    expect(role).toBe(BURNER_ROLE);

    await fixture.token.update_role.accepted(fixture.supplyManager, MINTER_ROLE + BURNER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.supplyManager);
    expect(role).toBe(MINTER_ROLE + BURNER_ROLE);

    await fixture.token.update_role.accepted(fixture.account, NONE_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.account);
    expect(role).toBe(NONE_ROLE);

    await fixture.token.update_role.accepted(fixture.pauser, PAUSE_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.pauser);
    expect(role).toBe(PAUSE_ROLE);

    await fixture.token.update_role.accepted(fixture.admin, MANAGER_ROLE, asSigner(fixture.admin));
    role = await fixture.token.mappings.addressToRole.get(fixture.admin);
    expect(role).toBe(MANAGER_ROLE);
  });

  test("test mint_private", async () => {
    const fixture = state!;
    const supply = (await fixture.token.mappings.tokenInfo.get(true)).supply;

    // a regular user cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.account));

    // a burner cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.burner));

    // an admin cannot mint private assets
    await fixture.token.mint_private.rejected(fixture.account, amount * 20n, asSigner(fixture.admin));

    fixture.startBlock = await getLatestBlockHeight(fixture.ctx);

    let tx = await fixture.token.mint_private.accepted(fixture.frozenAccount, amount * 20n, asSigner(fixture.minter));
    fixture.frozenAccountRecord = await tx.outputs[1].decrypt(fixture.frozenAccount);
    expect(fixture.frozenAccountRecord.amount).toBe(amount * 20n);
    expect(fixture.frozenAccountRecord.owner).toBe(fixture.frozenAccount.address);

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo.supply - supply).toBe(amount * 20n);

    tx = await fixture.token.mint_private.accepted(fixture.account, amount * 20n, asSigner(fixture.supplyManager));
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountRecord.amount).toBe(amount * 20n);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo.supply - supply).toBe(amount * 40n);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.deployer);
    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount * 20n);
    expect(complianceRecord.sender).toBe(ZERO_ADDRESS);
    expect(complianceRecord.recipient).toBe(fixture.account.address);

    fixture.privateAccountBalance += amount * 20n;
  });

  test("test mint_public", async () => {
    const fixture = state!;
    const supply = (await fixture.token.mappings.tokenInfo.get(true)).supply;

    // a regular user cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.account));

    // a burner cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.burner));

    // an admin cannot mint public assets
    await fixture.token.mint_public.rejected(fixture.account, amount * 20n, asSigner(fixture.admin));

    await fixture.token.mint_public.accepted(fixture.frozenAccount, amount * 20n, asSigner(fixture.minter));
    let balance = await fixture.token.mappings.balances.get(fixture.frozenAccount);
    expect(balance).toBe(amount * 20n);

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount * 20n);

    await fixture.token.mint_public.accepted(fixture.account, amount * 20n, asSigner(fixture.supplyManager));
    balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(amount * 20n);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount * 40n);
  });

  test("test burn_public", async () => {
    const fixture = state!;
    const supply = (await fixture.token.mappings.tokenInfo.get(true)).supply;

    // A regular user cannot burn public assets
    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.account));

    // A minter user cannot burn public assets
    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.minter));

    await fixture.token.burn_public.rejected(fixture.account, amount, asSigner(fixture.admin));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    await fixture.token.burn_public.accepted(fixture.account, amount, asSigner(fixture.burner));
    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply - tokenInfo!.supply).toBe(amount);

    await fixture.token.burn_public.accepted(fixture.account, amount, asSigner(fixture.supplyManager));
    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply - tokenInfo!.supply).toBe(amount * 2n);

    const balance = await fixture.token.mappings.balances.get(fixture.account);
    expect(balance).toBe(previousAccountPublicBalance - amount * 2n);
  });

  test("test burn_private", async () => {
    const fixture = state!;
    const supply = (await fixture.token.mappings.tokenInfo.get(true)).supply;

    // A user that doesn't have a burner role cannot burn private assets
    await fixture.token.burn_private.rejected(fixture.accountRecord!, amount, asSigner(fixture.account));

    let mintTx = await fixture.token.mint_private.accepted(fixture.burner, amount, asSigner(fixture.minter));
    let burnerRecord = await mintTx.outputs[1].decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(amount);
    expect(burnerRecord.owner).toBe(fixture.burner.address);

    let tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount);

    let burnTx = await fixture.token.burn_private.accepted(burnerRecord, amount, asSigner(fixture.burner));
    burnerRecord = await burnTx.outputs[1].decrypt(fixture.burner);
    expect(burnerRecord.amount).toBe(0n);
    expect(burnerRecord.owner).toBe(fixture.burner.address);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply).toBe(tokenInfo!.supply);

    let complianceRecord = await burnTx.outputs[0].decrypt(fixture.deployer);
    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.burner.address);
    expect(complianceRecord.recipient).toBe(ZERO_ADDRESS);

    mintTx = await fixture.token.mint_private.accepted(fixture.supplyManager, amount, asSigner(fixture.minter));
    let supplyManagerRecord = await mintTx.outputs[1].decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(amount);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(tokenInfo!.supply - supply).toBe(amount);

    // check that MINTER_ROLE+BURNER_ROLE can burn private assets
    burnTx = await fixture.token.burn_private.accepted(supplyManagerRecord, amount, asSigner(fixture.supplyManager));
    supplyManagerRecord = await burnTx.outputs[1].decrypt(fixture.supplyManager);
    expect(supplyManagerRecord.amount).toBe(0n);
    expect(supplyManagerRecord.owner).toBe(fixture.supplyManager.address);

    tokenInfo = await fixture.token.mappings.tokenInfo.get(true);
    expect(supply).toBe(tokenInfo!.supply);
  });

  test("test transfer_public", async () => {
    const fixture = state!;
    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    // If the sender is frozen account it's IMPOSSIBLE to send tokens
    await fixture.token.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's IMPOSSIBLE to send tokens
    await fixture.token.transfer_public.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    await fixture.token.transfer_public.accepted(fixture.recipient, amount, asSigner(fixture.account));

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test transfer_public_as_signer", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_as_signer.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    // If the recipient is frozen account it's IMPOSSIBLE to send tokens
    await fixture.token.transfer_public_as_signer.rejected(fixture.frozenAccount, amount, asSigner(fixture.account));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);
    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    await fixture.token.transfer_public_as_signer.accepted(fixture.recipient, amount, asSigner(fixture.account));

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
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

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
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
  });

  test("test transfer_from_public_to_private", async () => {
    const fixture = state!;

    // If the sender didn't approve the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.unapprove_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // If the sender approve and then unapprove the spender the transaction will fail
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));
    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.frozenAccount));

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.frozenAccount,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    const tx = await fixture.token.transfer_from_public_to_private.accepted(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );
    const recipientRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.deployer);
    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const accountPublicBalance = await fixture.token.mappings.balances.get(fixture.account);
    expect(accountPublicBalance).toBe(previousAccountPublicBalance - amount);
  });

  test("test transfer_public_to_private", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_public_to_private.rejected(fixture.recipient, amount, asSigner(fixture.frozenAccount));

    const previousAccountPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.account, 0n);

    const tx = await fixture.token.transfer_public_to_private.accepted(
      fixture.recipient,
      amount,
      asSigner(fixture.account),
    );
    const recipientRecord = await tx.outputs[1].decrypt(fixture.recipient);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.deployer);
    expect(complianceRecord.owner).toBe(fixture.deployer.address);
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
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    const tx = await fixture.token.transfer_private.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    const recipientRecord = await tx.outputs[2].decrypt(fixture.recipient);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(recipientRecord.owner).toBe(fixture.recipient.address);
    expect(recipientRecord.amount).toBe(amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.deployer);
    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test("test transfer_private_to_public", async () => {
    const fixture = state!;

    // If the sender is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.failsLocally(
      fixture.recipient,
      amount,
      fixture.frozenAccountRecord!,
      fixture.frozenAccountMerkleProof,
      asSigner(fixture.frozenAccount),
    );

    // If the recipient is frozen account it's impossible to send tokens
    await fixture.token.transfer_private_to_public.rejected(
      fixture.frozenAccount,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    const previousRecipientPublicBalance = await fixture.token.mappings.balances.getOrUse(fixture.recipient, 0n);

    const tx = await fixture.token.transfer_private_to_public.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;

    const previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = await tx.outputs[1].decrypt(fixture.account);
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);

    const complianceRecord = await tx.outputs[0].decrypt(fixture.deployer);
    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    const recipientPublicBalance = await fixture.token.mappings.balances.get(fixture.recipient);
    expect(recipientPublicBalance).toBe(previousRecipientPublicBalance + amount);
  });

  test("test get_credentials", async () => {
    const fixture = state!;

    // It's impossible to get the credentials record with an invalid merkle proof
    await fixture.token.get_credentials.failsLocally(fixture.frozenAccountMerkleProof, asSigner(fixture.frozenAccount));

    const leaves = generateLeaves([fixture.recipient.address]);
    const tree = buildTree(leaves);
    const senderLeafIndices = getLeafIndices(tree, fixture.account.address);
    const incorrectSenderMerkleProof = [
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[0], MAX_TREE_DEPTH)),
      toMerkleProof(getSiblingPath(tree, senderLeafIndices[1], MAX_TREE_DEPTH)),
    ];

    // If the root doesn't match the on-chain root the transaction will be rejected
    await fixture.token.get_credentials.rejected(incorrectSenderMerkleProof, asSigner(fixture.account));

    const tx = await fixture.token.get_credentials.accepted(fixture.senderMerkleProof, asSigner(fixture.account));
    fixture.credentials = await tx.outputs.decrypt(fixture.account);
    expect(fixture.credentials.owner).toBe(fixture.account.address);
    expect(fixture.credentials.freeze_list_root).toBe(fixture.rootField);
  });

  test("test transfer with credentials", async () => {
    const fixture = state!;

    let transferPrivateTx = await fixture.token.transfer_private_with_creds.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;

    let complianceRecord = await transferPrivateTx.outputs[0].decrypt(fixture.deployer);
    let encryptedSenderRecord = await transferPrivateTx.outputs[1].decrypt(fixture.account);
    const encryptedRecipientRecord = await transferPrivateTx.outputs[2].decrypt(fixture.recipient);
    let encryptedCredRecord = await transferPrivateTx.outputs[3].decrypt(fixture.account);

    fixture.credentials = encryptedCredRecord;
    expect(fixture.credentials.owner).toBe(fixture.account.address);
    expect(fixture.credentials.freeze_list_root).toBe(fixture.rootField);

    let previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = encryptedSenderRecord;
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(encryptedRecipientRecord.owner).toBe(fixture.recipient.address);
    expect(encryptedRecipientRecord.amount).toBe(amount);

    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);

    // Update the root to make the old credentials expired
    await fixture.freezeRegistry.update_freeze_list.accepted(
      fixture.frozenAccount,
      false,
      1,
      fixture.rootField,
      fakeRootField,
      asSigner(fixture.admin),
    );
    await fixture.freezeRegistry.update_block_height_window.accepted(1, asSigner(fixture.admin));

    await fixture.token.transfer_private_with_creds.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );

    // bring back the old root
    await fixture.freezeRegistry.update_freeze_list.accepted(
      fixture.frozenAccount,
      true,
      1,
      fakeRootField,
      fixture.rootField,
      asSigner(fixture.admin),
    );
    await fixture.freezeRegistry.update_block_height_window.accepted(BLOCK_HEIGHT_WINDOW, asSigner(fixture.admin));

    transferPrivateTx = await fixture.token.transfer_private_with_creds.accepted(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );
    fixture.privateAccountBalance -= amount;

    complianceRecord = await transferPrivateTx.outputs[0].decrypt(fixture.deployer);
    encryptedSenderRecord = await transferPrivateTx.outputs[1].decrypt(fixture.account);
    const secondRecipientRecord = await transferPrivateTx.outputs[2].decrypt(fixture.recipient);
    encryptedCredRecord = await transferPrivateTx.outputs[3].decrypt(fixture.account);

    fixture.credentials = encryptedCredRecord;
    expect(fixture.credentials.owner).toBe(fixture.account.address);
    expect(fixture.credentials.freeze_list_root).toBe(fixture.rootField);

    previousAmount = fixture.accountRecord!.amount;
    fixture.accountRecord = encryptedSenderRecord;
    expect(fixture.accountRecord.owner).toBe(fixture.account.address);
    expect(fixture.accountRecord.amount).toBe(previousAmount - amount);
    expect(secondRecipientRecord.owner).toBe(fixture.recipient.address);
    expect(secondRecipientRecord.amount).toBe(amount);

    expect(complianceRecord.owner).toBe(fixture.deployer.address);
    expect(complianceRecord.amount).toBe(amount);
    expect(complianceRecord.sender).toBe(fixture.account.address);
    expect(complianceRecord.recipient).toBe(fixture.recipient.address);
  });

  test("test pausing the contract", async () => {
    const fixture = state!;

    // Only the pauser can pause the program
    await fixture.token.set_pause_status.rejected(true, asSigner(fixture.admin));

    await fixture.token.approve_public.accepted(fixture.spender, amount, asSigner(fixture.account));

    // pause the contract
    await fixture.token.set_pause_status.accepted(true, asSigner(fixture.pauser));
    let pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(true);

    // verify that all the functionalities are paused
    await fixture.token.mint_public.rejected(fixture.recipient, amount, asSigner(fixture.minter));

    await fixture.token.mint_private.rejected(fixture.recipient, amount, asSigner(fixture.minter));

    await fixture.token.burn_public.rejected(fixture.recipient, amount, asSigner(fixture.burner));

    await fixture.token.transfer_public.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.token.transfer_public_as_signer.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.token.approve_public.rejected(fixture.spender, amount, asSigner(fixture.account));

    await fixture.token.unapprove_public.rejected(fixture.spender, amount, asSigner(fixture.account));

    await fixture.token.transfer_from_public.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.transfer_from_public_to_private.rejected(
      fixture.account,
      fixture.recipient,
      amount,
      asSigner(fixture.spender),
    );

    await fixture.token.transfer_public_to_private.rejected(fixture.recipient, amount, asSigner(fixture.account));

    await fixture.token.transfer_private.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.token.transfer_private_to_public.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.senderMerkleProof,
      asSigner(fixture.account),
    );

    await fixture.token.transfer_private_with_creds.rejected(
      fixture.recipient,
      amount,
      fixture.accountRecord!,
      fixture.credentials!,
      asSigner(fixture.account),
    );

    // unpause the contract
    await fixture.token.set_pause_status.accepted(false, asSigner(fixture.pauser));
    pauseStatus = await fixture.token.mappings.pause.get(true);
    expect(pauseStatus).toBe(false);

    //verify that the functionalities are back (one is enough)
    await fixture.token.transfer_public.accepted(fixture.recipient, amount, asSigner(fixture.account));
  });

  test("calculate private balance", async () => {
    const fixture = state!;
    const networkClient = new AleoNetworkClient(fixture.ctx.connection.endpoint);
    const latestBlockHeight = await getLatestBlockHeight(fixture.ctx);
    let calculatedAccountBalance = 0n;
    let calculatedBurnerBalance = 0n;
    while (latestBlockHeight > fixture.startBlock) {
      const endBlock = Math.min(fixture.startBlock + 50, latestBlockHeight);
      const blockRange = await networkClient.getBlockRange(fixture.startBlock, endBlock);
      fixture.startBlock += 50;
      for (const block of blockRange) {
        if (!block.transactions || block.transactions.length === 0) {
          // Skip empty blocks
          continue;
        }
        for (const tx of block.transactions) {
          if (!tx.transaction?.execution?.transitions) continue;
          for (const transition of tx.transaction.execution.transitions ?? []) {
            if (
              transition.program === "compliant_token_template.aleo" &&
              transition.outputs &&
              transition.outputs[0].type === "record"
            ) {
              try {
                const complianceRecord = await decryptComplianceRecord(
                  transition.outputs[0].value,
                  fixture.deployer.privateKey,
                );
                const { recipient, sender, amount: transferredAmount } = complianceRecord;
                if (
                  sender === fixture.account.address &&
                  !["transfer_from_public_to_private", "transfer_public_to_private"].includes(transition.function)
                ) {
                  calculatedAccountBalance -= transferredAmount;
                }
                if (recipient === fixture.account.address && transition.function !== "transfer_private_to_public") {
                  calculatedAccountBalance += transferredAmount;
                }
                if (
                  sender === fixture.burner.address &&
                  !["transfer_from_public_to_private", "transfer_public_to_private"].includes(transition.function)
                ) {
                  calculatedBurnerBalance -= transferredAmount;
                }
                if (recipient === fixture.burner.address && transition.function !== "transfer_private_to_public") {
                  calculatedBurnerBalance += transferredAmount;
                }
              } catch {}
            }
          }
        }
      }
    }

    expect(calculatedAccountBalance).toBe(fixture.privateAccountBalance);
    expect(calculatedBurnerBalance).toBe(0n);
  });
});
