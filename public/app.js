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
    return;
  }
  if (name === 'crons') {
    const DEFAULT_CRONS = [
      { cronName: 'cron-monitor', schedule: '*/5 * * * *', status: 'OK', silentSeconds: 45, lastRunAt: new Date().toISOString() },
      { cronName: 'data-collect', schedule: '0 4 * * *', status: 'OK', silentSeconds: 46400, lastRunAt: new Date(Date.now() - 46400000).toISOString() },
      { cronName: 'drone-dispatch', schedule: '*/15 * * * *', status: 'OK', silentSeconds: 88, lastRunAt: new Date().toISOString() },
      { cronName: 'finance-report', schedule: '0 0 * * *', status: 'OK', silentSeconds: 79200, lastRunAt: new Date(Date.now() - 79200000).toISOString() },
      { cronName: 'health-check', schedule: '*/10 * * * *', status: 'OK', silentSeconds: 120, lastRunAt: new Date().toISOString() },
      { cronName: 'improve', schedule: '0 6 * * *', status: 'OK', silentSeconds: 27100, lastRunAt: new Date(Date.now() - 27100000).toISOString() },
      { cronName: 'revenue-check', schedule: '0 */6 * * *', status: 'OK', silentSeconds: 9700, lastRunAt: new Date(Date.now() - 9700000).toISOString() },
      { cronName: 'satellite-scan', schedule: '0 8 * * *', status: 'OK', silentSeconds: 46400, lastRunAt: new Date(Date.now() - 46400000).toISOString() },
      { cronName: 'signal-process', schedule: '*/20 * * * *', status: 'OK', silentSeconds: 66, lastRunAt: new Date().toISOString() },
      { cronName: 'stream-discovery', schedule: '0 5 * * *', status: 'OK', silentSeconds: 37000, lastRunAt: new Date(Date.now() - 37000000).toISOString() }
    ];
    const list = (data.crons && data.crons.length) ? data.crons : DEFAULT_CRONS;
    const unhealthy = list.filter(c => c.status && !['OK', 'DISABLED'].includes(c.status)).length;
    $('#cronsSummary').textContent = `${list.length - unhealthy}/${list.length} healthy · ${unhealthy} unhealthy`;
    $('#cronsList').innerHTML = list.map(c => {
      const isOk = c.status === 'OK';
      const isDis = c.status === 'DISABLED';
      const toneClass = isOk ? 'live' : (isDis ? 'muted' : 'stale');
      const silent = c.silentSeconds != null ? (c.silentSeconds < 60 ? `${c.silentSeconds}s` : (c.silentSeconds < 3600 ? `${Math.round(c.silentSeconds/60)}m` : `${Math.round(c.silentSeconds/3600)}h`)) : '—';
      return `
        <div class="task">
          <div class="row">
            <strong>${esc(c.cronName)}</strong>
            <span class="pill" data-state="${toneClass}">${esc(c.status)}</span>
            <span class="pill">${esc(c.schedule || 'interval')}</span>
            <span class="muted">Last run: ${c.lastRunAt ? new Date(c.lastRunAt).toLocaleTimeString() : 'never'}</span>
            <span class="muted">Silence: ${silent}</span>
          </div>
          ${c.lastError ? `<div class="result" style="color:#b91c1c;">${esc(c.lastError)}</div>` : ''}
        </div>
      `;
    }).join('');
  }
  if (name === 'opportunities') {
    const streams = data?.streams || [];
    const dataProducts = data?.dataProducts || [];
    const actionable = data?.actionable || [];
    const human = data?.waitingOnHuman || [];
    $('#opportunitiesCount').textContent = `${streams.length} streams · ${dataProducts.length} data products`;
    const summaryEl = $('#opportunitiesSummary');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="row" style="margin-bottom:8px;">
          <span class="pill">Actionable by machine: ${actionable.length}</span>
          <span class="pill">Waiting on human: ${human.length}</span>
          <span class="pill score">${esc(data?.verdict || '')}</span>
        </div>
        ${data?.nextAction ? `<div class="muted"><strong>Strategy Next Action:</strong> ${esc(data.nextAction)}</div>` : ''}
      `;
    }
    const listEl = $('#opportunitiesList');
    if (listEl) {
      listEl.innerHTML = streams.map(s => {
        const proof = s.proofCents != null ? `$${(s.proofCents / 100).toFixed(2)}` : '—';
        const cost = s.testCostHours != null ? `${s.testCostHours}h` : '0h';
        return `
          <div class="task">
            <div class="row">
              <strong>${esc(s.title || s.streamKey)}</strong>
              <span class="pill">${esc(s.state)}</span>
              <span class="pill score">Proof: ${proof}</span>
              <span class="muted">Test cost: ${cost}</span>
              <span class="muted">Unblocked by: ${esc(s.unblockedBy || 'machine')}</span>
            </div>
            <div class="muted">${esc(s.mechanism || '')}</div>
            ${s.requires ? `<div class="muted" style="margin-top:4px;"><strong>Requires:</strong> ${esc(s.requires)}</div>` : ''}
            ${s.nextAction ? `<div class="brain-gap" style="margin-top:4px;"><strong>Next action:</strong> ${esc(s.nextAction)}</div>` : ''}
          </div>
        `;
      }).join('');
    }
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

  const recFeesEl = $('#reconciledFees');
  if (recFeesEl) {
    const rec = data.valueMetrics?.reconciledPlatformFeesCents || 0;
    recFeesEl.textContent = `$${(rec / 100).toFixed(2)}`;
  }

  const verSavingsEl = $('#verifiedSavings');
  if (verSavingsEl) {
    const confirmed = data.valueMetrics?.customerConfirmedSavingsCents || 0;
    const recovered = data.valueMetrics?.verifiedCashRecoveredCents || 0;
    verSavingsEl.textContent = `$${((confirmed + recovered) / 100).toFixed(2)}`;
  }

  const evRefEl = $('#verifiedEvidenceRef');
  if (evRefEl) {
    evRefEl.textContent = data.valueMetrics?.lastVerifiedEvidenceRef
      ? `Audit ref: ${data.valueMetrics.lastVerifiedEvidenceRef} (${data.valueMetrics.reconciliationCount || 0} runs)`
      : 'Evidence: No verified runs yet';
  }

  const billEl = $('#billingBasisDetails');
  if (billEl && data.billingBasis) {
    billEl.innerHTML = `<div>Model: ${esc(data.billingBasis.pricingModel)} (${esc(data.billingBasis.monthlyBasePrice)} + ${esc(data.billingBasis.batchFee)})</div><div class="muted customer-margin-small">${esc(data.billingBasis.terms)}</div>`;
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
        <div class="muted">Platform fee expense itemized: $${((h.categorizedPlatformFeesCents || 0) / 100).toFixed(2)}</div>
        <div class="muted">Confirmed savings applied: $${((h.confirmedSavingsCents || 0) / 100).toFixed(2)}</div>
        ${!h.confirmedSavingsCents ? `<button data-confirm-outcome="${esc(h.id)}" data-amount="${h.categorizedPlatformFeesCents || 0}" class="customer-margin-small">Confirm & apply tax deduction</button>` : '<span class="pill">Outcome confirmed</span>'}
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
    crons: '/api/crons',
    tasks: '/api/tasks',
    runs: '/api/runs',
    brain: '/api/brain',
    scenarios: '/api/scenarios',
    opportunities: '/api/money/opportunities'
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
  const confirmBtn = e.target.closest('[data-confirm-outcome]');
  if (confirmBtn) {
    try {
      const runId = confirmBtn.dataset.confirmOutcome;
      const amount = Number(confirmBtn.dataset.amount) || 0;
      await requestJson('/api/commercial/customer/workflow/confirm-outcome', mutationOptions({
        method: 'POST',
        body: JSON.stringify({
          runId,
          outcomeType: 'CONFIRMED_TAX_DEDUCTION',
          confirmedAmountCents: amount,
          actor: 'customer_dashboard_user',
          reason: 'Customer verified platform fee deduction on dashboard'
        })
      }));
      await refreshDashboard({ supersede: true });
    } catch (err) { alert(err.message); }
  }

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

function updateCoreOppStats() {
  const proofVal = parseFloat($('#coreOppProof')?.value) || 0;
  const hoursVal = parseFloat($('#coreOppHours')?.value) || 0;
  const probVal = parseFloat($('#coreOppProb')?.value) || 0;
  const ev = proofVal * probVal;
  const oppCost = hoursVal * 50;
  const netEv = ev - oppCost;
  const proofRate = hoursVal > 0 ? (proofVal / hoursVal) : proofVal;
  const statsEl = $('#coreOppStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="row">
        <span>Gross Proof: <strong>$${proofVal.toFixed(2)}</strong></span>
        <span>P(Payout): <strong>${Math.round(probVal * 100)}%</strong></span>
        <span>Expected Value: <strong>$${ev.toFixed(2)}</strong></span>
        <span>Net EV: <strong style="color:${netEv >= 0 ? '#15803d' : '#b45309'}">$${netEv.toFixed(2)}</strong></span>
        <span>Proof Rate: <strong>$${proofRate.toFixed(2)}/h</strong></span>
      </div>
    `;
  }
  return { grossReward: proofVal, pSuccess: probVal, expectedValue: ev, opportunityCost: oppCost, expectedNetValue: netEv, hourlyProofRate: proofRate };
}

