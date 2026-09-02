import { CRON_DEFINITIONS, cronStatuses, openAlert, resolveAlert } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'cron-monitor');

/**
 * The watchdog over the other crons.
 *
 * It cannot fully monitor itself — a watchdog that stops running cannot report
 * that it stopped. Two things cover that gap: health-check independently emits a
 * `cron:cron-monitor` component check, and /api/health exposes the same verdict
 * for an external uptime monitor to poll. This job is the inner ring, not the
 * only one.
 */
export async function handler({ now = new Date() } = {}) {
  const statuses = await cronStatuses({ now });
  const opened = [];
  const resolved = [];

  for (const cron of statuses) {
    const component = `cron:${cron.cronName}`;

    if (['OVERDUE', 'STUCK', 'FAILING'].includes(cron.status)) {
      const result = await openAlert({
        kind: 'cron_unhealthy',
        component,
        severity: cron.status === 'FAILING' ? 'WARNING' : 'CRITICAL',
        message: `${cron.cronName} is ${cron.status}`
          + (cron.silentSeconds == null ? ' (never run)' : ` — silent for ${cron.silentSeconds}s`),
        detail: cron
      });
      if (result.created) opened.push(component);
    } else if (cron.status === 'OK') {
      if (await resolveAlert('cron_unhealthy', component)) resolved.push(component);
    }
  }

  const unhealthy = statuses.filter(c => !['OK', 'DISABLED'].includes(c.status));
  return {
    monitored: statuses.length,
    healthy: statuses.length - unhealthy.length,
    unhealthy: unhealthy.map(c => ({ cron: c.cronName, status: c.status, silentSeconds: c.silentSeconds })),
    alertsOpened: opened,
    alertsResolved: resolved
  };
}
