async function renderOverview() {
  const [health, status, alerts, money_, pipeline] = await Promise.all([
    tryApi('/api/health'), tryApi('/api/status'), tryApi('/api/alerts'),
    tryApi('/api/money/economics'), tryApi('/api/observability/pipeline')
  ]);
  if (!health.ok && !status.ok) throw health.error || status.error;
  const h = health.data || {};
  const s = status.data || {};
  const alertList = alerts.data?.alerts || [];
  const rails = money_.data?.rails || [];
  const cleared = rails.reduce((sum, r) => sum + Number(r.clearedCents || 0), 0);
  const spend = rails.reduce((sum, r) => sum + Number(r.spendCents || 0), 0);
  const unhealthy = (s.crons || []).filter((c) => !['OK', 'DISABLED'].includes(c.status)).length;
  const lastCycle = pipeline.data?.lastSuccessAt || pipeline.data?.last_successful_cycle || s.asOf;
  const healthTone = h.status === 'OK' || s.ready === true ? 'good' : (h.status === 'DEGRADED' || s.degraded ? 'alarm' : '');
  const tiles = [
    tile('Health', h.status || s.state || (status.ok ? 'reachable' : 'down'), health.ok ? '/api/health' : '/api/status', healthTone),
    tile('Brain / status', s.autonomousBrain ? 'autonomous' : (s.healthy ? 'healthy' : s.state || 'see payload'), s.asOf ? ago(s.asOf) : 'GET /api/status'),
    tile('Usage', s.usage ? `${s.usage.inputTokens ?? s.usage.input_tokens ?? '—'} in` : 'n/a on this origin', s.usage ? `${s.usage.outputTokens ?? s.usage.output_tokens ?? '—'} out` : 'main server exposes usage on /api/status'),
    tile('Open alerts', alertList.length, alertList.length ? 'needs attention' : 'all clear', alertList.length ? 'alarm' : 'good'),
    tile('Crons unhealthy', unhealthy, `${(s.crons || []).length} monitored`, unhealthy ? 'alarm' : 'good'),
    tile('Verified revenue', money(cleared), `${money(spend)} spent · settlement only`, cleared > 0 ? 'good' : '')
  ];
  return viewShell('Station / Overview', 'Health, status, usage when published, pipeline cycle if present, and open stalls.',
    `<div class="tiles">${tiles.join('')}</div>
     <div class="sec-head"><h2>Alerts / stalls</h2></div>
     <div class="card"><table><thead><tr><th>Severity</th><th>Component</th><th>Message</th><th>Since</th></tr></thead>
     <tbody>${rows(alertList, (a) => `<tr><td>${pill(a.severity === 'CRITICAL' ? 'bad' : 'warn', a.severity)}</td><td class="k">${esc(a.component)}</td><td class="wrap-any">${esc(a.message)}</td><td>${esc(ago(a.openedAt))}</td></tr>`, 'No open alerts.', 4)}</tbody></table></div>
     <div class="sec-head"><h2>Last cycle / pipeline</h2></div>
     ${pipeline.ok ? `<div class="card pad"><pre style="white-space:pre-wrap;font-family:var(--mono);font-size:12px;color:var(--muted)">${esc(JSON.stringify(pipeline.data, null, 2).slice(0, 2400))}</pre></div>` : `<div class="state">No /api/observability/pipeline on this origin. asOf: ${esc(lastCycle || '—')}.</div>`}`);
}

