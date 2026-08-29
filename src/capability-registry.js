import { providerStatus } from './providers.js';
import { listRails } from './rails/index.js';

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

const customRegistry = new Map();

export function registerCapability(id, descriptor) {
  if (!id || typeof id !== 'string') throw new Error('capability id is required');
  customRegistry.set(id, descriptor);
}

export function listRegisteredCapabilities() {
  const status = {};

  // Base web / search / fetch capabilities
  status['web.search'] = {
    id: 'web.search',
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.READ,
    description: 'Search public web via search APIs'
  };
  status['web.fetch'] = {
    id: 'web.fetch',
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.READ,
    description: 'Fetch and parse public HTTP/HTTPS URLs'
  };
  status['web.read'] = status['web.fetch'];

  // GitHub capabilities
  const hasGitHubToken = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
  status['github.read'] = {
    id: 'github.read',
    status: hasGitHubToken ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.AVAILABLE, // public read
    access: CAPABILITY_ACCESS.READ,
    description: 'Read repositories, issues, and pull requests'
  };
  status['github.write'] = {
    id: 'github.write',
    status: hasGitHubToken ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
    access: CAPABILITY_ACCESS.WRITE,
    description: 'Open PRs, create issues, and push commits'
  };

  // Gmail capabilities
  const hasGmail = Boolean(process.env.GMAIL_API_KEY || process.env.GOOGLE_SERVICE_ACCOUNT);
  status['gmail.read'] = {
    id: 'gmail.read',
    status: hasGmail ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
    access: CAPABILITY_ACCESS.READ,
    description: 'Read incoming messages and notifications'
  };
  status['gmail.send'] = {
    id: 'gmail.send',
    status: hasGmail ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
    access: CAPABILITY_ACCESS.WRITE,
    description: 'Send outgoing emails and notifications'
  };

  // Taskman internal queues
  status['taskman.queue.read'] = {
    id: 'taskman.queue.read',
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.READ,
    description: 'Read and claim items from candidate, validation, and execution queues'
  };
  status['taskman.queue.write'] = {
    id: 'taskman.queue.write',
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.WRITE,
    description: 'Upsert records and update status in Taskman queues'
  };

  // MoltJobs capabilities
  const hasMoltJobsKey = Boolean(process.env.MOLTJOBS_API_KEY);
  status['moltjobs.read'] = {
    id: 'moltjobs.read',
    status: CAPABILITY_STATUS.AVAILABLE,
    access: CAPABILITY_ACCESS.READ,
    description: 'Read open jobs and bounties'
  };
  status['moltjobs.authenticated'] = {
    id: 'moltjobs.authenticated',
    status: hasMoltJobsKey ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
    access: CAPABILITY_ACCESS.READ,
    description: 'Verified MoltJobs agent identity'
  };

  // AI reasoning capabilities
  const providers = providerStatus();
  const readyProviders = providers.filter(p => p.ready);
  status['ai.reasoning.available'] = {
    id: 'ai.reasoning.available',
    status: readyProviders.length > 0 ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
    access: CAPABILITY_ACCESS.READ,
    description: 'Access to shared AI reasoning engine'
  };

  for (const prov of providers) {
    status[`ai.provider.${prov.id}.available`] = {
      id: `ai.provider.${prov.id}.available`,
      status: prov.ready ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
      access: CAPABILITY_ACCESS.READ,
      description: `${prov.id} AI provider status`
    };
  }

  // Dangerous wallet / transaction capabilities (disabled by default)
  status['wallet.sign'] = {
    id: 'wallet.sign',
    status: CAPABILITY_STATUS.UNAVAILABLE,
    access: CAPABILITY_ACCESS.WRITE,
    description: 'Cryptographic wallet transaction signing'
  };
  status['funds.move'] = {
    id: 'funds.move',
    status: CAPABILITY_STATUS.UNAVAILABLE,
    access: CAPABILITY_ACCESS.WRITE,
    description: 'Direct fund transfer or withdrawal'
  };

  // Revenue rails integration
  try {
    const rails = listRails();
    for (const rail of rails) {
      status[`rail.${rail.name}.read`] = {
        id: `rail.${rail.name}.read`,
        status: CAPABILITY_STATUS.AVAILABLE,
        access: CAPABILITY_ACCESS.READ,
        description: `Read from ${rail.name} income rail`
      };
      status[`rail.${rail.name}.claim`] = {
        id: `rail.${rail.name}.claim`,
        status: rail.mode === 'execute' ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.SETUP_REQUIRED,
        access: CAPABILITY_ACCESS.WRITE,
        description: `Claim work on ${rail.name} income rail`
      };
    }
  } catch {}

  // Merge custom registered capabilities
  for (const [id, desc] of customRegistry.entries()) {
    status[id] = desc;
  }

  return status;
}

/**
 * Returns safe public snapshot representation of runtime capabilities (never exposing secret values).
 */
export function getSafeCapabilitySnapshot() {
  const capabilities = listRegisteredCapabilities();
  const summary = {
    total: Object.keys(capabilities).length,
    available: 0,
    setupRequired: 0,
    unavailable: 0,
    unhealthy: 0
  };

  for (const cap of Object.values(capabilities)) {
    if (cap.status === CAPABILITY_STATUS.AVAILABLE) summary.available++;
    else if (cap.status === CAPABILITY_STATUS.SETUP_REQUIRED) summary.setupRequired++;
    else if (cap.status === CAPABILITY_STATUS.UNAVAILABLE) summary.unavailable++;
    else if (cap.status === CAPABILITY_STATUS.UNHEALTHY) summary.unhealthy++;
  }

  return {
    summary,
    capabilities
  };
}

/**
 * Boolean capability snapshot for backward compatibility with qualification and execution engines.
 */
export function getRuntimeCapabilityMap(overrides = {}) {
  const capabilities = listRegisteredCapabilities();
  const map = {};
  for (const [id, desc] of Object.entries(capabilities)) {
    map[id] = desc.status === CAPABILITY_STATUS.AVAILABLE;
  }
  return { ...map, ...overrides };
}
