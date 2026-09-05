import { CRON_DEFINITIONS, snapshotFinanceReport } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'finance-report');

/**
 * Snapshots the finance report once a day into finance_report_history
 * so the dashboard can plot historical trend lines (net position, burn rate, runway).
 * See docs/MARKETING_FINANCE_WING.md §3.2 and Issue #134.
 */
export async function handler({ now = new Date() } = {}) {
  return snapshotFinanceReport({ now });
}
