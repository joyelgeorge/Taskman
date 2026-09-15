/**
 * Warm-lead discovery — the engine the repo calls primary and never built.
 *
 * Warm intent (someone ALREADY asking for help securing their vibe-coded app)
 * converts on a different order from cold disclosure to a stranger. This
 * surfaces it from GitHub issue/discussion search — public, read-only, and
 * reliably reachable — and shapes each thread into a candidate.
 *
 * What is automated: finding the threads and keeping them. What stays human:
 * reading a thread to judge whether the intent is genuine, and writing the
 * reply. Those cannot be faked, so every candidate is flagged needsHumanRead and
 * nothing here contacts anyone.
 */

/** Help-seeking searches. Phrased to catch people asking, not people mentioning. */
export const WARM_QUERIES = Object.freeze([
  'supabase RLS how to secure in:title,body state:open type:issue',
  'exposed supabase service_role key help in:title,body state:open type:issue',
  'my app got hacked supabase help in:title,body state:open type:issue',
  'how do I secure my lovable app in:title,body state:open type:issue',
  'firebase security rules insecure help in:title,body state:open type:issue'
]);

/**
 * Shape GitHub issue-search results into warm-lead candidates.
 * @param {Array}  issues  raw search/issues items
 * @param {Object} opts    { self } — the operator's own login, never surfaced
 */
export function warmLeadCandidates(issues = [], { self = null } = {}) {
  const byUrl = new Map();
  for (const it of issues) {
    if (!it || it.state !== 'open') continue;                 // the moment has passed
    if (self && it.user?.login === self) continue;            // never our own threads
    const url = it.html_url;
    if (!url || byUrl.has(url)) continue;
    byUrl.set(url, {
      url,
      source: 'github-issue',
      title: it.title || '(no title)',
      author: it.user?.login || null,
      createdAt: it.created_at || null,
      needsHumanRead: true   // a person judges the intent before any contact
    });
  }
  return [...byUrl.values()];
}
