/**
 * DeFi Opportunity & Liquidation Scanner
 * Evaluates DEX arbitrage spreads and lending protocol liquidation margins on L2 (Base / Arbitrum).
 */

export const SUPPORTED_CHAINS = Object.freeze({
  BASE: {
    id: 8453,
    name: 'Base',
    rpc: 'https://mainnet.base.org',
    dexes: ['Aerodrome', 'Uniswap_v3']
  },
  ARBITRUM: {
    id: 42161,
    name: 'Arbitrum One',
    rpc: 'https://arb1.arbitrum.io/rpc',
    dexes: ['Camelot', 'Uniswap_v3']
  }
});

export function calculateArbitrageNetProfit({
  buyPriceUsd,
  sellPriceUsd,
  tradeAmountUsd,
  estimatedGasUsd = 0.05,
  dexFeeBps = 30, // 0.30%
  minProfitThresholdUsd = 2.00
}) {
  if (buyPriceUsd <= 0 || sellPriceUsd <= 0 || tradeAmountUsd <= 0) {
    return { profitable: false, netProfitUsd: 0, reason: 'INVALID_INPUTS' };
  }

  const grossGainRatio = (sellPriceUsd - buyPriceUsd) / buyPriceUsd;
  const grossProfitUsd = tradeAmountUsd * grossGainRatio;
  const totalDexFeesUsd = tradeAmountUsd * (dexFeeBps / 10000) * 2;
  const netProfitUsd = grossProfitUsd - totalDexFeesUsd - estimatedGasUsd;

  return {
    profitable: netProfitUsd >= minProfitThresholdUsd,
    netProfitUsd: Number(netProfitUsd.toFixed(4)),
    grossProfitUsd: Number(grossProfitUsd.toFixed(4)),
    totalCostsUsd: Number((totalDexFeesUsd + estimatedGasUsd).toFixed(4)),
    spreadPercent: Number((grossGainRatio * 100).toFixed(4))
  };
}

export function evaluateLiquidationOpportunity({
  collateralUsd,
  debtUsd,
  liquidationThreshold = 0.85,
  bonusPercent = 5.0, // 5% liquidation bonus
  maxGasFeeUsd = 1.50
}) {
  if (collateralUsd <= 0 || debtUsd <= 0) {
    return { liquidatable: false, estimatedBountyUsd: 0 };
  }

  const currentHealthFactor = (collateralUsd * liquidationThreshold) / debtUsd;
  const liquidatable = currentHealthFactor < 1.0;

  if (!liquidatable) {
    return {
      liquidatable: false,
      healthFactor: Number(currentHealthFactor.toFixed(4)),
      estimatedBountyUsd: 0
    };
  }

  // Max close factor typically 50%
  const maxCloseDebt = debtUsd * 0.50;
  const grossBountyUsd = maxCloseDebt * (bonusPercent / 100);
  const netBountyUsd = Math.max(0, grossBountyUsd - maxGasFeeUsd);

  return {
    liquidatable: true,
    healthFactor: Number(currentHealthFactor.toFixed(4)),
    repayAmountUsd: Number(maxCloseDebt.toFixed(2)),
    grossBountyUsd: Number(grossBountyUsd.toFixed(2)),
    netBountyUsd: Number(netBountyUsd.toFixed(2))
  };
}
