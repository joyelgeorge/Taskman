import { RAIL_MODE } from './base.js';

const railState = new Map();

export function registerRail(adapter) {
  if (!adapter?.name) throw new Error('invalid rail adapter');
  railState.set(adapter.name, adapter);
  return adapter;
}

export function getRail(name) { return railState.get(name) || null; }

export function listRails() {
  return [...railState.values()].map(r => ({ name: r.name, mode: r.mode }));
}

export function setRailMode(name, mode) {
  const rail = getRail(name);
  if (!rail) throw new Error(`unknown rail: ${name}`);
  if (!Object.values(RAIL_MODE).includes(mode)) throw new Error(`invalid rail mode: ${mode}`);
  rail.mode = mode;
  return { name: rail.name, mode: rail.mode };
}
