#!/usr/bin/env node
/**
 * `npm run jez-research` — Executes autonomous intelligence research through
 * Jez AI Gateway, writes findings into Neon research_notes, and updates Jez's training corpus.
 *
 * Usage:
 *   npm run jez-research                           # Single research pass
 *   npm run jez-research -- --lane vibe-security   # Specific lane
 *   npm run jez-research -- --train                # Also distill corpus & update local model
 *   npm run jez-research -- --continuous           # Intermittent research runner loop
 *   npm run jez-research -- --interval 30          # Interval in minutes for continuous runner
 */
import { readFlag, hasFlag } from '../src/cli-flags.js';
import { executeJezResearch, RESEARCH_LANES } from '../src/jez-researcher.js';

const argv = process.argv.slice(2);
const lane = readFlag(argv, 'lane');
const customPrompt = readFlag(argv, 'prompt');
const trainAfter = hasFlag(argv, 'train') || true; // Default train to keep model updated
const continuous = hasFlag(argv, 'continuous');
const intervalMin = parseInt(readFlag(argv, 'interval') || '30', 10);

async function runOnce() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] Jez Research: Initiating inquiry...`);

  try {
    const outcome = await executeJezResearch({
      lane,
      customPrompt,
      trainAfter
    });

    console.log(`\n✓ [${outcome.lane}] Research Note Persisted (id: ${outcome.noteId})`);
    console.log(`  Tier:    ${outcome.tier}`);
    console.log(`  Source:  ${outcome.source}`);
    console.log(`  Model:   ${outcome.model}`);
    console.log(`  Claim:   ${outcome.claim}\n`);

    if (outcome.trainResult) {
      console.log('Distillation Summary:');
      console.log(outcome.trainResult.split('\n').slice(-5).join('\n'));
    }

    return outcome;
  } catch (err) {
    console.error(`✗ Jez Research Error: ${err.message}`);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 3).join('\n'));
    throw err;
  }
}

if (!continuous) {
  try {
    await runOnce();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

// Continuous Intermittent Mode
console.log(`Starting Jez Intermittent Research Runner (Interval: every ${intervalMin}m)...`);
console.log('Registered research lanes:', Object.keys(RESEARCH_LANES).join(', '));
console.log('Press Ctrl-C to stop.\n');

await runOnce().catch(() => {});

const intervalMs = intervalMin * 60 * 1000;
const timer = setInterval(async () => {
  await runOnce().catch(() => {});
}, intervalMs);

process.on('SIGINT', () => {
  clearInterval(timer);
  console.log('\nJez Intermittent Research Runner halted.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(timer);
  console.log('\nJez Intermittent Research Runner terminated.');
  process.exit(0);
});
