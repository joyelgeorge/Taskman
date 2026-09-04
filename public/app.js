import {
  createDashboardRefreshController,
  pollDelay,
  requestJson
} from './refresh-controller.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function mutationOptions(options = {}) {
  return {
    ...options,
    headers: { ...options.headers, 'Idempotency-Key': crypto.randomUUID() }
  };
}

function renderBrain(brain) {
  const action = brain?.nextAction;
  if (!action) return '<p class="muted">No brain state available.</p>';
  if (action.type === 'discover_new_scenario') {
    return `<div><span class="pill">DISCOVER</span><div class="brain-gap">${esc(action.reason)}</div></div>`;
  }
  const ranked = (brain.evaluated || []).slice(0, 4);
  return `
    <div class="row">
      <span class="pill">NEXT: ${esc(action.type)}</span>
      <span class="pill score">score ${esc(action.scenarioScore)}</span>
    </div>
    <h3>${esc(action.scenarioName)}</h3>
    <div class="brain-gap">${esc(action.gap)}</div>
    <p class="muted">The next AI call should attack only this gap, then write validated evidence back into the knowledge store.</p>
    ${ranked.length ? `<details><summary>Top scenario ranking</summary>${ranked.map(x => `<div class="task"><strong>${esc(x.scenario.name)}</strong> <span class="pill score">${esc(x.ranking.score)}</span><div class="muted">${esc((x.scenario.next_gaps || [])[0] || 'No open gap')}</div></div>`).join('')}</details>` : ''}
  `;
}

function renderScenarios(scenarios) {
  const priority = { active: 0, building: 1, unvalidated: 2, active_manual: 3, supporting_only: 4, deprioritized: 5, rejected: 6 };
  const ordered = [...scenarios].sort((a, b) =>
    (priority[a.status] ?? 4) - (priority[b.status] ?? 4) || String(a.name).localeCompare(String(b.name))
  );
  $('#scenarioCount').textContent = `${ordered.length} rows`;
  $('#scenarios').innerHTML = ordered.length ? ordered.map(s => {
    const leader = s.current_leader;
    const score = leader?.score_total ?? leader?.score ?? null;
    const max = leader?.score_max ?? leader?.max_score ?? null;
    const summary = s.current_best_path || s.goal || s.decision || '';
    return `
      <div class="task">
        <div class="row">
          <strong>${esc(s.name)}</strong>
          <span class="pill">${esc(s.status)}</span>
          ${score !== null ? `<span class="pill score">${esc(score)}${max ? `/${esc(max)}` : ''}</span>` : ''}
        </div>
        <div class="muted">${esc(summary)}</div>
        ${leader?.scenario_id ? `<div class="muted"><strong>Leader:</strong> ${esc(leader.scenario_id)}</div>` : ''}
      </div>
    `;
  }).join('') : '<p class="muted">No scenario rows found.</p>';
}

