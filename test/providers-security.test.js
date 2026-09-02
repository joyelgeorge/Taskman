import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithFallback } from '../src/providers.js';

const providerEnvNames = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY'];

async function withGeminiOnly(key, fetchImpl, run) {
  const oldFetch = globalThis.fetch;
  const oldEnv = Object.fromEntries(providerEnvNames.map(name => [name, process.env[name]]));
  for (const name of providerEnvNames) delete process.env[name];
  process.env.GEMINI_API_KEY = key;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = oldFetch;
    for (const name of providerEnvNames) {
      if (oldEnv[name] === undefined) delete process.env[name];
      else process.env[name] = oldEnv[name];
    }
  }
}

test('Gemini sends credentials in x-goog-api-key and never in the URL', async () => {
  const secret = 'sentinel key/with?sensitive=value';
  let captured;
  await withGeminiOnly(secret, async (url, options) => {
    captured = { url: String(url), options };
    return {
      ok: true,
      async json() {
        return { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: {} };
      }
    };
  }, async () => {
    const result = await runWithFallback('test prompt', { env: process.env });
    assert.equal(result.provider, 'gemini');
  });

  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(captured.url.includes(secret), false);
  assert.equal(captured.url.includes(encodeURIComponent(secret)), false);
  assert.equal(captured.options.headers['x-goog-api-key'], secret);
});

test('provider failure metadata excludes raw and URL-encoded credentials', async () => {
  const secret = 'sentinel key/with?sensitive=value';
  await withGeminiOnly(secret, async () => {
    throw new Error(`transport failed for ${secret} and ${encodeURIComponent(secret)}`);
  }, async () => {
    await assert.rejects(runWithFallback('test prompt', { env: process.env }), error => {
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes(encodeURIComponent(secret)), false);
      assert.equal(error.code, 'ALL_PROVIDERS_FAILED');
      assert.deepEqual(error.diagnostics.map(({ provider, code }) => ({ provider, code })), [
        { provider: 'gemini', code: 'PROVIDER_ERROR' }
      ]);
      return true;
    });
  });
});
