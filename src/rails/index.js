import { registerRail, getRail, listRails, setRailMode } from './registry.js';
import { createTaskForceRail } from './taskforce.js';
import { evaluateExecutionGate, assertExecutionAllowed } from './execution-gate.js';
import { seedDeadRails } from './dead-rails.js';
import { isRailEnabled } from '../money-ledger.js';

let initialized = false;

/**
 * Registers every known rail adapter and seeds the ledger's disabled-by-default
 * state for the ones measured against a dead market (src/rails/dead-rails.js).
 * Adapter registration and ledger enablement are independent: a rail can be
 * registered (so its code path exists and is reachable) while the ledger still
 * refuses to let it spend an attempt.
 */
export async function initializeRails() {
  if (!initialized) {
    registerRail(createTaskForceRail());
    initialized = true;
  }
  await seedDeadRails();
  return listRails();
}

export async function railStatus() {
  await initializeRails();
  const rails = listRails();
  return Promise.all(rails.map(async rail => ({
    name: rail.name,
    mode: rail.mode,
    enabled: await isRailEnabled(rail.name)
  })));
}

export async function discoverRail(name) {
  await initializeRails();
  if (!(await isRailEnabled(name))) {
    return { ok: false, blocked: true, reason: `rail "${name}" is disabled — see rail_state.disabled_reason`, tasks: [] };
  }
  const rail = getRail(name);
  if (!rail) throw new Error(`unknown rail: ${name}`);
  return rail.discover();
}

export async function verifyRailCandidate(name, candidate) {
  await initializeRails();
  const rail = getRail(name);
  if (!rail) throw new Error(`unknown rail: ${name}`);
  return rail.verify(candidate);
}

export async function enableRailExecution(name, candidate) {
  await initializeRails();
  if (!(await isRailEnabled(name))) {
    throw new Error(`rail "${name}" is disabled in the ledger; re-enable it explicitly with fresh settlement evidence before granting execute mode`);
  }
  const gate = assertExecutionAllowed(candidate);
  setRailMode(name, 'execute');
  return { rail: name, mode: 'execute', gate };
}

export async function disableRailExecution(name) {
  await initializeRails();
  return setRailMode(name, 'read_only');
}

export { evaluateExecutionGate, assertExecutionAllowed };
