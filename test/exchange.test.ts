import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { clearFixtures, loadFixture, setup, type TestContext } from "@lionden/testing";
import { type SignableNamedAccount } from "@lionden/config";
import { createGqrfmwbtyp } from "../typechain/Gqrfmwbtyp.js";
import { asTimelockCompliantTokenRecord, createSealedTimelockPolicy } from "../typechain/SealedTimelockPolicy.js";
import { asTokenRegistryRecord, createTokenRegistry } from "../typechain/TokenRegistry.js";
import { asSigner, fieldLiteral } from "../lib/LiondenAdapters.js";
import {
  defaultRate,
  fundedAmount,
  MANAGER_ROLE,
  MINTER_ROLE,
  policies,
  TREASURE_ADDRESS,
  amount,
} from "../lib/Constants.js";
import { fundWithCredits } from "../lib/Fund.js";
import { registerTokenProgram } from "../lib/Token.js";

const exchangeProgramAddress = createGqrfmwbtyp().address();
const reportTokenId = fieldLiteral(policies.report.tokenId);
const thresholdTokenId = fieldLiteral(policies.threshold.tokenId);
const timelockTokenId = fieldLiteral(policies.timelock.tokenId);

interface ExchangeFixture {
  readonly ctx: TestContext;
  readonly deployer: SignableNamedAccount;
  readonly admin: SignableNamedAccount;
  readonly account: SignableNamedAccount;
  readonly tokenRegistry: ReturnType<typeof createTokenRegistry>;
  readonly timelock: ReturnType<typeof createSealedTimelockPolicy>;
  readonly exchange: ReturnType<typeof createGqrfmwbtyp>;
}

async function deployFixture() {
  const ctx = await setup();

  try {
    const deployer = ctx.named.signer("deployer");
    const admin = ctx.named.signer("admin");
    const account = ctx.named.signer("account");

    await fundWithCredits(ctx, admin.address, fundedAmount, deployer);
    await fundWithCredits(ctx, account.address, fundedAmount, deployer);

    const tokenRegistry = createTokenRegistry().connect(ctx.lre);
    const timelock = createSealedTimelockPolicy().connect(ctx.lre);
    const exchange = createGqrfmwbtyp().connect(ctx.lre);

    for (const program of [
      "token_registry",
      "merkle_tree",
      "multisig_core",
      "sealed_report_policy",
      "sealance_freezelist_registry",
      "sealed_threshold_report_policy",
      "sealed_timelock_policy",
      "gqrfmwbtyp",
    ]) {
      await ctx.deploy(program, { noCompile: true });
    }

    await registerTokenProgram(tokenRegistry, deployer, admin, policies.report);
    await registerTokenProgram(tokenRegistry, deployer, admin, policies.threshold);

    await timelock.initialize.accepted(admin, asSigner(admin));

    await tokenRegistry.set_role.accepted(reportTokenId, exchangeProgramAddress, 1, asSigner(admin));
    await tokenRegistry.set_role.accepted(thresholdTokenId, exchangeProgramAddress, 1, asSigner(admin));
    await timelock.update_role.accepted(exchangeProgramAddress, MINTER_ROLE, asSigner(admin));

    return {
      ctx,
      deployer,
      admin,
      account,
      tokenRegistry,
      timelock,
      exchange,
    } satisfies ExchangeFixture;
  } catch (error) {
    await ctx.teardown();
    throw error;
  }
}

let state: ExchangeFixture | undefined;

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

