/**
 * Seed observation sources.
 *
 * Two, deliberately. The rule from docs/DATA_ECOSYSTEM.md §5 is that a source
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
    // Kept for the margin decision, but honestly labelled: the ECB publishes the
    // complete historical series at eurofxref-hist.xml, so anyone can backfill
    // this in one request. Collecting it daily earns a live number for our own
    // conversion decisions and accumulates no asset whatsoever.
    reconstructible: true,
    reconstructibleNote: 'ECB publishes the full history at '
      + 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml — verified 2026-09-05.',
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
  },
  {
    /**
     * The opposite case, and the reason this source exists.
     *
     * Hacker News publishes the current ranking and nothing else. There is no
     * archive of what sat at position 3 at 14:00 on a given day, from Y
     * Combinator or anyone else, and it cannot be reconstructed after the fact
     * at any price. That makes elapsed time the entire moat: every day this runs,
     * the series becomes something a buyer cannot obtain another way.
     *
     * Recorded per slot, not per story, so the series stays bounded and rolls up
     * cleanly: "what score holds the top spot, and how old is it when it gets
     * there" — the question anyone timing a launch actually asks.
     *
     * The official Firebase API is public, unauthenticated, documented for reuse
     * at github.com/HackerNews/API, and carries no rate limit. No scraping.
     */
    // Checked, 2026-09-05, and the moat does not exist. Disabled below.
    //
    // The premise was that nobody archives front-page rank, so elapsed time could
    // not be bought. All three parts of that are false:
    //
    //   - Hacker News itself exposes the exact front-page list for every date
    //     since 2014-11-11. The publisher archives it.
    //   - toddwschneider/hntrends is a free public dataset of front-page items
    //     back to 2006, on GitHub, updated nightly to the present day.
    //   - sangaline's front-page-snapshots covers 2007-2017 with the vote total,
    //     age and relative position of each story — the same three fields this
    //     source collects — under GPL-3.0.
    //
    // A buyer obtains two decades of this for free. Collecting it accumulates
    // nothing, exactly like the ECB series above.
    reconstructible: true,
    reconstructibleNote: 'Reconstructible in full. HN publishes the exact front-page list since '
      + '2014-11-11; toddwschneider/hntrends mirrors it back to 2006 free and nightly; '
      + 'sangaline/reverse-engineering-the-hacker-news-ranking-algorithm holds 2007-2017 snapshots '
      + 'with position, score and age. Verified 2026-09-05.',
    // Kept in the file rather than deleted so the disproof stays attached to the
    // thing it disproves, and nobody adds it again next quarter.
    enabled: false,
    sourceKey: 'hn-frontpage-ranking',
    kind: 'http_json_ranked',
    url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    licence: 'Hacker News API — public and unauthenticated, documented for reuse '
      + '(https://github.com/HackerNews/API). Facts about ranking, not article content.',
    decision: 'What score and story age it takes to hold each front-page position, and how that '
      + 'moves over months — which decides when a launch or post is worth timing.',
    // Six-hourly. The workflow previously ran once a day while this declared
    // 21600s, so the series was collected once daily whatever this said — and a
    // single 17:00 snapshot cannot answer the intraday question the product
    // claims to answer. GitHub delivers scheduled runs roughly every 2.5h at
    // best (measured), so this asks for four and will often get fewer.
    intervalSeconds: 21600,
    config: {
      seriesPrefix: 'hn.frontpage',
      itemUrlTemplate: 'https://hacker-news.firebaseio.com/v0/item/{id}.json',
      slots: 10,
      slotFields: { score: 'score', comments: 'descendants' },
      ageSeriesKey: 'age_minutes'
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
