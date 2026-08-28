import { parseMoltJobsWebhook, sendMoltJobsHeartbeat } from './moltjobs-client.js';

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export async function handleMoltJobsRequest(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/webhooks/moltjobs') {
    const envelope = parseMoltJobsWebhook(await readJson(req));
    // A webhook is inbound information only. It must never be treated as an
    // assigned job or as authority to emit a heartbeat/claim/submission.
    console.log('MoltJobs webhook', { event: envelope.event, data: envelope.data });
    sendJson(res, 202, { ok: true, event: envelope.event });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/moltjobs/heartbeat') {
    const body = await readJson(req);
    try {
      const result = await sendMoltJobsHeartbeat({
        jobId: body.jobId,
        progress: body.progress
      });
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      const blocked = /MOLTJOBS_API_KEY|jobId/.test(String(error?.message || error));
      sendJson(res, blocked ? 409 : (error.status || 502), {
        ok: false,
        blocked,
        error: String(error?.message || error)
      });
    }
    return true;
  }

  return false;
}
