/**
 * Revenue lives in the original engine's money-ledger, which already enforces the
 * two invariants this system depends on: a settlement needs a verifiable source
 * and an external reference, and only cleared funds count.
 *
 * Re-exported rather than reimplemented so there is exactly one place money can
 * be recorded. A second implementation would be a second place to get it wrong.
 */
export {
  recordAttempt,
  finishAttempt,
  recordSettlement,
  markSettlementCleared,
  railEconomics,
  railWindow,
  listAttempts,
  listSettlements,
  evaluateRailViability,
  enforceRailViability,
  getRailState,
  setRailState,
  setRailEnabled,
  isRailEnabled,
  ledgerStorageMode,
  resetLedgerMemory,
  resetLedgerStore,
  ATTEMPT_STATUS,
  SETTLEMENT_STATUS,
  VERIFIED_SOURCES,
  RAIL_STATES
} from '../../src/money-ledger.js';

export { syncStripeSettlements, normalizeStripeTransaction } from '../../src/settlement-verifier.js';

/**
 * The four-state governor (docs/TARGET_DESIGN.md §8): promotes a rail on its
 * first cleared settlement, demotes or scales it on rolling ROI, and disables it
 * automatically when a probation budget runs out with nothing settled. Re-export
 * rather than reimplementation, same reasoning as the ledger above.
 */
export {
  evaluateRailGovernor,
  enforceRailGovernor,
  globalBudgetStatus,
  setGlobalMonthlyBudget,
  resetGovernorMemory,
  resetGovernorStore
} from '../../src/rail-governor.js';

