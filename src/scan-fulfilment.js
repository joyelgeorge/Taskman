import { auditCodebase } from './codebase-audit.js';
import { summarizeFindings, headline } from '../packages/core/findings/report.js';
import { refuteUnreachable } from '../packages/core/findings/reachability.js';
import { recordAttempt, recordSettlement, SETTLEMENT_STATUS, VERIFIED_SOURCES } from './money-ledger.js';
import { markStreamSettled, registerStream, listStreams } from '@taskman/core';

/**
 * One paid AI-app security scan, delivered and booked.
 *
 * This is the money surface for the validated vibe-coded market (see the brain's
 * CRITICAL STRATEGIC FINDING): a founder who shipped fast with Lovable/Cursor/
 * Bolt + Supabase pays to have the security holes their AI generator left behind
 * found and fixed. The chain is exercised end to end here before a real dollar
 * arrives — scan run, report built, work recorded as a rail attempt, settlement
 * written against a verifiable PayPal reference — so the first customer does not
 * hit an untested path.
 *
 * The settlement rule is not relaxed for this lane: `source` must be one of
 * stripe / paypal / bank / manual_receipt and `externalRef` must identify the
 * payment outside this system, or no settlement is written and nothing reads as
 * revenue. A scan with no confirmed payment is an order, not income.
 */

export const SCAN_STREAM_KEY = 'ai-app-security-scan';
export const SCAN_RAIL = 'ai-app-scan';

// The sellable classes and how they read to a buyer. Kept explicit so a new
// detector does not silently change what a customer is charged for.
const SELLABLE = {
  'exposed-secret': 'CRITICAL',
  'missing-rls': 'CRITICAL',
  'unauthenticated-admin-route': 'HIGH',
  'open-cors': 'HIGH',
  'ssrf': 'HIGH',
  'command-injection': 'HIGH',
  'path-prefix-guard': 'HIGH'
};

export const SCAN_TIERS = Object.freeze({
  scan: { priceCents: 9900, label: 'Scan', includesFix: false },
  fix: { priceCents: 24900, label: 'Scan + Fix', includesFix: true }
});

const PAYPAL = 'https://paypal.me/joyelgt';

export function buildScanReport(findings, { preparedFor = null, textByFile = {} } = {}) {
  const inScope = (findings || []).filter((f) => SELLABLE[f.kind]);

  // Refutation runs BEFORE anything is counted (R4.5). A count that has not
  // survived refutation is a count of findings, not problems, and the two
  // differed ~5x on the only batch this has been measured against.
  const { reportable, contested, refuted } = refuteUnreachable(inScope, { textByFile });

  const critical = reportable.filter((f) => SELLABLE[f.kind] === 'CRITICAL').length;
  const high = reportable.length - critical;
  const summary = summarizeFindings(reportable);

  const lines = [];
  lines.push('# AI App Security Scan Report');
  if (preparedFor) lines.push(`\nPrepared for: ${preparedFor}`);

  // Never the raw total alone. One unprotected schema dump emitting seventy
  // findings is twelve files of work, and saying "70" is the lie this report
  // exists not to tell.
  lines.push(`\n**${headline(summary)}** ${critical} critical, ${high} high.\n`);
  if (summary.inflation > 1) {
    lines.push(`_The detector emits one finding per occurrence, so the raw count `
      + `overstates the work by ${summary.inflation}x. The number above is distinct `
      + `problems._\n`);
  }
  if (!reportable.length) lines.push('No issues in the covered classes were found. That is a clean result, not an empty one.\n');

  reportable.forEach((f, i) => {
    lines.push(`## ${i + 1}. [${SELLABLE[f.kind]}] ${f.kind}`);
    lines.push(`- **Where:** ${f.file}:${f.line}`);
    lines.push(`- **Evidence:** ${f.evidence}`);
    lines.push(`- **Why it matters:** ${f.why}`);
    lines.push(`- **Confirm / fix:** ${f.confirm}\n`);
  });

  // Shown, not hidden. A contested finding is the cheapest minute a human can
  // spend, and a refuted one proves the report tried to disprove itself.
  if (contested.length) {
    lines.push(`## Needs a human eye (${contested.length})\n`);
    lines.push('Two checks disagreed about these. They are not counted above.\n');
    contested.forEach((f) => lines.push(`- ${f.kind} at ${f.file}:${f.line} — ${f.reachability.reason}`));
    lines.push('');
  }
  if (refuted.length) {
    lines.push(`## Checked and dismissed (${refuted.length})\n`);
    lines.push('Flagged by the detector, refuted on inspection. Listed so nothing is quietly dropped.\n');
    refuted.forEach((f) => lines.push(`- ${f.kind} at ${f.file}:${f.line} — ${f.reachability.reason}`));
    lines.push('');
  }

  return {
    markdown: lines.join('\n'),
    summary: {
      total: reportable.length,
      critical,
      high,
      problems: summary.totalProblems,
      rawFindings: summary.totalFindings,
      inflation: summary.inflation,
      contested: contested.length,
      refuted: refuted.length
    }
  };
}

