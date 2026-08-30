import { createHash } from 'node:crypto';

export const DEFAULT_CREDENTIAL_REFS = Object.freeze({
  gemini: 'provider/gemini/default',
  openai: 'provider/openai/default',
  groq: 'provider/groq/default',
  openrouter: 'provider/openrouter/default',
  moltjobs: 'rail/moltjobs/default',
  taskforce: 'rail/taskforce/default'
});

const DEFAULT_DEFINITIONS = Object.freeze({
  [DEFAULT_CREDENTIAL_REFS.gemini]: definition('GEMINI_API_KEY', 'gemini', ['ai.inference']),
  [DEFAULT_CREDENTIAL_REFS.openai]: definition('OPENAI_API_KEY', 'openai', ['ai.inference']),
  [DEFAULT_CREDENTIAL_REFS.groq]: definition('GROQ_API_KEY', 'groq', ['ai.inference']),
  [DEFAULT_CREDENTIAL_REFS.openrouter]: definition('OPENROUTER_API_KEY', 'openrouter', ['ai.inference']),
  [DEFAULT_CREDENTIAL_REFS.moltjobs]: definition('MOLTJOBS_API_KEY', 'moltjobs', ['rail.discover', 'rail.heartbeat']),
  [DEFAULT_CREDENTIAL_REFS.taskforce]: definition('TASKFORCE_API_KEY', 'taskforce', ['rail.discover', 'rail.claim', 'rail.deliver', 'rail.follow_up', 'rail.payment.read'])
});

function definition(envName, provider, capabilities) {
  return {
    source: 'environment',
    envName,
    provider,
    accountId: 'default',
    environments: ['development', 'test', 'production'],
    modes: ['read_only', 'execute'],
    capabilities,
    status: 'active'
  };
}

export class CredentialResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CredentialResolutionError';
    this.code = code;
  }
}

export class CredentialResolver {
  constructor({
    env = process.env,
    environment = env.NODE_ENV || 'development',
    allowEnvironment = environment !== 'production' || env.TASKMAN_ALLOW_ENV_CREDENTIALS === 'true',
    definitions = DEFAULT_DEFINITIONS,
    audit = () => {}
  } = {}) {
    this.env = env;
    this.environment = environment;
    this.allowEnvironment = allowEnvironment;
    this.definitions = new Map(Object.entries(definitions).map(([ref, value]) => [ref, structuredClone(value)]));
    this.audit = audit;
  }

  describe(ref, context = {}) {
    const item = this.definitions.get(ref);
    if (!item) return { ref, status: 'missing', ready: false, reasonCode: 'CREDENTIAL_REF_UNKNOWN' };
    const scopeReason = this.#validate(item, context, false);
    const sourceReason = item.source === 'environment' && !this.allowEnvironment ? 'CREDENTIAL_ENV_ADAPTER_DISABLED' : null;
    const reasonCode = scopeReason || sourceReason;
    const configured = item.source !== 'environment' || Boolean(this.env[item.envName]);
    return {
      ref,
      provider: item.provider,
      accountId: item.accountId,
      status: reasonCode ? 'blocked' : item.status,
      ready: !reasonCode && configured,
      reasonCode: reasonCode || (configured ? null : 'CREDENTIAL_VALUE_MISSING'),
      expiresAt: item.expiresAt || null,
      rotationDueAt: item.rotationDueAt || null,
      capabilities: [...(item.capabilities || [])],
      modes: [...(item.modes || [])]
    };
  }

  async resolve(ref, context = {}) {
    const item = this.definitions.get(ref);
    if (!item) return this.#fail(ref, 'CREDENTIAL_REF_UNKNOWN', 'credential reference is unknown');
    const invalid = this.#validate(item, context, true);
    if (invalid) return this.#fail(ref, invalid, 'credential reference is not valid for this request');
    if (item.source !== 'environment') return this.#fail(ref, 'CREDENTIAL_SOURCE_UNSUPPORTED', 'credential source is unsupported');
    if (!this.allowEnvironment) return this.#fail(ref, 'CREDENTIAL_ENV_ADAPTER_DISABLED', 'environment credential adapter is disabled');

    const value = this.env[item.envName];
    if (!value) return this.#fail(ref, 'CREDENTIAL_VALUE_MISSING', 'credential value is unavailable');
    const metadata = {
      ref,
      provider: item.provider,
      accountId: item.accountId,
      version: item.activeVersion || 'environment',
      fingerprint: createHash('sha256').update(value).digest('hex').slice(0, 12)
    };
    this.#audit({ event: 'credential.resolve', outcome: 'success', ...metadata });
    return { value, metadata };
  }

