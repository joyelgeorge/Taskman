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
export const CRON_DEFINITIONS = [
  {
    cronName: 'drone-dispatch',
    schedule: '*/15 * * * *',
    maxSilenceSeconds: 3600,
    description: 'Flies every due drone and ingests the signals it brings back.'
  },
  {
    cronName: 'signal-process',
    schedule: '*/20 * * * *',
    maxSilenceSeconds: 5400,
    description: 'Scores new signals against their drone rules and promotes what passes.'
  },
  {
    cronName: 'health-check',
    schedule: '*/30 * * * *',
    maxSilenceSeconds: 7200,
    description: 'Checks db, deployed services, drones and crons; opens and resolves alerts.'
  },
  {
    cronName: 'cron-monitor',
    schedule: '0 * * * *',
    maxSilenceSeconds: 10800,
    description: 'The watchdog. Detects crons that have gone silent, including itself.'
  },
  {
    cronName: 'revenue-check',
    schedule: '0 */6 * * *',
    maxSilenceSeconds: 32400,
    description: 'Syncs settlements from the payment processor and enforces rail viability.'
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
