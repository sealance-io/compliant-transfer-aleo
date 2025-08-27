import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from "../contract/base-contract";
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Sealed_report_policyContract } from "../artifacts/js/sealed_report_policy";
import { TREASURE_ADDRESS, fundedAmount, timeout, policies, defaultRate, ADMIN_INDEX } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { CreditsContract } from "../artifacts/js/credits";
import { setTokenRegistryRole, updateMinterRole } from "../lib/Role";
import { decryptCompliantToken } from "../artifacts/js/leo2js/sealed_timelock_policy";
import { GqrfmwbtypContract } from "../artifacts/js/gqrfmwbtyp";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Sealed_timelock_policyContract } from "../artifacts/js/sealed_timelock_policy";
import { Sealed_threshold_report_policyContract } from "../artifacts/js/sealed_threshold_report_policy";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, investigatorAddress, account] = contract.getAccounts();
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
const compliantTransferContract = new Sealed_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantThresholdTransferContract = new Sealed_threshold_report_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantTimelockTransferContract = new Sealed_timelock_policyContract({
  mode,
  privateKey: deployerPrivKey,
});
const compliantTimelockTransferContractForAdmin = new Sealed_timelock_policyContract({
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

const amount = 10n;

describe("test exchange contract", () => {

  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);

    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(compliantThresholdTransferContract);
    await deployIfNotDeployed(compliantTimelockTransferContract);
    await deployIfNotDeployed(exchangeContract);

    await initializeTokenProgram(
      deployerPrivKey,
      deployerAddress,
      adminPrivKey,
      adminAddress,
      investigatorAddress,
      policies.compliant,
    );
    await initializeTokenProgram(
      deployerPrivKey,
      deployerAddress,
      adminPrivKey,
      adminAddress,
      investigatorAddress,
      policies.threshold,
    );
    await initializeTokenProgram(
      deployerPrivKey,
      deployerAddress,
      adminPrivKey,
      adminAddress,
      investigatorAddress,
      policies.timelock,
    );

    await setTokenRegistryRole(adminPrivKey, policies.compliant.tokenId, exchangeContract.address(), 1);
    await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
    await updateMinterRole(compliantTimelockTransferContractForAdmin, exchangeContract.address());
  });

  test(
    `test update_admin`,
    async () => {
      const tx = await exchangeContractForAdmin.update_role(adminAddress, ADMIN_INDEX);
      await tx.wait();

      const admin = await exchangeContract.roles(ADMIN_INDEX);
      await expect(admin).toBe(adminAddress);

      // Only the admin can call to this function
      const rejectedTx = await exchangeContractForAccount.update_role(adminAddress, ADMIN_INDEX);
      await expect(rejectedTx.wait()).rejects.toThrow();
    },
    timeout,
  );

  test(
    `test update_rate`,
    async () => {
      // Only the admin account can call to this function
      const rejectedTx = await exchangeContractForAccount.update_rate(policies.compliant.tokenId, defaultRate);
      await expect(rejectedTx.wait()).rejects.toThrow();

      const tx = await exchangeContractForAdmin.update_rate(policies.compliant.tokenId, defaultRate);
      await tx.wait();

      const rate = await exchangeContract.token_rates(policies.compliant.tokenId, 0n);
      await expect(rate).toBe(defaultRate);
    },
    timeout,
  );

  test(
    `test exchange_token`,
    async () => {
      // transaction with wrong rate will fail
      const rejectedTx = await exchangeContractForAccount.exchange_token(
        policies.compliant.tokenId,
        amount,
        defaultRate + 1n,
      );
      await expect(rejectedTx.wait()).rejects.toThrow();

      let treasureBalanceBefore = await creditsContract.account(TREASURE_ADDRESS, 0n);
      let tx = await exchangeContractForAccount.exchange_token(policies.compliant.tokenId, amount, defaultRate);
      await tx.wait();
      let treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
      expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

      const tokenRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
      expect(tokenRecord.owner).toBe(account);
      expect(tokenRecord.token_id).toBe(policies.compliant.tokenId);
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
    },
    timeout,
  );

  test(
    `test exchange_timelock_token`,
    async () => {
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
    },
    timeout,
  );
});
