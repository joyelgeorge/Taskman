/**
 * Canonical validation for minute-based generic task schedules.
 * Durable cron schedules use their own parser and are intentionally separate.
 */

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 44_640; // 31 days
export const MAX_INTERVAL_SECONDS = MAX_INTERVAL_MINUTES * 60;
export const INVALID_INTERVAL_CODE = 'INVALID_INTERVAL_MINUTES';

function invalid(detail) {
  return { valid: false, code: INVALID_INTERVAL_CODE, error: detail };
}

export function normalizeIntervalMinutes(input) {
  if (input === undefined || input === null || input === '') {
    return { valid: true, value: null };
  }

  let value;
  if (typeof input === 'number') {
    value = input;
  } else if (typeof input === 'string' && /^(0|[1-9]\d*)$/.test(input)) {
    value = Number(input);
  } else {
    return invalid('intervalMinutes must be a canonical whole number or omitted for manual execution');
  }

  if (!Number.isSafeInteger(value)) {
    return invalid('intervalMinutes must be a finite safe integer');
  }
  if (value < MIN_INTERVAL_MINUTES || value > MAX_INTERVAL_MINUTES) {
    return invalid(`intervalMinutes must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`);
  }
  return { valid: true, value };
}

export function normalizeBrainIntervalMinutes(input = process.env.TASKMAN_BRAIN_INTERVAL_MINUTES) {
  return normalizeIntervalMinutes(input);
}

export function normalizeStoredIntervalSeconds(input) {
  if (input === undefined || input === null) return { valid: true, value: null };
  if (!Number.isSafeInteger(Number(input)) || Number(input) % 60 !== 0) {
    return invalid('stored interval must be an exact whole number of minutes');
  }
  return normalizeIntervalMinutes(Number(input) / 60);
}

