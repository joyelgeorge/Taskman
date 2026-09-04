import { parseFiverrActivityCsv } from './fiverr-csv-parser.js';
import { COMMERCIAL_WEDGE_SPEC } from './commercial-wedge.js';

export const SAMPLE_FIVERR_STATEMENT = `Date,Order ID,Type,Gross Amount,Platform Fee,Currency
2026-08-01,FO1019281,Completed Order,150.00,30.00,USD
2026-08-05,FO1019482,Completed Order,400.00,80.00,USD
2026-08-12,FO1019883,Completed Order,750.00,150.00,USD
2026-08-20,FO1020112,Completed Order,1200.00,240.00,USD`;

// In-memory activation session telemetry
const activationSessions = new Map(); // sessionId -> sessionTelemetry

/**
 * Starts an activation session, recording time-to-first-value timestamps.
 */
export function startActivationSession(sessionId = `act_${Date.now()}`) {
  const session = {
    sessionId,
    startedAt: Date.now(),
    firstResultDeliveredAt: null,
    timeToFirstValueMs: null,
    dropoffStage: 'STARTED',
    unlockedNextStep: null
  };
  activationSessions.set(sessionId, session);
  return session;
}

/**
 * Delivers instant, read-only value from user CSV or bundled sample with zero credentials or db setup.
 */
export function generateInstantAuditPreview({ sessionId, customCsv = null } = {}) {
  const session = activationSessions.get(sessionId) || startActivationSession(sessionId);
  const csvContent = customCsv || SAMPLE_FIVERR_STATEMENT;
  const isSample = !customCsv;

  const parsed = parseFiverrActivityCsv(csvContent);

  const grossEarningsCents = parsed.summary.totalGrossCents;
  const itemizedPlatformFeesCents = parsed.summary.totalFeeCents;
  const netEarningsCents = parsed.summary.totalNetCents;
  const orderCount = parsed.rowCount;

  // Potential annual tax deduction if recorded properly:
  const annualizedPlatformFeeDeductionCents = itemizedPlatformFeesCents * 12;

  const now = Date.now();
  if (!session.firstResultDeliveredAt) {
    session.firstResultDeliveredAt = now;
    session.timeToFirstValueMs = now - session.startedAt;
    session.dropoffStage = 'VALUE_PREVIEW_DELIVERED';
    session.unlockedNextStep = 'CONNECT_BANK_FOR_VARIANCE_DETECTION';
  }

  return {
    sessionId: session.sessionId,
    timeToFirstValueMs: session.timeToFirstValueMs,
    isSamplePreview: isSample,
    statementSummary: {
      orderCount,
      grossEarnings: `$${(grossEarningsCents / 100).toFixed(2)}`,
      itemizedPlatformFees: `$${(itemizedPlatformFeesCents / 100).toFixed(2)}`,
      netEarnings: `$${(netEarningsCents / 100).toFixed(2)}`,
      annualizedTaxDeductionValue: `$${(annualizedPlatformFeeDeductionCents / 100).toFixed(2)}`
    },
    economicNotice: 'READ_ONLY_AUDIT_PREVIEW: This itemizes allowable deductible fees from your statement. It is not cash recovered until verified against your bank deposits.',
    minimumNextPermission: {
      step: 'CONNECT_BANK_DEPOSIT_CSV',
      permissionRequired: 'read:bank_statement_csv',
      justification: 'Compare this $2,000.00 withdrawal against what your bank actually received to detect currency conversion leakage or bank hold variances.'
    }
  };
}

/**
 * Returns activation funnel analytics.
 */
export function getActivationMetrics() {
  const sessions = Array.from(activationSessions.values());
  const completed = sessions.filter(s => s.timeToFirstValueMs !== null);
  const avgTimeToFirstValueMs = completed.length > 0
    ? Math.round(completed.reduce((acc, s) => acc + s.timeToFirstValueMs, 0) / completed.length)
    : 0;

  return {
    totalSessions: sessions.length,
    completedSessions: completed.length,
    avgTimeToFirstValueMs,
    avgTimeToFirstValueSeconds: (avgTimeToFirstValueMs / 1000).toFixed(2)
  };
}

/**
 * Resets activation state (for tests).
 */
export function _resetActivationState() {
  activationSessions.clear();
}
