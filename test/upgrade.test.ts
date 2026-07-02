import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import {
  BLOCK_HEIGHT_WINDOW,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  fundedAmount,
  MAX_BLOCK_HEIGHT,
  SETUP_TIMEOUT_MS,
  zeroAddress,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { getDeployedProgramChecksum, getProgramEdition, upgradeProgram } from "../lib/Upgrade.js";
import { asSigner } from "../lib/LiondenAdapters.js";
import { approveRequest, createWallet, initializeMultisig } from "../lib/Multisig.js";
import { Leo } from "../typechain/BaseContract.js";
import { createMultisigCore } from "../typechain/MultisigCore.js";
import { createMultisigFreezelistRegistry } from "../typechain/MultisigFreezelistRegistry.js";
import { Address } from "@provablehq/sdk";

interface UpgradeFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly signer1: SignableNamedAccount;
  readonly signer2: SignableNamedAccount;
  readonly freezeRegistry: ReturnType<typeof createMultisigFreezelistRegistry>;
  readonly multisig: ReturnType<typeof createMultisigCore>;
  readonly freezeRegistryAddress: ReturnType<typeof Leo.address>;
}

const freezeRegistryAddress = createMultisigFreezelistRegistry().address();

async function deployFixture() {
  const ctx = await setup();

  try {
    // This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
    // THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
    const deployer = ctx.named.signer("deployer");
    const admin = ctx.named.signer("admin");
    const signer1 = ctx.named.signer("signer1");
    const signer2 = ctx.named.signer("signer2");

    const freezeRegistry = createMultisigFreezelistRegistry().connect(ctx.lre);
    const multisig = createMultisigCore().connect(ctx.lre);

    await fundWithCredits(ctx, admin.address, fundedAmount, deployer);
    await fundWithCredits(ctx, signer1.address, fundedAmount, deployer);
    await fundWithCredits(ctx, signer2.address, fundedAmount, deployer);

    for (const program of ["merkle_tree", "multisig_core", "multisig_freezelist_registry"]) {
      await ctx.deploy(program, { noCompile: true });
    }

    if (!(await freezeRegistry.mappings.freezeListRoot.contains(CURRENT_FREEZE_LIST_ROOT_INDEX))) {
      await freezeRegistry.initialize.accepted(admin, BLOCK_HEIGHT_WINDOW, zeroAddress, asSigner(admin));
    }

    // Create the wallets
    await initializeMultisig(multisig, deployer);
    await createWallet(multisig, deployer, freezeRegistryAddress, [signer1, signer2, zeroAddress, zeroAddress]);

    return {
      ctx,
      deployer,
      admin,
      signer1,
      signer2,
      freezeRegistry,
      multisig,
      freezeRegistryAddress,
    } satisfies UpgradeFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: UpgradeFixture | undefined;

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

// await ctx!.lre.tasks.run("upgrade", { program: "admin_example" });
describe("test upgradeability", () => {
  test(`test upgrades`, async () => {
    const fixture = state!;

    // It shouldn't be possible to upgrade the merkle_Tree program
    const merkleTreeEditionBefore = await getProgramEdition(fixture.ctx, "merkle_tree");
    let isUpgradeSuccessful = await upgradeProgram(fixture.ctx, "merkle_tree");
    const merkleTreeEditionAfter = await getProgramEdition(fixture.ctx, "merkle_tree");
    expect(isUpgradeSuccessful).toBe(false);
    expect(merkleTreeEditionBefore).toBe(merkleTreeEditionAfter);

    // Only The multisig can upgrade the freeze registry program
    // upgrade by a multisig request
    const freezeRegistryEditionBefore = await getProgramEdition(fixture.ctx, "multisig_freezelist_registry");
    const freezeRegistryUpgradeEdition = freezeRegistryEditionBefore + 1; // getProgramUpgradeEdition(fixture.ctx, "multisig_freezelist_registry");
    const checksum = await getDeployedProgramChecksum(fixture.ctx, "multisig_freezelist_registry");
    const getSigningOpIdForDeployTx = await fixture.freezeRegistry.get_signing_op_id_for_deploy.accepted(
      checksum,
      freezeRegistryUpgradeEdition,
      asSigner(fixture.deployer),
    );
    const signingOpId = await getSigningOpIdForDeployTx.outputs.decrypt(fixture.deployer);
    await fixture.multisig.initiate_signing_op.accepted(
      fixture.freezeRegistryAddress,
      signingOpId,
      MAX_BLOCK_HEIGHT,
      asSigner(fixture.deployer),
    );
    // The upgrade fail because the multisig request is not approved yet
    isUpgradeSuccessful = await upgradeProgram(fixture.ctx, "multisig_freezelist_registry");
    let freezeRegistryTreeEditionAfter = await getProgramEdition(fixture.ctx, "multisig_freezelist_registry");
    expect(isUpgradeSuccessful).toBe(false);
    expect(freezeRegistryEditionBefore).toBe(freezeRegistryTreeEditionAfter);

    await approveRequest(fixture.ctx, [fixture.signer1, fixture.signer2], fixture.freezeRegistryAddress, signingOpId);

    isUpgradeSuccessful = await upgradeProgram(fixture.ctx, "multisig_freezelist_registry");
    freezeRegistryTreeEditionAfter = await getProgramEdition(fixture.ctx, "multisig_freezelist_registry");
    expect(isUpgradeSuccessful).toBe(true);
    expect(freezeRegistryEditionBefore + 1).toBe(freezeRegistryTreeEditionAfter);
  });
});
