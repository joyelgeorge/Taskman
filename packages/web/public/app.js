/* Taskman operator console. Static. Talks only to live Taskman endpoints. */

const $ = (id) => document.getElementById(id);
const store = {
  get base() { try { return localStorage.getItem('taskman.api') || ''; } catch { return ''; } },
  set base(v) { try { localStorage.setItem('taskman.api', v); } catch {} },
  get token() { try { return localStorage.getItem('taskman.token') || ''; } catch { return ''; } },
  set token(v) { try { localStorage.setItem('taskman.token', v); } catch {} },
  get proxy() { try { return localStorage.getItem('taskman.proxy') !== '0'; } catch { return true; } },
  set proxy(v) { try { localStorage.setItem('taskman.proxy', v ? '1' : '0'); } catch {} }
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

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

function route() {
  const hash = (location.hash || '#/overview').replace(/^#\/?/, '');
  return ['overview', 'ledger', 'autonomy', 'work', 'growth'].includes(hash) ? hash : 'overview';
}

async function api(path, { method = 'GET', body } = {}) {
  const base = store.base.replace(/\/$/, '');
  if (!base) throw new Error('No API base URL set.');
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (store.token) headers.authorization = `Bearer ${store.token}`;
  let url;
  if (store.proxy) {
    url = `/__proxy${path}`;
    headers['x-taskman-base'] = base;
  } else {
    url = `${base}${path}`;
  }
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!response.ok && response.status !== 503) {
    const err = new Error(payload?.error || payload?.message || `HTTP ${response.status} from ${path}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function tryApi(path, opts) {
  try {
    return { ok: true, data: await api(path, opts) };
  } catch (error) {
    return { ok: false, error, missing: error.status === 404 };
  }
}

function pill(tone, label) {
  return `<span class="pill ${tone}">${esc(label)}</span>`;
}

function rows(items, render, emptyText, columns) {
  if (!items?.length) return `<tr><td colspan="${columns}" class="empty">${esc(emptyText)}</td></tr>`;
  return items.map(render).join('');
}

function tile(label, value, sub, tone = '') {
  return `<div class="tile ${tone}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub || '')}</div></div>`;
}

const CRON_TONE = { OK: 'ok', DISABLED: 'off', FAILING: 'warn', OVERDUE: 'bad', STUCK: 'bad' };
const RAIL_TONE = { PROBATION: 'warn', PROVEN: 'ok', SCALED: 'ok', DISABLED: 'bad' };
const RAIL_LIVE = { PROVEN: 'live', SCALED: 'live', PROBATION: 'probation', DISABLED: 'dead' };

function markNav() {
  const current = route();
  document.querySelectorAll('.nav-link, .mobile-nav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === `#/${current}`);
  });
  $('page-title').textContent = ({ overview: 'Overview', ledger: 'Ledger', autonomy: 'Autonomy', work: 'Work', growth: 'Growth' })[current];
}

function viewShell(kicker, lede, body) {
  return `<p class="kicker">${esc(kicker)}</p><p class="lede">${esc(lede)}</p>${body}`;
}
