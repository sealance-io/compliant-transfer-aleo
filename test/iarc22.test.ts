import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, setup, type TestContext } from "@lionden/testing";
import {
  buildTree,
  generateLeaves,
  getLeafIndices,
  getSiblingPath,
  PolicyEngine,
  ZERO_ADDRESS,
} from "@sealance-io/policy-engine-aleo";

import {
  BLOCK_HEIGHT_WINDOW,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZELIST_MANAGER_ROLE,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  MINTER_ROLE,
  emptyRootField,
  fundedAmount,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { asSigner, fieldLiteral, toMerkleProof } from "../lib/LiondenAdapters.js";
import { createCompliantTokenTemplate, type Token } from "../typechain/CompliantTokenTemplate.js";
import { createSealanceFreezelistRegistry } from "../typechain/SealanceFreezelistRegistry.js";
import { Leo } from "../typechain/BaseContract.js";

let ctx: TestContext | undefined;
let token: ReturnType<typeof createCompliantTokenTemplate>;
let registry: ReturnType<typeof createSealanceFreezelistRegistry>;
let accountRecord: Token;

async function view(program: string, name: string, ...inputs: string[]): Promise<string> {
  const response = await fetch(`${ctx!.connection.endpoint}/testnet/program/${program}.aleo/view/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(inputs),
  });
  if (!response.ok) throw new Error(`view ${program}/${name} failed: ${await response.text()}`);
  const outputs = (await response.json()) as string[];
  return outputs[0]!;
}

async function expectView(program: string, name: string, expected: string, ...inputs: string[]) {
  expect(await view(program, name, ...inputs)).toContain(expected);
}

beforeAll(async () => {
  ctx = await setup();
  const deployer = ctx.named.signer("deployer");
  for (const signer of [
    ctx.named.signer("admin"),
    ctx.named.signer("account"),
    ctx.named.signer("recipient"),
    ctx.named.signer("frozenAccount"),
  ]) {
    await fundWithCredits(ctx, signer.address, fundedAmount, deployer);
  }
  for (const program of ["merkle_tree", "multisig_core", "sealance_freezelist_registry", "compliant_token_template"]) {
    await ctx.deploy(program, { noCompile: true });
  }
  registry = createSealanceFreezelistRegistry().connect(ctx.lre);
  token = createCompliantTokenTemplate().connect(ctx.lre);
}, 600_000);

afterAll(async () => {
  if (ctx) await ctx.teardown();
  else clearFixtures();
});

describe.sequential("ARC-22 programs", () => {
  test("freeze-list views return safe defaults before initialization", async () => {
    const account = ctx!.named.signer("account");
    await expectView("sealance_freezelist_registry", "is_frozen_address", "false", account.address);
    await expectView("sealance_freezelist_registry", "is_frozen_index", "false", "1u32");
    await expectView("sealance_freezelist_registry", "current_freeze_list_root", emptyRootField.toString());
    await expectView("sealance_freezelist_registry", "previous_freeze_list_root", emptyRootField.toString());
    await expectView("sealance_freezelist_registry", "root_updated_height", "0u32");
    await expectView("sealance_freezelist_registry", "block_height_window", "0u32");
  });

  test("initializes identifier metadata and all required views", async () => {
    const deployer = ctx!.named.signer("deployer");
    const admin = ctx!.named.signer("admin");
    const account = ctx!.named.signer("account");
    await registry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, asSigner(deployer));
    await registry.update_role.accepted(admin, MANAGER_ROLE + FREEZELIST_MANAGER_ROLE, asSigner(admin));
    await token.initialize.accepted(
      Leo.identifier("Stable_Token"),
      Leo.identifier("STABLE_TOKEN"),
      6,
      1_000_000n,
      admin,
      asSigner(deployer),
    );
    await token.update_role.accepted(admin, MANAGER_ROLE + MINTER_ROLE, asSigner(admin));

    await expectView("sealance_freezelist_registry", "current_freeze_list_root", emptyRootField.toString());
    await expectView("sealance_freezelist_registry", "block_height_window", `${BLOCK_HEIGHT_WINDOW}u32`);
    await expectView("compliant_token_template", "balance_of", "0u128", account.address);
    await expectView("compliant_token_template", "allowance", "0u128", account.address, admin.address);
    await expectView("compliant_token_template", "supply", "0u128");
    await expectView("compliant_token_template", "max_supply", "1000000u128");
    await expectView("compliant_token_template", "decimals", "6u8");
    await expectView("compliant_token_template", "name", "Stable_Token");
    await expectView("compliant_token_template", "symbol", "STABLE_TOKEN");
  });

  test("views track approval, minting, freezing, unfreezing, and root rotation", async () => {
    const admin = ctx!.named.signer("admin");
    const account = ctx!.named.signer("account");
    const frozen = ctx!.named.signer("frozenAccount");
    await token.mint_public.accepted(account, 100n, asSigner(admin));
    await token.approve_public.accepted(admin, 25n, asSigner(account));
    await expectView("compliant_token_template", "balance_of", "100u128", account.address);
    await expectView("compliant_token_template", "allowance", "25u128", account.address, admin.address);
    await expectView("compliant_token_template", "supply", "100u128");

    const tree = buildTree(generateLeaves([frozen.address]));
    const root = fieldLiteral(tree.at(-1)!);
    await registry.update_freeze_list.accepted(frozen, true, 1, emptyRootField, root, asSigner(admin));
    await expectView("sealance_freezelist_registry", "is_frozen_address", "true", frozen.address);
    await expectView("sealance_freezelist_registry", "is_frozen_index", "true", "1u32");
    await expectView("sealance_freezelist_registry", "current_freeze_list_root", root.toString());
    await expectView("sealance_freezelist_registry", "previous_freeze_list_root", emptyRootField.toString());
    expect(await view("sealance_freezelist_registry", "root_updated_height")).toMatch(/[1-9][0-9]*u32/);

    await token.transfer_public.rejected(frozen, 1n, asSigner(account));
    await registry.update_freeze_list.accepted(frozen, false, 1, root, emptyRootField, asSigner(admin));
    await expectView("sealance_freezelist_registry", "is_frozen_address", "false", frozen.address);
    await expectView("sealance_freezelist_registry", "is_frozen_index", "false", "1u32");
  });

  test("private transfers enforce non-inclusion and emit investigator compliance records", async () => {
    const admin = ctx!.named.signer("admin");
    const deployer = ctx!.named.signer("deployer");
    const account = ctx!.named.signer("account");
    const recipient = ctx!.named.signer("recipient");
    const frozen = ctx!.named.signer("frozenAccount");
    const mint = await token.mint_private.accepted(account, 20n, asSigner(admin));
    accountRecord = await mint.outputs[1].decrypt(account);
    const mintCompliance = await mint.outputs[0].decrypt(deployer);
    expect(mintCompliance.recipient).toBe(account.address);

    const emptyTree = buildTree(generateLeaves([]));
    const proofFor = (address: string) => {
      const indices = getLeafIndices(emptyTree, address);
      return indices.map(index => toMerkleProof(getSiblingPath(emptyTree, index, MAX_TREE_DEPTH)));
    };
    const tx = await token.transfer_private.accepted(
      recipient,
      5n,
      accountRecord,
      proofFor(account.address),
      asSigner(account),
    );
    const compliance = await tx.outputs[0].decrypt(deployer);
    expect(compliance).toMatchObject({ amount: 5n, sender: account.address, recipient: recipient.address });

    const frozenMint = await token.mint_private.accepted(frozen, 10n, asSigner(admin));
    const frozenRecord = await frozenMint.outputs[1].decrypt(frozen);
    const frozenTree = buildTree(generateLeaves([frozen.address]));
    await registry.update_freeze_list.accepted(
      frozen,
      true,
      1,
      emptyRootField,
      fieldLiteral(frozenTree.at(-1)!),
      asSigner(admin),
    );
    const frozenIndices = getLeafIndices(frozenTree, frozen.address);
    const frozenProof = frozenIndices.map(index => toMerkleProof(getSiblingPath(frozenTree, index, MAX_TREE_DEPTH)));
    await token.transfer_private.failsLocally(recipient, 1n, frozenRecord, frozenProof, asSigner(frozen));
  });

  test("Policy Engine SDK reconstructs the mapping-backed freeze list and refreshes proofs after an update", async () => {
    const admin = ctx!.named.signer("admin");
    const account = ctx!.named.signer("account");
    const recipient = ctx!.named.signer("recipient");
    const frozen = ctx!.named.signer("frozenAccount");
    const programId = "sealance_freezelist_registry.aleo";
    const engine = new PolicyEngine({ endpoint: ctx!.connection.endpoint, network: "testnet" });
    const firstAddresses = [frozen.address];
    const firstRoot = buildTree(generateLeaves(firstAddresses)).at(-1)!;

    // The preceding test froze this account at index 1; index 0 is a zero-address placeholder.
    expect(await engine.fetchCurrentRoot(programId)).toBe(firstRoot);
    const firstList = await engine.fetchFreezeListFromChain(programId);
    expect(firstList).toEqual({ addresses: firstAddresses, lastIndex: 1, currentRoot: firstRoot });
    expect(firstList.addresses).not.toContain(ZERO_ADDRESS);

    const firstWitness = await engine.generateFreezeListNonInclusionProof(account.address, { programId });
    const firstTree = buildTree(generateLeaves(firstAddresses));
    expect(firstWitness.root).toBe(firstRoot);
    expect(firstWitness.freezeList).toEqual(firstAddresses);
    expect(firstWitness.proofs).toEqual(
      getLeafIndices(firstTree, account.address).map(index => getSiblingPath(firstTree, index, MAX_TREE_DEPTH)),
    );
    expect(firstWitness.proofs).toHaveLength(2);
    expect(firstWitness.proofs.every(proof => proof.siblings.length === MAX_TREE_DEPTH + 1)).toBe(true);
    await registry.verify_non_inclusion_priv.accepted(
      account,
      firstWitness.proofs.map(toMerkleProof),
      asSigner(account),
    );

    // The SDK returns a candidate for an included address; the registry must reject that candidate.
    const frozenWitness = await engine.generateFreezeListNonInclusionProof(frozen.address, { programId });
    expect(frozenWitness.freezeList).toContain(frozen.address);
    expect(frozenWitness.root).toBe(firstRoot);
    await registry.verify_non_inclusion_priv.failsLocally(
      frozen,
      frozenWitness.proofs.map(toMerkleProof),
      asSigner(frozen),
    );

    const nextAddresses = [frozen.address, recipient.address];
    const nextRoot = buildTree(generateLeaves(nextAddresses)).at(-1)!;
    await registry.update_freeze_list.accepted(
      recipient,
      true,
      2,
      fieldLiteral(firstRoot),
      fieldLiteral(nextRoot),
      asSigner(admin),
    );

    expect(nextRoot).not.toBe(firstRoot);
    expect(await engine.fetchCurrentRoot(programId)).toBe(nextRoot);
    const nextList = await engine.fetchFreezeListFromChain(programId);
    expect(nextList).toEqual({ addresses: nextAddresses, lastIndex: 2, currentRoot: nextRoot });
    expect(nextList.addresses).not.toContain(ZERO_ADDRESS);

    const nextWitness = await engine.generateFreezeListNonInclusionProof(account.address, { programId });
    const nextTree = buildTree(generateLeaves(nextAddresses));
    expect(nextWitness.root).toBe(nextRoot);
    expect(nextWitness.freezeList).toEqual(nextAddresses);
    expect(nextWitness.proofs).toEqual(
      getLeafIndices(nextTree, account.address).map(index => getSiblingPath(nextTree, index, MAX_TREE_DEPTH)),
    );
    await registry.verify_non_inclusion_priv.accepted(
      account,
      nextWitness.proofs.map(toMerkleProof),
      asSigner(account),
    );

    // Unfreezing index 1 leaves a hole while the highest assigned index stays at 2.
    const sparseAddresses = [recipient.address];
    const sparseRoot = buildTree(generateLeaves(sparseAddresses)).at(-1)!;
    await registry.update_freeze_list.accepted(
      frozen,
      false,
      1,
      fieldLiteral(nextRoot),
      fieldLiteral(sparseRoot),
      asSigner(admin),
    );
    expect(await engine.fetchCurrentRoot(programId)).toBe(sparseRoot);
    expect(await engine.fetchFreezeListFromChain(programId)).toEqual({
      addresses: sparseAddresses,
      lastIndex: 2,
      currentRoot: sparseRoot,
    });
    const sparseWitness = await engine.generateFreezeListNonInclusionProof(account.address, { programId });
    expect(sparseWitness.root).toBe(sparseRoot);
    expect(sparseWitness.freezeList).toEqual(sparseAddresses);
    await registry.verify_non_inclusion_priv.accepted(
      account,
      sparseWitness.proofs.map(toMerkleProof),
      asSigner(account),
    );
  });
});