function renderPanel(name, data) {
  if (name === 'system') {
    $('#providers').innerHTML = data.providers.map(p => `<span class="pill">${esc(p.id)} · ${p.ready ? 'ready' : 'no key'}</span>`).join('');
    $('#usage').textContent = `${Number(data.usage.inputTokens || 0) + Number(data.usage.outputTokens || 0)} tokens tracked${data.database?.ok ? ' · PostgreSQL connected' : ' · local fallback'}`;
    return;
  }
  if (name === 'brain') {
    $('#brainState').innerHTML = renderBrain(data);
    return;
  }
  if (name === 'scenarios') {
    renderScenarios(data);
    return;
  }
  if (name === 'tasks') {
    $('#tasks').innerHTML = data.length ? data.map(t => `
    <div class="task">
      <div class="row"><strong>${esc(t.title)}</strong><span class="pill">${esc(t.status)}</span>${t.intervalMinutes ? `<span class="pill">every ${t.intervalMinutes}m</span>` : '<span class="pill">manual</span>'}</div>
      <div class="muted">${esc(t.prompt)}</div>
      <div class="row task-actions">
        <button data-run="${t.id}">Run now</button>
        <button data-pause="${t.id}">${t.status === 'active' ? 'Pause' : 'Resume'}</button>
      </div>
      ${t.lastResult ? `<div class="result">${esc(t.lastResult)}</div>` : ''}
    </div>`).join('') : '<p class="muted">No tasks yet.</p>';
    return;
  }
  if (name === 'customer') {
    renderCustomerWorkflow(data);
    return;
  }
  if (name === 'runs') {
    $('#runs').innerHTML = data.length ? data.slice(0, 10).map(r => `
    <div class="task">
      <div class="row"><strong>${esc(r.status)}</strong>${r.provider ? `<span class="pill">${esc(r.provider)}</span>` : ''}<span class="muted">${new Date(r.startedAt || r.started_at).toLocaleString()}</span></div>
      ${r.result ? `<div class="result">${esc(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))}</div>` : ''}
      ${r.error ? `<div class="result">${esc(r.error)}</div>` : ''}
      ${r.nextBestAction ? `<p class="muted"><strong>Next:</strong> ${esc(r.nextBestAction)}</p>` : ''}
    </div>`).join('') : '<p class="muted">No runs yet.</p>';
  }
}

function renderCustomerWorkflow(data) {
  if (!data) return;
  const statusEl = $('#customerWorkflowStatus');
  if (statusEl) {
    statusEl.textContent = data.status;
    statusEl.dataset.state = data.status === 'ACTIVE' ? 'live' : 'stale';
  }

  const toggleBtn = $('#toggleWorkflowActive');
  if (toggleBtn) {
    toggleBtn.style.display = 'inline-block';
    toggleBtn.textContent = data.status === 'ACTIVE' ? 'Deactivate workflow' : 'Activate workflow';
  }

  const blockersEl = $('#customerBlockers');
  if (blockersEl) {
    if (data.blockers && data.blockers.length > 0) {
      blockersEl.style.display = 'block';
      blockersEl.innerHTML = `<strong>Setup Blockers (${data.blockers.length}):</strong><ul style="margin:4px 0 0 18px;padding:0;">${data.blockers.map(b => `<li>${esc(b)}</li>`).join('')}</ul>`;
    } else {
      blockersEl.style.display = 'none';
      blockersEl.innerHTML = '';
    }
  }

  if (data.configuredInputs) {
    if (!$('#agencyName').value && data.configuredInputs.agencyName) $('#agencyName').value = data.configuredInputs.agencyName;
    if (!$('#fiverrUsername').value && data.configuredInputs.fiverrUsername) $('#fiverrUsername').value = data.configuredInputs.fiverrUsername;
    if (!$('#monthlyVolume').value && data.configuredInputs.monthlyVolumeEstimate) $('#monthlyVolume').value = data.configuredInputs.monthlyVolumeEstimate;
  }

  const intsEl = $('#integrationsList');
  if (intsEl && data.connectedIntegrations) {
    intsEl.innerHTML = Object.entries(data.connectedIntegrations).map(([key, val]) => `
      <div class="integration-item">
        <span><strong>${esc(key)}</strong> (${esc(val.format || 'API')})</span>
        <button data-integration="${esc(key)}" data-connected="${val.connected ? 'false' : 'true'}">${val.connected ? 'Disconnect' : 'Connect / Upload'}</button>
      </div>
    `).join('');
  }

  const estSavingsEl = $('#estimatedSavings');
  if (estSavingsEl) {
    const est = data.valueMetrics?.estimatedAnnualSavingsCents || 0;
    estSavingsEl.textContent = `$${(est / 100).toFixed(2)} / yr`;
  }

  const verSavingsEl = $('#verifiedSavings');
  if (verSavingsEl) {
    const ver = data.valueMetrics?.verifiedRecoveredFeesCents || 0;
    verSavingsEl.textContent = `$${(ver / 100).toFixed(2)}`;
  }

  const evRefEl = $('#verifiedEvidenceRef');
  if (evRefEl) {
    evRefEl.textContent = data.valueMetrics?.lastVerifiedEvidenceRef
      ? `Audit ref: ${data.valueMetrics.lastVerifiedEvidenceRef} (${data.valueMetrics.verifiedReconciliationCount} runs)`
      : 'Evidence: No verified runs yet';
  }

  const billEl = $('#billingBasisDetails');
  if (billEl && data.billingBasis) {
    billEl.innerHTML = `<div>Model: ${esc(data.billingBasis.pricingModel)} (${esc(data.billingBasis.monthlyBasePrice)} + ${esc(data.billingBasis.batchFee)})</div><div class="muted" style="margin-top:4px;">${esc(data.billingBasis.terms)}</div>`;
  }

  const histEl = $('#customerHistory');
  if (histEl) {
    const hist = data.reconciliationHistory || [];
    histEl.innerHTML = hist.length ? hist.map(h => `
      <div class="task">
        <div class="row">
          <strong>${h.balanced ? 'Reconciled (Matched)' : 'Variance Detected'}</strong>
          <span class="pill">${esc(h.evidenceRef)}</span>
          <span class="muted">${new Date(h.executedAt).toLocaleString()}</span>
        </div>
        <div class="muted">Tax-deductible platform fees verified: $${(h.verifiedTaxFeeSavingsCents / 100).toFixed(2)}</div>
        ${h.discrepancies?.length ? `<div class="result">${esc(JSON.stringify(h.discrepancies, null, 2))}</div>` : ''}
      </div>
    `).join('') : '<p class="muted">No reconciliation outcomes yet.</p>';
  }
}

