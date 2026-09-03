/**
 * Seed venues for the satellite scanner. These three are the exact ones probed
 * by hand in this conversation — Upwork, Fiverr, California's unclaimed-property
 * registry — so the first automated run has a known-answer to check itself
 * against. Add more via registerTarget()/POST /api/scans/targets as new venues
 * come up; nothing here needs a redeploy to grow.
 */
export const DEFAULT_TARGETS = [
  {
    targetKey: 'upwork-job-search',
    targetUrl: 'https://www.upwork.com/nx/search/jobs/?q=bookkeeping',
    category: 'gig-platform',
    notes: 'Hand-checked 2026-09-03: Cloudflare "verify you are human" challenge on the first anonymous page load.'
  },
  {
    targetKey: 'fiverr-programming-tech',
    targetUrl: 'https://www.fiverr.com/categories/programming-tech',
    category: 'gig-platform',
    notes: 'Hand-checked 2026-09-03: catalog/listing model, not a job board; PerimeterX block ("needs a human touch") triggered on the second navigation.'
  },
  {
    targetKey: 'ca-unclaimed-property',
    targetUrl: 'https://ucpi.sco.ca.gov/',
    category: 'unclaimed-funds-registry',
    notes: 'Hand-checked 2026-09-03: no bot defense, $8.45B reported held; single name-in/one-result-out lookup, not bulk-queryable.'
  }
];
