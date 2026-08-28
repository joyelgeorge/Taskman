const providers = [
  {
    id: 'gemini',
    env: 'GEMINI_API_KEY',
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
      errors.push({ provider: p.id, error: String(e.message || e) });
    }
  }
  throw new Error(errors.length ? `All configured providers failed: ${JSON.stringify(errors)}` : 'No provider API key is configured');
}