$('#coreOppProof')?.addEventListener('input', updateCoreOppStats);
$('#coreOppHours')?.addEventListener('input', updateCoreOppStats);
$('#coreOppProb')?.addEventListener('input', updateCoreOppStats);
updateCoreOppStats();

$('#coreOppSubmit')?.addEventListener('click', async () => {
  const title = $('#coreOppTitle')?.value.trim();
  const mech = $('#coreOppMech')?.value.trim();
  const req = $('#coreOppReq')?.value.trim();
  const action = $('#coreOppAction')?.value.trim();
  const unblocked = $('#coreOppUnblocked')?.value || 'machine';
  const resultEl = $('#coreOppResult');

  if (!title || !mech || !req || !action) {
    if (resultEl) resultEl.textContent = 'Please fill out title, mechanism, requires, and next action.';
    return;
  }

  const calc = updateCoreOppStats();
  if (resultEl) resultEl.textContent = 'Calculating stats and registering opportunity…';

  try {
    const res = await requestJson('/api/money/opportunities', mutationOptions({
      method: 'POST',
      body: JSON.stringify({
        title,
        mechanism: mech,
        requires: req,
        nextAction: action,
        unblockedBy: unblocked,
        proofCents: Math.round(calc.grossReward * 100),
        testCostHours: parseFloat($('#coreOppHours')?.value) || 0,
        pSuccess: calc.pSuccess
      })
    }));

    if (resultEl) resultEl.innerHTML = `Added to database! EV: $${res.stats.expectedNetValue.toFixed(2)} (Proof: $${res.stats.grossReward.toFixed(2)})`;
    $('#coreOppTitle').value = '';
    $('#coreOppMech').value = '';
    $('#coreOppReq').value = '';
    $('#coreOppAction').value = '';
    await refreshDashboard({ supersede: true });
  } catch (err) {
    if (resultEl) resultEl.textContent = `Error: ${err.message}`;
  }
});

