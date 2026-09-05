import { registerStream, listStreams, streamPortfolio } from './streams.js';
import { registerDataProduct, refreshDataProducts } from './data-products.js';
import { DEFAULT_STREAMS } from './defaults.js';

export {
  registerStream, setStreamState, markStreamSettled, listStreams, streamPortfolio,
  resetIncomeMemory, STREAM_STATES
} from './streams.js';
export {
  registerDataProduct, refreshDataProducts, listDataProducts, appraise, resetDataProductMemory
} from './data-products.js';
export { DEFAULT_STREAMS } from './defaults.js';
export {
  discoverIncomeStreams, DETECTORS, detectOpenedVenues, detectMaturingSeries,
  detectRecurringDemand, detectUnattributedSettlements
} from './discovery.js';

/**
 * The datasets this system is actually accumulating.
 *
 * Both are declared, including the one that is worth nothing, because the point
 * of recording `reconstructible` is to be able to say which is which. A store
 * that reported only its good asset would be the same self-flattering accounting
 * the settlement ledger exists to prevent.
 */
export const DEFAULT_DATA_PRODUCTS = [
  {
    productKey: 'hn-frontpage-history',
    title: 'Hacker News front-page position history',
    buyer: 'Developer-tool marketing teams and founders timing a launch; media monitoring vendors.',
    decision: 'When to post, and what score a submission needs to hold a position — answerable only '
      + 'against months of history, which nobody publishes.',
    // Every series the ranked collector writes. A product that declares fewer
    // keys than are collected quietly under-reports the asset it holds.
    seriesKeys: ['score', 'comments', 'age_minutes'].flatMap(field =>
      Array.from({ length: 10 }, (_, i) => `hn.frontpage.slot.${String(i + 1).padStart(2, '0')}.${field}`)),
    upstreamLicences: [{
      source: 'hn-frontpage-ranking',
      licence: 'Hacker News API, public and unauthenticated (https://github.com/HackerNews/API)',
      note: 'Derived facts about ranking and timing. No article text, no user data, no personal data.'
    }],
    resalePermitted: true,
    reconstructible: false,
    reconstructibleNote: 'No historical rank archive exists from the publisher or any third party. '
      + 'Every day of coverage is unrepeatable.'
  },
  {
    productKey: 'ecb-fx-daily',
    title: 'ECB euro reference rates, daily',
    buyer: 'Nobody. Declared so the store states plainly what is not an asset.',
    decision: 'Used internally to convert settlements; sold to no one.',
    seriesKeys: ['fx.eur.usd', 'fx.eur.inr', 'fx.eur.gbp'],
    upstreamLicences: [{ source: 'ecb-euro-reference-rates', licence: 'ECB — free reuse with attribution' }],
    resalePermitted: false,
    reconstructible: true,
    reconstructibleNote: 'The ECB publishes the complete history at eurofxref-hist.xml, so a buyer '
      + 'backfills it in one request. Keeping a daily copy accumulates nothing.'
  }
];

/**
 * Seeds the income hypotheses and data products on an empty install.
 *
 * Never overwrites state the system has already moved: a stream disproven by
 * measurement, or moved to EARNING by a settlement, stays where the evidence
 * put it. Same rule as seedDeadRails().
 */
export async function seedIncomeStreams() {
  const existing = new Set((await listStreams({})).map(s => s.streamKey));
  const seeded = [];
  for (const stream of DEFAULT_STREAMS) {
    if (existing.has(stream.streamKey)) continue;
    seeded.push(await registerStream(stream));
  }
  for (const product of DEFAULT_DATA_PRODUCTS) await registerDataProduct(product);
  return { seeded: seeded.length, streams: await listStreams({}) };
}

/**
 * One honest answer to "is this earning, and if not what is the cheapest next
 * test" — the question the whole portfolio exists to keep answerable.
 */
export async function incomeReport({ now = new Date() } = {}) {
  await seedIncomeStreams();
  const portfolio = await streamPortfolio();
  const products = await refreshDataProducts({ now });
  return {
    ...portfolio,
    dataProducts: products.map(p => ({
      productKey: p.productKey,
      observationDays: p.observationDays,
      rowCount: p.rowCount,
      sellable: p.sellable,
      blockers: p.blockers
    })),
    // Stated rather than implied: no settlement has ever cleared.
    verdict: portfolio.anySettled
      ? 'At least one stream has settled.'
      : 'Nothing has settled yet. Every number in this system is preparation until one does.'
  };
}
