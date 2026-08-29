import {
  upsertRevenueRecord, listRevenueRecords, claimRevenueRecords,
  updateRevenueRecord, setRevenueState, getRevenueState, revenueStorageMode
} from './revenue-store.js';

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export async function handleRevenueRequest(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/revenue/status') {
    return send(res, 200, { storage: revenueStorageMode(), queues: [
      'revenue_exploration_queue','revenue_execution_results','revenue_recent_scan',
      'revenue_prediction_research','revenue_model_inference','revenue_opportunity_deepdives','revenue_scan_inference'
    ] });
  }

  const list = url.pathname.match(/^\/api\/revenue\/queues\/([^/]+)$/);
  if (req.method === 'GET' && list) {
    return send(res, 200, await listRevenueRecords(decodeURIComponent(list[1]), {
      status: url.searchParams.get('status') || undefined,
      limit: url.searchParams.get('limit') || 100
    }));
  }
  if (req.method === 'POST' && list) {
    const input = await body(req);
    const records = Array.isArray(input) ? input : [input];
    const output = [];
    for (const record of records) output.push(await upsertRevenueRecord({ ...record, queue: decodeURIComponent(list[1]) }));
    return send(res, 201, Array.isArray(input) ? output : output[0]);
  }

  const claim = url.pathname.match(/^\/api\/revenue\/queues\/([^/]+)\/claim$/);
  if (req.method === 'POST' && claim) {
    const input = await body(req);
    return send(res, 200, await claimRevenueRecords(decodeURIComponent(claim[1]), {
      limit: input.limit || 10,
      claimedBy: input.claimedBy || 'taskman-explorer'
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
