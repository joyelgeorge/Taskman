import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_DATASET_PATH = 'data/runtime/execution-dataset.jsonl';

/**
 * In-memory dataset buffer for continuous learning.
 */
const datasetMemoryStore = [];

/**
 * Records an execution prompt/response pair for continuous dataset generation & model tuning.
 */
export function recordDatasetEntry({
  id = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  domain = 'GENERAL',
  systemPrompt = '',
  prompt,
  response,
  rejectedResponse = null,
  metadata = {},
  outcomeScore = 1.0, // 0.0 to 1.0 based on real execution outcome
  verifiedSettlement = null,
  filePath = null
}) {
  const entry = {
    id,
    timestamp: new Date().toISOString(),
    domain,
    systemPrompt,
    prompt,
    response,
    rejectedResponse,
    metadata,
    outcomeScore,
    verifiedSettlement
  };

  datasetMemoryStore.push(entry);

  if (filePath) {
    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) {
      // File persistence is best-effort
    }
  }

  return entry;
}

/**
 * Returns recorded dataset items matching criteria, loading from disk if available.
 */
export function getDatasetEntries({ minOutcomeScore = 0.0, domain = null, filePath = null } = {}) {
  const allEntries = [...datasetMemoryStore];

  if (filePath && existsSync(filePath)) {
    try {
      const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        if (!allEntries.some(e => e.id === parsed.id)) {
          allEntries.push(parsed);
        }
      }
    } catch (e) {}
  }

  return allEntries.filter(item => {
    if (item.outcomeScore < minOutcomeScore) return false;
    if (domain && item.domain !== domain) return false;
    return true;
  });
}

/**
 * Clears in-memory dataset buffer (useful for testing).
 */
export function clearDatasetMemory() {
  datasetMemoryStore.length = 0;
}

/**
 * Exports fine-tuning datasets in formats suitable for Ollama, Unsloth, or Hugging Face SFT.
 */
export function exportFineTuningDataset({
  format = 'alpaca', // 'alpaca' | 'sharegpt' | 'openai'
  minOutcomeScore = 0.8
} = {}) {
  const items = getDatasetEntries({ minOutcomeScore });

  if (format === 'alpaca') {
    return items.map(item => ({
      instruction: item.systemPrompt ? `${item.systemPrompt}\n\n${item.prompt}` : item.prompt,
      input: '',
      output: typeof item.response === 'string' ? item.response : JSON.stringify(item.response)
    }));
  }

  if (format === 'sharegpt') {
    return items.map(item => ({
      conversations: [
        ...(item.systemPrompt ? [{ from: 'system', value: item.systemPrompt }] : []),
        { from: 'human', value: item.prompt },
        { from: 'gpt', value: typeof item.response === 'string' ? item.response : JSON.stringify(item.response) }
      ]
    }));
  }

  // Default OpenAI / ChatML format
  return items.map(item => ({
    messages: [
      ...(item.systemPrompt ? [{ role: 'system', content: item.systemPrompt }] : []),
      { role: 'user', content: item.prompt },
      { role: 'assistant', content: typeof item.response === 'string' ? item.response : JSON.stringify(item.response) }
    ]
  }));
}

/**
 * Generates an Ollama Modelfile to build your custom specialized AI model locally.
 */
export function generateOllamaModelfile({
  baseModel = 'llama3.2',
  systemPrompt = 'You are a private, autonomous money-making and economic optimization AI.',
  temperature = 0.2,
  adapterPath = null
} = {}) {
  let fileContent = `FROM ${baseModel}\n\n`;
  fileContent += `PARAMETER temperature ${temperature}\n`;
  fileContent += `PARAMETER top_p 0.9\n\n`;

  if (adapterPath) {
    fileContent += `ADAPTER ${adapterPath}\n\n`;
  }

  fileContent += `SYSTEM """${systemPrompt}"""\n`;

  return fileContent;
}
