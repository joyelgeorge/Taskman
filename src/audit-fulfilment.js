import { buildFullReport, renderReportHtml } from './payout-report.js';
import { recordAttempt, recordSettlement, SETTLEMENT_STATUS, VERIFIED_SOURCES } from './money-ledger.js';
import { markStreamSettled, registerStream, listStreams } from '@taskman/core';

/**
 * One paid audit, delivered and booked.
 *
 * The loop this closes: a stranger runs the free check, sees a named missing
 * payout, pays, and gets the full report. Everything in that sentence existed
 * except the last link — nothing took a payment and produced a deliverable, and
 * nothing put the money in the ledger. The first real customer would have hit a
 * path no one had ever run.
 *
 * So the whole chain is exercised here before a real dollar arrives: report
 * built, work recorded as a rail attempt with its true cost, settlement written
 * against a verifiable external reference, and the income stream moved to
 * EARNING by that settlement rather than by anyone's opinion.
 *
 * The rule the rest of the system rests on is not relaxed for the first sale.
 * `source` must be one of stripe / bank / manual_receipt and `externalRef` must
 * identify the payment in a system outside this one; without both, no settlement
 * is written and nothing reads as revenue.
 */

export const AUDIT_STREAM_KEY = 'payout-audit-direct';
export const AUDIT_RAIL = 'payout-audit';

/**
 * Cost of delivery, in minutes.
 *
 * Recorded rather than assumed, because the hourly rate this implies is the only
 * thing that says whether the lane is worth running. A $20 report that takes two
 * hours is not a business.
 */
export function effectiveHourlyRate({ netCents, minutesSpent }) {
  const minutes = Number(minutesSpent);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round((netCents / 100) / (minutes / 60) * 100) / 100;
}

export async function fulfilAuditOrder({
  platformCsv,
  bankCsv,
  preparedFor = null,
  homeCurrency = null,
  // Payment, as the payment processor sees it.
  source,
  externalRef,
  grossCents,
  feeCents = 0,
  currency = 'USD',
  status = SETTLEMENT_STATUS.CLEARED,
  // What delivery actually cost.
  minutesSpent,
  now = new Date()
} = {}) {
  if (!VERIFIED_SOURCES.includes(source)) {
    throw new Error(`source must be one of ${VERIFIED_SOURCES.join(', ')} — a payment this system `
      + 'cannot confirm against an outside record is not revenue');
  }
  if (!externalRef) {
    throw new Error('externalRef is required: the payment reference is what makes this checkable later');
  }
  if (!Number.isFinite(Number(minutesSpent)) || Number(minutesSpent) <= 0) {
    throw new Error('minutesSpent is required and must be positive — an unmeasured hour is how a '
      + 'lane looks profitable while losing');
  }

  // The deliverable first. If the report cannot be produced, nothing is booked:
  // taking money and recording revenue for an undeliverable audit is the one
  // ordering that must never happen.
  const report = buildFullReport({ platformCsv, bankCsv, preparedFor, homeCurrency, now });
  const html = renderReportHtml(report);

  const attempt = await recordAttempt({
    rail: AUDIT_RAIL,
    candidateKey: externalRef,
    stage: 'DELIVER',
    costCents: 0,
    evidence: { minutesSpent: Number(minutesSpent), preparedFor },
    startedAt: now.toISOString()
  });

  const settlement = await recordSettlement({
    rail: AUDIT_RAIL,
    attemptId: attempt.id,
    source,
    externalRef,
    grossCents,
    feeCents,
    currency,
    status,
    verification: { deliverable: 'payout-reconciliation-report', preparedFor }
  });

  // Only a cleared settlement moves the stream. A pending payment is not money.
  let stream = null;
  if (status === SETTLEMENT_STATUS.CLEARED) {
    const known = new Set((await listStreams({})).map(s => s.streamKey));
    if (!known.has(AUDIT_STREAM_KEY)) {
      await registerStream({
        streamKey: AUDIT_STREAM_KEY,
        title: 'Payout reconciliation, sold directly from the free audit',
        mechanism: 'Buyer pays after seeing a named missing payout in the free check.',
        requires: 'A payment account and someone who wants the full period.',
        nextAction: 'Deliver the report.',
        unblockedBy: 'human'
      });
    }
    stream = await markStreamSettled(AUDIT_STREAM_KEY, { settledAt: now, externalRef });
  }

  const netCents = settlement.netCents;
  return {
    report,
    html,
    settlement,
    stream,
    economics: {
      netCents,
      minutesSpent: Number(minutesSpent),
      // The number that decides whether to do this again.
      effectiveHourlyRate: effectiveHourlyRate({ netCents, minutesSpent })
    }
  };
}
