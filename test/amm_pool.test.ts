import { ExecutionMode } from "@doko-js/core";
import { BaseContract } from "../contract/base-contract";
import {
  BLOCK_HEIGHT_WINDOW,
  BLOCK_HEIGHT_WINDOW_INDEX,
  BURNER_ROLE,
  CURRENT_FREEZE_LIST_ROOT_INDEX,
  FREEZELIST_MANAGER_ROLE,
  FREEZE_LIST_LAST_INDEX,
  MANAGER_ROLE,
  MAX_TREE_DEPTH,
  MINTER_ROLE,
  NONE_ROLE,
  fundedAmount,
} from "../lib/Constants";
import { fundWithCredits } from "../lib/Fund";
import { deployIfNotDeployed } from "../lib/Deploy";
import { getLeafIndices, getSiblingPath } from "../lib/FreezeList";
import { initializeProgram } from "../lib/Initalize";
import {
  buildTree,
  calculateAddLiquidityQuote,
  calculateExchangeQuote,
  calculateRemoveLiquidityQuote,
  generateLeaves,
  sleep,
  stringToBigInt,
} from "@sealance-io/policy-engine-aleo";
import { Merkle_treeContract } from "../artifacts/js/merkle_tree";
import { Multisig_coreContract } from "../artifacts/js/multisig_core";
import { Sealance_freezelist_registryContract } from "../artifacts/js/sealance_freezelist_registry";
import { Stable_token_1Contract } from "../artifacts/js/stable_token_1";
import { Stable_token_2Contract } from "../artifacts/js/stable_token_2";
import { Lp_tokenContract } from "../artifacts/js/lp_token";
import { Amm_poolContract } from "../artifacts/js/amm_pool";
import { decryptToken as decryptStableToken1 } from "../artifacts/js/leo2js/stable_token_1";
import { decryptToken as decryptStableToken2 } from "../artifacts/js/leo2js/stable_token_2";
import { decryptToken as decryptLpToken } from "../artifacts/js/leo2js/lp_token";
import {
  decryptLP_Voucher,
  decryptStable_Token_1_Voucher,
  decryptStable_Token_2_Voucher,
} from "../artifacts/js/leo2js/amm_pool";
import { Token as StableToken1Token } from "../artifacts/js/types/stable_token_1";
import { Token as StableToken2Token } from "../artifacts/js/types/stable_token_2";
import { Token as LpToken } from "../artifacts/js/types/lp_token";
import { LP_Voucher, Stable_Token_1_Voucher, Stable_Token_2_Voucher } from "../artifacts/js/types/amm_pool";
import { updateAddressToRole } from "../lib/Role";

const mode = ExecutionMode.SnarkExecute;
const contract = new BaseContract({ mode });

// The order must match the configured accounts in aleo-config.js.
const [deployerAddress, adminAddress, , frozenAccount, account] = contract.getAccounts();
const deployerPrivKey = contract.getPrivateKey(deployerAddress);
const adminPrivKey = contract.getPrivateKey(adminAddress);
const frozenAccountPrivKey = contract.getPrivateKey(frozenAccount);
const accountPrivKey = contract.getPrivateKey(account);

const merkleTreeContract = new Merkle_treeContract({
  mode,
  privateKey: deployerPrivKey,
});
const multiSigContract = new Multisig_coreContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContract = new Sealance_freezelist_registryContract({
  mode,
  privateKey: deployerPrivKey,
});
const freezeRegistryContractForAdmin = new Sealance_freezelist_registryContract({
  mode,
  privateKey: adminPrivKey,
});

const stableToken1Contract = new Stable_token_1Contract({
  mode,
  privateKey: deployerPrivKey,
});
const stableToken1ContractForAdmin = new Stable_token_1Contract({
  mode,
  privateKey: adminPrivKey,
});

const stableToken2Contract = new Stable_token_2Contract({
  mode,
  privateKey: deployerPrivKey,
});
const stableToken2ContractForAdmin = new Stable_token_2Contract({
  mode,
  privateKey: adminPrivKey,
});

const lpTokenContract = new Lp_tokenContract({
  mode,
  privateKey: deployerPrivKey,
});
const lpTokenContractForAdmin = new Lp_tokenContract({
  mode,
  privateKey: adminPrivKey,
});

const ammPoolContract = new Amm_poolContract({
  mode,
  privateKey: deployerPrivKey,
});
const ammPoolContractForAdmin = new Amm_poolContract({
  mode,
  privateKey: adminPrivKey,
});
const ammPoolContractForFrozenAccount = new Amm_poolContract({
  mode,
  privateKey: frozenAccountPrivKey,
});
const ammPoolContractForAccount = new Amm_poolContract({
  mode,
  privateKey: accountPrivKey,
});

const stableToken1Name = stringToBigInt("Stable Token 1");
const stableToken2Name = stringToBigInt("Stable Token 2");
const lpTokenName = stringToBigInt("LP Token");

