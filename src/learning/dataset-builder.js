import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Dataset Builder for Fine-Tuning LoRA / SFT Models.
 * Generates structured datasets compatible with Unsloth, HuggingFace, LLaMA-Factory, and Ollama.
 */

export const DATASET_FORMATS = Object.freeze({
  ALPACA: 'alpaca',
  SHAREGPT: 'sharegpt',
  OPENAI_CHAT: 'openai',
  DPO_PREFERENCE: 'dpo'
});

/**
 * Normalizes an execution trace into a standardized instruction-tuning pair.
 */
export function formatExecutionPair({
  id = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  systemPrompt = '',
  prompt,
  response,
  rejectedResponse = null,
  outcomeScore = 1.0,
  domain = 'ECONOMIC_TRIAGE',
  metadata = {}
}) {
  if (!prompt || !response) {
    throw new Error('Dataset entry requires both prompt and response');
  }

  const cleanResponse = typeof response === 'string' ? response : JSON.stringify(response, null, 2);

  return {
    id,
    timestamp: new Date().toISOString(),
    domain,
    systemPrompt: systemPrompt || '',
    prompt: String(prompt).trim(),
    response: cleanResponse,
    rejectedResponse: rejectedResponse ? (typeof rejectedResponse === 'string' ? rejectedResponse : JSON.stringify(rejectedResponse, null, 2)) : null,
    outcomeScore: Number(outcomeScore) || 0,
    metadata
  };
}

/**
 * Converts formatted entries to target format (Alpaca, ShareGPT, OpenAI, DPO).
 */
export function convertDatasetFormat(entries, format = DATASET_FORMATS.ALPACA) {
  if (!Array.isArray(entries)) return [];

  switch (format) {
    case DATASET_FORMATS.ALPACA:
      return entries.map(item => ({
        instruction: item.systemPrompt ? `${item.systemPrompt}\n\n${item.prompt}` : item.prompt,
        input: '',
        output: item.response
      }));

    case DATASET_FORMATS.SHAREGPT:
      return entries.map(item => ({
        conversations: [
          ...(item.systemPrompt ? [{ from: 'system', value: item.systemPrompt }] : []),
          { from: 'human', value: item.prompt },
          { from: 'gpt', value: item.response }
        ]
      }));

    case DATASET_FORMATS.DPO_PREFERENCE:
      return entries
        .filter(item => item.rejectedResponse)
        .map(item => ({
          system: item.systemPrompt,
          prompt: item.prompt,
          chosen: item.response,
          rejected: item.rejectedResponse
        }));

    case DATASET_FORMATS.OPENAI_CHAT:
    default:
      return entries.map(item => ({
        messages: [
          ...(item.systemPrompt ? [{ role: 'system', content: item.systemPrompt }] : []),
          { role: 'user', content: item.prompt },
          { role: 'assistant', content: item.response }
        ]
      }));
  }
}

/**
 * Splits a dataset into training and evaluation partitions (e.g. 90/10).
 */
export function splitDataset(entries, trainRatio = 0.9) {
  const safeRatio = Math.max(0.1, Math.min(0.99, trainRatio));
  const splitIndex = Math.floor(entries.length * safeRatio);
  return {
    train: entries.slice(0, splitIndex),
    eval: entries.slice(splitIndex)
  };
}

/**
 * Writes dataset to a JSONL file.
 */
export function writeDatasetJsonl(filePath, formattedData) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const lines = formattedData.map(d => JSON.stringify(d)).join('\n') + '\n';
  writeFileSync(filePath, lines, 'utf8');
  return { filePath, count: formattedData.length };
}

/**
 * Reads and parses a JSONL dataset file.
 */
export function readDatasetJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