describe("test exchange contract", () => {
  test("test initialize", async () => {
    const fixture = state!;

    if (fixture.deployer.address !== fixture.admin.address) {
      // The caller is not the initial admin
      await fixture.exchange.initialize.rejected(fixture.admin, asSigner(fixture.deployer));
    }

    await fixture.exchange.initialize.accepted(fixture.admin, asSigner(fixture.admin));

    const role = await fixture.exchange.mappings.addressToRole.get(fixture.admin);
    expect(role).toBe(MANAGER_ROLE);
    const initialized = await fixture.exchange.mappings.initialized.get(true);
    expect(initialized).toBe(true);

    // It is possible to call to initialize only one time
    await fixture.exchange.initialize.rejected(fixture.admin, asSigner(fixture.admin));
  });

  test("test update_admin", async () => {
    const fixture = state!;

    await fixture.exchange.update_role.accepted(fixture.admin, MANAGER_ROLE, asSigner(fixture.admin));

    const role = await fixture.exchange.mappings.addressToRole.get(fixture.admin);
    expect(role).toBe(MANAGER_ROLE);

    // Only the admin can call to this function
    await fixture.exchange.update_role.rejected(fixture.admin, MANAGER_ROLE, asSigner(fixture.account));
  });

  test("test update_rate", async () => {
    const fixture = state!;

    // Only the admin account can call to this function
    await fixture.exchange.update_rate.rejected(reportTokenId, defaultRate, asSigner(fixture.account));

    await fixture.exchange.update_rate.accepted(reportTokenId, defaultRate, asSigner(fixture.admin));

    const rate = await fixture.exchange.mappings.tokenRates.get(reportTokenId);
    expect(rate).toBe(defaultRate);
  });

  test("test exchange_token", async () => {
    const fixture = state!;

    // transaction with wrong rate will fail
    await fixture.exchange.exchange_token.rejected(reportTokenId, amount, defaultRate + 1n, asSigner(fixture.account));

    let treasureBalanceBefore = await fixture.ctx.connection.getBalance(TREASURE_ADDRESS);
    let exchangeToken = await fixture.exchange.exchange_token.accepted(
      reportTokenId,
      amount,
      defaultRate,
      asSigner(fixture.account),
    );
    let treasureBalanceAfter = await fixture.ctx.connection.getBalance(TREASURE_ADDRESS);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const tokenRecord = await exchangeToken.outputs
      .match(asTokenRegistryRecord.output.from("mint_private", 0))
      .decrypt(fixture.account);
    expect(tokenRecord.owner).toBe(fixture.account.address);
    expect(tokenRecord.token_id).toBe(reportTokenId);
    expect(tokenRecord.amount).toBe(amount * 10n);

    treasureBalanceBefore = treasureBalanceAfter;
    exchangeToken = await fixture.exchange.exchange_token.accepted(
      thresholdTokenId,
      amount,
      defaultRate,
      asSigner(fixture.account),
    );
    treasureBalanceAfter = await fixture.ctx.connection.getBalance(TREASURE_ADDRESS);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const thresholdTokenRecord = await exchangeToken.outputs
      .match(asTokenRegistryRecord.output.from("mint_private", 0))
      .decrypt(fixture.account);
    expect(thresholdTokenRecord.owner).toBe(fixture.account.address);
    expect(thresholdTokenRecord.token_id).toBe(thresholdTokenId);
    expect(thresholdTokenRecord.amount).toBe(amount * 10n);
  });

  test("test exchange_timelock_token", async () => {
    const fixture = state!;

    const treasureBalanceBefore = await fixture.ctx.connection.getBalance(TREASURE_ADDRESS);
    const exchangeTimelock = await fixture.exchange.exchange_timelock_token.accepted(
      amount,
      defaultRate,
      asSigner(fixture.account),
    );
    const treasureBalanceAfter = await fixture.ctx.connection.getBalance(TREASURE_ADDRESS);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const timelockTokenRecord = await exchangeTimelock.outputs[1]
      .match(asTokenRegistryRecord.output.from("mint_private", 0))
      .decrypt(fixture.account);
    expect(timelockTokenRecord.owner).toBe(fixture.account.address);
    expect(timelockTokenRecord.token_id).toBe(timelockTokenId);
    expect(timelockTokenRecord.amount).toBe(amount * 10n);

    const compliantTokenRecord = await exchangeTimelock.outputs[0]
      .match(asTimelockCompliantTokenRecord.output.from("mint_private", 0))
      .decrypt(fixture.account);
    expect(compliantTokenRecord.owner).toBe(fixture.account.address);
    expect(compliantTokenRecord.amount).toBe(amount * 10n);
    expect(compliantTokenRecord.locked_until).toBe(0);
  });
});
