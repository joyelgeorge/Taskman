import {
  upsertRevenueRecord, listRevenueRecords, claimRevenueRecords,
  updateRevenueRecord, setRevenueState, getRevenueState, revenueStorageMode
} from './revenue-store.js';
import {
  CANONICAL_QUEUES, LEGACY_QUEUE_ALIASES, DISCOVERY_SOURCES,
  QUALIFICATION_PROFILES, capabilitySnapshot, resolveQueueName
} from './orchestration-profiles.js';
import { normalizeCandidate, qualifyCandidate, missingCapabilities } from './qualification-engine.js';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
  return true;
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export async function handleRevenueRequest(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/revenue/status') {
    return send(res, 200, {
      storage: revenueStorageMode(),
      pipeline: ['DISCOVER', 'VALIDATE', 'EXECUTE', 'LEARN'],
      canonicalQueues: CANONICAL_QUEUES,
      legacyAliases: LEGACY_QUEUE_ALIASES,
      queues: [
        ...Object.values(CANONICAL_QUEUES),
        'revenue_exploration_queue','revenue_execution_results','revenue_recent_scan',
        'revenue_prediction_research','revenue_model_inference','revenue_opportunity_deepdives','revenue_scan_inference'
      ]
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/orchestration/config') {
    return send(res, 200, {
      pipeline: ['DISCOVER', 'VALIDATE', 'EXECUTE', 'LEARN'],
      queues: CANONICAL_QUEUES,
      legacyAliases: LEGACY_QUEUE_ALIASES,
      discoverySources: DISCOVERY_SOURCES,
      qualificationProfiles: QUALIFICATION_PROFILES
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/capabilities') {
    return send(res, 200, capabilitySnapshot());
  }

  if (req.method === 'POST' && url.pathname === '/api/qualification') {
    const input = await body(req);
    const candidate = normalizeCandidate(input.candidate || input);
    const profile = input.profile || candidate.profile || 'programmable_money_flow_v1';
    const capabilities = capabilitySnapshot(input.capabilities || {});
    return send(res, 200, {
      candidate,
      qualification: qualifyCandidate(candidate, profile),
      missingCapabilities: missingCapabilities(candidate, capabilities)
    });
  }

  const list = url.pathname.match(/^\/api\/revenue\/queues\/([^/]+)$/);
  if (req.method === 'GET' && list) {
    const queueName = resolveQueueName(decodeURIComponent(list[1]));
    return send(res, 200, await listRevenueRecords(queueName, {
      status: url.searchParams.get('status') || undefined,
      limit: url.searchParams.get('limit') || 100
    }));
  }
  if (req.method === 'POST' && list) {
    const input = await body(req);
    const records = Array.isArray(input) ? input : [input];
    const output = [];
    const queueName = resolveQueueName(decodeURIComponent(list[1]));
    for (const record of records) output.push(await upsertRevenueRecord({ ...record, queue: queueName }));
    return send(res, 201, Array.isArray(input) ? output : output[0]);
  }

  const claim = url.pathname.match(/^\/api\/revenue\/queues\/([^/]+)\/claim$/);
  if (req.method === 'POST' && claim) {
    const input = await body(req);
    const queueName = resolveQueueName(decodeURIComponent(claim[1]));
    return send(res, 200, await claimRevenueRecords(queueName, {
      limit: input.limit || 10,
      claimedBy: input.claimedBy || 'taskman-worker'
    }));
  }

  const record = url.pathname.match(/^\/api\/revenue\/records\/([^/]+)$/);
  if (req.method === 'PATCH' && record) {
    const updated = await updateRevenueRecord(record[1], await body(req));
    return updated ? send(res, 200, updated) : send(res, 404, { error: 'record not found' });
  }

  const state = url.pathname.match(/^\/api\/revenue\/state\/([^/]+)$/);
  if (req.method === 'GET' && state) return send(res, 200, { key: state[1], value: await getRevenueState(state[1]) });
  if (req.method === 'PUT' && state) {
    const input = await body(req);
    return send(res, 200, await setRevenueState(state[1], input.value ?? input));
  }
  return false;
}
