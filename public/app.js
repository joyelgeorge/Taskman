const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, options) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
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

async function refresh() {
  const [status, tasks, runs, brain, scenarios] = await Promise.all([api('/api/status'), api('/api/tasks'), api('/api/runs'), api('/api/brain'), api('/api/scenarios')]);
  $('#providers').innerHTML = status.providers.map(p => `<span class="pill">${esc(p.id)} · ${p.ready ? 'ready' : 'no key'}</span>`).join('');
  $('#usage').textContent = `${Number(status.usage.inputTokens || 0) + Number(status.usage.outputTokens || 0)} tokens tracked${status.database?.ok ? ' · PostgreSQL connected' : ' · local fallback'}`;
  $('#brainState').innerHTML = renderBrain(brain);
  renderScenarios(scenarios);

  $('#tasks').innerHTML = tasks.length ? tasks.map(t => `
    <div class="task">
      <div class="row"><strong>${esc(t.title)}</strong><span class="pill">${esc(t.status)}</span>${t.intervalMinutes ? `<span class="pill">every ${t.intervalMinutes}m</span>` : '<span class="pill">manual</span>'}</div>
      <div class="muted">${esc(t.prompt)}</div>
      <div class="row" style="margin-top:10px">
        <button data-run="${t.id}">Run now</button>
        <button data-pause="${t.id}">${t.status === 'active' ? 'Pause' : 'Resume'}</button>
      </div>
      ${t.lastResult ? `<div class="result">${esc(t.lastResult)}</div>` : ''}
    </div>`).join('') : '<p class="muted">No tasks yet.</p>';

  $('#runs').innerHTML = runs.length ? runs.slice(0, 10).map(r => `
    <div class="task">
      <div class="row"><strong>${esc(r.status)}</strong>${r.provider ? `<span class="pill">${esc(r.provider)}</span>` : ''}<span class="muted">${new Date(r.startedAt || r.started_at).toLocaleString()}</span></div>
      ${r.result ? `<div class="result">${esc(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))}</div>` : ''}
      ${r.error ? `<div class="result">${esc(r.error)}</div>` : ''}
      ${r.nextBestAction ? `<p class="muted"><strong>Next:</strong> ${esc(r.nextBestAction)}</p>` : ''}
    </div>`).join('') : '<p class="muted">No runs yet.</p>';
}

$('#create').onclick = async () => {
  try {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: $('#title').value, prompt: $('#prompt').value, intervalMinutes: $('#interval').value }) });
    $('#title').value = ''; $('#prompt').value = ''; $('#interval').value = '';
    await refresh();
  } catch (e) { alert(e.message); }
};

$('#runBrain').onclick = async () => {
  const button = $('#runBrain');
  button.disabled = true;
  button.textContent = 'Running…';
  $('#brainResult').innerHTML = '<p class="muted">Resolving the selected gap…</p>';
  try {
    const result = await api('/api/brain/run', { method: 'POST' });
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

document.addEventListener('click', async e => {
  const run = e.target.closest('[data-run]');
  const pause = e.target.closest('[data-pause]');
  try {
    if (run) await api(`/api/tasks/${run.dataset.run}/run`, { method: 'POST' });
    if (pause) await api(`/api/tasks/${pause.dataset.pause}/pause`, { method: 'POST' });
    if (run || pause) await refresh();
  } catch (err) { alert(err.message); }
});

refresh();
setInterval(refresh, 10000);

