const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_AMPLIFICATION = 85n;
const MAX_U128 = (1n << 128n) - 1n;

const DEFAULT_FEE = 6_000_000n;
const DEFAULT_ADMIN_FEE = 0n;
const DEFAULT_FEE_DENOMINATOR = 10_000_000_000n;

type PoolBalances = readonly [bigint, bigint];

export interface AmmFeesConfig {
  fee?: bigint;
  adminFee?: bigint;
  feeDenominator?: bigint;
}

export interface AmmMathConfig {
  maxIterations?: number;
  amplification?: bigint;
  fees?: AmmFeesConfig;
}

export interface ResolvedAmmMathConfig {
  maxIterations: number;
  amplification: bigint;
  ann: bigint;
  fee: bigint;
  adminFee: bigint;
  feeDenominator: bigint;
}

export interface ExchangeQuoteInput {
  inputAmount: bigint;
  inputTokenBalance: bigint;
  outputTokenBalance: bigint;
}

export interface ExchangeQuote {
  newInputStableTokenBalance: bigint;
  newOutputStableTokenBalance: bigint;
  grossOutputAmount: bigint;
  feeAmount: bigint;
  adminFeeAmount: bigint;
  netOutputAmount: bigint;
}

export interface AddLiquidityQuoteInput {
  stableToken1Amount: bigint;
  stableToken2Amount: bigint;
  stableToken1Balance: bigint;
  stableToken2Balance: bigint;
  lpTokenSupply: bigint;
}

export interface AddLiquidityQuote {
  invariantBefore: bigint;
  invariantAfterDeposit: bigint;
  invariantAfterFee: bigint;
  balancesAfterDeposit: [bigint, bigint];
  balancesAfterFee: [bigint, bigint];
  stableToken1Fee: bigint;
  stableToken2Fee: bigint;
  newStableToken1Balance: bigint;
  newStableToken2Balance: bigint;
  mintAmount: bigint;
}

export interface RemoveLiquidityQuoteInput {
  lpTokenAmount: bigint;
  stableToken1Balance: bigint;
  stableToken2Balance: bigint;
  lpTokenSupply: bigint;
}

export interface RemoveLiquidityQuote {
  stableToken1Amount: bigint;
  stableToken2Amount: bigint;
  newStableToken1Balance: bigint;
  newStableToken2Balance: bigint;
}

export const DEFAULT_AMM_MATH_CONFIG: Readonly<ResolvedAmmMathConfig> = {
  maxIterations: DEFAULT_MAX_ITERATIONS,
  amplification: DEFAULT_AMPLIFICATION,
  ann: DEFAULT_AMPLIFICATION * 2n,
  fee: DEFAULT_FEE,
  adminFee: DEFAULT_ADMIN_FEE,
  feeDenominator: DEFAULT_FEE_DENOMINATOR,
};

function assertU128(name: string, value: bigint) {
  if (value < 0n) {
    throw new Error(`${name} must be a non-negative bigint`);
  }

  if (value > MAX_U128) {
    throw new Error(`${name} must fit within u128`);
  }
}

function assertPositive(name: string, value: bigint) {
  if (value <= 0n) {
    throw new Error(`${name} must be greater than zero`);
  }
}

function absoluteDifference(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

function assertValidMaxIterations(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("maxIterations must be a non-negative integer");
  }
}

function resolveAmmMathConfig(config: AmmMathConfig = {}): ResolvedAmmMathConfig {
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const amplification = config.amplification ?? DEFAULT_AMPLIFICATION;
  const fee = config.fees?.fee ?? DEFAULT_FEE;
  const adminFee = config.fees?.adminFee ?? DEFAULT_ADMIN_FEE;
  const feeDenominator = config.fees?.feeDenominator ?? DEFAULT_FEE_DENOMINATOR;

  assertValidMaxIterations(maxIterations);
  assertU128("amplification", amplification);
  assertU128("fee", fee);
  assertU128("adminFee", adminFee);
  assertU128("feeDenominator", feeDenominator);
  assertPositive("feeDenominator", feeDenominator);

  return {
    maxIterations,
    amplification,
    ann: amplification * 2n,
    fee,
    adminFee,
    feeDenominator,
  };
}