const stableToken1Symbol = stringToBigInt("STABLE_TKN_1");
const stableToken2Symbol = stringToBigInt("STABLE_TKN_2");
const lpTokenSymbol = stringToBigInt("LP_TOKEN");

const decimals = 6;
const maxSupply = 1_000_000_000_000_000n;
const tokenAdminRole = MANAGER_ROLE + MINTER_ROLE + BURNER_ROLE;
const ammLpRole = MINTER_ROLE + BURNER_ROLE;

const initialMintAmount = 300_000n;
const initialDepositToken1 = 100_000n;
const initialDepositToken2 = 100_000n;
const secondDepositToken1 = 20_000n;
const secondDepositToken2 = 18_000n;
const exchange1For2Input = 10_000n;
const exchange2For1Input = 8_000n;
const adminFeeSeedToken1 = 3_000n;
const adminFeeSeedToken2 = 2_000n;

const STORAGE_KEY = false;

const initialLpVoucherId = 101n;
const secondLpVoucherId = 102n;
const exchangeToken2VoucherId = 201n;
const exchangeToken1VoucherId = 202n;
const removeLiquidityToken1VoucherId = 301n;
const removeLiquidityToken2VoucherId = 302n;
const frozenExchangeToken2RejectedVoucherId = 1002n;
const optimisticExchangeToken2RejectedVoucherId = 902n;
const frozenExchangeToken1RejectedVoucherId = 1003n;
const optimisticExchangeToken1RejectedVoucherId = 903n;
const optimisticRemoveLiquidityToken1VoucherId = 904n;
const optimisticRemoveLiquidityToken2VoucherId = 905n;

function subtractBuffer(amount: bigint, buffer: bigint): bigint {
  return amount > buffer ? amount - buffer : 0n;
}

async function waitForOutputs(tx: { wait: () => Promise<unknown> }) {
  return (await tx.wait()) as any[];
}

async function getPoolState() {
  return {
    stableToken1Balance: await ammPoolContract.stable_token_1_balance__(STORAGE_KEY, 0n),
    stableToken2Balance: await ammPoolContract.stable_token_2_balance__(STORAGE_KEY, 0n),
    stableToken1Reserved: await ammPoolContract.stable_token_1_reserved__(STORAGE_KEY, 0n),
    stableToken2Reserved: await ammPoolContract.stable_token_2_reserved__(STORAGE_KEY, 0n),
    lpTokenReserved: await ammPoolContract.lp_token_reserved__(STORAGE_KEY, 0n),
  };
}

async function getLpTotalSupply() {
  const tokenInfo = await lpTokenContract.token_info(true);
  const lpTokenReserved = await ammPoolContract.lp_token_reserved__(STORAGE_KEY, 0n);
  return tokenInfo.supply + lpTokenReserved;
}

async function assertPoolBalances(stableToken1Balance: bigint, stableToken2Balance: bigint) {
  expect(await ammPoolContract.stable_token_1_balance__(STORAGE_KEY)).toBe(stableToken1Balance);
  expect(await ammPoolContract.stable_token_2_balance__(STORAGE_KEY)).toBe(stableToken2Balance);
}

let root: bigint;
let accountMerkleProof: { siblings: any[]; leaf_index: any }[];
let frozenAccountMerkleProof: { siblings: any[]; leaf_index: any }[];

let frozenAccountStableToken1Record: StableToken1Token;
let frozenAccountStableToken2Record: StableToken2Token;
let accountStableToken1Record: StableToken1Token;
let accountStableToken2Record: StableToken2Token;

let initialLpTokenRecord: LpToken;
let redeemedLpTokenRecord: LpToken;
let initialLpVoucherRecord: LP_Voucher;

let exchangeToken2VoucherRecord: Stable_Token_2_Voucher;
let exchangeToken1VoucherRecord: Stable_Token_1_Voucher;
let removeLiquidityToken1VoucherRecord: Stable_Token_1_Voucher;
let removeLiquidityToken2VoucherRecord: Stable_Token_2_Voucher;
let secondLpVoucherRecord: LP_Voucher;

