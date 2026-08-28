import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLearningEnvelope, validateLearningEnvelope } from '../src/structured-learning.js';

test('accepts a valid structured learning envelope', () => {
  const envelope = validateLearningEnvelope(parseLearningEnvelope(JSON.stringify({
    answer: 'Validated a new executable path.',
    events: [
      { type: 'fact', summary: 'Trigger is machine-readable.', confidence: 0.9, value: { trigger: 'webhook' } },
      { type: 'gap_resolved', summary: 'Trigger gap resolved.', confidence: 0.9, gap: 'prove trigger' },
      { type: 'future_path', summary: 'Validate intervention permission next.', confidence: 0.8, next_best_action: 'Validate intervention permission.' }
    ]
  })));
  assert.equal(envelope.events.length, 3);
  assert.equal(envelope.events[2].value.nextBestAction, 'Validate intervention permission.');
});

test('rejects unsupported event types', () => {
  assert.throws(() => parseLearningEnvelope(JSON.stringify({
    answer: 'x',
    events: [{ type: 'invented_type', summary: 'bad' }]
  })));
});

test('requires a future path for non-terminal results', () => {
  assert.throws(() => validateLearningEnvelope(parseLearningEnvelope(JSON.stringify({
    answer: 'x',
    events: [{ type: 'fact', summary: 'A fact', confidence: 0.7 }]
  }))));
});

test('allows terminal rejection without future path', () => {
  const envelope = validateLearningEnvelope(parseLearningEnvelope(JSON.stringify({
    answer: 'Candidate rejected.',
    events: [{ type: 'rejection', summary: 'Dominant incumbent blocks the wedge.', confidence: 0.95, terminal: true }]
  })));
  assert.equal(envelope.events[0].terminal, true);
});