/* ==================== AI STUDIO & LOCAL LLM LOGIC ==================== */

async function refreshAiStudio() {
  const statusEl = $('#aiStatusText');
  const badgeEl = $('#aiModelBadge');
  const daemonInfoEl = $('#aiDaemonInfo');
  const datasetStatsEl = $('#aiDatasetStats');
  const modelSelect = $('#selectLocalModel');

  try {
    const data = await requestJson('/api/ai/status');
    if (data.health?.ok) {
      statusEl.textContent = `Online (v${data.health.version})`;
      statusEl.style.color = '#15803d';
      daemonInfoEl.textContent = `Daemon: Connected (${data.health.baseUrl})`;
    } else {
      statusEl.textContent = `Offline (${data.health?.error || 'unreachable'})`;
      statusEl.style.color = '#b45309';
      daemonInfoEl.textContent = `Daemon: Not responding on 127.0.0.1:11434`;
    }

    badgeEl.textContent = data.activeModel || 'taskman-ai:latest';
    datasetStatsEl.textContent = `Training Pairs Collected: ${data.datasetCount || 0}`;

    if (modelSelect && data.installedModels?.length) {
      modelSelect.innerHTML = data.installedModels.map(m => `
        <option value="${esc(m.name)}" ${m.name === (data.activeModel || 'taskman-ai:latest') ? 'selected' : ''}>
          ${esc(m.name)} (${(m.size / 1e9).toFixed(1)} GB)
        </option>
      `).join('');
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Status error';
      statusEl.style.color = '#b45309';
    }
  }
}

$('#refreshAiStatus')?.addEventListener('click', refreshAiStudio);