describe("test amm pool program", () => {
  beforeAll(async () => {
    await fundWithCredits(deployerPrivKey, adminAddress, fundedAmount);
    await fundWithCredits(deployerPrivKey, frozenAccount, fundedAmount);
    await fundWithCredits(deployerPrivKey, account, fundedAmount);

    await deployIfNotDeployed(merkleTreeContract);
    await deployIfNotDeployed(multiSigContract);
    await deployIfNotDeployed(freezeRegistryContract);
    await deployIfNotDeployed(stableToken1Contract);
    await deployIfNotDeployed(stableToken2Contract);
    await deployIfNotDeployed(lpTokenContract);
    await deployIfNotDeployed(ammPoolContract);

    const leaves = generateLeaves([frozenAccount]);
    const tree = buildTree(leaves);
    root = tree[tree.length - 1];

    const accountLeafIndices = getLeafIndices(tree, account);
    const frozenAccountLeafIndices = getLeafIndices(tree, frozenAccount);

    accountMerkleProof = [
      getSiblingPath(tree, accountLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, accountLeafIndices[1], MAX_TREE_DEPTH),
    ];
    frozenAccountMerkleProof = [
      getSiblingPath(tree, frozenAccountLeafIndices[0], MAX_TREE_DEPTH),
      getSiblingPath(tree, frozenAccountLeafIndices[1], MAX_TREE_DEPTH),
    ];

    await initializeProgram(stableToken1Contract, [
      stableToken1Name,
      stableToken1Symbol,
      decimals,
      maxSupply,
      adminAddress,
    ]);
    await initializeProgram(stableToken2Contract, [
      stableToken2Name,
      stableToken2Symbol,
      decimals,
      maxSupply,
      adminAddress,
    ]);
    await initializeProgram(lpTokenContract, [lpTokenName, lpTokenSymbol, decimals, maxSupply, adminAddress]);
    await initializeProgram(freezeRegistryContract, [adminAddress, BLOCK_HEIGHT_WINDOW]);

    await updateAddressToRole(freezeRegistryContractForAdmin, adminAddress, MANAGER_ROLE + FREEZELIST_MANAGER_ROLE);

    if (!(await freezeRegistryContract.freeze_list(frozenAccount, false))) {
      const currentRoot = await freezeRegistryContract.freeze_list_root(CURRENT_FREEZE_LIST_ROOT_INDEX);
      const lastIndex = await freezeRegistryContract.freeze_list_last_index(FREEZE_LIST_LAST_INDEX);
      const tx = await freezeRegistryContractForAdmin.update_freeze_list(
        frozenAccount,
        true,
        lastIndex + 1,
        currentRoot,
        root,
      );
      await tx.wait();
    }

    await updateAddressToRole(stableToken1ContractForAdmin, adminAddress, tokenAdminRole);
    await updateAddressToRole(stableToken2ContractForAdmin, adminAddress, tokenAdminRole);
    await updateAddressToRole(lpTokenContractForAdmin, adminAddress, tokenAdminRole);
    await updateAddressToRole(lpTokenContractForAdmin, ammPoolContract.address(), ammLpRole);

    const mintAccountStableToken1Tx = await stableToken1ContractForAdmin.mint_private(account, initialMintAmount);
    const [, encryptedAccountStableToken1Record] = await waitForOutputs(mintAccountStableToken1Tx);
    accountStableToken1Record = decryptStableToken1(encryptedAccountStableToken1Record, accountPrivKey);

    const mintFrozenStableToken1Tx = await stableToken1ContractForAdmin.mint_private(frozenAccount, initialMintAmount);
    const [, encryptedFrozenStableToken1Record] = await waitForOutputs(mintFrozenStableToken1Tx);
    frozenAccountStableToken1Record = decryptStableToken1(encryptedFrozenStableToken1Record, frozenAccountPrivKey);

    const mintAccountStableToken2Tx = await stableToken2ContractForAdmin.mint_private(account, initialMintAmount);
    const [, encryptedAccountStableToken2Record] = await waitForOutputs(mintAccountStableToken2Tx);
    accountStableToken2Record = decryptStableToken2(encryptedAccountStableToken2Record, accountPrivKey);

    const mintFrozenStableToken2Tx = await stableToken2ContractForAdmin.mint_private(frozenAccount, initialMintAmount);
    const [, encryptedFrozenStableToken2Record] = await waitForOutputs(mintFrozenStableToken2Tx);
    frozenAccountStableToken2Record = decryptStableToken2(encryptedFrozenStableToken2Record, frozenAccountPrivKey);
  });

  test(`test initialize`, async () => {
    expect(await ammPoolContract.initialized(true, false)).toBe(false);

    if (deployerAddress !== adminAddress) {
      const rejectedTx = await ammPoolContract.initialize();
      await expect(rejectedTx.wait()).rejects.toThrow();
    }

    const tx = await ammPoolContractForAdmin.initialize();
    await tx.wait();

    await assertPoolBalances(0n, 0n);
    expect(await ammPoolContract.initialized(true)).toBe(true);
    expect(await ammPoolContract.stable_token_1_reserved__(STORAGE_KEY)).toBe(0n);
    expect(await ammPoolContract.stable_token_2_reserved__(STORAGE_KEY)).toBe(0n);
    expect(await ammPoolContract.lp_token_reserved__(STORAGE_KEY)).toBe(0n);

    const rejectedTx = await ammPoolContractForAdmin.initialize();
    await expect(rejectedTx.wait()).rejects.toThrow();
  });

  test(`test add_liquidity`, async () => {
    // The first liquidity deposit should use the initial-liquidity branch.
    const initialQuote = calculateAddLiquidityQuote({
      stableToken1Amount: initialDepositToken1,
      stableToken2Amount: initialDepositToken2,
      stableToken1Balance: 0n,
      stableToken2Balance: 0n,
      lpTokenSupply: 0n,
    });
    const initialMinMintAmount = subtractBuffer(initialQuote.mintAmount, 25n);

    // Frozen accounts cannot add liquidity
    await expect(
      ammPoolContractForFrozenAccount.add_liquidity(
        initialDepositToken1,
        initialDepositToken2,
        frozenAccountStableToken1Record,
        frozenAccountStableToken2Record,
        initialQuote.mintAmount,
        frozenAccountMerkleProof,
        frozenAccountMerkleProof,
        initialLpVoucherId,
      ),
    ).rejects.toThrow();

    // Transactions with an optimistic minimum mint amount must fail.
    const optimisticRejectedTx = await ammPoolContractForAccount.add_liquidity(
      initialDepositToken1,
      initialDepositToken2,
      accountStableToken1Record,
      accountStableToken2Record,
      initialQuote.mintAmount + 1n,
      accountMerkleProof,
      accountMerkleProof,
      initialLpVoucherId,
    );
    await expect(optimisticRejectedTx.wait()).rejects.toThrow();

    // Initial liquidity cannot be added with a zero token amount.
    const zeroAmountInitialDepositRejectedTx = await ammPoolContractForAccount.add_liquidity(
      0n,
      initialDepositToken2,
      accountStableToken1Record,
      accountStableToken2Record,
      0n,
      accountMerkleProof,
      accountMerkleProof,
      initialLpVoucherId,
    );
    await expect(zeroAmountInitialDepositRejectedTx.wait()).rejects.toThrow();

    const initialAddLiquidityTx = await ammPoolContractForAccount.add_liquidity(
      initialDepositToken1,
      initialDepositToken2,
      accountStableToken1Record,
      accountStableToken2Record,
      initialMinMintAmount,
      accountMerkleProof,
      accountMerkleProof,
      initialLpVoucherId,
    );
    const [, , , encryptedInitialLpVoucherRecord] = await waitForOutputs(initialAddLiquidityTx);

    // I need to fix the decryption of external records, I will take a look on existing tests and update it accordingly
    accountStableToken1Record = decryptStableToken1(
      (initialAddLiquidityTx as any).transaction.execution.transitions[0].outputs[1],
      accountPrivKey,
    );
    accountStableToken2Record = decryptStableToken2(
      (initialAddLiquidityTx as any).transaction.execution.transitions[1].outputs[1],
      accountPrivKey,
    );
    initialLpTokenRecord = decryptLpToken(
      (initialAddLiquidityTx as any).transaction.execution.transitions[2].outputs[1],
      accountPrivKey,
    );
    initialLpVoucherRecord = decryptLP_Voucher(encryptedInitialLpVoucherRecord, accountPrivKey);

    const initialVoucherAmount = initialQuote.mintAmount - initialMinMintAmount;

    expect(accountStableToken1Record.amount).toBe(initialMintAmount - initialDepositToken1);
    expect(accountStableToken2Record.amount).toBe(initialMintAmount - initialDepositToken2);
    expect(initialLpTokenRecord.amount).toBe(initialMinMintAmount);
    expect(initialLpVoucherRecord.owner).toBe(account);
    expect(initialLpVoucherRecord.voucher_id).toBe(initialLpVoucherId);

    expect(await ammPoolContract.vouchers(initialLpVoucherId)).toBe(initialVoucherAmount);
    expect(await ammPoolContract.lp_token_reserved__(STORAGE_KEY)).toBe(initialVoucherAmount);

    await assertPoolBalances(initialDepositToken1, initialDepositToken2);

    expect(await stableToken1Contract.balances(ammPoolContract.address())).toBe(initialDepositToken1);
    expect(await stableToken2Contract.balances(ammPoolContract.address())).toBe(initialDepositToken2);

    // The second liquidity deposit should use the existing-liquidity branch.
    const poolStateBeforeSecondDeposit = await getPoolState();

    const lpTokenSupplyBeforeSecondDeposit = await getLpTotalSupply();

    const secondQuote = calculateAddLiquidityQuote({
      stableToken1Amount: secondDepositToken1,
      stableToken2Amount: secondDepositToken2,
      stableToken1Balance: poolStateBeforeSecondDeposit.stableToken1Balance,
      stableToken2Balance: poolStateBeforeSecondDeposit.stableToken2Balance,
      lpTokenSupply: lpTokenSupplyBeforeSecondDeposit,
    });

    const secondMinMintAmount = subtractBuffer(secondQuote.mintAmount, 10n);

    // Transactions with an optimistic minimum mint amount must also fail after initialization.
    const optimisticSecondDepositRejectedTx = await ammPoolContractForAccount.add_liquidity(
      secondDepositToken1,
      secondDepositToken2,
      accountStableToken1Record,
      accountStableToken2Record,
      secondQuote.mintAmount + 1n,
      accountMerkleProof,
      accountMerkleProof,
      secondLpVoucherId,
    );
    await expect(optimisticSecondDepositRejectedTx.wait()).rejects.toThrow();

    const secondAddLiquidityTx = await ammPoolContractForAccount.add_liquidity(
      secondDepositToken1,
      secondDepositToken2,
      accountStableToken1Record,
      accountStableToken2Record,
      secondMinMintAmount,
      accountMerkleProof,
      accountMerkleProof,
      secondLpVoucherId,
    );
    const [, , , encryptedAccountLpVoucherRecord] = await waitForOutputs(secondAddLiquidityTx);

    accountStableToken1Record = decryptStableToken1(
      (secondAddLiquidityTx as any).transaction.execution.transitions[0].outputs[1],
      accountPrivKey,
    );
    accountStableToken2Record = decryptStableToken2(
      (secondAddLiquidityTx as any).transaction.execution.transitions[1].outputs[1],
      accountPrivKey,
    );
    const accountLpTokenRecord = decryptLpToken(
      (secondAddLiquidityTx as any).transaction.execution.transitions[2].outputs[1],
      accountPrivKey,
    );
    secondLpVoucherRecord = decryptLP_Voucher(encryptedAccountLpVoucherRecord, accountPrivKey);

    expect(accountStableToken1Record.amount).toBe(initialMintAmount - initialDepositToken1 - secondDepositToken1);
    expect(accountStableToken2Record.amount).toBe(initialMintAmount - initialDepositToken2 - secondDepositToken2);
    expect(accountLpTokenRecord.amount).toBe(secondMinMintAmount);
    expect(secondLpVoucherRecord.voucher_id).toBe(secondLpVoucherId);

    expect(await ammPoolContract.vouchers(secondLpVoucherId)).toBe(secondQuote.mintAmount - secondMinMintAmount);
    await assertPoolBalances(secondQuote.newStableToken1Balance, secondQuote.newStableToken2Balance);

    // Reusing an existing voucher id must fail.
    const duplicateVoucherRejectedTx = await ammPoolContractForAccount.add_liquidity(
      1n,
      1n,
      accountStableToken1Record,
      accountStableToken2Record,
      0n,
      accountMerkleProof,
      accountMerkleProof,
      initialLpVoucherId,
    );
    await expect(duplicateVoucherRejectedTx.wait()).rejects.toThrow();
  });

  test(`test redeem_lp_token_voucher`, async () => {
    const lpTokenReservedBefore = await ammPoolContract.lp_token_reserved__(STORAGE_KEY);
    expect(lpTokenReservedBefore).toBeGreaterThan(0n);

    const voucherAmount = await ammPoolContract.vouchers(initialLpVoucherRecord.voucher_id);
    expect(voucherAmount).toBeGreaterThan(0n);

    // It is not possible to redeem more than the voucher amount.
    const rejectedTx = await ammPoolContractForAccount.redeem_lp_token_voucher(
      initialLpVoucherRecord,
      voucherAmount + 1n,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Redeeming the voucher should mint the reserved LP amount.
    const tx = await ammPoolContractForAccount.redeem_lp_token_voucher(initialLpVoucherRecord, voucherAmount);
    const [, encryptedUpdatedLpVoucherRecord] = await waitForOutputs(tx);

    redeemedLpTokenRecord = decryptLpToken((tx as any).transaction.execution.transitions[0].outputs[1], accountPrivKey);
    initialLpVoucherRecord = decryptLP_Voucher(encryptedUpdatedLpVoucherRecord, accountPrivKey);

    expect(redeemedLpTokenRecord.amount).toBe(voucherAmount);
    expect(await ammPoolContract.vouchers(initialLpVoucherRecord.voucher_id)).toBe(0n);
    expect(lpTokenReservedBefore - (await ammPoolContract.lp_token_reserved__(STORAGE_KEY))).toBe(voucherAmount);
  });

  test(`test exchange_1_for_2`, async () => {
    const poolStateBefore = await getPoolState();
    const quote = calculateExchangeQuote({
      inputAmount: exchange1For2Input,
      inputTokenBalance: poolStateBefore.stableToken1Balance,
      outputTokenBalance: poolStateBefore.stableToken2Balance,
    });
    const minOutputAmount = subtractBuffer(quote.netOutputAmount, 7n);

    await expect(
      ammPoolContractForFrozenAccount.exchange_1_for_2(
        exchange1For2Input,
        minOutputAmount,
        frozenAccountStableToken1Record,
        frozenAccountMerkleProof,
        frozenExchangeToken2RejectedVoucherId,
      ),
    ).rejects.toThrow();

    // Transactions with an optimistic minimum output amount must fail.
    const optimisticRejectedTx = await ammPoolContractForAccount.exchange_1_for_2(
      exchange1For2Input,
      quote.netOutputAmount + 1n,
      accountStableToken1Record,
      accountMerkleProof,
      optimisticExchangeToken2RejectedVoucherId,
    );
    await expect(optimisticRejectedTx.wait()).rejects.toThrow();

    // A valid exchange should return the minimum output and reserve the remainder in a voucher.
    const tx = await ammPoolContractForAccount.exchange_1_for_2(
      exchange1For2Input,
      minOutputAmount,
      accountStableToken1Record,
      accountMerkleProof,
      exchangeToken2VoucherId,
    );
    const [, , encryptedStableToken2Voucher] = await waitForOutputs(tx);

    accountStableToken1Record = decryptStableToken1(
      (tx as any).transaction.execution.transitions[0].outputs[1],
      accountPrivKey,
    );
    const accountStableToken2Output = decryptStableToken2(
      (tx as any).transaction.execution.transitions[1].outputs[1],
      accountPrivKey,
    );
    exchangeToken2VoucherRecord = decryptStable_Token_2_Voucher(encryptedStableToken2Voucher, accountPrivKey);

    expect(accountStableToken1Record.amount).toBe(
      initialMintAmount - initialDepositToken1 - secondDepositToken1 - exchange1For2Input,
    );
    expect(accountStableToken2Output.amount).toBe(minOutputAmount);
    expect(exchangeToken2VoucherRecord.voucher_id).toBe(exchangeToken2VoucherId);

    expect(await ammPoolContract.vouchers(exchangeToken2VoucherId)).toBe(quote.netOutputAmount - minOutputAmount);
    expect(await ammPoolContract.stable_token_2_reserved__(STORAGE_KEY)).toBe(quote.netOutputAmount - minOutputAmount);
    await assertPoolBalances(quote.newInputStableTokenBalance, quote.newOutputStableTokenBalance);

    // Reusing a voucher id must fail.
    const duplicateVoucherRejectedTx = await ammPoolContractForAccount.exchange_1_for_2(
      1n,
      0n,
      accountStableToken1Record,
      accountMerkleProof,
      exchangeToken2VoucherId,
    );
    await expect(duplicateVoucherRejectedTx.wait()).rejects.toThrow();
  });

  test(`test redeem_stable_token_2_voucher`, async () => {
    const voucherAmount = await ammPoolContract.vouchers(exchangeToken2VoucherRecord.voucher_id);
    expect(voucherAmount).toBeGreaterThan(0n);

    // It is not possible to redeem more than the voucher amount.
    const rejectedTx = await ammPoolContractForAccount.redeem_stable_token_2_voucher(
      exchangeToken2VoucherRecord,
      voucherAmount + 1n,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Redeeming the voucher should return the reserved output amount.
    const tx = await ammPoolContractForAccount.redeem_stable_token_2_voucher(
      exchangeToken2VoucherRecord,
      voucherAmount,
    );
    const [, encryptedUpdatedStableToken2Voucher] = await waitForOutputs(tx);

    const stableToken2VoucherOutput = decryptStableToken2(
      (tx as any).transaction.execution.transitions[0].outputs[1],
      accountPrivKey,
    );
    exchangeToken2VoucherRecord = decryptStable_Token_2_Voucher(encryptedUpdatedStableToken2Voucher, accountPrivKey);

    expect(stableToken2VoucherOutput.amount).toBe(voucherAmount);
    expect(await ammPoolContract.vouchers(exchangeToken2VoucherRecord.voucher_id)).toBe(0n);
    expect(await ammPoolContract.stable_token_2_reserved__(STORAGE_KEY)).toBe(0n);
  });

  test(`test exchange_2_for_1`, async () => {
    const poolStateBefore = await getPoolState();
    const quote = calculateExchangeQuote({
      inputAmount: exchange2For1Input,
      inputTokenBalance: poolStateBefore.stableToken2Balance,
      outputTokenBalance: poolStateBefore.stableToken1Balance,
    });
    const minOutputAmount = subtractBuffer(quote.netOutputAmount, 5n);

    // Frozen accounts cannot exchange through the pool. Use a valid quote so freeze-list membership is the only
    // expected rejection reason.
    await expect(
      ammPoolContractForFrozenAccount.exchange_2_for_1(
        exchange2For1Input,
        minOutputAmount,
        frozenAccountStableToken2Record,
        frozenAccountMerkleProof,
        frozenExchangeToken1RejectedVoucherId,
      ),
    ).rejects.toThrow();

    // Transactions with an optimistic minimum output amount must fail.
    const optimisticRejectedTx = await ammPoolContractForAccount.exchange_2_for_1(
      exchange2For1Input,
      quote.netOutputAmount + 1n,
      accountStableToken2Record,
      accountMerkleProof,
      optimisticExchangeToken1RejectedVoucherId,
    );
    await expect(optimisticRejectedTx.wait()).rejects.toThrow();

    // A valid exchange should return the minimum output and reserve the remainder in a voucher.
    const tx = await ammPoolContractForAccount.exchange_2_for_1(
      exchange2For1Input,
      minOutputAmount,
      accountStableToken2Record,
      accountMerkleProof,
      exchangeToken1VoucherId,
    );
    const [, , encryptedStableToken1Voucher] = await waitForOutputs(tx);

    accountStableToken2Record = decryptStableToken2(
      (tx as any).transaction.execution.transitions[0].outputs[1],
      accountPrivKey,
    );
    const accountStableToken1Output = decryptStableToken1(
      (tx as any).transaction.execution.transitions[1].outputs[1],
      accountPrivKey,
    );
    exchangeToken1VoucherRecord = decryptStable_Token_1_Voucher(encryptedStableToken1Voucher, accountPrivKey);

    expect(accountStableToken2Record.amount).toBe(
      initialMintAmount - initialDepositToken2 - secondDepositToken2 - exchange2For1Input,
    );
    expect(accountStableToken1Output.amount).toBe(minOutputAmount);
    expect(exchangeToken1VoucherRecord.voucher_id).toBe(exchangeToken1VoucherId);

    expect(await ammPoolContract.vouchers(exchangeToken1VoucherId)).toBe(quote.netOutputAmount - minOutputAmount);
    expect(await ammPoolContract.stable_token_1_reserved__(STORAGE_KEY)).toBe(quote.netOutputAmount - minOutputAmount);
    await assertPoolBalances(quote.newOutputStableTokenBalance, quote.newInputStableTokenBalance);

    // Reusing a voucher id must fail.
    const duplicateVoucherRejectedTx = await ammPoolContractForAccount.exchange_2_for_1(
      1n,
      0n,
      accountStableToken2Record,
      accountMerkleProof,
      exchangeToken1VoucherId,
    );
    await expect(duplicateVoucherRejectedTx.wait()).rejects.toThrow();
  });

  test(`test redeem_stable_token_1_voucher`, async () => {
    const voucherAmount = await ammPoolContract.vouchers(exchangeToken1VoucherRecord.voucher_id);
    expect(voucherAmount).toBeGreaterThan(0n);

    // It is not possible to redeem more than the voucher amount.
    const rejectedTx = await ammPoolContractForAccount.redeem_stable_token_1_voucher(
      exchangeToken1VoucherRecord,
      voucherAmount + 1n,
    );
    await expect(rejectedTx.wait()).rejects.toThrow();

    // Redeeming the voucher should return the reserved output amount.
    const tx = await ammPoolContractForAccount.redeem_stable_token_1_voucher(
      exchangeToken1VoucherRecord,
      voucherAmount,
    );
    const [, encryptedUpdatedStableToken1Voucher] = await waitForOutputs(tx);

    const stableToken1VoucherOutput = decryptStableToken1(
      (tx as any).transaction.execution.transitions[0].outputs[1],
      accountPrivKey,
    );
    exchangeToken1VoucherRecord = decryptStable_Token_1_Voucher(encryptedUpdatedStableToken1Voucher, accountPrivKey);

    expect(stableToken1VoucherOutput.amount).toBe(voucherAmount);
    expect(await ammPoolContract.vouchers(exchangeToken1VoucherRecord.voucher_id)).toBe(0n);
    expect(await ammPoolContract.stable_token_1_reserved__(STORAGE_KEY)).toBe(0n);
  });

  test(`test remove_liquidity`, async () => {
    const lpTokenAmount = redeemedLpTokenRecord.amount - 1n;
    const poolStateBefore = await getPoolState();
    const lpTokenSupplyBefore = await getLpTotalSupply();
    const quote = calculateRemoveLiquidityQuote({
      lpTokenAmount,
      stableToken1Balance: poolStateBefore.stableToken1Balance,
      stableToken2Balance: poolStateBefore.stableToken2Balance,
      lpTokenSupply: lpTokenSupplyBefore,
    });
    const minStableToken1Amount = subtractBuffer(quote.stableToken1Amount, 9n);
    const minStableToken2Amount = subtractBuffer(quote.stableToken2Amount, 11n);

    // Transactions with optimistic minimum output amounts must fail.
    let optimisticRejectedTx = await ammPoolContractForAccount.remove_liquidity(
      lpTokenAmount,
      quote.stableToken1Amount + 1n,
      minStableToken2Amount,
      redeemedLpTokenRecord,
      optimisticRemoveLiquidityToken1VoucherId,
      optimisticRemoveLiquidityToken2VoucherId,
    );
    await expect(optimisticRejectedTx.wait()).rejects.toThrow();
    optimisticRejectedTx = await ammPoolContractForAccount.remove_liquidity(
      lpTokenAmount,
      minStableToken1Amount,
      quote.stableToken2Amount + 1n,
      redeemedLpTokenRecord,
      optimisticRemoveLiquidityToken1VoucherId,
      optimisticRemoveLiquidityToken2VoucherId,
    );
    await expect(optimisticRejectedTx.wait()).rejects.toThrow();

    // A valid liquidity removal should burn LP tokens and issue vouchers for the withheld amounts.
    const tx = await ammPoolContractForAccount.remove_liquidity(
      lpTokenAmount,
      minStableToken1Amount,
      minStableToken2Amount,
      redeemedLpTokenRecord,
      removeLiquidityToken1VoucherId,
      removeLiquidityToken2VoucherId,
    );
    const [, , , encryptedRemoveLiquidityToken1Voucher, encryptedRemoveLiquidityToken2Voucher] =
      await waitForOutputs(tx);

    redeemedLpTokenRecord = decryptLpToken((tx as any).transaction.execution.transitions[0].outputs[1], accountPrivKey);
    const stableToken1Output = decryptStableToken1(
      (tx as any).transaction.execution.transitions[1].outputs[1],
      accountPrivKey,
    );
    const stableToken2Output = decryptStableToken2(
      (tx as any).transaction.execution.transitions[2].outputs[1],
      accountPrivKey,
    );
    removeLiquidityToken1VoucherRecord = decryptStable_Token_1_Voucher(
      encryptedRemoveLiquidityToken1Voucher,
      accountPrivKey,
    );
    removeLiquidityToken2VoucherRecord = decryptStable_Token_2_Voucher(
      encryptedRemoveLiquidityToken2Voucher,
      accountPrivKey,
    );

    expect(redeemedLpTokenRecord.amount).toBe(1n);
    expect(stableToken1Output.amount).toBe(minStableToken1Amount);
    expect(stableToken2Output.amount).toBe(minStableToken2Amount);
    expect(removeLiquidityToken1VoucherRecord.voucher_id).toBe(removeLiquidityToken1VoucherId);
    expect(removeLiquidityToken2VoucherRecord.voucher_id).toBe(removeLiquidityToken2VoucherId);

    expect(await ammPoolContract.vouchers(removeLiquidityToken1VoucherId)).toBe(
      quote.stableToken1Amount - minStableToken1Amount,
    );
    expect(await ammPoolContract.vouchers(removeLiquidityToken2VoucherId)).toBe(
      quote.stableToken2Amount - minStableToken2Amount,
    );
    expect(await ammPoolContract.stable_token_1_reserved__(STORAGE_KEY)).toBe(
      quote.stableToken1Amount - minStableToken1Amount,
    );
    expect(await ammPoolContract.stable_token_2_reserved__(STORAGE_KEY)).toBe(
      quote.stableToken2Amount - minStableToken2Amount,
    );
    await assertPoolBalances(quote.newStableToken1Balance, quote.newStableToken2Balance);

    // Reusing a voucher id must fail.
    const duplicateVoucherRejectedTx = await ammPoolContractForAccount.remove_liquidity(
      1n,
      0n,
      0n,
      redeemedLpTokenRecord,
      removeLiquidityToken1VoucherId,
      removeLiquidityToken2VoucherId,
    );
    await expect(duplicateVoucherRejectedTx.wait()).rejects.toThrow();
  });

  test(`test withdraw_admin_fees`, async () => {
    const nonAdminRejectedTx = await ammPoolContractForAccount.withdraw_admin_fees(0n, 0n);
    await expect(nonAdminRejectedTx.wait()).rejects.toThrow();

    const mintStableToken1FeeSeedTx = await stableToken1ContractForAdmin.mint_public(adminAddress, adminFeeSeedToken1);
    await mintStableToken1FeeSeedTx.wait();
    const mintStableToken2FeeSeedTx = await stableToken2ContractForAdmin.mint_public(adminAddress, adminFeeSeedToken2);
    await mintStableToken2FeeSeedTx.wait();

    const transferStableToken1FeeSeedTx = await stableToken1ContractForAdmin.transfer_public(
      ammPoolContract.address(),
      adminFeeSeedToken1,
    );
    await transferStableToken1FeeSeedTx.wait();
    const transferStableToken2FeeSeedTx = await stableToken2ContractForAdmin.transfer_public(
      ammPoolContract.address(),
      adminFeeSeedToken2,
    );
    await transferStableToken2FeeSeedTx.wait();

    const rejectedTx = await ammPoolContractForAdmin.withdraw_admin_fees(adminFeeSeedToken1 + 1n, adminFeeSeedToken2);
    await expect(rejectedTx.wait()).rejects.toThrow();

    const stableToken1PoolBalanceBefore = await stableToken1Contract.balances(ammPoolContract.address());
    const stableToken2PoolBalanceBefore = await stableToken2Contract.balances(ammPoolContract.address());

    const withdrawAdminFeesTx = await ammPoolContractForAdmin.withdraw_admin_fees(
      adminFeeSeedToken1,
      adminFeeSeedToken2,
    );
    await withdrawAdminFeesTx.wait();

    expect(await stableToken1Contract.balances(ammPoolContract.address())).toBe(
      stableToken1PoolBalanceBefore - adminFeeSeedToken1,
    );
    expect(await stableToken2Contract.balances(ammPoolContract.address())).toBe(
      stableToken2PoolBalanceBefore - adminFeeSeedToken2,
    );
  });
});
