import { describe, expect, test } from "vitest";
import {
  DEFAULT_AMM_MATH_CONFIG,
  type AddLiquidityQuoteInput,
  type ExchangeQuoteInput,
  calculateAddLiquidityMintAmount,
  calculateExchangeNetOutputAmount,
  computeInvariant,
} from "../src/amm-pool.js";

const REFERENCE_MAX_ITERATIONS = 256;

const RESERVE_PAIRS: ReadonlyArray<readonly [bigint, bigint]> = [
  [1_000n, 1_000n],
  [10_000n, 10_000n],
  [1_000_000n, 1_000_000n],
  [1_000_000n, 500_000n],
  [500_000n, 1_000_000n],
  [1_000_000_000n, 1_000_000_000n],
  [1_000_000_000n, 1_500_000_000n],
  [1_000_000_000_000_000n, 1_000_000_000_000_000n],
  [1_000_000_000_000_000n, 950_000_000_000_000n],
];

const INPUT_DIVISORS = [100_000n, 10_000n, 1_000n, 100n, 10n, 1n] as const;

interface ScenarioMeasurement {
  scenario: ExchangeQuoteInput;
  referenceOutput: bigint;
  requiredMaxIterations: number;
}

interface AddLiquidityMeasurement {
  scenario: AddLiquidityQuoteInput;
  referenceMintAmount: bigint;
  requiredMaxIterations: number;
}

function formatScenario({ inputAmount, inputTokenBalance, outputTokenBalance }: ExchangeQuoteInput): string {
  return `input=${inputAmount.toString()} in=${inputTokenBalance.toString()} out=${outputTokenBalance.toString()}`;
}

function formatAddLiquidityScenario({
  stableToken1Amount,
  stableToken2Amount,
  stableToken1Balance,
  stableToken2Balance,
  lpTokenSupply,
}: AddLiquidityQuoteInput): string {
  return [
    `deposit1=${stableToken1Amount.toString()}`,
    `deposit2=${stableToken2Amount.toString()}`,
    `balance1=${stableToken1Balance.toString()}`,
    `balance2=${stableToken2Balance.toString()}`,
    `lpSupply=${lpTokenSupply.toString()}`,
  ].join(" ");
}

function scaledAmount(value: bigint, divisor: bigint): bigint {
  const scaled = value / divisor;
  return scaled > 0n ? scaled : 1n;
}

function buildExchangeScenarios(): ExchangeQuoteInput[] {
  const scenarios: ExchangeQuoteInput[] = [];

  for (const [inputTokenBalance, outputTokenBalance] of RESERVE_PAIRS) {
    const inputs = new Set<bigint>([1n, 2n, 10n, inputTokenBalance, inputTokenBalance * 2n]);

    for (const divisor of INPUT_DIVISORS) {
      const scaledInput = inputTokenBalance / divisor;
      if (scaledInput > 0n) {
        inputs.add(scaledInput);
      }
    }

    for (const inputAmount of inputs) {
      scenarios.push({
        inputAmount,
        inputTokenBalance,
        outputTokenBalance,
      });
    }
  }

  return scenarios;
}

function buildAddLiquidityScenarios(): AddLiquidityQuoteInput[] {
  const scenarios: AddLiquidityQuoteInput[] = [];

  for (const [stableToken1Balance, stableToken2Balance] of RESERVE_PAIRS) {
    const lpTokenSupply = computeInvariant([stableToken1Balance, stableToken2Balance], {
      maxIterations: REFERENCE_MAX_ITERATIONS,
    });

    const depositPairs = new Map<string, readonly [bigint, bigint]>();
    const candidateDeposits: ReadonlyArray<readonly [bigint, bigint]> = [
      [1n, 1n],
      [10n, 10n],
      [scaledAmount(stableToken1Balance, 1_000n), scaledAmount(stableToken2Balance, 1_000n)],
      [scaledAmount(stableToken1Balance, 100n), scaledAmount(stableToken2Balance, 100n)],
      [scaledAmount(stableToken1Balance, 10n), scaledAmount(stableToken2Balance, 10n)],
      [scaledAmount(stableToken1Balance, 100n), scaledAmount(stableToken2Balance, 200n)],
      [scaledAmount(stableToken1Balance, 200n), scaledAmount(stableToken2Balance, 100n)],
    ];

    for (const [stableToken1Amount, stableToken2Amount] of candidateDeposits) {
      depositPairs.set(`${stableToken1Amount.toString()}:${stableToken2Amount.toString()}`, [
        stableToken1Amount,
        stableToken2Amount,
      ]);
    }

    for (const [stableToken1Amount, stableToken2Amount] of depositPairs.values()) {
      scenarios.push({
        stableToken1Amount,
        stableToken2Amount,
        stableToken1Balance,
        stableToken2Balance,
        lpTokenSupply,
      });
    }
  }

  scenarios.push(
    {
      stableToken1Amount: 1_000n,
      stableToken2Amount: 1_000n,
      stableToken1Balance: 0n,
      stableToken2Balance: 0n,
      lpTokenSupply: 0n,
    },
    {
      stableToken1Amount: 1_000_000n,
      stableToken2Amount: 1_000_000n,
      stableToken1Balance: 0n,
      stableToken2Balance: 0n,
      lpTokenSupply: 0n,
    },
    {
      stableToken1Amount: 1_000_000_000_000_000n,
      stableToken2Amount: 950_000_000_000_000n,
      stableToken1Balance: 0n,
      stableToken2Balance: 0n,
      lpTokenSupply: 0n,
    },
  );

  return scenarios;
}

