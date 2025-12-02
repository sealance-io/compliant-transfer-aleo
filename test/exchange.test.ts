import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { TREASURE_ADDRESS, fundedAmount, policies, defaultRate, ADMIN_INDEX } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { registerTokenProgram } from "../lib/Token";
import { CreditsContract } from "../artifacts/js/credits";
import { setTokenRegistryRole, updateMinterRole } from "../lib/Role";
import { decryptCompliantToken } from "../artifacts/js/leo2js/sealed_timelock_policy";
import { GqrfmwbtypContract } from "../artifacts/js/gqrfmwbtyp";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";
import { initializeProgram } from "../lib/Initalize";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, investigatorAddress, _, account] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);

const creditsContract = new CreditsContract({
  mode,
  privateKey: deployerPrivKey,
});
const tokenRegistryContract = new Token_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const reportPolicyContract = new Sealed_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const thresholdContract = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const timelockContract = new Sealed_timelock_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const timelockContractForAdmin = new Sealed_timelock_policyContract({
  mode,
  privateKey: adminPrivKey,
});
const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const exchangeContract = new GqrfmwbtypContract({
  mode,
  privateKey: deployerPrivKey,
});
const exchangeContractForAdmin = new GqrfmwbtypContract({
  mode,
  privateKey: adminPrivKey,
});
const exchangeContractForAccount = new GqrfmwbtypContract({
  mode,
  privateKey: accountPrivKey,
});
const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});

const amount = 10n;

describe("test exchange contract", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);

    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(reportPolicyContract);
    await deployIfNotDeployed(multiSigContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(thresholdContract);
    await deployIfNotDeployed(timelockContract);
    await deployIfNotDeployed(exchangeContract);

    await registerTokenProgram(deployerPrivKey, deployerAddress, adminAddress, policies.report);
    await registerTokenProgram(deployerPrivKey, deployerAddress, adminAddress, policies.threshold);

    await initializeProgram(timelockContractForAdmin, [adminAddress]);

    await setTokenRegistryRole(adminPrivKey, policies.report.tokenId, exchangeContract.address(), 1);
    await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
    await updateMinterRole(timelockContractForAdmin, exchangeContract.address());
  });

  test(`test initialize`, async () => {
    if (deployerAddress !== adminAddress) {
      // The caller is not the initial admin
      const rejectedTx = await exchangeContract.initialize(adminAddress);
      await expect(rejectedTx.wait()).rejects.toThrow();
    }

    const tx = await exchangeContractForAdmin.initialize(adminAddress);
    await tx.wait();

    const admin = await exchangeContract.roles(ADMIN_INDEX);
    expect(admin).toBe(adminAddress);

    // It is possible to call to initialize only one time
    const rejectedTx = await exchangeContractForAdmin.initialize(adminAddress);
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_admin`, async () => {
    const tx = await exchangeContractForAdmin.update_role(adminAddress, ADMIN_INDEX);
    await tx.wait();

    const admin = await exchangeContract.roles(ADMIN_INDEX);
    expect(admin).toBe(adminAddress);

    // Only the admin can call to this function
    const rejectedTx = await exchangeContractForAccount.update_role(adminAddress, ADMIN_INDEX);
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test update_rate`, async () => {
    // Only the admin account can call to this function
    const rejectedTx = await exchangeContractForAccount.update_rate(policies.report.tokenId, defaultRate);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await exchangeContractForAdmin.update_rate(policies.report.tokenId, defaultRate);
    await tx.wait();

    const rate = await exchangeContract.token_rates(policies.report.tokenId, 0n);
    expect(rate).toBe(defaultRate);
  });

  test(`test exchange_token`, async () => {
    // transaction with wrong rate will fail
    const rejectedTx = await exchangeContractForAccount.exchange_token(
      policies.report.tokenId,
      amount,
      defaultRate + 1n,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    let treasureBalanceBefore = await creditsContract.account(TREASURE_ADDRESS, 0n);
    let tx = await exchangeContractForAccount.exchange_token(policies.report.tokenId, amount, defaultRate);
    await tx.wait();
    let treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const tokenRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
    expect(tokenRecord.owner).toBe(account);
    expect(tokenRecord.token_id).toBe(policies.report.tokenId);
    expect(tokenRecord.amount).toBe(amount * 10n);

    treasureBalanceBefore = treasureBalanceAfter;
    tx = await exchangeContractForAccount.exchange_token(policies.threshold.tokenId, amount, defaultRate);
    await tx.wait();
    treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const thresholdTokenRecord = decryptToken(
      (tx as any).transaction.execution.transitions[1].outputs[0],
      accountPrivKey,
    );
    expect(thresholdTokenRecord.owner).toBe(account);
    expect(thresholdTokenRecord.token_id).toBe(policies.threshold.tokenId);
    expect(thresholdTokenRecord.amount).toBe(amount * 10n);
  });

  test(`test exchange_timelock_token`, async () => {
    const treasureBalanceBefore = await creditsContract.account(TREASURE_ADDRESS, 0n);
    const tx = await exchangeContractForAccount.exchange_timelock_token(amount, defaultRate);
    await tx.wait();
    const treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const timelockTokenRecord = decryptToken(
      (tx as any).transaction.execution.transitions[1].outputs[0],
      accountPrivKey,
    );
    expect(timelockTokenRecord.owner).toBe(account);
    expect(timelockTokenRecord.token_id).toBe(policies.timelock.tokenId);
    expect(timelockTokenRecord.amount).toBe(amount * 10n);

    const compliantTokenRecord = decryptCompliantToken(
      (tx as any).transaction.execution.transitions[2].outputs[0],
      accountPrivKey,
    );
    expect(compliantTokenRecord.owner).toBe(account);
    expect(compliantTokenRecord.amount).toBe(amount * 10n);
    expect(compliantTokenRecord.locked_until).toBe(0);
  });
});
