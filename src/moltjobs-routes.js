import { parseMoltJobsWebhook, sendMoltJobsHeartbeat } from './moltjobs-client.js';
import {
  WebhookIngressError,
  readRawWebhookBody,
  verifyWebhookRequest,
  recordWebhookReceipt
} from './webhook-ingress.js';

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
    try {
      const rawBody = await readRawWebhookBody(req);
      const verification = verifyWebhookRequest({
        rawBody,
        signature: req.headers['x-moltjobs-signature'],
        timestamp: req.headers['x-moltjobs-timestamp'],
        deliveryId: req.headers['x-moltjobs-delivery-id'],
        secrets: [
          process.env.MOLTJOBS_WEBHOOK_SECRET,
          process.env.MOLTJOBS_WEBHOOK_SECRET_PREVIOUS
        ]
      });

      let parsed;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new WebhookIngressError('WEBHOOK_JSON_INVALID');
      }
      const envelope = parseMoltJobsWebhook(parsed);
      const allowedEvents = new Set(
        String(process.env.MOLTJOBS_WEBHOOK_EVENTS || 'message.created')
          .split(',').map(value => value.trim()).filter(Boolean)
      );
      if (!allowedEvents.has(envelope.event)) {
        throw new WebhookIngressError('WEBHOOK_EVENT_NOT_ALLOWED');
      }
      if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) {
        throw new WebhookIngressError('WEBHOOK_EVENT_SCHEMA_INVALID');
      }

      const receipt = await recordWebhookReceipt({
        provider: 'moltjobs',
        deliveryId: verification.deliveryId,
        eventType: envelope.event,
        bodyHash: verification.bodyHash,
        verificationMethod: verification.verificationMethod
      });

      // This is transport-authenticated inbound information only. The shared
      // ingress secret is not provider attestation and grants no authority to
      // claim work, submit results, or record a money event.
      console.log('MoltJobs webhook receipt', {
        deliveryId: verification.deliveryId,
        event: envelope.event,
        duplicate: receipt.duplicate,
        verification: verification.verificationMethod,
        authoritative: false
      });
      sendJson(res, receipt.duplicate ? 200 : 202, {
        ok: true,
        event: envelope.event,
        deliveryId: verification.deliveryId,
        duplicate: receipt.duplicate,
        authoritative: false
      });
    } catch (error) {
      const status = error instanceof WebhookIngressError ? error.status : 400;
      const code = error instanceof WebhookIngressError
        ? error.code
        : (error instanceof SyntaxError ? 'WEBHOOK_ENVELOPE_INVALID' : 'WEBHOOK_REJECTED');
      sendJson(res, status, { ok: false, error: code });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/moltjobs/heartbeat') {
    const body = await readJson(req);
    try {
      const result = await sendMoltJobsHeartbeat({
        agentId: body.agentId,
        jobId: body.jobId,
        statusReport: body.statusReport || body.progress,
        runtimeMetadata: body.runtimeMetadata
      });
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      const blocked = /MOLTJOBS_API_KEY|agentId|jobId/.test(String(error?.message || error));
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