/**
 * Run the scan and produce the deliverable + a payment instruction. Books
 * nothing — there is no payment yet. This is what a buyer sees before paying.
 */
export async function prepareScanOrder({ root, tier = 'scan', preparedFor = null } = {}) {
  const t = SCAN_TIERS[tier];
  if (!t) throw new Error(`unknown tier "${tier}" — one of ${Object.keys(SCAN_TIERS).join(', ')}`);
  const result = await auditCodebase(root);
  const findings = (result.findings || result).filter((f) => SELLABLE[f.kind]);
  const report = buildScanReport(findings, { preparedFor });
  return {
    tier,
    priceCents: t.priceCents,
    findings,
    report,
    payment: {
      rail: 'paypal',
      link: `${PAYPAL}/${Math.round(t.priceCents / 100)}`,
      note: `${t.label}: $${(t.priceCents / 100).toFixed(0)} — ${report.summary.total} issues found`
    }
  };
}

/**
 * Deliver a paid scan and book it. Mirrors fulfilAuditOrder: the report is built
 * FIRST (nothing is booked for an undeliverable scan), then the work and the
 * verified settlement are recorded, and only a cleared settlement moves the
 * stream to earning.
 */
export async function fulfilScanOrder({
  root,
  tier = 'scan',
  preparedFor = null,
  source,
  externalRef,
  grossCents,
  feeCents = 0,
  currency = 'USD',
  status = SETTLEMENT_STATUS.CLEARED,
  confirmation = null,
  minutesSpent,
  now = new Date()
} = {}) {
  if (!VERIFIED_SOURCES.includes(source)) {
    throw new Error(`source must be one of ${VERIFIED_SOURCES.join(', ')} — a payment this system cannot confirm is not revenue`);
  }
  if (!externalRef) throw new Error('externalRef is required: the payment reference is what makes this checkable later');
  if (!Number.isFinite(Number(minutesSpent)) || Number(minutesSpent) <= 0) {
    throw new Error('minutesSpent is required and must be positive — an unmeasured hour is how a lane looks profitable while losing');
  }

  // Deliverable first. If the scan cannot be produced, nothing is booked.
  const result = await auditCodebase(root);
  const findings = (result.findings || result).filter((f) => SELLABLE[f.kind]);
  const report = buildScanReport(findings, { preparedFor });

  const attempt = await recordAttempt({
    rail: SCAN_RAIL,
    candidateKey: externalRef,
    stage: 'DELIVER',
    costCents: 0,
    evidence: { minutesSpent: Number(minutesSpent), tier, preparedFor, issues: report.summary.total },
    startedAt: now.toISOString()
  });

  const settlement = await recordSettlement({
    rail: SCAN_RAIL,
    attemptId: attempt.id,
    source,
    externalRef,
    grossCents,
    feeCents,
    currency,
    status,
    confirmation,
    verification: { deliverable: 'ai-app-security-scan', tier, preparedFor, issues: report.summary.total }
  });

  let stream = null;
  if (status === SETTLEMENT_STATUS.CLEARED) {
    const known = new Set((await listStreams({})).map((s) => s.streamKey));
    if (!known.has(SCAN_STREAM_KEY)) {
      await registerStream({
        streamKey: SCAN_STREAM_KEY,
        title: 'AI app security scan, sold to vibe-coded app builders',
        mechanism: 'Buyer pays to have the security holes their AI code generator left behind found and fixed.',
        requires: 'A payment account and a builder who wants their app checked.',
        nextAction: 'Deliver the report.',
        unblockedBy: 'human'
      });
    }
    stream = await markStreamSettled(SCAN_STREAM_KEY, { settledAt: now, externalRef });
  }

  return { report, settlement, stream, economics: { netCents: settlement.netCents } };
}