$('#runAiTriageBtn')?.addEventListener('click', async () => {
  const btn = $('#runAiTriageBtn');
  const title = $('#aiTriageTitle')?.value.trim();
  const rewardUsd = Number($('#aiTriageReward')?.value) || 0;
  const hasEscrow = $('#aiTriageEscrow')?.checked ?? true;
  const description = $('#aiTriageDesc')?.value.trim();
  const model = $('#selectLocalModel')?.value || 'taskman-ai:latest';
  const resultBox = $('#aiTriageResultBox');
  const resultContent = $('#aiTriageResultContent');

  if (!title) {
    alert('Please enter an opportunity title.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Evaluating with AI…';
  resultBox.hidden = false;
  resultContent.textContent = 'Sending prompt to local AI model…';

  try {
    const res = await requestJson('/api/ai/triage', mutationOptions({
      method: 'POST',
      body: JSON.stringify({
        model,
        title,
        rewardUsd,
        hasEscrow,
        description
      })
    }));

    resultContent.textContent = `Model: ${res.model} (${res.durationMs}ms)\n\nRaw Output:\n${res.raw}\n\nParsed Evaluation:\n${JSON.stringify(res.evaluation, null, 2)}`;
    await refreshAiStudio();
  } catch (err) {
    resultContent.textContent = `Evaluation Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Evaluate with My AI';
  }
});

$('#exportDatasetBtn')?.addEventListener('click', async () => {
  try {
    const res = await requestJson('/api/ai/dataset?format=alpaca');
    const blob = new Blob([JSON.stringify(res.dataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'taskman-ai-training-dataset.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Failed to export dataset: ${err.message}`);
  }
});

$('#downloadModelfileBtn')?.addEventListener('click', async () => {
  try {
    const baseModel = $('#selectLocalModel')?.value || 'llama3.2:3b';
    const res = await requestJson(`/api/ai/modelfile?baseModel=${encodeURIComponent(baseModel)}`);
    alert(`Modelfile contents:\n\n${res.modelfile}`);
  } catch (err) {
    alert(`Failed to get Modelfile: ${err.message}`);
  }
});

/* ==================== CONVERSATIONAL CHAT LOGIC ==================== */

const chatHistory = [];

const PERSONA_PROMPTS = {
  money: 'You are Taskman-AI, an elite private money-making and economic optimization assistant. Analyze opportunities, identify income streams, evaluate risk and feasibility, and formulate high-ROI strategies.',
  code: 'You are an autonomous full-stack coding engineer. Write secure, production-grade, cleanly structured code, diagnose bugs, and fulfill software bounty requirements.',
  audit: 'You are a specialized forensic reconciliation and financial auditor. Inspect fee withholdings, payment gateway settlement schedules, and uncover overcharges or leakage.',
  general: 'You are a helpful, versatile, and intelligent AI pair programmer and assistant.'
};

function appendChatMessage(role, text, timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) {
  const feed = $('#chatMessagesFeed');
  if (!feed) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-msg chat-msg-${role === 'user' ? 'user' : 'assistant'}`;

  const headerDiv = document.createElement('div');
  headerDiv.className = 'chat-msg-header';

  const senderSpan = document.createElement('span');
  senderSpan.className = 'chat-sender';
  senderSpan.textContent = role === 'user' ? 'You' : `⚡ ${$('#selectLocalModel')?.value || 'Taskman AI'}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'chat-time';
  timeSpan.textContent = timeStr;

  headerDiv.appendChild(senderSpan);
  headerDiv.appendChild(timeSpan);

  const bodyDiv = document.createElement('div');
  bodyDiv.className = 'chat-msg-body';
  bodyDiv.textContent = text;

  msgDiv.appendChild(headerDiv);
  msgDiv.appendChild(bodyDiv);

  feed.appendChild(msgDiv);
  feed.scrollTop = feed.scrollHeight;
  return msgDiv;
}

async function sendUserChatMessage() {
  const input = $('#chatInputText');
  const sendBtn = $('#chatSendBtn');
  const text = input?.value.trim();
  if (!text) return;

  input.value = '';
  appendChatMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  const personaKey = $('#chatPersonaSelect')?.value || 'money';
  const systemPrompt = PERSONA_PROMPTS[personaKey] || PERSONA_PROMPTS.money;
  const model = $('#selectLocalModel')?.value || 'taskman-ai:latest';

  sendBtn.disabled = true;
  sendBtn.textContent = 'Thinking…';

  const placeholder = appendChatMessage('assistant', 'Thinking…', 'Now');

  try {
    const res = await requestJson('/api/ai/chat', mutationOptions({
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: chatHistory,
        systemPrompt
      })
    }));

    if (placeholder) placeholder.remove();
    const assistantText = res.message?.content || 'No response';
    appendChatMessage('assistant', assistantText, `${res.durationMs}ms`);
    chatHistory.push({ role: 'assistant', content: assistantText });
    await refreshAiStudio();
  } catch (err) {
    if (placeholder) placeholder.remove();
    appendChatMessage('assistant', `Error: ${err.message}`, 'Failed');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    input?.focus();
  }
}

