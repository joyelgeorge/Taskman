/**
 * The default drone fleet and the cron contract.
 *
 * These drones are working examples against public, no-auth endpoints so the
 * system is demonstrably live on a fresh install. They are not a business: the
 * sources that matter are the ones only you can reach. Replace them via the API
 * or by editing this file — `registerDrone` upserts on id.
 */
export const DEFAULT_FLEET = [
  {
    /**
     * The only drone in this fleet that watches paid work.
     *
     * The other three watch Hacker News, which publishes news. Six hundred and
     * sixty-four signals were collected from them and a hundred and nineteen
     * promoted, and not one could ever have become money, because nobody on the
     * HN front page is offering to pay for anything. A discovery pipeline aimed
     * at news finds news.
     *
     * GitHub's search API is public, documented and unauthenticated for this
     * query, and returns issues whose maintainers have attached a bounty label —
     * work that someone has already said they will pay for. That is the
     * difference between a signal and a job.
     *
     * Rate limits are the reason for the six-hour interval: unauthenticated
     * search allows ten requests a minute, and one call every six hours sits far
     * beneath it. Fifty per run, newest first.
     */
    id: 'github-bounties',
    kind: 'http_json',
    name: 'GitHub — issues carrying a bounty',
    targetUrl: 'https://api.github.com/search/issues'
      + '?q=label:%22%F0%9F%92%8E+Bounty%22+state:open&sort=created&order=desc&per_page=50',
    intervalSeconds: 21600,
    config: {
      itemsPath: 'items',
      idField: 'id',
      titleField: 'title',
      urlField: 'html_url',
      kind: 'bounty',
      limit: 50
    },
    /**
     * Raw bounty-label search is noisy, and the noise is specific.
     *
     * A live run returned a benchmark fork of cal.com, a repo literally called
     * agent-playground asking to "Calculate the exact value of PI", and several
     * mirrors — none of which is work anyone will pay for. The label is easy to
     * attach and costs the attacher nothing, so it is evidence of intent to pay
     * and nothing more.
     *
     * These exclusions drop what has been observed rather than what might exist:
     * playgrounds, benchmarks and test scaffolding. staleAfterHours is generous
     * because a bounty stays open for weeks, unlike a news story.
     */
    rules: {
      exclude: ['playground', 'bench', 'sandbox', 'test-repo', 'demo-repo', 'mirror'],
      threshold: 0.3,
      staleAfterHours: 336
    }
  },
  {
    id: 'hn-new-stories',
    kind: 'http_json',
    name: 'Hacker News — new stories',
    targetUrl: 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=50',
    intervalSeconds: 900,
    config: {
      itemsPath: 'hits',
      idField: 'objectID',
      titleField: 'title',
      urlField: 'url',
      kind: 'story',
      limit: 50,
      rules: {
        include: ['hiring', 'launch', 'pricing', 'acquired', 'funding', 'outage'],
        exclude: ['ask hn:'],
        staleAfterHours: 12,
        threshold: 0.35
      }
    }
  },
  {
    id: 'hn-frontpage-feed',
    kind: 'rss',
    name: 'Hacker News — front page feed',
    targetUrl: 'https://news.ycombinator.com/rss',
    intervalSeconds: 1800,
    config: {
      kind: 'feed_item',
      limit: 30,
      rules: { staleAfterHours: 24, threshold: 0.3 }
    }
  },
  {
    id: 'hn-newest-page',
    kind: 'page_watch',
    name: 'Hacker News — newest page changes',
    targetUrl: 'https://news.ycombinator.com/newest',
    intervalSeconds: 3600,
    config: {
      kind: 'page_change',
      rules: { threshold: 0.3, staleAfterHours: 6 }
    }
  }
];

/**
 * Every cron the system runs, with the silence its watchdog will tolerate.
 *
 * Thresholds are generous relative to the schedule because free schedulers are
 * not punctual — GitHub Actions runs late by tens of minutes under load — and a
 * watchdog that cries wolf gets muted, which is worse than no watchdog.
 */
// maxSilenceSeconds is set from measured GitHub Actions delivery, not from the
// cron expression. GitHub treats `schedule` as best-effort and throttles it hard:
// measured on this repo over 24h, drone-dispatch (*/15), signal-process (*/20),
// health-check (*/30) and cron-monitor (0 * * * *) were ALL delivered at a median
// of ~2.5h with a p95 near 4.8h. Asking more often changes nothing — the four
// intervals produced statistically identical delivery.
//
// So a threshold derived from the nominal interval marks a healthy cron OVERDUE
// within the hour, forever. A watchdog that always cries wolf is worse than none,
// because it teaches you to ignore it. These thresholds sit above the measured
// p95; the schedules stay frequent because asking costs nothing and a spare slot
// is occasionally granted.
export const CRON_DEFINITIONS = [
  {
    cronName: 'drone-dispatch',
    schedule: '*/15 * * * *',
    maxSilenceSeconds: 21600,
    description: 'Flies every due drone and ingests the signals it brings back.'
  },
  {
    cronName: 'signal-process',
    schedule: '*/20 * * * *',
    maxSilenceSeconds: 21600,
    description: 'Scores new signals against their drone rules and promotes what passes.'
  },
  {
    cronName: 'health-check',
    schedule: '*/30 * * * *',
    maxSilenceSeconds: 21600,
    description: 'Checks db, deployed services, drones and crons; opens and resolves alerts.'
  },
  {
    cronName: 'cron-monitor',
    schedule: '0 * * * *',
    maxSilenceSeconds: 21600,
    description: 'The watchdog. Detects crons that have gone silent, including itself.'
  },
  {
    cronName: 'revenue-check',
    schedule: '0 */6 * * *',
    maxSilenceSeconds: 32400,
    description: 'Syncs settlements from the payment processor and enforces rail viability.'
  },
  {
    cronName: 'stream-discovery',
    schedule: '0 5 * * *',
    maxSilenceSeconds: 172800,
    description: 'Proposes new income streams from recorded evidence — scans, rollups, signals, '
      + 'settlements. Never from a model: an idea available by prompting is arbitraged to zero.'
  },
  {
    cronName: 'improve',
    schedule: '0 3 * * *',
    maxSilenceSeconds: 108000,
    description: 'Researches the system’s own evidence and files improvement proposals.'
  },
  {
    cronName: 'data-collect',
    schedule: '0 17 * * *',
    maxSilenceSeconds: 115200,
    description: 'Collects declared observation sources, rolls the day up, prunes raw rows past retention. Once a day, after the ECB publishes.'
  },
  {
    cronName: 'satellite-scan',
    schedule: '0 8 * * *',
    maxSilenceSeconds: 115200,
    description: 'Reconnaissance of candidate money-flow venues — reachable? bot-defended? what shape? Once a day: venue structure does not change hour to hour, and infrequent, honest single GETs are the polite way to ask a third-party site whether it can be automated at all.'
  },
  {
    cronName: 'finance-report',
    schedule: '0 0 * * *',
    maxSilenceSeconds: 115200,
    description: 'Snapshots the finance report once a day to track net position, burn rate, and runway trends.'
  }
];

export const CRON_NAMES = CRON_DEFINITIONS.map(c => c.cronName);
