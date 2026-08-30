const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const providers = [
  {
    id: 'gemini',
    env: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
    endpoint: () => GEMINI_ENDPOINT,
    async call(prompt, key) {
      const r = await fetch(this.endpoint(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
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
    id: 'openai', env: 'OPENAI_API_KEY', model: 'gpt-4o-mini',
    async call(prompt, key) { return openAICompatible('https://api.openai.com/v1/chat/completions', this.model, prompt, key); }
  },
  {
    id: 'groq', env: 'GROQ_API_KEY', model: 'llama-3.1-8b-instant',
    async call(prompt, key) { return openAICompatible('https://api.groq.com/openai/v1/chat/completions', this.model, prompt, key); }
  },
  {
    id: 'openrouter', env: 'OPENROUTER_API_KEY', model: 'openai/gpt-oss-20b:free',
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

function redactProviderError(error, secret) {
  let message = String(error?.message || error);
  if (!secret) return message;
  for (const value of new Set([secret, encodeURIComponent(secret)])) {
    if (value) message = message.split(value).join('[REDACTED]');
  }
  return message;
}

export function providerStatus() {
  return providers.map(p => ({ id: p.id, model: p.model, ready: Boolean(process.env[p.env]) }));
}

export async function runWithFallback(prompt) {
  const errors = [];
  for (const p of providers) {
    const key = process.env[p.env];
    if (!key) continue;
    const started = Date.now();
    try {
      const result = await p.call(prompt, key);
      return { ...result, provider: p.id, model: p.model, latencyMs: Date.now() - started, fallbacks: errors };
    } catch (e) {
      errors.push({ provider: p.id, error: redactProviderError(e, key) });
    }
  }
  throw new Error(errors.length ? `All configured providers failed: ${JSON.stringify(errors)}` : 'No provider API key is configured');
}
