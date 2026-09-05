/* Taskman control UI. Static, stateless, and hosted apart from the API it reads. */

const DEFAULT_API = 'http://127.0.0.1:3100';
const $ = id => document.getElementById(id);
const store = {
  get base() { try { return localStorage.getItem('taskman.api') || ''; } catch { return ''; } },
  set base(v) { try { localStorage.setItem('taskman.api', v); } catch {} },
  get token() { try { return localStorage.getItem('taskman.token') || ''; } catch { return ''; } },
  set token(v) { try { localStorage.setItem('taskman.token', v); } catch {} }
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;

function ago(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function duration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

const CRON_TONE = { OK: 'ok', DISABLED: 'off', FAILING: 'warn', OVERDUE: 'bad', STUCK: 'bad' };

function isLocalHost() {
  return ['127.0.0.1', 'localhost'].includes(location.hostname);
}

function connectBase() {
  const typed = ($('api-base')?.value || '').trim();
  const fallback = isLocalHost() ? DEFAULT_API : store.base;
  const base = (typed || fallback || DEFAULT_API).replace(/\/$/, '');
  store.base = base;
  if ($('api-base')) $('api-base').value = base;
  store.token = ($('api-token')?.value || '').trim();
  return base;
}

async function api(path, { method = 'GET', body } = {}) {
  const base = (store.base || DEFAULT_API).replace(/\/$/, '');
  if (!base) throw new Error('No API base URL set.');
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (store.token) headers.authorization = `Bearer ${store.token}`;

  const local = isLocalHost();
  const url = local ? `/__proxy${path}` : `${base}${path}`;
  if (local) headers['x-taskman-base'] = base;

  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

  if (response.status === 502 && payload?.error === 'proxy_failed') {
    throw new Error(`${payload.message || 'proxy failed'} — is ${base} running? Start packages/api with npm run api (:3100) or src/server.js (:3000).`);
  }

  if (!response.ok && response.status !== 503) {
    throw new Error(payload?.error || payload?.message || `HTTP ${response.status} from ${path}`);
  }
  return payload;
}

function rows(tbodyId, items, render, emptyText, columns) {
  const tbody = $(tbodyId);
  tbody.innerHTML = items.length
    ? items.map(render).join('')
    : `<tr><td colspan="${columns}" class="empty">${esc(emptyText)}</td></tr>`;
}

function renderTiles({ status, alerts, rails, signals }) {
  const cleared = rails.reduce((sum, r) => sum + r.clearedCents, 0);
  const spend = rails.reduce((sum, r) => sum + r.spendCents, 0);
  const openAlerts = alerts.length;
  const unhealthy = (status.crons || []).filter(c => !['OK', 'DISABLED'].includes(c.status)).length;

  const tiles = [
    { label: 'Signals collected', value: signals.total ?? 0, sub: `${signals.byStatus?.NEW || 0} awaiting processing` },
    { label: 'Drones', value: `${status.drones.enabled}/${status.drones.total}`, sub: 'enabled / total' },
    { label: 'Crons unhealthy', value: unhealthy, sub: `${(status.crons || []).length} monitored`, tone: unhealthy ? 'alarm' : 'good' },
    { label: 'Open alerts', value: openAlerts, sub: openAlerts ? 'needs attention' : 'all clear', tone: openAlerts ? 'alarm' : 'good' },
    { label: 'Verified revenue', value: money(cleared), sub: `${money(spend)} spent`, tone: cleared > 0 ? 'good' : '' }
  ];

  $('tiles').innerHTML = tiles.map(t => `
    <div class="tile ${t.tone || ''}">
      <div class="label">${esc(t.label)}</div>
      <div class="value">${esc(t.value)}</div>
      <div class="sub">${esc(t.sub)}</div>
    </div>`).join('');
}

const RAIL_TONE = { PROBATION: 'warn', PROVEN: 'ok', SCALED: 'ok', DISABLED: 'bad' };

function renderGlobalBudget(budget) {
  const el = $('global-budget');
  if (!budget) { el.textContent = ''; return; }
  el.className = `pill ${budget.exceeded ? 'bad' : 'off'}`;
  el.textContent = `budget ${money(budget.spentCents)} / ${money(budget.capCents)} this month`;
}

async function load() {
  $('error').hidden = true;
  connectBase();
  try {
    const [status, crons, drones, alerts, money_, improvements, signals, scans, finance, orders] = await Promise.all([
      api('/api/status'), api('/api/crons'), api('/api/drones'), api('/api/alerts'),
      api('/api/money/economics'), api('/api/improvements'), api('/api/signals?limit=25'), api('/api/scans'),
      api('/api/finance/report'), api('/api/orders')
    ]);

    renderTiles({ status, alerts: alerts.alerts, rails: money_.rails, signals: signals.stats });
    renderGlobalBudget(money_.globalBudget);

    rows('crons', crons.crons, c => `
      <tr>
        <td class="k">${esc(c.cronName)}</td>
        <td class="k">${esc(c.schedule)}</td>
        <td><span class="pill ${CRON_TONE[c.status] || 'warn'}">${esc(c.status)}</span></td>
        <td>${esc(ago(c.lastRunAt))}</td>
        <td class="n">${esc(duration(c.silentSeconds))}</td>
        <td><button class="mini" data-cron="${esc(c.cronName)}">run now</button></td>
      </tr>`, 'No crons registered — run one to register it.', 6);

    rows('drones', drones.drones, d => {
      const quarantined = d.quarantinedUntil && new Date(d.quarantinedUntil) > new Date();
      const tone = !d.enabled ? 'off' : quarantined ? 'bad' : d.consecutiveFailures ? 'warn' : 'ok';
      const label = !d.enabled ? 'DISABLED' : quarantined ? 'QUARANTINED' : d.consecutiveFailures ? 'DEGRADED' : 'OK';
      return `
      <tr class="${d.enabled ? '' : 'dim'}">
        <td class="k">${esc(d.id)}</td>
        <td class="k">${esc(d.kind)}</td>
        <td><span class="pill ${tone}">${label}</span></td>
        <td>${esc(ago(d.lastOkAt))}</td>
        <td class="n">${d.consecutiveFailures}</td>
        <td><div class="row-actions">
          <button class="mini" data-drone-run="${esc(d.id)}">fly</button>
          <button class="mini" data-drone-toggle="${esc(d.id)}" data-enabled="${d.enabled}">${d.enabled ? 'disable' : 'enable'}</button>
        </div></td>
      </tr>`;
    }, 'No drones registered — run drone-dispatch to seed the default fleet.', 6);

    rows('alerts', alerts.alerts, a => `
      <tr>
        <td><span class="pill ${a.severity === 'CRITICAL' ? 'bad' : 'warn'}">${esc(a.severity)}</span></td>
        <td class="k">${esc(a.component)}</td>
        <td class="wrap-any">${esc(a.message)}</td>
        <td>${esc(ago(a.openedAt))}</td>
      </tr>`, 'No open alerts.', 4);

    rows('rails', money_.rails, r => `
      <tr>
        <td class="k">${esc(r.rail)}</td>
        <td><span class="pill ${RAIL_TONE[r.state] || 'warn'}">${esc(r.state || 'PROBATION')}</span></td>
        <td class="n">${r.attempts}</td>
        <td class="n">${money(r.spendCents)}</td>
        <td class="n">${money(r.clearedCents)}</td>
        <td class="n">${money(r.netCents)}</td>
        <td class="n">${r.roi == null ? '—' : r.roi}</td>
        <td>${r.state === 'DISABLED' ? `<button class="mini" data-rail-reenable="${esc(r.rail)}">re-enable</button>` : ''}</td>
      </tr>`, 'No rails yet. Revenue is zero until a settlement clears.', 8);

    rows('improvements', improvements.improvements, i => `
      <tr>
        <td class="n">${Number(i.score).toFixed(2)}</td>
        <td class="k">${esc(i.source)}</td>
        <td class="wrap-any"><strong>${esc(i.title)}</strong><br><span style="color:var(--muted)">${esc(i.proposedChange)}</span></td>
        <td><div class="row-actions">
          <button class="mini" data-improve="${esc(i.id)}" data-decision="ACCEPTED">accept</button>
          <button class="mini" data-improve="${esc(i.id)}" data-decision="REJECTED">reject</button>
        </div></td>
      </tr>`, 'No open proposals — the improve cron files them.', 4);

    rows('signals', signals.signals, s => `
      <tr>
        <td class="k">${esc(s.droneId)}</td>
        <td class="wrap-any">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>` : esc(s.title || '—')}</td>
        <td><span class="pill ${s.status === 'PROCESSED' ? 'ok' : s.status === 'QUARANTINED' ? 'bad' : s.status === 'REJECTED' ? 'off' : 'warn'}">${esc(s.status)}</span></td>
        <td class="n">${s.score == null ? '—' : Number(s.score).toFixed(2)}</td>
      </tr>`, 'No signals yet.', 4);

    rows('scans', scans.scans, s => `
      <tr>
        <td class="k">${s.targetUrl ? `<a href="${esc(s.targetUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.targetKey)}</a>` : esc(s.targetKey)}</td>
        <td><span class="pill ${s.reachable ? 'ok' : 'bad'}">${s.reachable ? 'yes' : 'no'}</span></td>
        <td><span class="pill ${s.botDefended ? 'bad' : 'ok'}">${s.botDefended ? (s.botDefenseVendor || 'yes') : 'no'}</span></td>
        <td class="k">${esc(s.shape)}</td>
        <td class="wrap-any" style="color:var(--muted)">${esc(s.verdict)}</td>
        <td>${esc(ago(s.scannedAt))}</td>
      </tr>`, 'No scans yet — press "scan now" or wait for the daily cron.', 6);

    const econ = orders.economics;
    const rateEl = $('order-economics');
    rateEl.className = `pill ${econ.effectiveHourlyRateCents == null ? 'off' : econ.effectiveHourlyRateCents >= 2000 ? 'ok' : 'warn'}`;
    rateEl.textContent = econ.effectiveHourlyRateCents == null
      ? `${econ.orders} orders · nothing cleared yet`
      : `${money(econ.effectiveHourlyRateCents)}/hr effective · ${econ.paidOrders}/${econ.orders} paid`;

    rows('orders', orders.orders, o => `
      <tr>
        <td class="k">${esc(o.orderId)}${o.notes ? `<br><span style="color:var(--muted);font-size:.9em">${esc(o.notes)}</span>` : ''}</td>
        <td><span class="pill ${o.orderStatus === 'PAID' ? 'ok' : o.orderStatus === 'CANCELLED' ? 'bad' : 'warn'}">${esc(o.orderStatus)}</span></td>
        <td class="n">${money(o.priceCents)}</td>
        <td class="n">${o.minutesSpent}</td>
        <td class="n">${o.payout ? money(o.payout.netCents) : '—'}</td>
        <td>${o.payout ? '' : `<button class="mini" data-order-payout="${esc(o.orderId)}" data-price="${o.priceCents}">mark paid</button>`}</td>
      </tr>`, 'No orders logged yet.', 6);

    const financeTiles = [
      { label: 'Net position (lifetime)', value: money(finance.lifetime.netCents), sub: finance.lifetime.marginPct == null ? 'no cleared revenue yet' : `${finance.lifetime.marginPct}% margin`, tone: finance.lifetime.netCents >= 0 ? 'good' : 'alarm' },
      { label: `Burn rate (${finance.trailing.days}d)`, value: `${money(finance.trailing.burnRateCentsPerDay)}/day`, sub: `${money(finance.trailing.spendCents)} spent trailing ${finance.trailing.days}d` },
      { label: 'Runway', value: finance.runway.runwayDays == null ? '—' : `${finance.runway.runwayDays}d`, sub: finance.runway.note || `${money(finance.runway.remainingCents)} of budget left` },
      { label: 'Projected next 30d net', value: money(finance.projection.projectedNext30DaysNetCents), sub: 'naive linear extrapolation, not a forecast' }
    ];
    $('finance-tiles').innerHTML = financeTiles.map(t => `
      <div class="tile ${t.tone || ''}">
        <div class="label">${esc(t.label)}</div>
        <div class="value">${esc(t.value)}</div>
        <div class="sub">${esc(t.sub)}</div>
      </div>`).join('');

    rows('finance-rails', finance.perRail, r => `
      <tr>
        <td class="k">${esc(r.rail)}</td>
        <td><span class="pill ${RAIL_TONE[r.state] || 'warn'}">${esc(r.state || 'PROBATION')}</span></td>
        <td class="n">${money(r.clearedCents)}</td>
        <td class="n">${money(r.spendCents)}</td>
        <td class="n">${money(r.netCents)}</td>
        <td class="n">${r.marginPct == null ? '—' : `${r.marginPct}%`}</td>
      </tr>`, 'No rails yet.', 6);

    $('foot').textContent = `Updated ${new Date().toLocaleTimeString()} — ${store.base}`;
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = `${error.message}  ·  Start the API (${store.base || DEFAULT_API}) then press Connect. packages/api is npm run api on :3100.` ;
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;

  try {
    if (target.dataset.cron) {
      target.disabled = true; target.textContent = 'running…';
      await api(`/api/crons/${encodeURIComponent(target.dataset.cron)}/run`, { method: 'POST' });
    } else if (target.dataset.droneRun) {
      target.disabled = true; target.textContent = 'flying…';
      await api(`/api/drones/${encodeURIComponent(target.dataset.droneRun)}/run`, { method: 'POST' });
    } else if (target.dataset.droneToggle) {
      await api(`/api/drones/${encodeURIComponent(target.dataset.droneToggle)}/enabled`,
        { method: 'POST', body: { enabled: target.dataset.enabled !== 'true' } });
    } else if (target.dataset.improve) {
      await api(`/api/improvements/${encodeURIComponent(target.dataset.improve)}/decision`,
        { method: 'POST', body: { status: target.dataset.decision } });
    } else if (target.dataset.orderPayout) {
      const gross = prompt(`Gross payout for order ${target.dataset.orderPayout}, in dollars (before Fiverr's fee):`);
      if (gross == null) return;
      const fee = prompt('Fiverr fee, in dollars (0 if already net):', '0');
      if (fee == null) return;
      await api(`/api/orders/${encodeURIComponent(target.dataset.orderPayout)}/payout`, {
        method: 'POST',
        body: { grossCents: Math.round(Number(gross) * 100), feeCents: Math.round(Number(fee) * 100) }
      });
    } else if (target.dataset.railReenable) {
      if (!confirm(`Re-enable rail "${target.dataset.railReenable}"? It gets a fresh probation budget.`)) return;
      await api(`/api/money/rails/${encodeURIComponent(target.dataset.railReenable)}/reenable`, { method: 'POST' });
    } else {
      return;
    }
    await load();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = error.message;
    await load();
  }
});

$('save').addEventListener('click', () => {
  connectBase();
  load();
});
$('refresh').addEventListener('click', load);
$('order-add').addEventListener('click', async () => {
  const button = $('order-add');
  const orderId = $('order-id').value.trim();
  const price = Number($('order-price').value);
  const minutes = Number($('order-minutes').value);

  if (!orderId || !(price > 0) || !(minutes > 0)) {
    $('error').hidden = false;
    $('error').textContent = 'Order ID, price and minutes are all required — minutes especially: an unmeasured hour is how a rail looks profitable while losing.';
    return;
  }

  button.disabled = true; button.textContent = 'saving…';
  try {
    await api('/api/orders', {
      method: 'POST',
      body: {
        orderId,
        priceCents: Math.round(price * 100),
        minutesSpent: Math.round(minutes),
        notes: $('order-notes').value.trim() || null
      }
    });
    $('order-id').value = ''; $('order-price').value = ''; $('order-minutes').value = ''; $('order-notes').value = '';
    await load();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = error.message;
  } finally {
    button.disabled = false; button.textContent = 'Log order';
  }
});

$('scan-run').addEventListener('click', async () => {
  const button = $('scan-run');
  button.disabled = true; button.textContent = 'scanning…';
  try {
    await api('/api/scans/run', { method: 'POST' });
    await load();
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = error.message;
  } finally {
    button.disabled = false; button.textContent = 'scan now';
  }
});

$('api-base').value = store.base || (isLocalHost() ? DEFAULT_API : '');
$('api-token').value = store.token;
connectBase();
load();
setInterval(() => { if (store.base && !document.hidden) load(); }, 30_000);
