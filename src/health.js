import { getRuntimeConfig } from './config.js';

function runtimeHealthEnv() {
  const config = getRuntimeConfig();
  return {
    NODE_ENV: config.profile,
    TASKMAN_ALLOW_MEMORY_MODE: 'false',
    TASKMAN_REQUIRE_PROVIDER: String(config.requireProvider)
  };
}

function databaseRequired(env) {
  return env.NODE_ENV === 'production' && env.TASKMAN_ALLOW_MEMORY_MODE !== 'true';
}

function providerRequired(env) {
  return env.TASKMAN_REQUIRE_PROVIDER === 'true';
}

export function evaluateHealth({
  database,
  providers = [],
  schedulerDurable = false,
  internalSchedulerEnabled = false,
  draining = false,
  env = runtimeHealthEnv()
}) {
  const requiresDatabase = databaseRequired(env);
  const requiresProvider = providerRequired(env);
  const usableProvider = providers.some(provider => provider.ready === true);
  const databaseReady = database?.ok === true || !requiresDatabase;
  const schedulerReady = !internalSchedulerEnabled || schedulerDurable;
  const providerReady = usableProvider || !requiresProvider;
  const ready = !draining && databaseReady && schedulerReady && providerReady;
  const durable = database?.ok === true;

  return {
    status: ready ? (durable ? 'healthy' : 'degraded') : 'unready',
    ready,
    mode: durable ? 'postgresql' : 'memory',
    durable,
    requirements: {
      database: requiresDatabase,
      provider: requiresProvider,
      durableScheduler: internalSchedulerEnabled
    },
    draining,
    components: {
      database: {
        status: database?.ok === true ? 'ready' : (requiresDatabase ? 'unready' : 'optional'),
        enabled: database?.enabled === true
      },
      providers: {
        status: usableProvider ? 'ready' : (requiresProvider ? 'unready' : 'optional'),
        usable: providers.filter(provider => provider.ready === true).map(provider => provider.id)
      },
      scheduler: {
        status: schedulerReady ? 'ready' : 'unready',
        internalEnabled: internalSchedulerEnabled,
        durable: schedulerDurable
      }
    }
  };
}

export function livenessSnapshot() {
  return {
    status: 'alive',
    uptimeSeconds: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString()
  };
}