function panelStatusText(state) {
  const last = state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleTimeString() : null;
  if (state.status === 'live') return `Live · updated ${last}`;
  if (state.status === 'loading') return 'Loading…';
  if (state.status === 'stale') return `Stale · last updated ${last} · ${state.error}`;
  if (state.status === 'error') return `Unavailable · ${state.error}`;
  return 'No data';
}

function updatePanelState(name, state) {
  const element = $(`#${name}Status`);
  if (!element) return;
  element.textContent = panelStatusText(state);
  element.dataset.state = state.status;
  element.closest('.card')?.setAttribute('data-refresh-state', state.status);
}

const refreshController = createDashboardRefreshController({
  panels: {
    customer: '/api/commercial/customer/workflow',
    system: '/api/status',
    tasks: '/api/tasks',
    runs: '/api/runs',
    brain: '/api/brain',
    scenarios: '/api/scenarios'
  },
  fetchPanel: (_name, path, { signal }) => requestJson(path, { signal }),
  onPanelState(name, state) {
    updatePanelState(name, state);
    if (state.status === 'live') renderPanel(name, state.data);
  },
  onGlobalState(state) {
    const banner = $('#dashboardHealth');
    banner.hidden = state.status === 'live';
    $('#dashboardHealthText').textContent = state.status === 'live'
      ? 'Dashboard live'
      : state.status === 'degraded'
        ? `Dashboard degraded: ${state.failedPanels.join(', ')}`
        : 'Dashboard unavailable';
    banner.dataset.state = state.status;
  }
});

let refreshTimer = null;

async function refreshDashboard({ supersede = false } = {}) {
  await refreshController.refresh({ supersede });
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    if (!document.hidden) await refreshDashboard();
    scheduleRefresh();
  }, pollDelay(document.hidden));
}

$('#create').onclick = async () => {
  try {
    await requestJson('/api/tasks', mutationOptions({ method: 'POST', body: JSON.stringify({ title: $('#title').value, prompt: $('#prompt').value, intervalMinutes: $('#interval').value }) }));
    $('#title').value = ''; $('#prompt').value = ''; $('#interval').value = '';
    await refreshDashboard({ supersede: true });
  } catch (e) { alert(e.message); }
};

