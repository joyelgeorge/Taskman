import { createHash } from 'node:crypto';

export const CONFIG_SCHEMA_VERSION = '1';

export class ConfigurationError extends Error {
  constructor(problems) {
    super(`Invalid Taskman configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigurationError';
    this.code = 'TASKMAN_CONFIG_INVALID';
    this.problems = Object.freeze([...problems]);
  }
}

function enumValue(env, name, allowed, fallback, problems, { required = false } = {}) {
  const raw = env[name];
  if ((raw === undefined || raw === '') && required) {
    problems.push(`${name} is required`);
    return fallback;
  }
  const value = raw || fallback;
  if (!allowed.includes(value)) problems.push(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function integer(env, name, fallback, min, max, problems) {
  const raw = env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(env, name, fallback, problems) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw !== 'true' && raw !== 'false') {
    problems.push(`${name} must be true or false`);
    return fallback;
  }
  return raw === 'true';
}

function url(env, name, fallback, problems, { protocols, required = false } = {}) {
  const raw = env[name] || fallback;
  if (!raw) {
    if (required) problems.push(`${name} is required`);
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (protocols && !protocols.includes(parsed.protocol)) {
      problems.push(`${name} must use ${protocols.join(' or ')}`);
    }
    return raw.replace(/\/$/, '');
  } catch {
    problems.push(`${name} must be a valid URL`);
    return raw;
  }
}

function csv(env, name, problems) {
  const values = (env[name] || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const value of values) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) problems.push(`${name} contains an invalid rail identifier`);
  }
  return [...new Set(values)].sort();
}

function fingerprint(safe) {
  return createHash('sha256').update(JSON.stringify(safe)).digest('hex').slice(0, 16);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function loadConfig(env = process.env) {
  const problems = [];
  const profile = enumValue(env, 'NODE_ENV', ['development', 'test', 'production'], 'development', problems);
  const production = profile === 'production';
  const role = enumValue(env, 'TASKMAN_ROLE', ['web', 'worker', 'migration', 'preflight'], 'web', problems);
  const databaseUrl = url(env, 'DATABASE_URL', null, problems, {
    protocols: ['postgresql:', 'postgres:'],
    required: production
  });
  const baseUrl = url(env, 'TASKMAN_BASE_URL', production ? null : 'http://localhost:3000', problems, {
    protocols: production ? ['https:'] : ['http:', 'https:'],
    required: production
  });
  const authMode = enumValue(env, 'TASKMAN_AUTH_MODE', ['disabled', 'api-key', 'external'], 'disabled', problems, { required: production });
  const tenantMode = enumValue(env, 'TASKMAN_TENANT_MODE', ['single-tenant', 'multi-tenant'], 'single-tenant', problems, { required: production });
  const allowWriteRails = boolean(env, 'TASKMAN_ALLOW_WRITE_RAILS', false, problems);
  const writeRails = csv(env, 'TASKMAN_WRITE_RAILS', problems);

  if (production && authMode === 'disabled') problems.push('TASKMAN_AUTH_MODE cannot be disabled in production');
  if (authMode === 'api-key' && !env.TASKMAN_API_KEY) problems.push('TASKMAN_API_KEY is required when TASKMAN_AUTH_MODE=api-key');
  if (production && allowWriteRails && writeRails.length === 0) {
    problems.push('TASKMAN_WRITE_RAILS must explicitly list enabled rails when TASKMAN_ALLOW_WRITE_RAILS=true');
  }
  if (production && allowWriteRails && (!databaseUrl || authMode === 'disabled')) {
    problems.push('write-capable rails require durable storage and authentication in production');
  }

  const config = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    profile,
    production,
    role,
    port: integer(env, 'PORT', 3000, 1, 65535, problems),
    baseUrl,
    database: {
      enabled: Boolean(databaseUrl),
      url: databaseUrl,
      ssl: enumValue(env, 'PGSSL', ['prefer', 'require', 'disable'], 'prefer', problems),
      poolMax: integer(env, 'PGPOOL_MAX', 5, 1, 100, problems)
    },
    auth: { mode: authMode, apiKey: env.TASKMAN_API_KEY || null },
    tenantMode,
    scheduler: {
      internalEnabled: boolean(env, 'TASKMAN_INTERNAL_SCHEDULER_ENABLED', false, problems),
      brainIntervalMinutes: integer(env, 'TASKMAN_BRAIN_INTERVAL_MINUTES', 0, 0, 10080, problems)
    },
    limits: {
      maxJsonBodyBytes: integer(env, 'TASKMAN_MAX_JSON_BODY_BYTES', 1_048_576, 1, 16_777_216, problems),
      providerTimeoutMs: integer(env, 'TASKMAN_PROVIDER_TIMEOUT_MS', 45_000, 100, 600_000, problems),
      runTimeoutMs: integer(env, 'TASKMAN_RUN_TIMEOUT_MS', 300_000, 100, 3_600_000, problems),
      requestTimeoutMs: integer(env, 'TASKMAN_HTTP_REQUEST_TIMEOUT_MS', 120_000, 1_000, 600_000, problems),
      headersTimeoutMs: integer(env, 'TASKMAN_HTTP_HEADERS_TIMEOUT_MS', 15_000, 1_000, 120_000, problems),
      keepAliveTimeoutMs: integer(env, 'TASKMAN_HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000, 1_000, 120_000, problems),
      shutdownGraceMs: integer(env, 'TASKMAN_SHUTDOWN_GRACE_MS', 30_000, 100, 300_000, problems)
    },
    security: {
      trustProxy: boolean(env, 'TASKMAN_TRUST_PROXY', false, problems),
      cspReportOnly: boolean(env, 'TASKMAN_CSP_REPORT_ONLY', false, problems),
      hstsEnabled: boolean(env, 'TASKMAN_HSTS_ENABLED', true, problems)
    },
    reasoningEnabled: boolean(env, 'TASKMAN_REASONING_ENABLED', true, problems),
    requireProvider: boolean(env, 'TASKMAN_REQUIRE_PROVIDER', false, problems),
    knowledgePath: env.TASKMAN_KNOWLEDGE_PATH || 'data/runtime/knowledge-events.jsonl',
    providers: {
      GEMINI_API_KEY: env.GEMINI_API_KEY || null,
      GROQ_API_KEY: env.GROQ_API_KEY || null,
      OPENAI_API_KEY: env.OPENAI_API_KEY || null,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY || null
    },
    rails: {
      allowWrite: allowWriteRails,
      writeEnabled: writeRails,
      deskcrew: {
        enabled: boolean(env, 'DESKCREW_ENABLED', false, problems)
      },
      taskmarket: {
        enabled: boolean(env, 'TASKMARKET_ENABLED', false, problems)
      },
      moltjobs: {
        apiKey: env.MOLTJOBS_API_KEY || null,
        baseUrl: url(env, 'MOLTJOBS_BASE_URL', 'https://api.moltjobs.io/v1', problems, { protocols: ['https:'] })
      },
      taskforce: {
        apiKey: env.TASKFORCE_API_KEY || null,
        baseUrl: url(env, 'TASKFORCE_BASE_URL', 'https://www.task-force.app', problems, { protocols: ['https:'] })
      },
      ugig: {
        apiKey: env.UGIG_API_KEY || null,
        baseUrl: url(env, 'UGIG_BASE_URL', 'https://ugig.net', problems, { protocols: ['https:'] })
      }
    }
  };

  if (problems.length) throw new ConfigurationError(problems);

  const safe = {
    schemaVersion: config.schemaVersion,
    profile: config.profile,
    role: config.role,
    port: config.port,
    persistence: config.database.enabled ? 'postgresql' : 'memory',
    databaseSsl: config.database.ssl,
    authMode: config.auth.mode,
    tenantMode: config.tenantMode,
    internalSchedulerEnabled: config.scheduler.internalEnabled,
    brainIntervalMinutes: config.scheduler.brainIntervalMinutes || null,
    reasoningEnabled: config.reasoningEnabled,
    writeRailsAllowed: config.rails.allowWrite,
    writeRails: config.rails.writeEnabled,
    configuredProviders: Object.entries(config.providers)
      .filter(([, value]) => Boolean(value))
      .map(([name]) => name.replace('_API_KEY', '').toLowerCase()),
    configuredRails: Object.entries(config.rails)
      .filter(([, value]) => value?.apiKey || value?.enabled === true)
      .map(([name]) => name)
  };
  config.safeSummary = Object.freeze({ ...safe, fingerprint: fingerprint(safe) });
  return deepFreeze(config);
}

let cachedRuntimeConfig;

export function getRuntimeConfig() {
  cachedRuntimeConfig ||= loadConfig(process.env);
  return cachedRuntimeConfig;
}
