/**
 * The Tally SME leakage audit revenue job.
 *
 * Runs duplicate invoice and shrinkage detection over tabular exports, calculates
 * recoverable amounts, drafts contingency audit reports for operator review,
 * and records settlements upon client recovery verification.
 */

import { JOB_STAGE } from './job-spec.js';
import {
  findDuplicateInvoices,
  findBilledVsStockMismatch,
  renderDuplicateReport
} from '../tally/duplicate-invoice.js';
import { parseCsv, normalizeInvoices, normalizeStockAndSales } from '../tally/parser.js';

export const tallyLeakageDescriptor = Object.freeze({
  key: 'tally-smb-leakage-audit',
  distribution: 'relationship_exists',
  rail: 'tally-leakage',
  economics: { pricing: 'contingency', rate: 0.20, currency: 'INR' },
  note: 'Duplicate-invoice and shrinkage detection in a small retailer\'s Tally ledger, '
    + 'priced at 20% contingency on what they confirm they recover.'
});

/**
 * Build the runnable Tally leakage audit job.
 *
 * @param {Object} opts
 * @param {Function} opts.load - async function returning raw CSV text or parsed rows
 * @param {Function} [opts.write] - optional async function (path, content) to write reports
 * @param {Function} [opts.verifyRecovery] - optional async function returning { externalRef, source, amountInr }
 * @param {number} [opts.windowDays=5] - window in days for matching vendor + amount
 * @param {string} [opts.clientName='Retailer'] - name of the business
 */
export function tallyLeakageJob({
  load,
  write = null,
  verifyRecovery = null,
  windowDays = 5,
  clientName = 'Retailer'
} = {}) {
  return {
    ...tallyLeakageDescriptor,
    stages: {
      [JOB_STAGE.DETECT]: async () => {
        const raw = typeof load === 'function' ? await load() : load;
        let invoiceRows = [];
        let stockRows = [];

        if (typeof raw === 'string') {
          const parsed = parseCsv(raw);
          invoiceRows = normalizeInvoices(parsed);
          const { sales, stock } = normalizeStockAndSales(parsed);
          stockRows = findBilledVsStockMismatch(sales, stock);
        } else if (Array.isArray(raw)) {
          invoiceRows = normalizeInvoices(raw);
        } else if (raw && typeof raw === 'object') {
          invoiceRows = raw.invoices ? normalizeInvoices(raw.invoices) : [];
          if (raw.sales && raw.stock) {
            stockRows = findBilledVsStockMismatch(raw.sales, raw.stock);
          }
        }

        const duplicateFlags = findDuplicateInvoices(invoiceRows, { windowDays });
        const totalDuplicateAmount = duplicateFlags.reduce((sum, f) => sum + (f.recoverableAmount || 0), 0);
        const contingencyFeeInr = Math.round(totalDuplicateAmount * tallyLeakageDescriptor.economics.rate);

        return {
          clientName,
          duplicateFlags,
          stockFlags: stockRows,
          totalRecoverableInr: totalDuplicateAmount,
          contingencyFeeInr,
          rowCount: invoiceRows.length
        };
      },

      // Gated by runner: reaches a person/client, requires operator approval token
      [JOB_STAGE.INTERVENE]: async ({ context }) => {
        const detectResult = context[JOB_STAGE.DETECT] || {};
        const duplicateFlags = detectResult.duplicateFlags || [];
        const reportBody = renderDuplicateReport(duplicateFlags);

        const fullReport = [
          `# Tally Ledger Audit Report — ${detectResult.clientName || clientName}`,
          '',
          `**Date:** ${new Date().toISOString().slice(0, 10)}`,
          `**Model:** 20% Contingency (Zero fee if nothing recovered)`,
          `**Scanned Records:** ${detectResult.rowCount || 0}`,
          `**Potential Recoverable Amount:** ₹${(detectResult.totalRecoverableInr || 0).toLocaleString('en-IN')}`,
          `**Estimated Contingency Fee (20%):** ₹${(detectResult.contingencyFeeInr || 0).toLocaleString('en-IN')}`,
          '',
          '---',
          '',
          '## Detailed Discrepancies',
          '',
          reportBody,
          '',
          '---',
          '',
          '## Next Steps for Recovery',
          '1. Review the flagged duplicate invoice numbers against your bank payment records.',
          '2. Request vendor credit note or direct reimbursement for confirmed duplicate deductions.',
          '3. Once recovered, remit the 20% contingency fee via UPI/Bank transfer.',
          ''
        ].join('\n');

        let reportPath = null;
        if (typeof write === 'function') {
          const slug = (detectResult.clientName || clientName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
          reportPath = `docs/outreach/${new Date().toISOString().slice(0, 10)}-tally-audit-${slug}.md`;
          await write(reportPath, fullReport);
        }

        return {
          clientName: detectResult.clientName || clientName,
          reportText: fullReport,
          reportPath,
          totalRecoverableInr: detectResult.totalRecoverableInr,
          contingencyFeeInr: detectResult.contingencyFeeInr
        };
      },

      // Verifies client recovery and generates verifiable external reference
      [JOB_STAGE.VERIFY]: async () => {
        if (typeof verifyRecovery === 'function') {
          const ref = await verifyRecovery();
          if (ref && ref.externalRef) {
            return {
              source: ref.source || 'manual_receipt',
              externalRef: ref.externalRef,
              url: ref.url || null,
              grossCents: Math.round((Number(ref.amountInr) || 0) * 100),
              currency: 'INR'
            };
          }
        }
        return null;
      },

      [JOB_STAGE.CHARGE]: async ({ context }) => context.evidence ?? null
    }
  };
}
