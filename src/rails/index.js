import { registerRail, getRail, listRails, setRailMode } from './registry.js';
import { createTaskForceRail } from './taskforce.js';
import { createUgigRail } from './ugig.js';
import { evaluateExecutionGate, assertExecutionAllowed } from './execution-gate.js';

let initialized = false;

export function initializeRails() {
  if (!initialized) {
    registerRail(createTaskForceRail());
    registerRail(createUgigRail());
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

export async function enableRailExecution(name, candidate) {
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
