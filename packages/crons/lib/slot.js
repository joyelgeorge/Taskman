/**
 * How long one scheduled slot lasts, in seconds, from a 5-field cron expression.
 *
 * Only the shapes this system actually uses are supported; anything else falls
 * back to an hour. The value is used for the idempotency key, so being wrong
 * means duplicate work, not a crash.
 */
export function slotSeconds(schedule) {
  const [minute, hour] = String(schedule).trim().split(/\s+/);

  const everyNMinutes = minute?.match(/^\*\/(\d+)$/);
  if (everyNMinutes) return Number(everyNMinutes[1]) * 60;

  const everyNHours = hour?.match(/^\*\/(\d+)$/);
  if (everyNHours) return Number(everyNHours[1]) * 3600;

  if (hour === '*') return 3600;
  if (/^\d+$/.test(hour ?? '')) return 86400;
  return 3600;
}

/**
 * A stable identifier for the slot a moment falls in.
 *
 * Two runners firing the same schedule land on the same key and collapse to one
 * execution — which is what makes it safe to have both a hosted scheduler and a
 * local one pointed at the same database.
 */
export function runKeyFor(schedule, now = new Date()) {
  const seconds = slotSeconds(schedule);
  const slot = Math.floor(now.getTime() / (seconds * 1000)) * seconds * 1000;
  return `${seconds}s@${new Date(slot).toISOString()}`;
}
