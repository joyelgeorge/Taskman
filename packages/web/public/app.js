/* Taskman control UI. Static, stateless, and hosted apart from the API it reads. */

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

async function api(path, { method = 'GET', body } = {}) {
  const base = store.base.replace(/\/$/, '');
  if (!base) throw new Error('No API base URL set.');
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (store.token) headers.authorization = `Bearer ${store.token}`;

  const response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

  // /api/health answers 503 when degraded; that is a valid reading, not a failure.
  if (!response.ok && response.status !== 503) {
    throw new Error(payload?.error || `HTTP ${response.status} from ${path}`);
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
  try {
    const [status, crons, drones, alerts, money_, improvements, signals, scans, finance] = await Promise.all([
      api('/api/status'), api('/api/crons'), api('/api/drones'), api('/api/alerts'),
      api('/api/money/economics'), api('/api/improvements'), api('/api/signals?limit=25'), api('/api/scans'),
      api('/api/finance/report')
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
    $('error').textContent = `${error.message}  ·  Check the API base URL, that the service is awake, and that CORS_ORIGIN allows this page.`;
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
    } else if (target.dataset.railReenable) {
      // Manual only, by design — see docs/TARGET_DESIGN.md §8. The system never
      // argues its own way out of a market that did not pay it.
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
  store.base = $('api-base').value.trim();
  store.token = $('api-token').value.trim();
  load();
});
$('refresh').addEventListener('click', load);
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

$('api-base').value = store.base;
$('api-token').value = store.token;
if (store.base) load();
setInterval(() => { if (store.base && !document.hidden) load(); }, 30_000);
