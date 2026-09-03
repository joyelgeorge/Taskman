/**
 * Seed observation sources.
 *
 * One, deliberately. The rule from docs/DATA_ECOSYSTEM.md §5 is that a source
 * gets added when a specific decision needs it — not to make the store look
 * populated. This is the series with immediate margin impact: settlements
 * arrive in USD, costs are in INR, and a 3% move on every payout is pure
 * margin that currently nobody is measuring.
 *
 * The ECB publishes this feed specifically for reuse, refreshed each business
 * day around 16:00 CET. It is an official statistical release, not a scrape.
 */
export const DEFAULT_SOURCES = [
  {
    sourceKey: 'ecb-euro-reference-rates',
    kind: 'http_xml',
    url: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    licence: 'ECB — free reuse with attribution (https://www.ecb.europa.eu/services/disclaimer/html/index.en.html)',
    decision: 'What a USD settlement is actually worth in INR on the day it cleared, and whether to hold or convert.',
    intervalSeconds: 86400,
    config: {
      seriesPrefix: 'fx.eur',
      tag: 'Cube',
      keyAttribute: 'currency',
      valueAttribute: 'rate',
      observedAtPath: 'time',
      // EUR-based, so USD/INR is derived from these two rather than fetched.
      keys: ['USD', 'INR', 'GBP']
    }
  }
];

/**
 * The ECB quotes everything against EUR, so a USD→INR rate is a cross rate.
 * Kept as a named function rather than inlined so the arithmetic is testable
 * and so nobody later mistakes a derived rate for an observed one.
 */
export function crossRate({ fromRatePerEur, toRatePerEur }) {
  const from = Number(fromRatePerEur);
  const to = Number(toRatePerEur);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return Number((to / from).toFixed(6));
}