  register(ref, definitionValue) {
    if (!ref || !definitionValue || typeof definitionValue !== 'object') {
      throw new CredentialResolutionError('CREDENTIAL_DEFINITION_INVALID', 'credential definition is invalid');
    }
    this.definitions.set(ref, structuredClone(definitionValue));
  }

  stageVersion(ref, { version, fingerprint, notBefore = null, expiresAt = null }) {
    const item = this.#required(ref);
    if (!version || !fingerprint) throw new CredentialResolutionError('CREDENTIAL_VERSION_INVALID', 'version and fingerprint are required');
    item.nextVersion = { version, fingerprint, notBefore, expiresAt, status: 'staged' };
    this.#audit({ event: 'credential.rotation.stage', outcome: 'success', ref, version, fingerprint });
    return this.describe(ref);
  }

  activateVersion(ref, version, { overlapUntil = null } = {}) {
    const item = this.#required(ref);
    if (item.nextVersion?.version !== version) throw new CredentialResolutionError('CREDENTIAL_VERSION_NOT_STAGED', 'credential version is not staged');
    item.previousVersion = item.activeVersion ? { version: item.activeVersion, overlapUntil } : null;
    item.activeVersion = version;
    item.activeFingerprint = item.nextVersion.fingerprint;
    item.nextVersion = null;
    this.#audit({ event: 'credential.rotation.activate', outcome: 'success', ref, version, fingerprint: item.activeFingerprint });
    return this.describe(ref);
  }

  revoke(ref) {
    const item = this.#required(ref);
    item.status = 'revoked';
    this.#audit({ event: 'credential.revoke', outcome: 'success', ref });
    return this.describe(ref);
  }

  #required(ref) {
    const item = this.definitions.get(ref);
    if (!item) throw new CredentialResolutionError('CREDENTIAL_REF_UNKNOWN', 'credential reference is unknown');
    return item;
  }

  #validate(item, context, useClock) {
    const environment = context.environment || this.environment;
    if (item.status !== 'active') return `CREDENTIAL_${String(item.status || 'INACTIVE').toUpperCase()}`;
    if (item.accountId && context.accountId && item.accountId !== context.accountId) return 'CREDENTIAL_SCOPE_ACCOUNT';
    if (item.provider && context.provider && item.provider !== context.provider) return 'CREDENTIAL_SCOPE_PROVIDER';
    if (item.environments?.length && !item.environments.includes(environment)) return 'CREDENTIAL_SCOPE_ENVIRONMENT';
    if (item.capabilities?.length && context.capability && !item.capabilities.includes(context.capability)) return 'CREDENTIAL_SCOPE_CAPABILITY';
    if (item.modes?.length && context.mode && !item.modes.includes(context.mode)) return 'CREDENTIAL_SCOPE_MODE';
    if (useClock && item.notBefore && Date.parse(item.notBefore) > Date.now()) return 'CREDENTIAL_NOT_ACTIVE';
    if (useClock && item.expiresAt && Date.parse(item.expiresAt) <= Date.now()) return 'CREDENTIAL_EXPIRED';
    return null;
  }

  #fail(ref, code, message) {
    this.#audit({ event: 'credential.resolve', outcome: 'failure', ref, reasonCode: code });
    throw new CredentialResolutionError(code, `${message} (${code})`);
  }

  #audit(event) {
    this.audit(Object.freeze({ ...event, at: new Date().toISOString() }));
  }
}

export const defaultCredentialResolver = new CredentialResolver();

export async function resolveCredential({
  resolver = defaultCredentialResolver,
  ref,
  inlineValue,
  context = {},
  environment = process.env.NODE_ENV || 'development'
}) {
  if (inlineValue !== undefined) {
    if (environment === 'production') {
      throw new CredentialResolutionError('CREDENTIAL_INLINE_FORBIDDEN', 'inline credentials are forbidden in production');
    }
    if (!inlineValue) throw new CredentialResolutionError('CREDENTIAL_VALUE_MISSING', 'credential value is unavailable');
    return { value: inlineValue, metadata: { ref: 'inline/test-only', provider: context.provider || null } };
  }
  return resolver.resolve(ref, { ...context, environment });
}
