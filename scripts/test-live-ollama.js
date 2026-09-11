import { checkOllamaHealth, listOllamaModels, callOllama } from '../src/adapters/ollama-adapter.js';
import { MONEY_DOMAINS, buildMoneyPrompt, evaluateMoneyAiOutput } from '../src/ai-engine/money-making-agent.js';
import { recordDatasetEntry, getDatasetEntries, exportFineTuningDataset } from '../src/ai-engine/dataset-collector.js';

async function main() {
  console.log('=== 1. Checking Ollama Local Daemon Health ===');
  const health = await checkOllamaHealth();
  console.log('Health status:', health);

  if (!health.ok) {
    console.error('Ollama is not responding. Please make sure `ollama serve` is running.');
    process.exit(1);
  }

  console.log('\n=== 2. Discovering Available Local Models ===');
  const modelList = await listOllamaModels();
  console.log('Installed models:', modelList.models.map(m => m.name));

  const targetModel = modelList.models.find(m => m.name.includes('llama3.2') || m.name.includes('mistral') || m.name.includes('hermes3'))?.name || modelList.models[0]?.name;
  console.log(`\nSelected target model for live inference: "${targetModel}"`);

  // Scenario 1: Opportunity Triage
  console.log('\n=== 3. Scenario A: Evaluating Algora $50 Bounty Opportunity ===');
  const bountyOpportunity = {
    platform: 'Algora',
    repo: 'acme/analytics-dashboard',
    issueNumber: 42,
    title: 'Fix CSV export timestamp timezone offset',
    rewardUsd: 50,
    hasEscrow: true,
    description: 'When users in UTC+5:30 export CSV reports, the date string displays UTC instead of localized ISO time. Need unit test and fix in src/exporter.ts.'
  };

  const { systemPrompt: sPrompt1, userPrompt: uPrompt1 } = buildMoneyPrompt({
    domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
    objective: 'Evaluate if this bounty is worth executing with low risk and positive ROI',
    context: bountyOpportunity
  });

  console.log('Sending prompt to local LLM via Ollama...');
  const t0 = Date.now();
  const triageResult = await callOllama({
    prompt: uPrompt1,
    systemPrompt: sPrompt1,
    model: targetModel,
    format: 'json',
    temperature: 0.1
  });
  const durationMs = Date.now() - t0;

  console.log(`Response received in ${durationMs}ms (${triageResult.outputTokens} tokens):`);
  console.log(triageResult.text);

  const evaluation1 = evaluateMoneyAiOutput(MONEY_DOMAINS.OPPORTUNITY_TRIAGE, triageResult.text);
  console.log('\nParsed Economic Verdict:');
  console.dir(evaluation1, { depth: null });

  // Record to continuous learning dataset
  recordDatasetEntry({
    domain: MONEY_DOMAINS.OPPORTUNITY_TRIAGE,
    systemPrompt: sPrompt1,
    prompt: uPrompt1,
    response: triageResult.text,
    outcomeScore: evaluation1.ok ? 0.95 : 0.5,
    metadata: { model: targetModel, durationMs }
  });

  // Scenario 2: Fee Leakage & Reconciliation Audit
  console.log('\n=== 4. Scenario B: Marketplace Fee Leakage Audit ===');
  const transactionsContext = {
    platform: 'Marketplace X',
    period: '2026-08-01 to 2026-08-31',
    contractedTakeRate: '15.0%',
    transactions: [
      { id: 'tx-101', grossUsd: 100.00, feeChargedUsd: 15.00, netPayoutUsd: 85.00 },
      { id: 'tx-102', grossUsd: 250.00, feeChargedUsd: 42.50, netPayoutUsd: 207.50 }, // 17% fee instead of 15% (leakage $5.00)
      { id: 'tx-103', grossUsd: 50.00, feeChargedUsd: 7.50, netPayoutUsd: 42.50 },
      { id: 'tx-104', grossUsd: 400.00, feeChargedUsd: 68.00, netPayoutUsd: 332.00 }  // 17% fee instead of 15% (leakage $8.00)
    ]
  };

  const { systemPrompt: sPrompt2, userPrompt: uPrompt2 } = buildMoneyPrompt({
    domain: MONEY_DOMAINS.FEE_LEAKAGE_AUDIT,
    objective: 'Identify fee overcharges beyond the agreed 15% contract rate',
    context: transactionsContext
  });

  console.log('Sending audit prompt to local LLM...');
  const t1 = Date.now();
  const auditResult = await callOllama({
    prompt: uPrompt2,
    systemPrompt: sPrompt2,
    model: targetModel,
    format: 'json',
    temperature: 0.1
  });
  const durationAuditMs = Date.now() - t1;

  console.log(`Audit response received in ${durationAuditMs}ms (${auditResult.outputTokens} tokens):`);
  console.log(auditResult.text);

  const evaluation2 = evaluateMoneyAiOutput(MONEY_DOMAINS.FEE_LEAKAGE_AUDIT, auditResult.text);
  console.log('\nParsed Audit Deliverable:');
  console.dir(evaluation2, { depth: null });

  // Record to learning dataset
  recordDatasetEntry({
    domain: MONEY_DOMAINS.FEE_LEAKAGE_AUDIT,
    systemPrompt: sPrompt2,
    prompt: uPrompt2,
    response: auditResult.text,
    outcomeScore: evaluation2.ok ? 1.0 : 0.4,
    metadata: { model: targetModel, durationMs: durationAuditMs }
  });

  console.log('\n=== 5. Dataset Collector Summary ===');
  const allEntries = getDatasetEntries();
  console.log(`Total training pairs accumulated: ${allEntries.length}`);

  const alpacaExport = exportFineTuningDataset({ format: 'alpaca' });
  console.log('Sample Alpaca format for fine-tuning:\n', JSON.stringify(alpacaExport[0], null, 2));

  console.log('\nAll tests completed successfully!');
}

main().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
