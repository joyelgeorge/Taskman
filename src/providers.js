import { LIMITS, TaskmanError, abortable, createDeadline } from './limits.js';
import { recordProviderAttempt, withTelemetrySpan } from './observability.js';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const providers = [
  {
    id: 'gemini',
    env: 'GEMINI_API_KEY',
    model: 'gemini-2.0-flash',
    endpoint: () => GEMINI_ENDPOINT,
    async call(prompt, key, { signal } = {}) {
      const r = await fetch(this.endpoint(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal
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
    async call(prompt, key, { signal } = {}) {
      return openAICompatible('https://api.openai.com/v1/chat/completions', this.model, prompt, key, signal);
    }
  },
  {
    id: 'groq', env: 'GROQ_API_KEY', model: 'llama-3.1-8b-instant',
    async call(prompt, key, { signal } = {}) {
      return openAICompatible('https://api.groq.com/openai/v1/chat/completions', this.model, prompt, key, signal);
    }
  },
  {
    id: 'openrouter', env: 'OPENROUTER_API_KEY', model: 'openai/gpt-oss-20b:free',
    async call(prompt, key, { signal } = {}) {
      return openAICompatible('https://openrouter.ai/api/v1/chat/completions', this.model, prompt, key, signal);
    }
  }
];

async function openAICompatible(url, model, prompt, key, signal) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
    signal
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

export async function runWithFallback(prompt, {
  signal,
  runTimeoutMs = LIMITS.runTimeoutMs,
  providerTimeoutMs = LIMITS.providerTimeoutMs,
  providerList = providers,
  env = process.env
} = {}) {
  const errors = [];
  const runStarted = Date.now();
  const overall = createDeadline(runTimeoutMs, {
    parentSignal: signal,
    code: 'RUN_DEADLINE_EXCEEDED',
    message: 'Task execution deadline exceeded'
  });

  try {
    for (const provider of providerList) {
      const key = provider.key ?? env[provider.env];
      if (!key) continue;

      const remainingMs = runTimeoutMs - (Date.now() - runStarted);
      if (remainingMs <= 0 || overall.signal.aborted) break;

      const attemptStarted = Date.now();
      const attempt = createDeadline(Math.min(providerTimeoutMs, remainingMs), {
        parentSignal: overall.signal,
        code: 'PROVIDER_TIMEOUT',
        message: `Provider ${provider.id} timed out`
      });

      try {
        const result = await withTelemetrySpan('provider.request', {
          provider: provider.id,
          model: provider.model,
          attempt: errors.length + 1,
          fallback: errors.length > 0
        }, () => abortable(
          provider.call(prompt, key, { signal: attempt.signal }),
          attempt.signal
        ));
        if (overall.signal.aborted) {
          throw overall.signal.reason;
        }
        recordProviderAttempt({
          provider: provider.id,
          model: provider.model,
          durationMs: Date.now() - attemptStarted,
          outcome: 'success',
          fallback: errors.length > 0
        });
        return {
          ...result,
          provider: provider.id,
          model: provider.model,
          latencyMs: Date.now() - attemptStarted,
          fallbacks: errors
        };
      } catch (error) {
        const runBudgetExhausted = Date.now() - runStarted >= runTimeoutMs;
        const code = overall.signal.aborted || runBudgetExhausted
          ? 'RUN_DEADLINE_EXCEEDED'
          : attempt.signal.aborted
            ? 'PROVIDER_TIMEOUT'
            : 'PROVIDER_ERROR';
        errors.push({
          provider: provider.id,
          code,
          durationMs: Date.now() - attemptStarted
        });
        recordProviderAttempt({
          provider: provider.id,
          model: provider.model,
          durationMs: Date.now() - attemptStarted,
          outcome: 'error',
          errorCode: code,
          fallback: errors.length > 1
        });
        if (code === 'RUN_DEADLINE_EXCEEDED') break;
      } finally {
        attempt.cleanup();
      }
    }

    if (overall.signal.aborted || Date.now() - runStarted >= runTimeoutMs) {
      const failure = new TaskmanError('Task execution deadline exceeded', {
        code: 'RUN_DEADLINE_EXCEEDED',
        statusCode: 504
      });
      failure.diagnostics = errors;
      throw failure;
    }

    if (!errors.length) {
      throw new TaskmanError('No provider API key is configured', {
        code: 'NO_PROVIDER_CONFIGURED',
        statusCode: 503
      });
    }

    const failure = new TaskmanError(`All configured providers failed: ${JSON.stringify(errors)}`, {
      code: 'ALL_PROVIDERS_FAILED',
      statusCode: 502
    });
    failure.diagnostics = errors;
    throw failure;
  } finally {
    overall.cleanup();
  }
}
