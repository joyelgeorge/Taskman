import { CRON_DEFINITIONS, runHealthChecks } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'health-check');

/** Works out whether each component is actually up, rather than assuming it. */
export async function handler({ fetchImpl } = {}) {
  const endpoints = {};
  if (process.env.API_HEALTH_URL) endpoints.api = process.env.API_HEALTH_URL;
  if (process.env.WEB_HEALTH_URL) endpoints.web = process.env.WEB_HEALTH_URL;

  return runHealthChecks({ endpoints, fetchImpl });
}
