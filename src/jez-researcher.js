import { recordResearchNote, listResearchNotes, renderResearchMirror } from './research-log.js';
import { EVIDENCE_TIER } from './evidence-tier.js';
import { writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RESEARCH_LANES = {
  'vibe-security': {
    name: 'vibe-security',
    label: 'Vibe App Security & Credential Leakage',
    systemPrompt: `You are an elite security researcher analyzing vulnerabilities in AI-generated web applications (Lovable, Bolt, v0, Cursor, Replit).
State concrete, empirical mechanisms: API route authentication bypasses, Supabase anon vs service_role confusion, missing Row Level Security (RLS) policies, client-side exposed payment keys, or Server Actions authorization failures.
Respond strictly in JSON format with two keys:
"claim": A concise, factual statement (1-2 sentences) describing a specific vulnerability pattern, detection heuristic, or verification rule.
"source": A concrete citation, technical specification, or detection heuristic (e.g. "supabase:rls-policy-check", "stripe:secret-vs-publishable-rule", "nextjs:server-action-auth-audit").`,
    inquiries: [
      'Detail the exact difference between Supabase anon JWT and service_role JWT exposure in client bundles, and how automated scanners distinguish false positives.',
      'Explain how AI coding assistants frequently fail to add authorization checks inside Next.js Server Actions, and provide an automated regex or AST check to detect this.',
      'Explain how client-side Stripe checkout implementations in vibe-coded applications allow price tampering or bypass webhook signature verification.',
      'Detail how multi-table schema dumps in Supabase trigger false-positive alerts when scanners count missing RLS per table rather than per database.'
    ]
  },
  'tally-leakage': {
    name: 'tally-leakage',
    label: 'Tally SME Accounting Leakage & Reconciliation',
    systemPrompt: `You are a forensic accountant and systems auditor specializing in Indian and global SME enterprise accounting (Tally, Zoho Books, QuickBooks).
Analyze verifiable cash leakage mechanisms: duplicate invoice settlement, round-trip credits, inventory shrinkage anomalies, and GST ITC mismatch.
Respond strictly in JSON format with two keys:
"claim": A concise, factual statement (1-2 sentences) describing a specific leakage pattern, reconciliation algorithm, or audit gate.
"source": A concrete reference (e.g. "gst:itc-gstr2b-reconciliation", "tally:duplicate-voucher-detection", "audit:invoice-window-matching").`,
    inquiries: [
      'Detail how duplicate vendor invoices slip past standard ERP approval when invoice numbers vary slightly (e.g. leading zeros, prefixes, spaces) within a 45-day window.',
      'Explain the mathematical window-matching heuristic used to identify unapplied vendor credit notes that result in double payments.',
      'Describe how GST Input Tax Credit (ITC) reconciliation mismatches between GSTR-2B and GSTR-3B create hidden liabilities for retail SMEs.',
      'Analyze the failure modes of manual bank reconciliation when credit terms and cash-discount periods collide.'
    ]
  },
  'supply-chain': {
    name: 'supply-chain',
    label: 'Open Source Supply Chain & Vulnerability Intelligence',
    systemPrompt: `You are a software supply-chain security researcher analyzing npm/PyPI malicious packages, dependency confusion, and bug bounty triage.
Respond strictly in JSON format with two keys:
"claim": A concise, factual statement (1-2 sentences) detailing a supply chain attack vector, dependency triage filter, or verification rule.
"source": A concrete reference or heuristic (e.g. "npm:lifecycle-postinstall-audit", "bounty:triage-payout-filter", "pypi:typosquat-detector").`,
    inquiries: [
      'Describe the precise heuristic used to flag malicious npm postinstall lifecycle scripts without false-positive hits on native node-gyp builds.',
      'Explain how automated bug bounty programs filter out low-severity spam submissions versus verifiable remote code execution or authentication bypasses.',
      'Analyze how dependency pinning and lockfile integrity hashes prevent compromised upstream patches from deploying into production.'
    ]
  },
  'autonomous-revenue': {
    name: 'autonomous-revenue',
    label: 'Autonomous Agent Revenue & Verifiable Settlement',
    systemPrompt: `You are a systems economist designing verifiable autonomous agent revenue architectures.
Analyze non-speculative automated services, cryptographic proof of work, micro-audit delivery rails, and value-linked contingency billing.
Respond strictly in JSON format with two keys:
"claim": A concise, factual statement (1-2 sentences) on how autonomous agents achieve verified cash settlement without optimistic assumptions.
"source": A concrete reference (e.g. "ledger:settlement-guard-rule", "billing:value-linked-contingency", "proof:work-delivery-verification").`,
    inquiries: [
      'Why must autonomous agents enforce cryptographic or bank-verified settlement references before recording revenue, rather than trusting unverified callbacks?',
      'How does a value-linked contingency billing contract structure prevent non-paying customer disputes in automated SME audits?',
      'Explain why self-serve fixed-price micro-audits ($5-$25 paywall) yield higher conversion than custom manual outreach for indie applications.'
    ]
  }
};

let laneIndex = 0;

/**
 * Execute a single research inquiry through Jez AI Gateway,
 * record the verified note in Postgres research_notes,
 * update the markdown mirror, and optionally trigger corpus distillation.
 */
export async function executeJezResearch({
  lane = null,
  customPrompt = null,
  trainAfter = false,
  fetchImpl = globalThis.fetch,
  gatewayUrl = process.env.JEZ_GATEWAY_URL || 'http://localhost:11500',
  apiKey = process.env.JEZ_API_KEY || 'jez_gUNEe2ZlsBxwmcmV9vd2mFFO9i8jjvqZ5iMzbAFF34Q',
  jezDir = resolve(process.cwd(), '../jez')
} = {}) {
  // Select research lane
  const availableLanes = Object.keys(RESEARCH_LANES);
  const selectedLaneKey = lane && RESEARCH_LANES[lane]
    ? lane
    : availableLanes[laneIndex++ % availableLanes.length];
  
  const laneConfig = RESEARCH_LANES[selectedLaneKey];
  const inquiryPrompt = customPrompt || laneConfig.inquiries[Math.floor(Math.random() * laneConfig.inquiries.length)];

  const requestPayload = {
    model: 'openai/gpt-oss-20b',
    messages: [
      { role: 'system', content: laneConfig.systemPrompt },
      { role: 'user', content: inquiryPrompt }
    ],
    temperature: 0.3,
    max_tokens: 1500
  };

  const response = await fetchImpl(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Jez Gateway call failed [${response.status}]: ${errText || response.statusText}`);
  }

  const result = await response.json();
  const rawContent = result.choices?.[0]?.message?.content || '';

  let parsed = null;
  try {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fall back to clean raw text
  }

  let claim = (parsed?.claim || parsed?.finding || parsed?.description || parsed?.rule || '').trim();
  if (!claim) {
    const cleaned = rawContent
      .replace(/```json|```/g, '')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 10 && !s.startsWith('{') && !s.startsWith('}'));
    claim = (cleaned[0] || rawContent.replace(/```json|```/g, '')).trim();
  }

  const source = (parsed?.source || `jez:ai:${result.model || 'gateway'}:${selectedLaneKey}`).trim();

  if (!claim) {
    throw new Error('Jez returned empty research claim');
  }

  // Record into research_notes table in Neon
  const note = await recordResearchNote({
    claim,
    source,
    lane: selectedLaneKey,
    tier: EVIDENCE_TIER.REFERENCED
  });

  // Sync markdown mirror
  try {
    const notes = await listResearchNotes({ limit: 100 });
    const mirrorPath = resolve(process.cwd(), 'docs/research/NOTES.md');
    await writeFile(mirrorPath, renderResearchMirror(notes), 'utf8');
  } catch (mirrorErr) {
    // Non-blocking if docs directory is not mounted or file write fails
  }

  let trainResult = null;
  if (trainAfter) {
    try {
      const { stdout } = await execFileAsync('npm', ['run', 'train'], { cwd: jezDir });
      trainResult = stdout.trim();
    } catch (trainErr) {
      trainResult = `Train failed: ${trainErr.message}`;
    }
  }

  return {
    lane: selectedLaneKey,
    claim: note.claim,
    source: note.source,
    tier: note.tier,
    noteId: note.id,
    model: result.model || 'openai/gpt-oss-20b',
    trainResult
  };
}
