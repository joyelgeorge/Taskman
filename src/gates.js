import { QUALIFICATION_PROFILES } from './orchestration-profiles.js';

/**
 * The eight money-flow gates a candidate must clear with cited evidence before
 * it can be classified EXECUTABLE or THRESHOLD_CROSSED.
 *
 * Derived from QUALIFICATION_PROFILES rather than hardcoded, so this and
 * src/workers/validate.js's own local EIGHT_MONEY_FLOW_GATES always agree — both
 * read the same canonical list, just from two call sites that must not import
 * each other (src/transforms/adversarial-validation.js needs this list without
 * pulling in validate.js, which imports the transform).
 */
export const EIGHT_MONEY_FLOW_GATES = Object.freeze([
  ...QUALIFICATION_PROFILES.programmable_money_flow_v1.evidenceGates
]);
