function readConnectForm() {
  store.base = $('api-base').value.trim();
  store.token = $('api-token').value.trim();
  store.proxy = $('use-proxy').checked;
}

function applyOrigin(url) {
  $('api-base').value = url;
  store.base = url;
  store.token = $('api-token').value.trim();
  store.proxy = $('use-proxy').checked;
}

async function load() {
  markNav();
  $('error').hidden = true;
  const view = $('view');
  if (!store.base) {
    view.innerHTML = renderConnectGate();
    $('foot').textContent = 'Set the API base URL and press Connect. packages/api owns drones/crons/ledger; src/server.js owns brain/tasks/runs.';
    return;
  }
  view.innerHTML = '<div class="state">Loading live payloads…</div>';
  try {
    const page = route();
    if (page === 'overview') view.innerHTML = await renderOverview();
    else if (page === 'ledger') view.innerHTML = await renderLedger();
    else if (page === 'autonomy') view.innerHTML = await renderAutonomy();
    else if (page === 'work') view.innerHTML = await renderWork();
    else view.innerHTML = renderGrowth();
    $('foot').textContent = `Updated ${new Date().toLocaleTimeString()} — ${store.base} — ${originHint()} — ${page}`;
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = `${error.message}  ·  Is ${store.base} running? Leave proxy on. packages/api is :3100; src/server.js is :3000.`;
    view.innerHTML = `${renderConnectGate()}<div class="state">${esc(error.message)}</div>`;
  }
}

document.addEventListener('click', async (event) => {
  const originBtn = event.target.closest('[data-origin-url]');
  if (originBtn) {
    applyOrigin(originBtn.dataset.originUrl);
    await load();
    return;
  }
  const target = event.target.closest('button');
  if (!target) return;
  try {
    if (target.id === 'save') {
      readConnectForm();
      await load();
      return;
    }
    if (target.id === 'refresh') { await load(); return; }
    if (target.id === 'order-add') {
      const orderId = $('order-id').value.trim();
      const price = Number($('order-price').value);
      const minutes = Number($('order-minutes').value);
      if (!orderId || !(price > 0) || !(minutes > 0)) {
        $('error').hidden = false;
        $('error').textContent = 'Order ID, price and minutes are required.';
        return;
      }
      target.disabled = true; target.textContent = 'saving…';
      await api('/api/orders', { method: 'POST', body: { orderId, priceCents: Math.round(price * 100), minutesSpent: Math.round(minutes), notes: $('order-notes').value.trim() || null } });
      await load();
      return;
    }
    if (target.id === 'task-add') {
      const prompt = $('task-prompt').value.trim();
      if (!prompt) {
        $('error').hidden = false;
        $('error').textContent = 'prompt is required for POST /api/tasks.';
        return;
      }
      const intervalRaw = $('task-interval').value.trim();
      const body = { prompt, title: $('task-title').value.trim() || undefined };
      if (intervalRaw) body.intervalMinutes = Number(intervalRaw);
      target.disabled = true;
      await api('/api/tasks', { method: 'POST', body });
      await load();
      return;
    }
    if (target.id === 'scan-run') {
      target.disabled = true; target.textContent = 'scanning…';
      await api('/api/scans/run', { method: 'POST' });
      await load();
      return;
    }
    if (target.dataset.cron) {
      target.disabled = true; target.textContent = 'running…';
      await api(`/api/crons/${encodeURIComponent(target.dataset.cron)}/run`, { method: 'POST' });
    } else if (target.dataset.droneRun) {
      target.disabled = true; target.textContent = 'flying…';
      await api(`/api/drones/${encodeURIComponent(target.dataset.droneRun)}/run`, { method: 'POST' });
    } else if (target.dataset.droneToggle) {
      await api(`/api/drones/${encodeURIComponent(target.dataset.droneToggle)}/enabled`, { method: 'POST', body: { enabled: target.dataset.enabled !== 'true' } });
    } else if (target.dataset.improve) {
      await api(`/api/improvements/${encodeURIComponent(target.dataset.improve)}/decision`, { method: 'POST', body: { status: target.dataset.decision } });
    } else if (target.dataset.brainRun) {
      target.disabled = true;
      await api('/api/brain/run', { method: 'POST' });
    } else if (target.dataset.orderPayout) {
      const gross = prompt(`Gross payout for order ${target.dataset.orderPayout}, in dollars (before Fiverr fee):`);
      if (gross == null) return;
      const fee = prompt('Fiverr fee, in dollars (0 if already net):', '0');
      if (fee == null) return;
      await api(`/api/orders/${encodeURIComponent(target.dataset.orderPayout)}/payout`, { method: 'POST', body: { grossCents: Math.round(Number(gross) * 100), feeCents: Math.round(Number(fee) * 100) } });
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

window.addEventListener('hashchange', load);
$('api-base').value = store.base;
$('api-token').value = store.token;
$('use-proxy').checked = store.proxy;
if (!location.hash) location.hash = '#/overview';
load();
setInterval(() => { if (store.base && !document.hidden) load(); }, 30_000);
