import test from 'node:test';
import assert from 'node:assert/strict';
import { CredentialResolver, DEFAULT_CREDENTIAL_REFS, resolveCredential } from '../src/credential-resolver.js';

function resolver(overrides = {}) {
  return new CredentialResolver({
    env: { NODE_ENV: 'test', OPENAI_API_KEY: 'seed-secret', TASKFORCE_API_KEY: 'rail-secret' },
    environment: 'test',
    ...overrides
  });
}

test('resolves an opaque reference without exposing the value in metadata or audit events', async () => {
  const audit = [];
  const r = resolver({ audit: event => audit.push(event) });
  const result = await r.resolve(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'openai', accountId: 'default', capability: 'ai.inference', mode: 'read_only' });
  assert.equal(result.value, 'seed-secret');
  assert.equal(JSON.stringify(result.metadata).includes('seed-secret'), false);
  assert.equal(JSON.stringify(audit).includes('seed-secret'), false);
  assert.equal(result.metadata.fingerprint.length, 12);
});

test('fails closed for cross-account, provider, capability, expiry, and revocation', async () => {
  const r = resolver();
  await assert.rejects(() => r.resolve(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'openai', accountId: 'other', capability: 'ai.inference' }), error => error.code === 'CREDENTIAL_SCOPE_ACCOUNT');
  await assert.rejects(() => r.resolve(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'groq', accountId: 'default', capability: 'ai.inference' }), error => error.code === 'CREDENTIAL_SCOPE_PROVIDER');
  await assert.rejects(() => r.resolve(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'openai', accountId: 'default', capability: 'rail.claim' }), error => error.code === 'CREDENTIAL_SCOPE_CAPABILITY');
  r.register('expired', { source: 'environment', envName: 'OPENAI_API_KEY', provider: 'openai', accountId: 'default', status: 'active', expiresAt: '2000-01-01T00:00:00Z' });
  await assert.rejects(() => r.resolve('expired', { provider: 'openai', accountId: 'default' }), error => error.code === 'CREDENTIAL_EXPIRED');
  r.revoke(DEFAULT_CREDENTIAL_REFS.openai);
  await assert.rejects(() => r.resolve(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'openai', accountId: 'default' }), error => error.code === 'CREDENTIAL_REVOKED');
});

test('production disables environment and inline credentials unless explicitly permitted', async () => {
  const locked = resolver({ environment: 'production', allowEnvironment: false });
  assert.equal(locked.describe(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'openai', accountId: 'default', capability: 'ai.inference', environment: 'production' }).reasonCode, 'CREDENTIAL_ENV_ADAPTER_DISABLED');
  await assert.rejects(() => locked.resolve(DEFAULT_CREDENTIAL_REFS.openai, { provider: 'openai', accountId: 'default', capability: 'ai.inference', environment: 'production' }), error => error.code === 'CREDENTIAL_ENV_ADAPTER_DISABLED');
  await assert.rejects(() => resolveCredential({ ref: DEFAULT_CREDENTIAL_REFS.openai, inlineValue: 'raw-secret', environment: 'production' }), error => error.code === 'CREDENTIAL_INLINE_FORBIDDEN');
});

test('rotation lifecycle stages, activates, and revokes non-secret metadata', () => {
  const audit = [];
  const r = resolver({ audit: event => audit.push(event) });
  r.stageVersion(DEFAULT_CREDENTIAL_REFS.openai, { version: 'v2', fingerprint: 'abc123' });
  r.activateVersion(DEFAULT_CREDENTIAL_REFS.openai, 'v2', { overlapUntil: '2030-01-01T00:00:00Z' });
  const status = r.describe(DEFAULT_CREDENTIAL_REFS.openai);
  assert.equal(status.ready, true);
  r.revoke(DEFAULT_CREDENTIAL_REFS.openai);
  assert.equal(r.describe(DEFAULT_CREDENTIAL_REFS.openai).ready, false);
  assert.deepEqual(audit.map(event => event.event), ['credential.rotation.stage', 'credential.rotation.activate', 'credential.revoke']);
});

test('TaskForce reference is scoped to declared rail capabilities', async () => {
  const r = resolver();
  const result = await r.resolve(DEFAULT_CREDENTIAL_REFS.taskforce, { provider: 'taskforce', accountId: 'default', capability: 'rail.claim', mode: 'execute' });
  assert.equal(result.value, 'rail-secret');
});
