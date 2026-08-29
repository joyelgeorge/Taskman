const DEFAULT_BASE_URL = 'https://api.moltjobs.io/v1';

export function parseMoltJobsWebhook(body) {
  if (!body || typeof body !== 'object') throw new Error('webhook body must be an object');
  if (typeof body.event !== 'string' || !body.event.trim()) throw new Error('webhook event is required');
  if (!Object.prototype.hasOwnProperty.call(body, 'data')) throw new Error('webhook data is required');
  return { event: body.event, data: body.data };
}

export async function sendMoltJobsHeartbeat({
  agentId,
  jobId,
  progress,
  statusReport = progress,
  runtimeMetadata,
  apiKey = process.env.MOLTJOBS_API_KEY,
  baseUrl = process.env.MOLTJOBS_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error('MOLTJOBS_API_KEY is required');
  if (!agentId || !String(agentId).trim()) throw new Error('agentId is required');
  if (!jobId || !String(jobId).trim()) throw new Error('assigned jobId is required');
  if (!statusReport || !String(statusReport).trim()) throw new Error('statusReport is required');

  const payload = {
    jobId: String(jobId).trim(),
    statusReport: String(statusReport).trim()
  };
  if (runtimeMetadata !== undefined) payload.runtimeMetadata = runtimeMetadata;

  const root = baseUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${root}/agents/${encodeURIComponent(String(agentId).trim())}/heartbeat`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error(`MoltJobs heartbeat failed: HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export async function getAgentIdentity({
  apiKey = process.env.MOLTJOBS_API_KEY,
  baseUrl = process.env.MOLTJOBS_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('MOLTJOBS_API_KEY is required');
  const root = baseUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${root}/agents/me`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey, 'accept': 'application/json' }
  });
  if (!response.ok) throw new Error(`MoltJobs identity check failed: HTTP ${response.status}`);
  const data = await response.json();
  // Return non-secret identity fields only
  return {
    id: data.id || data.agent_id || null,
    name: data.name || data.agent_name || null,
    status: data.status || 'ACTIVE',
    reputation: data.reputation ?? null,
    verified: Boolean(data.verified)
  };
}

export async function listOpenJobs({
  apiKey = process.env.MOLTJOBS_API_KEY,
  baseUrl = process.env.MOLTJOBS_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error('MOLTJOBS_API_KEY is required');
  const root = baseUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${root}/jobs?status=open`, {
    method: 'GET',
    headers: { 'X-Api-Key': apiKey, 'accept': 'application/json' }
  });
  if (!response.ok) throw new Error(`MoltJobs list jobs failed: HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : (data.jobs || []);
}

export function evaluateJobExecutionGate(job = {}) {
  const payerVerified = Boolean(job.escrow_funded ?? job.escrowFunded ?? job.payer_verified);
  const taskOpen = ['open', 'available', 'active'].includes(String(job.status || '').toLowerCase());
  const acceptanceCriteriaClear = Boolean(job.acceptance_criteria || job.acceptanceCriteria || job.description);
  const deliveryPathAccessible = true;
  const noContradictions = !job.blocked && !job.do_not_claim;
  const payoutPathWorks = Boolean(job.payout_method || (job.escrow_funded ?? job.escrowFunded));
  const zeroUpfrontSpend = Number(job.worker_cost || job.upfront_cost || 0) === 0;
  const noUnsupportedSigning = job.requires_wallet_signature !== true && job.requires_gas !== true;
  const noRecurringManualStep = job.requires_call !== true && job.requires_manual_presence !== true;
  const completeDeliverableProducible = Boolean(job.deliverable_schema || job.title || job.name);

  const allPassed = payerVerified && taskOpen && acceptanceCriteriaClear && deliveryPathAccessible &&
                    noContradictions && payoutPathWorks && zeroUpfrontSpend && noUnsupportedSigning &&
                    noRecurringManualStep && completeDeliverableProducible;

  let classification = 'REJECTED';
  let reason = 'Failed execution chain hard gates';

  if (allPassed) {
    classification = 'EXECUTABLE';
    reason = 'All execution chain hard gates passed with verified payout and acceptance criteria';
  } else if (!payerVerified || !payoutPathWorks) {
    classification = 'WATCH';
    reason = 'Unverified payer or unconfirmed escrow/payout path';
  } else if (!acceptanceCriteriaClear || !completeDeliverableProducible) {
    classification = 'SETUP-CANDIDATE';
    reason = 'Missing clear acceptance criteria or deliverable definition requires setup';
  }

  return {
    passed: allPassed,
    classification,
    reason,
    gates: {
      payerVerified,
      taskOpen,
      acceptanceCriteriaClear,
      deliveryPathAccessible,
      noContradictions,
      payoutPathWorks,
      zeroUpfrontSpend,
      noUnsupportedSigning,
      noRecurringManualStep,
      completeDeliverableProducible
    }
  };
}