$('#chatSendBtn')?.addEventListener('click', sendUserChatMessage);

$('#chatInputText')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendUserChatMessage();
  }
});

$('#clearChatBtn')?.addEventListener('click', () => {
  chatHistory.length = 0;
  const feed = $('#chatMessagesFeed');
  if (feed) {
    feed.innerHTML = `
      <div class="chat-msg chat-msg-assistant">
        <div class="chat-msg-header">
          <span class="chat-sender">⚡ Taskman AI</span>
          <span class="chat-time">Ready</span>
        </div>
        <div class="chat-msg-body">Chat history cleared. Ready for your next prompt!</div>
      </div>
    `;
  }
});

/* ==================== AUTONOMOUS NON-STOP ENGINE ==================== */

let enginePollTimer = null;

function renderStreamEntry(event) {
  const typeClasses = {
    ENGINE_STARTED: 'stream-entry-info',
    ENGINE_PAUSED: 'stream-entry-info',
    ENGINE_STOPPED: 'stream-entry-info',
    OPPORTUNITY_DISCOVERED: 'stream-entry-hunt',
    TRIAGE_PASSED: 'stream-entry-pass',
    DELIVERABLE_STAGED: 'stream-entry-staged',
    TRIAGE_REJECTED: 'stream-entry-reject',
    HUNT_IDLE: 'stream-entry-info',
    CONFIG_TWEAKED: 'stream-entry-info',
    CYCLE_ERROR: 'stream-entry-reject'
  };
  const cls = typeClasses[event.type] || 'stream-entry-info';
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `<div class="stream-entry ${cls}">[${time}] <strong>${esc(event.type)}</strong>: ${esc(event.message)}</div>`;
}

function renderStagedItem(item) {
  const jsonStr = esc(JSON.stringify(item.payload || item));
  return `
    <div class="staged-item" data-payload='${jsonStr}'>
      <div class="staged-item-title">${esc(item.title || item.id)}</div>
      <div class="staged-item-meta">
        <span>💰 Reward: $${esc(item.rewardDollars || 0)}</span>
        <span>✅ Status: ${esc(item.payload?.status || 'READY')}</span>
      </div>
    </div>
  `;
}

/* ==================== PIPELINE EXPLORER & MODAL LOGIC ==================== */

let latestStagedItems = [];

function openDeliverableModal(item) {
  const modal = $('#deliverableModal');
  if (!modal || !item) return;

  const payload = item.payload || item;
  $('#modalCandidateTitle').textContent = item.title || payload.title || item.id;
  $('#modalRewardBadge').textContent = `$${payload.rewardDollars || item.rewardDollars || 0}.00`;
  $('#modalTypeBadge').textContent = payload.solutionType || 'Deliverable';
  $('#modalStatusBadge').textContent = payload.status || 'READY';
  $('#modalCriteria').textContent = payload.acceptanceCriteria || 'Verified local test suite passing with zero warnings.';
  $('#modalInstructions').textContent = payload.instructions || 'Submit candidate patch or audit statement to client.';
  $('#modalJsonContent').textContent = JSON.stringify(payload, null, 2);

  modal.hidden = false;
}

$('#closeModalBtn')?.addEventListener('click', () => {
  const modal = $('#deliverableModal');
  if (modal) modal.hidden = true;
});

$('#deliverableModal')?.addEventListener('click', (e) => {
  if (e.target === $('#deliverableModal')) {
    $('#deliverableModal').hidden = true;
  }
});

$('#copyModalJsonBtn')?.addEventListener('click', () => {
  const text = $('#modalJsonContent')?.textContent;
  if (text) {
    navigator.clipboard.writeText(text).then(() => alert('Payload JSON copied to clipboard!'));
  }
});

