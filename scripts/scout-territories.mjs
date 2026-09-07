#!/usr/bin/env node
/**
 * Runs one territory-discovery pass. The discovery brain is a model: if
 * ANTHROPIC_API_KEY is set it calls the API with the territory-scout skill and
 * the registry, then scores and dedupes what comes back. If no key is set it
 * does NOT invent territories — it prints how to enable the brain and exits
 * clean, because a scout with no brain has nothing honest to say.
 *
 * Candidates (from the model, or piped in via --from-file for the in-session
 * brain) are always run through the deterministic gate here: novelty against
 * the registry, then scoring against the operator's constraints. That gate is
 * the same whoever generated the ideas, so the ranking cannot be talked up.
 *
 * Read-only: prints a ranked shortlist. Submits, sends and spends nothing.
 */
import { readFile } from 'node:fs/promises';
import { EXPLORED_TERRITORIES, isNovel } from '../packages/core/territory/registry.js';
import { rankTerritories } from '../packages/core/territory/scoring.js';

async function loadCandidates() {
  const fileArg = process.argv.indexOf('--from-file');
  if (fileArg !== -1 && process.argv[fileArg + 1]) {
    return JSON.parse(await readFile(process.argv[fileArg + 1], 'utf8'));
  }
  if (!process.env.ANTHROPIC_API_KEY) return null; // no brain available
  const skill = await readFile(new URL('../.claude/skills/territory-scout/SKILL.md', import.meta.url), 'utf8');
  const prompt = `${skill}\n\nAlready explored (do not repeat, killed lanes are off-limits even renamed):\n`
    + EXPLORED_TERRITORIES.map((t) => `- ${t.key} [${t.verdict}]: ${t.note}`).join('\n')
    + `\n\nReturn ONLY a JSON array of up to 8 candidate territories, each: `
    + `{"title","mechanism","buyer","pain","rail","cheapestExperiment","aliases":[],`
    + `"scores":{"timeToFirstDollar","railFitIndia","feasibilityWithAssets","saturation","distribution"}}. `
    + `Use only the allowed labels for each score.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.SCOUT_MODEL || 'claude-opus-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  return JSON.parse(json);
}

const raw = await loadCandidates();
if (raw === null) {
  console.log('Territory Scout: no discovery brain available.');
  console.log('Set ANTHROPIC_API_KEY (repo secret) to let the cron generate territories,');
  console.log('or run the territory-scout skill in a Claude session and pipe results with --from-file.');
  process.exit(0);
}

const novel = raw.filter(isNovel);
const ranked = rankTerritories(novel);
console.log(`Territory Scout: ${raw.length} candidate(s), ${novel.length} novel, ${ranked.length} above floor.\n`);
for (const t of ranked) {
  console.log(`■ ${t.score}  ${t.title}${t.capped ? '  (capped: rail/KYC)' : ''}`);
  console.log(`    mechanism: ${t.mechanism}`);
  console.log(`    buyer/pain: ${t.buyer} — ${t.pain}`);
  console.log(`    rail: ${t.rail}`);
  console.log(`    cheapest test: ${t.cheapestExperiment}\n`);
}
if (!ranked.length) console.log('Nothing genuinely new cleared the bar this run. That is an honest result, not a failure.');