async function renderLedger() {
  const [econ, finance, orders] = await Promise.all([tryApi('/api/money/economics'), tryApi('/api/finance/report'), tryApi('/api/orders')]);
  if (!econ.ok && !finance.ok) throw econ.error || finance.error;
  const rails = econ.data?.rails || finance.data?.perRail || [];
  const budget = econ.data?.globalBudget;
  const f = finance.data;
  const o = orders.data;
  const verified = rails.reduce((s, r) => s + Number(r.clearedCents || 0), 0);
  const live = rails.filter((r) => ['PROVEN', 'SCALED'].includes(r.state)).length;
  const dead = rails.filter((r) => r.state === 'DISABLED').length;
  const financeTiles = f ? [
    tile('Net position', money(f.lifetime?.netCents), f.lifetime?.marginPct == null ? 'no cleared revenue yet' : `${f.lifetime.marginPct}% margin`, f.lifetime?.netCents >= 0 ? 'good' : 'alarm'),
    tile(`Burn (${f.trailing?.days || 30}d)`, `${money(f.trailing?.burnRateCentsPerDay)}/day`, `${money(f.trailing?.spendCents)} spent`),
    tile('Runway', f.runway?.runwayDays == null ? '—' : `${f.runway.runwayDays}d`, f.runway?.note || `${money(f.runway?.remainingCents)} left`),
    tile('Next 30d net', money(f.projection?.projectedNext30DaysNetCents), 'naive linear extrapolation, not a forecast')
  ] : [tile('Finance report', finance.missing ? 'not on this origin' : 'error', finance.error?.message || '/api/finance/report')];
  const rate = o?.economics;
  const ratePill = rate ? `<span class="pill ${rate.effectiveHourlyRateCents == null ? 'off' : rate.effectiveHourlyRateCents >= 2000 ? 'ok' : 'warn'}">${rate.effectiveHourlyRateCents == null ? `${rate.orders || 0} orders · nothing cleared yet` : `${money(rate.effectiveHourlyRateCents)}/hr · ${rate.paidOrders}/${rate.orders} paid`}</span>` : '';
  return viewShell('Money / Ledger', 'Cleared cents come from settlement-verified rails. Disabled is dead. Re-enable is manual only.',
    `<div class="tiles">${tile('Verified cleared', money(verified), econ.ok ? '/api/money/economics' : 'from finance per-rail', verified > 0 ? 'good' : '')}${tile('Rails live', live, `${dead} disabled · ${rails.length} total`)}${tile('Budget', budget ? `${money(budget.spentCents)} / ${money(budget.capCents)}` : '—', budget?.exceeded ? 'cap exceeded' : 'this month', budget?.exceeded ? 'alarm' : '')}</div>
     <div class="sec-head"><h2>Revenue rails</h2>${budget ? `<span class="pill ${budget.exceeded ? 'bad' : 'off'}">budget ${money(budget.spentCents)} / ${money(budget.capCents)}</span>` : ''}</div>
     <div class="card"><table><thead><tr><th>Rail</th><th>State</th><th>Liveness</th><th class="n">Attempts</th><th class="n">Spend</th><th class="n">Cleared</th><th class="n">Net</th><th class="n">ROI</th><th></th></tr></thead>
     <tbody>${rows(rails, (r) => `<tr><td class="k">${esc(r.rail)}</td><td>${pill(RAIL_TONE[r.state] || 'warn', r.state || 'PROBATION')}</td><td>${pill(r.state === 'DISABLED' ? 'bad' : ['PROVEN', 'SCALED'].includes(r.state) ? 'ok' : 'warn', RAIL_LIVE[r.state] || 'unknown')}</td><td class="n">${esc(r.attempts ?? '—')}</td><td class="n">${money(r.spendCents)}</td><td class="n">${money(r.clearedCents)}</td><td class="n">${money(r.netCents)}</td><td class="n">${r.roi == null ? '—' : esc(r.roi)}</td><td>${r.state === 'DISABLED' ? `<button class="mini" data-rail-reenable="${esc(r.rail)}">re-enable</button>` : ''}</td></tr>`, 'No rails yet. Revenue is zero until a settlement clears.', 9)}</tbody></table></div>
     <div class="sec-head"><h2>Finance</h2></div><div class="tiles">${financeTiles.join('')}</div>
     <div class="sec-head"><h2>Gig / Fiverr orders</h2>${ratePill}</div>
     <div class="card pad"><div class="form-grid"><input id="order-id" placeholder="Fiverr order ID"><input id="order-price" placeholder="Price $"><input id="order-minutes" placeholder="Minutes"><input id="order-notes" placeholder="Notes"><button id="order-add" class="primary" type="button">Log order</button></div></div>
     <div class="card"><table><thead><tr><th>Order</th><th>Status</th><th class="n">Price</th><th class="n">Min</th><th class="n">Payout</th><th></th></tr></thead>
     <tbody>${rows(o?.orders, (ord) => `<tr><td class="k">${esc(ord.orderId)}</td><td>${pill(ord.orderStatus === 'PAID' ? 'ok' : ord.orderStatus === 'CANCELLED' ? 'bad' : 'warn', ord.orderStatus)}</td><td class="n">${money(ord.priceCents)}</td><td class="n">${esc(ord.minutesSpent)}</td><td class="n">${ord.payout ? money(ord.payout.netCents) : '—'}</td><td>${ord.payout ? '' : `<button class="mini" data-order-payout="${esc(ord.orderId)}">mark paid</button>`}</td></tr>`, orders.ok ? 'No orders logged yet.' : (orders.missing ? 'GET /api/orders not on this origin.' : orders.error.message), 6)}</tbody></table></div>`);
}
