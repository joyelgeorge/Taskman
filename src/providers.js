import { DEFAULT_CREDENTIAL_REFS, defaultCredentialResolver, resolveCredential } from './credential-resolver.js';

const providers = [
  {
    id: 'gemini',
    credentialRef: DEFAULT_CREDENTIAL_REFS.gemini,
    model: 'gemini-2.0-flash',
    endpoint: key => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
    async call(prompt, key) {
      const r = await fetch(this.endpoint(key), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      const j = await r.json();
      const text = j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      const usage = j?.usageMetadata || {};
      return { text, inputTokens: usage.promptTokenCount || 0, outputTokens: usage.candidatesTokenCount || 0 };
    }
  },
  {
    id: 'openai', credentialRef: DEFAULT_CREDENTIAL_REFS.openai, model: 'gpt-4o-mini',
    async call(prompt, key) { return openAICompatible('https://api.openai.com/v1/chat/completions', this.model, prompt, key); }
  },
  {
    id: 'groq', credentialRef: DEFAULT_CREDENTIAL_REFS.groq, model: 'llama-3.1-8b-instant',
    async call(prompt, key) { return openAICompatible('https://api.groq.com/openai/v1/chat/completions', this.model, prompt, key); }
  },
  {
    id: 'openrouter', credentialRef: DEFAULT_CREDENTIAL_REFS.openrouter, model: 'openai/gpt-oss-20b:free',
    async call(prompt, key) { return openAICompatible('https://openrouter.ai/api/v1/chat/completions', this.model, prompt, key); }
  }
];

async function openAICompatible(url, model, prompt, key) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error(`${model} ${r.status}`);
  const j = await r.json();
  return {
    text: j?.choices?.[0]?.message?.content || '',
    inputTokens: j?.usage?.prompt_tokens || 0,
    outputTokens: j?.usage?.completion_tokens || 0
  };
}

export function providerStatus({ credentialResolver = defaultCredentialResolver, accountId = 'default' } = {}) {
  return providers.map(p => {
    const credential = credentialResolver.describe(p.credentialRef, { provider: p.id, accountId, capability: 'ai.inference' });
    return { id: p.id, model: p.model, ready: credential.ready, credential: { ref: p.credentialRef, status: credential.status, reasonCode: credential.reasonCode } };
  });
}

export async function runWithFallback(prompt, { credentialResolver = defaultCredentialResolver, accountId = 'default' } = {}) {
  const errors = [];
  for (const p of providers) {
    const started = Date.now();
    try {
      const { value: key } = await resolveCredential({
        resolver: credentialResolver,
        ref: p.credentialRef,
        context: { provider: p.id, accountId, capability: 'ai.inference', mode: 'read_only' }
      });
      const result = await p.call(prompt, key);
      return { ...result, provider: p.id, model: p.model, latencyMs: Date.now() - started, fallbacks: errors };
    } catch (e) {
      errors.push({ provider: p.id, code: e?.code || 'PROVIDER_FAILURE' });
    }
  }
  throw new Error(`All configured providers failed: ${JSON.stringify(errors)}`);
}
