/**
 * Observation signal sources — the intelligence feeds that change decisions.
 *
 * Design rule (docs/DATA_ECOSYSTEM.md §5): a source is added only when a
 * specific decision needs it. Every source here names that decision explicitly.
 *
 * Each source carries a `sourceWeight` (0.5–1.5). This is not hand-set
 * permanently — it is the *prior* used until the learning loop accumulates
 * enough conversion evidence to update it via Bayesian beta-distribution
 * updates. Peer-reviewed or official sources start higher; social / noisy
 * sources start lower. All start at calibrated values based on known
 * signal-to-noise characteristics of the source type.
 *
 * Addition log:
 *   2026-09-03  ECB FX + HN frontpage (original two operational sources)
 *   2026-09-05  +5 intelligence feeds for lane discovery and demand sensing
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
    // Official ECB statistical release — highest credibility. Weight 1.5.
    sourceWeight: 1.5,
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
    // Curated, tech-credible audience. Weight 1.0 = baseline.
    sourceWeight: 1.0,
    config: {
      seriesPrefix: 'hn.frontpage',
      itemUrlTemplate: 'https://hacker-news.firebaseio.com/v0/item/{id}.json',
      slots: 10,
      slotFields: { score: 'score', comments: 'descendants' },
      ageSeriesKey: 'age_minutes'
    }
  },

  // ─── INTELLIGENCE FEEDS (added 2026-09-05) ───────────────────────────────

  {
    /**
     * HN monthly "Who is Hiring?" thread.
     * The single most accurate real-time signal of what companies are willing
     * to pay for right now. Each comment is a job post. Parsing for tech stack,
     * role, and salary signals tells us which lanes have active paying demand.
     *
     * Decision: "Which technical services have the most active corporate buyer
     * demand this month, and what are companies paying for them?"
     *
     * Official public HN API, unauthenticated. Item ID changes monthly —
     * the collector must query the monthly Ask HN index to find the current ID.
     */
    reconstructible: true,
    reconstructibleNote: 'Algolia HN search API preserves full comment history.',
    sourceKey: 'hn-who-is-hiring',
    kind: 'http_json',
    url: 'https://hacker-news.firebaseio.com/v0/item/43316774.json',
    licence: 'Hacker News API — public and unauthenticated (github.com/HackerNews/API). Text facts only.',
    decision: 'Which technical skills companies are paying for this month — determines which service lanes to invest in.',
    sourceWeight: 1.2,
    intervalSeconds: 86400,
    config: {
      seriesPrefix: 'hn.hiring',
      itemsPath: 'kids',
      limit: 50
    }
  },

  {
    /**
     * Reddit r/Entrepreneur RSS feed.
     * Social signal of what bootstrappers and small businesses are actively
     * struggling with and willing to pay to solve. High noise, but high volume.
     * Patterns that recur across 10+ posts in a week are real demand signals.
     *
     * Decision: "What problems do small business owners have right now that
     * they're publicly asking for help with — i.e., things they'd pay for?"
     *
     * RSS is public, documented, no auth required.
     */
    reconstructible: true,
    reconstructibleNote: 'Reddit archives all posts via Pushshift API and old.reddit.com.',
    sourceKey: 'reddit-entrepreneur',
    kind: 'rss',
    url: 'https://www.reddit.com/r/Entrepreneur.rss',
    licence: 'Reddit API — public RSS feed, read-only, no personal data extracted.',
    decision: 'What recurring pain points small business owners pay to solve — identifies new service lanes.',
    sourceWeight: 0.75,
    intervalSeconds: 21600,
    config: {
      seriesPrefix: 'social.reddit.entrepreneur',
      titleField: 'title',
      urlField: 'link',
      limit: 20
    }
  },

  {
    /**
     * arXiv cs.AI + cs.LG daily feed.
     * Peer-reviewed research is 6–18 months ahead of commercial adoption.
     * A cluster of papers on a specific topic (e.g. "RAG for legal documents")
     * is a reliable predictor of a service demand wave 12 months out.
     *
     * Decision: "What AI capabilities are maturing now that will become
     * commercially viable in 6-18 months — where should we build early?"
     *
     * arXiv API is public, unauthenticated, explicitly documented for reuse.
     */
    reconstructible: true,
    reconstructibleNote: 'arXiv publishes full history and bulk data access at arxiv.org/help/bulk_data.',
    sourceKey: 'arxiv-cs-ai',
    kind: 'rss',
    url: 'https://rss.arxiv.org/rss/cs.AI',
    licence: 'arXiv — open access, CC BY 4.0 for metadata.',
    decision: 'Which AI capabilities are maturing now — 12-month forward indicator of viable service lanes.',
    sourceWeight: 1.35,
    intervalSeconds: 86400,
    config: {
      seriesPrefix: 'research.arxiv.ai',
      titleField: 'title',
      urlField: 'link',
      limit: 25
    }
  },

  {
    /**
     * IndieHackers newest products RSS.
     * Bootstrappers publishing revenue numbers publicly. The real signal here
     * is: what SaaS categories are generating $500–$5k/mo MRR from solo
     * operators? That is the exact demand zone this system can serve.
     *
     * Decision: "What micro-SaaS categories have proven consumer willingness-
     * to-pay at the $10–$50/mo price point right now?"
     *
     * Public RSS, no scraping, no personal data.
     */
    reconstructible: true,
    reconstructibleNote: 'IndieHackers product archive is publicly accessible.',
    sourceKey: 'indiehackers-products',
    kind: 'rss',
    url: 'https://www.indiehackers.com/products?sorting=newest&revenue=1&feed=rss',
    licence: 'IndieHackers — public RSS, read-only product data.',
    decision: 'Which micro-SaaS categories have proven consumer willingness-to-pay right now.',
    sourceWeight: 1.0,
    intervalSeconds: 86400,
    config: {
      seriesPrefix: 'social.indiehackers',
      titleField: 'title',
      urlField: 'link',
      limit: 20
    }
  },

  {
    /**
     * Reuters Technology RSS.
     * Professional financial and corporate reporting. Story clusters here
     * (M&A, layoffs, new product launches, regulatory changes) are high-quality
     * corroborating signals for investment theses and service demand.
     *
     * Decision: "What industry events are happening that create near-term
     * demand for specific services (e.g. a company restructuring = financial
     * reconciliation need, a new regulation = compliance tooling demand)?"
     *
     * Reuters RSS is public and machine-readable. No scraping.
     */
    reconstructible: true,
    reconstructibleNote: 'Reuters archives all published articles.',
    sourceKey: 'reuters-technology',
    kind: 'rss',
    url: 'https://feeds.reuters.com/reuters/technologyNews',
    licence: 'Reuters — public RSS feed. No reproduction of article body; titles and URLs only.',
    decision: 'Industry-level events that create near-term demand for specific services.',
    sourceWeight: 1.3,
    intervalSeconds: 21600,
    config: {
      seriesPrefix: 'news.reuters.tech',
      titleField: 'title',
      urlField: 'link',
      limit: 20
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
