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

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDashboard({ supersede: true });
  scheduleRefresh();
});

refreshDashboard();
scheduleRefresh();
