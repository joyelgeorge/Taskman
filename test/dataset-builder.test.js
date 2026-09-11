import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExecutionPair,
  convertDatasetFormat,
  splitDataset,
  writeDatasetJsonl,
  readDatasetJsonl,
  DATASET_FORMATS
} from '../src/learning/dataset-builder.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, existsSync } from 'node:fs';

describe('Dataset Builder for LoRA & SFT Tuning', () => {
  it('formats execution pairs with system prompt and metadata', () => {
    const pair = formatExecutionPair({
      systemPrompt: 'System instruction',
      prompt: 'User query',
      response: { decision: 'ENTER' },
      outcomeScore: 0.95
    });

    assert.equal(pair.systemPrompt, 'System instruction');
    assert.equal(pair.prompt, 'User query');
    assert.ok(pair.response.includes('ENTER'));
    assert.equal(pair.outcomeScore, 0.95);
  });

  it('converts dataset into Alpaca format', () => {
    const pairs = [
      formatExecutionPair({
        systemPrompt: 'System instruction',
        prompt: 'Opportunity 1',
        response: 'Decision 1'
      })
    ];

    const alpaca = convertDatasetFormat(pairs, DATASET_FORMATS.ALPACA);
    assert.equal(alpaca.length, 1);
    assert.ok(alpaca[0].instruction.includes('System instruction'));
    assert.ok(alpaca[0].instruction.includes('Opportunity 1'));
    assert.equal(alpaca[0].output, 'Decision 1');
  });

  it('converts dataset into ShareGPT format', () => {
    const pairs = [
      formatExecutionPair({
        systemPrompt: 'System',
        prompt: 'Hello',
        response: 'World'
      })
    ];

    const sharegpt = convertDatasetFormat(pairs, DATASET_FORMATS.SHAREGPT);
    assert.equal(sharegpt.length, 1);
    assert.equal(sharegpt[0].conversations.length, 3);
    assert.equal(sharegpt[0].conversations[0].from, 'system');
    assert.equal(sharegpt[0].conversations[1].from, 'human');
    assert.equal(sharegpt[0].conversations[2].from, 'gpt');
  });

  it('converts dataset into DPO preference format when rejected response is present', () => {
    const pairs = [
      formatExecutionPair({
        systemPrompt: 'System',
        prompt: 'Triage gig',
        response: 'ENTER (verified escrow)',
        rejectedResponse: 'REJECT (no reason)'
      })
    ];

    const dpo = convertDatasetFormat(pairs, DATASET_FORMATS.DPO_PREFERENCE);
    assert.equal(dpo.length, 1);
    assert.equal(dpo[0].chosen, 'ENTER (verified escrow)');
    assert.equal(dpo[0].rejected, 'REJECT (no reason)');
  });

  it('splits dataset into train and eval sets', () => {
    const entries = Array.from({ length: 10 }, (_, i) => formatExecutionPair({
      prompt: `Prompt ${i}`,
      response: `Response ${i}`
    }));

    const split = splitDataset(entries, 0.8);
    assert.equal(split.train.length, 8);
    assert.equal(split.eval.length, 2);
  });

  it('writes and reads JSONL files safely', () => {
    const tmpFile = join(tmpdir(), `test-dataset-${Date.now()}.jsonl`);
    try {
      const data = [{ a: 1 }, { b: 2 }];
      writeDatasetJsonl(tmpFile, data);
      const readBack = readDatasetJsonl(tmpFile);
      assert.deepEqual(readBack, data);
    } finally {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  });
});
