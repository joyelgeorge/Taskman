import { registerRail, getRail, listRails, setRailMode } from './registry.js';
import { createTaskForceRail } from './taskforce.js';
import { createDeskCrewRail } from './deskcrew.js';
import { createTaskmarketRail } from './taskmarket.js';
import { evaluateExecutionGate, assertExecutionAllowed } from './execution-gate.js';
import { getRuntimeConfig } from '../config.js';
import { seedDeadRails } from './dead-rails.js';
import { isRailEnabled } from '../money-ledger.js';

let initialized = false;

/**
 * Registers every known rail adapter.
 *
 * Kept synchronous deliberately: capability-registry.js's buildCapabilityRegistry()
 * calls railStatus() as a default-parameter value, which requires it — and
 * therefore initializeRails() — to stay synchronous. Ledger seeding for dead
 * rails (async, since it reads/writes rail_state) happens at the two call sites
 * that actually gate money — discoverRail() and enableRailExecution() — both of
 * which were already async, rather than here.
 */
export function initializeRails() {
  if (!initialized) {
    registerRail(createTaskForceRail());
    registerRail(createDeskCrewRail());
    registerRail(createTaskmarketRail());
    initialized = true;
  }
  return listRails();
}

export function railStatus() {
  initializeRails();
  return listRails();
}

export async function discoverRail(name) {
  initializeRails();
  // Idempotent — see src/rails/dead-rails.js. Cheap: a lookup per known dead
  // rail, and it never overwrites a state a human already set.
  await seedDeadRails();
  if (!(await isRailEnabled(name))) {
    return { ok: false, blocked: true, reason: `rail "${name}" is disabled — see rail_state.disabled_reason`, tasks: [] };
  }
  const rail = getRail(name);
  if (!rail) throw new Error(`unknown rail: ${name}`);
  return rail.discover();
}

export async function verifyRailCandidate(name, candidate) {
  initializeRails();
  const rail = getRail(name);
  if (!rail) throw new Error(`unknown rail: ${name}`);
  return rail.verify(candidate);
}

/**
 * Granting execute mode requires BOTH gates to agree:
 *   - the operator allowlist (TASKMAN_ALLOW_WRITE_RAILS / TASKMAN_WRITE_RAILS,
 *     src/config.js) — a deploy-time policy decision, and
 *   - the settlement ledger (src/money-ledger.js) — a data-driven one: has this
 *     rail actually earned money, or burned its probation budget with nothing
 *     settled.
 * Composing them is strictly stricter than either alone and drops neither.
 */
export async function enableRailExecution(name, candidate) {
  await seedDeadRails();
  if (!(await isRailEnabled(name))) {
    throw new Error(`rail "${name}" is disabled in the ledger; re-enable it explicitly with fresh settlement evidence before granting execute mode`);
  }

  const config = getRuntimeConfig();
  if (!config.rails.allowWrite || !config.rails.writeEnabled.includes(name)) {
    throw new Error(`Rail execution is disabled by configuration: ${name}`);
  }

  initializeRails();
  const gate = assertExecutionAllowed(candidate);
  setRailMode(name, 'execute');
  return { rail: name, mode: 'execute', gate };
}

export function disableRailExecution(name) {
  initializeRails();
  return setRailMode(name, 'read_only');
}

export { evaluateExecutionGate, assertExecutionAllowed };
