import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from '../contract/base-contract';
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { TREASURE_ADDRESS, fundedAmount, timeout, policies, defaultRate } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { CreditsContract } from "../artifacts/js/credits";
import { setTimelockPolicyRole, setTokenRegistryRole } from "../lib/Role";
import { decryptCompliantToken } from "../artifacts/js/leo2js/rawxtbrzce";
import { GqrfmwbtykContract } from "../artifacts/js/gqrfmwbtyk";
import { UscrpnwqsxContract } from "../artifacts/js/uscrpnwqsx";
import { RawxtbrzceContract } from "../artifacts/js/rawxtbrzce";
import { RiwoxowhvaContract } from "../artifacts/js/riwoxowhva";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// This maps the accounts defined inside networks in aleo-config.js and return array of address of respective private keys
// THE ORDER IS IMPORTANT, IT MUST MATCH THE ORDER IN THE NETWORKS CONFIG
const [deployerAddress, adminAddress, investigatorAddress, account] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const accountPrivKey = contract.getPrivateKey(account);


const creditsContract = new CreditsContract({ mode })
const tokenRegistryContract = new Token_registryContract({ mode, privateKey: adminPrivKey });
const freezeRegistryContract = new UscrpnwqsxContract({ mode })
const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode, privateKey: adminPrivKey });
const compliantThresholdTransferContract = new RiwoxowhvaContract({ mode, privateKey: adminPrivKey });
const compliantTimelockTransferContract = new RawxtbrzceContract({ mode, privateKey: adminPrivKey });

const merkleTreeContract = new Rediwsozfo_v2Contract({ mode, privateKey: adminPrivKey });
const exchangeContractForAdmin = new GqrfmwbtykContract({ mode, privateKey: adminPrivKey });
const exchangeContract = new GqrfmwbtykContract({ mode, privateKey: accountPrivKey });

const amount = 10n;

describe('test exchange contract', () => {
  test(`fund credits`, async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);
  }, timeout)

  test(`deploy needed programs`, async () => {
    await deployIfNotDeployed(tokenRegistryContract);
    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(compliantTransferContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(compliantThresholdTransferContract);
    await deployIfNotDeployed(compliantTimelockTransferContract);
    await deployIfNotDeployed(exchangeContract);

    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.compliant);
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.threshold);
    await initializeTokenProgram(deployerPrivKey, deployerAddress, adminPrivKey, adminAddress, investigatorAddress, policies.timelock);

    await setTokenRegistryRole(adminPrivKey, policies.compliant.tokenId, exchangeContract.address(), 1);
    await setTokenRegistryRole(adminPrivKey, policies.threshold.tokenId, exchangeContract.address(), 1);
    await setTimelockPolicyRole(adminPrivKey, exchangeContract.address(), 2);
  }, timeout);

  test(`test update_admin`, async () => {
    const tx = await exchangeContractForAdmin.update_admin(adminAddress);
    await tx.wait();

    const admin = await exchangeContract.admin(0);
    await expect(admin).toBe(adminAddress);

    // Only the admin can call to this function 
    let rejectedTx = await exchangeContract.update_admin(adminAddress);
    await expect(rejectedTx.wait()).rejects.toThrow();
  })

  test(`test update_rate`, async () => {
    // Only the admin account can call to this function 
    const rejectedTx = await exchangeContract.update_rate(policies.compliant.tokenId, defaultRate);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const tx = await exchangeContractForAdmin.update_rate(policies.compliant.tokenId, defaultRate);
    await tx.wait();

    const rate = await exchangeContract.token_rates(policies.compliant.tokenId, 0n);
    await expect(rate).toBe(defaultRate);
  })

  test(`test exchange_token`, async () => {
    // transaction with wrong rate will fail
    let rejectedTx = await exchangeContract.exchange_token(
      policies.compliant.tokenId,
      amount,
      defaultRate + 1n
    )
    await expect(rejectedTx.wait()).rejects.toThrow();

    let treasureBalanceBefore = await creditsContract.account(TREASURE_ADDRESS, 0n);
    let tx = await exchangeContract.exchange_token(
      policies.compliant.tokenId,
      amount,
      defaultRate
    )
    await tx.wait();
    let treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const tokenRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
    expect(tokenRecord.owner).toBe(account);
    expect(tokenRecord.token_id).toBe(policies.compliant.tokenId);
    expect(tokenRecord.amount).toBe(amount * 10n);

    treasureBalanceBefore = treasureBalanceAfter;
    tx = await exchangeContract.exchange_token(
      policies.threshold.tokenId,
      amount,
      defaultRate
    )
    await tx.wait();
    treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const thresholdTokenRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
    expect(thresholdTokenRecord.owner).toBe(account);
    expect(thresholdTokenRecord.token_id).toBe(policies.threshold.tokenId);
    expect(thresholdTokenRecord.amount).toBe(amount * 10n);
  }, timeout)

  test(`test exchange_timelock_token`, async () => {
    const treasureBalanceBefore = await creditsContract.account(TREASURE_ADDRESS, 0n);
    const tx = await exchangeContract.exchange_timelock_token(amount, defaultRate)
    await tx.wait();
    const treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const timelockTokenRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
    expect(timelockTokenRecord.owner).toBe(account);
    expect(timelockTokenRecord.token_id).toBe(policies.timelock.tokenId);
    expect(timelockTokenRecord.amount).toBe(amount * 10n);

    const compliantTokenRecord = decryptCompliantToken((tx as any).transaction.execution.transitions[2].outputs[0], accountPrivKey);
    expect(compliantTokenRecord.owner).toBe(account);
    expect(compliantTokenRecord.amount).toBe(amount * 10n);
    expect(compliantTokenRecord.locked_until).toBe(0);
  })
});