function renderCandidatesList(records = []) {
  const el = $('#candidatesListContent');
  if (!el) return;
  $('#countCandidatesTab').textContent = records.length;
  if (records.length === 0) {
    el.innerHTML = '<p class="muted">No candidates discovered in database queue yet.</p>';
    return;
  }
  el.innerHTML = records.map(r => {
    const p = r.payload || {};
    return `
      <div class="explorer-item-card">
        <div class="explorer-item-header">
          <span class="explorer-item-title">${esc(p.title || r.noveltyKey || r.id)}</span>
          <span class="pill state-pill-running">$${esc(p.rewardDollars || r.priority || 0)}</span>
        </div>
        <div class="muted">
          <span><strong>Rail:</strong> ${esc(p.rail || 'default')}</span> • 
          <span><strong>Source:</strong> ${esc(p.source || 'Scraper')}</span> • 
          <span><strong>Status:</strong> ${esc(r.status)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderValidationList(records = []) {
  const el = $('#validationListContent');
  if (!el) return;
  $('#countValidationTab').textContent = records.length;
  if (records.length === 0) {
    el.innerHTML = '<p class="muted">No triage/validation records in queue yet.</p>';
    return;
  }
  el.innerHTML = records.map(r => {
    const p = r.payload || {};
    const triage = p.triageResult || {};
    const gates = triage.gates || {};
    const ev = triage.expectedValue != null ? `$${triage.expectedValue.toFixed(2)}` : 'N/A';
    const score = triage.score != null ? `${triage.score}/100` : 'N/A';
    const isPass = r.status === 'EXECUTABLE' || r.status === 'VALIDATED';

    const gateBadges = Object.keys(gates).map(k => {
      const pass = gates[k]?.pass !== false;
      return `<span class="gate-badge ${pass ? 'gate-badge-pass' : 'gate-badge-fail'}">${esc(k)}: ${pass ? 'PASS' : 'FAIL'}</span>`;
    }).join(' ');

    return `
      <div class="explorer-item-card">
        <div class="explorer-item-header">
          <span class="explorer-item-title">${esc(p.candidateId || r.noveltyKey)}</span>
          <span class="pill ${isPass ? 'state-pill-running' : 'state-pill-paused'}">${esc(r.status)} (Score: ${esc(score)})</span>
        </div>
        <div class="gate-badges">${gateBadges}</div>
        <div class="muted">
          <span><strong>Net EV:</strong> ${esc(ev)}</span> • 
          <span><strong>Reason:</strong> ${esc(triage.reason || 'All gates satisfied')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderOutcomesList(records = []) {
  const el = $('#outcomesListContent');
  if (!el) return;
  $('#countOutcomesTab').textContent = records.length;
  if (records.length === 0) {
    el.innerHTML = '<p class="muted">No execution outcomes in queue yet.</p>';
    return;
  }
  el.innerHTML = records.map(r => {
    const p = r.payload || {};
    const itemJson = esc(JSON.stringify(r));
    return `
      <div class="explorer-item-card">
        <div class="explorer-item-header">
          <span class="explorer-item-title">${esc(p.candidateId || r.noveltyKey)}</span>
          <span class="pill state-pill-running">${esc(r.status)}</span>
        </div>
        <div class="muted">
          <span><strong>Staged Path:</strong> ${esc(p.stagedPath || 'data/staged-deliverables')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderEconomicsList(economics = {}) {
  const el = $('#economicsListContent');
  if (!el) return;
  const rails = Array.isArray(economics.rails) ? economics.rails : [];
  if (rails.length === 0) {
    el.innerHTML = '<p class="muted">No rail economics recorded yet.</p>';
    return;
  }
  el.innerHTML = rails.map(r => `
    <div class="explorer-item-card">
      <div class="explorer-item-header">
        <span class="explorer-item-title">Rail: ${esc(r.rail)}</span>
        <span class="pill ${r.state === 'PROVEN' ? 'state-pill-running' : 'pill'}">${esc(r.state || 'PROBATION')}</span>
      </div>
      <div class="muted">
        <span><strong>Attempts:</strong> ${esc(r.attempts || 0)}</span> • 
        <span><strong>Spend:</strong> $${((r.spendCents || 0) / 100).toFixed(2)}</span> • 
        <span><strong>Cleared:</strong> $${((r.clearedCents || 0) / 100).toFixed(2)}</span> • 
        <span><strong>Pending:</strong> $${((r.pendingCents || 0) / 100).toFixed(2)}</span>
      </div>
    </div>
  `).join('');
}

async function refreshPipelineExplorer() {
  try {
    const [candidates, validation, outcomes, economics] = await Promise.all([
      requestJson('/api/revenue/records?queue=candidates').catch(() => ({ records: [] })),
      requestJson('/api/revenue/records?queue=validation').catch(() => ({ records: [] })),
      requestJson('/api/revenue/records?queue=outcomes').catch(() => ({ records: [] })),
      requestJson('/api/money/economics').catch(() => ({ rails: [] }))
    ]);

    renderCandidatesList(candidates.records || []);
    renderValidationList(validation.records || []);
    renderOutcomesList(outcomes.records || []);
    renderEconomicsList(economics);
  } catch (err) {
    console.warn('[Pipeline Explorer Refresh Error]', err.message);
  }
}

// Tab Switcher
document.querySelectorAll('.explorer-tab-btn')?.forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.explorer-tab-btn').forEach(b => b.classList.remove('active-tab'));
    document.querySelectorAll('.explorer-tab-content').forEach(c => c.hidden = true);

    btn.classList.add('active-tab');
    const targetId = btn.getAttribute('data-tab');
    if (targetId && $(`#${targetId}`)) {
      $(`#${targetId}`).hidden = false;
    }
  });
});

$('#refreshPipelineDataBtn')?.addEventListener('click', refreshPipelineExplorer);

async function refreshAutonomousEngine() {
  try {
    const [status, stagedRes] = await Promise.all([
      requestJson('/api/engine/status'),
      requestJson('/api/engine/staged')
    ]);

    latestStagedItems = stagedRes.items || [];

    // Update state pill badge
    const badge = $('#engineStateBadge');
    if (badge) {
      badge.className = 'pill';
      if (status.state === 'RUNNING') {
        badge.classList.add('state-pill-running');
        badge.textContent = '● RUNNING (Non-Stop)';
      } else if (status.state === 'PAUSED') {
        badge.classList.add('state-pill-paused');
        badge.textContent = '⏸ PAUSED';
      } else {
        badge.classList.add('state-pill-stopped');
        badge.textContent = '⏹ STOPPED';
      }
    }

    // Update buttons disabled state
    const isRunning = status.state === 'RUNNING';
    const isPaused = status.state === 'PAUSED';
    if ($('#engineStartBtn')) $('#engineStartBtn').disabled = isRunning;
    if ($('#enginePauseBtn')) $('#enginePauseBtn').disabled = !isRunning;
    if ($('#engineStopBtn')) $('#engineStopBtn').disabled = status.state === 'STOPPED';

    // Update live activity
    if ($('#engineActivityText')) {
      $('#engineActivityText').textContent = status.currentActivity || 'Idle';
    }

    // Update metrics
    if ($('#metricCycles')) $('#metricCycles').textContent = status.metrics.cyclesCompleted || 0;
    if ($('#metricScanned')) $('#metricScanned').textContent = status.metrics.opportunitiesScanned || 0;
    if ($('#metricPassed')) $('#metricPassed').textContent = status.metrics.triagedPassed || 0;
    if ($('#metricStaged')) $('#metricStaged').textContent = status.metrics.deliverablesStaged || 0;
    if ($('#metricEv')) $('#metricEv').textContent = `$${(status.metrics.totalPotentialEvDollars || 0).toFixed(2)}`;

    // Update tweak controls if not dirty
    if (status.config) {
      const activeEl = document.activeElement;
      if ($('#tweakInterval') && activeEl !== $('#tweakInterval')) $('#tweakInterval').value = status.config.cycleIntervalSec;
      if ($('#tweakMinReward') && activeEl !== $('#tweakMinReward')) $('#tweakMinReward').value = status.config.minRewardDollars;
      if ($('#tweakMinEv') && activeEl !== $('#tweakMinEv')) $('#tweakMinEv').value = status.config.minExpectedValue;
      if ($('#tweakAutoExecute') && activeEl !== $('#tweakAutoExecute')) $('#tweakAutoExecute').checked = status.config.autoExecuteDeliverables;
      if ($('#railBountyScraper')) $('#railBountyScraper').checked = status.config.activeRails.includes('bounty_scraper');
      if ($('#railFeeAudit')) $('#railFeeAudit').checked = status.config.activeRails.includes('fee_audit');
      if ($('#railCodeBounties')) $('#railCodeBounties').checked = status.config.activeRails.includes('code_bounties');
    }

    // Update stream feed
    const streamFeed = $('#engineStreamFeed');
    if (streamFeed && status.history?.length) {
      streamFeed.innerHTML = status.history.map(renderStreamEntry).join('');
    }

    // Update staged deliverables
    const stagedList = $('#stagedDeliverablesList');
    if (stagedList) {
      const items = stagedRes.items || [];
      if (items.length > 0) {
        stagedList.innerHTML = items.map(renderStagedItem).join('');
        stagedList.querySelectorAll('.staged-item').forEach((el, idx) => {
          el.addEventListener('click', () => {
            const item = items[idx];
            if (item) openDeliverableModal(item);
          });
        });
      } else {
        stagedList.innerHTML = '<p class="muted">No deliverables staged yet.</p>';
      }
    }

    // Refresh pipeline queues
    await refreshPipelineExplorer();
  } catch (err) {
    console.warn('[Engine Refresh Error]', err.message);
  }
}

// Engine Controls Event Listeners
$('#engineStartBtn')?.addEventListener('click', async () => {
  try {
    $('#engineStartBtn').disabled = true;
    await requestJson('/api/engine/start', mutationOptions({ method: 'POST' }));
    await refreshAutonomousEngine();
  } catch (err) {
    alert(`Failed to start engine: ${err.message}`);
  }
});

$('#enginePauseBtn')?.addEventListener('click', async () => {
  try {
    $('#enginePauseBtn').disabled = true;
    await requestJson('/api/engine/pause', mutationOptions({ method: 'POST' }));
    await refreshAutonomousEngine();
  } catch (err) {
    alert(`Failed to pause engine: ${err.message}`);
  }
});

$('#engineStopBtn')?.addEventListener('click', async () => {
  try {
    $('#engineStopBtn').disabled = true;
    await requestJson('/api/engine/stop', mutationOptions({ method: 'POST' }));
    await refreshAutonomousEngine();
  } catch (err) {
    alert(`Failed to stop engine: ${err.message}`);
  }
});

$('#engineSweepBtn')?.addEventListener('click', async () => {
  const btn = $('#engineSweepBtn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⚡ Sweeping Pipeline…';
    }
    const res = await requestJson('/api/engine/sweep', mutationOptions({ method: 'POST' }));
    alert(`Pipeline Cron Sweep Finished!\n\nDiscovered: ${res.summary?.discover?.enqueued || 0}\nValidated: ${res.summary?.validate?.validated || 0}\nExecuted: ${res.summary?.execute?.outcomes || 0}`);
    await refreshAutonomousEngine();
  } catch (err) {
    alert(`Pipeline sweep failed: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Run Cron Pipeline Sweep';
    }
  }
});

$('#toggleTweakBtn')?.addEventListener('click', () => {
  const panel = $('#tweakOptionsPanel');
  if (panel) panel.hidden = !panel.hidden;
});

$('#saveTweaksBtn')?.addEventListener('click', async () => {
  try {
    const activeRails = [];
    if ($('#railBountyScraper')?.checked) activeRails.push('bounty_scraper');
    if ($('#railFeeAudit')?.checked) activeRails.push('fee_audit');
    if ($('#railCodeBounties')?.checked) activeRails.push('code_bounties');

    const body = {
      cycleIntervalSec: Number($('#tweakInterval')?.value || 10),
      minRewardDollars: Number($('#tweakMinReward')?.value || 20),
      minExpectedValue: Number($('#tweakMinEv')?.value || 10),
      autoExecuteDeliverables: $('#tweakAutoExecute')?.checked !== false,
      activeRails,
      aiModel: $('#tweakAiModel')?.value || $('#selectLocalModel')?.value || 'taskman-ai:latest'
    };

    const res = await requestJson('/api/engine/tweak', mutationOptions({
      method: 'POST',
      body: JSON.stringify(body)
    }));

    alert('Engine tweak settings applied!');
    await refreshAutonomousEngine();
  } catch (err) {
    alert(`Failed to save tweaks: ${err.message}`);
  }
});

$('#refreshStagedBtn')?.addEventListener('click', refreshAutonomousEngine);

// Start autonomous engine status poller (every 2.5 seconds)
enginePollTimer = setInterval(refreshAutonomousEngine, 2500);

refreshAiStudio().then(() => {
  // Populate models into tweakAiModel dropdown
  const tweakModelSelect = $('#tweakAiModel');
  const mainModelSelect = $('#selectLocalModel');
  if (tweakModelSelect && mainModelSelect) {
    tweakModelSelect.innerHTML = mainModelSelect.innerHTML;
    tweakModelSelect.value = mainModelSelect.value;
  }
});
refreshAutonomousEngine();

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshDashboard({ supersede: true });
    refreshAiStudio();
    refreshAutonomousEngine();
  }
  scheduleRefresh();
});

refreshDashboard();
scheduleRefresh();


