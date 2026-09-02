import { CRON_DEFINITIONS, DEFAULT_FLEET, registerDrone, listDrones, dispatchDrones } from '@taskman/core';

export const definition = CRON_DEFINITIONS.find(c => c.cronName === 'drone-dispatch');

export async function handler({ fetchImpl, seed = true } = {}) {
  // A fresh install has no fleet; seeding here means the system is live after one
  // cron tick rather than after a manual setup step nobody remembers to run.
  if (seed && (await listDrones()).length === 0) {
    for (const drone of DEFAULT_FLEET) await registerDrone(drone);
  }
  return dispatchDrones({ fetchImpl });
}