function measureScenario(scenario: ExchangeQuoteInput): ScenarioMeasurement {
  const referenceOutput = calculateExchangeNetOutputAmount(scenario, {
    maxIterations: REFERENCE_MAX_ITERATIONS,
  });

  for (let maxIterations = 0; maxIterations <= REFERENCE_MAX_ITERATIONS; maxIterations++) {
    const candidateOutput = calculateExchangeNetOutputAmount(scenario, { maxIterations });
    if (candidateOutput === referenceOutput) {
      return {
        scenario,
        referenceOutput,
        requiredMaxIterations: maxIterations,
      };
    }
  }

  throw new Error(`No matching maxIterations found for ${formatScenario(scenario)}`);
}

function measureAddLiquidityScenario(scenario: AddLiquidityQuoteInput): AddLiquidityMeasurement {
  const referenceMintAmount = calculateAddLiquidityMintAmount(scenario, {
    maxIterations: REFERENCE_MAX_ITERATIONS,
  });

  for (let maxIterations = 0; maxIterations <= REFERENCE_MAX_ITERATIONS; maxIterations++) {
    const candidateMintAmount = calculateAddLiquidityMintAmount(scenario, { maxIterations });
    if (candidateMintAmount === referenceMintAmount) {
      return {
        scenario,
        referenceMintAmount,
        requiredMaxIterations: maxIterations,
      };
    }
  }

  throw new Error(`No matching maxIterations found for ${formatAddLiquidityScenario(scenario)}`);
}

const EXCHANGE_SCENARIOS = buildExchangeScenarios();
const ADD_LIQUIDITY_SCENARIOS = buildAddLiquidityScenarios();

describe("amm pool exchange math", () => {
  test("default maxIterations matches the 256-iteration reference across representative exchange scenarios", () => {
    for (const scenario of EXCHANGE_SCENARIOS) {
      const referenceOutput = calculateExchangeNetOutputAmount(scenario, {
        maxIterations: REFERENCE_MAX_ITERATIONS,
      });
      const defaultOutput = calculateExchangeNetOutputAmount(scenario);

      expect(defaultOutput, `default maxIterations diverged for ${formatScenario(scenario)}`).toBe(referenceOutput);
    }
  });

  test("measures the minimum maxIterations needed to match the 256-iteration reference", () => {
    const measurements = EXCHANGE_SCENARIOS.map(measureScenario);
    const worstCase = measurements.reduce((currentWorst, measurement) =>
      measurement.requiredMaxIterations > currentWorst.requiredMaxIterations ? measurement : currentWorst,
    );

    console.info(
      [
        "calculateExchangeNetOutputAmount minimum maxIterations against 256-iteration reference:",
        `required=${worstCase.requiredMaxIterations}`,
        `default=${DEFAULT_AMM_MATH_CONFIG.maxIterations}`,
        `scenario=${formatScenario(worstCase.scenario)}`,
        `reference=${worstCase.referenceOutput.toString()}`,
      ].join(" "),
    );

    expect(worstCase.requiredMaxIterations).toBeLessThanOrEqual(DEFAULT_AMM_MATH_CONFIG.maxIterations);

    if (worstCase.requiredMaxIterations > 0) {
      const previousOutput = calculateExchangeNetOutputAmount(worstCase.scenario, {
        maxIterations: worstCase.requiredMaxIterations - 1,
      });
      expect(previousOutput).not.toBe(worstCase.referenceOutput);
    }
  });
});

describe("amm pool add_liquidity math", () => {
  test("default maxIterations matches the 256-iteration reference across representative add_liquidity scenarios", () => {
    for (const scenario of ADD_LIQUIDITY_SCENARIOS) {
      const referenceMintAmount = calculateAddLiquidityMintAmount(scenario, {
        maxIterations: REFERENCE_MAX_ITERATIONS,
      });
      const defaultMintAmount = calculateAddLiquidityMintAmount(scenario);

      expect(defaultMintAmount, `default maxIterations diverged for ${formatAddLiquidityScenario(scenario)}`).toBe(
        referenceMintAmount,
      );
    }
  });

  test("measures the minimum maxIterations needed for calculateAddLiquidityMintAmount to match the 256-iteration reference", () => {
    const measurements = ADD_LIQUIDITY_SCENARIOS.map(measureAddLiquidityScenario);
    const worstCase = measurements.reduce((currentWorst, measurement) =>
      measurement.requiredMaxIterations > currentWorst.requiredMaxIterations ? measurement : currentWorst,
    );

    console.info(
      [
        "calculateAddLiquidityMintAmount minimum maxIterations against 256-iteration reference:",
        `required=${worstCase.requiredMaxIterations}`,
        `default=${DEFAULT_AMM_MATH_CONFIG.maxIterations}`,
        `scenario=${formatAddLiquidityScenario(worstCase.scenario)}`,
        `reference=${worstCase.referenceMintAmount.toString()}`,
      ].join(" "),
    );

    expect(worstCase.requiredMaxIterations).toBeLessThanOrEqual(DEFAULT_AMM_MATH_CONFIG.maxIterations);

    if (worstCase.requiredMaxIterations > 0) {
      const previousMintAmount = calculateAddLiquidityMintAmount(worstCase.scenario, {
        maxIterations: worstCase.requiredMaxIterations - 1,
      });
      expect(previousMintAmount).not.toBe(worstCase.referenceMintAmount);
    }
  });
});
