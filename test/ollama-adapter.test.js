import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkOllamaHealth, listOllamaModels, callOllama } from '../src/adapters/ollama-adapter.js';

describe('Ollama Adapter', () => {
  it('handles unreachable Ollama gracefully without crashing', async () => {
    // Unreachable port / host
    const res = await checkOllamaHealth({ baseUrl: 'http://127.0.0.1:59999' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'UNREACHABLE');
  });

  it('handles model list failure on unreachable server', async () => {
    const res = await listOllamaModels({ baseUrl: 'http://127.0.0.1:59999' });
    assert.equal(res.ok, false);
    assert.deepEqual(res.models, []);
  });

  it('formats request payload and parses responses properly', async () => {
    // Mock fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'llama3.2');
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');
      assert.equal(body.messages[1].content, 'Find opportunities');

      return {
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: '{"decision":"ENTER"}' },
          prompt_eval_count: 42,
          eval_count: 15,
          total_duration: 120000000
        })
      };
    };

    try {
      const res = await callOllama({
        prompt: 'Find opportunities',
        systemPrompt: 'You are an AI.',
        model: 'llama3.2',
        baseUrl: 'http://127.0.0.1:11434'
      });

      assert.equal(res.text, '{"decision":"ENTER"}');
      assert.equal(res.inputTokens, 42);
      assert.equal(res.outputTokens, 15);
      assert.equal(res.totalDurationMs, 120);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
