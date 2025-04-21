import { ExecutionMode } from "@doko-js/core";

import { BaseContract } from '../contract/base-contract';
import { Token_registryContract } from "../artifacts/js/token_registry";
import { decryptToken } from "../artifacts/js/leo2js/token_registry";
import { Rediwsozfo_v2Contract } from "../artifacts/js/rediwsozfo_v2";
import { Tqxftxoicd_v2Contract } from "../artifacts/js/tqxftxoicd_v2";
import { TREASURE_ADDRESS, fundedAmount, timeout, policies, COMPLIANT_THRESHOLD_TRANSFER_ADDRESS } from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { initializeTokenProgram } from "../lib/Token";
import { ExchangeContract } from "../artifacts/js/exchange";
import { CreditsContract } from "../artifacts/js/credits";
import { setTimelockPolicyRole, setTokenRegistryRole } from "../lib/Role";
import { Compliant_threshold_transferContract } from "../artifacts/js/compliant_threshold_transfer";
import { Compliant_timelock_transferContract } from "../artifacts/js/compliant_timelock_transfer";
import { Freeze_registryContract } from "../artifacts/js/freeze_registry";
import { decryptCompliantToken } from "../artifacts/js/leo2js/compliant_timelock_transfer";

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
const freezeRegistryContract = new Freeze_registryContract({ mode })
const compliantTransferContract = new Tqxftxoicd_v2Contract({ mode, privateKey: adminPrivKey });
const compliantThresholdTransferContract = new Compliant_threshold_transferContract({ mode, privateKey: adminPrivKey });
const compliantTimelockTransferContract = new Compliant_timelock_transferContract({ mode, privateKey: adminPrivKey });

const merkleTreeContract = new Rediwsozfo_v2Contract({ mode, privateKey: adminPrivKey });
const exchangeContract = new ExchangeContract({ mode, privateKey: accountPrivKey });

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

  test(`test exchange program`, async () => {
    let treasureBalanceBefore = await creditsContract.account(TREASURE_ADDRESS, 0n);
    let tx = await exchangeContract.exchange_token(
      policies.compliant.tokenId,
      amount
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
      amount
    )
    await tx.wait();
    treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const thresholdTokenRecord = decryptToken((tx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
    expect(thresholdTokenRecord.owner).toBe(account);
    expect(thresholdTokenRecord.token_id).toBe(policies.threshold.tokenId);
    expect(thresholdTokenRecord.amount).toBe(amount * 10n);

    treasureBalanceBefore = treasureBalanceAfter;
    const exchangeTimelockTx = await exchangeContract.exchange_timelock_token(amount)
    await exchangeTimelockTx.wait();
    treasureBalanceAfter = await creditsContract.account(TREASURE_ADDRESS, 0n);
    expect(treasureBalanceBefore + amount).toBe(treasureBalanceAfter);

    const timelockTokenRecord = decryptToken((exchangeTimelockTx as any).transaction.execution.transitions[1].outputs[0], accountPrivKey);
    expect(timelockTokenRecord.owner).toBe(account);
    expect(timelockTokenRecord.token_id).toBe(policies.timelock.tokenId);
    expect(timelockTokenRecord.amount).toBe(amount * 10n);
    
    const compliantTokenRecord = decryptCompliantToken((exchangeTimelockTx as any).transaction.execution.transitions[2].outputs[0], accountPrivKey);
    expect(compliantTokenRecord.owner).toBe(account);
    expect(compliantTokenRecord.amount).toBe(amount * 10n);
    expect(compliantTokenRecord.locked_until).toBe(0);
  }, timeout)
});

