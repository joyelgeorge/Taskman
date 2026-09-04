import { listRollups, listObservations } from '../observations/store.js';
import { crossRate } from '../observations/sources.js';

/**
 * Resolves the historical or nearest prior USD -> INR rate for a given date.
 * Fall back to nearest earlier observation/rollup if weekend or holiday.
 *
 * Returns: { rate: number, derived: true, observedDate: string } or null
 */
export async function resolveUsdInrRate(targetDateStr) {
  const targetDate = (targetDateStr ? new Date(targetDateStr) : new Date()).toISOString().slice(0, 10);

  // Check rollups first
  const usdRollups = await listRollups({ seriesKey: 'fx.eur.USD', limit: 100 });
  const inrRollups = await listRollups({ seriesKey: 'fx.eur.INR', limit: 100 });

  // Filter for <= targetDate and sort desc
  const matchingUsd = usdRollups
    .filter(r => r.bucketDate <= targetDate && r.valueLast != null)
    .sort((a, b) => b.bucketDate.localeCompare(a.bucketDate))[0];

  const matchingInr = inrRollups
    .filter(r => r.bucketDate <= targetDate && r.valueLast != null)
    .sort((a, b) => b.bucketDate.localeCompare(a.bucketDate))[0];

  if (matchingUsd && matchingInr) {
    const rate = crossRate({
      fromRatePerEur: matchingUsd.valueLast,
      toRatePerEur: matchingInr.valueLast
    });
    if (rate != null) {
      return {
        rate,
        derived: true,
        source: 'ecb-cross-rate',
        observedDate: matchingUsd.bucketDate
      };
    }
  }

  // Fallback: check raw observations
  const usdObs = await listObservations({ seriesKey: 'fx.eur.USD', limit: 100 });
  const inrObs = await listObservations({ seriesKey: 'fx.eur.INR', limit: 100 });

  const latestUsd = usdObs
    .filter(o => o.observedAt.slice(0, 10) <= targetDate && o.valueNum != null)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];

  const latestInr = inrObs
    .filter(o => o.observedAt.slice(0, 10) <= targetDate && o.valueNum != null)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];

  if (latestUsd && latestInr) {
    const rate = crossRate({
      fromRatePerEur: latestUsd.valueNum,
      toRatePerEur: latestInr.valueNum
    });
    if (rate != null) {
      return {
        rate,
        derived: true,
        source: 'ecb-cross-rate',
        observedDate: latestUsd.observedAt.slice(0, 10)
      };
    }
  }

  return null;
}