export function computeInvariant(tokenBalances: PoolBalances, config?: AmmMathConfig): bigint {
  const [stableToken1Balance, stableToken2Balance] = tokenBalances;
  const ammConfig = resolveAmmMathConfig(config);

  assertU128("tokenBalances[0]", stableToken1Balance);
  assertU128("tokenBalances[1]", stableToken2Balance);

  const totalBalance = stableToken1Balance + stableToken2Balance;
  if (totalBalance === 0n) {
    return 0n;
  }

  let invariant = totalBalance;

  for (let i = 0; i < ammConfig.maxIterations; i++) {
    let productTerm = (invariant * invariant) / (stableToken1Balance * 2n + 1n);
    productTerm = (productTerm * invariant) / (stableToken2Balance * 2n + 1n);

    const previousInvariant = invariant;
    invariant =
      ((ammConfig.ann * totalBalance + productTerm * 2n) * invariant) /
      ((ammConfig.ann - 1n) * invariant + 3n * productTerm);

    if (absoluteDifference(invariant, previousInvariant) <= 1n) {
      return invariant;
    }
  }

  return invariant;
}

export function computeOutputTokenBalance(
  newInputTokenBalance: bigint,
  inputTokenBalance: bigint,
  outputTokenBalance: bigint,
  config?: AmmMathConfig,
): bigint {
  const ammConfig = resolveAmmMathConfig(config);

  assertU128("newInputTokenBalance", newInputTokenBalance);
  assertU128("inputTokenBalance", inputTokenBalance);
  assertU128("outputTokenBalance", outputTokenBalance);
  assertPositive("newInputTokenBalance", newInputTokenBalance);

  const invariant = computeInvariant([inputTokenBalance, outputTokenBalance], ammConfig);

  let productTerm = invariant;
  productTerm = (productTerm * invariant) / (newInputTokenBalance * 2n);
  productTerm = (productTerm * invariant) / (ammConfig.ann * 2n);

  const sumTerm = newInputTokenBalance + invariant / ammConfig.ann;

  let newOutputTokenBalance = invariant;
  for (let i = 0; i < ammConfig.maxIterations; i++) {
    const previousEstimate = newOutputTokenBalance;
    newOutputTokenBalance =
      (newOutputTokenBalance * newOutputTokenBalance + productTerm) /
      (2n * newOutputTokenBalance + sumTerm - invariant);

    if (absoluteDifference(newOutputTokenBalance, previousEstimate) <= 1n) {
      return newOutputTokenBalance;
    }
  }

  return newOutputTokenBalance;
}

export function calculateExchangeQuote(
  { inputAmount, inputTokenBalance, outputTokenBalance }: ExchangeQuoteInput,
  config?: AmmMathConfig,
): ExchangeQuote {
  const ammConfig = resolveAmmMathConfig(config);

  assertU128("inputAmount", inputAmount);
  assertU128("inputTokenBalance", inputTokenBalance);
  assertU128("outputTokenBalance", outputTokenBalance);

  const newInputTokenBalance = inputTokenBalance + inputAmount;
  const newOutputTokenBalance = computeOutputTokenBalance(
    newInputTokenBalance,
    inputTokenBalance,
    outputTokenBalance,
    ammConfig,
  );
  const grossOutputAmount = outputTokenBalance - newOutputTokenBalance;
  const feeAmount = (grossOutputAmount * ammConfig.fee) / ammConfig.feeDenominator;
  const adminFeeAmount = (feeAmount * ammConfig.adminFee) / ammConfig.feeDenominator;
  const netOutputAmount = grossOutputAmount - feeAmount;
  const newOutputStableTokenBalance = newOutputTokenBalance + (feeAmount - adminFeeAmount);

  return {
    newInputStableTokenBalance: newInputTokenBalance,
    newOutputStableTokenBalance,
    grossOutputAmount,
    feeAmount,
    adminFeeAmount,
    netOutputAmount,
  };
}

export function calculateExchangeNetOutputAmount(input: ExchangeQuoteInput, config?: AmmMathConfig): bigint {
  return calculateExchangeQuote(input, config).netOutputAmount;
}

