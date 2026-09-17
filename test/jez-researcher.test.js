import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJezResearch, RESEARCH_LANES } from '../src/jez-researcher.js';
import { resetResearchLogForTesting, listResearchNotes } from '../src/research-log.js';
import { handler as jezResearchCronHandler } from '../packages/crons/jobs/jez-research.js';

test.beforeEach(async () => resetResearchLogForTesting());

test('executeJezResearch queries Jez Gateway and records structured research note', async () => {
  const mockFetch = async (url, options) => {
    assert.match(url, /chat\/completions/);
    assert.equal(options.method, 'POST');
    const authHeader = options.headers['Authorization'];
    assert.ok(authHeader.startsWith('Bearer '));

    const body = JSON.parse(options.body);
    assert.ok(body.messages.length >= 2);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'openai/gpt-oss-20b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                claim: 'Supabase anon keys allow public reads only when RLS is enabled; missing RLS exposes all table rows to the public internet.',
                source: 'supabase:rls-policy-security-guide'
              })
            }
          }
        ]
      })
    };
  };

  const outcome = await executeJezResearch({
    lane: 'vibe-security',
    fetchImpl: mockFetch,
    trainAfter: false
  });

  assert.equal(outcome.lane, 'vibe-security');
  assert.match(outcome.claim, /Supabase anon keys/);
  assert.equal(outcome.source, 'supabase:rls-policy-security-guide');
  assert.equal(outcome.tier, 'REFERENCED');

  const notes = await listResearchNotes({ lane: 'vibe-security' });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].claim, outcome.claim);
});

test('executeJezResearch falls back cleanly when model returns unformatted text', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Duplicate invoice numbers varying only by leading zeroes bypass single-column database uniqueness constraints.'
          }
        }
      ]
    })
  });

  const outcome = await executeJezResearch({
    lane: 'tally-leakage',
    fetchImpl: mockFetch,
    trainAfter: false
  });

  assert.equal(outcome.lane, 'tally-leakage');
  assert.match(outcome.claim, /Duplicate invoice numbers/);
  assert.ok(outcome.source.startsWith('jez:ai:'));
});

test('executeJezResearch throws clean error when gateway fails', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    text: async () => 'Upstream gateway down'
  });

  await assert.rejects(
    () => executeJezResearch({ fetchImpl: mockFetch, trainAfter: false }),
    /Jez Gateway call failed \[503\]/
  );
});

test('jez-research cron job handler executes research pass and returns summary', async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          message: {
            role: 'assistant',
            content: JSON.stringify({
              claim: 'NPM package postinstall scripts executing curl pipes to bash bypass static package metadata inspection.',
              source: 'npm:security-advisory-lifecycle-exec'
            })
          }
        }
      ]
    })
  });

  const result = await jezResearchCronHandler({
    fetchImpl: mockFetch,
    lane: 'supply-chain',
    trainAfter: false
  });

  assert.equal(result.lane, 'supply-chain');
  assert.match(result.claim, /postinstall/);
  assert.equal(result.source, 'npm:security-advisory-lifecycle-exec');
  assert.ok(result.noteId);
});
