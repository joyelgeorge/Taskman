import { providerStatus } from './providers.js';
import { railStatus } from './rails/index.js';
import { getRuntimeConfig } from './config.js';

export const CAPABILITY_STATUS = Object.freeze({
  AVAILABLE: 'available',
  SETUP_REQUIRED: 'setup_required',
  UNAVAILABLE: 'unavailable',
  UNHEALTHY: 'unhealthy'
});

export const CAPABILITY_ACCESS = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  ADMIN: 'admin'
});

const VALID_STATUSES = new Set(Object.values(CAPABILITY_STATUS));
const VALID_ACCESS = new Set(Object.values(CAPABILITY_ACCESS));
const SAFE_FIELDS = new Set([
  'id', 'status', 'access', 'provider', 'adapter', 'reason',
  'setupRequired', 'readOnly', 'lastHealthCheck'
]);
const customRegistry = new Map();

function normalizeDescriptor(id, descriptor = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error('invalid capability id');
  if (!VALID_STATUSES.has(descriptor.status)) throw new Error(`invalid capability status for ${id}`);
  if (!VALID_ACCESS.has(descriptor.access)) throw new Error(`invalid capability access for ${id}`);

  const safe = {
    id,
    status: descriptor.status,
    access: descriptor.access,
    provider: descriptor.provider ? String(descriptor.provider) : null,
    adapter: descriptor.adapter ? String(descriptor.adapter) : null,
    reason: descriptor.reason ? String(descriptor.reason) : null,
    setupRequired: descriptor.status === CAPABILITY_STATUS.SETUP_REQUIRED,
    readOnly: descriptor.access === CAPABILITY_ACCESS.READ,
    lastHealthCheck: descriptor.lastHealthCheck ? String(descriptor.lastHealthCheck) : null
  };

  for (const key of Object.keys(descriptor)) {
    if (!SAFE_FIELDS.has(key)) throw new Error(`unsafe capability metadata field: ${key}`);
  }
  return Object.freeze(safe);
}

function put(target, id, status, access, metadata = {}) {
  target[id] = normalizeDescriptor(id, { status, access, ...metadata });
}

export function registerCapability(id, descriptor) {
  const normalized = normalizeDescriptor(id, descriptor);
  customRegistry.set(id, normalized);
  return normalized;
}

export function unregisterCapability(id) {
  return customRegistry.delete(id);
}

