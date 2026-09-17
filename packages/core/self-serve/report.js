/**
 * The self-serve product's core: a free teaser (counts only) and a paid report
 * (the exact fixes). See the self-serve-revenue-lane skill.
 *
 * The scan is free everywhere; the FIX is the product. So freeReport deliberately
 * withholds all remediation detail, and generateFix — the moat — turns each
 * finding into exact, actionable steps a developer can apply without us.
 *
 * Pure and deterministic: no network, no state. The plumbing (a public endpoint,
 * a checkout link) wraps this; the value is here and is fully testable.
 */

/** Extract a table name from a missing-rls finding's evidence ("table: orders"). */
function tableOf(evidence = '') {
  const m = /table:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(evidence);
  return m ? m[1] : 'your_table';
}

/**
 * Turn one finding into exact remediation steps. This is what the paid tier
 * delivers and what the free tier must never leak.
 */
export function generateFix(finding = {}) {
  switch (finding.kind) {
    case 'exposed-secret':
      return {
        title: 'Rotate the exposed key, then move it server-side',
        steps: [
          'Rotate the key now in your provider dashboard (Supabase → Settings → API → roll the service_role key). This invalidates the exposed one immediately.',
          'The old key stays in your git history and any deployed bundle forever — rotating is the only real fix; deleting the line is not.',
          'Store the new key in a server-side environment variable, never in client code or the repo.',
          'Confirm the key is gone from the client bundle after your next deploy.'
        ]
      };
    case 'missing-rls': {
      const t = tableOf(finding.evidence);
      return {
        title: `Enable Row-Level Security on ${t}`,
        steps: [
          `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
          `CREATE POLICY "${t}_owner" ON ${t}`,
          '  FOR ALL USING ((select auth.uid()) = user_id);',
          `-- adjust the column if ${t} scopes rows by something other than user_id.`,
          'Without a policy, enabling RLS denies all access; with the wrong column it exposes the wrong rows — verify against your schema.'
        ]
      };
    }
    case 'open-cors':
      return {
        title: 'Restrict CORS to your own origins',
        steps: [
          'Replace the wildcard Access-Control-Allow-Origin: * with an explicit allowlist of your own domains.',
          'Never combine a wildcard origin with Access-Control-Allow-Credentials: true — a malicious site can then make authenticated calls using the signed-in user\'s session.',
          'If you need multiple origins, echo the request Origin only when it is in your allowlist.'
        ]
      };
    case 'unauthenticated-admin-route':
      return {
        title: 'Add an authentication guard to the admin route',
        steps: [
          'Require a verified admin session at the top of the handler, returning 401/403 before any work.',
          'If you guard admin pages in middleware, confirm the matcher also covers /api/admin — a check on /admin does not match /api/admin.',
          'Verify by calling the endpoint without a session: it must not act.'
        ]
      };
    default:
      return {
        title: 'Review this finding',
        steps: [
          'This finding needs a manual review against your codebase.',
          'Confirm whether the flagged code is reachable by an unauthenticated user, and restrict it if so.'
        ]
      };
  }
}

function countByKind(findings = []) {
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  return byKind;
}

/** The free teaser: real counts, zero remediation detail. Honest and alarming. */
export function freeReport({ app, findings = [] } = {}) {
  return {
    app: app || null,
    total: findings.length,
    byKind: countByKind(findings),
    locked: true,
    message: findings.length
      ? `Found ${findings.length} issue(s). Unlock the report for the exact fixes.`
      : 'No issues found in what is publicly reachable.'
  };
}

/** The paid report: every finding with its generated fix. Served after checkout. */
export function paidReport({ app, findings = [] } = {}) {
  return {
    app: app || null,
    total: findings.length,
    byKind: countByKind(findings),
    locked: false,
    fixes: findings.map(f => ({ kind: f.kind, where: f.file || null, ...generateFix(f) }))
  };
}
