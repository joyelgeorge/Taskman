const DEFAULT_BASE_URL = 'https://api.moltjobs.io';

export function parseMoltJobsWebhook(body) {
  if (!body || typeof body !== 'object') throw new Error('webhook body must be an object');
  if (typeof body.event !== 'string' || !body.event.trim()) throw new Error('webhook event is required');
  if (!Object.prototype.hasOwnProperty.call(body, 'data')) throw new Error('webhook data is required');
  return { event: body.event, data: body.data };
}

export async function sendMoltJobsHeartbeat({ jobId, progress, apiKey = process.env.MOLTJOBS_API_KEY, baseUrl = process.env.MOLTJOBS_BASE_URL || DEFAULT_BASE_URL, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('MOLTJOBS_API_KEY is required');
  if (!jobId || !String(jobId).trim()) throw new Error('assigned jobId is required');
  if (!progress || !String(progress).trim()) throw new Error('progress is required');

  const response = await fetchImpl(`${baseUrl}/heartbeat`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jobId, progress })
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