export function buildCapabilityRegistry({
  env = { MOLTJOBS_API_KEY: getRuntimeConfig().rails.moltjobs.apiKey },
  providers = providerStatus(),
  rails = railStatus(),
  health = {}
} = {}) {
  const capabilities = {};

  put(capabilities, 'taskman.queue.read', CAPABILITY_STATUS.AVAILABLE, CAPABILITY_ACCESS.READ, {
    adapter: 'revenue-store', reason: 'runtime_adapter_loaded'
  });
  put(capabilities, 'taskman.queue.write', CAPABILITY_STATUS.AVAILABLE, CAPABILITY_ACCESS.WRITE, {
    adapter: 'revenue-store', reason: 'runtime_adapter_loaded'
  });

  for (const id of ['web.search', 'web.fetch', 'web.read', 'github.read', 'github.write', 'gmail.read', 'gmail.send']) {
    put(capabilities, id, CAPABILITY_STATUS.UNAVAILABLE,
      id.endsWith('.write') || id.endsWith('.send') ? CAPABILITY_ACCESS.WRITE : CAPABILITY_ACCESS.READ,
      { reason: 'runtime_adapter_not_installed' });
  }

  put(capabilities, 'moltjobs.read', env.MOLTJOBS_API_KEY
    ? CAPABILITY_STATUS.AVAILABLE
    : CAPABILITY_STATUS.SETUP_REQUIRED, CAPABILITY_ACCESS.READ, {
    adapter: 'moltjobs-client', reason: env.MOLTJOBS_API_KEY ? 'credential_configured' : 'credential_required'
  });
  put(capabilities, 'moltjobs.authenticated', env.MOLTJOBS_API_KEY
    ? CAPABILITY_STATUS.AVAILABLE
    : CAPABILITY_STATUS.SETUP_REQUIRED, CAPABILITY_ACCESS.READ, {
    adapter: 'moltjobs-client', reason: env.MOLTJOBS_API_KEY ? 'credential_configured' : 'credential_required'
  });

  const readyProviders = providers.filter(provider => provider.ready);
  put(capabilities, 'ai.reasoning.available', readyProviders.length
    ? CAPABILITY_STATUS.AVAILABLE
    : CAPABILITY_STATUS.SETUP_REQUIRED, CAPABILITY_ACCESS.READ, {
    adapter: 'reasoning-engine', reason: readyProviders.length ? 'provider_configured' : 'provider_credential_required'
  });
  for (const provider of providers) {
    const id = `ai.provider.${provider.id}.available`;
    put(capabilities, id, provider.ready ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
      CAPABILITY_ACCESS.READ, {
        provider: provider.id,
        adapter: 'providers',
        reason: provider.ready ? 'credential_configured' : 'credential_required'
      });
  }

  put(capabilities, 'wallet.sign', CAPABILITY_STATUS.UNAVAILABLE, CAPABILITY_ACCESS.WRITE, {
    reason: 'authorization_gated_no_runtime_adapter'
  });
  put(capabilities, 'funds.move', CAPABILITY_STATUS.UNAVAILABLE, CAPABILITY_ACCESS.WRITE, {
    reason: 'authorization_gated_no_runtime_adapter'
  });

  for (const rail of rails) {
    const railName = String(rail.name);
    const configured = !Object.prototype.hasOwnProperty.call(rail, 'apiKey') || Boolean(rail.apiKey);
    put(capabilities, `rail.${railName}.read`, configured
      ? CAPABILITY_STATUS.AVAILABLE
      : CAPABILITY_STATUS.SETUP_REQUIRED, CAPABILITY_ACCESS.READ, {
      adapter: railName, reason: configured ? 'rail_adapter_configured' : 'rail_credential_required'
    });
    for (const action of ['claim', 'submit']) {
      put(capabilities, `rail.${railName}.${action}`,
        rail.mode === 'execute' ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
        CAPABILITY_ACCESS.WRITE, {
          adapter: railName,
          reason: rail.mode === 'execute' ? 'execution_mode_authorized' : 'rail_is_read_only'
        });
    }
    put(capabilities, `rail.${railName}.payout.read`, CAPABILITY_STATUS.UNAVAILABLE, CAPABILITY_ACCESS.READ, {
      adapter: railName, reason: 'payout_adapter_not_installed'
    });
  }

  for (const [id, descriptor] of customRegistry) capabilities[id] = descriptor;
  for (const [id, override] of Object.entries(health)) {
    if (!capabilities[id]) continue;
    capabilities[id] = normalizeDescriptor(id, { ...capabilities[id], ...override, id: undefined });
  }
  return Object.freeze(capabilities);
}

export function getSafeCapabilitySnapshot(options = {}) {
  const capabilities = buildCapabilityRegistry(options);
  const summary = { total: 0, available: 0, setupRequired: 0, unavailable: 0, unhealthy: 0 };
  for (const capability of Object.values(capabilities)) {
    summary.total += 1;
    if (capability.status === CAPABILITY_STATUS.AVAILABLE) summary.available += 1;
    if (capability.status === CAPABILITY_STATUS.SETUP_REQUIRED) summary.setupRequired += 1;
    if (capability.status === CAPABILITY_STATUS.UNAVAILABLE) summary.unavailable += 1;
    if (capability.status === CAPABILITY_STATUS.UNHEALTHY) summary.unhealthy += 1;
  }
  return { generatedAt: new Date().toISOString(), summary, capabilities };
}

export function getRuntimeCapabilityMap(options = {}) {
  const map = {};
  for (const [id, capability] of Object.entries(buildCapabilityRegistry(options))) {
    map[id] = capability.status === CAPABILITY_STATUS.AVAILABLE;
  }
  return map;
}

export function evaluateRequiredCapabilities(required = [], options = {}) {
  const registry = buildCapabilityRegistry(options);
  const result = { available: [], setupRequired: [], unavailable: [], unhealthy: [] };
  for (const id of new Set(Array.isArray(required) ? required : [])) {
    const capability = registry[id];
    if (!capability || capability.status === CAPABILITY_STATUS.UNAVAILABLE) result.unavailable.push(id);
    else if (capability.status === CAPABILITY_STATUS.SETUP_REQUIRED) result.setupRequired.push(id);
    else if (capability.status === CAPABILITY_STATUS.UNHEALTHY) result.unhealthy.push(id);
    else result.available.push(id);
  }
  return result;
}
