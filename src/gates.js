/**
 * The eight money-flow gates a candidate must clear with cited evidence before
 * it can be classified EXECUTABLE or THRESHOLD_CROSSED. Shared by
 * src/workers/validate.js and src/transforms/adversarial-validation.js — kept in
 * its own module so those two can reference the same list without importing
 * each other.
 */
export const EIGHT_MONEY_FLOW_GATES = Object.freeze([
  'money_flow_scale',
  'recurring_leakage',
  'independent_trigger',
  'permission_non_invasive',
  'measurable_delta',
  'monetization',
  'no_transaction_ownership',
  'competitive_whitespace'
]);
