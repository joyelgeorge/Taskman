export const MINIMUM_STACK_CONFIG = Object.freeze({
  wedgeId: 'fiverr_bookkeeping_reconciliation_v1',
  stack: {
    trigger: {
      type: 'csv_statement_upload',
      platform: 'Fiverr',
      status: 'ACTIVE'
    },
    execution: {
      adapter: 'commercial-wedge',
      method: 'deterministic_reconciliation',
      status: 'ACTIVE'
    },
    outcomeEvidence: {
      type: 'hashed_audit_report',
      status: 'ACTIVE'
    },
    billing: {
      processor: 'stripe',
      status: 'ACTIVE'
    }
  },
  deferredRails: [
    'x402_crypto_payments',
    'wallet_signing',
    'funds_move',
    'deskcrew_bounties',
    'moltjobs_crawler',
    'taskmarket_rail',
    'social_drones'
  ]
});

/**
 * Checks whether the minimum customer stack prerequisites are met in runtime environment.
 */
export function verifyCustomerStackReady({ env = process.env } = {}) {
  const missing = [];
  // For production or live customer billing, STRIPE_API_KEY is required
  if (env.NODE_ENV === 'production' && !env.STRIPE_API_KEY) {
    missing.push('STRIPE_API_KEY');
  }

  return {
    ready: missing.length === 0,
    missing,
    status: missing.length === 0 ? 'READY' : 'SETUP_REQUIRED',
    stack: MINIMUM_STACK_CONFIG.stack,
    deferredRailsCount: MINIMUM_STACK_CONFIG.deferredRails.length
  };
}
