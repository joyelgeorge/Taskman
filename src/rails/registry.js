const registry = new Map();

export function registerRail(rail) {
  if (rail?.name) registry.set(rail.name, rail);
}

export function getRail(name) {
  return registry.get(name) || null;
}

export function listRails() {
  return Array.from(registry.values());
}

export function setRailMode(name, mode) {
  const rail = getRail(name);
  if (!rail) throw new Error(`Unknown rail: ${name}`);
  rail.setMode(mode);
  return { name, mode: rail.mode };
}
