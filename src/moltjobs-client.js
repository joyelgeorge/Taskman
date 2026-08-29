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
