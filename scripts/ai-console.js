#!/usr/bin/env node

import { checkOllamaHealth, listOllamaModels, callOllama } from '../src/adapters/ollama-adapter.js';
import { MONEY_DOMAINS, buildMoneyPrompt, evaluateMoneyAiOutput } from '../src/ai-engine/money-making-agent.js';
import { getDatasetEntries, exportFineTuningDataset } from '../src/ai-engine/dataset-collector.js';
import { formatExecutionPair, convertDatasetFormat, writeDatasetJsonl, DATASET_FORMATS } from '../src/learning/dataset-builder.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function printHeader() {
  console.log('\n======================================================');
  console.log('       ⚡ TASKMAN AI: INTERACTIVE CONSOLE & HEALTH    ');
  console.log('======================================================\n');
}

async function runHealthCheck() {
  await printHeader();
  console.log('[*] Pinging Ollama local daemon...');
  const t0 = Date.now();
  const health = await checkOllamaHealth();
  const pingLatencyMs = Date.now() - t0;

  if (!health.ok) {
    console.error(`[!] Daemon Status: OFFLINE (${health.error})`);
    console.error('    Please ensure Ollama is running: `ollama serve`');
    return;
  }

  console.log(`[✓] Daemon Status: ONLINE (Version: ${health.version}, Latency: ${pingLatencyMs}ms)`);
  console.log(`[✓] Endpoint:      ${health.baseUrl}`);

  console.log('\n[*] Discovering Installed Models...');
  const modelsRes = await listOllamaModels();
  if (modelsRes.ok && modelsRes.models.length > 0) {
    console.log('------------------------------------------------------');
    console.log('  Model Name              Size (GB)     Modified');
    console.log('------------------------------------------------------');
    for (const m of modelsRes.models) {
      const sizeGb = (m.size / 1e9).toFixed(2);
      const isCustom = m.name.includes('taskman-ai');
      console.log(`  ${(m.name + (isCustom ? ' (⚡ proprietary)' : '')).padEnd(24)} ${sizeGb.padEnd(13)} ${m.modifiedAt.slice(0, 10)}`);
    }
    console.log('------------------------------------------------------');
  } else {
    console.log('    No local models found in Ollama.');
  }
}

async function runTriage(title, reward = 100, hasEscrow = true) {
  await printHeader();
  const model = process.env.OLLAMA_MODEL || 'taskman-ai:latest';
  console.log(`[*] Target Model: ${model}`);
  console.log(`[*] Evaluating:   "${title}" (Reward: $${reward}, Escrow: ${hasEscrow})`);

  const { systemPrompt, userPrompt } = buildMoneyPrompt({
    domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
    objective: 'Evaluate opportunity ROI, feasibility and safety gates',
    context: { title, rewardUsd: Number(reward), hasEscrow: Boolean(hasEscrow) }
  });

  console.log('\n[*] Running inference...');
  const t0 = Date.now();
  const res = await callOllama({
    prompt: userPrompt,
    systemPrompt,
    model,
    format: 'json',
    temperature: 0.1
  });
  const latencyMs = Date.now() - t0;

  console.log(`[✓] Inference complete in ${latencyMs}ms (${res.outputTokens} tokens emitted, ~${((res.outputTokens / latencyMs) * 1000).toFixed(1)} tok/s)`);

  const evaluation = evaluateMoneyAiOutput(MONEY_DOMAINS.OPPORTUNITY_TRIAGE, res.text);
  console.log('\n================ ECONOMIC VERDICT ====================');
  console.log(JSON.stringify(evaluation, null, 2));
  console.log('======================================================\n');
}

async function runBenchmark(iterations = 3) {
  await printHeader();
  const model = process.env.OLLAMA_MODEL || 'taskman-ai:latest';
  console.log(`[*] Benchmarking model: ${model} across ${iterations} iterations...`);

  const prompt = 'Evaluate opportunity: $100 bug bounty to fix race condition in Node.js queue.';
  const latencies = [];
  const tokenRates = [];

  for (let i = 1; i <= iterations; i++) {
    process.stdout.write(`    Iter ${i}/${iterations}... `);
    const t0 = Date.now();
    const res = await callOllama({
      prompt,
      model,
      format: 'json',
      temperature: 0.1
    });
    const dur = Date.now() - t0;
    latencies.push(dur);
    const tokSec = (res.outputTokens / dur) * 1000;
    tokenRates.push(tokSec);
    console.log(`${dur}ms (${tokSec.toFixed(1)} tok/s)`);
  }

  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const avgTokSec = (tokenRates.reduce((a, b) => a + b, 0) / tokenRates.length).toFixed(1);

  console.log('\n================ BENCHMARK RESULTS ===================');
  console.log(`  Avg Latency:    ${avgLatency}ms`);
  console.log(`  Avg Throughput: ${avgTokSec} tokens/sec`);
  console.log('======================================================\n');
}

async function runDatasetExport(format = 'alpaca', outPath = 'data/training-dataset.jsonl') {
  await printHeader();
  console.log(`[*] Exporting dataset in ${format.toUpperCase()} format to ${outPath}...`);
  const rawEntries = getDatasetEntries();
  const formatted = convertDatasetFormat(rawEntries, format);
  const res = writeDatasetJsonl(outPath, formatted);
  console.log(`[✓] Wrote ${res.count} instruction pairs to ${res.filePath}`);
}

async function main() {
  switch (command) {
    case 'health':
    case 'status':
      await runHealthCheck();
      break;
    case 'triage':
      await runTriage(args[1] || 'Bug fix in payment webhook with escrow', args[2] || 100, args[3] !== 'false');
      break;
    case 'benchmark':
      await runBenchmark(Number(args[1]) || 3);
      break;
    case 'export-dataset':
      await runDatasetExport(args[1] || 'alpaca', args[2] || 'data/training-dataset.jsonl');
      break;
    default:
      await printHeader();
      console.log('Usage: node scripts/ai-console.js <command> [options]\n');
      console.log('Commands:');
      console.log('  health                  Check Ollama daemon status & installed models');
      console.log('  triage <title> [reward] Run 5-gate economic evaluation on an opportunity');
      console.log('  benchmark [runs]        Benchmark local model inference latency & speed');
      console.log('  export-dataset [format] Export collected dataset (alpaca | sharegpt | openai)');
      console.log('\nExamples:');
      console.log('  node scripts/ai-console.js health');
      console.log('  node scripts/ai-console.js triage "Fix Redis queue bug" 150');
      console.log('  node scripts/ai-console.js benchmark 2');
      console.log('  node scripts/ai-console.js export-dataset alpaca data/sft.jsonl\n');
      break;
  }
}

main().catch(err => {
  console.error('[!] Error:', err.message);
  process.exit(1);
});
