import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateArbitrageNetProfit, evaluateLiquidationOpportunity } from '../packages/core/crypto/scanner.js';

test('DeFi Scanner: identifies profitable DEX arbitrage opportunity after fees and gas', () => {
  const result = calculateArbitrageNetProfit({
    buyPriceUsd: 100.0,
    sellPriceUsd: 101.5, // 1.5% spread
    tradeAmountUsd: 1000.0,
    estimatedGasUsd: 0.05,
    dexFeeBps: 30, // 0.3% per leg -> 0.6% total ()
    minProfitThresholdUsd: 2.00
  });

  // Gross profit = , fees = , gas = zsh.05 -> Net = .95
  assert.equal(result.profitable, true);
  assert.equal(result.netProfitUsd, 8.95);
  assert.equal(result.spreadPercent, 1.5);
});

test('DeFi Scanner: rejects unprofitable spread where fees exceed gain', () => {
  const result = calculateArbitrageNetProfit({
    buyPriceUsd: 100.0,
    sellPriceUsd: 100.4, // 0.4% spread
    tradeAmountUsd: 1000.0,
    estimatedGasUsd: 0.05,
    dexFeeBps: 30
  });

  // Gross profit = , fees =  -> Net is negative
  assert.equal(result.profitable, false);
  assert.ok(result.netProfitUsd < 0);
});

test('DeFi Scanner: accurately identifies healthy loan vs undercollateralized liquidation', () => {
  // Healthy position:  collateral,  debt, threshold 85% -> HF = (1000 * 0.85) / 700 = 1.214 (healthy)
  const healthy = evaluateLiquidationOpportunity({
    collateralUsd: 1000,
    debtUsd: 700,
    liquidationThreshold: 0.85
  });
  assert.equal(healthy.liquidatable, false);
  assert.ok(healthy.healthFactor > 1.0);

  // Unhealthy position:  collateral,  debt, threshold 85% -> HF = 850 / 950 = 0.894 (< 1.0)
  const unhealthy = evaluateLiquidationOpportunity({
    collateralUsd: 1000,
    debtUsd: 950,
    liquidationThreshold: 0.85,
    bonusPercent: 5.0,
    maxGasFeeUsd: 1.00
  });
  assert.equal(unhealthy.liquidatable, true);
  assert.ok(unhealthy.healthFactor < 1.0);
  assert.equal(unhealthy.repayAmountUsd, 475.00); // 50% max close factor
  assert.equal(unhealthy.grossBountyUsd, 23.75); // 5% of 475
  assert.equal(unhealthy.netBountyUsd, 22.75); // minus gas
});
