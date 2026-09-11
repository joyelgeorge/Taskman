/**
 * Ollama Local Model Adapter
 * Connects to local or remote Ollama instances for zero-cost private LLM inference.
 */

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'llama3.2';

/**
 * Checks if the local Ollama instance is active and reachable.
 */
export async function checkOllamaHealth({ baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL, signal } = {}) {
  const url = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/api/version`, { signal });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, version: data?.version || 'unknown', baseUrl: url };
  } catch (err) {
    return { ok: false, status: 'UNREACHABLE', error: err.message, baseUrl: url };
  }
}

/**
 * Lists models available in the local Ollama instance.
 */
export async function listOllamaModels({ baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL, signal } = {}) {
  const url = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/api/tags`, { signal });
    if (!res.ok) {
      return { ok: false, models: [], error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = (data?.models || []).map(m => ({
      name: m.name,
      model: m.model,
      size: m.size,
      digest: m.digest,
      modifiedAt: m.modified_at
    }));
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: err.message };
  }
}

/**
 * Executes a prompt using Ollama via the native generate / chat endpoint.
 */
export async function callOllama({
  prompt,
  systemPrompt = '',
  messages: inputMessages,
  model = process.env.OLLAMA_MODEL || DEFAULT_MODEL,
  baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL,
  temperature = 0.2,
  format = undefined, // e.g. 'json'
  signal
} = {}) {
  const url = baseUrl.replace(/\/$/, '');
  let messages = [];

  if (Array.isArray(inputMessages) && inputMessages.length > 0) {
    if (systemPrompt && !inputMessages.some(m => m.role === 'system')) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(...inputMessages);
  } else {
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    if (prompt) {
      messages.push({ role: 'user', content: prompt });
    }
  }

  const payload = {
    model,
    messages,
    stream: false,
    options: {
      temperature
    }
  };

  if (format === 'json') {
    payload.format = 'json';
  }

  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama error HTTP ${res.status}: ${body || res.statusText}`);
  }

  const data = await res.json();
  const text = data?.message?.content || '';
  const inputTokens = data?.prompt_eval_count || 0;
  const outputTokens = data?.eval_count || 0;
  const totalDurationMs = data?.total_duration ? Math.round(data.total_duration / 1e6) : 0;

  return {
    text,
    inputTokens,
    outputTokens,
    totalDurationMs,
    model: data?.model || model
  };
}
