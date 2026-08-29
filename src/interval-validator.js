/**
 * Shared Schedule & Interval Normalization Module
 * Enforces strict validation of recurring task intervals and brain cadence.
 */

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 44640; // 31 days in minutes

/**
 * Normalizes and validates intervalMinutes input.
 * Returns { valid: true, value: number | null } or { valid: false, error: string }
 */
export function normalizeIntervalMinutes(input) {
  if (input === undefined || input === null || input === '') {
    return { valid: true, value: null };
  }

  const num = Number(input);

  if (!Number.isFinite(num) || isNaN(num)) {
    return { valid: false, error: 'intervalMinutes must be a finite number or omitted/null for manual execution' };
  }

  if (!Number.isInteger(num)) {
    return { valid: false, error: 'intervalMinutes must be a whole integer' };
  }

  if (num < MIN_INTERVAL_MINUTES) {
    return { valid: false, error: `intervalMinutes must be at least ${MIN_INTERVAL_MINUTES} minute(s)` };
  }

  if (num > MAX_INTERVAL_MINUTES) {
    return { valid: false, error: `intervalMinutes must not exceed ${MAX_INTERVAL_MINUTES} minutes` };
  }

  return { valid: true, value: num };
}

/**
 * Validates brain scheduler interval from environment variable or config.
 */
export function normalizeBrainIntervalMinutes(input = process.env.TASKMAN_BRAIN_INTERVAL_MINUTES) {
  if (input === undefined || input === null || input === '') {
    return { valid: true, value: null };
  }
  return normalizeIntervalMinutes(input);
}