export function calculateAddLiquidityQuote(
  {
    stableToken1Amount,
    stableToken2Amount,
    stableToken1Balance,
    stableToken2Balance,
    lpTokenSupply,
  }: AddLiquidityQuoteInput,
  config?: AmmMathConfig,
): AddLiquidityQuote {
  const ammConfig = resolveAmmMathConfig(config);

  assertU128("stableToken1Amount", stableToken1Amount);
  assertU128("stableToken2Amount", stableToken2Amount);
  assertU128("stableToken1Balance", stableToken1Balance);
  assertU128("stableToken2Balance", stableToken2Balance);
  assertU128("lpTokenSupply", lpTokenSupply);

  const balancesBefore: PoolBalances = [stableToken1Balance, stableToken2Balance];
  const invariantBefore = lpTokenSupply > 0n ? computeInvariant(balancesBefore, ammConfig) : 0n;

  const balancesAfterDeposit: [bigint, bigint] = [
    stableToken1Balance + stableToken1Amount,
    stableToken2Balance + stableToken2Amount,
  ];
  const invariantAfterDeposit = computeInvariant(balancesAfterDeposit, ammConfig);

  if (invariantAfterDeposit <= invariantBefore) {
    throw new Error("invariant_after_deposit must be greater than invariant_before");
  }

  if (lpTokenSupply === 0n) {
    if (stableToken1Amount === 0n || stableToken2Amount === 0n) {
      throw new Error("initial liquidity must deposit non-zero amounts for both tokens");
    }

    return {
      invariantBefore,
      invariantAfterDeposit,
      invariantAfterFee: invariantAfterDeposit,
      balancesAfterDeposit,
      balancesAfterFee: balancesAfterDeposit,
      stableToken1Fee: 0n,
      stableToken2Fee: 0n,
      newStableToken1Balance: balancesAfterDeposit[0],
      newStableToken2Balance: balancesAfterDeposit[1],
      mintAmount: invariantAfterDeposit,
    };
  }

  const feePerToken = ammConfig.fee / 2n;

  let idealBalance = (invariantAfterDeposit * stableToken1Balance) / invariantBefore;
  const stableToken1Fee =
    (feePerToken * absoluteDifference(idealBalance, balancesAfterDeposit[0])) / ammConfig.feeDenominator;
  const newStableToken1Balance =
    balancesAfterDeposit[0] - (stableToken1Fee * ammConfig.adminFee) / ammConfig.feeDenominator;

  idealBalance = (invariantAfterDeposit * stableToken2Balance) / invariantBefore;
  const stableToken2Fee =
    (feePerToken * absoluteDifference(idealBalance, balancesAfterDeposit[1])) / ammConfig.feeDenominator;
  const newStableToken2Balance =
    balancesAfterDeposit[1] - (stableToken2Fee * ammConfig.adminFee) / ammConfig.feeDenominator;

  const balancesAfterFee: [bigint, bigint] = [
    balancesAfterDeposit[0] - stableToken1Fee,
    balancesAfterDeposit[1] - stableToken2Fee,
  ];
  const invariantAfterFee = computeInvariant(balancesAfterFee, ammConfig);
  const mintAmount = (lpTokenSupply * (invariantAfterFee - invariantBefore)) / invariantBefore;

  return {
    invariantBefore,
    invariantAfterDeposit,
    invariantAfterFee,
    balancesAfterDeposit,
    balancesAfterFee,
    stableToken1Fee,
    stableToken2Fee,
    newStableToken1Balance,
    newStableToken2Balance,
    mintAmount,
  };
}

export function calculateAddLiquidityMintAmount(input: AddLiquidityQuoteInput, config?: AmmMathConfig): bigint {
  return calculateAddLiquidityQuote(input, config).mintAmount;
}

export function calculateRemoveLiquidityQuote({
  lpTokenAmount,
  stableToken1Balance,
  stableToken2Balance,
  lpTokenSupply,
}: RemoveLiquidityQuoteInput): RemoveLiquidityQuote {
  assertU128("lpTokenAmount", lpTokenAmount);
  assertU128("stableToken1Balance", stableToken1Balance);
  assertU128("stableToken2Balance", stableToken2Balance);
  assertU128("lpTokenSupply", lpTokenSupply);
  assertPositive("lpTokenSupply", lpTokenSupply);

  const stableToken1Amount = (stableToken1Balance * lpTokenAmount) / lpTokenSupply;
  const stableToken2Amount = (stableToken2Balance * lpTokenAmount) / lpTokenSupply;

  return {
    stableToken1Amount,
    stableToken2Amount,
    newStableToken1Balance: stableToken1Balance - stableToken1Amount,
    newStableToken2Balance: stableToken2Balance - stableToken2Amount,
  };
}

export function calculateRemoveLiquidityOutputAmounts(input: RemoveLiquidityQuoteInput): [bigint, bigint] {
  const { stableToken1Amount, stableToken2Amount } = calculateRemoveLiquidityQuote(input);
  return [stableToken1Amount, stableToken2Amount];
}
