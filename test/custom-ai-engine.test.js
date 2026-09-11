import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONEY_DOMAINS,
  buildMoneyPrompt,
  evaluateMoneyAiOutput
} from '../src/ai-engine/money-making-agent.js';
import {
  recordDatasetEntry,
  getDatasetEntries,
  clearDatasetMemory,
  exportFineTuningDataset,
  generateOllamaModelfile
} from '../src/ai-engine/dataset-collector.js';

describe('Custom Money-Making AI Engine', () => {
  beforeEach(() => {
    clearDatasetMemory();
  });

  it('builds structured prompt for opportunity triage', () => {
    const { systemPrompt, userPrompt } = buildMoneyPrompt({
      domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
      objective: 'Evaluate $50 Algora issue',
      context: { issueNumber: 123, repo: 'owner/repo', rewardUsd: 50 }
    });

    assert.ok(systemPrompt.includes('Economic Triage Intelligence'));
    assert.ok(userPrompt.includes('Evaluate $50 Algora issue'));
    assert.ok(userPrompt.includes('"decision": "ENTER" | "REJECT" | "NEEDS_EVIDENCE"'));
  });

  it('evaluates and parses structured AI output safely', () => {
    const rawAiOutput = `\`\`\`json
{
  "decision": "ENTER",
  "feasibilityScore": 0.95,
  "estimatedPayoutUsd": 50,
  "trapDetected": false,
  "reasons": ["Verified funding in escrow", "No exfiltration patterns"]
}
\`\`\``;

    const result = evaluateMoneyAiOutput(MONEY_DOMAINS.OPPORTUNITY_TRIAGE, rawAiOutput);
    assert.equal(result.ok, true);
    assert.equal(result.decision, 'ENTER');
    assert.equal(result.feasibilityScore, 0.95);
    assert.equal(result.estimatedPayoutUsd, 50);
    assert.equal(result.trapDetected, false);
    assert.equal(result.reasons.length, 2);
  });

  it('records dataset entries and filters by outcome score', () => {
    recordDatasetEntry({
      domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
      prompt: 'Check gig 1',
      response: 'ENTER',
      outcomeScore: 0.95
    });

    recordDatasetEntry({
      domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
      prompt: 'Check gig 2 (failed execution)',
      response: 'ENTER',
      outcomeScore: 0.2
    });

    const highQuality = getDatasetEntries({ minOutcomeScore: 0.8 });
    assert.equal(highQuality.length, 1);
    assert.equal(highQuality[0].prompt, 'Check gig 1');
  });

  it('exports fine-tuning dataset in Alpaca and OpenAI formats', () => {
    recordDatasetEntry({
      domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
      systemPrompt: 'You are an AI.',
      prompt: 'Is this profitable?',
      response: '{"decision":"ENTER"}',
      outcomeScore: 1.0
    });

    const alpacaData = exportFineTuningDataset({ format: 'alpaca' });
    assert.equal(alpacaData.length, 1);
    assert.ok(alpacaData[0].instruction.includes('Is this profitable?'));
    assert.equal(alpacaData[0].output, '{"decision":"ENTER"}');

    const openaiData = exportFineTuningDataset({ format: 'openai' });
    assert.equal(openaiData.length, 1);
    assert.equal(openaiData[0].messages.length, 3);
    assert.equal(openaiData[0].messages[0].role, 'system');
    assert.equal(openaiData[0].messages[1].role, 'user');
    assert.equal(openaiData[0].messages[2].role, 'assistant');
  });

  it('generates customized Ollama Modelfile', () => {
    const modelfile = generateOllamaModelfile({
      baseModel: 'llama3.2',
      systemPrompt: 'You are the proprietary Taskman Revenue Intelligence.',
      temperature: 0.1
    });

    assert.ok(modelfile.includes('FROM llama3.2'));
    assert.ok(modelfile.includes('PARAMETER temperature 0.1'));
    assert.ok(modelfile.includes('SYSTEM """You are the proprietary Taskman Revenue Intelligence."""'));
  });
});