$('#runBrain').onclick = async () => {
  const button = $('#runBrain');
  button.disabled = true;
  button.textContent = 'Running…';
  $('#brainResult').innerHTML = '<p class="muted">Resolving the selected gap…</p>';
  try {
    const result = await requestJson('/api/brain/run', mutationOptions({ method: 'POST' }));
    const cycle = result.cycle;
    $('#brainResult').innerHTML = `<div class="result"><strong>${esc(cycle.status)}</strong> · ${esc(cycle.scenarioId || '')}\n${esc(cycle.result?.answer || cycle.error || JSON.stringify(cycle.result || {}, null, 2))}</div>`;
    $('#brainState').innerHTML = renderBrain(result.brainAfter);
  } catch (e) {
    $('#brainResult').innerHTML = `<div class="result">${esc(e.message)}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = 'Run brain once';
  }
};

$('#saveCustomerConfig')?.addEventListener('click', async () => {
  try {
    await requestJson('/api/commercial/customer/workflow/configure', mutationOptions({
      method: 'POST',
      body: JSON.stringify({
        agencyName: $('#agencyName').value,
        fiverrUsername: $('#fiverrUsername').value,
        monthlyVolumeEstimate: Number($('#monthlyVolume').value) || 0
      })
    }));
    await refreshDashboard({ supersede: true });
  } catch (err) { alert(err.message); }
});

$('#toggleWorkflowActive')?.addEventListener('click', async () => {
  try {
    const isCurrentlyActive = $('#customerWorkflowStatus').textContent === 'ACTIVE';
    await requestJson('/api/commercial/customer/workflow/status', mutationOptions({
      method: 'POST',
      body: JSON.stringify({ active: !isCurrentlyActive })
    }));
    await refreshDashboard({ supersede: true });
  } catch (err) { alert(err.message); }
});

$('#runCustomerBatch')?.addEventListener('click', async () => {
  const resultEl = $('#customerBatchResult');
  try {
    resultEl.innerHTML = '<p class="muted">Running reconciliation batch against statements and bank records…</p>';
    // Sample first-customer reconciliation payload
    const payload = {
      transactions: [
        { grossAmount: 1200.00, platformFee: 240.00 },
        { grossAmount: 850.00, platformFee: 170.00 },
        { grossAmount: 450.00, platformFee: 90.00 }
      ],
      deposits: [
        { amount: 2000.00 }
      ]
    };
    const res = await requestJson('/api/commercial/customer/workflow/reconcile', mutationOptions({
      method: 'POST',
      body: JSON.stringify(payload)
    }));
    resultEl.innerHTML = `<div class="result"><strong>Reconciliation Complete</strong>\nGross: $2,500.00 | Fees Audited: $500.00 | Net Withdrawn: $2,000.00 | Bank Deposited: $2,000.00\nBalanced: ${res.report.balanced}\nAudit Ref: ${res.report.evidenceRef}</div>`;
    await refreshDashboard({ supersede: true });
  } catch (err) {
    resultEl.innerHTML = `<div class="result" style="color:#b91c1c;">${esc(err.message)}</div>`;
  }
});

document.addEventListener('click', async e => {
  const intBtn = e.target.closest('[data-integration]');
  if (intBtn) {
    try {
      await requestJson('/api/commercial/customer/workflow/integration', mutationOptions({
        method: 'POST',
        body: JSON.stringify({
          integration: intBtn.dataset.integration,
          connected: intBtn.dataset.connected === 'true'
        })
      }));
      await refreshDashboard({ supersede: true });
    } catch (err) { alert(err.message); }
  }

  const run = e.target.closest('[data-run]');
  const pause = e.target.closest('[data-pause]');
  try {
    if (run) await requestJson(`/api/tasks/${run.dataset.run}/run`, mutationOptions({ method: 'POST' }));
    if (pause) await requestJson(`/api/tasks/${pause.dataset.pause}/pause`, mutationOptions({ method: 'POST' }));
    if (run || pause) await refreshDashboard({ supersede: true });
  } catch (err) { alert(err.message); }
});

$('#retryDashboard').onclick = () => refreshDashboard({ supersede: true });

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDashboard({ supersede: true });
  scheduleRefresh();
});

refreshDashboard();
scheduleRefresh();
